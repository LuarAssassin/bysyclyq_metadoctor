import json
import logging
import re
import time
from pathlib import Path
from typing import Any, Iterable

from django.conf import settings

logger = logging.getLogger("mdapi")


class RehearsalConfigurationError(Exception):
    """Raised when rehearsal service configuration is invalid."""


class RehearsalServiceError(Exception):
    """Raised when rehearsal flow fails."""


def _obj_get(source: Any, key: str, default: Any = None) -> Any:
    if source is None:
        return default
    if isinstance(source, dict):
        return source.get(key, default)
    get_method = getattr(source, "get", None)
    if callable(get_method):
        try:
            return get_method(key, default)
        except Exception:  # noqa: BLE001
            pass
    try:
        return getattr(source, key)
    except Exception:  # noqa: BLE001
        return default


def _normalize_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts).strip()
    return str(content or "").strip()


class DoctorRehearsalService:
    DEFAULT_SELECTOR_MODEL = "qwen3-max-2026-01-23"
    DEFAULT_LONG_MODEL = "qwen-long"
    DEFAULT_VL_MODEL = "qwen3-vl-plus"
    DEFAULT_ANSWER_MODEL = "qwen3.7-plus"

    DEFAULT_SELECT_SYSTEM_PROMPT = (
        "你是医学知识检索排序助手。"
        "当问题需要医生私有知识时再选择 file_id；若不需要则返回空数组。"
        "只输出 JSON。"
    )
    DEFAULT_SELECT_USER_PROMPT = (
        "用户问题：{{question}}\n"
        "候选文档列表(JSON)：\n{{candidates_json}}\n\n"
        "请输出 JSON:\n"
        "{\n"
        '  "selected_file_ids": ["file-xxx", "file-yyy"],\n'
        '  "reason": "一句话说明选择依据"\n'
        "}\n"
        "规则：\n"
        "1) selected_file_ids 最多 2 个。\n"
        "2) 若问题是寒暄/通用常识且不依赖医生私有文件，返回空数组 []。\n"
        "3) 不能编造不存在的 file_id。"
    )

    DEFAULT_LONG_SYSTEM_PROMPT = (
        "你是严谨的医学知识整理助手。"
        "基于给定 fileid 文档作答，必须标注出处。"
    )
    DEFAULT_LONG_USER_PROMPT = (
        "问题：{{question}}\n"
        "请基于给定文件输出结构：\n"
        "[KNOWLEDGE]\n"
        "这里写知识回答，要简洁、准确。\n"
        "[/KNOWLEDGE]\n"
        "[SOURCES]\n"
        "- fileid://xxx 说明该文件贡献了什么\n"
        "- fileid://yyy 说明该文件贡献了什么\n"
        "[/SOURCES]\n"
        "严禁编造文件外事实。"
    )

    DEFAULT_ANSWER_SYSTEM_PROMPT = (
        "你是元宇宙医生问诊演练助手。"
        "请结合内部知识摘要与联网结果回答，语气遵循医生人格底座。"
        "回答要先结论后解释，并给出明确下一步建议。"
        "若涉及风险场景，必须提示线下就医。"
    )
    DEFAULT_VL_ATTACHMENT_PROMPT = (
        "用户上传了医学相关图片，请结合图片内容回答问题。"
        "输出简洁结论与依据；若图片信息不足，请明确写出不确定点。"
        "不要编造图片中不存在的信息。"
    )

    def __init__(self):
        self.api_key = getattr(settings, "DASHSCOPE_API_KEY", "")
        if not self.api_key:
            raise RehearsalConfigurationError("缺少配置: DASHSCOPE_API_KEY")

        self.compat_base_url = getattr(
            settings,
            "DASHSCOPE_BASE_URL",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
        )
        self.responses_base_url = getattr(
            settings,
            "QWEN_RESPONSES_BASE_URL",
            "https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1",
        )

        self.selector_model = getattr(
            settings, "QWEN_REHEARSAL_SELECTOR_MODEL", self.DEFAULT_SELECTOR_MODEL
        )
        self.long_model = getattr(
            settings, "QWEN_REHEARSAL_LONG_MODEL", self.DEFAULT_LONG_MODEL
        )
        self.vl_model = getattr(
            settings, "QWEN_REHEARSAL_VL_MODEL", self.DEFAULT_VL_MODEL
        )
        self.answer_model = getattr(
            settings, "QWEN_REHEARSAL_ANSWER_MODEL", self.DEFAULT_ANSWER_MODEL
        )
        self.history_limit = int(getattr(settings, "QWEN_REHEARSAL_HISTORY_LIMIT", 12))
        self.search_strategy = getattr(settings, "QWEN_REHEARSAL_SEARCH_STRATEGY", "max")
        self.forced_search = bool(getattr(settings, "QWEN_REHEARSAL_FORCED_SEARCH", False))
        self.enable_citation = bool(getattr(settings, "QWEN_REHEARSAL_ENABLE_CITATION", True))
        self.prompt_dir = Path(
            getattr(settings, "PROMPT_DIR", Path(settings.BASE_DIR) / "prompts")
        )

        try:
            from openai import OpenAI
        except ImportError as exc:
            raise RehearsalConfigurationError("未安装 openai SDK，请执行: uv add openai") from exc
        try:
            import dashscope
            from dashscope import Generation
        except ImportError as exc:
            raise RehearsalConfigurationError(
                "未安装 dashscope SDK，请执行: uv add dashscope"
            ) from exc

        self.compat_client = OpenAI(api_key=self.api_key, base_url=self.compat_base_url)
        self.responses_client = OpenAI(api_key=self.api_key, base_url=self.responses_base_url)
        self.dashscope = dashscope
        self.Generation = Generation
        self.dashscope.base_http_api_url = self._to_dashscope_http_url(self.compat_base_url)

        self.select_system_prompt = self._load_prompt_text(
            "qwen/rehearsal_select_files_system.txt",
            self.DEFAULT_SELECT_SYSTEM_PROMPT,
        )
        self.select_user_prompt = self._load_prompt_text(
            "qwen/rehearsal_select_files_user.txt",
            self.DEFAULT_SELECT_USER_PROMPT,
        )
        self.long_system_prompt = self._load_prompt_text(
            "qwen/rehearsal_long_system.txt",
            self.DEFAULT_LONG_SYSTEM_PROMPT,
        )
        self.long_user_prompt = self._load_prompt_text(
            "qwen/rehearsal_long_user.txt",
            self.DEFAULT_LONG_USER_PROMPT,
        )
        self.answer_system_prompt = self._load_prompt_text(
            "qwen/rehearsal_answer_system.txt",
            self.DEFAULT_ANSWER_SYSTEM_PROMPT,
        )
        self.vl_attachment_prompt = self._load_prompt_text(
            "qwen/rehearsal_attachment_vl_prompt.txt",
            self.DEFAULT_VL_ATTACHMENT_PROMPT,
        )

    @staticmethod
    def _to_dashscope_http_url(base_url: str) -> str:
        value = (base_url or "").rstrip("/")
        if value.endswith("/compatible-mode/v1"):
            return value.replace("/compatible-mode/v1", "/api/v1")
        return value or "https://dashscope.aliyuncs.com/api/v1"

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
    def _parse_json_from_text(text: str) -> dict[str, Any]:
        content = (text or "").strip()
        if not content:
            raise RehearsalServiceError("大模型返回为空")
        code_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", content)
        if code_match:
            content = code_match.group(1).strip()
        else:
            start = content.find("{")
            end = content.rfind("}")
            if start == -1 or end == -1 or end <= start:
                raise RehearsalServiceError("大模型返回内容不含 JSON 对象")
            content = content[start : end + 1]
        try:
            data = json.loads(content)
        except Exception as exc:  # noqa: BLE001
            raise RehearsalServiceError(f"JSON 解析失败: {exc}") from exc
        if not isinstance(data, dict):
            raise RehearsalServiceError("大模型 JSON 顶层必须是对象")
        return data

    @staticmethod
    def _tokenize_question(question: str) -> list[str]:
        chunks = re.findall(r"[\u4e00-\u9fffA-Za-z0-9]+", question or "")
        keywords: list[str] = []
        for chunk in chunks:
            text = chunk.strip().lower()
            if len(text) < 2:
                continue
            keywords.append(text)
        # 去重保序
        seen = set()
        result = []
        for keyword in keywords:
            if keyword in seen:
                continue
            seen.add(keyword)
            result.append(keyword)
        return result[:24]

    def build_ranked_candidates(self, question: str, knowledge_items: Iterable[Any]) -> list[dict[str, Any]]:
        keywords = self._tokenize_question(question)
        ranked: list[dict[str, Any]] = []
        for item in knowledge_items:
            if not getattr(item, "qwen_file_id", None):
                continue
            tags = [tag.name for tag in item.tags.all()] if hasattr(item, "tags") else []
            text = " ".join(
                [
                    str(getattr(item, "file_name", "") or ""),
                    str(getattr(item, "knowledge_description", "") or ""),
                    " ".join(tags),
                ]
            ).lower()
            score = 0
            for keyword in keywords:
                if keyword in text:
                    score += 1
            ranked.append(
                {
                    "knowledge_id": item.id,
                    "file_id": item.qwen_file_id,
                    "file_name": item.file_name,
                    "description": item.knowledge_description or "",
                    "tags": tags,
                    "score": score,
                }
            )
        ranked.sort(key=lambda x: (x["score"], len(x["description"])), reverse=True)
        return ranked[:20]

    def select_file_ids_with_qwen_max(
        self,
        *,
        question: str,
        candidates: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not candidates:
            raise RehearsalServiceError("医生知识库为空，请先上传并完成知识抽取")

        positive_candidates = [
            item for item in candidates if int(item.get("score", 0) or 0) > 0
        ]
        if not positive_candidates:
            return {
                "selected_file_ids": [],
                "reason": "问题与医生私有知识相关性低，跳过知识库文件检索",
            }

        if len(candidates) <= 2:
            selected_ids = [item["file_id"] for item in positive_candidates][:2]
            return {
                "selected_file_ids": selected_ids,
                "reason": "候选文件较少，已按相关性直接选取",
            }

        prompt = self._render_prompt(
            self.select_user_prompt,
            question=question,
            candidates_json=json.dumps(candidates, ensure_ascii=False, indent=2),
        )
        try:
            response = self.responses_client.responses.create(
                model=self.selector_model,
                input=[
                    {"role": "system", "content": self.select_system_prompt},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                max_output_tokens=500,
            )
        except Exception as exc:  # noqa: BLE001
            raise RehearsalServiceError(f"Qwen-Max 选择 file_id 失败: {exc}") from exc

        output_text = str(getattr(response, "output_text", "") or "").strip()
        if not output_text:
            raise RehearsalServiceError("Qwen-Max 选择 file_id 返回为空")

        data = self._parse_json_from_text(output_text)
        selected_raw = data.get("selected_file_ids", [])
        if not isinstance(selected_raw, list):
            raise RehearsalServiceError("Qwen-Max 返回 selected_file_ids 格式错误")

        candidate_ids = {item["file_id"] for item in candidates}
        selected_ids = []
        seen = set()
        for item in selected_raw:
            file_id = str(item).strip()
            if not file_id or file_id in seen or file_id not in candidate_ids:
                continue
            seen.add(file_id)
            selected_ids.append(file_id)

        if not selected_ids:
            return {
                "selected_file_ids": [],
                "reason": str(data.get("reason", "")).strip() or "问题不需要医生私有知识",
                "raw_output": output_text,
            }

        if len(selected_ids) > 2:
            selected_ids = selected_ids[:2]

        return {
            "selected_file_ids": selected_ids,
            "reason": str(data.get("reason", "")).strip(),
            "raw_output": output_text,
        }

    def build_long_grounding_answer(
        self,
        *,
        question: str,
        selected_file_ids: list[str],
    ) -> dict[str, Any]:
        if not selected_file_ids:
            raise RehearsalServiceError("缺少 file_id，无法调用 qwen-long")

        user_prompt = self._render_prompt(self.long_user_prompt, question=question)
        file_ids = [str(file_id).strip() for file_id in selected_file_ids if str(file_id).strip()]
        file_ids_text = ",".join(file_ids)

        def _run_qwen_long(file_ref: str) -> str:
            try:
                completion = self.compat_client.chat.completions.create(
                    model=self.long_model,
                    messages=[
                        {"role": "system", "content": self.long_system_prompt},
                        {"role": "system", "content": file_ref},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.1,
                )
            except Exception as exc:  # noqa: BLE001
                raise RehearsalServiceError(f"qwen-long 知识归纳失败: {exc}") from exc

            try:
                return _normalize_content(completion.choices[0].message.content)
            except Exception as exc:  # noqa: BLE001
                raise RehearsalServiceError(f"qwen-long 返回内容异常: {exc}") from exc

        def _detect_sources(answer_text: str) -> list[str]:
            sources = []
            for file_id in file_ids:
                token = f"fileid://{file_id}"
                if token in answer_text:
                    sources.append(file_id)
            return sources

        # 优先尝试多 file_id 一次归纳；若连续失败且模型侧报 Invalid file，再回退为单文件逐个归纳后合并。
        multi_error_text = ""
        for attempt in range(1, 3):
            try:
                answer_text = _run_qwen_long(f"fileid://{file_ids_text}")
                sources = _detect_sources(answer_text)
                if not sources:
                    sources = list(file_ids)
                return {
                    "answer": answer_text,
                    "sources": sources,
                }
            except RehearsalServiceError as exc:
                multi_error_text = str(exc)
                if attempt < 2:
                    time.sleep(0.6)
                    continue
                if len(file_ids) <= 1 or "Invalid file [id:" not in multi_error_text:
                    raise
                logger.warning(
                    "qwen-long multi-file fallback to single-file merge. error=%s",
                    multi_error_text,
                )

        merged_parts: list[str] = []
        merged_sources: list[str] = []
        single_errors: list[str] = []
        for file_id in file_ids:
            try:
                part_text = _run_qwen_long(f"fileid://{file_id}")
                merged_parts.append(f"[SOURCE fileid://{file_id}]\n{part_text}")
                merged_sources.append(file_id)
            except RehearsalServiceError as single_exc:
                single_errors.append(f"{file_id}: {single_exc}")

        if not merged_parts:
            details = "；".join(single_errors) if single_errors else "未知错误"
            raise RehearsalServiceError(f"qwen-long 单文件回退失败: {details}")

        return {
            "answer": "\n\n".join(merged_parts),
            "sources": merged_sources,
        }

    def _run_vl_grounding_for_images(
        self,
        *,
        question: str,
        image_urls: list[str],
    ) -> str:
        normalized_urls = [
            str(url or "").strip()
            for url in image_urls
            if str(url or "").strip()
        ]
        if not normalized_urls:
            return ""

        prompt = (
            f"{self.vl_attachment_prompt}\n\n"
            f"用户问题：{question}\n"
            "请基于图片给出医疗相关结论和建议。"
        )
        content = [{"image": url} for url in normalized_urls]
        content.append({"text": prompt})

        try:
            response = self.dashscope.MultiModalConversation.call(
                api_key=self.api_key,
                model=self.vl_model,
                messages=[
                    {
                        "role": "user",
                        "content": content,
                    }
                ],
                result_format="message",
            )
        except Exception as exc:  # noqa: BLE001
            raise RehearsalServiceError(f"qwen-vl 图片分析失败: {exc}") from exc

        status_code = int(_obj_get(response, "status_code", 200) or 200)
        if status_code != 200:
            code = _obj_get(response, "code", "")
            message = _obj_get(response, "message", "")
            raise RehearsalServiceError(
                f"qwen-vl 图片分析失败: status={status_code}, code={code}, message={message}"
            )

        output = _obj_get(response, "output", {}) or {}
        choices = _obj_get(output, "choices", []) or []
        if not choices:
            raise RehearsalServiceError("qwen-vl 图片分析失败: 未返回 choices")

        message_obj = _obj_get(choices[0], "message", {}) or {}
        answer_text = _normalize_content(_obj_get(message_obj, "content", ""))
        if not answer_text:
            raise RehearsalServiceError("qwen-vl 图片分析失败: 输出为空")
        return answer_text

    @staticmethod
    def _strip_internal_source_sections(text: str) -> str:
        normalized = str(text or "").strip()
        if not normalized:
            return ""

        knowledge_match = re.search(
            r"\[\s*KNOWLEDGE\s*\](.*?)\[\s*/\s*KNOWLEDGE\s*\]",
            normalized,
            flags=re.DOTALL | re.IGNORECASE,
        )
        if knowledge_match:
            normalized = (knowledge_match.group(1) or "").strip()
        else:
            normalized = re.sub(
                r"\[\s*SOURCES\s*\][\s\S]*?\[\s*/\s*SOURCES\s*\]",
                "",
                normalized,
                flags=re.IGNORECASE,
            )

        normalized = re.sub(
            r"\[\s*/?\s*(?:PATIENT_IMAGE_NOTES|PATIENT_DOCUMENT_NOTES|KNOWLEDGE|SOURCES)\s*\]",
            "",
            normalized,
            flags=re.IGNORECASE,
        )
        normalized = re.sub(r"fileid://[A-Za-z0-9._-]+", "", normalized)

        cleaned_lines: list[str] = []
        for line in normalized.splitlines():
            line_text = line.strip()
            if not line_text:
                continue
            if "fileid://" in line_text:
                continue
            cleaned_lines.append(line_text)

        return "\n".join(cleaned_lines).strip()

    def build_attachment_grounding_answer(
        self,
        *,
        question: str,
        attachments: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not attachments:
            return {"answer": "", "sources": []}

        image_urls: list[str] = []
        doc_file_ids: list[str] = []
        source_ids: list[str] = []
        for item in attachments:
            file_id = str(item.get("file_id") or "").strip()
            file_kind = str(item.get("file_kind") or "").strip().lower()
            if file_id:
                source_ids.append(file_id)
            if file_kind == "image":
                image_url = str(
                    item.get("signed_url")
                    or item.get("preview_url")
                    or item.get("file_url")
                    or ""
                ).strip()
                if image_url:
                    image_urls.append(image_url)
                continue
            if file_kind == "document" and file_id:
                doc_file_ids.append(file_id)

        sections: list[str] = []
        errors: list[str] = []

        if image_urls:
            try:
                image_answer = self._run_vl_grounding_for_images(
                    question=question,
                    image_urls=image_urls,
                )
                cleaned_image_answer = self._strip_internal_source_sections(image_answer)
                if cleaned_image_answer:
                    sections.append(f"图片信息摘要：\n{cleaned_image_answer}")
            except RehearsalServiceError as exc:
                errors.append(str(exc))

        if doc_file_ids:
            try:
                doc_result = self.build_long_grounding_answer(
                    question=question,
                    selected_file_ids=doc_file_ids,
                )
                doc_answer = self._strip_internal_source_sections(
                    str(doc_result.get("answer", "") or "")
                )
                if doc_answer:
                    sections.append(f"文档信息摘要：\n{doc_answer}")
                source_ids.extend(
                    [
                        str(file_id).strip()
                        for file_id in doc_result.get("sources", []) or []
                        if str(file_id).strip()
                    ]
                )
            except RehearsalServiceError as exc:
                errors.append(str(exc))

        if not sections and errors:
            raise RehearsalServiceError("；".join(errors))

        dedup_sources: list[str] = []
        seen = set()
        for source_id in source_ids:
            if not source_id or source_id in seen:
                continue
            seen.add(source_id)
            dedup_sources.append(source_id)

        return {
            "answer": "\n\n".join(sections).strip(),
            "sources": dedup_sources,
        }

    def build_final_messages(
        self,
        *,
        narrative_kernel_prompt: str,
        grounding_answer: str,
        history_messages: list[dict[str, str]],
        question: str,
    ) -> list[dict[str, str]]:
        messages: list[dict[str, str]] = [
            {"role": "system", "content": self.answer_system_prompt},
            {"role": "system", "content": f"医生人格底座：\n{narrative_kernel_prompt}"},
        ]
        if (grounding_answer or "").strip():
            messages.append(
                {"role": "system", "content": f"内部知识摘要（含出处）：\n{grounding_answer}"}
            )
        else:
            messages.append(
                {
                    "role": "system",
                    "content": (
                        "本轮未命中医生私有知识文件。"
                        "请基于通用医学知识与联网信息回答，且不要伪造 fileid:// 出处。"
                    ),
                }
            )
        messages.extend(history_messages)
        messages.append({"role": "user", "content": question})
        return messages

    @staticmethod
    def _extract_stream_usage(usage_obj: Any) -> dict[str, int]:
        if not usage_obj:
            return {}
        return {
            "input_tokens": int(_obj_get(usage_obj, "input_tokens", 0) or 0),
            "output_tokens": int(_obj_get(usage_obj, "output_tokens", 0) or 0),
            "total_tokens": int(_obj_get(usage_obj, "total_tokens", 0) or 0),
        }

    def _should_use_compat_stream_api(self) -> bool:
        model_name = str(self.answer_model or "").strip().lower()
        return bool(re.match(r"^qwen3(?:[.-]|$)", model_name))

    def _stream_final_answer_via_compat_client(
        self,
        *,
        messages: list[dict[str, str]],
        search_options: dict[str, Any],
    ):
        try:
            stream = self.compat_client.chat.completions.create(
                model=self.answer_model,
                messages=messages,
                extra_body={
                    "enable_search": True,
                    "search_options": search_options,
                    "enable_thinking": False,
                },
                stream=True,
                stream_options={"include_usage": True},
            )
        except Exception as exc:  # noqa: BLE001
            raise RehearsalServiceError(
                f"{self.answer_model} 联网回答启动失败: {exc}"
            ) from exc

        full_text = ""
        usage: dict[str, int] = {}

        try:
            for chunk in stream:
                choices = _obj_get(chunk, "choices", []) or []
                delta_text = ""
                if choices:
                    delta_obj = _obj_get(choices[0], "delta", {}) or {}
                    delta_text = _normalize_content(_obj_get(delta_obj, "content", ""))
                if delta_text:
                    full_text += delta_text
                    yield {"type": "delta", "delta": delta_text}

                usage_chunk = self._extract_stream_usage(_obj_get(chunk, "usage", None))
                if usage_chunk and usage_chunk.get("total_tokens"):
                    usage = usage_chunk
        except Exception as exc:  # noqa: BLE001
            raise RehearsalServiceError(
                f"{self.answer_model} 联网回答失败: {exc}"
            ) from exc

        yield {
            "type": "done",
            "content": full_text,
            "usage": usage,
            "search_sources": [],
        }

    def stream_final_answer(
        self,
        *,
        messages: list[dict[str, str]],
        forced_search: bool | None = None,
    ):
        search_options = {
            "enable_source": True,
            "enable_citation": self.enable_citation,
            "citation_format": "[<number>]",
            "search_strategy": self.search_strategy,
            "forced_search": self.forced_search if forced_search is None else bool(forced_search),
        }

        if self._should_use_compat_stream_api():
            yield from self._stream_final_answer_via_compat_client(
                messages=messages,
                search_options=search_options,
            )
            return

        try:
            stream = self.Generation.call(
                api_key=self.api_key,
                model=self.answer_model,
                messages=messages,
                enable_search=True,
                search_options=search_options,
                result_format="message",
                stream=True,
                incremental_output=True,
            )
        except Exception as exc:  # noqa: BLE001
            raise RehearsalServiceError(
                f"{self.answer_model} 联网回答启动失败: {exc}"
            ) from exc

        full_text = ""
        usage: dict[str, int] = {}
        search_sources: list[dict[str, Any]] = []

        for chunk in stream:
            status_code = int(_obj_get(chunk, "status_code", 0) or 0)
            if status_code != 200:
                code = _obj_get(chunk, "code", "")
                message = _obj_get(chunk, "message", "")
                raise RehearsalServiceError(
                    f"{self.answer_model} 联网回答失败: status={status_code}, code={code}, message={message}"
                )

            output = _obj_get(chunk, "output", {}) or {}
            choices = _obj_get(output, "choices", []) or []
            delta_text = ""
            if choices:
                message_obj = _obj_get(choices[0], "message", {}) or {}
                delta_text = _normalize_content(_obj_get(message_obj, "content", ""))
            if delta_text:
                full_text += delta_text
                yield {"type": "delta", "delta": delta_text}

            usage_chunk = self._extract_stream_usage(_obj_get(chunk, "usage", None))
            if usage_chunk and usage_chunk.get("total_tokens"):
                usage = usage_chunk

            search_info = _obj_get(output, "search_info", None)
            if search_info:
                results = _obj_get(search_info, "search_results", None)
                if isinstance(results, list) and results:
                    search_sources = results

        yield {
            "type": "done",
            "content": full_text,
            "usage": usage,
            "search_sources": search_sources,
        }


def get_rehearsal_service() -> DoctorRehearsalService:
    return DoctorRehearsalService()
