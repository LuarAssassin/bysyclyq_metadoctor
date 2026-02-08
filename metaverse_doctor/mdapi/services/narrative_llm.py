import json
import logging
import re
from pathlib import Path
from typing import Any

from django.conf import settings

logger = logging.getLogger("mdapi")


class NarrativeLLMConfigurationError(Exception):
    """Raised when narrative llm configuration is invalid."""


class NarrativeLLMError(Exception):
    """Raised when narrative llm call or parsing fails."""


class QwenNarrativeOptimizer:
    DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1"
    DEFAULT_MODEL = "qwen3-max-2026-01-23"
    DEFAULT_SYSTEM_PROMPT = (
        "你是医生数字人叙事底座优化器。"
        "任务是根据医生对回答的批注，把可执行的结构化增量写入 DSL。"
        "只能输出 JSON，禁止额外解释。"
    )
    DEFAULT_USER_PROMPT_TEMPLATE = (
        "请基于以下输入，输出可合并到 Narrative Kernel 的最小增量。\n"
        "输出 JSON 结构必须为：\n"
        "{\n"
        '  "delta": { ... },\n'
        '  "negative_rules": ["..."],\n'
        '  "reason": "一句话说明"\n'
        "}\n"
        "要求：\n"
        "1) delta 只放需要改动的字段，不要整份重写。\n"
        "2) 不确定的内容不要编造。\n"
        "3) negative_rules 只放明确的禁忌表达。\n"
        "4) 若无需改动，delta 返回空对象，negative_rules 返回空数组。\n\n"
        "当前底座(JSON)：\n{{kernel_payload_json}}\n\n"
        "患者问题：{{question}}\n"
        "模型回答：{{answer}}\n"
        "医生批注：{{comment}}\n"
        "医生手工增量（优先级更高，可参考）：\n{{manual_delta_json}}\n"
    )

    def __init__(self):
        enabled = bool(getattr(settings, "QWEN_NARRATIVE_OPTIMIZER_ENABLED", True))
        if not enabled:
            raise NarrativeLLMConfigurationError("QWEN_NARRATIVE_OPTIMIZER_ENABLED=false")

        self.api_key = getattr(settings, "DASHSCOPE_API_KEY", "")
        if not self.api_key:
            raise NarrativeLLMConfigurationError("缺少配置: DASHSCOPE_API_KEY")

        self.base_url = getattr(settings, "QWEN_RESPONSES_BASE_URL", self.DEFAULT_BASE_URL)
        self.model = getattr(settings, "QWEN_NARRATIVE_MODEL", self.DEFAULT_MODEL)
        self.timeout_seconds = int(getattr(settings, "QWEN_NARRATIVE_TIMEOUT_SECONDS", 60))
        self.prompt_dir = Path(
            getattr(settings, "PROMPT_DIR", Path(settings.BASE_DIR) / "prompts")
        )
        self.system_prompt = self._load_prompt_text(
            "qwen/narrative_optimize_system.txt",
            self.DEFAULT_SYSTEM_PROMPT,
        )
        self.user_prompt_template = self._load_prompt_text(
            "qwen/narrative_optimize_user.txt",
            self.DEFAULT_USER_PROMPT_TEMPLATE,
        )

        try:
            from openai import OpenAI
        except ImportError as exc:
            raise NarrativeLLMConfigurationError("未安装 openai SDK，请执行: uv add openai") from exc

        self.client = OpenAI(api_key=self.api_key, base_url=self.base_url)

    def _load_prompt_text(self, relative_path: str, default_text: str) -> str:
        prompt_path = self.prompt_dir / relative_path
        try:
            text = prompt_path.read_text(encoding="utf-8").strip()
            if text:
                return text
            logger.warning("Prompt file is empty, fallback to default: %s", prompt_path)
        except FileNotFoundError:
            logger.warning("Prompt file not found, fallback to default: %s", prompt_path)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Failed to load prompt file %s, fallback to default: %s",
                prompt_path,
                exc,
            )
        return default_text

    @staticmethod
    def _render_prompt(template: str, **values: str) -> str:
        rendered = template
        for key, value in values.items():
            rendered = rendered.replace(f"{{{{{key}}}}}", str(value))
        return rendered

    @staticmethod
    def _to_json_text(value: Any, max_chars: int = 12000) -> str:
        text = json.dumps(value, ensure_ascii=False, indent=2)
        if len(text) <= max_chars:
            return text
        return text[:max_chars] + "\n... (truncated)"

    @staticmethod
    def _extract_json_text(raw_text: str) -> str:
        text = (raw_text or "").strip()
        if not text:
            raise NarrativeLLMError("Qwen-Max 返回为空")

        code_block_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text)
        if code_block_match:
            return code_block_match.group(1).strip()

        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise NarrativeLLMError("Qwen-Max 返回内容不含 JSON 对象")
        return text[start : end + 1]

    @staticmethod
    def _normalize_result(data: dict[str, Any]) -> tuple[dict[str, Any], list[str], str]:
        delta = data.get("delta", {})
        if not isinstance(delta, dict):
            delta = {}

        rules_raw = data.get("negative_rules", [])
        if isinstance(rules_raw, list):
            negative_rules = [str(item).strip() for item in rules_raw if str(item).strip()]
        else:
            negative_rules = []

        reason = str(data.get("reason", "")).strip()
        return delta, negative_rules, reason

    def optimize(
        self,
        *,
        kernel_payload: dict[str, Any],
        question: str,
        answer: str,
        comment: str,
        manual_delta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        user_prompt = self._render_prompt(
            self.user_prompt_template,
            kernel_payload_json=self._to_json_text(kernel_payload),
            question=question or "",
            answer=answer or "",
            comment=comment or "",
            manual_delta_json=self._to_json_text(manual_delta or {}),
        )

        try:
            response = self.client.responses.create(
                model=self.model,
                input=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
                max_output_tokens=1200,
                timeout=self.timeout_seconds,
            )
        except Exception as exc:  # noqa: BLE001
            raise NarrativeLLMError(f"Qwen-Max 抽取失败: {exc}") from exc

        output_text = str(getattr(response, "output_text", "") or "").strip()
        if not output_text:
            try:
                output = getattr(response, "output", None)
                output_text = json.dumps(output, ensure_ascii=False)
            except Exception:  # noqa: BLE001
                output_text = ""
        if not output_text:
            raise NarrativeLLMError("Qwen-Max 返回为空")

        json_text = self._extract_json_text(output_text)
        try:
            parsed = json.loads(json_text)
        except Exception as exc:  # noqa: BLE001
            raise NarrativeLLMError(f"Qwen-Max 返回 JSON 解析失败: {exc}") from exc

        if not isinstance(parsed, dict):
            raise NarrativeLLMError("Qwen-Max 返回结构异常：顶层必须是对象")

        delta, negative_rules, reason = self._normalize_result(parsed)
        return {
            "delta": delta,
            "negative_rules": negative_rules,
            "reason": reason,
            "raw_output": output_text,
        }


def get_narrative_optimizer() -> QwenNarrativeOptimizer:
    return QwenNarrativeOptimizer()
