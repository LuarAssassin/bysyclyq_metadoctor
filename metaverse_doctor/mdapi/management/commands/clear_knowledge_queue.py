from django.core.management.base import BaseCommand

from mdapi.services.knowledge_queue import KnowledgeQueueError, get_knowledge_queue


class Command(BaseCommand):
    help = "Clear doctor knowledge extraction queue in Redis"

    def add_arguments(self, parser):
        parser.add_argument(
            "--flushdb",
            action="store_true",
            help="Flush current Redis DB (dangerous). Default only clears queue key.",
        )

    def handle(self, *args, **options):
        try:
            queue_client = get_knowledge_queue()
        except KnowledgeQueueError as exc:
            self.stderr.write(self.style.ERROR(str(exc)))
            return

        if options["flushdb"]:
            try:
                queue_client.client.flushdb()
                self.stdout.write(
                    self.style.WARNING("Redis current DB has been flushed.")
                )
            except Exception as exc:  # noqa: BLE001
                self.stderr.write(self.style.ERROR(f"清空 Redis DB 失败: {exc}"))
            return

        try:
            queue_client.clear()
            self.stdout.write(self.style.SUCCESS("Knowledge extract queue cleared."))
        except KnowledgeQueueError as exc:
            self.stderr.write(self.style.ERROR(str(exc)))

