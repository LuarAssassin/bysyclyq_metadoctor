import json
import time
from typing import Optional

from django.conf import settings


class KnowledgeQueueError(Exception):
    """Raised when queue operation fails."""


class KnowledgeExtractQueue:
    def __init__(self):
        redis_url = getattr(settings, "REDIS_URL", None)
        if not redis_url:
            raise KnowledgeQueueError("缺少 Redis 配置: REDIS_URL")

        try:
            import redis
        except ImportError as exc:
            raise KnowledgeQueueError("未安装 redis SDK，请执行: uv add redis") from exc

        self.client = redis.Redis.from_url(redis_url, decode_responses=False)
        self.queue_key = getattr(
            settings, "KNOWLEDGE_EXTRACT_QUEUE_KEY", "mdapi:knowledge_extract_queue"
        )
        self.delayed_queue_key = getattr(
            settings,
            "KNOWLEDGE_EXTRACT_DELAYED_QUEUE_KEY",
            f"{self.queue_key}:delayed",
        )

    def enqueue(self, payload: dict, delay_seconds: int = 0) -> None:
        delay_seconds = max(int(delay_seconds), 0)
        try:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            if delay_seconds > 0:
                score = int(time.time()) + delay_seconds
                self.client.zadd(self.delayed_queue_key, {body: score})
            else:
                self.client.rpush(self.queue_key, body)
        except Exception as exc:  # noqa: BLE001
            raise KnowledgeQueueError(f"抽取任务入队失败: {exc}") from exc

    def _promote_due_tasks(self, batch_size: int = 100) -> int:
        try:
            now = int(time.time())
            due_tasks = self.client.zrangebyscore(
                self.delayed_queue_key,
                min=0,
                max=now,
                start=0,
                num=max(int(batch_size), 1),
            )
            if not due_tasks:
                return 0

            pipeline = self.client.pipeline()
            pipeline.zrem(self.delayed_queue_key, *due_tasks)
            pipeline.rpush(self.queue_key, *due_tasks)
            pipeline.execute()
            return len(due_tasks)
        except Exception as exc:  # noqa: BLE001
            raise KnowledgeQueueError(f"延迟任务转移失败: {exc}") from exc

    def dequeue(self, timeout: int = 5) -> Optional[dict]:
        try:
            self._promote_due_tasks()
            result = self.client.blpop(self.queue_key, timeout=timeout)
        except Exception as exc:  # noqa: BLE001
            raise KnowledgeQueueError(f"抽取任务出队失败: {exc}") from exc

        if not result:
            try:
                self._promote_due_tasks()
            except KnowledgeQueueError:
                pass
            return None

        _, payload_bytes = result
        try:
            return json.loads(payload_bytes.decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            raise KnowledgeQueueError(f"抽取任务解析失败: {exc}") from exc

    def size(self) -> int:
        try:
            return int(
                self.client.llen(self.queue_key) + self.client.zcard(self.delayed_queue_key)
            )
        except Exception as exc:  # noqa: BLE001
            raise KnowledgeQueueError(f"获取队列长度失败: {exc}") from exc

    def clear(self) -> int:
        try:
            return int(self.client.delete(self.queue_key, self.delayed_queue_key))
        except Exception as exc:  # noqa: BLE001
            raise KnowledgeQueueError(f"清理队列失败: {exc}") from exc


def get_knowledge_queue() -> KnowledgeExtractQueue:
    return KnowledgeExtractQueue()
