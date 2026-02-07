from django.conf import settings
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from mdapi.models import DoctorKnowledge, KnowledgeTag
from mdapi.permissions import IsDoctor
from mdapi.serializers import DoctorKnowledgeIndexSerializer, DoctorKnowledgeSerializer
from mdapi.services.knowledge_queue import KnowledgeQueueError, get_knowledge_queue
from mdapi.services.oss import OSSConfigurationError, OSSUploadError, get_oss_client
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

        upload_config = getattr(settings, "FILE_UPLOAD_CONFIG", {})
        max_batch_count = upload_config.get("MAX_BATCH_COUNT", 10)
        max_file_size = upload_config.get("MAX_FILE_SIZE", 100 * 1024 * 1024)
        allowed_types = {
            content_type
            for group in upload_config.get("ALLOWED_TYPES", {}).values()
            for content_type in group
        }

        if len(files) > max_batch_count:
            return APIResponse.error(
                message=f"单次最多上传 {max_batch_count} 个文件",
                code=400,
            )

        for upload in files:
            if upload.size > max_file_size:
                return APIResponse.error(
                    message=f"文件 {upload.name} 超过大小限制",
                    code=400,
                )

            if allowed_types and upload.content_type not in allowed_types:
                return APIResponse.error(
                    message=f"文件 {upload.name} 类型不支持: {upload.content_type}",
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
