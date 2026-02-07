import re
import tempfile
import logging
from typing import Iterable
from pathlib import Path

from django.conf import settings

logger = logging.getLogger("mdapi")


class QwenConfigurationError(Exception):
    """Raised when qwen configuration or SDK is unavailable."""


class QwenExtractionError(Exception):
    """Raised when qwen extraction failed or output cannot be parsed."""


class QwenKnowledgeExtractor:
    """
    Extract tags + description from uploaded doctor knowledge files.
    """

    TAG_START = "[TAGS]"
    TAG_END = "[/TAGS]"
    DESC_START = "[DESCRIPTION]"
    DESC_END = "[/DESCRIPTION]"
    DEFAULT_SYSTEM_PROMPT = "你是严谨的医疗文档知识抽取助手。"
    DEFAULT_USER_PROMPT_TEMPLATE = (
        "你是医学知识整理助手。请先完整阅读文件，然后输出结构化标签和描述。"
        "标签要覆盖疾病、科室、检查、治疗、人群、风险、药物等关键维度。"
        "输出必须严格遵守以下格式，不能包含其他内容：\n"
        "[TAGS]标签1|标签2|标签3[/TAGS]\n"
        "[DESCRIPTION]这里写 60-180 字摘要，讲清文档核心内容与适用场景。[/DESCRIPTION]\n"
        "当前文件名：{{file_name}}\n"
        "先阅读文档，再输出结果。"
    )

    def __init__(self):
        self.api_key = settings.DASHSCOPE_API_KEY
        self.base_url = getattr(
            settings,
            "DASHSCOPE_BASE_URL",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
        )
        self.long_extract_model = getattr(settings, "QWEN_LONG_MODEL", "qwen-long")
        self.doc_extract_model = getattr(settings, "QWEN_DOC_MODEL", "qwen-doc-turbo")
        self.prompt_dir = Path(
            getattr(settings, "PROMPT_DIR", Path(settings.BASE_DIR) / "prompts")
        )
        self.extract_system_prompt = self._load_prompt_text(
            "qwen/knowledge_extract_system.txt",
            self.DEFAULT_SYSTEM_PROMPT,
        )
        self.extract_user_prompt_template = self._load_prompt_text(
            "qwen/knowledge_extract_user.txt",
            self.DEFAULT_USER_PROMPT_TEMPLATE,
        )

        if not self.api_key:
            raise QwenConfigurationError("缺少配置: DASHSCOPE_API_KEY")

        try:
            from openai import OpenAI
        except ImportError as exc:
            raise QwenConfigurationError("未安装 openai SDK，请执行: uv add openai") from exc
        try:
            import dashscope
        except ImportError as exc:
            raise QwenConfigurationError(
                "未安装 dashscope SDK，请执行: uv add dashscope"
            ) from exc

        self.client = OpenAI(api_key=self.api_key, base_url=self.base_url)
        self.dashscope = dashscope
        self.dashscope.base_http_api_url = self._to_dashscope_http_url(self.base_url)

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
    def _to_dashscope_http_url(base_url: str) -> str:
        value = (base_url or "").rstrip("/")
        if value.endswith("/compatible-mode/v1"):
            return value.replace("/compatible-mode/v1", "/api/v1")
        return value or "https://dashscope.aliyuncs.com/api/v1"

    @staticmethod
    def _normalize_content(content) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            fragments = []
            for item in content:
                if isinstance(item, dict):
                    text = item.get("text")
                    if isinstance(text, str):
                        fragments.append(text)
                elif isinstance(item, str):
                    fragments.append(item)
            return "\n".join(fragments).strip()
        return str(content or "").strip()

    @staticmethod
    def _unique_keep_order(values: Iterable[str]) -> list[str]:
        result = []
        seen = set()
        for raw in values:
            value = raw.strip()
            if not value:
                continue
            key = value.lower()
            if key in seen:
                continue
            seen.add(key)
            result.append(value)
        return result

    @staticmethod
    def _render_prompt(template: str, **values: str) -> str:
        rendered = template
        for key, value in values.items():
            rendered = rendered.replace(f"{{{{{key}}}}}", str(value))
        return rendered

    def upload_file(self, uploaded_file) -> str:
        temp_path = None
        try:
            if hasattr(uploaded_file, "temporary_file_path"):
                upload_source = Path(uploaded_file.temporary_file_path())
            else:
                suffix = Path(getattr(uploaded_file, "name", "upload.bin")).suffix
                temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
                temp_path = Path(temp_file.name)
                try:
                    if hasattr(uploaded_file, "seek"):
                        uploaded_file.seek(0)
                    if hasattr(uploaded_file, "chunks"):
                        for chunk in uploaded_file.chunks():
                            temp_file.write(chunk)
                    else:
                        temp_file.write(uploaded_file.read())
                finally:
                    temp_file.close()
                upload_source = temp_path

            file_object = self.client.files.create(file=upload_source, purpose="file-extract")
        except Exception as exc:  # noqa: BLE001
            raise QwenExtractionError(f"Qwen 文件上传失败: {exc}") from exc
        finally:
            if temp_path and temp_path.exists():
                temp_path.unlink(missing_ok=True)

        file_id = getattr(file_object, "id", None)
        if not file_id:
            raise QwenExtractionError("Qwen 文件上传失败: 未返回 file_id")
        return file_id

    def _parse_output(self, raw_output: str) -> tuple[list[str], str]:
        tags_match = re.search(
            rf"{re.escape(self.TAG_START)}(.*?){re.escape(self.TAG_END)}",
            raw_output,
            re.DOTALL | re.IGNORECASE,
        )
        desc_match = re.search(
            rf"{re.escape(self.DESC_START)}(.*?){re.escape(self.DESC_END)}",
            raw_output,
            re.DOTALL | re.IGNORECASE,
        )

        if not tags_match or not desc_match:
            raise QwenExtractionError(
                "Qwen 输出格式不符合要求，缺少 TAGS 或 DESCRIPTION 标识符"
            )

        raw_tags = tags_match.group(1).strip()
        description = desc_match.group(1).strip()
        if not description:
            raise QwenExtractionError("Qwen 输出缺少描述内容")

        parts = re.split(r"[|,，、\n]+", raw_tags)
        tags = self._unique_keep_order(parts)[:12]
        if not tags:
            raise QwenExtractionError("Qwen 输出缺少标签")

        return tags, description

    def _extract_with_doc_turbo(self, prompt: str, doc_url: str) -> str:
        try:
            response = self.dashscope.Generation.call(
                api_key=self.api_key,
                model=self.doc_extract_model,
                messages=[
                    {
                        "role": "system",
                        "content": self.extract_system_prompt,
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "doc_url",
                                "doc_url": [doc_url],
                                "file_parsing_strategy": "auto",
                            },
                        ],
                    },
                ],
                result_format="message",
            )
        except Exception as exc:  # noqa: BLE001
            raise QwenExtractionError(f"Qwen doc-turbo 抽取失败: {exc}") from exc

        status_code = getattr(response, "status_code", None)
        if status_code != 200:
            code = getattr(response, "code", "")
            message = getattr(response, "message", "")
            raise QwenExtractionError(
                f"Qwen doc-turbo 抽取失败: status={status_code}, code={code}, message={message}"
            )

        try:
            return self._normalize_content(response.output.choices[0].message.content)
        except Exception as exc:  # noqa: BLE001
            raise QwenExtractionError(f"Qwen doc-turbo 返回内容异常: {exc}") from exc

    def _extract_with_qwen_long(self, prompt: str, file_id: str) -> str:
        try:
            completion = self.client.chat.completions.create(
                model=self.long_extract_model,
                messages=[
                    {"role": "system", "content": self.extract_system_prompt},
                    {"role": "system", "content": f"fileid://{file_id}"},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
            )
        except Exception as exc:  # noqa: BLE001
            raise QwenExtractionError(f"Qwen long 抽取失败: {exc}") from exc

        try:
            return self._normalize_content(completion.choices[0].message.content)
        except Exception as exc:  # noqa: BLE001
            raise QwenExtractionError(f"Qwen long 返回内容异常: {exc}") from exc

    def extract(self, file_id: str, file_name: str, doc_url: str | None = None) -> dict:
        prompt = self._render_prompt(
            self.extract_user_prompt_template,
            file_name=file_name,
        )

        doc_turbo_error = None
        raw_output = None
        if doc_url:
            try:
                raw_output = self._extract_with_doc_turbo(prompt, doc_url)
            except QwenExtractionError as exc:
                doc_turbo_error = str(exc)

        if not raw_output:
            try:
                raw_output = self._extract_with_qwen_long(prompt, file_id=file_id)
            except QwenExtractionError as exc:
                if doc_turbo_error:
                    raise QwenExtractionError(
                        f"{doc_turbo_error}; 回退 qwen-long 仍失败: {exc}"
                    ) from exc
                raise

        tags, description = self._parse_output(raw_output)
        return {
            "file_id": file_id,
            "tags": tags,
            "description": description,
            "raw_output": raw_output,
        }


def get_qwen_extractor() -> QwenKnowledgeExtractor:
    return QwenKnowledgeExtractor()
