import base64
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
    """Bridge streaming TTS PCM callbacks into pull-based chunks for SSE."""

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
    CITATION_RE = re.compile(r"\[(?:ref_)?\d{1,3}\]")

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
        self._input_started = False
        self._finish_requested = False
        self._state_lock = threading.Lock()
        self._received_audio_chunks = 0

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
        # 联网搜索引用角标（如 [1] / [ref_1]）不应进入语音朗读。
        normalized = cls.CITATION_RE.sub("", normalized)
        normalized = normalized.replace("`", "")
        normalized = normalized.replace("**", "").replace("__", "")
        normalized = normalized.replace("*", "").replace("_", "")
        normalized = normalized.replace("~~", "")
        normalized = normalized.replace("|", " ")
        normalized = re.sub(r"[ \t]{2,}", " ", normalized)
        normalized = re.sub(r"[ \t]+([，。！？!?；;：:,])", r"\1", normalized)
        normalized = re.sub(r"\n{3,}", "\n\n", normalized)
        return normalized

    def _push_event(self, payload: dict[str, Any]) -> None:
        self._event_queue.put(payload)

    def _fail(self, message: str, *, raw=None) -> None:
        safe_message = str(message or "实时语音生成失败")
        if self.api_key:
            safe_message = safe_message.replace(self.api_key, "[REDACTED]")
        with self._state_lock:
            if self._last_error or self._closed:
                return
            self._last_error = safe_message
        logger.warning("Realtime TTS failed (model=%s): %s", self.model, safe_message)
        payload = {"type": "error", "message": safe_message}
        if raw is not None:
            payload["raw"] = raw
        self._push_event(payload)
        self._finished_event.set()

    def start(self) -> None:
        if not self.api_key:
            raise RehearsalRealtimeTTSError("缺少 DASHSCOPE_API_KEY，无法启用实时语音")
        if not self.model:
            raise RehearsalRealtimeTTSError("缺少实时语音模型名")
        if not self.voice_id:
            raise RehearsalRealtimeTTSError("缺少 voice_id，无法启用实时语音")
        if not self.ws_url:
            raise RehearsalRealtimeTTSError("缺少实时语音 websocket 地址")
        if self._closed:
            raise RehearsalRealtimeTTSError("实时语音连接已关闭")
        if self._client is not None:
            return

        try:
            import dashscope
            from dashscope.audio.tts_v2 import (
                AudioFormat,
                ResultCallback,
                SpeechSynthesizer,
            )
        except ImportError as exc:
            raise RehearsalRealtimeTTSError(
                "未安装流式语音依赖（dashscope.audio.tts_v2）"
            ) from exc

        outer = self

        class _Callback(ResultCallback):
            def on_open(self) -> None:
                outer._push_event({"type": "opened"})

            def on_data(self, data: bytes) -> None:
                if not data or outer._closed or outer._last_error:
                    return
                with outer._state_lock:
                    outer._received_audio_chunks += 1
                outer._push_event(
                    {"type": "audio_delta", "delta": base64.b64encode(data).decode("ascii")}
                )

            def on_complete(self) -> None:
                if outer._closed or outer._last_error:
                    return
                if not outer._received_audio_chunks:
                    outer._fail("实时语音已结束，但未返回音频数据")
                    return
                outer._push_event({"type": "finished"})
                outer._finished_event.set()

            def on_error(self, message) -> None:  # noqa: ANN001
                data = message
                if isinstance(message, str):
                    try:
                        data = json.loads(message)
                    except (TypeError, ValueError):
                        pass
                if isinstance(data, dict):
                    header = data.get("header") or {}
                    code = header.get("error_code") or data.get("code")
                    detail = header.get("error_message") or data.get("message") or data
                    request_id = header.get("task_id") or data.get("request_id")
                    parts = [str(item) for item in (code, detail) if item]
                    if request_id:
                        parts.append(f"request_id={request_id}")
                    outer._fail("; ".join(parts), raw=data)
                else:
                    outer._fail(str(message or "实时语音生成失败"))

            def on_close(self) -> None:
                if not outer._closed and not outer._finished_event.is_set():
                    outer._fail("实时语音连接在生成完成前关闭")
                outer._push_event({"type": "closed"})

        class _Synthesizer(SpeechSynthesizer):
            # SDK 1.25.x 的 WebSocket 错误只打印到 stdout，关闭回调为空。
            # 在这里转成业务事件，同时释放 SDK 的启动和结束等待。
            def on_error(self, ws, error) -> None:  # noqa: ANN001
                outer._fail(f"实时语音连接失败: {error}")
                self.start_event.set()
                self.complete_event.set()

            def on_close(self, ws, close_status_code, close_msg) -> None:  # noqa: ANN001
                if not outer._closed and not outer._finished_event.is_set():
                    detail = str(close_msg or "连接提前关闭")
                    outer._fail(f"实时语音连接关闭（{close_status_code}）: {detail}")
                self.start_event.set()
                self.complete_event.set()

        try:
            dashscope.api_key = self.api_key
            self._client = _Synthesizer(
                model=self.model,
                voice=self.voice_id,
                format=AudioFormat.PCM_24000HZ_MONO_16BIT,
                callback=_Callback(),
                url=self.ws_url,
            )
            # SpeechSynthesizer 在第一段文本到达时建立连接并发起任务。
            self._started_at_monotonic = time.monotonic()
        except Exception as exc:  # noqa: BLE001
            self._fail(f"初始化实时语音失败: {exc}")
            raise RehearsalRealtimeTTSError(self._last_error) from exc

    def append_text(self, text: str) -> None:
        if not self._client or self._closed:
            raise RehearsalRealtimeTTSError("实时语音连接未建立或已关闭")
        if self._last_error:
            raise RehearsalRealtimeTTSError(self._last_error)
        if self._finish_requested:
            raise RehearsalRealtimeTTSError("实时语音文本输入已结束")
        normalized_chunk = self.normalize_markdown_for_tts(str(text or ""))
        if not normalized_chunk:
            return
        try:
            self._input_started = True
            self._client.streaming_call(normalized_chunk)
            if self._last_error:
                raise RehearsalRealtimeTTSError(self._last_error)
        except RehearsalRealtimeTTSError:
            raise
        except Exception as exc:  # noqa: BLE001
            self._fail(f"追加实时语音文本失败: {exc}")
            raise RehearsalRealtimeTTSError(self._last_error) from exc

    def finish(self) -> None:
        if not self._client or self._closed or self._finish_requested:
            return
        self._finish_requested = True
        if self._last_error:
            return
        if not self._input_started:
            self._fail("实时语音未收到可合成文本")
            return
        try:
            # 立即发送 finish-task，音频仍由回调交付给 drain_until_done。
            # 外层按音频进展控制空闲超时；主动 close 会释放 SDK 的等待线程。
            self._client.async_streaming_complete(complete_timeout_millis=0)
        except Exception as exc:  # noqa: BLE001
            self._fail(f"结束实时语音失败: {exc}")
            raise RehearsalRealtimeTTSError(self._last_error) from exc

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
        """Yield audio until done; max_wait_seconds bounds time without audio progress."""
        idle_timeout = max(0.1, float(max_wait_seconds))
        deadline = time.monotonic() + idle_timeout
        while True:
            batch = self.drain_events()
            if any(event.get("type") == "audio_delta" and event.get("delta") for event in batch):
                deadline = time.monotonic() + idle_timeout
            if batch:
                yield from batch
            if self._finished_event.is_set():
                break
            if time.monotonic() >= deadline:
                self._fail(
                    f"实时语音生成超时（连续 {idle_timeout:g} 秒未收到音频进展）"
                )
                break
            time.sleep(max(0.01, float(poll_interval)))

        # 最后再捞一次，确保不丢尾部事件
        tail = self.drain_events()
        if tail:
            yield from tail

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._finished_event.set()
        if self._client:
            # async_streaming_complete 的等待线程需在中断/超时后及时退出。
            self._client.complete_event.set()
            try:
                if self._client.ws is not None:
                    self._client.close()
            except Exception as exc:  # noqa: BLE001
                logger.warning("close realtime tts failed: %s", exc)

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
