from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIRequestFactory, force_authenticate
from unittest.mock import patch

from mdapi.models import CustomUser, DoctorRehearsalMessage, DoctorRehearsalSession
from mdapi.services.digital_human import (
    DigitalHumanServiceError,
    QwenDigitalHumanService,
    _obj_get,
    _to_plain_dict,
)
from mdapi.services.narrative_kernel import (
    apply_negative_rules_update,
    apply_annotation_update,
    deep_merge_dict,
    extract_negative_rules_from_comment,
    remove_negative_rules,
    render_narrative_kernel_dsl,
)
from mdapi.services.narrative_llm import QwenNarrativeOptimizer
from mdapi.services.rehearsal import DoctorRehearsalService, RehearsalServiceError
from mdapi.views import DoctorRehearsalAskStreamView, DoctorRehearsalMessageView


class DashScopeLikeResponse(dict):
    """Simulate dashscope DictMixin: missing attr raises KeyError instead of AttributeError."""

    def __getattr__(self, attr):
        return self[attr]


class DigitalHumanServiceHelperTests(SimpleTestCase):
    def test_to_plain_dict_handles_dashscope_style_response(self):
        response = DashScopeLikeResponse(
            status_code=200,
            request_id="req-1",
            output={"task_id": "task-1"},
        )
        data = _to_plain_dict(response)
        self.assertEqual(data["status_code"], 200)
        self.assertEqual(data["output"]["task_id"], "task-1")

    def test_obj_get_returns_default_when_key_missing(self):
        response = DashScopeLikeResponse(status_code=200)
        self.assertEqual(_obj_get(response, "missing", "fallback"), "fallback")

    def test_parse_video_response_with_dashscope_style_response(self):
        service = QwenDigitalHumanService.__new__(QwenDigitalHumanService)
        response = DashScopeLikeResponse(
            status_code=200,
            request_id="req-2",
            output=DashScopeLikeResponse(
                task_id="task-2",
                task_status="SUCCEEDED",
                video_url="https://example.com/video.mp4",
            ),
        )
        result = service._parse_video_response(response, "图生视频任务提交失败")
        self.assertEqual(result["task_id"], "task-2")
        self.assertEqual(result["task_status"], "succeeded")
        self.assertEqual(result["video_url"], "https://example.com/video.mp4")
        self.assertEqual(result["raw"]["request_id"], "req-2")

    def test_parse_video_response_raises_on_non_200(self):
        service = QwenDigitalHumanService.__new__(QwenDigitalHumanService)
        response = DashScopeLikeResponse(
            status_code=400,
            code="InvalidParameter",
            message="bad request",
        )
        with self.assertRaises(DigitalHumanServiceError):
            service._parse_video_response(response, "图生视频任务提交失败")

    def test_build_i2v_prompt_variants_with_custom_prompt(self):
        service = QwenDigitalHumanService.__new__(QwenDigitalHumanService)
        service.i2v_prompt_template = "默认提示词"
        service.i2v_prompt_variants = [
            {"key": "talking_explain", "name": "健康讲解", "prompt": "讲解场景"},
            {"key": "idle_standby", "name": "待机轻动", "prompt": "待机场景"},
        ]
        variants = service.build_i2v_prompt_variants(
            custom_prompt="语速慢一些",
            count=2,
        )
        self.assertEqual(len(variants), 2)
        self.assertEqual(variants[0]["scene_key"], "talking_explain")
        self.assertEqual(variants[1]["scene_name"], "待机轻动")
        self.assertIn("补充要求：语速慢一些", variants[0]["prompt"])

    def test_build_i2v_prompt_variants_clamps_count(self):
        service = QwenDigitalHumanService.__new__(QwenDigitalHumanService)
        service.i2v_prompt_template = "默认提示词"
        service.i2v_prompt_variants = [
            {"key": "a", "name": "A", "prompt": "A场景"},
            {"key": "b", "name": "B", "prompt": "B场景"},
        ]
        variants = service.build_i2v_prompt_variants(count=10)
        self.assertEqual(len(variants), 2)


class NarrativeKernelServiceTests(SimpleTestCase):
    def test_deep_merge_dict(self):
        base = {
            "KERNEL": {
                "CLINICAL_STYLE": {
                    "TREATMENT_PREFERENCE": "balanced",
                    "EXPLANATION_DEPTH": "layered",
                }
            }
        }
        patch = {
            "KERNEL": {"CLINICAL_STYLE": {"EXPLANATION_DEPTH": "detailed"}}
        }
        merged = deep_merge_dict(base, patch)
        self.assertEqual(
            merged["KERNEL"]["CLINICAL_STYLE"]["TREATMENT_PREFERENCE"],
            "balanced",
        )
        self.assertEqual(
            merged["KERNEL"]["CLINICAL_STYLE"]["EXPLANATION_DEPTH"],
            "detailed",
        )

    def test_apply_annotation_update(self):
        payload = {
            "KERNEL": {"CLINICAL_STYLE": {"TREATMENT_PREFERENCE": "balanced"}},
            "DYNAMIC": {"STATE": {"annotation_memory": []}},
        }
        updated, delta = apply_annotation_update(
            payload,
            comment="建议更保守一些，解释更详细",
            question="这个药风险大吗？",
            answer="风险存在，建议监测。",
            source="rehearsal",
            delta={"SCENE": {"TONE": ["calm_surface"]}},
            enable_rule_inference=True,
        )
        self.assertEqual(
            updated["KERNEL"]["CLINICAL_STYLE"]["TREATMENT_PREFERENCE"],
            "conservative",
        )
        self.assertEqual(
            updated["KERNEL"]["CLINICAL_STYLE"]["EXPLANATION_DEPTH"],
            "detailed",
        )
        self.assertEqual(updated["SCENE"]["TONE"], ["calm_surface"])
        self.assertTrue(updated["DYNAMIC"]["STATE"]["annotation_memory"])
        self.assertIn("KERNEL", delta)

    def test_render_narrative_kernel_dsl(self):
        payload = {
            "KERNEL": {
                "IDENTITY": {"NAME": "医生A"},
                "BIOLOGY": {"SOMATIC_MARKERS": ["steady_voice"]},
                "PSYCHOLOGY": {"SURFACE_DRIVE": ["safe_treatment"]},
                "SOCIAL_RULES": {"SPEAKING_STYLE": ["clear"]},
                "CLINICAL_STYLE": {"TREATMENT_PREFERENCE": "balanced"},
            },
            "FLAVOR": {"institution": "某医院"},
            "DYNAMIC": {"STATE": {"energy": "medium"}, "RELATION": {"TARGET": "Patient"}},
            "SCENE": {"LOCATION": ["outpatient_room"]},
        }
        text = render_narrative_kernel_dsl(payload)
        self.assertIn("[KERNEL.IDENTITY]", text)
        self.assertIn("[KERNEL.CLINICAL_STYLE]", text)
        self.assertIn("[DYNAMIC.STATE]", text)

    def test_extract_negative_rules_from_comment(self):
        rules = extract_negative_rules_from_comment(
            "这类回答不好，不要直接下结论；不能省略风险提示。"
        )
        self.assertTrue(any("不要" in item for item in rules))
        self.assertTrue(any("不能" in item for item in rules))

    def test_apply_and_remove_negative_rules(self):
        payload = {
            "KERNEL": {
                "SAFETY_RULES": {
                    "NEGATIVE_RULES": ["不要承诺百分百治愈"],
                    "BAD_RESPONSE_EXAMPLES": [],
                }
            }
        }
        updated, _, added = apply_negative_rules_update(
            payload,
            ["不要恐吓病人", "不要承诺百分百治愈"],
        )
        self.assertIn("不要恐吓病人", updated["KERNEL"]["SAFETY_RULES"]["NEGATIVE_RULES"])
        self.assertEqual(added, ["不要恐吓病人"])

        updated2, _, removed = remove_negative_rules(updated, ["不要恐吓病人"])
        self.assertIn("不要恐吓病人", removed)
        self.assertNotIn(
            "不要恐吓病人",
            updated2["KERNEL"]["SAFETY_RULES"]["NEGATIVE_RULES"],
        )

    def test_apply_annotation_without_rule_inference(self):
        payload = {
            "KERNEL": {"CLINICAL_STYLE": {"TREATMENT_PREFERENCE": "balanced"}},
            "DYNAMIC": {"STATE": {"annotation_memory": []}},
        }
        updated, _ = apply_annotation_update(
            payload,
            comment="建议更保守一些，解释更详细",
            question="这个药风险大吗？",
            answer="风险存在，建议监测。",
            source="rehearsal",
            delta={},
            negative_rules=[],
            enable_rule_inference=False,
        )
        self.assertEqual(
            updated["KERNEL"]["CLINICAL_STYLE"]["TREATMENT_PREFERENCE"],
            "balanced",
        )


class NarrativeLLMServiceTests(SimpleTestCase):
    def test_extract_json_text_from_markdown_code_block(self):
        raw = "```json\n{\"delta\": {\"KERNEL\": {}}, \"negative_rules\": []}\n```"
        json_text = QwenNarrativeOptimizer._extract_json_text(raw)
        self.assertEqual(
            json_text,
            "{\"delta\": {\"KERNEL\": {}}, \"negative_rules\": []}",
        )

    def test_normalize_result(self):
        parsed = {
            "delta": {"KERNEL": {"CLINICAL_STYLE": {"EXPLANATION_DEPTH": "detailed"}}},
            "negative_rules": ["不要绝对化表达", "", "  "],
            "reason": "医生强调风险沟通",
        }
        delta, rules, reason = QwenNarrativeOptimizer._normalize_result(parsed)
        self.assertIn("KERNEL", delta)
        self.assertEqual(rules, ["不要绝对化表达"])
        self.assertEqual(reason, "医生强调风险沟通")


class RehearsalServiceHelperTests(SimpleTestCase):
    def test_tokenize_question(self):
        tokens = DoctorRehearsalService._tokenize_question("高血压患者晚上头痛怎么办？")
        self.assertTrue(any("高血压" in token for token in tokens))

    def test_parse_json_from_text(self):
        data = DoctorRehearsalService._parse_json_from_text(
            '```json\n{"selected_file_ids":["file-1","file-2"]}\n```'
        )
        self.assertEqual(data["selected_file_ids"], ["file-1", "file-2"])

    def test_select_file_ids_returns_empty_when_no_relevant_candidates(self):
        service = DoctorRehearsalService.__new__(DoctorRehearsalService)
        result = service.select_file_ids_with_qwen_max(
            question="你好",
            candidates=[
                {
                    "knowledge_id": 1,
                    "file_id": "file-a",
                    "file_name": "a.pdf",
                    "description": "运动损伤文档",
                    "tags": ["运动损伤"],
                    "score": 0,
                },
                {
                    "knowledge_id": 2,
                    "file_id": "file-b",
                    "file_name": "b.pdf",
                    "description": "骨科指南",
                    "tags": ["骨科"],
                    "score": 0,
                },
            ],
        )
        self.assertEqual(result["selected_file_ids"], [])

    def test_build_final_messages_without_grounding_adds_no_file_hint(self):
        service = DoctorRehearsalService.__new__(DoctorRehearsalService)
        service.answer_system_prompt = "answer-system"
        messages = service.build_final_messages(
            narrative_kernel_prompt="kernel",
            grounding_answer="",
            history_messages=[],
            question="你好",
        )
        self.assertEqual(messages[0]["content"], "answer-system")
        self.assertIn("未命中医生私有知识文件", messages[2]["content"])

    def test_build_long_grounding_answer_fallbacks_to_single_file_merge(self):
        service = DoctorRehearsalService.__new__(DoctorRehearsalService)
        service.long_model = "qwen-long"
        service.long_system_prompt = "system"
        service.long_user_prompt = "问题：{{question}}"

        class _FakeCompletions:
            def __init__(self):
                self.calls = []

            def create(self, model, messages, temperature):  # noqa: ARG002
                file_ref = messages[1]["content"]
                self.calls.append(file_ref)
                if "," in file_ref:
                    raise Exception(  # noqa: BLE001
                        "Error code: 400 - {'error': {'message': 'Invalid file [id:file-b]'}}"
                    )

                class _Msg:
                    content = f"[KNOWLEDGE]ok {file_ref}[/KNOWLEDGE]\\n[SOURCES]\\n- {file_ref}\\n[/SOURCES]"

                class _Choice:
                    message = _Msg()

                class _Resp:
                    choices = [_Choice()]

                return _Resp()

        fake_completions = _FakeCompletions()
        service.compat_client = type(
            "FakeClient",
            (),
            {
                "chat": type(
                    "FakeChat",
                    (),
                    {"completions": fake_completions},
                )()
            },
        )()

        result = service.build_long_grounding_answer(
            question="测试问题",
            selected_file_ids=["file-a", "file-b"],
        )
        self.assertEqual(result["sources"], ["file-a", "file-b"])
        self.assertIn("[SOURCE fileid://file-a]", result["answer"])
        self.assertIn("[SOURCE fileid://file-b]", result["answer"])


class RehearsalViewTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.doctor = CustomUser.objects.create_user(
            username="doctor_rehearsal_tester",
            password="pass12345",
            is_doctor=True,
        )
        self.session = DoctorRehearsalSession.objects.create(
            doctor=self.doctor,
            title="演练测试会话",
        )

    def test_message_list_limit_without_negative_indexing(self):
        DoctorRehearsalMessage.objects.create(
            session=self.session,
            doctor=self.doctor,
            role="user",
            turn_index=1,
            content="问题1",
        )
        DoctorRehearsalMessage.objects.create(
            session=self.session,
            doctor=self.doctor,
            role="assistant",
            turn_index=1,
            content="回答1",
        )
        DoctorRehearsalMessage.objects.create(
            session=self.session,
            doctor=self.doctor,
            role="user",
            turn_index=2,
            content="问题2",
        )

        request = self.factory.get(
            f"/api/doctor/rehearsal/sessions/{self.session.id}/messages/?limit=2"
        )
        force_authenticate(request, user=self.doctor)
        response = DoctorRehearsalMessageView.as_view()(
            request, session_id=self.session.id
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["data"]["messages"]), 2)
        self.assertEqual(response.data["data"]["messages"][0]["content"], "回答1")
        self.assertEqual(response.data["data"]["messages"][1]["content"], "问题2")

    def test_ask_stream_creates_non_empty_assistant_placeholder(self):
        class _FakeRehearsalService:
            answer_model = "qwen-max-latest"
            history_limit = 12

            @staticmethod
            def build_ranked_candidates(question, knowledge_items):
                return []

            @staticmethod
            def select_file_ids_with_qwen_max(*, question, candidates):
                raise RehearsalServiceError("mock select failed")

        request = self.factory.post(
            f"/api/doctor/rehearsal/sessions/{self.session.id}/ask/stream/",
            {"question": "这是一个测试问题"},
            format="json",
        )
        force_authenticate(request, user=self.doctor)

        with patch(
            "mdapi.views.get_rehearsal_service",
            return_value=_FakeRehearsalService(),
        ):
            response = DoctorRehearsalAskStreamView.as_view()(
                request, session_id=self.session.id
            )

        self.assertEqual(response.status_code, 500)
        assistant_message = DoctorRehearsalMessage.objects.filter(
            session=self.session,
            role="assistant",
        ).first()
        self.assertIsNotNone(assistant_message)
        self.assertEqual(assistant_message.content, "[生成中]")
        self.assertEqual(assistant_message.generation_status, "failed")
