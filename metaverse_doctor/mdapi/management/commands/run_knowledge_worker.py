from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from mdapi.models import DoctorKnowledge, KnowledgeTag
from mdapi.services.knowledge_queue import KnowledgeQueueError, get_knowledge_queue
from mdapi.services.oss import OSSConfigurationError, OSSReadError, get_oss_client
from mdapi.services.qwen import (
    QwenConfigurationError,
    QwenExtractionError,
    get_qwen_extractor,
)


def _get_or_restore_tag(tag_name: str) -> KnowledgeTag:
    tag = KnowledgeTag.all_objects.filter(name=tag_name).first()
    if not tag:
        return KnowledgeTag.objects.create(name=tag_name)
    if tag.is_deleted:
        tag.restore()
    return tag


class Command(BaseCommand):
    help = "Run doctor knowledge extraction worker (Redis queue)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--once",
            action="store_true",
            help="Process at most one task and then exit.",
        )
        parser.add_argument(
            "--poll-timeout",
            type=int,
            default=getattr(settings, "KNOWLEDGE_EXTRACT_WORKER_POLL_TIMEOUT", 5),
            help="Queue blocking pop timeout in seconds.",
        )

    def handle(self, *args, **options):
        once = options["once"]
        poll_timeout = max(int(options["poll_timeout"]), 1)
        max_retries = int(getattr(settings, "KNOWLEDGE_EXTRACT_MAX_RETRIES", 2))
        retry_delay_seconds = int(
            getattr(settings, "KNOWLEDGE_EXTRACT_RETRY_DELAY_SECONDS", 30)
        )
        parsing_retry_delay_seconds = int(
            getattr(settings, "KNOWLEDGE_EXTRACT_PARSING_RETRY_DELAY_SECONDS", 90)
        )

        try:
            queue_client = get_knowledge_queue()
            extractor = get_qwen_extractor()
        except (KnowledgeQueueError, QwenConfigurationError) as exc:
            self.stderr.write(self.style.ERROR(str(exc)))
            return

        try:
            oss_client = get_oss_client()
        except OSSConfigurationError as exc:
            oss_client = None
            self.stderr.write(self.style.WARNING(f"[warn] OSS client 不可用，将跳过 doc_url: {exc}"))

        self.stdout.write(self.style.SUCCESS("Knowledge worker started"))

        processed = 0
        while True:
            try:
                task = queue_client.dequeue(timeout=poll_timeout)
            except KnowledgeQueueError as exc:
                self.stderr.write(self.style.ERROR(str(exc)))
                if once:
                    break
                continue

            if not task:
                if once:
                    break
                continue

            knowledge_id = task.get("knowledge_id")
            attempt = int(task.get("attempt", 0))
            item = DoctorKnowledge.objects.filter(id=knowledge_id).first()
            if not item:
                self.stderr.write(f"[skip] knowledge_id={knowledge_id} 不存在")
                if once:
                    break
                continue

            if not item.qwen_file_id:
                item.extract_status = "failed"
                item.knowledge_status = "failed"
                item.extract_error = "缺少 qwen_file_id，无法执行抽取"
                item.extracted_at = timezone.now()
                item.extract_retry_count = attempt
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
                self.stderr.write(f"[failed] knowledge_id={knowledge_id} 缺少 qwen_file_id")
                if once:
                    break
                continue

            item.extract_status = "running"
            item.extract_error = None
            item.save(update_fields=["extract_status", "extract_error", "updated_at"])

            try:
                signed_doc_url = None
                if oss_client and item.object_key:
                    try:
                        signed_doc_url = oss_client.build_signed_get_url(item.object_key)
                    except OSSReadError as exc:
                        self.stderr.write(
                            self.style.WARNING(
                                f"[warn] knowledge_id={knowledge_id} 生成签名 URL 失败，回退 qwen-long: {exc}"
                            )
                        )
                elif item.oss_url:
                    # 兼容历史数据：没有 object_key 时仍尝试使用原始 URL
                    signed_doc_url = item.oss_url
                result = extractor.extract(
                    file_id=item.qwen_file_id,
                    file_name=item.file_name,
                    doc_url=signed_doc_url,
                )
                tags = [_get_or_restore_tag(name) for name in result["tags"]]

                item.knowledge_description = result["description"]
                item.extract_raw_output = result["raw_output"]
                item.extract_error = None
                item.extract_status = "success"
                item.knowledge_status = "synced"
                item.extracted_at = timezone.now()
                item.extract_retry_count = attempt
                item.save(
                    update_fields=[
                        "knowledge_description",
                        "extract_raw_output",
                        "extract_error",
                        "extract_status",
                        "knowledge_status",
                        "extracted_at",
                        "extract_retry_count",
                        "updated_at",
                    ]
                )
                item.tags.set(tags)
                processed += 1
                self.stdout.write(
                    self.style.SUCCESS(
                        f"[ok] knowledge_id={knowledge_id}, tags={len(tags)}, attempt={attempt}"
                    )
                )
            except QwenExtractionError as exc:
                error_text = str(exc)
                if attempt < max_retries:
                    next_attempt = attempt + 1
                    is_parsing_in_progress = "File parsing in progress" in error_text
                    delay_seconds = retry_delay_seconds * next_attempt
                    if is_parsing_in_progress:
                        delay_seconds = max(delay_seconds, parsing_retry_delay_seconds)
                    item.extract_status = "queued"
                    item.knowledge_status = "pending"
                    item.extract_error = (
                        f"{error_text}（自动重试 {next_attempt}/{max_retries}，"
                        f"{delay_seconds} 秒后执行）"
                    )
                    item.extracted_at = timezone.now()
                    item.extract_retry_count = next_attempt
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
                    try:
                        queue_client.enqueue(
                            {
                                "knowledge_id": knowledge_id,
                                "doctor_id": item.doctor_id,
                                "attempt": next_attempt,
                            },
                            delay_seconds=delay_seconds,
                        )
                    except KnowledgeQueueError as queue_exc:
                        item.extract_status = "failed"
                        item.knowledge_status = "failed"
                        item.extract_error = f"{error_text}; 重试入队失败: {queue_exc}"
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
                    self.stderr.write(
                        self.style.WARNING(
                            f"[retry] knowledge_id={knowledge_id}, attempt={next_attempt}"
                        )
                    )
                else:
                    item.extract_status = "failed"
                    item.knowledge_status = "failed"
                    item.extract_error = error_text
                    item.extracted_at = timezone.now()
                    item.extract_retry_count = attempt
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
                    self.stderr.write(
                        self.style.ERROR(
                            f"[failed] knowledge_id={knowledge_id}, attempt={attempt}, error={error_text}"
                        )
                    )

            if once:
                break

        self.stdout.write(self.style.SUCCESS(f"Knowledge worker stopped, processed={processed}"))
