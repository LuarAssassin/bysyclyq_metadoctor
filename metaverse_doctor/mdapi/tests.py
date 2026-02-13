from django.test import SimpleTestCase, TestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIRequestFactory, force_authenticate
from unittest.mock import patch

from mdapi.models import (
    CustomUser,
    DoctorNarrativeKernel,
    DoctorRehearsalMessage,
    DoctorRehearsalSession,
    PatientConsultMessage,
    PatientConsultSession,
)
from mdapi.services.digital_human import (
    DigitalHumanServiceError,
    QwenDigitalHumanService,
    _obj_get,
    _to_plain_dict,
)
from mdapi.services.narrative_kernel import (
    apply_negative_rules_update,
    apply_annotation_update,
    build_default_opening_text,
    deep_merge_dict,
    extract_negative_rules_from_comment,
    remove_negative_rules,
    render_narrative_kernel_dsl,
)
from mdapi.services.narrative_llm import QwenNarrativeOptimizer
from mdapi.services.rehearsal import DoctorRehearsalService, RehearsalServiceError
from mdapi.services.rehearsal_tts import DoctorRehearsalRealtimeTTS
from mdapi.views import (
    DoctorDigitalAvatarView,
    DoctorNarrativeOpeningView,
    DoctorPatientConsultMessageReviewView,
    DoctorPatientConsultSessionMessagesView,
    DoctorPatientConsultTreeView,
    DoctorRehearsalAskStreamView,
    DoctorRehearsalMessageView,
    PatientDoctorAssetsView,
    PatientASRTranscribeView,
    PatientConsultAskStreamView,
    PatientConsultMessageInterruptView,
    PatientConsultSessionView,
    PatientConsultSessionItemView,
    PatientDoctorDirectoryView,
    _build_patient_session_title,
)


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

    def test_build_default_opening_text(self):
        doctor = type(
            "DoctorStub",
            (),
            {
                "id": 10,
                "nickname": "杨渝平",
                "profession": "运动医学科",
                "institution": "北京大学第三医院",
                "username": "doctor_yang",
                "get_full_name": staticmethod(lambda: ""),
            },
        )()
        text = build_default_opening_text(doctor)
        self.assertIn("杨渝平医生", text)
        self.assertIn("北京大学第三医院", text)
        self.assertIn("运动医学科", text)

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


class RehearsalRealtimeTTSHelperTests(SimpleTestCase):
    def test_extract_completed_segments_by_sentence_end(self):
        segments, remainder = DoctorRehearsalRealtimeTTS.extract_completed_segments(
            "第一句。第二句？第三句",
            max_buffer_chars=120,
        )
        self.assertEqual(segments, ["第一句。", "第二句？"])
        self.assertEqual(remainder, "第三句")

    def test_extract_completed_segments_soft_break_when_too_long(self):
        text = "这是一段没有句号但会超过阈值的文本，需要在逗号位置切分，避免实时语音长时间无输出"
        segments, remainder = DoctorRehearsalRealtimeTTS.extract_completed_segments(
            text,
            max_buffer_chars=20,
        )
        self.assertTrue(segments)
        self.assertLessEqual(len(remainder), 20)

    def test_normalize_markdown_for_tts(self):
        text = (
            "## 处理建议\n"
            "- 先观察 24 小时\n"
            "- 再复查[1]\n"
            "[查看指南](https://example.com)\n"
            "依据检索结论[ref_2]调整治疗。\n"
            "`不要读出符号`"
        )
        normalized = DoctorRehearsalRealtimeTTS.normalize_markdown_for_tts(text)
        self.assertIn("先观察 24 小时", normalized)
        self.assertIn("再复查", normalized)
        self.assertIn("查看指南", normalized)
        self.assertIn("依据检索结论调整治疗。", normalized)
        self.assertNotIn("- 先观察", normalized)
        self.assertNotIn("##", normalized)
        self.assertNotIn("https://example.com", normalized)
        self.assertNotIn("[1]", normalized)
        self.assertNotIn("[ref_2]", normalized)
        self.assertNotIn("`", normalized)

    def test_append_text_pushes_each_chunk_immediately(self):
        calls = []

        class _FakeClient:
            @staticmethod
            def append_text(text):
                calls.append(text)

        service = DoctorRehearsalRealtimeTTS.__new__(DoctorRehearsalRealtimeTTS)
        service._client = _FakeClient()

        DoctorRehearsalRealtimeTTS.append_text(service, "第一段。")
        DoctorRehearsalRealtimeTTS.append_text(service, "第二段。")

        self.assertEqual(calls, ["第一段。", "第二段。"])


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


class DoctorDigitalAvatarViewTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.doctor = CustomUser.objects.create_user(
            username="doctor_avatar_tester",
            password="pass12345",
            is_doctor=True,
            is_active=True,
            doctor_apply_status="approved",
        )

    def test_upload_avatar_updates_doctor_avatar_url(self):
        image = SimpleUploadedFile(
            "doctor-avatar.png",
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR",
            content_type="image/png",
        )

        class _FakeOSS:
            @staticmethod
            def upload_file(uploaded_file, doctor_id, prefix):  # noqa: ARG004
                return {
                    "object_key": "doctor-digital-human/avatars/demo.png",
                    "oss_url": "https://oss.example.com/doctor-digital-human/avatars/demo.png",
                    "etag": "etag-1",
                    "size_bytes": uploaded_file.size,
                    "content_type": "image/png",
                }

        request = self.factory.post(
            "/api/doctor/digital-human/avatar/",
            {"image": image},
            format="multipart",
        )
        force_authenticate(request, user=self.doctor)

        with patch("mdapi.views.get_oss_client", return_value=_FakeOSS()):
            response = DoctorDigitalAvatarView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["data"]["avatar"],
            "https://oss.example.com/doctor-digital-human/avatars/demo.png",
        )
        self.doctor.refresh_from_db()
        self.assertEqual(
            self.doctor.avatar,
            "https://oss.example.com/doctor-digital-human/avatars/demo.png",
        )


class DoctorNarrativeOpeningViewTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.doctor = CustomUser.objects.create_user(
            username="doctor_opening_tester",
            password="pass12345",
            is_doctor=True,
            is_active=True,
            doctor_apply_status="approved",
        )

    def test_get_opening_returns_default_text(self):
        request = self.factory.get("/api/doctor/narrative-kernel/opening/")
        force_authenticate(request, user=self.doctor)

        response = DoctorNarrativeOpeningView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        self.assertIn("doctor_opening_tester医生", response.data["data"]["text"])
        self.assertIsNone(response.data["data"]["audio_url"])
        kernel = DoctorNarrativeKernel.objects.filter(doctor=self.doctor).first()
        self.assertIsNotNone(kernel)

    def test_put_opening_generates_audio_and_updates_kernel_payload(self):
        class _FakeOSS:
            @staticmethod
            def upload_file(uploaded_file, doctor_id, prefix):  # noqa: ARG004
                return {
                    "object_key": "doctor-digital-human/openings/test.wav",
                    "oss_url": "https://oss.example.com/doctor-digital-human/openings/test.wav",
                    "etag": "etag-opening-1",
                    "size_bytes": uploaded_file.size,
                    "content_type": "audio/wav",
                }

            @staticmethod
            def build_signed_get_url(object_key, expires=1800):  # noqa: ARG004
                return f"https://signed.example.com/{object_key}"

        request = self.factory.put(
            "/api/doctor/narrative-kernel/opening/",
            {"text": "您好，我是测试医生，很高兴为您服务。"},
            format="json",
        )
        force_authenticate(request, user=self.doctor)

        with patch("mdapi.views.get_oss_client", return_value=_FakeOSS()), patch(
            "mdapi.views._synthesize_doctor_opening_audio_wav",
            return_value={
                "audio_bytes": b"RIFF....WAVE",
                "content_type": "audio/wav",
                "sample_rate": 24000,
                "channels": 1,
                "stats": {},
            },
        ):
            response = DoctorNarrativeOpeningView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["data"]["opening"]["text"],
            "您好，我是测试医生，很高兴为您服务。",
        )
        self.assertEqual(
            response.data["data"]["opening"]["audio_url"],
            "https://signed.example.com/doctor-digital-human/openings/test.wav",
        )

        kernel = DoctorNarrativeKernel.objects.get(doctor=self.doctor)
        self.assertEqual(
            kernel.payload.get("OPENING", {}).get("text"),
            "您好，我是测试医生，很高兴为您服务。",
        )
        self.assertEqual(
            kernel.payload.get("OPENING", {}).get("audio_object_key"),
            "doctor-digital-human/openings/test.wav",
        )


class PatientConsultViewTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.patient = CustomUser.objects.create_user(
            username="patient_consult_tester",
            password="pass12345",
            is_doctor=False,
            is_active=True,
        )
        self.available_doctor = CustomUser.objects.create_user(
            username="approved_doctor_for_patient",
            password="pass12345",
            is_doctor=True,
            is_active=True,
            doctor_apply_status="approved",
        )
        self.pending_doctor = CustomUser.objects.create_user(
            username="pending_doctor_for_patient",
            password="pass12345",
            is_doctor=True,
            is_active=True,
            doctor_apply_status="pending",
        )
        self.inactive_doctor = CustomUser.objects.create_user(
            username="inactive_doctor_for_patient",
            password="pass12345",
            is_doctor=True,
            is_active=False,
            doctor_apply_status="approved",
        )

    def test_doctor_directory_only_returns_approved_active_doctors(self):
        request = self.factory.get("/api/patient/doctors/")
        force_authenticate(request, user=self.patient)

        response = PatientDoctorDirectoryView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        doctor_ids = [item["id"] for item in response.data["data"]]
        self.assertIn(self.available_doctor.id, doctor_ids)
        self.assertNotIn(self.pending_doctor.id, doctor_ids)
        self.assertNotIn(self.inactive_doctor.id, doctor_ids)

    def test_create_patient_session_with_approved_doctor(self):
        request = self.factory.post(
            "/api/patient/sessions/",
            {"doctor_id": self.available_doctor.id, "title": "首次问诊"},
            format="json",
        )
        force_authenticate(request, user=self.patient)

        response = PatientConsultSessionView.as_view()(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["data"]["doctor"]["id"], self.available_doctor.id)
        self.assertEqual(response.data["data"]["title"], "首次问诊")
        self.assertTrue(
            PatientConsultSession.objects.filter(
                patient=self.patient,
                doctor=self.available_doctor,
                title="首次问诊",
            ).exists()
        )

    def test_patient_doctor_assets_contains_opening_data(self):
        kernel, _ = DoctorNarrativeKernel.objects.get_or_create(
            doctor=self.available_doctor,
            defaults={
                "schema_version": "1.0",
                "kernel_name": "doctor_narrative_kernel",
                "revision": 1,
                "payload": {"KERNEL": {"IDENTITY": {"NAME": "医生"}}},
                "compiled_prompt": "[KERNEL.IDENTITY]\nNAME: 医生",
            },
        )
        kernel.payload = {
            **(kernel.payload if isinstance(kernel.payload, dict) else {}),
            "OPENING": {
                "text": "您好，我是示例医生。",
                "audio_object_key": "doctor-digital-human/openings/demo.wav",
                "audio_oss_url": "https://oss.example.com/doctor-digital-human/openings/demo.wav",
                "audio_content_type": "audio/wav",
            },
        }
        kernel.save(update_fields=["payload", "updated_at"])

        class _FakeOSS:
            @staticmethod
            def build_signed_get_url(object_key, expires=1800):  # noqa: ARG004
                return f"https://signed.example.com/{object_key}"

        request = self.factory.get(f"/api/patient/doctors/{self.available_doctor.id}/assets/")
        force_authenticate(request, user=self.patient)

        with patch("mdapi.views.get_oss_client", return_value=_FakeOSS()):
            response = PatientDoctorAssetsView.as_view()(
                request,
                doctor_id=self.available_doctor.id,
            )

        self.assertEqual(response.status_code, 200)
        opening = response.data["data"]["opening"]
        self.assertEqual(opening["text"], "您好，我是示例医生。")
        self.assertEqual(
            opening["audio_url"],
            "https://signed.example.com/doctor-digital-human/openings/demo.wav",
        )

    def test_patient_asr_transcribe_success(self):
        audio = SimpleUploadedFile(
            "patient-question.webm",
            b"webm-audio-data",
            content_type="audio/webm",
        )

        class _FakeASRService:
            @staticmethod
            def transcribe(uploaded_file, audio_mime_type=""):  # noqa: ARG004
                return {
                    "text": "我最近跑步后膝盖疼。",
                    "model": "qwen3-asr-flash",
                }

        request = self.factory.post(
            "/api/patient/asr/transcribe/",
            {"audio": audio},
            format="multipart",
        )
        force_authenticate(request, user=self.patient)

        with patch("mdapi.views.get_qwen_asr_service", return_value=_FakeASRService()):
            response = PatientASRTranscribeView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["text"], "我最近跑步后膝盖疼。")
        self.assertEqual(response.data["data"]["model"], "qwen3-asr-flash")

    def test_pin_patient_session(self):
        session = PatientConsultSession.objects.create(
            patient=self.patient,
            doctor=self.available_doctor,
            title="置顶会话测试",
            status="active",
        )

        request = self.factory.patch(
            f"/api/patient/sessions/{session.id}/",
            {"is_pinned": True},
            format="json",
        )
        force_authenticate(request, user=self.patient)

        response = PatientConsultSessionItemView.as_view()(request, session_id=session.id)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["data"]["is_pinned"])
        self.assertIsNotNone(response.data["data"]["pinned_at"])
        session.refresh_from_db()
        self.assertTrue(session.is_pinned)
        self.assertIsNotNone(session.pinned_at)

    def test_soft_delete_patient_session(self):
        session = PatientConsultSession.objects.create(
            patient=self.patient,
            doctor=self.available_doctor,
            title="删除会话测试",
            status="active",
        )
        message = PatientConsultMessage.objects.create(
            session=session,
            patient=self.patient,
            doctor=self.available_doctor,
            role="user",
            turn_index=1,
            generation_status="succeeded",
            content="测试消息",
            content_markdown="测试消息",
            model_name=None,
        )

        request = self.factory.delete(f"/api/patient/sessions/{session.id}/")
        force_authenticate(request, user=self.patient)

        response = PatientConsultSessionItemView.as_view()(request, session_id=session.id)

        self.assertEqual(response.status_code, 200)
        self.assertFalse(PatientConsultSession.objects.filter(id=session.id).exists())
        self.assertFalse(PatientConsultMessage.objects.filter(id=message.id).exists())
        deleted_session = PatientConsultSession.all_objects.get(id=session.id)
        deleted_message = PatientConsultMessage.all_objects.get(id=message.id)
        self.assertTrue(deleted_session.is_deleted)
        self.assertTrue(deleted_message.is_deleted)

    def test_interrupt_patient_generating_message(self):
        session = PatientConsultSession.objects.create(
            patient=self.patient,
            doctor=self.available_doctor,
            title="中断会话测试",
            status="active",
        )
        message = PatientConsultMessage.objects.create(
            session=session,
            patient=self.patient,
            doctor=self.available_doctor,
            role="assistant",
            turn_index=1,
            generation_status="generating",
            content="[生成中]",
            content_markdown="[生成中]",
            model_name="qwen-max-latest",
        )

        request = self.factory.post(
            f"/api/patient/sessions/{session.id}/messages/{message.id}/interrupt/",
            {"partial_content": "这是中断前的部分回答。"},
            format="json",
        )
        force_authenticate(request, user=self.patient)

        response = PatientConsultMessageInterruptView.as_view()(
            request,
            session_id=session.id,
            message_id=message.id,
        )

        self.assertEqual(response.status_code, 200)
        message.refresh_from_db()
        self.assertEqual(message.generation_status, "succeeded")
        self.assertEqual(message.content, "这是中断前的部分回答。")
        self.assertTrue(isinstance(message.meta, dict))
        self.assertTrue(message.meta.get("interrupted"))

    def test_patient_ask_stream_defaults_enable_audio_true(self):
        session = PatientConsultSession.objects.create(
            patient=self.patient,
            doctor=self.available_doctor,
            title="患者流式问诊会话",
        )

        class _FakeRehearsalService:
            answer_model = "qwen-max-latest"
            history_limit = 12

            @staticmethod
            def build_ranked_candidates(question, knowledge_items):  # noqa: ARG004
                return []

            @staticmethod
            def select_file_ids_with_qwen_max(*, question, candidates):  # noqa: ARG004
                return {"selected_file_ids": [], "reason": "no-match"}

            @staticmethod
            def build_long_grounding_answer(*, question, selected_file_ids):  # noqa: ARG004
                return {"answer": "", "sources": []}

            @staticmethod
            def build_final_messages(
                narrative_kernel_prompt,  # noqa: ARG004
                grounding_answer,  # noqa: ARG004
                history_messages,  # noqa: ARG004
                question,  # noqa: ARG004
            ):
                return [
                    {"role": "system", "content": "system"},
                    {"role": "user", "content": question},
                ]

            @staticmethod
            def stream_final_answer(*, messages, forced_search):  # noqa: ARG004
                yield {"type": "delta", "delta": "您好，"}
                yield {
                    "type": "done",
                    "content": "您好，已收到您的问题。",
                    "usage": {
                        "input_tokens": 11,
                        "output_tokens": 7,
                        "total_tokens": 18,
                    },
                    "search_sources": [],
                }

        class _FakeRealtimeTTS:
            def __init__(self, **kwargs):  # noqa: ANN003
                self._events = []

            def start(self):
                return None

            def append_text(self, text):
                if text:
                    self._events.append({"type": "audio_delta", "delta": "YXVkaW8x"})

            def drain_events(self, max_items=500):  # noqa: ARG002
                events = list(self._events)
                self._events.clear()
                return events

            def finish(self):
                return None

            def drain_until_done(self, max_wait_seconds=15.0):  # noqa: ARG002
                return [{"type": "audio_delta", "delta": "YXVkaW8y"}]

            @staticmethod
            def get_stats():
                return {
                    "audio_format": "pcm16",
                    "sample_rate": 24000,
                    "channels": 1,
                    "first_audio_delay_ms": 10,
                    "audio_chunk_count": 2,
                    "audio_base64_chars": 12,
                    "error": "",
                }

            def close(self):
                return None

        request = self.factory.post(
            f"/api/patient/sessions/{session.id}/ask/stream/",
            {"question": "我最近睡眠不太好"},
            format="json",
        )
        force_authenticate(request, user=self.patient)

        with patch(
            "mdapi.views.get_rehearsal_service",
            return_value=_FakeRehearsalService(),
        ), patch(
            "mdapi.views.DoctorRehearsalRealtimeTTS",
            _FakeRealtimeTTS,
        ):
            response = PatientConsultAskStreamView.as_view()(request, session_id=session.id)
            chunks = []
            for item in response.streaming_content:
                if isinstance(item, bytes):
                    chunks.append(item.decode("utf-8"))
                else:
                    chunks.append(str(item))
            body = "".join(chunks)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/event-stream")
        self.assertIn("event: start", body)
        self.assertIn('"enabled": true', body)
        self.assertIn("event: audio_delta", body)
        self.assertIn("event: done", body)

        user_message = PatientConsultMessage.objects.filter(
            session=session,
            role="user",
        ).first()
        assistant_message = PatientConsultMessage.objects.filter(
            session=session,
            role="assistant",
        ).first()
        self.assertIsNotNone(user_message)
        self.assertIsNotNone(assistant_message)
        self.assertEqual(assistant_message.generation_status, "succeeded")
        self.assertEqual(assistant_message.content, "您好，已收到您的问题。")

    def test_patient_first_question_updates_session_title_with_truncation(self):
        session = PatientConsultSession.objects.create(
            patient=self.patient,
            doctor=self.available_doctor,
            title=f"{self.available_doctor.username}问诊-20260212-000000",
        )
        question = "最近膝盖疼痛三周，尤其上下楼更明显，是否需要做核磁共振检查？"

        class _FakeRehearsalService:
            answer_model = "qwen-max-latest"
            history_limit = 12

            @staticmethod
            def build_ranked_candidates(question, knowledge_items):  # noqa: ARG004
                return []

            @staticmethod
            def select_file_ids_with_qwen_max(*, question, candidates):  # noqa: ARG004
                return {"selected_file_ids": [], "reason": "no-match"}

            @staticmethod
            def build_long_grounding_answer(*, question, selected_file_ids):  # noqa: ARG004
                return {"answer": "", "sources": []}

            @staticmethod
            def build_final_messages(
                narrative_kernel_prompt,  # noqa: ARG004
                grounding_answer,  # noqa: ARG004
                history_messages,  # noqa: ARG004
                question,  # noqa: ARG004
            ):
                return [
                    {"role": "system", "content": "system"},
                    {"role": "user", "content": question},
                ]

            @staticmethod
            def stream_final_answer(*, messages, forced_search):  # noqa: ARG004
                yield {"type": "delta", "delta": "已收到。"}
                yield {
                    "type": "done",
                    "content": "已收到。",
                    "usage": {
                        "input_tokens": 11,
                        "output_tokens": 7,
                        "total_tokens": 18,
                    },
                    "search_sources": [],
                }

        request = self.factory.post(
            f"/api/patient/sessions/{session.id}/ask/stream/",
            {"question": question, "enable_audio": False},
            format="json",
        )
        force_authenticate(request, user=self.patient)

        with patch(
            "mdapi.views.get_rehearsal_service",
            return_value=_FakeRehearsalService(),
        ):
            response = PatientConsultAskStreamView.as_view()(request, session_id=session.id)
            for _ in response.streaming_content:
                pass

        self.assertEqual(response.status_code, 200)
        session.refresh_from_db()
        self.assertEqual(session.title, _build_patient_session_title(question))


class DoctorPatientConsultReviewTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.doctor = CustomUser.objects.create_user(
            username="doctor_reviewer",
            password="pass12345",
            is_doctor=True,
            is_active=True,
            doctor_apply_status="approved",
        )
        self.other_doctor = CustomUser.objects.create_user(
            username="doctor_reviewer_other",
            password="pass12345",
            is_doctor=True,
            is_active=True,
            doctor_apply_status="approved",
        )
        self.patient = CustomUser.objects.create_user(
            username="patient_for_review",
            password="pass12345",
            is_doctor=False,
            is_active=True,
        )
        self.session = PatientConsultSession.objects.create(
            patient=self.patient,
            doctor=self.doctor,
            title="随访会话",
            status="active",
        )
        self.user_message = PatientConsultMessage.objects.create(
            session=self.session,
            patient=self.patient,
            doctor=self.doctor,
            role="user",
            turn_index=1,
            generation_status="succeeded",
            review_status="approved",
            content="我最近膝盖会疼",
            content_markdown="我最近膝盖会疼",
            model_name=None,
        )
        self.assistant_message = PatientConsultMessage.objects.create(
            session=self.session,
            patient=self.patient,
            doctor=self.doctor,
            role="assistant",
            turn_index=1,
            generation_status="succeeded",
            review_status="pending",
            reply_to=self.user_message,
            content="建议先休息两周。",
            content_markdown="建议先休息两周。",
            model_name="qwen-max-latest",
        )

    def test_tree_returns_patient_group_and_pending_count(self):
        request = self.factory.get("/api/doctor/patient-consults/tree/")
        force_authenticate(request, user=self.doctor)

        response = DoctorPatientConsultTreeView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        payload = response.data["data"]
        self.assertEqual(payload["session_count"], 1)
        self.assertEqual(payload["pending_count"], 1)
        self.assertEqual(len(payload["patients"]), 1)
        node = payload["patients"][0]
        self.assertEqual(node["patient"]["id"], self.patient.id)
        self.assertEqual(node["pending_count"], 1)
        self.assertEqual(node["session_count"], 1)

    def test_session_messages_returns_review_stats(self):
        request = self.factory.get(
            f"/api/doctor/patient-consults/sessions/{self.session.id}/messages/",
        )
        force_authenticate(request, user=self.doctor)

        response = DoctorPatientConsultSessionMessagesView.as_view()(
            request,
            session_id=self.session.id,
        )

        self.assertEqual(response.status_code, 200)
        payload = response.data["data"]
        self.assertEqual(payload["session"]["id"], self.session.id)
        self.assertEqual(payload["patient"]["id"], self.patient.id)
        self.assertEqual(len(payload["messages"]), 2)
        self.assertEqual(payload["stats"]["pending"], 1)
        self.assertEqual(payload["stats"]["approved"], 0)
        self.assertEqual(payload["stats"]["approved_edited"], 0)

    def test_review_message_approve_edited_updates_history_content(self):
        request = self.factory.post(
            f"/api/doctor/patient-consults/messages/{self.assistant_message.id}/review/",
            {
                "action": "approve_edited",
                "edited_markdown": "建议先减少跑步，并进行股四头肌力量训练。",
                "review_note": "更具体可执行",
            },
            format="json",
        )
        force_authenticate(request, user=self.doctor)

        response = DoctorPatientConsultMessageReviewView.as_view()(
            request,
            message_id=self.assistant_message.id,
        )

        self.assertEqual(response.status_code, 200)
        self.assistant_message.refresh_from_db()
        self.assertEqual(self.assistant_message.review_status, "approved_edited")
        self.assertEqual(
            self.assistant_message.content,
            "建议先减少跑步，并进行股四头肌力量训练。",
        )
        self.assertEqual(
            self.assistant_message.content_markdown,
            "建议先减少跑步，并进行股四头肌力量训练。",
        )
        self.assertEqual(
            self.assistant_message.edited_markdown,
            "建议先减少跑步，并进行股四头肌力量训练。",
        )
        self.assertEqual(self.assistant_message.review_note, "更具体可执行")

    def test_review_message_for_other_doctor_denied(self):
        request = self.factory.post(
            f"/api/doctor/patient-consults/messages/{self.assistant_message.id}/review/",
            {"action": "approve"},
            format="json",
        )
        force_authenticate(request, user=self.other_doctor)

        response = DoctorPatientConsultMessageReviewView.as_view()(
            request,
            message_id=self.assistant_message.id,
        )

        self.assertEqual(response.status_code, 404)
