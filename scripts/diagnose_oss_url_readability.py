#!/usr/bin/env python3
"""
OSS URL 可读性与 Qwen 文档抽取兼容性诊断脚本。

目标：
1) 判断 URL 是否真正可公网访问（HEAD / Range / 部分内容）；
2) 判断响应头是否满足模型侧抓取（Content-Type / Content-Length）；
3) 验证 qwen-doc-turbo 对 doc_url 的可读性；
4) 当 doc_url 失败时，尝试 qwen-long + fileid 上传链路（可选兜底）。

用法示例：
    uv run scripts/diagnose_oss_url_readability.py
    uv run scripts/diagnose_oss_url_readability.py --limit 10 --doctor-id 2
    uv run scripts/diagnose_oss_url_readability.py --url "https://xxx/a.pdf" --skip-db
    uv run scripts/diagnose_oss_url_readability.py --output-json /tmp/oss_diag.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT_DIR / "metaverse_doctor" / ".env"
DB_PATH = ROOT_DIR / "metaverse_doctor" / "db.sqlite3"


def load_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.exists():
        return data
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def env_get(name: str, env_data: dict[str, str], default: str | None = None) -> str | None:
    return os.getenv(name) or env_data.get(name) or default


def print_title(text: str) -> None:
    print("\n" + "=" * 20 + f" {text} " + "=" * 20)


@dataclass
class Target:
    knowledge_id: int | None
    file_name: str
    object_key: str
    oss_url: str
    qwen_file_id: str | None
    source: str


@dataclass
class HTTPProbeResult:
    ok: bool
    status: int | None
    final_url: str
    content_type: str | None
    content_length: int | None
    accepts_ranges: bool
    range_status: int | None
    first_bytes_hex: str
    sha1_4k: str
    warning: str | None
    error: str | None


@dataclass
class QwenDocResult:
    ok: bool
    status: int | None
    code: str | None
    message: str | None
    content_preview: str | None
    error: str | None


@dataclass
class QwenLongFallbackResult:
    ok: bool
    skipped: bool
    reason: str | None
    file_id: str | None
    file_id_source: str | None
    content_preview: str | None
    error: str | None


@dataclass
class SignedURLResult:
    ok: bool
    signed_url: str | None
    http_ok: bool
    http_status: int | None
    qwen_doc_ok: bool
    qwen_doc_error: str | None
    error: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Diagnose OSS URL readability for Qwen extraction")
    parser.add_argument("--env", default=str(ENV_PATH), help="Path to .env")
    parser.add_argument("--db", default=str(DB_PATH), help="Path to sqlite db")
    parser.add_argument("--limit", type=int, default=8, help="DB records to inspect")
    parser.add_argument("--doctor-id", type=int, default=None, help="Filter by doctor id")
    parser.add_argument("--url", action="append", default=[], help="Extra URL to inspect")
    parser.add_argument("--skip-db", action="store_true", help="Do not load targets from DB")
    parser.add_argument("--timeout", type=float, default=15.0, help="HTTP timeout seconds")
    parser.add_argument("--range-bytes", type=int, default=1024, help="Range bytes to read")
    parser.add_argument(
        "--doc-model",
        default=None,
        help="Override qwen-doc model (default from env QWEN_DOC_MODEL or qwen-doc-turbo)",
    )
    parser.add_argument(
        "--long-model",
        default=None,
        help="Override qwen-long model (default from env QWEN_LONG_MODEL or qwen-long)",
    )
    parser.add_argument(
        "--skip-qwen-doc",
        action="store_true",
        help="Skip qwen-doc-turbo readability check",
    )
    parser.add_argument(
        "--skip-qwen-long-fallback",
        action="store_true",
        help="Skip qwen-long fallback check when doc-turbo fails",
    )
    parser.add_argument(
        "--max-fallback-bytes",
        type=int,
        default=30 * 1024 * 1024,
        help="Max content length for fallback upload test",
    )
    parser.add_argument(
        "--output-json",
        default=None,
        help="Save full report to json path",
    )
    parser.add_argument(
        "--skip-signed-url",
        action="store_true",
        help="Skip signed URL generation and probe",
    )
    parser.add_argument(
        "--signed-expire",
        type=int,
        default=900,
        help="Signed URL expiry seconds",
    )
    return parser.parse_args()


def load_targets_from_db(db_path: Path, limit: int, doctor_id: int | None) -> list[Target]:
    if not db_path.exists():
        return []
    query = """
        SELECT id, file_name, object_key, oss_url, qwen_file_id
        FROM mdapi_doctorknowledge
        WHERE is_deleted = 0
    """
    params: list[Any] = []
    if doctor_id is not None:
        query += " AND doctor_id = ?"
        params.append(doctor_id)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    rows: list[tuple[Any, ...]] = []
    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.cursor()
        cur.execute(query, params)
        rows = cur.fetchall()
    finally:
        conn.close()

    targets: list[Target] = []
    for row in rows:
        kid, file_name, object_key, oss_url, qwen_file_id = row
        if not oss_url:
            continue
        targets.append(
            Target(
                knowledge_id=int(kid),
                file_name=file_name or "",
                object_key=object_key or "",
                oss_url=oss_url,
                qwen_file_id=qwen_file_id or None,
                source="db",
            )
        )
    return targets


def _request(
    url: str,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    timeout: float = 15.0,
    read_limit: int | None = None,
) -> tuple[int, dict[str, str], bytes, str]:
    req = urllib.request.Request(url=url, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status = getattr(resp, "status", None) or resp.getcode()
        final_url = resp.geturl()
        raw_headers = {k.lower(): v for k, v in resp.headers.items()}
        body = resp.read(read_limit) if read_limit else resp.read()
        return int(status), raw_headers, body, final_url


def http_probe(url: str, timeout: float, range_bytes: int) -> HTTPProbeResult:
    status = None
    final_url = url
    content_type = None
    content_length = None
    accepts_ranges = False
    range_status = None
    first_bytes_hex = ""
    sha1_4k = ""
    warning = None
    error = None
    ok = False

    try:
        head_headers: dict[str, str] = {}
        try:
            status, head_headers, _, final_url = _request(url, method="HEAD", timeout=timeout)
        except urllib.error.HTTPError as e:
            head_headers = {k.lower(): v for k, v in (e.headers.items() if e.headers else [])}
            final_url = e.geturl() or final_url
        except Exception:
            pass

        get_status, get_headers, get_chunk, get_final_url = _request(
            url, method="GET", timeout=timeout, read_limit=max(1, range_bytes)
        )
        status = get_status
        final_url = get_final_url or final_url

        merged_headers = {**head_headers, **get_headers}
        content_type = merged_headers.get("content-type")
        content_length_raw = merged_headers.get("content-length")
        if content_length_raw and content_length_raw.isdigit():
            content_length = int(content_length_raw)
        accepts_ranges = merged_headers.get("accept-ranges", "").lower() == "bytes"

        range_header = {"Range": f"bytes=0-{max(0, range_bytes - 1)}"}
        chunk = get_chunk
        try:
            range_status, _, chunk, _ = _request(
                url, method="GET", headers=range_header, timeout=timeout, read_limit=max(1, range_bytes)
            )
        except urllib.error.HTTPError as e:
            range_status = int(e.code)
            chunk = e.read() if hasattr(e, "read") else b""

        if not chunk:
            chunk = get_chunk[:range_bytes]

        first_bytes_hex = chunk[:16].hex()
        sha1_4k = hashlib.sha1(chunk[:4096]).hexdigest()
        ok = status is not None and 200 <= status < 400

        if content_type and "text/html" in content_type.lower():
            warning = "Content-Type 是 text/html，可能返回的是错误页而非原始文件"
        if content_length is not None and content_length == 0:
            warning = "Content-Length 为 0，模型侧可能判定为空文件"
    except Exception as e:  # noqa: BLE001
        error = str(e)

    return HTTPProbeResult(
        ok=ok,
        status=status,
        final_url=final_url,
        content_type=content_type,
        content_length=content_length,
        accepts_ranges=accepts_ranges,
        range_status=range_status,
        first_bytes_hex=first_bytes_hex,
        sha1_4k=sha1_4k,
        warning=warning,
        error=error,
    )


def build_clients(env_data: dict[str, str]) -> dict[str, Any]:
    api_key = env_get("DASHSCOPE_API_KEY", env_data)
    base_url = env_get(
        "DASHSCOPE_BASE_URL", env_data, "https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
    clients: dict[str, Any] = {"api_key": api_key, "base_url": base_url}
    if not api_key:
        return clients

    try:
        import dashscope
        from openai import OpenAI
    except Exception:
        return clients

    dashscope.base_http_api_url = base_url.rstrip("/").replace("/compatible-mode/v1", "/api/v1")
    clients["dashscope"] = dashscope
    clients["openai"] = OpenAI(api_key=api_key, base_url=base_url)
    return clients


def build_oss_bucket(env_data: dict[str, str]) -> Any | None:
    access_key_id = env_get("ALIBABA_CLOUD_ACCESS_KEY_ID", env_data)
    access_key_secret = env_get("ALIBABA_CLOUD_ACCESS_KEY_SECRET", env_data)
    bucket_name = env_get("OSS_BUCKET", env_data)
    region = env_get("OSS_REGION", env_data)
    if not all([access_key_id, access_key_secret, bucket_name, region]):
        return None
    try:
        import oss2
    except Exception:
        return None

    if region.startswith("http://") or region.startswith("https://"):
        endpoint = region.rstrip("/")
    else:
        endpoint = f"https://oss-{region}.aliyuncs.com"
    auth = oss2.Auth(access_key_id, access_key_secret)
    return oss2.Bucket(auth, endpoint, bucket_name)


def qwen_doc_probe(
    clients: dict[str, Any],
    model: str,
    file_name: str,
    doc_url: str,
) -> QwenDocResult:
    dashscope = clients.get("dashscope")
    api_key = clients.get("api_key")
    if not dashscope or not api_key:
        return QwenDocResult(
            ok=False,
            status=None,
            code=None,
            message=None,
            content_preview=None,
            error="缺少 dashscope/openai 依赖或 DASHSCOPE_API_KEY",
        )

    prompt = (
        "你是文档可读性探针。请读取文档并仅输出如下格式：\n"
        "[TAGS]可读[/TAGS]\n"
        "[DESCRIPTION]文档可读取[/DESCRIPTION]\n"
        f"文件名：{file_name}"
    )
    try:
        resp = dashscope.Generation.call(
            api_key=api_key,
            model=model,
            messages=[
                {"role": "system", "content": "你是严格的文档读取测试助手。"},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "doc_url",
                            "doc_url": [doc_url],
                            "file_parsing_strategy": "auto",
                        },
                    ],
                },
            ],
            result_format="message",
        )
    except Exception as e:  # noqa: BLE001
        return QwenDocResult(
            ok=False,
            status=None,
            code=None,
            message=None,
            content_preview=None,
            error=str(e),
        )

    status = getattr(resp, "status_code", None)
    code = getattr(resp, "code", None)
    message = getattr(resp, "message", None)
    preview = None
    ok = bool(status == 200)
    if ok:
        try:
            content = resp.output.choices[0].message.content
            preview = str(content)[:200]
        except Exception:
            preview = "<no-content>"
    return QwenDocResult(
        ok=ok,
        status=status,
        code=code,
        message=message,
        content_preview=preview,
        error=None if ok else f"status={status}, code={code}, message={message}",
    )


def qwen_long_fallback_probe(
    clients: dict[str, Any],
    long_model: str,
    file_name: str,
    url: str,
    existing_file_id: str | None,
    content_length: int | None,
    max_bytes: int,
    timeout: float,
) -> QwenLongFallbackResult:
    client = clients.get("openai")
    if not client:
        return QwenLongFallbackResult(
            ok=False,
            skipped=True,
            reason="缺少 openai SDK 或 DASHSCOPE_API_KEY",
            file_id=None,
            file_id_source=None,
            content_preview=None,
            error=None,
        )
    if not existing_file_id and content_length is not None and content_length > max_bytes:
        return QwenLongFallbackResult(
            ok=False,
            skipped=True,
            reason=f"文件过大({content_length} bytes)，超过 fallback 阈值 {max_bytes}",
            file_id=None,
            file_id_source=None,
            content_preview=None,
            error=None,
        )

    suffix = Path(file_name or "temp.bin").suffix or ".bin"
    temp_path = None
    try:
        file_id_source = "existing"
        file_id = existing_file_id
        if not file_id:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                body = resp.read()
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                temp_path = Path(tmp.name)
                tmp.write(body)

            file_object = client.files.create(file=temp_path, purpose="file-extract")
            file_id = getattr(file_object, "id", None)
            file_id_source = "uploaded"
            if not file_id:
                return QwenLongFallbackResult(
                    ok=False,
                    skipped=False,
                    reason=None,
                    file_id=None,
                    file_id_source=None,
                    content_preview=None,
                    error="files.create 未返回 file_id",
                )

        completion = client.chat.completions.create(
            model=long_model,
            messages=[
                {"role": "system", "content": "你是文档可读性探针。"},
                {"role": "system", "content": f"fileid://{file_id}"},
                {
                    "role": "user",
                    "content": "请仅输出 [DESCRIPTION]可读取[/DESCRIPTION]，用于验证文档可读性。",
                },
            ],
            temperature=0.0,
        )
        text = str(completion.choices[0].message.content)[:200]
        return QwenLongFallbackResult(
            ok=True,
            skipped=False,
            reason=None,
            file_id=file_id,
            file_id_source=file_id_source,
            content_preview=text,
            error=None,
        )
    except Exception as e:  # noqa: BLE001
        return QwenLongFallbackResult(
            ok=False,
            skipped=False,
            reason=None,
            file_id=None,
            file_id_source=None,
            content_preview=None,
            error=str(e),
        )
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


def signed_url_probe(
    bucket: Any | None,
    target: Target,
    timeout: float,
    range_bytes: int,
    signed_expire: int,
    clients: dict[str, Any],
    doc_model: str,
) -> SignedURLResult:
    if bucket is None:
        return SignedURLResult(
            ok=False,
            signed_url=None,
            http_ok=False,
            http_status=None,
            qwen_doc_ok=False,
            qwen_doc_error=None,
            error="缺少 OSS 配置或 oss2 依赖，无法生成签名 URL",
        )
    if not target.object_key:
        return SignedURLResult(
            ok=False,
            signed_url=None,
            http_ok=False,
            http_status=None,
            qwen_doc_ok=False,
            qwen_doc_error=None,
            error="目标缺少 object_key，无法生成签名 URL",
        )

    try:
        signed_url = bucket.sign_url("GET", target.object_key, signed_expire)
    except Exception as e:  # noqa: BLE001
        return SignedURLResult(
            ok=False,
            signed_url=None,
            http_ok=False,
            http_status=None,
            qwen_doc_ok=False,
            qwen_doc_error=None,
            error=f"签名 URL 生成失败: {e}",
        )

    probe = http_probe(signed_url, timeout=timeout, range_bytes=range_bytes)
    doc = qwen_doc_probe(
        clients=clients,
        model=doc_model,
        file_name=target.file_name or "unknown",
        doc_url=signed_url,
    )
    return SignedURLResult(
        ok=probe.ok and doc.ok,
        signed_url=signed_url,
        http_ok=probe.ok,
        http_status=probe.status,
        qwen_doc_ok=doc.ok,
        qwen_doc_error=doc.error,
        error=None,
    )


def dedup_targets(targets: list[Target]) -> list[Target]:
    seen = set()
    result = []
    for t in targets:
        key = (t.oss_url, t.object_key)
        if key in seen:
            continue
        seen.add(key)
        result.append(t)
    return result


def main() -> None:
    args = parse_args()
    env_data = load_env(Path(args.env))

    targets: list[Target] = []
    if not args.skip_db:
        targets.extend(
            load_targets_from_db(
                db_path=Path(args.db),
                limit=max(args.limit, 1),
                doctor_id=args.doctor_id,
            )
        )
    for raw_url in args.url:
        targets.append(
            Target(
                knowledge_id=None,
                file_name=Path(urllib.parse.urlparse(raw_url).path).name,
                object_key="",
                oss_url=raw_url,
                qwen_file_id=None,
                source="arg",
            )
        )
    targets = dedup_targets(targets)

    if not targets:
        print("[错误] 没有可测试目标，请传 --url 或确保 DB 中有知识文件记录。")
        sys.exit(1)

    doc_model = args.doc_model or env_get("QWEN_DOC_MODEL", env_data, "qwen-doc-turbo")
    long_model = args.long_model or env_get("QWEN_LONG_MODEL", env_data, "qwen-long")
    clients = build_clients(env_data)
    oss_bucket = build_oss_bucket(env_data)

    report: dict[str, Any] = {
        "meta": {
            "time": int(time.time()),
            "target_count": len(targets),
            "doc_model": doc_model,
            "long_model": long_model,
            "db_path": str(args.db),
        },
        "items": [],
        "summary": {
            "http_ok": 0,
            "doc_ok": 0,
            "doc_fail": 0,
            "fallback_ok": 0,
            "fallback_fail": 0,
            "fallback_skipped": 0,
            "signed_http_ok": 0,
            "signed_doc_ok": 0,
        },
    }

    print_title("OSS URL Readability Diagnose")
    for idx, target in enumerate(targets, start=1):
        print(f"\n[{idx}/{len(targets)}] {target.file_name or target.oss_url}")
        print(f"  - source: {target.source}, knowledge_id: {target.knowledge_id}")
        if target.qwen_file_id:
            print(f"  - qwen_file_id: {target.qwen_file_id}")
        print(f"  - url: {target.oss_url}")

        item: dict[str, Any] = {"target": asdict(target)}
        http_res = http_probe(target.oss_url, timeout=args.timeout, range_bytes=args.range_bytes)
        item["http_probe"] = asdict(http_res)
        if http_res.ok:
            report["summary"]["http_ok"] += 1
        print(
            f"  - http: ok={http_res.ok} status={http_res.status} "
            f"ctype={http_res.content_type} clen={http_res.content_length} "
            f"range={http_res.range_status}"
        )
        if http_res.warning:
            print(f"    warning: {http_res.warning}")
        if http_res.error:
            print(f"    error: {http_res.error}")

        doc_result = None
        if args.skip_qwen_doc:
            doc_result = QwenDocResult(
                ok=False,
                status=None,
                code=None,
                message=None,
                content_preview=None,
                error="skip by --skip-qwen-doc",
            )
        else:
            doc_result = qwen_doc_probe(
                clients=clients,
                model=doc_model,
                file_name=target.file_name or "unknown",
                doc_url=target.oss_url,
            )
        item["qwen_doc_probe"] = asdict(doc_result)
        if doc_result.ok:
            report["summary"]["doc_ok"] += 1
            print("  - qwen-doc: ok=True")
        else:
            report["summary"]["doc_fail"] += 1
            print(f"  - qwen-doc: ok=False error={doc_result.error}")

        fallback_result = None
        if args.skip_qwen_long_fallback:
            fallback_result = QwenLongFallbackResult(
                ok=False,
                skipped=True,
                reason="skip by --skip-qwen-long-fallback",
                file_id=None,
                file_id_source=None,
                content_preview=None,
                error=None,
            )
        elif doc_result.ok:
            fallback_result = QwenLongFallbackResult(
                ok=False,
                skipped=True,
                reason="doc-turbo 已成功，无需 fallback",
                file_id=None,
                file_id_source=None,
                content_preview=None,
                error=None,
            )
        else:
            fallback_result = qwen_long_fallback_probe(
                clients=clients,
                long_model=long_model,
                file_name=target.file_name or "unknown",
                url=target.oss_url,
                existing_file_id=target.qwen_file_id,
                content_length=http_res.content_length,
                max_bytes=max(1, int(args.max_fallback_bytes)),
                timeout=args.timeout,
            )
        item["qwen_long_fallback"] = asdict(fallback_result)
        if fallback_result.skipped:
            report["summary"]["fallback_skipped"] += 1
            print(f"  - qwen-long-fallback: skipped ({fallback_result.reason})")
        elif fallback_result.ok:
            report["summary"]["fallback_ok"] += 1
            print(
                "  - qwen-long-fallback: "
                f"ok=True file_id={fallback_result.file_id} source={fallback_result.file_id_source}"
            )
        else:
            report["summary"]["fallback_fail"] += 1
            print(f"  - qwen-long-fallback: ok=False error={fallback_result.error}")

        if args.skip_signed_url:
            signed_result = SignedURLResult(
                ok=False,
                signed_url=None,
                http_ok=False,
                http_status=None,
                qwen_doc_ok=False,
                qwen_doc_error=None,
                error="skip by --skip-signed-url",
            )
        else:
            signed_result = signed_url_probe(
                bucket=oss_bucket,
                target=target,
                timeout=args.timeout,
                range_bytes=args.range_bytes,
                signed_expire=max(60, int(args.signed_expire)),
                clients=clients,
                doc_model=doc_model,
            )
        item["signed_url_probe"] = asdict(signed_result)
        if signed_result.error:
            print(f"  - signed-url: error={signed_result.error}")
        else:
            if signed_result.http_ok:
                report["summary"]["signed_http_ok"] += 1
            if signed_result.qwen_doc_ok:
                report["summary"]["signed_doc_ok"] += 1
            print(
                "  - signed-url: "
                f"http_ok={signed_result.http_ok}({signed_result.http_status}) "
                f"qwen_doc_ok={signed_result.qwen_doc_ok}"
            )

        report["items"].append(item)

    print_title("Summary")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))

    if args.output_json:
        output = Path(args.output_json)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n报告已写入: {output}")


if __name__ == "__main__":
    main()
