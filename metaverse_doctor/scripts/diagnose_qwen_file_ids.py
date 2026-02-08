#!/usr/bin/env python
"""
Diagnose qwen_file_id availability and qwen-long file-id behavior.

Usage examples:
  uv run python scripts/diagnose_qwen_file_ids.py
  uv run python scripts/diagnose_qwen_file_ids.py --doctor-id 2 --limit 10 --pair-check
  uv run python scripts/diagnose_qwen_file_ids.py --knowledge-ids 12,13,16 --pair-check --pair-limit 6
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass
class ItemResult:
    knowledge_id: int
    doctor_id: int
    file_name: str
    qwen_file_id: str
    extract_status: str
    retrieve_ok: bool
    retrieve_error: str
    single_ok: bool
    single_error: str


@dataclass
class PairResult:
    file_id_1: str
    file_id_2: str
    multi_ok: bool
    multi_error: str


def _to_text(exc: Exception) -> str:
    return str(exc).strip().replace("\n", " ")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="诊断 DoctorKnowledge.qwen_file_id 在当前 API Key 下是否可用"
    )
    parser.add_argument("--doctor-id", type=int, default=None, help="只检查某个医生")
    parser.add_argument(
        "--knowledge-ids",
        type=str,
        default="",
        help="只检查指定知识记录，逗号分隔，如 12,13,16",
    )
    parser.add_argument("--limit", type=int, default=20, help="最多检查多少条记录")
    parser.add_argument(
        "--pair-check",
        action="store_true",
        help="额外检查 qwen-long 多 file_id 组合行为",
    )
    parser.add_argument(
        "--pair-limit",
        type=int,
        default=10,
        help="最多检查多少组 file_id 组合",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="",
        help="qwen-long 模型名，默认读取 settings.QWEN_LONG_MODEL",
    )
    parser.add_argument(
        "--json-out",
        type=str,
        default="",
        help="可选：把完整结果写到 JSON 文件",
    )
    parser.add_argument(
        "--attempts",
        type=int,
        default=3,
        help="每次检测的重试次数（默认 3）",
    )
    return parser


def _setup_django() -> None:
    project_root = Path(__file__).resolve().parents[1]
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "metaverse_doctor.settings")

    import django

    django.setup()


def _parse_ids(raw: str) -> list[int]:
    text = (raw or "").strip()
    if not text:
        return []
    result: list[int] = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        result.append(int(part))
    return result


def _check_single_file(
    *,
    client,
    model: str,
    file_id: str,
    attempts: int,
) -> tuple[bool, str]:
    max_attempts = max(1, int(attempts))
    last_error = ""
    for idx in range(max_attempts):
        try:
            client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": f"fileid://{file_id}"},
                    {"role": "user", "content": "请只回复ok。"},
                ],
                temperature=0.1,
            )
            return True, ""
        except Exception as exc:  # noqa: BLE001
            last_error = _to_text(exc)
            if idx < max_attempts - 1:
                time.sleep(0.8)
    return False, last_error


def _check_pair_files(
    *,
    client,
    model: str,
    file_id_1: str,
    file_id_2: str,
    attempts: int,
) -> tuple[bool, str]:
    max_attempts = max(1, int(attempts))
    last_error = ""
    for idx in range(max_attempts):
        try:
            client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": f"fileid://{file_id_1},{file_id_2}"},
                    {"role": "user", "content": "请只回复ok。"},
                ],
                temperature=0.1,
            )
            return True, ""
        except Exception as exc:  # noqa: BLE001
            last_error = _to_text(exc)
            if idx < max_attempts - 1:
                time.sleep(0.8)
    return False, last_error


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    _setup_django()

    from django.conf import settings
    from mdapi.models import DoctorKnowledge
    from openai import OpenAI

    api_key = getattr(settings, "DASHSCOPE_API_KEY", "")
    base_url = getattr(
        settings,
        "DASHSCOPE_BASE_URL",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )
    if not api_key:
        print("ERROR: 缺少 DASHSCOPE_API_KEY")
        return 2

    model = args.model.strip() or getattr(settings, "QWEN_LONG_MODEL", "qwen-long")
    client = OpenAI(api_key=api_key, base_url=base_url)

    qs = (
        DoctorKnowledge.objects.filter(is_deleted=False)
        .exclude(qwen_file_id__isnull=True)
        .exclude(qwen_file_id="")
        .order_by("-updated_at", "-id")
    )
    if args.doctor_id:
        qs = qs.filter(doctor_id=args.doctor_id)
    knowledge_ids = _parse_ids(args.knowledge_ids)
    if knowledge_ids:
        qs = qs.filter(id__in=knowledge_ids)

    limit = max(1, int(args.limit))
    items = list(qs[:limit])
    if not items:
        print("未找到可检查的 DoctorKnowledge 记录。")
        return 0

    attempts = max(1, int(args.attempts))
    results: list[ItemResult] = []
    print(
        f"开始检查 {len(items)} 条记录 | model={model} | base_url={base_url} | doctor_id={args.doctor_id or 'ALL'} | attempts={attempts}"
    )

    for item in items:
        retrieve_ok = False
        retrieve_error = ""
        single_ok = False
        single_error = ""

        try:
            file_obj = client.files.retrieve(item.qwen_file_id)
            if getattr(file_obj, "id", None) == item.qwen_file_id:
                retrieve_ok = True
            else:
                retrieve_error = "retrieve 返回对象异常（id 不匹配）"
        except Exception as exc:  # noqa: BLE001
            retrieve_error = _to_text(exc)

        if retrieve_ok:
            single_ok, single_error = _check_single_file(
                client=client,
                model=model,
                file_id=item.qwen_file_id,
                attempts=attempts,
            )

        result = ItemResult(
            knowledge_id=item.id,
            doctor_id=item.doctor_id,
            file_name=item.file_name,
            qwen_file_id=item.qwen_file_id,
            extract_status=item.extract_status,
            retrieve_ok=retrieve_ok,
            retrieve_error=retrieve_error,
            single_ok=single_ok,
            single_error=single_error,
        )
        results.append(result)

        print(
            f"- knowledge_id={item.id} | status={item.extract_status} | retrieve={'OK' if retrieve_ok else 'FAIL'} | single={'OK' if single_ok else 'FAIL'} | file_id={item.qwen_file_id}"
        )
        if retrieve_error:
            print(f"  retrieve_error: {retrieve_error}")
        if single_error:
            print(f"  single_error:   {single_error}")

    pair_results: list[PairResult] = []
    if args.pair_check:
        valid_file_ids = [
            result.qwen_file_id
            for result in results
            if result.retrieve_ok and result.single_ok
        ]
        unique_valid_file_ids = list(dict.fromkeys(valid_file_ids))
        pair_limit = max(1, int(args.pair_limit))
        print(
            f"\n开始组合检查（pair-check）: 可用 file_id={len(unique_valid_file_ids)}，最多检查 {pair_limit} 组"
        )
        for file_id_1, file_id_2 in itertools.combinations(unique_valid_file_ids, 2):
            multi_ok, multi_error = _check_pair_files(
                client=client,
                model=model,
                file_id_1=file_id_1,
                file_id_2=file_id_2,
                attempts=attempts,
            )
            pair_result = PairResult(
                file_id_1=file_id_1,
                file_id_2=file_id_2,
                multi_ok=multi_ok,
                multi_error=multi_error,
            )
            pair_results.append(pair_result)
            print(
                f"- pair={file_id_1},{file_id_2} | multi={'OK' if multi_ok else 'FAIL'}"
            )
            if multi_error:
                print(f"  multi_error: {multi_error}")
            if len(pair_results) >= pair_limit:
                break

    total = len(results)
    retrieve_ok_count = sum(1 for item in results if item.retrieve_ok)
    single_ok_count = sum(1 for item in results if item.single_ok)
    pair_ok_count = sum(1 for item in pair_results if item.multi_ok)
    pair_count = len(pair_results)

    print("\n========== SUMMARY ==========")
    print(f"records: {total}")
    print(f"retrieve_ok: {retrieve_ok_count}/{total}")
    print(f"single_chat_ok: {single_ok_count}/{total}")
    if args.pair_check:
        print(f"multi_chat_ok: {pair_ok_count}/{pair_count}")
        if pair_count > 0 and pair_ok_count == 0 and single_ok_count > 1:
            print(
                "diagnosis: 本次检测中多文件组合均失败（单文件可用）。请结合官方文档，将其视为“组合调用异常”并在业务侧做重试/回退。"
            )

    if args.json_out:
        out_path = Path(args.json_out).expanduser().resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        payload: dict[str, Any] = {
            "meta": {
                "doctor_id": args.doctor_id,
                "model": model,
                "base_url": base_url,
                "limit": limit,
                "pair_check": args.pair_check,
                "pair_limit": args.pair_limit,
                "attempts": attempts,
            },
            "results": [asdict(item) for item in results],
            "pair_results": [asdict(item) for item in pair_results],
            "summary": {
                "records": total,
                "retrieve_ok": retrieve_ok_count,
                "single_chat_ok": single_ok_count,
                "multi_chat_ok": pair_ok_count,
                "multi_chat_total": pair_count,
            },
        }
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"json_out: {out_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
