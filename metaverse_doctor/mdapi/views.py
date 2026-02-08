import json
import mimetypes
import urllib.parse
import urllib.request
import uuid
from django.conf import settings
from django.core.files.base import ContentFile
from django.db.models import Count, Q
from django.http import StreamingHttpResponse
from pathlib import Path
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from mdapi.models import (
    DoctorAvatarVideo,
    DoctorKnowledge,
    DoctorNarrativeAnnotation,
    DoctorNarrativeKernel,
    DoctorRehearsalFeedback,
    DoctorRehearsalMessage,
    DoctorRehearsalSession,
    DoctorVoiceProfile,
    KnowledgeTag,
)
from mdapi.permissions import IsDoctor
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
    build_default_narrative_payload,
    deep_merge_dict,
    remove_negative_rules,
    render_narrative_kernel_dsl,
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
from mdapi.services.oss import (
    OSSConfigurationError,
    OSSReadError,
    OSSUploadError,
    get_oss_client,
)
from mdapi.services.qwen import (
    QwenConfigurationError,
    QwenExtractionError,
    get_qwen_extractor,
)
from mdapi.utils.api_response import APIResponse
from mdapi.utils.pagnition import StandardResultsSetPagination


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
        if not preferred_name:
            preferred_name = f"doctor_{request.user.id}_{uuid.uuid4().hex[:8]}"
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

        try:
            duration = int(
                request.data.get(
                    "duration",
                    getattr(settings, "DIGITAL_HUMAN_I2V_DURATION", 5),
                )
            )
        except (TypeError, ValueError):
            return APIResponse.error(message="duration 必须是整数", code=400)
        if not 2 <= duration <= 15:
            return APIResponse.error(message="duration 必须在 2 到 15 秒之间", code=400)

        model = (request.data.get("model") or "").strip() or getattr(
            settings, "DIGITAL_HUMAN_I2V_MODEL", "wan2.6-i2v-flash"
        )
        default_generate_count = int(
            getattr(settings, "DIGITAL_HUMAN_I2V_GENERATE_COUNT", 5)
        )
        max_generate_count = max(
            1, int(getattr(settings, "DIGITAL_HUMAN_I2V_MAX_GENERATE_COUNT", 5))
        )
        generate_count_raw = request.data.get("generate_count", default_generate_count)
        try:
            generate_count = int(generate_count_raw)
        except (TypeError, ValueError):
            return APIResponse.error(message="generate_count 必须是整数", code=400)
        if not 1 <= generate_count <= max_generate_count:
            return APIResponse.error(
                message=f"generate_count 必须在 1 到 {max_generate_count} 之间",
                code=400,
            )

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

        def event_stream():
            full_content = ""
            usage_data = {}
            search_sources = []

            yield _to_sse_event(
                "start",
                {
                    "session_id": session.id,
                    "question_message_id": user_msg.id,
                    "answer_message_id": assistant_msg.id,
                    "selected_file_ids": selected_file_ids,
                    "selected_file_meta": selected_meta,
                    "grounding_sources": grounding_result["sources"],
                },
            )

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
                    elif event.get("type") == "done":
                        full_content = str(event.get("content", full_content) or "")
                        usage_data = event.get("usage", {}) or {}
                        search_sources = event.get("search_sources", []) or []
            except RehearsalServiceError as exc:
                assistant_msg.generation_status = "failed"
                assistant_msg.error_message = str(exc)
                assistant_msg.selected_file_ids = selected_file_ids
                assistant_msg.selected_file_meta = selected_meta
                assistant_msg.grounding_answer = grounding_result["answer"]
                assistant_msg.grounding_sources = grounding_result["sources"]
                assistant_msg.save(
                    update_fields=[
                        "generation_status",
                        "error_message",
                        "selected_file_ids",
                        "selected_file_meta",
                        "grounding_answer",
                        "grounding_sources",
                        "updated_at",
                    ]
                )
                yield _to_sse_event(
                    "error",
                    {"message": str(exc), "message_id": assistant_msg.id},
                )
                return

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
        active_voice = (
            DoctorVoiceProfile.objects.filter(doctor=request.user, is_active=True, status="ready")
            .order_by("-updated_at")
            .first()
        )
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
            "tts_model": getattr(
                settings, "DIGITAL_HUMAN_TTS_TARGET_MODEL", "qwen3-tts-vc-realtime-2026-01-15"
            ),
            "voice_id": (
                active_voice.qwen_voice_id
                if active_voice
                else getattr(settings, "DIGITAL_HUMAN_DEFAULT_VOICE", "longanyang")
            ),
            "voice_name": (
                active_voice.name if active_voice else "系统默认音色"
            ),
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
