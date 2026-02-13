import copy
import json
from datetime import datetime, timezone
from typing import Any


DEFAULT_SCHEMA_VERSION = "1.0"
DEFAULT_KERNEL_NAME = "doctor_narrative_kernel"
DEFAULT_MAX_ANNOTATION_MEMORY = 30
DEFAULT_MAX_REDLINE_RULES = 100
DEFAULT_MAX_BAD_CASES = 50
DEFAULT_OPENING_PROMPT_SUFFIX = (
    "。我会结合您的描述，尽量提供专业、清晰的建议。请问今天有什么我可以帮您的吗？"
)


def _doctor_display_name(doctor) -> str:
    display_name = (
        getattr(doctor, "nickname", None)
        or getattr(doctor, "get_full_name", lambda: "")()
        or getattr(doctor, "username", "doctor")
    )
    display_name = str(display_name or "").strip() or "医生"
    if not display_name.endswith("医生"):
        display_name = f"{display_name}医生"
    return display_name


def build_default_opening_text(doctor) -> str:
    display_name = _doctor_display_name(doctor)
    profession = str(getattr(doctor, "profession", None) or "").strip()
    institution = str(getattr(doctor, "institution", None) or "").strip()

    opening = f"您好！我是{display_name}"
    if institution and profession:
        opening += f"，来自{institution}{profession}"
    elif institution:
        opening += f"，来自{institution}"
    elif profession:
        opening += f"，主要从事{profession}相关工作"
    opening += DEFAULT_OPENING_PROMPT_SUFFIX
    return opening


def build_default_narrative_payload(doctor) -> dict[str, Any]:
    display_name = _doctor_display_name(doctor)
    profession = getattr(doctor, "profession", None) or "临床医生"
    institution = getattr(doctor, "institution", None) or "未配置机构"

    return {
        "KERNEL": {
            "IDENTITY": {
                "ID": f"doctor_{doctor.id}",
                "NAME": display_name,
                "ROLE": f"{profession} / Patient Companion",
                "ARCHETYPE": [
                    "Evidence-Based Clinician",
                    "Calm Communicator",
                ],
            },
            "BIOLOGY": {
                "SOMATIC_MARKERS": [
                    "stable_breathing",
                    "measured_speaking_speed",
                ],
                "PHYSIOLOGY_BASELINE": {
                    "energy_management": "balanced_shift",
                    "fatigue_pattern": "night_shift_sensitive",
                },
                "MASLOW_BASELINE": {
                    "physiological": "conditionally_satisfied",
                    "safety": "structurally_challenged",
                    "belonging": "team_support_dependent",
                    "esteem": "derived_from_patient_outcomes",
                    "self_actualization": "through_clinical_mastery",
                },
            },
            "PSYCHOLOGY": {
                "SURFACE_DRIVE": [
                    "accurate_diagnosis",
                    "safe_treatment_plan",
                ],
                "HIDDEN_DESIRE": [
                    "be_trusted_by_patients",
                    "continuous_professional_growth",
                ],
                "CORE_FEAR": [
                    "miss_critical_risk",
                    "communication_misunderstanding",
                ],
                "DEFENSE_MECHANISMS": [
                    "structured_explanation_under_pressure",
                    "humor_used_sparingly_to_relieve_tension",
                ],
                "INTERNAL_CONFLICT": [
                    "speed_vs_thoroughness",
                    "guideline_rigidity_vs_personalized_care",
                ],
            },
            "SOCIAL_RULES": {
                "SPEAKING_STYLE": [
                    "clear",
                    "calm",
                    "actionable",
                ],
                "INTERACTION_RULES": [
                    "prioritize_patient_safety",
                    "avoid_unnecessary_alarm",
                    "state_risks_with_next_step",
                    "encourage_shared_decision_making",
                ],
            },
            "CLINICAL_STYLE": {
                "TREATMENT_PREFERENCE": "balanced",
                "RISK_TOLERANCE": "medium",
                "EXPLANATION_DEPTH": "layered",
                "EMPATHY_INTENSITY": "medium_high",
                "FOLLOWUP_STYLE": "checklist_and_milestones",
            },
            "SAFETY_RULES": {
                "NEGATIVE_RULES": [
                    "不要承诺百分百治愈",
                    "不要在证据不足时给出确定性诊断",
                    "避免制造恐慌式表达",
                    "涉及高风险场景必须给出线下就医建议",
                ],
                "BAD_RESPONSE_EXAMPLES": [],
            },
        },
        "FLAVOR": {
            "institution": institution,
            "specialty": profession,
            "language_preference": "zh-CN",
            "interaction_temperature": "warm_neutral",
        },
        "DYNAMIC": {
            "STATE": {
                "energy": "medium",
                "focus": "high",
                "confidence": "stable",
                "annotation_memory": [],
            },
            "RELATION": {
                "TARGET": "Patient",
                "LABEL": "trusted_care_partner",
                "VALUES": {
                    "trust": 0.5,
                    "clarity": 0.7,
                    "empathy": 0.6,
                    "boundary_awareness": 0.8,
                },
            },
        },
        "SCENE": {
            "LOCATION": ["outpatient_room"],
            "INTENT": ["clarify_condition_and_plan"],
            "TONE": ["calm_surface", "decision_focused"],
        },
        "OPENING": {
            "text": build_default_opening_text(doctor),
        },
    }


def deep_merge_dict(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    merged = copy.deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge_dict(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def infer_delta_from_comment(comment: str) -> dict[str, Any]:
    text = (comment or "").strip()
    lowered = text.lower()
    delta: dict[str, Any] = {"KERNEL": {"CLINICAL_STYLE": {}}}
    style_delta = delta["KERNEL"]["CLINICAL_STYLE"]

    if "保守" in text:
        style_delta["TREATMENT_PREFERENCE"] = "conservative"
    elif "激进" in text:
        style_delta["TREATMENT_PREFERENCE"] = "aggressive"
    elif "平衡" in text:
        style_delta["TREATMENT_PREFERENCE"] = "balanced"

    if "详细" in text or "解释" in text:
        style_delta["EXPLANATION_DEPTH"] = "detailed"
    if "简洁" in text or "简短" in text:
        style_delta["EXPLANATION_DEPTH"] = "concise"

    if "安抚" in text or "共情" in text:
        style_delta["EMPATHY_INTENSITY"] = "high"
    if "直接" in text or "干脆" in text or "直接一点" in lowered:
        style_delta["EMPATHY_INTENSITY"] = "medium"

    if not style_delta:
        return {}
    return delta


def _normalize_rule_text(rule: str) -> str:
    return str(rule or "").strip().strip("，,。.;；")


def _merge_unique_rules(
    current_rules: list[str],
    incoming_rules: list[str],
    max_rules: int = DEFAULT_MAX_REDLINE_RULES,
) -> tuple[list[str], list[str]]:
    normalized_current = []
    seen = set()
    for item in current_rules:
        value = _normalize_rule_text(item)
        if not value:
            continue
        lowered = value.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized_current.append(value)

    added = []
    for item in incoming_rules:
        value = _normalize_rule_text(item)
        if not value:
            continue
        lowered = value.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized_current.append(value)
        added.append(value)

    max_size = max(1, int(max_rules))
    normalized_current = normalized_current[:max_size]
    added = [item for item in added if item in normalized_current]
    return normalized_current, added


def extract_negative_rules_from_comment(comment: str) -> list[str]:
    text = (comment or "").strip()
    if not text:
        return []

    separators = ["。", "！", "？", "\n", ";", "；"]
    chunks = [text]
    for separator in separators:
        next_chunks: list[str] = []
        for chunk in chunks:
            next_chunks.extend(chunk.split(separator))
        chunks = next_chunks

    keywords = ("不要", "不能", "禁止", "避免", "不应", "别")
    rules: list[str] = []
    for chunk in chunks:
        sentence = chunk.strip(" ,，.。")
        if not sentence:
            continue
        if any(keyword in sentence for keyword in keywords):
            rules.append(sentence)
        elif "不好" in sentence or "不合适" in sentence:
            rules.append(f"避免：{sentence}")

    deduped, _ = _merge_unique_rules([], rules)
    return deduped


def apply_negative_rules_update(
    payload: dict[str, Any],
    rules: list[str] | None,
    *,
    max_rules: int = DEFAULT_MAX_REDLINE_RULES,
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    updated = copy.deepcopy(payload)
    kernel = updated.setdefault("KERNEL", {})
    safety_rules = kernel.setdefault("SAFETY_RULES", {})
    current_rules_raw = safety_rules.get("NEGATIVE_RULES", [])
    current_rules = current_rules_raw if isinstance(current_rules_raw, list) else []
    merged_rules, added_rules = _merge_unique_rules(
        current_rules,
        [str(item) for item in (rules or [])],
        max_rules=max_rules,
    )
    safety_rules["NEGATIVE_RULES"] = merged_rules

    delta = {}
    if added_rules:
        delta = {"KERNEL": {"SAFETY_RULES": {"NEGATIVE_RULES": merged_rules}}}
    return updated, delta, added_rules


def remove_negative_rules(
    payload: dict[str, Any],
    rules: list[str] | None,
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    target = {
        _normalize_rule_text(item).lower()
        for item in (rules or [])
        if _normalize_rule_text(item)
    }
    if not target:
        return copy.deepcopy(payload), {}, []

    updated = copy.deepcopy(payload)
    kernel = updated.setdefault("KERNEL", {})
    safety_rules = kernel.setdefault("SAFETY_RULES", {})
    current_rules_raw = safety_rules.get("NEGATIVE_RULES", [])
    current_rules = current_rules_raw if isinstance(current_rules_raw, list) else []

    next_rules: list[str] = []
    removed_rules: list[str] = []
    for item in current_rules:
        value = _normalize_rule_text(item)
        if not value:
            continue
        if value.lower() in target:
            removed_rules.append(value)
        else:
            next_rules.append(value)

    safety_rules["NEGATIVE_RULES"] = next_rules
    delta = {}
    if removed_rules:
        delta = {"KERNEL": {"SAFETY_RULES": {"NEGATIVE_RULES": next_rules}}}
    return updated, delta, removed_rules


def apply_annotation_update(
    payload: dict[str, Any],
    *,
    comment: str,
    question: str | None = None,
    answer: str | None = None,
    source: str = "rehearsal",
    delta: dict[str, Any] | None = None,
    negative_rules: list[str] | None = None,
    max_memory: int = DEFAULT_MAX_ANNOTATION_MEMORY,
    max_bad_cases: int = DEFAULT_MAX_BAD_CASES,
    enable_rule_inference: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    updated = copy.deepcopy(payload)

    dynamic = updated.setdefault("DYNAMIC", {})
    state = dynamic.setdefault("STATE", {})
    memory = state.setdefault("annotation_memory", [])
    if not isinstance(memory, list):
        memory = []

    memory.append(
        {
            "ts": datetime.now(timezone.utc).isoformat(),
            "source": source,
            "question": question or "",
            "answer": answer or "",
            "comment": comment,
        }
    )
    max_items = max(1, int(max_memory))
    state["annotation_memory"] = memory[-max_items:]

    auto_delta = infer_delta_from_comment(comment) if enable_rule_inference else {}
    merged_delta = auto_delta
    if delta:
        merged_delta = deep_merge_dict(auto_delta, delta)
    if merged_delta:
        updated = deep_merge_dict(updated, merged_delta)

    auto_negative_rules = (
        extract_negative_rules_from_comment(comment) if enable_rule_inference else []
    )
    explicit_negative_rules = [str(item) for item in (negative_rules or [])]
    all_negative_rules = auto_negative_rules + explicit_negative_rules
    if all_negative_rules:
        updated, redline_delta, _ = apply_negative_rules_update(updated, all_negative_rules)
        if redline_delta:
            merged_delta = deep_merge_dict(merged_delta, redline_delta)

    should_record_bad_case = bool(answer and all_negative_rules)
    if should_record_bad_case:
        kernel = updated.setdefault("KERNEL", {})
        safety_rules = kernel.setdefault("SAFETY_RULES", {})
        bad_cases_raw = safety_rules.get("BAD_RESPONSE_EXAMPLES", [])
        bad_cases = bad_cases_raw if isinstance(bad_cases_raw, list) else []
        bad_case = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "question": question or "",
            "answer": answer or "",
            "comment": comment,
        }
        bad_cases.append(bad_case)
        max_cases = max(1, int(max_bad_cases))
        safety_rules["BAD_RESPONSE_EXAMPLES"] = bad_cases[-max_cases:]

        bad_case_delta = {
            "KERNEL": {
                "SAFETY_RULES": {
                    "BAD_RESPONSE_EXAMPLES": safety_rules["BAD_RESPONSE_EXAMPLES"]
                }
            }
        }
        merged_delta = deep_merge_dict(merged_delta, bad_case_delta)

    return updated, merged_delta


def render_narrative_kernel_dsl(payload: dict[str, Any]) -> str:
    lines: list[str] = [
        "# ============================================================",
        "# NARRATIVE KERNEL DSL v1.0 (Doctor)",
        "# 可复用 · 可裁剪 · 可编译 · 支持 Dynamic State",
        "# ============================================================",
        "",
    ]

    section_order = [
        ("KERNEL.IDENTITY", "定义“这位医生是谁”"),
        ("KERNEL.BIOLOGY", "生理与工作节律"),
        ("KERNEL.PSYCHOLOGY", "稳定心理驱动"),
        ("KERNEL.SOCIAL_RULES", "互动与表达规则"),
        ("KERNEL.CLINICAL_STYLE", "诊疗策略与话术偏好"),
        ("FLAVOR", "可选风格层"),
        ("DYNAMIC.STATE", "动态状态"),
        ("DYNAMIC.RELATION", "关系状态"),
        ("SCENE", "场景注入"),
    ]

    for section_path, comment in section_order:
        section_data = _get_nested(payload, section_path.split("."))
        if section_data is None:
            continue
        lines.append(f"# {comment}")
        lines.append(f"[{section_path}]")
        _render_mapping(lines, section_data, indent=0)
        lines.append("")

    return "\n".join(lines).strip()


def _get_nested(source: dict[str, Any], path: list[str]) -> Any:
    current: Any = source
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _render_mapping(lines: list[str], value: Any, indent: int):
    prefix = " " * indent
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, (dict, list)):
                lines.append(f"{prefix}{key}:")
                _render_mapping(lines, item, indent + 2)
            else:
                lines.append(f"{prefix}{key}: {_format_scalar(item)}")
        return

    if isinstance(value, list):
        for item in value:
            if isinstance(item, (dict, list)):
                lines.append(f"{prefix}-")
                _render_mapping(lines, item, indent + 2)
            else:
                lines.append(f"{prefix}- {_format_scalar(item)}")
        if not value:
            lines.append(f"{prefix}- []")
        return

    lines.append(f"{prefix}{_format_scalar(value)}")


def _format_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if any(ch in text for ch in [":", "#", "[", "]"]):
        return json.dumps(text, ensure_ascii=False)
    return text
