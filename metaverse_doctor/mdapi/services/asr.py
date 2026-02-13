import base64
from typing import Any

from django.conf import settings


class QwenASRConfigurationError(Exception):
    """Raised when qwen asr configuration or SDK is unavailable."""


class QwenASRError(Exception):
    """Raised when qwen asr call failed or output cannot be parsed."""


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


def _normalize_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        fragments: list[str] = []
        for item in content:
            if isinstance(item, str):
                text = item.strip()
                if text:
                    fragments.append(text)
                continue
            if isinstance(item, dict):
                for key in ("text", "transcript", "content"):
                    value = item.get(key)
                    if isinstance(value, str) and value.strip():
                        fragments.append(value.strip())
                        break
        return "\n".join(fragments).strip()
    if isinstance(content, dict):
        for key in ("text", "transcript", "content"):
            value = content.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


class QwenASRService:
    DEFAULT_MODEL = "qwen3-asr-flash"

    def __init__(self):
        self.api_key = getattr(settings, "DASHSCOPE_API_KEY", "")
        if not self.api_key:
            raise QwenASRConfigurationError("缺少配置: DASHSCOPE_API_KEY")

        self.base_url = getattr(
            settings,
            "DASHSCOPE_BASE_URL",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
        )
        self.model = getattr(settings, "QWEN_PATIENT_ASR_MODEL", self.DEFAULT_MODEL)
        self.enable_itn = bool(getattr(settings, "QWEN_PATIENT_ASR_ENABLE_ITN", False))
        self.language = (getattr(settings, "QWEN_PATIENT_ASR_LANGUAGE", "") or "").strip()

        try:
            import dashscope
        except ImportError as exc:
            raise QwenASRConfigurationError(
                "未安装 dashscope SDK，请执行: uv add dashscope"
            ) from exc

        self.dashscope = dashscope
        self.dashscope.base_http_api_url = self._to_dashscope_http_url(self.base_url)

    @staticmethod
    def _to_dashscope_http_url(base_url: str) -> str:
        value = (base_url or "").rstrip("/")
        if value.endswith("/compatible-mode/v1"):
            return value.replace("/compatible-mode/v1", "/api/v1")
        return value or "https://dashscope.aliyuncs.com/api/v1"

    def transcribe(self, uploaded_file, audio_mime_type: str = "") -> dict[str, str]:
        try:
            if hasattr(uploaded_file, "seek"):
                uploaded_file.seek(0)
            body = uploaded_file.read()
        except Exception as exc:  # noqa: BLE001
            raise QwenASRError(f"读取音频文件失败: {exc}") from exc

        if not body:
            raise QwenASRError("音频文件为空，无法识别")

        mime_type = (audio_mime_type or getattr(uploaded_file, "content_type", "") or "").strip()
        if not mime_type:
            mime_type = "audio/webm"

        base64_str = base64.b64encode(body).decode("utf-8")
        data_uri = f"data:{mime_type};base64,{base64_str}"

        asr_options: dict[str, Any] = {"enable_itn": self.enable_itn}
        if self.language:
            asr_options["language"] = self.language

        try:
            response = self.dashscope.MultiModalConversation.call(
                api_key=self.api_key,
                model=self.model,
                messages=[
                    {"role": "system", "content": [{"text": ""}]},
                    {"role": "user", "content": [{"audio": data_uri}]},
                ],
                result_format="message",
                asr_options=asr_options,
            )
        except Exception as exc:  # noqa: BLE001
            raise QwenASRError(f"语音识别调用失败: {exc}") from exc

        status_code = _obj_get(response, "status_code", 200)
        if int(status_code or 0) != 200:
            code = _obj_get(response, "code", "")
            message = _obj_get(response, "message", "")
            raise QwenASRError(
                f"语音识别失败: status={status_code}, code={code}, message={message}"
            )

        output = _obj_get(response, "output", {})
        choices = _obj_get(output, "choices", [])
        text = ""
        if isinstance(choices, list) and choices:
            first_choice = choices[0]
            message = _obj_get(first_choice, "message", {})
            content = _obj_get(message, "content", "")
            text = _normalize_text(content)
        if not text:
            text = _normalize_text(_obj_get(output, "text", ""))
        if not text:
            text = _normalize_text(_obj_get(response, "output_text", ""))
        if not text:
            raise QwenASRError("语音识别未返回可用文本")

        return {
            "text": text,
            "model": self.model,
        }


def get_qwen_asr_service() -> QwenASRService:
    return QwenASRService()
