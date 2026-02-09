import base64
import json
import logging
import mimetypes
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import dashscope
from dashscope import VideoSynthesis
from django.conf import settings

logger = logging.getLogger("mdapi")


class DigitalHumanConfigurationError(Exception):
    """Raised when digital-human config or SDK is unavailable."""


class DigitalHumanServiceError(Exception):
    """Raised when digital-human service call failed."""


def _obj_get(source: Any, key: str, default: Any = None) -> Any:
    if source is None:
        return default
    if isinstance(source, dict):
        return source.get(key, default)
    get_method = getattr(source, "get", None)
    if callable(get_method):
        try:
            return get_method(key, default)
        except Exception:  # noqa: BLE001
            pass
    try:
        return getattr(source, key)
    except Exception:  # noqa: BLE001
        return default


def _to_plain_dict(source: Any) -> dict[str, Any]:
    if source is None:
        return {}
    if isinstance(source, dict):
        return dict(source)
    for method_name in ("model_dump", "dict", "to_dict"):
        try:
            method = getattr(source, method_name)
        except Exception:  # noqa: BLE001
            continue
        if callable(method):
            try:
                value = method()
            except Exception:  # noqa: BLE001
                continue
            if isinstance(value, dict):
                return value
    try:
        return dict(source)
    except Exception:  # noqa: BLE001
        pass
    return {}


class QwenDigitalHumanService:
    DEFAULT_TTS_TARGET_MODEL = "qwen3-tts-vc-realtime-2026-01-15"
    DEFAULT_I2V_MODEL = "wan2.6-i2v-flash"
    DEFAULT_I2V_RESOLUTION = "720P"
    DEFAULT_I2V_DURATION = 5
    DEFAULT_I2V_PROMPT = (
        "一位专业、亲和的医生正面站立面对镜头，画面稳定自然，"
        "语气平和、不急不躁，像在做健康科普讲解。"
        "人物动作克制，仅有自然口型和轻微手势，背景简洁干净、光线柔和。"
    )
    DEFAULT_I2V_NEGATIVE_PROMPT = (
        "夸张表情, 快速跑动, 剧烈动作, 镜头抖动, 快速切镜, 多人入镜, 卡通风格"
    )
    DEFAULT_I2V_PROMPT_VARIANTS = [
        {
            "key": "talking_explain",
            "name": "健康讲解",
            "prompt": (
                "医生正面站立，神态专业亲和，口型自然，像在做健康科普讲解。"
                "动作克制，偶尔自然手势，镜头稳定，整体节奏平稳可信。"
            ),
        },
        {
            "key": "idle_standby",
            "name": "待机轻动",
            "prompt": (
                "医生保持站立待机状态，全程闭嘴，不说话，不出现讲话口型，不张嘴。"
                "仅有轻微呼吸起伏与自然眨眼，可偶尔小幅挥手打招呼，动作克制且节奏缓慢。"
                "画面稳定，人物自然放松，适合作为数字人待机循环素材。"
            ),
        },
        {
            "key": "nod_acknowledge",
            "name": "点头确认",
            "prompt": (
                "医生面向镜头进行轻微点头确认，表情沉稳，动作连贯自然。"
                "无夸张肢体，仅保留短暂点头和细微口型变化。"
            ),
        },
        {
            "key": "gentle_gesture",
            "name": "温和手势",
            "prompt": (
                "医生进行简洁温和的讲解手势，幅度小且克制，姿态端正。"
                "整体感觉耐心、不急不躁，适合医学知识说明场景。"
            ),
        },
        {
            "key": "listening_pause",
            "name": "倾听停顿",
            "prompt": (
                "医生呈现倾听与思考的停顿状态，全程闭嘴，不说话，不出现讲话口型，不张嘴。"
                "目光稳定，可偶尔轻微点头，动作尽量少，保持专业可信的静态沟通感。"
            ),
        },
    ]

    def __init__(self):
        self.api_key = settings.DASHSCOPE_API_KEY
        if not self.api_key:
            raise DigitalHumanConfigurationError("缺少配置: DASHSCOPE_API_KEY")

        self.base_url = getattr(
            settings,
            "DASHSCOPE_BASE_URL",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
        )
        self.dashscope_http_url = self._to_dashscope_http_url(self.base_url)
        self.voice_enroll_url = getattr(
            settings,
            "QWEN_VOICE_ENROLL_URL",
            f"{self.dashscope_http_url}/services/audio/tts/customization",
        )
        self.tts_target_model = getattr(
            settings, "DIGITAL_HUMAN_TTS_TARGET_MODEL", self.DEFAULT_TTS_TARGET_MODEL
        )
        self.i2v_model = getattr(settings, "DIGITAL_HUMAN_I2V_MODEL", self.DEFAULT_I2V_MODEL)
        self.i2v_resolution = getattr(
            settings, "DIGITAL_HUMAN_I2V_RESOLUTION", self.DEFAULT_I2V_RESOLUTION
        )
        self.i2v_duration = int(
            getattr(settings, "DIGITAL_HUMAN_I2V_DURATION", self.DEFAULT_I2V_DURATION)
        )

        self.prompt_dir = Path(
            getattr(settings, "PROMPT_DIR", Path(settings.BASE_DIR) / "prompts")
        )
        self.i2v_prompt_template = self._load_prompt_text(
            "qwen/doctor_i2v_prompt.txt", self.DEFAULT_I2V_PROMPT
        )
        self.i2v_negative_prompt_template = self._load_prompt_text(
            "qwen/doctor_i2v_negative_prompt.txt", self.DEFAULT_I2V_NEGATIVE_PROMPT
        )
        self.i2v_prompt_variants = self._load_prompt_variants(
            "qwen/doctor_i2v_prompt_variants.json",
            self.DEFAULT_I2V_PROMPT_VARIANTS,
        )

    @staticmethod
    def _to_dashscope_http_url(base_url: str) -> str:
        value = (base_url or "").rstrip("/")
        if value.endswith("/compatible-mode/v1"):
            return value.replace("/compatible-mode/v1", "/api/v1")
        return value or "https://dashscope.aliyuncs.com/api/v1"

    def _load_prompt_text(self, relative_path: str, default_text: str) -> str:
        prompt_path = self.prompt_dir / relative_path
        try:
            text = prompt_path.read_text(encoding="utf-8").strip()
            if text:
                return text
            logger.warning("Prompt file is empty, fallback to default: %s", prompt_path)
        except FileNotFoundError:
            logger.warning("Prompt file not found, fallback to default: %s", prompt_path)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Failed to load prompt file %s, fallback to default: %s",
                prompt_path,
                exc,
            )
        return default_text

    def _load_prompt_variants(
        self,
        relative_path: str,
        default_variants: list[dict[str, str]],
    ) -> list[dict[str, str]]:
        prompt_path = self.prompt_dir / relative_path
        try:
            content = prompt_path.read_text(encoding="utf-8")
            raw_value = json.loads(content)
            variants = self._normalize_prompt_variants(raw_value)
            if variants:
                return variants
            logger.warning(
                "Prompt variants file is empty or invalid, fallback to default: %s",
                prompt_path,
            )
        except FileNotFoundError:
            logger.warning(
                "Prompt variants file not found, fallback to default: %s",
                prompt_path,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Failed to load prompt variants %s, fallback to default: %s",
                prompt_path,
                exc,
            )
        return [dict(item) for item in default_variants]

    @staticmethod
    def _normalize_prompt_variants(raw_value: Any) -> list[dict[str, str]]:
        if not isinstance(raw_value, list):
            return []
        variants: list[dict[str, str]] = []
        for item in raw_value:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key", "")).strip()
            name = str(item.get("name", "")).strip()
            prompt = str(item.get("prompt", "")).strip()
            if not key or not name or not prompt:
                continue
            variants.append({"key": key, "name": name, "prompt": prompt})
        return variants

    @staticmethod
    def _compose_prompt(base_prompt: str, custom_prompt: str | None = None) -> str:
        prompt = (base_prompt or "").strip()
        extra = (custom_prompt or "").strip()
        if extra:
            prompt = f"{prompt}\n补充要求：{extra}"
        return prompt

    @staticmethod
    def _read_upload_bytes(uploaded_file) -> bytes:
        if hasattr(uploaded_file, "seek"):
            uploaded_file.seek(0)
        if hasattr(uploaded_file, "read"):
            data = uploaded_file.read()
            if hasattr(uploaded_file, "seek"):
                uploaded_file.seek(0)
            return data or b""
        raise DigitalHumanServiceError("无效文件对象：无法读取上传文件")

    def _post_json(self, url: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url=url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                status = getattr(resp, "status", None) or resp.getcode()
                content = resp.read().decode("utf-8")
                data = json.loads(content) if content else {}
                if int(status) != 200:
                    raise DigitalHumanServiceError(
                        f"请求失败: status={status}, body={content}"
                    )
                return data
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise DigitalHumanServiceError(
                f"请求失败: status={exc.code}, body={detail}"
            ) from exc
        except DigitalHumanServiceError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise DigitalHumanServiceError(f"请求异常: {exc}") from exc

    def create_voice(
        self,
        uploaded_file,
        preferred_name: str,
        target_model: str | None = None,
    ) -> dict[str, Any]:
        file_bytes = self._read_upload_bytes(uploaded_file)
        if not file_bytes:
            raise DigitalHumanServiceError("音频文件为空，无法创建音色")

        audio_mime_type = (
            getattr(uploaded_file, "content_type", None)
            or mimetypes.guess_type(getattr(uploaded_file, "name", ""))[0]
            or "audio/mpeg"
        )
        base64_str = base64.b64encode(file_bytes).decode("utf-8")
        data_uri = f"data:{audio_mime_type};base64,{base64_str}"

        payload = {
            "model": "qwen-voice-enrollment",
            "input": {
                "action": "create",
                "target_model": target_model or self.tts_target_model,
                "preferred_name": preferred_name,
                "audio": {"data": data_uri},
            },
        }
        result = self._post_json(self.voice_enroll_url, payload)
        voice_id = _obj_get(_obj_get(result, "output", {}), "voice")
        if not voice_id:
            raise DigitalHumanServiceError(f"创建音色失败，返回缺少 voice: {result}")
        return {"voice_id": voice_id, "raw": result}

    def build_i2v_prompt(self, custom_prompt: str | None = None) -> str:
        return self._compose_prompt(self.i2v_prompt_template, custom_prompt)

    def build_i2v_prompt_variants(
        self,
        custom_prompt: str | None = None,
        count: int = 5,
    ) -> list[dict[str, str]]:
        if not self.i2v_prompt_variants:
            return [
                {
                    "scene_key": "default",
                    "scene_name": "默认讲解",
                    "prompt": self.build_i2v_prompt(custom_prompt),
                }
            ]

        normalized_count = max(1, min(int(count), len(self.i2v_prompt_variants)))
        selected = self.i2v_prompt_variants[:normalized_count]
        return [
            {
                "scene_key": item["key"],
                "scene_name": item["name"],
                "prompt": self._compose_prompt(item["prompt"], custom_prompt),
            }
            for item in selected
        ]

    def build_i2v_negative_prompt(self, custom_negative_prompt: str | None = None) -> str:
        negative_prompt = self.i2v_negative_prompt_template.strip()
        extra = (custom_negative_prompt or "").strip()
        if extra:
            negative_prompt = f"{negative_prompt}, {extra}"
        return negative_prompt

    @staticmethod
    def _normalize_task_status(raw_status: str | None) -> str:
        value = (raw_status or "").upper()
        mapping = {
            "SUCCEEDED": "succeeded",
            "FAILED": "failed",
            "RUNNING": "running",
            "PENDING": "submitted",
            "QUEUED": "submitted",
            "UNKNOWN": "submitted",
            "CANCELED": "failed",
        }
        return mapping.get(value, "submitted")

    def _parse_video_response(
        self,
        response: Any,
        error_prefix: str,
    ) -> dict[str, Any]:
        status_code = _obj_get(response, "status_code")
        code = _obj_get(response, "code")
        message = _obj_get(response, "message")
        if int(status_code or 0) != 200:
            raise DigitalHumanServiceError(
                f"{error_prefix}: status={status_code}, code={code}, message={message}"
            )

        output = _obj_get(response, "output", {}) or {}
        task_id = _obj_get(output, "task_id")
        task_status_raw = _obj_get(output, "task_status")
        video_url = _obj_get(output, "video_url")
        request_id = _obj_get(response, "request_id")

        return {
            "request_id": request_id,
            "task_id": task_id,
            "task_status_raw": task_status_raw,
            "task_status": self._normalize_task_status(task_status_raw),
            "video_url": video_url,
            "raw": _to_plain_dict(response),
        }

    def submit_image_to_video(
        self,
        img_url: str,
        prompt: str,
        *,
        model: str | None = None,
        negative_prompt: str | None = None,
        resolution: str | None = None,
        duration: int | None = None,
        prompt_extend: bool = True,
        watermark: bool = True,
        audio_enabled: bool = False,
        seed: int | None = None,
    ) -> dict[str, Any]:
        dashscope.base_http_api_url = self.dashscope_http_url
        kwargs: dict[str, Any] = {}
        if seed is not None:
            kwargs["seed"] = seed

        response = VideoSynthesis.async_call(
            api_key=self.api_key,
            model=model or self.i2v_model,
            prompt=prompt,
            img_url=img_url,
            audio=audio_enabled,
            resolution=resolution or self.i2v_resolution,
            duration=int(duration or self.i2v_duration),
            extend_prompt=prompt_extend,
            watermark=watermark,
            negative_prompt=negative_prompt or "",
            **kwargs,
        )
        return self._parse_video_response(response, "图生视频任务提交失败")

    def fetch_video_task(self, task_id: str) -> dict[str, Any]:
        dashscope.base_http_api_url = self.dashscope_http_url
        response = VideoSynthesis.fetch(task=task_id, api_key=self.api_key)
        return self._parse_video_response(response, "图生视频任务查询失败")


def get_digital_human_service() -> QwenDigitalHumanService:
    return QwenDigitalHumanService()
