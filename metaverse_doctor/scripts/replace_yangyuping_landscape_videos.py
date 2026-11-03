#!/usr/bin/env python3
"""One-off: generate landscape I2V clips for 杨渝平 and print upload metadata.

Does not touch the production database. The caller updates Postgres after review.
"""

from __future__ import annotations

import base64
import email.utils
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
ASSET_DIR = ROOT / "dev-assets"
IMAGE_PATH = ASSET_DIR / "yangyuping_16x9.png"
OUT_DIR = ASSET_DIR / "landscape-gen-20260914"
DOCTOR_ID = 3

SCENES = [
    {
        "key": "talking_explain",
        "name": "健康讲解",
        "prompt": (
            "横版16:9构图，人物居中铺满画面，无黑边灰边，镜头稳定。"
            "医生正面面向镜头，神态专业亲和，口型自然，像在做健康科普讲解。"
            "动作克制，偶尔自然手势，整体节奏平稳可信。"
        ),
    },
    {
        "key": "idle_standby",
        "name": "待机轻动",
        "prompt": (
            "横版16:9构图，人物居中铺满画面，无黑边灰边，镜头稳定。"
            "医生保持待机状态，全程闭嘴，不说话，不出现讲话口型，不张嘴。"
            "仅有轻微呼吸起伏与自然眨眼，可偶尔小幅挥手打招呼，动作克制且节奏缓慢。"
        ),
    },
    {
        "key": "nod_acknowledge",
        "name": "点头确认",
        "prompt": (
            "横版16:9构图，人物居中铺满画面，无黑边灰边，镜头稳定。"
            "医生面向镜头进行轻微点头确认，表情沉稳，动作连贯自然。"
            "无夸张肢体，仅保留短暂点头和细微口型变化。"
        ),
    },
    {
        "key": "gentle_gesture",
        "name": "温和手势",
        "prompt": (
            "横版16:9构图，人物居中铺满画面，无黑边灰边，镜头稳定。"
            "医生进行简洁温和的讲解手势，幅度小且克制，姿态端正。"
            "整体感觉耐心、不急不躁，适合医学知识说明场景。"
        ),
    },
    {
        "key": "listening_pause",
        "name": "倾听停顿",
        "prompt": (
            "横版16:9构图，人物居中铺满画面，无黑边灰边，镜头稳定。"
            "医生呈现倾听与思考的停顿状态，全程闭嘴，不说话，不出现讲话口型，不张嘴。"
            "目光稳定，可偶尔轻微点头，动作尽量少，保持专业可信的静态沟通感。"
        ),
    },
]

NEGATIVE_PROMPT = (
    "夸张表情, 剧烈动作, 镜头抖动, 快速切镜, 跑跳动作, 人物变形, "
    "卡通动漫风, 杂乱背景, 多人同时入镜, 竖版画面, 两侧黑边, 两侧灰边"
)


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def oss_auth(method: str, content_type: str, date: str, bucket: str, key: str, secret: str) -> str:
    canonical = f"{method}\n\n{content_type}\n{date}\n/{bucket}/{key}"
    digest = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha1).digest()
    return base64.b64encode(digest).decode("ascii")


def oss_put(env: dict[str, str], key: str, body: bytes, content_type: str) -> dict[str, str]:
    bucket = env["OSS_BUCKET"]
    region = env["OSS_REGION"]
    ak = env["ALIBABA_CLOUD_ACCESS_KEY_ID"]
    sk = env["ALIBABA_CLOUD_ACCESS_KEY_SECRET"]
    public_base = env.get("OSS_PUBLIC_BASE_URL", "").rstrip("/")
    endpoint = f"https://{bucket}.oss-{region}.aliyuncs.com"
    date = email.utils.formatdate(usegmt=True)
    sig = oss_auth("PUT", content_type, date, bucket, key, sk)
    req = urllib.request.Request(
        f"{endpoint}/{key}",
        data=body,
        method="PUT",
        headers={
            "Date": date,
            "Content-Type": content_type,
            "Authorization": f"OSS {ak}:{sig}",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        etag = (resp.headers.get("ETag") or "").strip('"')
    oss_url = f"{public_base}/{key}" if public_base else f"{endpoint}/{key}"
    return {"object_key": key, "oss_url": oss_url, "etag": etag, "size_bytes": str(len(body))}


def oss_signed_get(env: dict[str, str], key: str, expires: int = 7200) -> str:
    bucket = env["OSS_BUCKET"]
    region = env["OSS_REGION"]
    ak = env["ALIBABA_CLOUD_ACCESS_KEY_ID"]
    sk = env["ALIBABA_CLOUD_ACCESS_KEY_SECRET"]
    expire_ts = int(time.time()) + expires
    string_to_sign = f"GET\n\n\n{expire_ts}\n/{bucket}/{key}"
    sig = urllib.parse.quote_plus(
        base64.b64encode(
            hmac.new(sk.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha1).digest()
        ).decode("ascii")
    )
    return (
        f"https://{bucket}.oss-{region}.aliyuncs.com/{key}"
        f"?OSSAccessKeyId={urllib.parse.quote_plus(ak)}"
        f"&Expires={expire_ts}&Signature={sig}"
    )


def dashscope_post(api_key: str, payload: dict) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"DashScope submit HTTP {exc.code}: {detail}") from exc


def dashscope_fetch(api_key: str, task_id: str) -> dict:
    req = urllib.request.Request(
        f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}",
        method="GET",
        headers={"Authorization": f"Bearer {api_key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"DashScope fetch HTTP {exc.code}: {detail}") from exc


def build_payload(model: str, prompt: str, img_url: str) -> dict:
    if model.startswith("wan3.0"):
        return {
            "model": model,
            "input": {
                "prompt": prompt,
                "negative_prompt": NEGATIVE_PROMPT,
                "media": [{"type": "first_frame", "url": img_url}],
            },
            "parameters": {
                "resolution": "720P",
                "ratio": "16:9",
                "duration": 5,
                "prompt_extend": True,
                "watermark": False,
                "audio": False,
            },
        }
    if model.startswith("wan2.7"):
        return {
            "model": model,
            "input": {
                "prompt": prompt,
                "negative_prompt": NEGATIVE_PROMPT,
                "media": [{"type": "first_frame", "url": img_url}],
            },
            "parameters": {
                "resolution": "720P",
                "duration": 5,
                "prompt_extend": True,
                "watermark": False,
                "audio": False,
            },
        }
    return {
        "model": model,
        "input": {
            "prompt": prompt,
            "negative_prompt": NEGATIVE_PROMPT,
            "img_url": img_url,
        },
        "parameters": {
            "resolution": "720P",
            "duration": 5,
            "prompt_extend": True,
            "watermark": False,
            "audio": False,
        },
    }


def submit_task(api_key: str, model: str, prompt: str, img_url: str) -> tuple[str, str]:
    data = dashscope_post(api_key, build_payload(model, prompt, img_url))
    output = data.get("output") or {}
    task_id = output.get("task_id")
    if not task_id:
        raise RuntimeError(f"submit missing task_id: {data}")
    return task_id, data.get("request_id") or ""


def choose_model(api_key: str, img_url: str) -> tuple[str, str, str]:
    """Submit the first scene to discover a usable model; reuse that task."""
    candidates = ["wan3.0-video", "wan2.7-i2v-2026-04-25", "wan2.6-i2v"]
    last_error = None
    for model in candidates:
        try:
            task_id, request_id = submit_task(api_key, model, SCENES[0]["prompt"], img_url)
            log(f"PROBE_OK model={model} task_id={task_id} request_id={request_id}")
            return model, task_id, request_id
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            log(f"PROBE_FAIL model={model} error={exc}")
    raise RuntimeError(f"no usable Wan model: {last_error}")


def wait_task(api_key: str, task_id: str, timeout: int = 900) -> dict:
    started = time.time()
    last_status = ""
    while time.time() - started < timeout:
        data = dashscope_fetch(api_key, task_id)
        output = data.get("output") or {}
        status = (output.get("task_status") or "").upper()
        if status != last_status:
            log(f"  task {task_id} -> {status}")
            last_status = status
        if status == "SUCCEEDED":
            if not output.get("video_url"):
                raise RuntimeError(f"succeeded without video_url: {data}")
            return data
        if status in {"FAILED", "CANCELED", "UNKNOWN"}:
            raise RuntimeError(f"task ended {status}: {data}")
        time.sleep(15)
    raise TimeoutError(f"task {task_id} timeout after {timeout}s")


def download(url: str) -> bytes:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def log(message: str) -> None:
    print(message, flush=True)


def main() -> None:
    env = load_env(ENV_PATH)
    api_key = env["DASHSCOPE_API_KEY"]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    log(f"start image={IMAGE_PATH} size={IMAGE_PATH.stat().st_size}")

    image_bytes = IMAGE_PATH.read_bytes()
    image_key = (
        f"doctor-digital-human/images/{DOCTOR_ID}/2026/09/14/"
        f"{uuid.uuid4().hex}_yangyuping_16x9.png"
    )
    log(f"oss_put_image key={image_key}")
    image_meta = oss_put(env, image_key, image_bytes, "image/png")
    img_url = oss_signed_get(env, image_key, expires=6 * 3600)
    log("IMAGE " + json.dumps(image_meta, ensure_ascii=False))

    log("probing wan models")
    model, first_task_id, first_request_id = choose_model(api_key, img_url)
    results = []
    for index, scene in enumerate(SCENES):
        if index == 0:
            task_id, request_id = first_task_id, first_request_id
            log(f"REUSE_FIRST {scene['key']} task_id={task_id}")
        else:
            log(f"SUBMIT {scene['key']}")
            task_id, request_id = submit_task(api_key, model, scene["prompt"], img_url)
        data = wait_task(api_key, task_id)
        output = data.get("output") or {}
        video_url = output["video_url"]
        video_bytes = download(video_url)
        local_path = OUT_DIR / f"{scene['key']}.mp4"
        local_path.write_bytes(video_bytes)
        video_key = (
            f"doctor-digital-human/videos/{DOCTOR_ID}/2026/09/14/"
            f"{uuid.uuid4().hex}_doctor-avatar-video-{uuid.uuid4().hex}.mp4"
        )
        video_meta = oss_put(env, video_key, video_bytes, "video/mp4")
        item = {
            "scene_key": scene["key"],
            "scene_name": scene["name"],
            "prompt": scene["prompt"],
            "negative_prompt": NEGATIVE_PROMPT,
            "video_model": model,
            "resolution": "720P",
            "duration_seconds": 5,
            "task_id": task_id,
            "task_request_id": request_id or data.get("request_id"),
            "task_status": "succeeded",
            "video_url_external": video_url,
            "video_file_name": Path(urllib.parse.urlparse(video_url).path).name or f"{task_id}.mp4",
            "image_file_name": "yangyuping_16x9.png",
            "image_object_key": image_meta["object_key"],
            "image_oss_url": image_meta["oss_url"],
            "image_content_type": "image/png",
            "image_size_bytes": int(image_meta["size_bytes"]),
            "image_etag": image_meta["etag"],
            "video_object_key": video_meta["object_key"],
            "video_oss_url": video_meta["oss_url"],
            "video_content_type": "video/mp4",
            "video_size_bytes": int(video_meta["size_bytes"]),
            "video_etag": video_meta["etag"],
            "local_path": str(local_path),
        }
        results.append(item)
        log(f"DONE {scene['key']} bytes={item['video_size_bytes']} key={item['video_object_key']}")

    out_json = OUT_DIR / "generated.json"
    out_json.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"WROTE {out_json}")


if __name__ == "__main__":
    main()
