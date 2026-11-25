"""Workspace API regression tests with synthetic records only."""

from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch

from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from mdapi.models import (
    CustomUser,
    DoctorAvatarVideo,
    DoctorKnowledge,
    DoctorNarrativeKernel,
    DoctorRehearsalMessage,
    DoctorRehearsalSession,
    DoctorVoiceProfile,
    PatientConsultMessage,
    PatientConsultSession,
)


class DoctorWorkspaceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.doctor = CustomUser.objects.create_user(
            username="workspace-doctor",
            password="synthetic-test-only",
            nickname="示例医生",
            institution="示例院区",
            profession="运动医学",
            is_doctor=True,
            doctor_apply_status="approved",
        )
        cls.other_doctor = CustomUser.objects.create_user(
            username="workspace-other-doctor",
            password="synthetic-test-only",
            is_doctor=True,
            doctor_apply_status="approved",
        )
        cls.patient = CustomUser.objects.create_user(
            username="workspace-patient", nickname="患者示例", is_doctor=False
        )
        cls.second_patient = CustomUser.objects.create_user(
            username="workspace-patient-two", is_doctor=False
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.doctor)
        self.url = reverse("doctor-workspace")

    def session(self, *, doctor=None, patient=None):
        return PatientConsultSession.objects.create(
            doctor=doctor or self.doctor,
            patient=patient or self.patient,
            title="不应出现在工作台的模拟会话标题",
        )

    def message(self, session, *, role="assistant", review="pending", status="succeeded", at=None):
        msg = PatientConsultMessage.objects.create(
            session=session,
            doctor=session.doctor,
            patient=session.patient,
            role=role,
            content="不应出现在工作台的模拟病历正文",
            generation_status=status,
            review_status=review,
            reviewed_at=timezone.now() if review in {"approved", "approved_edited", "rejected"} else None,
            edited_markdown="模拟编辑结果" if review == "approved_edited" else None,
        )
        if at:
            PatientConsultMessage.objects.filter(pk=msg.pk).update(created_at=at)
        return msg

    def payload(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        return response.data["data"]

    def test_unauthenticated_and_patient_accounts_are_rejected(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.url).status_code, 401)
        self.client.force_authenticate(self.patient)
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_pending_rejected_inactive_and_deleted_doctors_are_rejected(self):
        for fields in (
            {"doctor_apply_status": "pending"},
            {"doctor_apply_status": "rejected"},
            {"is_active": False},
            {"is_deleted": True},
        ):
            with self.subTest(fields=fields):
                self.doctor.refresh_from_db()
                self.doctor.doctor_apply_status = "approved"
                self.doctor.is_active = True
                self.doctor.is_deleted = False
                for key, value in fields.items():
                    setattr(self.doctor, key, value)
                self.client.force_authenticate(self.doctor)
                self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_empty_workspace_has_zero_counts_seven_days_and_no_write(self):
        before = DoctorNarrativeKernel.objects.count()
        self.assertEqual(self.client.get(self.url)["Cache-Control"], "private, no-store")
        payload = self.payload()
        self.assertTrue(all(value == 0 for value in payload["counts"].values()))
        self.assertEqual(len(payload["trend"]), 7)
        self.assertTrue(all(day["ai_replies"] == day["patient_messages"] == 0 for day in payload["trend"]))
        self.assertEqual(payload["pending_sessions"], [])
        self.assertIsNone(payload["readiness"]["kernel_revision"])
        self.assertFalse(payload["readiness"]["kernel"])
        self.assertEqual(DoctorNarrativeKernel.objects.count(), before)

    def test_counts_deduplicate_patients_and_exclude_incomplete_replies(self):
        first = self.session()
        self.message(first, role="user")
        for review in ("pending", "approved", "approved_edited", "rejected"):
            self.message(first, review=review)
        self.message(first, status="generating")
        self.message(first, status="failed")
        second = self.session()
        self.message(second, role="user")
        self.message(second)
        third = self.session(patient=self.second_patient)
        self.message(third, role="user")
        self.session()  # Empty conversations are not counted as activity.
        payload = self.payload()
        self.assertEqual(payload["counts"], {
            "patients": 2,
            "sessions": 3,
            "ai_replies": 5,
            "pending_reviews": 2,
            "reviewed_replies": 3,
            "failed_replies": 1,
        })
        self.assertEqual(sum(row["pending_count"] for row in payload["pending_sessions"]), 2)

    def test_other_doctor_data_is_excluded_everywhere(self):
        other = self.session(doctor=self.other_doctor)
        self.message(other)
        DoctorKnowledge.objects.create(
            doctor=self.other_doctor, file_name="other.pdf", object_key="other.pdf",
            oss_url="https://example.invalid/other.pdf", extract_status="success", qwen_file_id="other",
        )
        DoctorNarrativeKernel.objects.create(
            doctor=self.other_doctor, compiled_prompt="other prompt", payload={"scope": "test"}
        )
        payload = self.payload()
        self.assertEqual(payload["counts"]["ai_replies"], 0)
        self.assertEqual(payload["pending_sessions"], [])
        self.assertEqual(payload["knowledge"]["total"], 0)
        self.assertFalse(payload["readiness"]["kernel"])
        self.assertTrue(all(day["ai_replies"] == 0 for day in payload["trend"]))

    def test_legacy_approved_status_without_review_timestamp_is_not_claimed_reviewed(self):
        message = self.message(self.session(), review="approved")
        PatientConsultMessage.objects.filter(pk=message.pk).update(reviewed_at=None)
        payload = self.payload()
        self.assertEqual(payload["counts"]["ai_replies"], 1)
        self.assertEqual(payload["counts"]["reviewed_replies"], 0)

    def test_soft_deleted_messages_sessions_and_patients_are_excluded(self):
        first = self.session()
        deleted_message = self.message(first)
        PatientConsultMessage.objects.filter(pk=deleted_message.pk).update(is_deleted=True)
        deleted_session = self.session()
        self.message(deleted_session)
        PatientConsultSession.objects.filter(pk=deleted_session.pk).update(is_deleted=True)
        deleted_patient_session = self.session(patient=self.second_patient)
        self.message(deleted_patient_session)
        CustomUser.objects.filter(pk=self.second_patient.pk).update(is_deleted=True)
        payload = self.payload()
        self.assertEqual(payload["counts"]["patients"], 0)
        self.assertEqual(payload["counts"]["sessions"], 0)
        self.assertEqual(payload["counts"]["pending_reviews"], 0)
        self.assertEqual(payload["pending_sessions"], [])

    def test_trend_uses_shanghai_day_boundaries_and_zero_fills(self):
        now = datetime(2026, 11, 12, 3, tzinfo=dt_timezone.utc)
        session = self.session()
        # Nov 6 00:00 in Shanghai: first included day.
        self.message(session, at=datetime(2026, 11, 5, 16, tzinfo=dt_timezone.utc))
        self.message(session, at=datetime(2026, 11, 5, 15, 59, tzinfo=dt_timezone.utc))
        # Nov 12 00:00 in Shanghai: today, despite UTC still being Nov 11.
        self.message(session, at=datetime(2026, 11, 11, 16, tzinfo=dt_timezone.utc))
        self.message(session, role="user", at=now)
        self.message(session, status="failed", at=now)
        # Tomorrow must not enter the seven-day chart.
        self.message(session, at=datetime(2026, 11, 12, 16, tzinfo=dt_timezone.utc))
        with patch("mdapi.workspace_views.timezone.now", return_value=now):
            payload = self.payload()
        self.assertEqual(payload["period"], {
            "start_date": "2026-11-06", "end_date": "2026-11-12",
            "time_zone": "Asia/Shanghai", "days": 7,
        })
        self.assertEqual(payload["trend"][0], {"date": "2026-11-06", "ai_replies": 1, "patient_messages": 0})
        self.assertEqual(payload["trend"][-1], {"date": "2026-11-12", "ai_replies": 1, "patient_messages": 1})
        self.assertEqual(payload["trend"][2]["ai_replies"], 0)
        self.assertEqual(payload["generated_at"], "2026-11-12T11:00:00+08:00")

    @override_settings(USE_TZ=False)
    def test_naive_mode_empty_workspace_uses_local_date_and_explicit_offset(self):
        # Production's USE_TZ=False returns a naive timezone.now().
        now = datetime(2026, 11, 12, 0, 15)
        with patch("mdapi.workspace_views.timezone.now", return_value=now):
            payload = self.payload()
        self.assertEqual(payload["period"]["end_date"], "2026-11-12")
        self.assertEqual(payload["period"]["time_zone"], "Asia/Shanghai")
        self.assertEqual(payload["generated_at"], "2026-11-12T00:15:00+08:00")
        self.assertEqual(len(payload["trend"]), 7)
        self.assertTrue(all(day["ai_replies"] == 0 for day in payload["trend"]))

    @override_settings(USE_TZ=False)
    def test_naive_mode_filters_and_groups_local_midnight_without_double_conversion(self):
        now = datetime(2026, 11, 12, 11)
        session = self.session()
        self.message(session, at=datetime(2026, 11, 5, 23, 59, 59))  # Before range.
        self.message(session, at=datetime(2026, 11, 6, 0))
        self.message(session, at=datetime(2026, 11, 11, 23, 59, 59))
        self.message(session, at=datetime(2026, 11, 12, 0))
        self.message(session, role="user", at=now)
        self.message(session, status="failed", at=now)
        self.message(session, at=datetime(2026, 11, 13, 0))  # After range.
        PatientConsultSession.objects.filter(pk=session.pk).update(last_message_at=now)
        with patch("mdapi.workspace_views.timezone.now", return_value=now):
            # Request-local timezone must not change the institution's day split.
            with timezone.override("America/New_York"):
                payload = self.payload()
        self.assertEqual(payload["period"], {
            "start_date": "2026-11-06", "end_date": "2026-11-12",
            "time_zone": "Asia/Shanghai", "days": 7,
        })
        self.assertEqual(payload["trend"][0], {"date": "2026-11-06", "ai_replies": 1, "patient_messages": 0})
        self.assertEqual(payload["trend"][-2], {"date": "2026-11-11", "ai_replies": 1, "patient_messages": 0})
        self.assertEqual(payload["trend"][-1], {"date": "2026-11-12", "ai_replies": 1, "patient_messages": 1})
        self.assertEqual(payload["generated_at"], "2026-11-12T11:00:00+08:00")
        self.assertEqual(payload["pending_sessions"][0]["last_message_at"], "2026-11-12T11:00:00+08:00")

    def test_aware_mode_keeps_institution_date_when_request_timezone_differs(self):
        now = datetime(2026, 11, 11, 16, 15, tzinfo=dt_timezone.utc)
        session = self.session()
        self.message(session, at=now)
        with patch("mdapi.workspace_views.timezone.now", return_value=now):
            with timezone.override("America/New_York"):
                payload = self.payload()
        self.assertEqual(payload["period"]["end_date"], "2026-11-12")
        self.assertEqual(payload["trend"][-1]["ai_replies"], 1)
        self.assertEqual(payload["generated_at"], "2026-11-12T00:15:00+08:00")

    def test_queue_is_bounded_oldest_first_and_omits_clinical_content(self):
        origin = datetime(2026, 11, 1, tzinfo=dt_timezone.utc)
        sessions = []
        for offset in range(7):
            session = self.session()
            sessions.append(session)
            self.message(session, at=origin + timedelta(days=offset))
        self.message(sessions[0], at=origin + timedelta(hours=1))
        response = self.client.get(self.url)
        payload = response.data["data"]
        self.assertEqual(len(payload["pending_sessions"]), 5)
        self.assertEqual([row["session_id"] for row in payload["pending_sessions"]], [row.id for row in sessions[:5]])
        self.assertEqual(payload["pending_sessions"][0]["pending_count"], 2)
        self.assertNotIn("模拟会话标题", response.content.decode())
        self.assertNotIn("模拟病历正文", response.content.decode())
        self.assertEqual(set(payload["pending_sessions"][0]), {"session_id", "patient", "pending_count", "last_message_at"})

    def test_knowledge_states_do_not_overlap_and_deleted_rows_are_excluded(self):
        variants = [
            {"extract_status": "success", "qwen_file_id": "ready"},
            {"extract_status": "queued"},
            {"extract_status": "success", "qwen_file_id": ""},
            {"extract_status": "success", "qwen_file_id": "bad", "knowledge_status": "failed"},
            {"extract_status": "failed"},
        ]
        for index, values in enumerate(variants):
            DoctorKnowledge.objects.create(
                doctor=self.doctor, file_name=f"sample-{index}.pdf",
                object_key=f"sample-{index}.pdf", oss_url=f"https://example.invalid/{index}.pdf",
                **values,
            )
        deleted = DoctorKnowledge.objects.create(
            doctor=self.doctor, file_name="deleted.pdf", object_key="deleted.pdf",
            oss_url="https://example.invalid/deleted.pdf",
        )
        DoctorKnowledge.objects.filter(pk=deleted.pk).update(is_deleted=True)
        payload = self.payload()
        self.assertEqual(payload["knowledge"], {"total": 5, "ready": 1, "processing": 2, "failed": 2})
        self.assertTrue(payload["readiness"]["knowledge"])

    def test_readiness_requires_available_assets_and_completed_rehearsal(self):
        DoctorNarrativeKernel.objects.create(
            doctor=self.doctor, revision=3, compiled_prompt="synthetic prompt", payload={"scope": "test"}
        )
        voice = DoctorVoiceProfile.objects.create(
            doctor=self.doctor, name="demo", preferred_name="demo", target_model="test",
            qwen_voice_id="synthetic-voice", sample_file_name="sample.wav", sample_object_key="sample.wav",
            sample_oss_url="https://example.invalid/sample.wav", status="ready", is_active=True,
        )
        video = DoctorAvatarVideo.objects.create(
            doctor=self.doctor, image_file_name="sample.png", image_object_key="sample.png",
            image_oss_url="https://example.invalid/sample.png", video_model="test", prompt="sample",
            task_id="synthetic-video", task_status="succeeded", video_object_key="sample.mp4",
        )
        session = DoctorRehearsalSession.objects.create(doctor=self.doctor, title="synthetic")
        message = DoctorRehearsalMessage.objects.create(
            doctor=self.doctor, session=session, role="assistant", generation_status="failed", content="sample"
        )
        payload = self.payload()
        self.assertTrue(payload["readiness"]["profile"])
        self.assertTrue(payload["readiness"]["kernel"])
        self.assertEqual(payload["readiness"]["kernel_revision"], 3)
        self.assertTrue(payload["readiness"]["voice"])
        self.assertTrue(payload["readiness"]["video"])
        self.assertFalse(payload["readiness"]["rehearsal"])
        DoctorRehearsalMessage.objects.filter(pk=message.pk).update(generation_status="succeeded")
        self.assertTrue(self.payload()["readiness"]["rehearsal"])
        DoctorRehearsalSession.objects.filter(pk=session.pk).update(is_deleted=True)
        DoctorVoiceProfile.objects.filter(pk=voice.pk).update(is_active=False)
        DoctorAvatarVideo.objects.filter(pk=video.pk).update(is_deleted=True)
        payload = self.payload()
        self.assertFalse(payload["readiness"]["voice"])
        self.assertFalse(payload["readiness"]["video"])
        self.assertFalse(payload["readiness"]["rehearsal"])

    def test_review_action_updates_workspace_counts(self):
        message = self.message(self.session())
        self.assertEqual(self.payload()["counts"]["pending_reviews"], 1)
        result = self.client.post(
            reverse("doctor-patient-consult-message-review", args=[message.id]),
            {"action": "approve"}, format="json",
        )
        self.assertEqual(result.status_code, 200)
        payload = self.payload()
        self.assertEqual(payload["counts"]["pending_reviews"], 0)
        self.assertEqual(payload["counts"]["reviewed_replies"], 1)
        self.assertEqual(payload["pending_sessions"], [])

    def test_query_budget_is_constant_when_queue_grows(self):
        with CaptureQueriesContext(connection) as empty_queries:
            self.payload()
        for _ in range(15):
            self.message(self.session())
        with CaptureQueriesContext(connection) as populated_queries:
            self.payload()
        self.assertEqual(len(populated_queries), len(empty_queries))
        self.assertLessEqual(len(populated_queries), 9)
        self.assertTrue(all(query["sql"].lstrip().upper().startswith("SELECT") for query in populated_queries))
