import base64
import io
import json
import mimetypes
import re
import urllib.parse
import urllib.request
import uuid
import wave
from django.conf import settings
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.db.models import Count, Q
from django.http import StreamingHttpResponse
from pathlib import Path
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from mdapi.models import (
    CustomUser,
    DoctorAvatarVideo,
    DoctorKnowledge,
    DoctorNarrativeAnnotation,
    DoctorNarrativeKernel,
    DoctorRehearsalFeedback,
    DoctorRehearsalMessage,
    DoctorRehearsalSession,
    DoctorVoiceProfile,
    KnowledgeTag,
    PatientConsultMessage,
    PatientConsultSession,
)
from mdapi.permissions import IsDoctor, IsPatient
from mdapi.serializers import (
    DoctorAvatarVideoSerializer,
    DoctorNarrativeAnnotationSerializer,
    DoctorNarrativeKernelSerializer,
    DoctorKnowledgeIndexSerializer,
    DoctorKnowledgeSerializer,
    DoctorRehearsalFeedbackSerializer,
    DoctorRehearsalMessageSerializer,
    DoctorRehearsalSessionSerializer,
    DoctorVoiceProfileSerializer,
    PatientConsultMessageSerializer,
    PatientConsultSessionSerializer,
    PatientDoctorSerializer,
)
from mdapi.services.digital_human import (
    DigitalHumanConfigurationError,
    DigitalHumanServiceError,
    get_digital_human_service,
)
from mdapi.services.narrative_kernel import (
    DEFAULT_KERNEL_NAME,
    DEFAULT_SCHEMA_VERSION,
    apply_annotation_update,
    apply_negative_rules_update,
    build_default_opening_text,
    build_default_narrative_payload,
    deep_merge_dict,
    remove_negative_rules,
    render_narrative_kernel_dsl,
)
from mdapi.services.asr import (
    QwenASRConfigurationError,
    QwenASRError,
    get_qwen_asr_service,
)
from mdapi.services.knowledge_queue import KnowledgeQueueError, get_knowledge_queue
from mdapi.services.narrative_llm import (
    NarrativeLLMConfigurationError,
    NarrativeLLMError,
    get_narrative_optimizer,
)
from mdapi.services.rehearsal import (
    RehearsalConfigurationError,
    RehearsalServiceError,
    get_rehearsal_service,
)
from mdapi.services.rehearsal_tts import (
    DoctorRehearsalRealtimeTTS,
    RehearsalRealtimeTTSError,
)
from mdapi.services.oss import (
    OSSConfigurationError,
    OSSReadError,
    OSSUploadError,
    extract_object_key_from_url,
    get_oss_client,
)
from mdapi.services.qwen import (
    QwenConfigurationError,
    QwenExtractionError,
    get_qwen_extractor,
)
from mdapi.utils.api_response import APIResponse
from mdapi.utils.pagnition import StandardResultsSetPagination


FIXED_DOCTOR_AVATAR_VIDEO_DURATION_SECONDS = 15
FIXED_DOCTOR_AVATAR_VIDEO_GENERATE_COUNT = 5


def _mark_extract_failed(item: DoctorKnowledge, error_message: str):
    item.extract_status = "failed"
    item.knowledge_status = "failed"
    item.extract_error = error_message
    item.extracted_at = timezone.now()
    item.save(
        update_fields=[
            "extract_status",
            "knowledge_status",
            "extract_error",
            "extracted_at",
            "updated_at",
        ]
    )


def _parse_bool(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "on"}:
        return True
    if text in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _upload_external_video_to_oss(
    *,
    oss_client,
    doctor_id: int,
    video_url: str,
) -> dict:
    try:
        with urllib.request.urlopen(video_url, timeout=90) as response:
            body = response.read()
            content_type = response.headers.get("Content-Type") or "video/mp4"
    except Exception as exc:  # noqa: BLE001
        raise DigitalHumanServiceError(f"下载生成视频失败: {exc}") from exc

    parsed = urllib.parse.urlparse(video_url)
    suffix = Path(parsed.path).suffix or mimetypes.guess_extension(content_type) or ".mp4"
    file_name = f"doctor-avatar-video-{uuid.uuid4().hex}{suffix}"
    video_file = ContentFile(body, name=file_name)
    video_file.content_type = content_type
    return oss_client.upload_file(
        video_file,
        doctor_id=doctor_id,
        prefix="doctor-digital-human/videos",
    )


def _get_or_create_doctor_narrative_kernel(doctor) -> tuple[DoctorNarrativeKernel, bool]:
    payload = build_default_narrative_payload(doctor)
    kernel, created = DoctorNarrativeKernel.objects.get_or_create(
        doctor=doctor,
        defaults={
            "schema_version": DEFAULT_SCHEMA_VERSION,
            "kernel_name": DEFAULT_KERNEL_NAME,
            "revision": 1,
            "payload": payload,
            "compiled_prompt": render_narrative_kernel_dsl(payload),
        },
    )

    if not kernel.payload:
        kernel.payload = payload
        kernel.compiled_prompt = render_narrative_kernel_dsl(payload)
        kernel.revision = max(1, int(kernel.revision or 0))
        kernel.save(update_fields=["payload", "compiled_prompt", "revision", "updated_at"])
    elif not kernel.compiled_prompt:
        kernel.compiled_prompt = render_narrative_kernel_dsl(kernel.payload)
        kernel.save(update_fields=["compiled_prompt", "updated_at"])

    return kernel, created


def _to_sse_event(event: str, data: dict) -> str:
    body = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {body}\n\n"


def _build_video_play_url(
    video: DoctorAvatarVideo | None,
    *,
    oss_client=None,
    expires: int = 1800,
) -> str | None:
    if not video:
        return None
    if not video.video_object_key:
        return video.video_oss_url or None

    try:
        client = oss_client or get_oss_client()
        return client.build_signed_get_url(video.video_object_key, expires=expires)
    except (OSSConfigurationError, OSSReadError):
        return video.video_oss_url or None


def _build_avatar_play_url(
    avatar_url: str | None,
    *,
    required_prefix: str | None = "doctor-digital-human/avatars",
    oss_client=None,
    expires: int | None = None,
) -> str | None:
    raw_url = str(avatar_url or "").strip()
    if not raw_url:
        return None

    object_key = extract_object_key_from_url(
        raw_url,
        required_prefix=required_prefix,
    )
    if not object_key:
        return raw_url

    expire_seconds = int(
        expires
        or getattr(settings, "OSS_AVATAR_SIGNED_URL_EXPIRE_SECONDS", 24 * 60 * 60)
    )
    try:
        client = oss_client or get_oss_client()
        return client.build_signed_get_url(object_key, expires=max(expire_seconds, 60))
    except (OSSConfigurationError, OSSReadError, AttributeError):
        return raw_url


def _resolve_latest_doctor_voice(doctor) -> tuple[str, str, str]:
    latest_voice = (
        DoctorVoiceProfile.objects.filter(doctor=doctor, status="ready")
        .order_by("-created_at", "-updated_at")
        .first()
    )
    if latest_voice:
        return (
            latest_voice.qwen_voice_id,
            latest_voice.target_model
            or getattr(settings, "DIGITAL_HUMAN_TTS_TARGET_MODEL", "qwen3-tts-vc-realtime-2026-01-15"),
            latest_voice.name or "医生最新音色",
        )
    return (
        getattr(settings, "DIGITAL_HUMAN_DEFAULT_VOICE", "longanyang"),
        getattr(settings, "DIGITAL_HUMAN_TTS_TARGET_MODEL", "qwen3-tts-vc-realtime-2026-01-15"),
        "系统默认音色",
    )


def _to_int_or_none(value):
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_opening_payload(payload: dict | None) -> dict:
    if isinstance(payload, dict):
        opening = payload.get("OPENING")
        if isinstance(opening, dict):
            return opening
    return {}


def _build_opening_audio_play_url(
    opening_payload: dict,
    *,
    oss_client=None,
    expires: int = 1800,
) -> str | None:
    object_key = str(opening_payload.get("audio_object_key") or "").strip()
    fallback_url = str(opening_payload.get("audio_oss_url") or "").strip()
    if object_key:
        try:
            client = oss_client or get_oss_client()
            return client.build_signed_get_url(object_key, expires=expires)
        except (OSSConfigurationError, OSSReadError):
            return fallback_url or None
    return fallback_url or None


def _build_doctor_opening_data(
    doctor: CustomUser,
    payload: dict | None,
    *,
    oss_client=None,
    voice_meta: tuple[str, str, str] | None = None,
) -> dict:
    opening_payload = _extract_opening_payload(payload if isinstance(payload, dict) else {})
    default_text = build_default_opening_text(doctor)
    text = str(opening_payload.get("text") or "").strip() or default_text
    voice_id, tts_model, voice_name = voice_meta or _resolve_latest_doctor_voice(doctor)
    resolved_voice_id = str(opening_payload.get("voice_id") or voice_id or "").strip() or None
    resolved_tts_model = str(opening_payload.get("tts_model") or tts_model or "").strip() or None
    resolved_voice_name = str(opening_payload.get("voice_name") or voice_name or "").strip() or None
    return {
        "text": text,
        "default_text": default_text,
        "has_custom_text": text.strip() != default_text.strip(),
        "audio_url": _build_opening_audio_play_url(opening_payload, oss_client=oss_client),
        "audio_oss_url": str(opening_payload.get("audio_oss_url") or "").strip() or None,
        "audio_content_type": str(opening_payload.get("audio_content_type") or "").strip() or None,
        "audio_size_bytes": _to_int_or_none(opening_payload.get("audio_size_bytes")),
        "audio_updated_at": str(opening_payload.get("audio_updated_at") or "").strip() or None,
        "updated_at": str(opening_payload.get("updated_at") or "").strip() or None,
        "voice_id": resolved_voice_id,
        "tts_model": resolved_tts_model,
        "voice_name": resolved_voice_name,
    }


def _pcm16_to_wav_bytes(
    pcm_bytes: bytes,
    *,
    sample_rate: int = 24000,
    channels: int = 1,
) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(max(1, int(channels)))
        wav_file.setsampwidth(2)
        wav_file.setframerate(max(8000, int(sample_rate)))
        wav_file.writeframes(pcm_bytes)
    return output.getvalue()


def _synthesize_doctor_opening_audio_wav(
    *,
    text: str,
    voice_id: str,
    tts_model: str,
) -> dict:
    normalized_text = DoctorRehearsalRealtimeTTS.normalize_markdown_for_tts(text).strip()
    if not normalized_text:
        raise RehearsalRealtimeTTSError("开场白文本为空，无法生成语音")

    tts_bridge = DoctorRehearsalRealtimeTTS(
        api_key=getattr(settings, "DASHSCOPE_API_KEY", ""),
        model=tts_model,
        voice_id=voice_id,
        ws_url=getattr(
            settings,
            "QWEN_TTS_REALTIME_WS_URL",
            "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
        ),
    )

    audio_chunks: list[bytes] = []
    stats: dict = {}
    try:
        tts_bridge.start()
        tts_bridge.append_text(normalized_text)
        tts_bridge.finish()
        for audio_event in tts_bridge.drain_until_done(max_wait_seconds=20.0):
            event_type = str(audio_event.get("type") or "")
            if event_type == "audio_delta":
                delta = str(audio_event.get("delta") or "")
                if not delta:
                    continue
                try:
                    audio_chunks.append(base64.b64decode(delta))
                except Exception:  # noqa: BLE001
                    continue
            elif event_type == "error":
                error_text = str(audio_event.get("message") or "实时语音生成失败")
                raise RehearsalRealtimeTTSError(error_text)
        stats = tts_bridge.get_stats()
    finally:
        tts_bridge.close()

    if stats.get("error"):
        raise RehearsalRealtimeTTSError(str(stats.get("error")))
    if not audio_chunks:
        raise RehearsalRealtimeTTSError("实时语音未返回音频数据")

    pcm_bytes = b"".join(audio_chunks)
    wav_bytes = _pcm16_to_wav_bytes(
        pcm_bytes,
        sample_rate=int(stats.get("sample_rate") or 24000),
        channels=int(stats.get("channels") or 1),
    )
    return {
        "audio_bytes": wav_bytes,
        "content_type": "audio/wav",
        "sample_rate": int(stats.get("sample_rate") or 24000),
        "channels": int(stats.get("channels") or 1),
        "stats": stats,
    }


def _get_available_doctor(doctor_id: int) -> CustomUser | None:
    return (
        CustomUser.objects.filter(
            id=doctor_id,
            is_doctor=True,
            doctor_apply_status="approved",
            is_active=True,
        )
        .order_by("-updated_at")
        .first()
    )


def _build_patient_session_title(question: str, max_chars: int = 24) -> str:
    text = " ".join(str(question or "").split())
    if not text:
        return "问诊会话"
    limit = max(8, int(max_chars))
    if len(text) <= limit:
        return text
    return f"{text[: limit - 1].rstrip()}…"


_PATIENT_STREAM_CANCEL_FLAGS: dict[str, bool] = {}
_PATIENT_ATTACHMENT_CACHE_FALLBACK: dict[str, dict] = {}
_CITATION_TOKEN_PATTERN = re.compile(r"\[(?:\^)?\d{1,3}\]")
_FOOTNOTE_DEFINITION_PATTERN = re.compile(r"^\s*\[\^\d+\]:.*$", re.MULTILINE)


def _patient_stream_cancel_key(message_id: int) -> str:
    return f"mdapi:patient:stream:cancel:{int(message_id)}"


def _mark_patient_stream_cancelled(message_id: int):
    key = _patient_stream_cancel_key(message_id)
    try:
        cache.set(key, "1", timeout=600)
    except Exception:  # noqa: BLE001
        _PATIENT_STREAM_CANCEL_FLAGS[key] = True


def _is_patient_stream_cancelled(message_id: int) -> bool:
    key = _patient_stream_cancel_key(message_id)
    try:
        if cache.get(key):
            return True
    except Exception:  # noqa: BLE001
        pass
    return bool(_PATIENT_STREAM_CANCEL_FLAGS.get(key))


def _clear_patient_stream_cancel_flag(message_id: int):
    key = _patient_stream_cancel_key(message_id)
    try:
        cache.delete(key)
    except Exception:  # noqa: BLE001
        pass
    _PATIENT_STREAM_CANCEL_FLAGS.pop(key, None)


def _strip_non_clickable_footnotes(
    text: str,
    *,
    search_sources: list | None = None,
) -> str:
    content = str(text or "")
    if not content.strip():
        return ""

    if isinstance(search_sources, list) and search_sources:
        return content

    cleaned = _FOOTNOTE_DEFINITION_PATTERN.sub("", content)
    cleaned = _CITATION_TOKEN_PATTERN.sub("", cleaned)

    normalized_lines: list[str] = []
    for line in cleaned.splitlines():
        line_text = line.rstrip()
        if re.fullmatch(r"\s*(?:来源|参考来源|references?)\s*[:：]?\s*", line_text, re.IGNORECASE):
            continue
        normalized_lines.append(line_text)

    cleaned_text = "\n".join(normalized_lines)
    cleaned_text = re.sub(r"[ \t]{2,}", " ", cleaned_text)
    cleaned_text = re.sub(r"\n{3,}", "\n\n", cleaned_text)
    return cleaned_text.strip()


def _patient_attachment_cache_key(patient_id: int, session_id: int, attachment_id: str) -> str:
    return (
        f"mdapi:patient:attachment:{int(patient_id)}:"
        f"{int(session_id)}:{str(attachment_id).strip()}"
    )


def _store_patient_attachment_cache(
    *,
    patient_id: int,
    session_id: int,
    attachment_id: str,
    payload: dict,
    timeout: int,
):
    key = _patient_attachment_cache_key(patient_id, session_id, attachment_id)
    try:
        cache.set(key, payload, timeout=max(int(timeout or 0), 60))
    except Exception:  # noqa: BLE001
        _PATIENT_ATTACHMENT_CACHE_FALLBACK[key] = payload


def _load_patient_attachment_cache(
    *,
    patient_id: int,
    session_id: int,
    attachment_id: str,
) -> dict | None:
    key = _patient_attachment_cache_key(patient_id, session_id, attachment_id)
    payload = None
    try:
        payload = cache.get(key)
    except Exception:  # noqa: BLE001
        payload = None
    if not payload:
        payload = _PATIENT_ATTACHMENT_CACHE_FALLBACK.get(key)
    if isinstance(payload, dict):
        return dict(payload)
    return None


def _parse_patient_attachment_ids(raw_value) -> list[str]:
    if raw_value is None:
        return []

    parsed = raw_value
    if isinstance(raw_value, str):
        text = raw_value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
        except Exception:  # noqa: BLE001
            parsed = [text]

    if not isinstance(parsed, list):
        return []

    values: list[str] = []
    seen = set()
    for item in parsed:
        attachment_id = str(item or "").strip()
        if not attachment_id or attachment_id in seen:
            continue
        seen.add(attachment_id)
        values.append(attachment_id)
    return values[:10]


def _build_patient_attachment_summary_text(attachments: list[dict]) -> str:
    if not attachments:
        return ""
    lines: list[str] = []
    for item in attachments:
        if not isinstance(item, dict):
            continue
        file_name = str(item.get("file_name") or "").strip() or "未命名附件"
        file_kind = str(item.get("file_kind") or "").strip().lower()
        label = "图片" if file_kind == "image" else "文档"
        lines.append(f"- {label}：{file_name}")
    if not lines:
        return ""
    return "\n[附件]\n" + "\n".join(lines)


def _build_patient_attachment_access_url(
    attachment: dict,
    *,
    oss_client=None,
    expires: int = 1800,
) -> str | None:
    object_key = str(attachment.get("object_key") or "").strip()
    fallback_url = str(
        attachment.get("oss_url")
        or attachment.get("file_url")
        or attachment.get("preview_url")
        or ""
    ).strip()
    if not object_key:
        return fallback_url or None

    try:
        client = oss_client or get_oss_client()
        return client.build_signed_get_url(object_key, expires=max(int(expires or 0), 60))
    except (OSSConfigurationError, OSSReadError, AttributeError, ValueError):
        return fallback_url or None


def _hydrate_patient_message_payload_with_attachments(
    message_payload: dict,
    *,
    oss_client=None,
) -> dict:
    if not isinstance(message_payload, dict):
        return message_payload

    meta = message_payload.get("meta")
    if not isinstance(meta, dict):
        return message_payload

    attachments = meta.get("attachments")
    if not isinstance(attachments, list):
        return message_payload

    hydrated_attachments = []
    for item in attachments:
        if not isinstance(item, dict):
            continue
        attachment_data = dict(item)
        file_url = _build_patient_attachment_access_url(
            attachment_data,
            oss_client=oss_client,
        )
        if file_url:
            attachment_data["file_url"] = file_url
            if str(attachment_data.get("file_kind") or "").strip().lower() == "image":
                attachment_data["preview_url"] = file_url
        hydrated_attachments.append(attachment_data)

    hydrated_meta = dict(meta)
    hydrated_meta["attachments"] = hydrated_attachments

    payload = dict(message_payload)
    payload["meta"] = hydrated_meta
    return payload


class DoctorKnowledgeView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        queryset = DoctorKnowledge.objects.filter(doctor=request.user).order_by("-created_at")
        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer = DoctorKnowledgeSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

    def post(self, request):
        files = request.FILES.getlist("files")
        if not files:
            single_file = request.FILES.get("file")
            if single_file:
                files = [single_file]

        if not files:
            return APIResponse.error(message="请至少上传一个文件", code=400)

        upload_config = getattr(
            settings,
            "DOCTOR_KNOWLEDGE_UPLOAD_CONFIG",
            getattr(settings, "FILE_UPLOAD_CONFIG", {}),
        )
        max_batch_count = upload_config.get("MAX_BATCH_COUNT", 10)
        max_file_size = upload_config.get("MAX_FILE_SIZE", 150 * 1024 * 1024)
        image_max_file_size = upload_config.get("IMAGE_MAX_FILE_SIZE", 20 * 1024 * 1024)
        allowed_types = {
            content_type
            for group in upload_config.get("ALLOWED_TYPES", {}).values()
            for content_type in group
        }
        allowed_extensions = {
            ext.lower()
            for group in upload_config.get("ALLOWED_EXTENSIONS", {}).values()
            for ext in group
        }
        image_types = {
            content_type.lower()
            for content_type in upload_config.get("ALLOWED_TYPES", {}).get("images", [])
        }
        image_extensions = {
            ext.lower()
            for ext in upload_config.get("ALLOWED_EXTENSIONS", {}).get("images", [])
        }

        if len(files) > max_batch_count:
            return APIResponse.error(
                message=f"单次最多上传 {max_batch_count} 个文件",
                code=400,
            )

        for upload in files:
            content_type = (upload.content_type or "").lower()
            file_extension = Path(upload.name or "").suffix.lower()

            if upload.size > max_file_size:
                return APIResponse.error(
                    message=f"文件 {upload.name} 超过大小限制（最大 {max_file_size // (1024 * 1024)}MB）",
                    code=400,
                )

            is_image = content_type in image_types or file_extension in image_extensions
            if is_image and upload.size > image_max_file_size:
                return APIResponse.error(
                    message=(
                        f"图片文件 {upload.name} 超过大小限制（最大 "
                        f"{image_max_file_size // (1024 * 1024)}MB）"
                    ),
                    code=400,
                )

            mime_supported = content_type in allowed_types if allowed_types else False
            extension_supported = file_extension in allowed_extensions if allowed_extensions else False
            if (allowed_types or allowed_extensions) and not (
                mime_supported or extension_supported
            ):
                supported_exts = ", ".join(sorted(allowed_extensions))
                return APIResponse.error(
                    message=(
                        f"文件 {upload.name} 类型不支持: {upload.content_type}，"
                        f"支持扩展名: {supported_exts}"
                    ),
                    code=400,
                )

        try:
            oss_client = get_oss_client()
        except OSSConfigurationError as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        qwen_init_error = None
        try:
            extractor = get_qwen_extractor()
        except QwenConfigurationError as exc:
            qwen_init_error = str(exc)
            extractor = None

        queue_init_error = None
        try:
            queue_client = get_knowledge_queue()
        except KnowledgeQueueError as exc:
            queue_init_error = str(exc)
            queue_client = None

        created_items = []
        extract_queued_count = 0
        extract_failed_count = 0
        try:
            for upload in files:
                result = oss_client.upload_file(upload, doctor_id=request.user.id)
                item = DoctorKnowledge.objects.create(
                    doctor=request.user,
                    file_name=upload.name,
                    object_key=result["object_key"],
                    oss_url=result["oss_url"],
                    content_type=result["content_type"],
                    size_bytes=result["size_bytes"],
                    etag=result["etag"],
                    upload_status="uploaded",
                    knowledge_status="pending",
                    extract_status="pending",
                )

                if qwen_init_error:
                    _mark_extract_failed(item, qwen_init_error)
                    extract_failed_count += 1
                    created_items.append(item)
                    continue

                try:
                    qwen_file_id = extractor.upload_file(upload)
                    item.qwen_file_id = qwen_file_id
                    item.extract_status = "queued"
                    item.extract_error = None
                    item.extracted_at = None
                    item.extract_retry_count = 0
                    item.save(
                        update_fields=[
                            "qwen_file_id",
                            "extract_status",
                            "extract_error",
                            "extracted_at",
                            "extract_retry_count",
                            "updated_at",
                        ]
                    )
                except QwenExtractionError as exc:
                    _mark_extract_failed(item, str(exc))
                    extract_failed_count += 1
                    created_items.append(item)
                    continue

                if queue_init_error:
                    _mark_extract_failed(item, queue_init_error)
                    extract_failed_count += 1
                    created_items.append(item)
                    continue

                try:
                    queue_client.enqueue(
                        {
                            "knowledge_id": item.id,
                            "doctor_id": request.user.id,
                            "attempt": 0,
                        }
                    )
                    extract_queued_count += 1
                except KnowledgeQueueError as exc:
                    _mark_extract_failed(item, str(exc))
                    extract_failed_count += 1

                created_items.append(item)
        except OSSUploadError as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        serializer = DoctorKnowledgeSerializer(created_items, many=True)
        message = "上传成功，已加入抽取队列"
        if extract_failed_count:
            message = "上传成功，部分文件知识抽取失败"
        return APIResponse.created(
            data={
                "count": len(created_items),
                "extract_queued_count": extract_queued_count,
                "extract_failed_count": extract_failed_count,
                "items": serializer.data,
            },
            message=message,
        )


class DoctorKnowledgeDetailView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def delete(self, request, knowledge_id):
        item = DoctorKnowledge.objects.filter(id=knowledge_id, doctor=request.user).first()
        if not item:
            return APIResponse.not_found(message="知识库文件不存在")

        item.delete()
        return APIResponse.success(message="删除成功")


class DoctorKnowledgeExtractView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def post(self, request, knowledge_id):
        item = DoctorKnowledge.objects.filter(id=knowledge_id, doctor=request.user).first()
        if not item:
            return APIResponse.not_found(message="知识库文件不存在")

        if not item.qwen_file_id:
            return APIResponse.error(
                message="当前文件暂无 qwen_file_id，请重新上传文件后再试",
                code=400,
            )

        try:
            queue_client = get_knowledge_queue()
            item.extract_status = "queued"
            item.knowledge_status = "pending"
            item.extract_error = None
            item.extracted_at = None
            item.extract_retry_count = 0
            item.save(
                update_fields=[
                    "extract_status",
                    "knowledge_status",
                    "extract_error",
                    "extracted_at",
                    "extract_retry_count",
                    "updated_at",
                ]
            )

            queue_client.enqueue(
                {"knowledge_id": item.id, "doctor_id": request.user.id, "attempt": 0}
            )
        except KnowledgeQueueError as exc:
            _mark_extract_failed(item, str(exc))
            return APIResponse.error(message=str(exc), code=500)

        data = DoctorKnowledgeSerializer(item).data
        return APIResponse.success(data=data, message="已加入抽取队列")


class DoctorKnowledgeTagView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        queryset = (
            KnowledgeTag.objects.filter(
                knowledge_items__doctor=request.user,
                knowledge_items__is_deleted=False,
            )
            .annotate(
                file_count=Count(
                    "knowledge_items",
                    filter=Q(
                        knowledge_items__doctor=request.user,
                        knowledge_items__is_deleted=False,
                    ),
                    distinct=True,
                )
            )
            .order_by("-file_count", "name")
            .distinct()
        )

        data = [
            {
                "id": tag.id,
                "name": tag.name,
                "file_count": tag.file_count,
            }
            for tag in queryset
        ]
        return APIResponse.success(data=data, message="获取成功")


class DoctorKnowledgeIndexView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        queryset = (
            DoctorKnowledge.objects.filter(doctor=request.user)
            .prefetch_related("tags")
            .order_by("-created_at")
        )
        serializer = DoctorKnowledgeIndexSerializer(queryset, many=True)
        return APIResponse.success(data=serializer.data, message="获取成功")


class DoctorDigitalVoiceView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        queryset = DoctorVoiceProfile.objects.filter(doctor=request.user).order_by("-created_at")
        serializer = DoctorVoiceProfileSerializer(queryset, many=True)
        return APIResponse.success(data=serializer.data, message="获取成功")

    def post(self, request):
        audio_file = request.FILES.get("audio")
        if not audio_file:
            return APIResponse.error(message="请上传音频文件（字段名: audio）", code=400)

        voice_config = getattr(settings, "DIGITAL_HUMAN_VOICE_UPLOAD_CONFIG", {})
        max_file_size = int(voice_config.get("MAX_FILE_SIZE", 20 * 1024 * 1024))
        allowed_extensions = {
            ext.lower() for ext in voice_config.get("ALLOWED_EXTENSIONS", [])
        }
        allowed_mime_types = {
            mime.lower() for mime in voice_config.get("ALLOWED_MIME_TYPES", [])
        }

        content_type = (audio_file.content_type or "").lower()
        file_extension = Path(audio_file.name or "").suffix.lower()
        if audio_file.size > max_file_size:
            return APIResponse.error(
                message=f"音频文件超过大小限制（最大 {max_file_size // (1024 * 1024)}MB）",
                code=400,
            )
        if (allowed_extensions or allowed_mime_types) and not (
            file_extension in allowed_extensions or content_type in allowed_mime_types
        ):
            supported = ", ".join(sorted(allowed_extensions))
            return APIResponse.error(
                message=(
                    f"音频类型不支持: {audio_file.content_type}，"
                    f"支持扩展名: {supported}"
                ),
                code=400,
            )

        preferred_name = (request.data.get("preferred_name") or "").strip()
        # DashScope 音色复刻 prefix 限制：仅允许数字、大小写字母和下划线，不超过 10 个字符
        if not preferred_name:
            preferred_name = f"d{request.user.id}{uuid.uuid4().hex[:6]}"
        # 清理非法字符并截断到 10 字符
        import re as _re
        preferred_name = _re.sub(r'[^a-zA-Z0-9_]', '', preferred_name)[:10]
        voice_name = (request.data.get("name") or "").strip() or preferred_name
        target_model = (
            (request.data.get("target_model") or "").strip()
            or getattr(settings, "DIGITAL_HUMAN_TTS_TARGET_MODEL", "qwen3-tts-vc-realtime-2026-01-15")
        )
        set_active = _parse_bool(request.data.get("set_active"), default=True)

        try:
            digital_human = get_digital_human_service()
            oss_client = get_oss_client()
        except (DigitalHumanConfigurationError, OSSConfigurationError) as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        try:
            voice_result = digital_human.create_voice(
                uploaded_file=audio_file,
                preferred_name=preferred_name,
                target_model=target_model,
            )
            if hasattr(audio_file, "seek"):
                audio_file.seek(0)
            upload_result = oss_client.upload_file(
                audio_file,
                doctor_id=request.user.id,
                prefix="doctor-digital-human/voice-samples",
            )
        except (DigitalHumanServiceError, OSSUploadError) as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if set_active:
            DoctorVoiceProfile.objects.filter(doctor=request.user, is_active=True).update(
                is_active=False,
                updated_at=timezone.now(),
            )

        profile = DoctorVoiceProfile.objects.create(
            doctor=request.user,
            name=voice_name,
            preferred_name=preferred_name,
            target_model=target_model,
            qwen_voice_id=voice_result["voice_id"],
            sample_file_name=audio_file.name,
            sample_object_key=upload_result["object_key"],
            sample_oss_url=upload_result["oss_url"],
            sample_content_type=upload_result["content_type"],
            sample_size_bytes=upload_result["size_bytes"],
            sample_etag=upload_result["etag"],
            is_active=set_active,
            status="ready",
        )
        data = DoctorVoiceProfileSerializer(profile).data
        return APIResponse.created(data=data, message="音色创建成功")


class DoctorDigitalAvatarView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        oss_client = None
        try:
            oss_client = get_oss_client()
        except OSSConfigurationError:
            oss_client = None

        return APIResponse.success(
            data={
                "avatar": _build_avatar_play_url(
                    request.user.avatar,
                    oss_client=oss_client,
                ),
            },
            message="获取成功",
        )

    def post(self, request):
        image_file = request.FILES.get("image")
        if not image_file:
            return APIResponse.error(message="请上传头像图片（字段名: image）", code=400)

        avatar_config = getattr(settings, "DIGITAL_HUMAN_AVATAR_UPLOAD_CONFIG", {})
        max_file_size = int(avatar_config.get("MAX_FILE_SIZE", 10 * 1024 * 1024))
        allowed_extensions = {
            ext.lower() for ext in avatar_config.get("ALLOWED_EXTENSIONS", [])
        }
        allowed_mime_types = {
            mime.lower() for mime in avatar_config.get("ALLOWED_MIME_TYPES", [])
        }

        content_type = (image_file.content_type or "").lower()
        file_extension = Path(image_file.name or "").suffix.lower()
        if image_file.size > max_file_size:
            return APIResponse.error(
                message=f"头像图片超过大小限制（最大 {max_file_size // (1024 * 1024)}MB）",
                code=400,
            )
        if (allowed_extensions or allowed_mime_types) and not (
            file_extension in allowed_extensions or content_type in allowed_mime_types
        ):
            supported = ", ".join(sorted(allowed_extensions))
            return APIResponse.error(
                message=f"头像图片格式不支持，支持扩展名: {supported}",
                code=400,
            )
        if not content_type.startswith("image/"):
            return APIResponse.error(message="上传文件不是图片类型", code=400)

        try:
            oss_client = get_oss_client()
            upload_result = oss_client.upload_file(
                image_file,
                doctor_id=request.user.id,
                prefix="doctor-digital-human/avatars",
            )
        except (OSSConfigurationError, OSSUploadError) as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        request.user.avatar = upload_result["oss_url"]
        request.user.save(update_fields=["avatar", "updated_at"])

        signed_avatar_url = _build_avatar_play_url(
            request.user.avatar,
            oss_client=oss_client,
        )
        return APIResponse.success(
            data={
                "avatar": signed_avatar_url,
                "content_type": upload_result.get("content_type"),
                "size_bytes": upload_result.get("size_bytes"),
            },
            message="医生头像上传成功",
        )


class DoctorAvatarVideoView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        queryset = list(
            DoctorAvatarVideo.objects.filter(doctor=request.user).order_by("-created_at")
        )
        serializer = DoctorAvatarVideoSerializer(queryset, many=True)
        data = list(serializer.data)

        oss_client = None
        try:
            oss_client = get_oss_client()
        except OSSConfigurationError:
            oss_client = None

        for idx, item in enumerate(queryset):
            data[idx]["video_play_url"] = _build_video_play_url(
                item,
                oss_client=oss_client,
            )
        return APIResponse.success(data=data, message="获取成功")

    def post(self, request):
        image_file = request.FILES.get("image")
        if not image_file:
            return APIResponse.error(message="请上传首帧图片（字段名: image）", code=400)

        vl_config = getattr(settings, "QWEN_VL_UPLOAD_CONFIG", {})
        image_max_size = int(vl_config.get("IMAGE_MAX_FILE_SIZE", 10 * 1024 * 1024))
        allowed_image_extensions = {
            ext.lower() for ext in vl_config.get("IMAGE_ALLOWED_EXTENSIONS", [])
        }
        content_type = (image_file.content_type or "").lower()
        file_extension = Path(image_file.name or "").suffix.lower()
        if image_file.size > image_max_size:
            return APIResponse.error(
                message=f"图片超过大小限制（最大 {image_max_size // (1024 * 1024)}MB）",
                code=400,
            )
        if allowed_image_extensions and file_extension not in allowed_image_extensions:
            supported = ", ".join(sorted(allowed_image_extensions))
            return APIResponse.error(
                message=f"图片格式不支持，支持扩展名: {supported}",
                code=400,
            )
        if not (
            content_type.startswith("image/")
            or (allowed_image_extensions and file_extension in allowed_image_extensions)
        ):
            return APIResponse.error(message="上传文件不是图片类型", code=400)

        resolution = (request.data.get("resolution") or "").strip() or getattr(
            settings, "DIGITAL_HUMAN_I2V_RESOLUTION", "720P"
        )
        if resolution not in {"720P", "1080P"}:
            return APIResponse.error(message="resolution 仅支持 720P 或 1080P", code=400)

        duration = FIXED_DOCTOR_AVATAR_VIDEO_DURATION_SECONDS

        model = (request.data.get("model") or "").strip() or getattr(
            settings, "DIGITAL_HUMAN_I2V_MODEL", "wan2.6-i2v-flash"
        )
        generate_count = FIXED_DOCTOR_AVATAR_VIDEO_GENERATE_COUNT

        custom_prompt = (request.data.get("prompt") or "").strip()
        custom_negative_prompt = (request.data.get("negative_prompt") or "").strip()
        prompt_extend = _parse_bool(request.data.get("prompt_extend"), default=True)
        watermark = _parse_bool(request.data.get("watermark"), default=True)

        seed = request.data.get("seed")
        if seed in ("", None):
            seed_value = None
        else:
            try:
                seed_value = int(seed)
            except (TypeError, ValueError):
                return APIResponse.error(message="seed 必须是整数", code=400)

        try:
            digital_human = get_digital_human_service()
            oss_client = get_oss_client()
        except (DigitalHumanConfigurationError, OSSConfigurationError) as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        try:
            upload_result = oss_client.upload_file(
                image_file,
                doctor_id=request.user.id,
                prefix="doctor-digital-human/images",
            )
            image_signed_url = oss_client.build_signed_get_url(
                upload_result["object_key"], expires=1800
            )
            prompt_variants = digital_human.build_i2v_prompt_variants(
                custom_prompt=custom_prompt,
                count=generate_count,
            )
            if not prompt_variants:
                return APIResponse.error(
                    message="未配置可用的图生视频提示词模板",
                    code=500,
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
            negative_prompt = digital_human.build_i2v_negative_prompt(
                custom_negative_prompt=custom_negative_prompt
            )
        except (OSSUploadError, OSSReadError, DigitalHumanServiceError) as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        created_items = []
        failed_items = []
        for index, variant in enumerate(prompt_variants):
            scene_key = variant.get("scene_key") or f"scene_{index + 1}"
            scene_name = variant.get("scene_name") or f"场景{index + 1}"
            prompt = variant.get("prompt") or ""
            current_seed = seed_value + index if seed_value is not None else None

            try:
                submit_result = digital_human.submit_image_to_video(
                    img_url=image_signed_url,
                    prompt=prompt,
                    model=model,
                    negative_prompt=negative_prompt,
                    resolution=resolution,
                    duration=duration,
                    prompt_extend=prompt_extend,
                    watermark=watermark,
                    audio_enabled=False,
                    seed=current_seed,
                )
                task_id = submit_result.get("task_id")
                if not task_id:
                    raise DigitalHumanServiceError(
                        "图生视频任务提交成功但未返回 task_id，请稍后重试"
                    )
            except DigitalHumanServiceError as exc:
                failed_items.append(
                    {
                        "scene_key": scene_key,
                        "scene_name": scene_name,
                        "error": str(exc),
                    }
                )
                continue

            item = DoctorAvatarVideo.objects.create(
                doctor=request.user,
                image_file_name=image_file.name,
                image_object_key=upload_result["object_key"],
                image_oss_url=upload_result["oss_url"],
                image_content_type=upload_result["content_type"],
                image_size_bytes=upload_result["size_bytes"],
                image_etag=upload_result["etag"],
                video_model=model,
                scene_key=scene_key,
                scene_name=scene_name,
                prompt=prompt,
                negative_prompt=negative_prompt,
                resolution=resolution,
                duration_seconds=duration,
                prompt_extend=prompt_extend,
                watermark=watermark,
                audio_enabled=False,
                task_request_id=submit_result.get("request_id"),
                task_id=task_id,
                task_status=submit_result.get("task_status", "submitted"),
                video_url_external=submit_result.get("video_url"),
                last_synced_at=timezone.now(),
            )

            video_url = submit_result.get("video_url")
            if item.task_status == "succeeded" and video_url:
                try:
                    video_upload_result = _upload_external_video_to_oss(
                        oss_client=oss_client,
                        doctor_id=request.user.id,
                        video_url=video_url,
                    )
                    parsed_video_url = urllib.parse.urlparse(video_url)
                    item.video_file_name = (
                        Path(parsed_video_url.path).name or f"{item.task_id}.mp4"
                    )
                    item.video_object_key = video_upload_result["object_key"]
                    item.video_oss_url = video_upload_result["oss_url"]
                    item.video_content_type = video_upload_result["content_type"]
                    item.video_size_bytes = video_upload_result["size_bytes"]
                    item.video_etag = video_upload_result["etag"]
                    item.completed_at = timezone.now()
                    item.error_message = None
                    item.save(
                        update_fields=[
                            "video_file_name",
                            "video_object_key",
                            "video_oss_url",
                            "video_content_type",
                            "video_size_bytes",
                            "video_etag",
                            "completed_at",
                            "error_message",
                            "updated_at",
                        ]
                    )
                except DigitalHumanServiceError as exc:
                    item.error_message = str(exc)
                    item.save(update_fields=["error_message", "updated_at"])

            created_items.append(item)

        if not created_items:
            error_message = (
                failed_items[0]["error"]
                if failed_items
                else "图生视频任务创建失败，请稍后重试"
            )
            return APIResponse.error(
                message=error_message,
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        message = (
            "图生视频任务已批量创建"
            if not failed_items
            else "图生视频任务部分创建成功"
        )
        data = list(DoctorAvatarVideoSerializer(created_items, many=True).data)
        for idx, item in enumerate(created_items):
            data[idx]["video_play_url"] = _build_video_play_url(item, oss_client=oss_client)
        return APIResponse.created(
            data={
                "count": len(created_items),
                "failed_count": len(failed_items),
                "items": data,
                "failed_items": failed_items,
            },
            message=message,
        )


class DoctorAvatarVideoRefreshView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def post(self, request, video_id):
        item = DoctorAvatarVideo.objects.filter(id=video_id, doctor=request.user).first()
        if not item:
            return APIResponse.not_found(message="数字人视频任务不存在")

        try:
            digital_human = get_digital_human_service()
            oss_client = get_oss_client()
            fetch_result = digital_human.fetch_video_task(item.task_id)
        except (DigitalHumanConfigurationError, OSSConfigurationError, DigitalHumanServiceError) as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        item.task_request_id = fetch_result.get("request_id") or item.task_request_id
        item.task_status = fetch_result.get("task_status", item.task_status)
        item.video_url_external = fetch_result.get("video_url") or item.video_url_external
        item.last_synced_at = timezone.now()

        if item.task_status == "succeeded":
            item.completed_at = item.completed_at or timezone.now()

        if item.task_status == "succeeded" and item.video_url_external and not item.video_object_key:
            try:
                video_upload_result = _upload_external_video_to_oss(
                    oss_client=oss_client,
                    doctor_id=request.user.id,
                    video_url=item.video_url_external,
                )
                parsed_video_url = urllib.parse.urlparse(item.video_url_external)
                item.video_file_name = Path(parsed_video_url.path).name or f"{item.task_id}.mp4"
                item.video_object_key = video_upload_result["object_key"]
                item.video_oss_url = video_upload_result["oss_url"]
                item.video_content_type = video_upload_result["content_type"]
                item.video_size_bytes = video_upload_result["size_bytes"]
                item.video_etag = video_upload_result["etag"]
                item.error_message = None
            except DigitalHumanServiceError as exc:
                item.error_message = str(exc)

        item.save(
            update_fields=[
                "task_request_id",
                "task_status",
                "video_url_external",
                "video_file_name",
                "video_object_key",
                "video_oss_url",
                "video_content_type",
                "video_size_bytes",
                "video_etag",
                "error_message",
                "completed_at",
                "last_synced_at",
                "updated_at",
            ]
        )
        data = DoctorAvatarVideoSerializer(item).data
        data["video_play_url"] = _build_video_play_url(item, oss_client=oss_client)
        return APIResponse.success(data=data, message="任务状态已刷新")


class DoctorNarrativeKernelView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        kernel, created = _get_or_create_doctor_narrative_kernel(request.user)
        data = DoctorNarrativeKernelSerializer(kernel).data
        message = "已初始化医生叙事底座" if created else "获取成功"
        return APIResponse.success(data=data, message=message)

    def put(self, request):
        payload = request.data.get("payload")
        if not isinstance(payload, dict):
            return APIResponse.error(
                message="payload 必须是对象，格式参考 Narrative Kernel DSL 结构",
                code=400,
            )

        note = (request.data.get("note") or "").strip()
        kernel, _ = _get_or_create_doctor_narrative_kernel(request.user)
        next_revision = max(1, int(kernel.revision or 0)) + 1

        kernel.payload = payload
        kernel.compiled_prompt = render_narrative_kernel_dsl(payload)
        kernel.revision = next_revision
        if note:
            kernel.notes = note
        kernel.save(
            update_fields=[
                "payload",
                "compiled_prompt",
                "revision",
                "notes",
                "updated_at",
            ]
        )
        data = DoctorNarrativeKernelSerializer(kernel).data
        return APIResponse.success(data=data, message="叙事底座已覆盖更新")

    def patch(self, request):
        changes = request.data.get("changes")
        if not isinstance(changes, dict):
            return APIResponse.error(
                message="changes 必须是对象，表示要合并到当前底座的增量字段",
                code=400,
            )

        note = (request.data.get("note") or "").strip()
        kernel, _ = _get_or_create_doctor_narrative_kernel(request.user)
        current_payload = kernel.payload if isinstance(kernel.payload, dict) else {}
        merged_payload = deep_merge_dict(current_payload, changes)
        next_revision = max(1, int(kernel.revision or 0)) + 1

        kernel.payload = merged_payload
        kernel.compiled_prompt = render_narrative_kernel_dsl(merged_payload)
        kernel.revision = next_revision
        if note:
            kernel.notes = note
        kernel.save(
            update_fields=[
                "payload",
                "compiled_prompt",
                "revision",
                "notes",
                "updated_at",
            ]
        )
        data = DoctorNarrativeKernelSerializer(kernel).data
        return APIResponse.success(data=data, message="叙事底座已局部更新")


class DoctorNarrativeOpeningView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        kernel, _ = _get_or_create_doctor_narrative_kernel(request.user)

        oss_client = None
        try:
            oss_client = get_oss_client()
        except OSSConfigurationError:
            oss_client = None

        opening = _build_doctor_opening_data(
            request.user,
            kernel.payload if isinstance(kernel.payload, dict) else {},
            oss_client=oss_client,
        )
        return APIResponse.success(data=opening, message="获取成功")

    def put(self, request):
        text = (request.data.get("text") or "").strip()
        if not text:
            text = build_default_opening_text(request.user)
        if len(text) > 1000:
            return APIResponse.error(message="开场白长度不能超过 1000 字", code=400)

        note = (request.data.get("note") or "").strip()
        kernel, _ = _get_or_create_doctor_narrative_kernel(request.user)
        voice_id, tts_model, voice_name = _resolve_latest_doctor_voice(request.user)

        try:
            oss_client = get_oss_client()
        except OSSConfigurationError as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        try:
            audio_result = _synthesize_doctor_opening_audio_wav(
                text=text,
                voice_id=voice_id,
                tts_model=tts_model,
            )
            timestamp = timezone.now().strftime("%Y%m%d-%H%M%S")
            audio_file = ContentFile(
                audio_result["audio_bytes"],
                name=f"doctor-opening-{timestamp}.wav",
            )
            audio_file.content_type = audio_result["content_type"]
            upload_result = oss_client.upload_file(
                audio_file,
                doctor_id=request.user.id,
                prefix="doctor-digital-human/openings",
            )
        except RehearsalRealtimeTTSError as exc:
            return APIResponse.error(
                message=f"开场白语音生成失败: {exc}",
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        except OSSUploadError as exc:
            return APIResponse.error(
                message=f"开场白语音上传失败: {exc}",
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        payload = kernel.payload if isinstance(kernel.payload, dict) else {}
        opening_payload = _extract_opening_payload(payload)
        next_opening = {
            **opening_payload,
            "text": text,
            "audio_object_key": upload_result["object_key"],
            "audio_oss_url": upload_result["oss_url"],
            "audio_content_type": upload_result["content_type"],
            "audio_size_bytes": upload_result["size_bytes"],
            "audio_etag": upload_result["etag"],
            "audio_updated_at": timezone.now().isoformat(),
            "voice_id": voice_id,
            "voice_name": voice_name,
            "tts_model": tts_model,
            "updated_at": timezone.now().isoformat(),
        }
        merged_payload = {
            **payload,
            "OPENING": next_opening,
        }
        next_revision = max(1, int(kernel.revision or 0)) + 1
        kernel.payload = merged_payload
        kernel.compiled_prompt = render_narrative_kernel_dsl(merged_payload)
        kernel.revision = next_revision
        if note:
            kernel.notes = note
        kernel.save(
            update_fields=[
                "payload",
                "compiled_prompt",
                "revision",
                "notes",
                "updated_at",
            ]
        )

        opening = _build_doctor_opening_data(
            request.user,
            kernel.payload if isinstance(kernel.payload, dict) else {},
            oss_client=oss_client,
            voice_meta=(voice_id, tts_model, voice_name),
        )
        return APIResponse.success(
            data={
                "opening": opening,
                "kernel": DoctorNarrativeKernelSerializer(kernel).data,
            },
            message="开场白已保存并生成语音",
        )


class DoctorNarrativeAnnotationView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        raw_limit = request.query_params.get("limit", 20)
        try:
            limit = int(raw_limit)
        except (TypeError, ValueError):
            limit = 20
        limit = max(1, min(limit, 100))

        queryset = (
            DoctorNarrativeAnnotation.objects.filter(doctor=request.user)
            .order_by("-created_at")[:limit]
        )
        serializer = DoctorNarrativeAnnotationSerializer(queryset, many=True)
        return APIResponse.success(data=serializer.data, message="获取成功")

    def post(self, request):
        comment = (request.data.get("comment") or "").strip()
        if not comment:
            return APIResponse.error(message="comment 不能为空", code=400)

        source = (request.data.get("source") or "rehearsal").strip()
        allowed_sources = {
            choice_value
            for choice_value, _ in DoctorNarrativeAnnotation.SOURCE_CHOICES
        }
        if source not in allowed_sources:
            return APIResponse.error(
                message=f"source 仅支持: {', '.join(sorted(allowed_sources))}",
                code=400,
            )

        question = (request.data.get("question") or "").strip()
        answer = (request.data.get("answer") or "").strip()
        delta_value = request.data.get("delta")
        if delta_value is None:
            delta = {}
        elif isinstance(delta_value, dict):
            delta = delta_value
        else:
            return APIResponse.error(
                message="delta 必须是对象（可选）",
                code=400,
            )

        negative_rules_value = request.data.get("negative_rules")
        if negative_rules_value is None:
            negative_rules = []
        elif isinstance(negative_rules_value, list):
            negative_rules = [str(item).strip() for item in negative_rules_value if str(item).strip()]
        else:
            return APIResponse.error(
                message="negative_rules 必须是字符串数组（可选）",
                code=400,
            )

        kernel, _ = _get_or_create_doctor_narrative_kernel(request.user)
        current_payload = kernel.payload if isinstance(kernel.payload, dict) else {}

        llm_applied = False
        llm_delta = {}
        llm_raw_output = ""
        llm_error = None
        llm_negative_rules: list[str] = []
        combined_delta = delta
        combined_negative_rules = list(negative_rules)

        try:
            optimizer = get_narrative_optimizer()
            llm_result = optimizer.optimize(
                kernel_payload=current_payload,
                question=question,
                answer=answer,
                comment=comment,
                manual_delta=delta,
            )
            llm_raw_output = str(llm_result.get("raw_output", "") or "")
            llm_delta_value = llm_result.get("delta", {})
            if isinstance(llm_delta_value, dict):
                llm_delta = llm_delta_value
            llm_negative_value = llm_result.get("negative_rules", [])
            if isinstance(llm_negative_value, list):
                llm_negative_rules = [
                    str(item).strip() for item in llm_negative_value if str(item).strip()
                ]

            if llm_delta or llm_negative_rules:
                llm_applied = True
                if llm_delta:
                    # 医生手工 delta 优先级高于 LLM 自动抽取
                    combined_delta = deep_merge_dict(llm_delta, combined_delta)
                if llm_negative_rules:
                    combined_negative_rules.extend(llm_negative_rules)
        except (NarrativeLLMConfigurationError, NarrativeLLMError) as exc:
            llm_error = str(exc)
            return APIResponse.error(
                message=f"批注学习失败（必须走大模型抽取）: {llm_error}",
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        updated_payload, applied_delta = apply_annotation_update(
            current_payload,
            comment=comment,
            question=question,
            answer=answer,
            source=source,
            delta=combined_delta,
            negative_rules=combined_negative_rules,
            enable_rule_inference=False,
        )
        next_revision = max(1, int(kernel.revision or 0)) + 1
        kernel.payload = updated_payload
        kernel.compiled_prompt = render_narrative_kernel_dsl(updated_payload)
        kernel.revision = next_revision
        kernel.last_annotation_at = timezone.now()
        kernel.save(
            update_fields=[
                "payload",
                "compiled_prompt",
                "revision",
                "last_annotation_at",
                "updated_at",
            ]
        )

        annotation = DoctorNarrativeAnnotation.objects.create(
            kernel=kernel,
            doctor=request.user,
            source=source,
            question=question,
            answer=answer,
            comment=comment,
            delta=applied_delta,
            llm_applied=llm_applied,
            llm_delta=llm_delta,
            llm_raw_output=llm_raw_output,
            llm_error=llm_error,
            revision_after=next_revision,
        )

        data = {
            "annotation": DoctorNarrativeAnnotationSerializer(annotation).data,
            "kernel": DoctorNarrativeKernelSerializer(kernel).data,
        }
        return APIResponse.created(data=data, message="批注已写回叙事底座")


class DoctorNarrativeRedlineView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    @staticmethod
    def _extract_safety_data(payload: dict) -> dict:
        kernel_data = payload.get("KERNEL", {}) if isinstance(payload, dict) else {}
        safety_data = (
            kernel_data.get("SAFETY_RULES", {}) if isinstance(kernel_data, dict) else {}
        )
        negative_rules = safety_data.get("NEGATIVE_RULES", [])
        bad_examples = safety_data.get("BAD_RESPONSE_EXAMPLES", [])
        if not isinstance(negative_rules, list):
            negative_rules = []
        if not isinstance(bad_examples, list):
            bad_examples = []
        return {
            "negative_rules": negative_rules,
            "bad_response_examples": bad_examples,
        }

    def get(self, request):
        kernel, _ = _get_or_create_doctor_narrative_kernel(request.user)
        safety_data = self._extract_safety_data(kernel.payload)
        data = {
            "revision": kernel.revision,
            "negative_rules": safety_data["negative_rules"],
            "bad_response_examples": safety_data["bad_response_examples"],
        }
        return APIResponse.success(data=data, message="获取成功")

    def post(self, request):
        rules_value = request.data.get("rules")
        if not isinstance(rules_value, list):
            return APIResponse.error(message="rules 必须是字符串数组", code=400)
        rules = [str(item).strip() for item in rules_value if str(item).strip()]
        if not rules:
            return APIResponse.error(message="rules 不能为空", code=400)

        comment = (request.data.get("comment") or "").strip() or (
            "新增红线规则：" + "；".join(rules)
        )

        kernel, _ = _get_or_create_doctor_narrative_kernel(request.user)
        current_payload = kernel.payload if isinstance(kernel.payload, dict) else {}
        updated_payload, applied_delta, added_rules = apply_negative_rules_update(
            current_payload,
            rules,
        )
        if not added_rules:
            safety_data = self._extract_safety_data(updated_payload)
            data = {
                "added_rules": [],
                "revision": kernel.revision,
                "negative_rules": safety_data["negative_rules"],
            }
            return APIResponse.success(data=data, message="规则已存在，无需重复添加")

        next_revision = max(1, int(kernel.revision or 0)) + 1
        kernel.payload = updated_payload
        kernel.compiled_prompt = render_narrative_kernel_dsl(updated_payload)
        kernel.revision = next_revision
        kernel.last_annotation_at = timezone.now()
        kernel.save(
            update_fields=[
                "payload",
                "compiled_prompt",
                "revision",
                "last_annotation_at",
                "updated_at",
            ]
        )

        annotation = DoctorNarrativeAnnotation.objects.create(
            kernel=kernel,
            doctor=request.user,
            source="manual",
            question="",
            answer="",
            comment=comment,
            delta=applied_delta,
            revision_after=next_revision,
        )

        safety_data = self._extract_safety_data(updated_payload)
        data = {
            "added_rules": added_rules,
            "revision": next_revision,
            "negative_rules": safety_data["negative_rules"],
            "annotation": DoctorNarrativeAnnotationSerializer(annotation).data,
        }
        return APIResponse.created(data=data, message="红线规则已添加")

    def delete(self, request):
        rules_value = request.data.get("rules")
        if not isinstance(rules_value, list):
            return APIResponse.error(message="rules 必须是字符串数组", code=400)
        rules = [str(item).strip() for item in rules_value if str(item).strip()]
        if not rules:
            return APIResponse.error(message="rules 不能为空", code=400)

        kernel, _ = _get_or_create_doctor_narrative_kernel(request.user)
        current_payload = kernel.payload if isinstance(kernel.payload, dict) else {}
        updated_payload, applied_delta, removed_rules = remove_negative_rules(
            current_payload,
            rules,
        )
        if not removed_rules:
            safety_data = self._extract_safety_data(updated_payload)
            data = {
                "removed_rules": [],
                "revision": kernel.revision,
                "negative_rules": safety_data["negative_rules"],
            }
            return APIResponse.success(data=data, message="未匹配到可删除规则")

        next_revision = max(1, int(kernel.revision or 0)) + 1
        kernel.payload = updated_payload
        kernel.compiled_prompt = render_narrative_kernel_dsl(updated_payload)
        kernel.revision = next_revision
        kernel.last_annotation_at = timezone.now()
        kernel.save(
            update_fields=[
                "payload",
                "compiled_prompt",
                "revision",
                "last_annotation_at",
                "updated_at",
            ]
        )

        annotation = DoctorNarrativeAnnotation.objects.create(
            kernel=kernel,
            doctor=request.user,
            source="manual",
            question="",
            answer="",
            comment="移除红线规则：" + "；".join(removed_rules),
            delta=applied_delta,
            revision_after=next_revision,
        )

        safety_data = self._extract_safety_data(updated_payload)
        data = {
            "removed_rules": removed_rules,
            "revision": next_revision,
            "negative_rules": safety_data["negative_rules"],
            "annotation": DoctorNarrativeAnnotationSerializer(annotation).data,
        }
        return APIResponse.success(data=data, message="红线规则已删除")


class DoctorRehearsalSessionView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        queryset = DoctorRehearsalSession.objects.filter(doctor=request.user).order_by(
            "-last_message_at", "-updated_at"
        )
        serializer = DoctorRehearsalSessionSerializer(queryset, many=True)
        return APIResponse.success(data=serializer.data, message="获取成功")

    def post(self, request):
        title = (request.data.get("title") or "").strip()
        if not title:
            title = f"问诊演练-{timezone.now().strftime('%Y%m%d-%H%M%S')}"
        item = DoctorRehearsalSession.objects.create(
            doctor=request.user,
            title=title,
            status="active",
        )
        data = DoctorRehearsalSessionSerializer(item).data
        return APIResponse.created(data=data, message="演练会话已创建")


class DoctorRehearsalMessageView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request, session_id):
        session = DoctorRehearsalSession.objects.filter(
            id=session_id, doctor=request.user
        ).first()
        if not session:
            return APIResponse.not_found(message="演练会话不存在")

        raw_limit = request.query_params.get("limit", 100)
        try:
            limit = int(raw_limit)
        except (TypeError, ValueError):
            limit = 100
        limit = max(1, min(limit, 300))

        queryset = list(
            DoctorRehearsalMessage.objects.filter(session=session)
            .order_by("-created_at")[:limit]
        )
        queryset.reverse()
        serializer = DoctorRehearsalMessageSerializer(queryset, many=True)
        return APIResponse.success(
            data={
                "session": DoctorRehearsalSessionSerializer(session).data,
                "messages": serializer.data,
            },
            message="获取成功",
        )


class DoctorRehearsalAskStreamView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def _build_history(self, session, exclude_message_id: int, history_limit: int) -> list[dict[str, str]]:
        history_queryset = (
            DoctorRehearsalMessage.objects.filter(session=session)
            .exclude(id=exclude_message_id)
            .order_by("-created_at")[:history_limit]
        )
        history_messages = []
        for item in reversed(list(history_queryset)):
            history_messages.append(
                {
                    "role": "assistant" if item.role == "assistant" else "user",
                    "content": item.content or "",
                }
            )
        return history_messages

    def post(self, request, session_id):
        session = DoctorRehearsalSession.objects.filter(
            id=session_id, doctor=request.user
        ).first()
        if not session:
            return APIResponse.not_found(message="演练会话不存在")

        question = (request.data.get("question") or "").strip()
        if not question:
            return APIResponse.error(message="question 不能为空", code=400)

        forced_search_value = request.data.get("forced_search")
        forced_search = None
        if forced_search_value is not None:
            forced_search = _parse_bool(forced_search_value, default=True)
        enable_audio = _parse_bool(request.data.get("enable_audio"), default=False)

        try:
            rehearsal = get_rehearsal_service()
        except RehearsalConfigurationError as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        turn_index = (
            DoctorRehearsalMessage.objects.filter(session=session).count() // 2
        ) + 1
        user_msg = DoctorRehearsalMessage.objects.create(
            session=session,
            doctor=request.user,
            role="user",
            turn_index=turn_index,
            generation_status="succeeded",
            content=question,
            content_markdown=question,
            model_name=None,
        )

        assistant_msg = DoctorRehearsalMessage.objects.create(
            session=session,
            doctor=request.user,
            role="assistant",
            turn_index=turn_index,
            generation_status="generating",
            reply_to=user_msg,
            content="[生成中]",
            content_markdown="[生成中]",
            model_name=rehearsal.answer_model,
        )

        session.last_message_at = timezone.now()
        session.save(update_fields=["last_message_at", "updated_at"])

        kernel, _ = _get_or_create_doctor_narrative_kernel(request.user)
        knowledge_queryset = (
            DoctorKnowledge.objects.filter(
                doctor=request.user,
                extract_status="success",
            )
            .exclude(qwen_file_id__isnull=True)
            .exclude(qwen_file_id="")
            .prefetch_related("tags")
            .order_by("-updated_at")
        )
        candidates = rehearsal.build_ranked_candidates(question, knowledge_queryset)

        try:
            selected = rehearsal.select_file_ids_with_qwen_max(
                question=question,
                candidates=candidates,
            )
            selected_file_ids = selected["selected_file_ids"]
            selected_meta_map = {item["file_id"]: item for item in candidates}
            selected_meta = [
                selected_meta_map[file_id]
                for file_id in selected_file_ids
                if file_id in selected_meta_map
            ]
            if selected_file_ids:
                grounding_result = rehearsal.build_long_grounding_answer(
                    question=question,
                    selected_file_ids=selected_file_ids,
                )
            else:
                grounding_result = {"answer": "", "sources": []}
        except RehearsalServiceError as exc:
            assistant_msg.generation_status = "failed"
            assistant_msg.error_message = str(exc)
            assistant_msg.save(
                update_fields=["generation_status", "error_message", "updated_at"]
            )
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        history_messages = self._build_history(
            session=session,
            exclude_message_id=user_msg.id,
            history_limit=rehearsal.history_limit,
        )
        final_messages = rehearsal.build_final_messages(
            narrative_kernel_prompt=kernel.compiled_prompt,
            grounding_answer=grounding_result["answer"],
            history_messages=history_messages,
            question=question,
        )
        if attachment_grounding_inputs:
            final_messages.insert(
                1,
                {
                    "role": "system",
                    "content": (
                        "输出限制：不要出现内部标识（如 PATIENT_IMAGE_NOTES、"
                        "PATIENT_DOCUMENT_NOTES、KNOWLEDGE、SOURCES、fileid://）。"
                        "不要在正文追加“来源/出处”段落；联网来源由前端单独展示。"
                    ),
                },
            )

        def event_stream():
            full_content = ""
            usage_data = {}
            search_sources = []
            audio_status = "disabled"
            audio_error = ""
            voice_id = ""
            tts_model = ""
            voice_name = ""
            tts_bridge: DoctorRehearsalRealtimeTTS | None = None
            audio_stats = {
                "audio_format": "pcm16",
                "sample_rate": 24000,
                "channels": 1,
                "first_audio_delay_ms": None,
                "audio_chunk_count": 0,
                "audio_base64_chars": 0,
                "error": "",
            }
            tts_error_emitted = False

            if enable_audio:
                voice_id, tts_model, voice_name = _resolve_latest_doctor_voice(request.user)
                try:
                    tts_bridge = DoctorRehearsalRealtimeTTS(
                        api_key=getattr(settings, "DASHSCOPE_API_KEY", ""),
                        model=tts_model,
                        voice_id=voice_id,
                        ws_url=getattr(
                            settings,
                            "QWEN_TTS_REALTIME_WS_URL",
                            "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
                        ),
                    )
                    tts_bridge.start()
                    audio_status = "streaming"
                except RehearsalRealtimeTTSError as exc:
                    audio_status = "failed"
                    audio_error = str(exc)
                    tts_bridge = None

            yield _to_sse_event(
                "start",
                {
                    "session_id": session.id,
                    "question_message_id": user_msg.id,
                    "answer_message_id": assistant_msg.id,
                    "selected_file_ids": selected_file_ids,
                    "selected_file_meta": selected_meta,
                    "grounding_sources": grounding_result["sources"],
                    "audio": {
                        "enabled": enable_audio,
                        "status": audio_status,
                        "voice_id": voice_id or None,
                        "voice_name": voice_name or None,
                        "tts_model": tts_model or None,
                        "audio_format": "pcm16",
                        "sample_rate": 24000,
                        "channels": 1,
                    },
                },
            )
            if audio_error:
                yield _to_sse_event(
                    "audio_error",
                    {
                        "message_id": assistant_msg.id,
                        "message": audio_error,
                    },
                )
                tts_error_emitted = True

            try:
                for event in rehearsal.stream_final_answer(
                    messages=final_messages,
                    forced_search=forced_search,
                ):
                    if event.get("type") == "delta":
                        delta = str(event.get("delta", "") or "")
                        if delta:
                            full_content += delta
                            yield _to_sse_event(
                                "delta",
                                {"message_id": assistant_msg.id, "delta": delta},
                            )
                            if tts_bridge:
                                try:
                                    tts_bridge.append_text(delta)
                                except RehearsalRealtimeTTSError as exc:
                                    audio_status = "failed"
                                    audio_error = str(exc)
                                    if not tts_error_emitted:
                                        yield _to_sse_event(
                                            "audio_error",
                                            {
                                                "message_id": assistant_msg.id,
                                                "message": audio_error,
                                            },
                                        )
                                        tts_error_emitted = True
                                    tts_bridge.close()
                                    tts_bridge = None

                            if tts_bridge:
                                for audio_event in tts_bridge.drain_events():
                                    if audio_event.get("type") == "audio_delta":
                                        yield _to_sse_event(
                                            "audio_delta",
                                            {
                                                "message_id": assistant_msg.id,
                                                "audio_format": "pcm16",
                                                "sample_rate": 24000,
                                                "channels": 1,
                                                "delta": audio_event.get("delta", ""),
                                            },
                                        )
                                    elif audio_event.get("type") == "error":
                                        audio_status = "failed"
                                        audio_error = str(
                                            audio_event.get("message") or "realtime tts error"
                                        )
                                        if not tts_error_emitted:
                                            yield _to_sse_event(
                                                "audio_error",
                                                {
                                                    "message_id": assistant_msg.id,
                                                    "message": audio_error,
                                                },
                                            )
                                            tts_error_emitted = True
                    elif event.get("type") == "done":
                        full_content = str(event.get("content", full_content) or "")
                        usage_data = event.get("usage", {}) or {}
                        search_sources = event.get("search_sources", []) or []
            except RehearsalServiceError as exc:
                if tts_bridge:
                    try:
                        tts_bridge.close()
                    except Exception:  # noqa: BLE001
                        pass
                    audio_stats = tts_bridge.get_stats()
                    if audio_stats.get("error"):
                        audio_error = str(audio_stats.get("error"))
                        audio_status = "failed"
                elif enable_audio and audio_status != "failed":
                    audio_status = "stopped"
                assistant_msg.generation_status = "failed"
                assistant_msg.error_message = str(exc)
                assistant_msg.selected_file_ids = selected_file_ids
                assistant_msg.selected_file_meta = selected_meta
                assistant_msg.grounding_answer = grounding_result["answer"]
                assistant_msg.grounding_sources = grounding_result["sources"]
                assistant_msg.meta = {
                    "selector_reason": selected.get("reason", ""),
                    "audio": {
                        "enabled": enable_audio,
                        "status": audio_status,
                        "voice_id": voice_id or None,
                        "voice_name": voice_name or None,
                        "tts_model": tts_model or None,
                        "error": audio_error or None,
                        **audio_stats,
                    },
                }
                assistant_msg.save(
                    update_fields=[
                        "generation_status",
                        "error_message",
                        "selected_file_ids",
                        "selected_file_meta",
                        "grounding_answer",
                        "grounding_sources",
                        "meta",
                        "updated_at",
                    ]
                )
                yield _to_sse_event(
                    "error",
                    {"message": str(exc), "message_id": assistant_msg.id},
                )
                _clear_patient_stream_cancel_flag(assistant_msg.id)
                return

            if tts_bridge:
                try:
                    tts_bridge.finish()
                except RehearsalRealtimeTTSError as exc:
                    audio_status = "failed"
                    audio_error = str(exc)
                    if not tts_error_emitted:
                        yield _to_sse_event(
                            "audio_error",
                            {
                                "message_id": assistant_msg.id,
                                "message": audio_error,
                            },
                        )
                        tts_error_emitted = True

                for audio_event in tts_bridge.drain_until_done(max_wait_seconds=15.0):
                    if audio_event.get("type") == "audio_delta":
                        yield _to_sse_event(
                            "audio_delta",
                            {
                                "message_id": assistant_msg.id,
                                "audio_format": "pcm16",
                                "sample_rate": 24000,
                                "channels": 1,
                                "delta": audio_event.get("delta", ""),
                            },
                        )
                    elif audio_event.get("type") == "error":
                        audio_status = "failed"
                        audio_error = str(audio_event.get("message") or "realtime tts error")
                        if not tts_error_emitted:
                            yield _to_sse_event(
                                "audio_error",
                                {
                                    "message_id": assistant_msg.id,
                                    "message": audio_error,
                                },
                            )
                            tts_error_emitted = True
                audio_stats = tts_bridge.get_stats()
                if audio_stats.get("error"):
                    audio_status = "failed"
                    if not audio_error:
                        audio_error = str(audio_stats.get("error"))
                elif audio_status == "streaming":
                    audio_status = "succeeded"
                tts_bridge.close()
            elif enable_audio and audio_status != "failed":
                audio_status = "disabled"

            assistant_msg.generation_status = "succeeded"
            assistant_msg.content = full_content
            assistant_msg.content_markdown = full_content
            assistant_msg.model_name = rehearsal.answer_model
            assistant_msg.selected_file_ids = selected_file_ids
            assistant_msg.selected_file_meta = selected_meta
            assistant_msg.grounding_answer = grounding_result["answer"]
            assistant_msg.grounding_sources = grounding_result["sources"]
            assistant_msg.search_sources = search_sources
            assistant_msg.input_tokens = usage_data.get("input_tokens")
            assistant_msg.output_tokens = usage_data.get("output_tokens")
            assistant_msg.total_tokens = usage_data.get("total_tokens")
            assistant_msg.meta = {
                "selector_reason": selected.get("reason", ""),
                "audio": {
                    "enabled": enable_audio,
                    "status": audio_status,
                    "voice_id": voice_id or None,
                    "voice_name": voice_name or None,
                    "tts_model": tts_model or None,
                    "error": audio_error or None,
                    **audio_stats,
                },
            }
            assistant_msg.error_message = None
            assistant_msg.save(
                update_fields=[
                    "generation_status",
                    "content",
                    "content_markdown",
                    "model_name",
                    "selected_file_ids",
                    "selected_file_meta",
                    "grounding_answer",
                    "grounding_sources",
                    "search_sources",
                    "input_tokens",
                    "output_tokens",
                    "total_tokens",
                    "meta",
                    "error_message",
                    "updated_at",
                ]
            )
            session.last_message_at = timezone.now()
            session.save(update_fields=["last_message_at", "updated_at"])

            yield _to_sse_event(
                "done",
                {
                    "message_id": assistant_msg.id,
                    "usage": usage_data,
                    "search_sources": search_sources,
                    "selected_file_ids": selected_file_ids,
                    "audio": {
                        "enabled": enable_audio,
                        "status": audio_status,
                        "voice_id": voice_id or None,
                        "voice_name": voice_name or None,
                        "tts_model": tts_model or None,
                        "error": audio_error or None,
                        **audio_stats,
                    },
                },
            )

        response = StreamingHttpResponse(
            event_stream(),
            content_type="text/event-stream",
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


class DoctorRehearsalPlaybackAssetsView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request):
        voice_id, tts_model, voice_name = _resolve_latest_doctor_voice(request.user)
        video_queryset = list(
            DoctorAvatarVideo.objects.filter(
                doctor=request.user,
                task_status="succeeded",
            )
            .exclude(video_oss_url__isnull=True)
            .exclude(video_oss_url="")
            .order_by("-updated_at")
        )

        oss_client = None
        try:
            oss_client = get_oss_client()
        except OSSConfigurationError:
            oss_client = None

        videos = []
        for video in video_queryset:
            videos.append(
                {
                    "video_id": video.id,
                    "scene_key": video.scene_key,
                    "scene_name": video.scene_name,
                    "video_url": _build_video_play_url(video, oss_client=oss_client),
                    "video_oss_url": video.video_oss_url,
                }
            )
        video_urls = [
            item["video_url"]
            for item in videos
            if item.get("video_url")
        ]

        data = {
            "tts_model": tts_model,
            "voice_id": voice_id,
            "voice_name": voice_name,
            "video_urls": video_urls,
            "videos": videos,
            "video_message": "后端返回全部可播放链接，前端自行随机与循环播放",
        }
        return APIResponse.success(data=data, message="获取成功")


class DoctorRehearsalMessageMarkdownView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def patch(self, request, message_id):
        message = DoctorRehearsalMessage.objects.filter(
            id=message_id,
            doctor=request.user,
            role="assistant",
        ).first()
        if not message:
            return APIResponse.not_found(message="演练回答消息不存在")

        markdown = request.data.get("markdown")
        if not isinstance(markdown, str):
            return APIResponse.error(message="markdown 必须是字符串", code=400)
        markdown = markdown.strip()
        if not markdown:
            return APIResponse.error(message="markdown 不能为空", code=400)

        message.edited_markdown = markdown
        message.edited_at = timezone.now()
        message.save(update_fields=["edited_markdown", "edited_at", "updated_at"])

        feedback, _ = DoctorRehearsalFeedback.objects.get_or_create(
            message=message,
            defaults={"doctor": request.user},
        )
        feedback.edited_markdown = markdown
        feedback.status = "saved"
        feedback.error_message = None
        feedback.save(update_fields=["edited_markdown", "status", "error_message", "updated_at"])

        return APIResponse.success(
            data={
                "message": DoctorRehearsalMessageSerializer(message).data,
                "feedback": DoctorRehearsalFeedbackSerializer(feedback).data,
            },
            message="Markdown 已保存",
        )


class DoctorRehearsalMessageFeedbackView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def post(self, request, message_id):
        message = DoctorRehearsalMessage.objects.filter(
            id=message_id,
            doctor=request.user,
            role="assistant",
        ).first()
        if not message:
            return APIResponse.not_found(message="演练回答消息不存在")

        comment = (request.data.get("comment") or "").strip()
        if not comment:
            return APIResponse.error(message="comment 不能为空", code=400)

        apply_to_kernel = _parse_bool(request.data.get("apply_to_kernel"), default=True)
        edited_markdown = request.data.get("edited_markdown")
        if edited_markdown is not None and not isinstance(edited_markdown, str):
            return APIResponse.error(message="edited_markdown 必须是字符串", code=400)
        edited_markdown = (edited_markdown or "").strip() or message.edited_markdown or ""

        feedback, _ = DoctorRehearsalFeedback.objects.get_or_create(
            message=message,
            defaults={"doctor": request.user},
        )
        feedback.comment = comment
        feedback.edited_markdown = edited_markdown
        feedback.apply_to_kernel = apply_to_kernel
        feedback.status = "saved"
        feedback.error_message = None
        feedback.save(
            update_fields=[
                "comment",
                "edited_markdown",
                "apply_to_kernel",
                "status",
                "error_message",
                "updated_at",
            ]
        )

        if not apply_to_kernel:
            return APIResponse.success(
                data=DoctorRehearsalFeedbackSerializer(feedback).data,
                message="批复已保存（未写入底座）",
            )

        question_text = message.reply_to.content if message.reply_to else ""
        answer_text = edited_markdown or message.content
        kernel, _ = _get_or_create_doctor_narrative_kernel(request.user)
        current_payload = kernel.payload if isinstance(kernel.payload, dict) else {}

        try:
            optimizer = get_narrative_optimizer()
            llm_result = optimizer.optimize(
                kernel_payload=current_payload,
                question=question_text,
                answer=answer_text,
                comment=comment,
                manual_delta={},
            )
        except (NarrativeLLMConfigurationError, NarrativeLLMError) as exc:
            feedback.status = "failed"
            feedback.error_message = str(exc)
            feedback.save(update_fields=["status", "error_message", "updated_at"])
            return APIResponse.error(
                message=f"批复学习失败（必须走大模型抽取）: {exc}",
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        llm_delta = llm_result.get("delta", {})
        if not isinstance(llm_delta, dict):
            llm_delta = {}
        llm_negative_rules = llm_result.get("negative_rules", [])
        if not isinstance(llm_negative_rules, list):
            llm_negative_rules = []

        updated_payload, applied_delta = apply_annotation_update(
            current_payload,
            comment=comment,
            question=question_text,
            answer=answer_text,
            source="rehearsal",
            delta=llm_delta,
            negative_rules=llm_negative_rules,
            enable_rule_inference=False,
        )
        next_revision = max(1, int(kernel.revision or 0)) + 1
        kernel.payload = updated_payload
        kernel.compiled_prompt = render_narrative_kernel_dsl(updated_payload)
        kernel.revision = next_revision
        kernel.last_annotation_at = timezone.now()
        kernel.save(
            update_fields=[
                "payload",
                "compiled_prompt",
                "revision",
                "last_annotation_at",
                "updated_at",
            ]
        )

        annotation = DoctorNarrativeAnnotation.objects.create(
            kernel=kernel,
            doctor=request.user,
            source="rehearsal",
            question=question_text,
            answer=answer_text,
            comment=comment,
            delta=applied_delta,
            llm_applied=True,
            llm_delta=llm_delta,
            llm_raw_output=str(llm_result.get("raw_output", "") or ""),
            llm_error=None,
            revision_after=next_revision,
        )

        feedback.status = "applied"
        feedback.narrative_annotation = annotation
        feedback.error_message = None
        feedback.save(
            update_fields=[
                "status",
                "narrative_annotation",
                "error_message",
                "updated_at",
            ]
        )

        return APIResponse.success(
            data={
                "feedback": DoctorRehearsalFeedbackSerializer(feedback).data,
                "annotation": DoctorNarrativeAnnotationSerializer(annotation).data,
                "kernel": DoctorNarrativeKernelSerializer(kernel).data,
            },
            message="批复已学习并写入叙事底座",
        )


class DoctorPatientConsultTreeView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    @staticmethod
    def _serialize_patient(patient: CustomUser, *, oss_client=None) -> dict:
        return {
            "id": patient.id,
            "username": patient.username,
            "nickname": patient.nickname,
            "avatar": _build_avatar_play_url(
                patient.avatar,
                required_prefix="patient-avatars",
                oss_client=oss_client,
            ),
        }

    def get(self, request):
        try:
            oss_client = get_oss_client()
        except OSSConfigurationError:
            oss_client = None

        queryset = (
            PatientConsultSession.objects.filter(doctor=request.user)
            .select_related("patient")
            .annotate(
                pending_count=Count(
                    "messages",
                    filter=Q(
                        messages__role="assistant",
                        messages__review_status="pending",
                    ),
                ),
                total_message_count=Count("messages"),
            )
            .order_by("-is_pinned", "-pinned_at", "-last_message_at", "-updated_at")
        )

        patient_tree: dict[int, dict] = {}
        total_pending_count = 0
        session_count = 0

        for session in queryset:
            session_count += 1
            pending_count = int(getattr(session, "pending_count", 0) or 0)
            total_pending_count += pending_count

            patient_id = session.patient_id
            if patient_id not in patient_tree:
                patient_tree[patient_id] = {
                    "patient": self._serialize_patient(
                        session.patient,
                        oss_client=oss_client,
                    ),
                    "pending_count": 0,
                    "session_count": 0,
                    "sessions": [],
                }

            patient_node = patient_tree[patient_id]
            patient_node["pending_count"] += pending_count
            patient_node["session_count"] += 1
            patient_node["sessions"].append(
                {
                    "id": session.id,
                    "title": session.title,
                    "status": session.status,
                    "is_pinned": session.is_pinned,
                    "pinned_at": session.pinned_at,
                    "summary": session.summary,
                    "last_message_at": session.last_message_at,
                    "created_at": session.created_at,
                    "updated_at": session.updated_at,
                    "pending_count": pending_count,
                    "total_message_count": int(
                        getattr(session, "total_message_count", 0) or 0
                    ),
                }
            )

        return APIResponse.success(
            data={
                "patients": list(patient_tree.values()),
                "session_count": session_count,
                "pending_count": total_pending_count,
            },
            message="获取成功",
        )


class DoctorPatientConsultSessionMessagesView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    def get(self, request, session_id):
        try:
            oss_client = get_oss_client()
        except OSSConfigurationError:
            oss_client = None

        session = (
            PatientConsultSession.objects.filter(
                id=session_id,
                doctor=request.user,
            )
            .select_related("patient")
            .first()
        )
        if not session:
            return APIResponse.not_found(message="问诊会话不存在")

        raw_limit = request.query_params.get("limit", 100)
        try:
            limit = int(raw_limit)
        except (TypeError, ValueError):
            limit = 100
        limit = max(1, min(limit, 300))

        queryset = list(
            PatientConsultMessage.objects.filter(session=session)
            .order_by("-created_at")[:limit]
        )
        queryset.reverse()

        stats = PatientConsultMessage.objects.filter(
            session=session,
            role="assistant",
        ).aggregate(
            pending=Count("id", filter=Q(review_status="pending")),
            approved=Count("id", filter=Q(review_status="approved")),
            approved_edited=Count("id", filter=Q(review_status="approved_edited")),
            rejected=Count("id", filter=Q(review_status="rejected")),
        )
        messages_data = PatientConsultMessageSerializer(queryset, many=True).data
        messages_data = [
            _hydrate_patient_message_payload_with_attachments(
                item,
                oss_client=oss_client,
            )
            for item in messages_data
        ]

        return APIResponse.success(
            data={
                "session": {
                    "id": session.id,
                    "title": session.title,
                    "status": session.status,
                    "is_pinned": session.is_pinned,
                    "pinned_at": session.pinned_at,
                    "summary": session.summary,
                    "last_message_at": session.last_message_at,
                    "created_at": session.created_at,
                    "updated_at": session.updated_at,
                },
                "patient": {
                    "id": session.patient.id,
                    "username": session.patient.username,
                    "nickname": session.patient.nickname,
                    "avatar": _build_avatar_play_url(
                        session.patient.avatar,
                        required_prefix="patient-avatars",
                        oss_client=oss_client,
                    ),
                },
                "messages": messages_data,
                "stats": {
                    "pending": int(stats.get("pending") or 0),
                    "approved": int(stats.get("approved") or 0),
                    "approved_edited": int(stats.get("approved_edited") or 0),
                    "rejected": int(stats.get("rejected") or 0),
                },
            },
            message="获取成功",
        )


class DoctorPatientConsultMessageReviewView(APIView):
    permission_classes = [IsAuthenticated, IsDoctor]

    VALID_ACTIONS = {"approve", "approve_edited", "pending", "reject"}

    def post(self, request, message_id):
        message = (
            PatientConsultMessage.objects.filter(
                id=message_id,
                doctor=request.user,
                role="assistant",
            )
            .select_related("session")
            .first()
        )
        if not message:
            return APIResponse.not_found(message="问诊回答消息不存在")
        if message.generation_status != "succeeded":
            return APIResponse.error(message="仅可审核已完成生成的回答消息", code=400)

        action = str(request.data.get("action") or "").strip().lower()
        if action not in self.VALID_ACTIONS:
            return APIResponse.error(
                message="action 仅支持 approve/approve_edited/pending/reject",
                code=400,
            )

        review_note_raw = request.data.get("review_note")
        if review_note_raw is not None and not isinstance(review_note_raw, str):
            return APIResponse.error(message="review_note 必须是字符串", code=400)
        review_note = (review_note_raw or "").strip() or None

        edited_markdown_raw = request.data.get("edited_markdown")
        if edited_markdown_raw is not None and not isinstance(edited_markdown_raw, str):
            return APIResponse.error(message="edited_markdown 必须是字符串", code=400)
        edited_markdown = (
            edited_markdown_raw.strip()
            if isinstance(edited_markdown_raw, str)
            else None
        )

        now = timezone.now()
        update_fields = ["review_note", "updated_at"]

        if action == "approve_edited":
            final_markdown = edited_markdown
            if final_markdown is None:
                final_markdown = (message.edited_markdown or "").strip()
            if not final_markdown:
                return APIResponse.error(
                    message="编辑后通过时，edited_markdown 不能为空",
                    code=400,
                )

            message.edited_markdown = final_markdown
            message.edited_at = now
            message.content = final_markdown
            message.content_markdown = final_markdown
            message.review_status = "approved_edited"
            message.reviewed_at = now
            update_fields.extend(
                [
                    "edited_markdown",
                    "edited_at",
                    "content",
                    "content_markdown",
                    "review_status",
                    "reviewed_at",
                ]
            )
        else:
            if edited_markdown is not None:
                message.edited_markdown = edited_markdown or None
                message.edited_at = now if edited_markdown else None
                update_fields.extend(["edited_markdown", "edited_at"])

            if action == "approve":
                message.review_status = "approved"
                message.reviewed_at = now
                update_fields.extend(["review_status", "reviewed_at"])
            elif action == "pending":
                message.review_status = "pending"
                message.reviewed_at = None
                update_fields.extend(["review_status", "reviewed_at"])
            elif action == "reject":
                message.review_status = "rejected"
                message.reviewed_at = now
                update_fields.extend(["review_status", "reviewed_at"])

        message.review_note = review_note
        message.save(update_fields=list(dict.fromkeys(update_fields)))

        pending_count = PatientConsultMessage.objects.filter(
            session_id=message.session_id,
            role="assistant",
            review_status="pending",
        ).count()

        action_text_map = {
            "approve": "审核通过",
            "approve_edited": "编辑后通过",
            "pending": "已设置为待审核",
            "reject": "已驳回",
        }
        return APIResponse.success(
            data={
                "message": PatientConsultMessageSerializer(message).data,
                "pending_count": pending_count,
            },
            message=action_text_map.get(action, "已更新"),
        )


class PatientDoctorDirectoryView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        queryset = CustomUser.objects.filter(
            is_doctor=True,
            doctor_apply_status="approved",
            is_active=True,
        ).order_by("-updated_at")
        serializer = PatientDoctorSerializer(queryset, many=True)
        return APIResponse.success(data=serializer.data, message="获取成功")


class PatientDoctorAssetsView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request, doctor_id):
        doctor = _get_available_doctor(doctor_id)
        if not doctor:
            return APIResponse.not_found(message="医生不存在或当前不可服务")

        kernel, _ = _get_or_create_doctor_narrative_kernel(doctor)
        voice_id, tts_model, voice_name = _resolve_latest_doctor_voice(doctor)
        video_queryset = list(
            DoctorAvatarVideo.objects.filter(
                doctor=doctor,
                task_status="succeeded",
            )
            .exclude(video_oss_url__isnull=True)
            .exclude(video_oss_url="")
            .order_by("-updated_at")
        )

        oss_client = None
        try:
            oss_client = get_oss_client()
        except OSSConfigurationError:
            oss_client = None

        videos = []
        for video in video_queryset:
            videos.append(
                {
                    "video_id": video.id,
                    "scene_key": video.scene_key,
                    "scene_name": video.scene_name,
                    "video_url": _build_video_play_url(video, oss_client=oss_client),
                    "video_oss_url": video.video_oss_url,
                }
            )
        video_urls = [
            item["video_url"]
            for item in videos
            if item.get("video_url")
        ]

        data = {
            "doctor": PatientDoctorSerializer(doctor).data,
            "tts_model": tts_model,
            "voice_id": voice_id,
            "voice_name": voice_name,
            "opening": _build_doctor_opening_data(
                doctor,
                kernel.payload if isinstance(kernel.payload, dict) else {},
                oss_client=oss_client,
                voice_meta=(voice_id, tts_model, voice_name),
            ),
            "video_urls": video_urls,
            "videos": videos,
        }
        return APIResponse.success(data=data, message="获取成功")


class PatientASRTranscribeView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request):
        audio_file = request.FILES.get("audio")
        if not audio_file:
            return APIResponse.error(message="请上传音频文件（字段名: audio）", code=400)

        upload_config = getattr(settings, "PATIENT_ASR_UPLOAD_CONFIG", {})
        max_file_size = int(upload_config.get("MAX_FILE_SIZE", 12 * 1024 * 1024))
        allowed_extensions = {
            ext.lower() for ext in upload_config.get("ALLOWED_EXTENSIONS", [])
        }
        allowed_mime_types = {
            mime.lower() for mime in upload_config.get("ALLOWED_MIME_TYPES", [])
        }

        content_type = (audio_file.content_type or "").lower()
        file_extension = Path(audio_file.name or "").suffix.lower()
        if audio_file.size > max_file_size:
            return APIResponse.error(
                message=f"音频文件超过大小限制（最大 {max_file_size // (1024 * 1024)}MB）",
                code=400,
            )
        if (allowed_extensions or allowed_mime_types) and not (
            file_extension in allowed_extensions or content_type in allowed_mime_types
        ):
            supported = ", ".join(sorted(allowed_extensions))
            return APIResponse.error(
                message=f"音频类型不支持，支持扩展名: {supported}",
                code=400,
            )
        if not (
            content_type.startswith("audio/")
            or content_type in {"video/webm"}
            or file_extension in allowed_extensions
        ):
            return APIResponse.error(message="上传文件不是有效音频类型", code=400)

        try:
            asr_service = get_qwen_asr_service()
            asr_result = asr_service.transcribe(audio_file, content_type)
        except QwenASRConfigurationError as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        except QwenASRError as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return APIResponse.success(
            data={
                "text": asr_result.get("text", ""),
                "model": asr_result.get("model", ""),
                "content_type": content_type or None,
                "size_bytes": audio_file.size,
            },
            message="语音识别成功",
        )


class PatientConsultAttachmentUploadView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request, session_id):
        session = (
            PatientConsultSession.objects.filter(id=session_id, patient=request.user)
            .select_related("doctor")
            .first()
        )
        if not session:
            return APIResponse.not_found(message="问诊会话不存在")

        files = request.FILES.getlist("files")
        if not files:
            single_file = request.FILES.get("file")
            if single_file:
                files = [single_file]
        if not files:
            return APIResponse.error(message="请至少上传一个附件", code=400)

        upload_config = getattr(settings, "PATIENT_CONSULT_ATTACHMENT_UPLOAD_CONFIG", {})
        max_batch_count = int(upload_config.get("MAX_BATCH_COUNT", 5))
        max_file_size = int(upload_config.get("MAX_FILE_SIZE", 20 * 1024 * 1024))
        image_max_file_size = int(upload_config.get("IMAGE_MAX_FILE_SIZE", 10 * 1024 * 1024))
        cache_ttl_seconds = int(upload_config.get("CACHE_TTL_SECONDS", 30 * 24 * 60 * 60))
        allowed_types = {
            content_type.lower()
            for group in upload_config.get("ALLOWED_TYPES", {}).values()
            for content_type in group
        }
        allowed_extensions = {
            ext.lower()
            for group in upload_config.get("ALLOWED_EXTENSIONS", {}).values()
            for ext in group
        }
        image_types = {
            content_type.lower()
            for content_type in upload_config.get("ALLOWED_TYPES", {}).get("images", [])
        }
        image_extensions = {
            ext.lower()
            for ext in upload_config.get("ALLOWED_EXTENSIONS", {}).get("images", [])
        }

        if len(files) > max_batch_count:
            return APIResponse.error(
                message=f"单次最多上传 {max_batch_count} 个附件",
                code=400,
            )

        for upload in files:
            content_type = (upload.content_type or "").lower()
            file_extension = Path(upload.name or "").suffix.lower()

            if upload.size > max_file_size:
                return APIResponse.error(
                    message=f"附件 {upload.name} 超过大小限制（最大 {max_file_size // (1024 * 1024)}MB）",
                    code=400,
                )

            is_image = (
                content_type.startswith("image/")
                or content_type in image_types
                or file_extension in image_extensions
            )
            if is_image and upload.size > image_max_file_size:
                return APIResponse.error(
                    message=f"图片附件 {upload.name} 超过大小限制（最大 {image_max_file_size // (1024 * 1024)}MB）",
                    code=400,
                )

            mime_supported = content_type in allowed_types if allowed_types else False
            extension_supported = (
                file_extension in allowed_extensions if allowed_extensions else False
            )
            if (allowed_types or allowed_extensions) and not (
                mime_supported or extension_supported
            ):
                supported_exts = ", ".join(sorted(allowed_extensions))
                return APIResponse.error(
                    message=(
                        f"附件 {upload.name} 类型不支持: {upload.content_type}，"
                        f"支持扩展名: {supported_exts}"
                    ),
                    code=400,
                )

        try:
            oss_client = get_oss_client()
            extractor = get_qwen_extractor()
        except (OSSConfigurationError, QwenConfigurationError) as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        attachments = []
        for upload in files:
            content_type = (upload.content_type or "").lower()
            file_extension = Path(upload.name or "").suffix.lower()
            file_kind = (
                "image"
                if (
                    content_type.startswith("image/")
                    or content_type in image_types
                    or file_extension in image_extensions
                )
                else "document"
            )

            try:
                upload_result = oss_client.upload_file(
                    upload,
                    doctor_id=request.user.id,
                    prefix="patient-consult/attachments",
                )
                qwen_file_id = extractor.upload_file(upload)
            except (OSSUploadError, QwenExtractionError) as exc:
                return APIResponse.error(
                    message=str(exc),
                    code=500,
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

            attachment_id = uuid.uuid4().hex
            created_at = timezone.now().isoformat()
            attachment_payload = {
                "attachment_id": attachment_id,
                "patient_id": request.user.id,
                "session_id": session.id,
                "doctor_id": session.doctor_id,
                "file_kind": file_kind,
                "file_name": upload.name,
                "content_type": upload_result.get("content_type") or content_type,
                "size_bytes": int(upload_result.get("size_bytes") or 0),
                "object_key": upload_result.get("object_key"),
                "oss_url": upload_result.get("oss_url"),
                "qwen_file_id": qwen_file_id,
                "created_at": created_at,
            }
            _store_patient_attachment_cache(
                patient_id=request.user.id,
                session_id=session.id,
                attachment_id=attachment_id,
                payload=attachment_payload,
                timeout=cache_ttl_seconds,
            )

            signed_url = _build_patient_attachment_access_url(
                attachment_payload,
                oss_client=oss_client,
            )
            attachments.append(
                {
                    "attachment_id": attachment_id,
                    "file_kind": file_kind,
                    "file_name": attachment_payload["file_name"],
                    "content_type": attachment_payload["content_type"],
                    "size_bytes": attachment_payload["size_bytes"],
                    "file_url": signed_url,
                    "preview_url": signed_url if file_kind == "image" else None,
                    "created_at": created_at,
                }
            )

        return APIResponse.success(
            data={
                "attachments": attachments,
                "expire_seconds": cache_ttl_seconds,
            },
            message="附件上传成功",
        )


class PatientConsultSessionView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request):
        queryset = PatientConsultSession.objects.filter(patient=request.user).order_by(
            "-is_pinned", "-pinned_at", "-last_message_at", "-updated_at"
        )
        serializer = PatientConsultSessionSerializer(queryset, many=True)
        return APIResponse.success(data=serializer.data, message="获取成功")

    def post(self, request):
        doctor_id = request.data.get("doctor_id")
        if doctor_id is None:
            return APIResponse.error(message="doctor_id 不能为空", code=400)
        try:
            doctor_id_int = int(doctor_id)
        except (TypeError, ValueError):
            return APIResponse.error(message="doctor_id 必须是整数", code=400)

        doctor = _get_available_doctor(doctor_id_int)
        if not doctor:
            return APIResponse.not_found(message="医生不存在或当前不可服务")

        title = (request.data.get("title") or "").strip()
        if not title:
            title = f"{doctor.nickname or doctor.username}问诊-{timezone.now().strftime('%Y%m%d-%H%M%S')}"

        item = PatientConsultSession.objects.create(
            patient=request.user,
            doctor=doctor,
            title=title,
            status="active",
        )
        data = PatientConsultSessionSerializer(item).data
        return APIResponse.created(data=data, message="患者问诊会话已创建")


class PatientConsultSessionItemView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    @staticmethod
    def _get_session(patient, session_id: int) -> PatientConsultSession | None:
        return (
            PatientConsultSession.objects.filter(
                id=session_id,
                patient=patient,
            )
            .select_related("doctor")
            .first()
        )

    def patch(self, request, session_id):
        session = self._get_session(request.user, session_id)
        if not session:
            return APIResponse.not_found(message="问诊会话不存在")

        if "is_pinned" not in request.data:
            return APIResponse.error(message="is_pinned 不能为空", code=400)

        is_pinned = _parse_bool(request.data.get("is_pinned"), default=False)
        session.is_pinned = is_pinned
        session.pinned_at = timezone.now() if is_pinned else None
        session.save(update_fields=["is_pinned", "pinned_at", "updated_at"])

        return APIResponse.success(
            data=PatientConsultSessionSerializer(session).data,
            message="会话置顶状态已更新",
        )

    def delete(self, request, session_id):
        session = self._get_session(request.user, session_id)
        if not session:
            return APIResponse.not_found(message="问诊会话不存在")

        now = timezone.now()
        PatientConsultMessage.objects.filter(session=session).update(
            is_deleted=True,
            deleted_at=now,
            updated_at=now,
        )
        PatientConsultSession.all_objects.filter(
            id=session.id,
            patient=request.user,
        ).update(
            is_deleted=True,
            deleted_at=now,
            updated_at=now,
        )
        return APIResponse.success(message="会话已删除", data=None)


class PatientConsultMessageView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def get(self, request, session_id):
        try:
            oss_client = get_oss_client()
        except OSSConfigurationError:
            oss_client = None

        session = PatientConsultSession.objects.filter(
            id=session_id, patient=request.user
        ).select_related("doctor").first()
        if not session:
            return APIResponse.not_found(message="问诊会话不存在")

        raw_limit = request.query_params.get("limit", 100)
        try:
            limit = int(raw_limit)
        except (TypeError, ValueError):
            limit = 100
        limit = max(1, min(limit, 300))

        queryset = list(
            PatientConsultMessage.objects.filter(session=session)
            .order_by("-created_at")[:limit]
        )
        queryset.reverse()
        messages_data = PatientConsultMessageSerializer(queryset, many=True).data
        messages_data = [
            _hydrate_patient_message_payload_with_attachments(
                item,
                oss_client=oss_client,
            )
            for item in messages_data
        ]
        return APIResponse.success(
            data={
                "session": PatientConsultSessionSerializer(session).data,
                "messages": messages_data,
            },
            message="获取成功",
        )


class PatientConsultMessageInterruptView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def post(self, request, session_id, message_id):
        session = (
            PatientConsultSession.objects.filter(id=session_id, patient=request.user)
            .select_related("doctor")
            .first()
        )
        if not session:
            return APIResponse.not_found(message="问诊会话不存在")

        message = (
            PatientConsultMessage.objects.filter(
                id=message_id,
                session=session,
                role="assistant",
            )
            .order_by("-created_at")
            .first()
        )
        if not message:
            return APIResponse.not_found(message="回答消息不存在")

        partial_content = request.data.get("partial_content")
        if partial_content is not None and not isinstance(partial_content, str):
            return APIResponse.error(message="partial_content 必须是字符串", code=400)
        partial_text = partial_content if isinstance(partial_content, str) else ""

        _mark_patient_stream_cancelled(message.id)

        meta_data = message.meta if isinstance(message.meta, dict) else {}
        meta_data["interrupted"] = True
        meta_data["interrupted_at"] = timezone.now().isoformat()

        update_fields = ["meta", "updated_at"]
        if message.generation_status == "generating":
            message.generation_status = "succeeded"
            update_fields.append("generation_status")
        if partial_content is not None:
            message.content = partial_text
            message.content_markdown = partial_text
            update_fields.extend(["content", "content_markdown"])
        if message.error_message:
            message.error_message = None
            update_fields.append("error_message")

        message.meta = meta_data
        message.save(update_fields=update_fields)

        session.last_message_at = timezone.now()
        session.save(update_fields=["last_message_at", "updated_at"])

        return APIResponse.success(
            data=PatientConsultMessageSerializer(message).data,
            message="已停止生成并保存当前内容",
        )


class PatientConsultAskStreamView(APIView):
    permission_classes = [IsAuthenticated, IsPatient]

    def _build_history(self, session, exclude_message_id: int, history_limit: int) -> list[dict[str, str]]:
        history_queryset = (
            PatientConsultMessage.objects.filter(session=session)
            .exclude(id=exclude_message_id)
            .order_by("-created_at")[:history_limit]
        )
        history_messages = []
        for item in reversed(list(history_queryset)):
            content = item.content or ""
            if item.role == "user" and isinstance(item.meta, dict):
                attachments = item.meta.get("attachments")
                if isinstance(attachments, list):
                    attachment_summary = _build_patient_attachment_summary_text(attachments)
                    if attachment_summary and "[附件]" not in content:
                        content += attachment_summary
            history_messages.append(
                {
                    "role": "assistant" if item.role == "assistant" else "user",
                    "content": content,
                }
            )
        return history_messages

    def post(self, request, session_id):
        session = (
            PatientConsultSession.objects.filter(id=session_id, patient=request.user)
            .select_related("doctor")
            .first()
        )
        if not session:
            return APIResponse.not_found(message="问诊会话不存在")

        raw_attachment_ids = request.data.get("attachment_ids")
        attachment_ids = _parse_patient_attachment_ids(raw_attachment_ids)
        if raw_attachment_ids not in (None, "", []) and not attachment_ids:
            return APIResponse.error(message="attachment_ids 格式错误", code=400)

        attachment_payloads = []
        missing_attachment_ids = []
        for attachment_id in attachment_ids:
            payload = _load_patient_attachment_cache(
                patient_id=request.user.id,
                session_id=session.id,
                attachment_id=attachment_id,
            )
            if not payload:
                missing_attachment_ids.append(attachment_id)
                continue
            attachment_payloads.append(payload)
        if missing_attachment_ids:
            return APIResponse.error(
                message="部分附件已失效，请重新上传后再发送",
                code=400,
            )

        question = (request.data.get("question") or "").strip()
        if not question and attachment_payloads:
            question = "请结合我上传的附件，给出专业分析和建议。"
        if not question:
            return APIResponse.error(message="question 不能为空", code=400)

        forced_search_value = request.data.get("forced_search")
        forced_search = None
        if forced_search_value is not None:
            forced_search = _parse_bool(forced_search_value, default=True)
        enable_audio = _parse_bool(request.data.get("enable_audio"), default=True)

        try:
            rehearsal = get_rehearsal_service()
        except RehearsalConfigurationError as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        turn_index = (
            PatientConsultMessage.objects.filter(session=session).count() // 2
        ) + 1
        title_updated = False
        if turn_index == 1:
            doctor_name = session.doctor.nickname or session.doctor.username
            auto_prefix = f"{doctor_name}问诊-"
            current_title = (session.title or "").strip()
            if (not current_title) or current_title.startswith(auto_prefix):
                session.title = _build_patient_session_title(question)
                title_updated = True

        try:
            attachment_oss_client = get_oss_client()
        except OSSConfigurationError:
            attachment_oss_client = None

        message_attachments = []
        attachment_grounding_inputs = []
        for attachment in attachment_payloads:
            qwen_file_id = str(attachment.get("qwen_file_id") or "").strip()
            if not qwen_file_id:
                continue
            file_kind = str(attachment.get("file_kind") or "").strip().lower() or "document"
            file_name = str(attachment.get("file_name") or "").strip() or "未命名附件"
            file_url = _build_patient_attachment_access_url(
                attachment,
                oss_client=attachment_oss_client,
            )
            attachment_item = {
                "attachment_id": str(attachment.get("attachment_id") or "").strip(),
                "file_kind": file_kind,
                "file_name": file_name,
                "content_type": attachment.get("content_type"),
                "size_bytes": int(attachment.get("size_bytes") or 0),
                "object_key": attachment.get("object_key"),
                "oss_url": attachment.get("oss_url"),
                "qwen_file_id": qwen_file_id,
            }
            if file_url:
                attachment_item["file_url"] = file_url
                if file_kind == "image":
                    attachment_item["preview_url"] = file_url
            message_attachments.append(attachment_item)
            attachment_grounding_inputs.append(
                {
                    "file_id": qwen_file_id,
                    "file_kind": file_kind,
                    "file_name": file_name,
                    "signed_url": file_url,
                    "file_url": file_url,
                    "preview_url": file_url if file_kind == "image" else None,
                }
            )

        user_content = question + _build_patient_attachment_summary_text(message_attachments)
        user_meta = {"attachments": message_attachments} if message_attachments else {}

        user_msg = PatientConsultMessage.objects.create(
            session=session,
            patient=request.user,
            doctor=session.doctor,
            role="user",
            turn_index=turn_index,
            generation_status="succeeded",
            review_status="approved",
            content=user_content,
            content_markdown=user_content,
            model_name=None,
            meta=user_meta,
        )

        assistant_msg = PatientConsultMessage.objects.create(
            session=session,
            patient=request.user,
            doctor=session.doctor,
            role="assistant",
            turn_index=turn_index,
            generation_status="generating",
            review_status="pending",
            reply_to=user_msg,
            content="[生成中]",
            content_markdown="[生成中]",
            model_name=rehearsal.answer_model,
        )
        _clear_patient_stream_cancel_flag(assistant_msg.id)

        session.last_message_at = timezone.now()
        session_update_fields = ["last_message_at", "updated_at"]
        if title_updated:
            session_update_fields.append("title")
        session.save(update_fields=session_update_fields)

        kernel, _ = _get_or_create_doctor_narrative_kernel(session.doctor)
        selected = {"selected_file_ids": [], "reason": ""}
        selected_file_ids: list[str] = []
        selected_meta: list[dict] = []

        try:
            if attachment_grounding_inputs:
                selected_file_ids = [
                    str(item.get("file_id") or "").strip()
                    for item in attachment_grounding_inputs
                    if str(item.get("file_id") or "").strip()
                ]
                selected_meta = [
                    {
                        "source": "patient_attachment",
                        "attachment_id": item.get("attachment_id"),
                        "file_id": item.get("qwen_file_id"),
                        "file_name": item.get("file_name"),
                        "file_kind": item.get("file_kind"),
                    }
                    for item in message_attachments
                ]
                selected = {
                    "selected_file_ids": selected_file_ids,
                    "reason": "本轮基于患者上传附件进行分析",
                }
                grounding_result = rehearsal.build_attachment_grounding_answer(
                    question=question,
                    attachments=attachment_grounding_inputs,
                )
            else:
                knowledge_queryset = (
                    DoctorKnowledge.objects.filter(
                        doctor=session.doctor,
                        extract_status="success",
                    )
                    .exclude(qwen_file_id__isnull=True)
                    .exclude(qwen_file_id="")
                    .prefetch_related("tags")
                    .order_by("-updated_at")
                )
                candidates = rehearsal.build_ranked_candidates(question, knowledge_queryset)
                selected = rehearsal.select_file_ids_with_qwen_max(
                    question=question,
                    candidates=candidates,
                )
                selected_file_ids = selected["selected_file_ids"]
                selected_meta_map = {item["file_id"]: item for item in candidates}
                selected_meta = [
                    selected_meta_map[file_id]
                    for file_id in selected_file_ids
                    if file_id in selected_meta_map
                ]
                if selected_file_ids:
                    grounding_result = rehearsal.build_long_grounding_answer(
                        question=question,
                        selected_file_ids=selected_file_ids,
                    )
                else:
                    grounding_result = {"answer": "", "sources": []}
        except RehearsalServiceError as exc:
            assistant_msg.generation_status = "failed"
            assistant_msg.error_message = str(exc)
            assistant_msg.save(
                update_fields=["generation_status", "error_message", "updated_at"]
            )
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        history_messages = self._build_history(
            session=session,
            exclude_message_id=user_msg.id,
            history_limit=rehearsal.history_limit,
        )
        final_messages = rehearsal.build_final_messages(
            narrative_kernel_prompt=kernel.compiled_prompt,
            grounding_answer=grounding_result["answer"],
            history_messages=history_messages,
            question=question,
        )

        def event_stream():
            full_content = ""
            usage_data = {}
            search_sources = []
            interrupted = False
            stream_closed = False
            audio_status = "disabled"
            audio_error = ""
            voice_id = ""
            tts_model = ""
            voice_name = ""
            tts_bridge: DoctorRehearsalRealtimeTTS | None = None
            audio_stats = {
                "audio_format": "pcm16",
                "sample_rate": 24000,
                "channels": 1,
                "first_audio_delay_ms": None,
                "audio_chunk_count": 0,
                "audio_base64_chars": 0,
                "error": "",
            }
            tts_error_emitted = False

            def _audio_payload() -> dict:
                return {
                    "enabled": enable_audio,
                    "status": audio_status,
                    "voice_id": voice_id or None,
                    "voice_name": voice_name or None,
                    "tts_model": tts_model or None,
                    "error": audio_error or None,
                    **audio_stats,
                }

            try:
                if enable_audio:
                    voice_id, tts_model, voice_name = _resolve_latest_doctor_voice(session.doctor)
                    try:
                        tts_bridge = DoctorRehearsalRealtimeTTS(
                            api_key=getattr(settings, "DASHSCOPE_API_KEY", ""),
                            model=tts_model,
                            voice_id=voice_id,
                            ws_url=getattr(
                                settings,
                                "QWEN_TTS_REALTIME_WS_URL",
                                "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
                            ),
                        )
                        tts_bridge.start()
                        audio_status = "streaming"
                    except RehearsalRealtimeTTSError as exc:
                        audio_status = "failed"
                        audio_error = str(exc)
                        tts_bridge = None

                yield _to_sse_event(
                    "start",
                    {
                        "session_id": session.id,
                        "question_message_id": user_msg.id,
                        "answer_message_id": assistant_msg.id,
                        "doctor_id": session.doctor_id,
                        "selected_file_ids": selected_file_ids,
                        "selected_file_meta": selected_meta,
                        "grounding_sources": grounding_result["sources"],
                        "question_attachments": message_attachments,
                        "audio": {
                            "enabled": enable_audio,
                            "status": audio_status,
                            "voice_id": voice_id or None,
                            "voice_name": voice_name or None,
                            "tts_model": tts_model or None,
                            "audio_format": "pcm16",
                            "sample_rate": 24000,
                            "channels": 1,
                        },
                    },
                )
                if audio_error:
                    yield _to_sse_event(
                        "audio_error",
                        {
                            "message_id": assistant_msg.id,
                            "message": audio_error,
                        },
                    )
                    tts_error_emitted = True

                for event in rehearsal.stream_final_answer(
                    messages=final_messages,
                    forced_search=forced_search,
                ):
                    if _is_patient_stream_cancelled(assistant_msg.id):
                        interrupted = True
                        break

                    if event.get("type") == "delta":
                        delta = str(event.get("delta", "") or "")
                        if delta:
                            full_content += delta
                            yield _to_sse_event(
                                "delta",
                                {"message_id": assistant_msg.id, "delta": delta},
                            )
                            if tts_bridge:
                                try:
                                    tts_bridge.append_text(delta)
                                except RehearsalRealtimeTTSError as exc:
                                    audio_status = "failed"
                                    audio_error = str(exc)
                                    if not tts_error_emitted:
                                        yield _to_sse_event(
                                            "audio_error",
                                            {
                                                "message_id": assistant_msg.id,
                                                "message": audio_error,
                                            },
                                        )
                                        tts_error_emitted = True
                                    tts_bridge.close()
                                    tts_bridge = None

                            if tts_bridge:
                                for audio_event in tts_bridge.drain_events():
                                    if audio_event.get("type") == "audio_delta":
                                        yield _to_sse_event(
                                            "audio_delta",
                                            {
                                                "message_id": assistant_msg.id,
                                                "audio_format": "pcm16",
                                                "sample_rate": 24000,
                                                "channels": 1,
                                                "delta": audio_event.get("delta", ""),
                                            },
                                        )
                                    elif audio_event.get("type") == "error":
                                        audio_status = "failed"
                                        audio_error = str(
                                            audio_event.get("message") or "realtime tts error"
                                        )
                                        if not tts_error_emitted:
                                            yield _to_sse_event(
                                                "audio_error",
                                                {
                                                    "message_id": assistant_msg.id,
                                                    "message": audio_error,
                                                },
                                            )
                                            tts_error_emitted = True
                    elif event.get("type") == "done":
                        full_content = str(event.get("content", full_content) or "")
                        usage_data = event.get("usage", {}) or {}
                        search_sources = event.get("search_sources", []) or []
                        full_content = _strip_non_clickable_footnotes(
                            full_content,
                            search_sources=search_sources,
                        )
                        break
            except RehearsalServiceError as exc:
                if tts_bridge:
                    try:
                        tts_bridge.close()
                    except Exception:  # noqa: BLE001
                        pass
                    audio_stats = tts_bridge.get_stats()
                    if audio_stats.get("error"):
                        audio_error = str(audio_stats.get("error"))
                        audio_status = "failed"
                elif enable_audio and audio_status != "failed":
                    audio_status = "stopped"
                assistant_msg.generation_status = "failed"
                assistant_msg.error_message = str(exc)
                assistant_msg.selected_file_ids = selected_file_ids
                assistant_msg.selected_file_meta = selected_meta
                assistant_msg.grounding_answer = grounding_result["answer"]
                assistant_msg.grounding_sources = grounding_result["sources"]
                assistant_msg.meta = {
                    "selector_reason": selected.get("reason", ""),
                    "question_attachments": message_attachments,
                    "audio": _audio_payload(),
                }
                assistant_msg.save(
                    update_fields=[
                        "generation_status",
                        "error_message",
                        "selected_file_ids",
                        "selected_file_meta",
                        "grounding_answer",
                        "grounding_sources",
                        "meta",
                        "updated_at",
                    ]
                )
                yield _to_sse_event(
                    "error",
                    {"message": str(exc), "message_id": assistant_msg.id},
                )
                _clear_patient_stream_cancel_flag(assistant_msg.id)
                return
            except (GeneratorExit, BrokenPipeError, ConnectionResetError):
                interrupted = True
                stream_closed = True

            if interrupted:
                if tts_bridge:
                    try:
                        tts_bridge.close()
                    except Exception:  # noqa: BLE001
                        pass
                    audio_stats = tts_bridge.get_stats()
                    if audio_stats.get("error"):
                        audio_error = str(audio_stats.get("error"))
                        audio_status = "failed"
                elif enable_audio and audio_status != "failed":
                    audio_status = "stopped"

                final_partial = full_content.strip()
                if not final_partial and assistant_msg.content not in {"", "[生成中]"}:
                    final_partial = assistant_msg.content
                final_partial = _strip_non_clickable_footnotes(
                    final_partial,
                    search_sources=search_sources,
                )

                meta_data = assistant_msg.meta if isinstance(assistant_msg.meta, dict) else {}
                meta_data.update(
                    {
                        "selector_reason": selected.get("reason", ""),
                        "question_attachments": message_attachments,
                        "interrupted": True,
                        "interrupted_at": timezone.now().isoformat(),
                        "audio": _audio_payload(),
                    }
                )

                assistant_msg.generation_status = "succeeded"
                assistant_msg.content = final_partial
                assistant_msg.content_markdown = final_partial
                assistant_msg.model_name = rehearsal.answer_model
                assistant_msg.selected_file_ids = selected_file_ids
                assistant_msg.selected_file_meta = selected_meta
                assistant_msg.grounding_answer = grounding_result["answer"]
                assistant_msg.grounding_sources = grounding_result["sources"]
                assistant_msg.search_sources = search_sources
                assistant_msg.input_tokens = usage_data.get("input_tokens")
                assistant_msg.output_tokens = usage_data.get("output_tokens")
                assistant_msg.total_tokens = usage_data.get("total_tokens")
                assistant_msg.meta = meta_data
                assistant_msg.error_message = None
                assistant_msg.save(
                    update_fields=[
                        "generation_status",
                        "content",
                        "content_markdown",
                        "model_name",
                        "selected_file_ids",
                        "selected_file_meta",
                        "grounding_answer",
                        "grounding_sources",
                        "search_sources",
                        "input_tokens",
                        "output_tokens",
                        "total_tokens",
                        "meta",
                        "error_message",
                        "updated_at",
                    ]
                )
                session.last_message_at = timezone.now()
                session.save(update_fields=["last_message_at", "updated_at"])

                if not stream_closed:
                    yield _to_sse_event(
                        "done",
                        {
                            "message_id": assistant_msg.id,
                            "usage": usage_data,
                            "search_sources": search_sources,
                            "selected_file_ids": selected_file_ids,
                            "question_attachments": message_attachments,
                            "interrupted": True,
                            "audio": _audio_payload(),
                        },
                    )
                _clear_patient_stream_cancel_flag(assistant_msg.id)
                return

            if tts_bridge:
                try:
                    tts_bridge.finish()
                except RehearsalRealtimeTTSError as exc:
                    audio_status = "failed"
                    audio_error = str(exc)
                    if not tts_error_emitted:
                        yield _to_sse_event(
                            "audio_error",
                            {
                                "message_id": assistant_msg.id,
                                "message": audio_error,
                            },
                        )
                        tts_error_emitted = True

                for audio_event in tts_bridge.drain_until_done(max_wait_seconds=15.0):
                    if audio_event.get("type") == "audio_delta":
                        yield _to_sse_event(
                            "audio_delta",
                            {
                                "message_id": assistant_msg.id,
                                "audio_format": "pcm16",
                                "sample_rate": 24000,
                                "channels": 1,
                                "delta": audio_event.get("delta", ""),
                            },
                        )
                    elif audio_event.get("type") == "error":
                        audio_status = "failed"
                        audio_error = str(audio_event.get("message") or "realtime tts error")
                        if not tts_error_emitted:
                            yield _to_sse_event(
                                "audio_error",
                                {
                                    "message_id": assistant_msg.id,
                                    "message": audio_error,
                                },
                            )
                            tts_error_emitted = True
                audio_stats = tts_bridge.get_stats()
                if audio_stats.get("error"):
                    audio_status = "failed"
                    if not audio_error:
                        audio_error = str(audio_stats.get("error"))
                elif audio_status == "streaming":
                    audio_status = "succeeded"
                tts_bridge.close()
            elif enable_audio and audio_status != "failed":
                audio_status = "disabled"

            assistant_msg.generation_status = "succeeded"
            cleaned_content = _strip_non_clickable_footnotes(
                full_content,
                search_sources=search_sources,
            )
            assistant_msg.content = cleaned_content
            assistant_msg.content_markdown = cleaned_content
            assistant_msg.model_name = rehearsal.answer_model
            assistant_msg.selected_file_ids = selected_file_ids
            assistant_msg.selected_file_meta = selected_meta
            assistant_msg.grounding_answer = grounding_result["answer"]
            assistant_msg.grounding_sources = grounding_result["sources"]
            assistant_msg.search_sources = search_sources
            assistant_msg.input_tokens = usage_data.get("input_tokens")
            assistant_msg.output_tokens = usage_data.get("output_tokens")
            assistant_msg.total_tokens = usage_data.get("total_tokens")
            assistant_msg.meta = {
                "selector_reason": selected.get("reason", ""),
                "question_attachments": message_attachments,
                "interrupted": False,
                "audio": _audio_payload(),
            }
            assistant_msg.error_message = None
            assistant_msg.save(
                update_fields=[
                    "generation_status",
                    "content",
                    "content_markdown",
                    "model_name",
                    "selected_file_ids",
                    "selected_file_meta",
                    "grounding_answer",
                    "grounding_sources",
                    "search_sources",
                    "input_tokens",
                    "output_tokens",
                    "total_tokens",
                    "meta",
                    "error_message",
                    "updated_at",
                ]
            )
            session.last_message_at = timezone.now()
            session.save(update_fields=["last_message_at", "updated_at"])

            yield _to_sse_event(
                "done",
                {
                    "message_id": assistant_msg.id,
                    "usage": usage_data,
                    "search_sources": search_sources,
                    "selected_file_ids": selected_file_ids,
                    "question_attachments": message_attachments,
                    "interrupted": False,
                    "audio": _audio_payload(),
                },
            )
            _clear_patient_stream_cancel_flag(assistant_msg.id)
            return

        response = StreamingHttpResponse(
            event_stream(),
            content_type="text/event-stream",
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response
