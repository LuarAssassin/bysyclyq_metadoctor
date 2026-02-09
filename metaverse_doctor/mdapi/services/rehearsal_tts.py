import json
import logging
import queue
import re
import threading
import time
from collections.abc import Generator
from typing import Any

logger = logging.getLogger("mdapi")


class RehearsalRealtimeTTSError(Exception):
    """Raised when realtime TTS streaming fails."""


class DoctorRehearsalRealtimeTTS:
    """Bridge qwen_tts_realtime websocket events into pull-based chunks for SSE."""

    SENTENCE_END_RE = re.compile(r"[。！？!?]+|\n+")
    SOFT_BREAK_CHARS = ("，", ",", "；", ";")
    IMAGE_LINK_RE = re.compile(r"!\[([^\]]*)\]\([^)]+\)")
    TEXT_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
    HEADING_RE = re.compile(r"(^|\n)\s*#{1,6}\s*")
    QUOTE_RE = re.compile(r"(^|\n)\s*>\s+")
    BULLET_RE = re.compile(r"(^|\n)\s*[-*+]\s+")
    ORDERED_LIST_RE = re.compile(r"(^|\n)\s*\d+\.\s+")
    TASK_LIST_RE = re.compile(r"\[(?:x|X| )\]\s*")
    HR_RE = re.compile(r"(^|\n)\s*[-*_]{3,}\s*($|\n)")

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        voice_id: str,
        ws_url: str,
        max_buffer_chars: int = 120,
    ):
        self.api_key = (api_key or "").strip()
        self.model = (model or "").strip()
        self.voice_id = (voice_id or "").strip()
        self.ws_url = (ws_url or "").strip()
        self.max_buffer_chars = max(20, int(max_buffer_chars))

        self._event_queue: queue.Queue[dict[str, Any]] = queue.Queue()
        self._finished_event = threading.Event()
        self._text_buffer = ""
        self._client = None
        self._closed = False

        self._started_at_monotonic: float | None = None
        self._first_audio_delay_ms: int | None = None
        self._audio_chunk_count = 0
        self._audio_base64_chars = 0
        self._last_error = ""

    @classmethod
    def extract_completed_segments(
        cls,
        text: str,
        *,
        max_buffer_chars: int = 120,
    ) -> tuple[list[str], str]:
        content = str(text or "")
        if not content:
            return [], ""

        segments: list[str] = []
        start = 0
        for match in cls.SENTENCE_END_RE.finditer(content):
            end = match.end()
            segment = content[start:end].strip()
            if segment:
                segments.append(segment)
            start = end

        remainder = content[start:].lstrip()
        safe_limit = max(20, int(max_buffer_chars))

        while len(remainder) > safe_limit:
            cut_index = -1
            for ch in cls.SOFT_BREAK_CHARS:
                cut_index = max(cut_index, remainder.rfind(ch, 0, safe_limit))
            if cut_index <= 0:
                cut_index = safe_limit
            else:
                cut_index += 1

            segment = remainder[:cut_index].strip()
            if segment:
                segments.append(segment)
            remainder = remainder[cut_index:].lstrip()

        return segments, remainder

    @classmethod
    def normalize_markdown_for_tts(cls, text: str) -> str:
        content = str(text or "")
        if not content:
            return ""

        normalized = content.replace("\r\n", "\n")
        normalized = cls.IMAGE_LINK_RE.sub(r"\1", normalized)
        normalized = cls.TEXT_LINK_RE.sub(r"\1", normalized)
        normalized = cls.HEADING_RE.sub(r"\1", normalized)
        normalized = cls.QUOTE_RE.sub(r"\1", normalized)
        normalized = cls.BULLET_RE.sub(r"\1", normalized)
        normalized = cls.ORDERED_LIST_RE.sub(r"\1", normalized)
        normalized = cls.TASK_LIST_RE.sub("", normalized)
        normalized = cls.HR_RE.sub(r"\1", normalized)
        normalized = normalized.replace("`", "")
        normalized = normalized.replace("**", "").replace("__", "")
        normalized = normalized.replace("*", "").replace("_", "")
        normalized = normalized.replace("~~", "")
        normalized = normalized.replace("|", " ")
        normalized = re.sub(r"\n{3,}", "\n\n", normalized)
        return normalized

    def _push_event(self, payload: dict[str, Any]) -> None:
        self._event_queue.put(payload)

    def start(self) -> None:
        if not self.api_key:
            raise RehearsalRealtimeTTSError("缺少 DASHSCOPE_API_KEY，无法启用实时语音")
        if not self.model:
            raise RehearsalRealtimeTTSError("缺少实时语音模型名")
        if not self.voice_id:
            raise RehearsalRealtimeTTSError("缺少 voice_id，无法启用实时语音")
        if not self.ws_url:
            raise RehearsalRealtimeTTSError("缺少实时语音 websocket 地址")

        try:
            import dashscope
            from dashscope.audio.qwen_tts_realtime import (
                AudioFormat,
                QwenTtsRealtime,
                QwenTtsRealtimeCallback,
            )
        except ImportError as exc:
            raise RehearsalRealtimeTTSError(
                "未安装 realtime tts 依赖（dashscope.audio.qwen_tts_realtime）"
            ) from exc

        outer = self

        class _Callback(QwenTtsRealtimeCallback):
            def on_open(self) -> None:
                outer._push_event({"type": "opened"})

            def on_close(self, close_status_code, close_msg) -> None:
                outer._finished_event.set()
                outer._push_event(
                    {
                        "type": "closed",
                        "code": close_status_code,
                        "message": str(close_msg or ""),
                    }
                )

            def on_event(self, message) -> None:  # noqa: ANN001
                data: dict[str, Any]
                if isinstance(message, dict):
                    data = message
                elif isinstance(message, str):
                    try:
                        parsed = json.loads(message)
                        data = parsed if isinstance(parsed, dict) else {}
                    except Exception:  # noqa: BLE001
                        data = {}
                else:
                    data = {}

                event_type = str(data.get("type") or "").strip()
                if not event_type:
                    return

                if event_type == "response.audio.delta":
                    delta = str(data.get("delta") or "")
                    if delta:
                        outer._push_event({"type": "audio_delta", "delta": delta})
                elif event_type in {"error", "response.error"}:
                    message_text = str(
                        data.get("message")
                        or data.get("error")
                        or data.get("code")
                        or "realtime tts error"
                    )
                    outer._push_event(
                        {"type": "error", "message": message_text, "raw": data}
                    )
                elif event_type == "session.finished":
                    outer._finished_event.set()
                    outer._push_event({"type": "finished"})

        try:
            dashscope.api_key = self.api_key
            self._client = QwenTtsRealtime(
                model=self.model,
                callback=_Callback(),
                url=self.ws_url,
            )
            self._client.connect()
            self._client.update_session(
                voice=self.voice_id,
                response_format=AudioFormat.PCM_24000HZ_MONO_16BIT,
                mode="server_commit",
            )
            self._started_at_monotonic = time.monotonic()
        except Exception as exc:  # noqa: BLE001
            raise RehearsalRealtimeTTSError(f"初始化实时语音失败: {exc}") from exc

    def append_text(self, text: str) -> None:
        if not self._client:
            raise RehearsalRealtimeTTSError("实时语音连接未建立")
        chunk = str(text or "")
        if not chunk:
            return

        normalized_chunk = self.normalize_markdown_for_tts(chunk)
        if not normalized_chunk:
            return

        try:
            # 追求最低延迟：每个文本增量块到达后立即送入实时语音。
            self._client.append_text(normalized_chunk)
        except Exception as exc:  # noqa: BLE001
            raise RehearsalRealtimeTTSError(f"追加实时语音文本失败: {exc}") from exc

    def finish(self) -> None:
        if not self._client:
            return
        try:
            self._client.finish()
        except Exception as exc:  # noqa: BLE001
            raise RehearsalRealtimeTTSError(f"结束实时语音失败: {exc}") from exc

    def drain_events(self, max_items: int = 500) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        for _ in range(max(1, int(max_items))):
            try:
                event = self._event_queue.get_nowait()
            except queue.Empty:
                break

            if event.get("type") == "audio_delta":
                delta = str(event.get("delta") or "")
                if delta:
                    self._audio_chunk_count += 1
                    self._audio_base64_chars += len(delta)
                    if (
                        self._first_audio_delay_ms is None
                        and self._started_at_monotonic is not None
                    ):
                        self._first_audio_delay_ms = int(
                            (time.monotonic() - self._started_at_monotonic) * 1000
                        )
            elif event.get("type") == "error":
                self._last_error = str(event.get("message") or "")

            events.append(event)
        return events

    def drain_until_done(
        self,
        *,
        max_wait_seconds: float = 15.0,
        poll_interval: float = 0.05,
    ) -> Generator[dict[str, Any], None, None]:
        """
        流式等待 TTS 服务返回所有剩余音频，逐个 yield 事件。

        与旧版（批量返回 list）不同，改为 generator 后调用方可以
        即时将 audio_delta 推送到 SSE，而不必等全部收完。

        如果 TTS 正常完成会发 session.finished，此时提前退出（不空等）。
        超时仅作为兜底，防止 WebSocket 无响应时无限挂起。
        """
        deadline = time.monotonic() + max(0.1, float(max_wait_seconds))
        while time.monotonic() < deadline:
            batch = self.drain_events()
            if batch:
                yield from batch
            if self._finished_event.is_set():
                break
            time.sleep(max(0.01, float(poll_interval)))

        if not self._finished_event.is_set():
            logger.warning(
                "drain_until_done: TTS 未在 %.1fs 内返回 session.finished，已超时退出 "
                "(已收到 %d 个音频分片)",
                max_wait_seconds,
                self._audio_chunk_count,
            )

        # 最后再捞一次，确保不丢尾部事件
        tail = self.drain_events()
        if tail:
            yield from tail

    def close(self) -> None:
        if self._closed:
            return
        if self._client:
            try:
                self._client.close()
            except Exception as exc:  # noqa: BLE001
                logger.warning("close realtime tts failed: %s", exc)
        self._closed = True

    def get_stats(self) -> dict[str, Any]:
        return {
            "audio_format": "pcm16",
            "sample_rate": 24000,
            "channels": 1,
            "first_audio_delay_ms": self._first_audio_delay_ms,
            "audio_chunk_count": self._audio_chunk_count,
            "audio_base64_chars": self._audio_base64_chars,
            "error": self._last_error,
        }
