import mimetypes
import urllib.parse
import urllib.request
import uuid
from django.conf import settings
from django.core.files.base import ContentFile
from django.db.models import Count, Q
from pathlib import Path
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from mdapi.models import (
    DoctorAvatarVideo,
    DoctorKnowledge,
    DoctorVoiceProfile,
    KnowledgeTag,
)
from mdapi.permissions import IsDoctor
from mdapi.serializers import (
    DoctorAvatarVideoSerializer,
    DoctorKnowledgeIndexSerializer,
    DoctorKnowledgeSerializer,
    DoctorVoiceProfileSerializer,
)
from mdapi.services.digital_human import (
    DigitalHumanConfigurationError,
    DigitalHumanServiceError,
    get_digital_human_service,
)
from mdapi.services.knowledge_queue import KnowledgeQueueError, get_knowledge_queue
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
        queryset = DoctorAvatarVideo.objects.filter(doctor=request.user).order_by("-created_at")
        serializer = DoctorAvatarVideoSerializer(queryset, many=True)
        return APIResponse.success(data=serializer.data, message="获取成功")

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
        data = DoctorAvatarVideoSerializer(created_items, many=True).data
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
        return APIResponse.success(data=data, message="任务状态已刷新")
