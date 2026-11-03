#!/usr/bin/env python3
"""Generate portrait I2V clips for 杨渝平 with wan3.0-video.

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

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
ASSET_DIR = ROOT / "dev-assets"
SOURCE_PATH = ASSET_DIR / "yangyuping.png"
IMAGE_PATH = ASSET_DIR / "yangyuping_9x16.png"
OUT_DIR = ASSET_DIR / "portrait-gen-20260914-15s"
DOCTOR_ID = 3
MODEL = "wan3.0-video"
DURATION_SECONDS = 15
REUSE_IMAGE_JSON = ASSET_DIR / "portrait-gen-20260914" / "generated.json"

SCENES = [
    {
        "key": "talking_explain",
        "name": "健康讲解",
        "prompt": (
            "竖版9:16构图，人物居中铺满画面，无黑边灰边，镜头稳定。"
            "医生正面面向镜头，半身到腰部完整入镜，神态专业亲和，口型自然，像在做健康科普讲解。"
            "动作克制，偶尔自然手势，整体节奏平稳可信。"
        ),
    },
    {
        "key": "idle_standby",
        "name": "待机轻动",
        "prompt": (
            "竖版9:16构图，人物居中铺满画面，无黑边灰边，镜头稳定。"
            "医生保持待机状态，全程闭嘴，不说话，不出现讲话口型，不张嘴。"
            "仅有轻微呼吸起伏与自然眨眼，可偶尔小幅挥手打招呼，动作克制且节奏缓慢。"
        ),
    },
    {
        "key": "nod_acknowledge",
        "name": "点头确认",
        "prompt": (
            "竖版9:16构图，人物居中铺满画面，无黑边灰边，镜头稳定。"
            "医生面向镜头进行轻微点头确认，表情沉稳，动作连贯自然。"
            "无夸张肢体，仅保留短暂点头和细微口型变化。"
        ),
    },
    {
        "key": "gentle_gesture",
        "name": "温和手势",
        "prompt": (
            "竖版9:16构图，人物居中铺满画面，无黑边灰边，镜头稳定。"
            "医生进行简洁温和的讲解手势，幅度小且克制，姿态端正。"
            "整体感觉耐心、不急不躁，适合医学知识说明场景。"
        ),
    },
    {
        "key": "listening_pause",
        "name": "倾听停顿",
        "prompt": (
            "竖版9:16构图，人物居中铺满画面，无黑边灰边，镜头稳定。"
            "医生呈现倾听与思考的停顿状态，全程闭嘴，不说话，不出现讲话口型，不张嘴。"
            "目光稳定，可偶尔轻微点头，动作尽量少，保持专业可信的静态沟通感。"
        ),
    },
]

NEGATIVE_PROMPT = (
    "夸张表情, 剧烈动作, 镜头抖动, 快速切镜, 跑跳动作, 人物变形, "
    "卡通动漫风, 杂乱背景, 多人同时入镜, 横版画面, 两侧黑边, 两侧灰边"
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


def crop_to_9x16(src: Path, dest: Path) -> None:
    image = Image.open(src).convert("RGB")
    width, height = image.size
    target_ratio = 9 / 16
    current_ratio = width / height
    if current_ratio > target_ratio:
        new_width = int(round(height * target_ratio))
        left = (width - new_width) // 2
        image = image.crop((left, 0, left + new_width, height))
    elif current_ratio < target_ratio:
        new_height = int(round(width / target_ratio))
        top = (height - new_height) // 6
        image = image.crop((0, top, width, top + new_height))
    dest.parent.mkdir(parents=True, exist_ok=True)
    image.save(dest, format="PNG")
    log(f"CROP {src.name} {width}x{height} -> {dest.name} {image.size[0]}x{image.size[1]}")


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


def build_payload(prompt: str, img_url: str) -> dict:
    return {
        "model": MODEL,
        "input": {
            "prompt": prompt,
            "negative_prompt": NEGATIVE_PROMPT,
            "media": [{"type": "first_frame", "url": img_url}],
        },
        "parameters": {
            "resolution": "720P",
            "ratio": "9:16",
            "duration": DURATION_SECONDS,
            "prompt_extend": True,
            "watermark": False,
            "audio": False,
        },
    }


def submit_task(api_key: str, prompt: str, img_url: str) -> tuple[str, str]:
    data = dashscope_post(api_key, build_payload(prompt, img_url))
    output = data.get("output") or {}
    task_id = output.get("task_id")
    if not task_id:
        raise RuntimeError(f"submit missing task_id: {data}")
    return task_id, data.get("request_id") or ""


def wait_task(api_key: str, task_id: str, timeout: int = 1800) -> dict:
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
    with urllib.request.urlopen(req, timeout=180) as resp:
        return resp.read()


def log(message: str) -> None:
    print(message, flush=True)


def main() -> None:
    env = load_env(ENV_PATH)
    api_key = env["DASHSCOPE_API_KEY"]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if REUSE_IMAGE_JSON.exists():
        prev = json.loads(REUSE_IMAGE_JSON.read_text(encoding="utf-8"))[0]
        image_meta = {
            "object_key": prev["image_object_key"],
            "oss_url": prev["image_oss_url"],
            "etag": prev["image_etag"],
            "size_bytes": str(prev["image_size_bytes"]),
        }
        log(f"REUSE_IMAGE key={image_meta['object_key']}")
    else:
        crop_to_9x16(SOURCE_PATH, IMAGE_PATH)
        log(f"start image={IMAGE_PATH} size={IMAGE_PATH.stat().st_size}")
        image_bytes = IMAGE_PATH.read_bytes()
        image_key = (
            f"doctor-digital-human/images/{DOCTOR_ID}/2026/09/14/"
            f"{uuid.uuid4().hex}_yangyuping_9x16.png"
        )
        log(f"oss_put_image key={image_key}")
        image_meta = oss_put(env, image_key, image_bytes, "image/png")
    img_url = oss_signed_get(env, image_meta["object_key"], expires=6 * 3600)
    log("IMAGE " + json.dumps(image_meta, ensure_ascii=False))

    results = []
    for scene in SCENES:
        log(f"SUBMIT {scene['key']}")
        task_id, request_id = submit_task(api_key, scene["prompt"], img_url)
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
            "video_model": MODEL,
            "resolution": "720P",
            "duration_seconds": DURATION_SECONDS,
            "task_id": task_id,
            "task_request_id": request_id or data.get("request_id"),
            "task_status": "succeeded",
            "video_url_external": video_url,
            "video_file_name": Path(urllib.parse.urlparse(video_url).path).name or f"{task_id}.mp4",
            "image_file_name": "yangyuping_9x16.png",
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
        (OUT_DIR / "generated.json").write_text(
            json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        log(f"DONE {scene['key']} bytes={item['video_size_bytes']} key={item['video_object_key']}")

    log(f"WROTE {OUT_DIR / 'generated.json'}")


if __name__ == "__main__":
    main()
