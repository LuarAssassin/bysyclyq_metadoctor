"""Scoped, stable history pagination for retrospective reply review."""

from datetime import timedelta

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from mdapi.models import CustomUser, PatientConsultMessage, PatientConsultSession


class DoctorReviewPaginationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.doctor = CustomUser.objects.create_user(
            username="pagination-doctor", is_doctor=True, doctor_apply_status="approved"
        )
        cls.other_doctor = CustomUser.objects.create_user(
            username="pagination-other-doctor", is_doctor=True, doctor_apply_status="approved"
        )
        cls.patient = CustomUser.objects.create_user(username="pagination-patient")
        cls.other_patient = CustomUser.objects.create_user(username="pagination-other-patient")
        cls.session = PatientConsultSession.objects.create(
            doctor=cls.doctor, patient=cls.patient, title="合成分页测试"
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.doctor)

    def url(self, session=None):
        return reverse("doctor-patient-consult-session-messages", args=[(session or self.session).id])

    def message(self, *, session=None, **kwargs):
        session = session or self.session
        values = {
            "session": session, "doctor": session.doctor, "patient": session.patient,
            "role": "assistant", "content": "合成分页内容", "generation_status": "succeeded",
            "review_status": "pending",
        }
        values.update(kwargs)
        return PatientConsultMessage.objects.create(**values)

    def payload(self, **params):
        response = self.client.get(self.url(), params)
        self.assertEqual(response.status_code, 200)
        return response.data["data"]

    def test_long_conversation_can_reach_oldest_pending_message(self):
        now = timezone.now()
        messages = PatientConsultMessage.objects.bulk_create([
            PatientConsultMessage(
                session=self.session, doctor=self.doctor, patient=self.patient,
                role="assistant", content=f"合成回复 {index}", generation_status="succeeded",
                review_status="pending" if index == 0 else "approved",
                reviewed_at=None if index == 0 else now,
            ) for index in range(345)
        ])
        oldest = messages[0]
        PatientConsultMessage.objects.filter(pk=oldest.pk).update(created_at=now - timedelta(days=30))
        ids = []
        cursor = None
        page_lengths = []
        for _ in range(4):
            params = {"limit": 160}
            if cursor:
                params["before_message_id"] = cursor
            page = self.payload(**params)
            current_ids = [message["id"] for message in page["messages"]]
            page_lengths.append(len(current_ids))
            ids = current_ids + ids
            self.assertEqual(page["stats"]["pending"], 1)
            self.assertEqual(page["stats"]["approved"], 344)
            cursor = page["pagination"]["before_message_id"]
            if not page["pagination"]["has_more"]:
                self.assertIsNone(cursor)
                break
            self.assertEqual(cursor, current_ids[0])
        self.assertEqual(page_lengths, [160, 160, 25])
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(ids, [message.id for message in messages])
        self.assertEqual(ids[0], oldest.id)

    def test_identical_timestamps_are_paginated_by_id_without_gaps(self):
        messages = [self.message() for _ in range(8)]
        PatientConsultMessage.objects.filter(session=self.session).update(created_at=timezone.now())
        first = self.payload(limit=3)
        second = self.payload(limit=3, before_message_id=first["pagination"]["before_message_id"])
        third = self.payload(limit=3, before_message_id=second["pagination"]["before_message_id"])
        ids = [item["id"] for page in (third, second, first) for item in page["messages"]]
        self.assertEqual(ids, [message.id for message in messages])
        self.assertEqual(third["pagination"], {"has_more": False, "before_message_id": None})

    def test_invalid_or_missing_cursor_is_rejected(self):
        for cursor in ("", "abc", "1.5", "0", "-1", "9223372036854775808"):
            with self.subTest(cursor=cursor):
                self.assertEqual(self.client.get(self.url(), {"before_message_id": cursor}).status_code, 400)
        self.assertEqual(self.client.get(self.url(), {"before_message_id": 99999999}).status_code, 404)

    def test_cross_session_cross_doctor_and_deleted_anchors_are_rejected(self):
        other_session = PatientConsultSession.objects.create(
            doctor=self.doctor, patient=self.patient, title="另一个合成会话"
        )
        foreign_session = PatientConsultSession.objects.create(
            doctor=self.other_doctor, patient=self.other_patient, title="其他医生的合成会话"
        )
        own = self.message()
        for anchor in (self.message(session=other_session), self.message(session=foreign_session)):
            self.assertEqual(self.client.get(self.url(), {"before_message_id": anchor.id}).status_code, 404)
        PatientConsultMessage.objects.filter(pk=own.id).update(is_deleted=True)
        self.assertEqual(self.client.get(self.url(), {"before_message_id": own.id}).status_code, 404)
        self.assertEqual(self.client.get(self.url(foreign_session)).status_code, 404)
        self.client.force_authenticate(self.other_doctor)
        self.assertEqual(self.client.get(self.url()).status_code, 404)

    def test_scoped_stats_exclude_deleted_mismatched_and_incomplete_records(self):
        pending = self.message()
        self.message(review_status="approved", reviewed_at=timezone.now())
        self.message(review_status="approved")  # Legacy automatic approval is not a review.
        self.message(generation_status="failed")
        self.message(generation_status="generating")
        deleted = self.message()
        PatientConsultMessage.objects.filter(pk=deleted.pk).update(is_deleted=True)
        wrong_doctor = self.message()
        PatientConsultMessage.objects.filter(pk=wrong_doctor.pk).update(doctor=self.other_doctor)
        wrong_patient = self.message()
        PatientConsultMessage.objects.filter(pk=wrong_patient.pk).update(patient=self.other_patient)
        data = self.payload(limit=1)
        self.assertEqual(data["stats"], {"pending": 1, "approved": 1, "approved_edited": 0, "rejected": 0})
        self.assertTrue(data["pagination"]["has_more"])
        for item in (wrong_doctor, wrong_patient):
            self.assertEqual(self.client.get(self.url(), {"before_message_id": item.id}).status_code, 404)
        empty = self.payload(before_message_id=pending.id)
        self.assertEqual(empty["messages"], [])
        self.assertEqual(empty["pagination"], {"has_more": False, "before_message_id": None})
        self.assertEqual(empty["stats"], data["stats"])

    def test_deleted_session_or_patient_is_not_accessible(self):
        self.message()
        PatientConsultSession.objects.filter(pk=self.session.pk).update(is_deleted=True)
        self.assertEqual(self.client.get(self.url()).status_code, 404)
        PatientConsultSession.all_objects.filter(pk=self.session.pk).update(is_deleted=False)
        CustomUser.objects.filter(pk=self.patient.pk).update(is_deleted=True)
        self.assertEqual(self.client.get(self.url()).status_code, 404)

    @override_settings(USE_TZ=False)
    def test_pagination_also_works_with_production_naive_timestamps(self):
        first = self.message()
        second = self.message()
        PatientConsultMessage.objects.filter(session=self.session).update(created_at=timezone.now())
        page = self.payload(limit=1)
        self.assertEqual(page["messages"][0]["id"], second.id)
        older = self.payload(limit=1, before_message_id=page["pagination"]["before_message_id"])
        self.assertEqual(older["messages"][0]["id"], first.id)
        self.assertFalse(older["pagination"]["has_more"])

    def test_default_limit_and_empty_response_remain_compatible(self):
        data = self.payload()
        self.assertEqual(data["messages"], [])
        self.assertEqual(data["pagination"], {"has_more": False, "before_message_id": None})
        self.assertEqual(data["session"]["id"], self.session.id)
        self.assertEqual(data["patient"]["id"], self.patient.id)

    def test_all_review_counters_agree_before_and_after_review(self):
        mismatch_patient = CustomUser.objects.create_user(username="pagination-mismatch-patient")
        target = self.message()
        self.message()
        self.message(generation_status="generating")
        self.message(generation_status="failed")
        deleted_message = self.message()
        PatientConsultMessage.objects.filter(pk=deleted_message.pk).update(is_deleted=True)
        wrong_doctor = self.message()
        PatientConsultMessage.objects.filter(pk=wrong_doctor.pk).update(doctor=self.other_doctor)
        wrong_patient = self.message()
        PatientConsultMessage.objects.filter(pk=wrong_patient.pk).update(patient=mismatch_patient)
        deleted_session = PatientConsultSession.objects.create(
            doctor=self.doctor, patient=self.patient, title="删除会话样例"
        )
        self.message(session=deleted_session)
        PatientConsultSession.objects.filter(pk=deleted_session.pk).update(is_deleted=True)
        deleted_patient_session = PatientConsultSession.objects.create(
            doctor=self.doctor, patient=self.other_patient, title="删除患者样例"
        )
        self.message(session=deleted_patient_session)
        CustomUser.objects.filter(pk=self.other_patient.pk).update(is_deleted=True)
        foreign_session = PatientConsultSession.objects.create(
            doctor=self.other_doctor, patient=self.patient, title="其他医生样例"
        )
        self.message(session=foreign_session)
        malformed_session = PatientConsultSession.objects.create(
            doctor=self.doctor, patient=self.patient, title="仅有错配记录"
        )
        malformed_message = self.message(session=malformed_session)
        PatientConsultMessage.objects.filter(pk=malformed_message.pk).update(doctor=self.other_doctor)

        def assert_counts(expected):
            tree = self.client.get(reverse("doctor-patient-consult-tree")).data["data"]
            self.assertEqual(self.payload()["stats"]["pending"], expected)
            self.assertEqual(tree["pending_count"], expected)
            self.assertEqual(tree["session_count"], 1)
            self.assertEqual(len(tree["patients"]), 1)
            self.assertEqual(tree["patients"][0]["pending_count"], expected)
            self.assertEqual(tree["patients"][0]["sessions"][0]["pending_count"], expected)
            self.assertEqual(tree["patients"][0]["sessions"][0]["total_message_count"], 4)

        assert_counts(2)
        result = self.client.post(
            reverse("doctor-patient-consult-message-review", args=[target.id]),
            {"action": "approve"}, format="json",
        )
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["data"]["pending_count"], 1)
        assert_counts(1)

    def test_other_doctor_cannot_read_or_review_a_valid_historical_reply(self):
        earliest = self.message()
        self.message(review_status="approved", reviewed_at=timezone.now())
        self.client.force_authenticate(self.other_doctor)
        tree = self.client.get(reverse("doctor-patient-consult-tree")).data["data"]
        self.assertEqual(tree["patients"], [])
        self.assertEqual(self.client.get(self.url(), {"before_message_id": earliest.id}).status_code, 404)
        review_url = reverse("doctor-patient-consult-message-review", args=[earliest.id])
        self.assertEqual(self.client.post(review_url, {"action": "approve"}, format="json").status_code, 404)
        earliest.refresh_from_db()
        self.assertEqual(earliest.review_status, "pending")
        self.assertIsNone(earliest.reviewed_at)

    def test_review_does_not_mutate_deleted_or_mismatched_scope(self):
        mismatch_patient = CustomUser.objects.create_user(username="pagination-mismatch-patient")
        wrong_patient = self.message()
        PatientConsultMessage.objects.filter(pk=wrong_patient.pk).update(patient=mismatch_patient)
        deleted_message = self.message()
        PatientConsultMessage.objects.filter(pk=deleted_message.pk).update(is_deleted=True)
        deleted_session = PatientConsultSession.objects.create(
            doctor=self.doctor, patient=self.patient, title="删除会话样例"
        )
        in_deleted_session = self.message(session=deleted_session)
        PatientConsultSession.objects.filter(pk=deleted_session.pk).update(is_deleted=True)
        patient_session = PatientConsultSession.objects.create(
            doctor=self.doctor, patient=self.other_patient, title="删除患者样例"
        )
        for_deleted_patient = self.message(session=patient_session)
        CustomUser.objects.filter(pk=self.other_patient.pk).update(is_deleted=True)
        foreign_session = PatientConsultSession.objects.create(
            doctor=self.other_doctor, patient=self.patient, title="会话医生不一致样例"
        )
        wrong_session_doctor = self.message(session=foreign_session)
        PatientConsultMessage.objects.filter(pk=wrong_session_doctor.pk).update(doctor=self.doctor)
        for message in (wrong_patient, deleted_message, in_deleted_session, for_deleted_patient, wrong_session_doctor):
            with self.subTest(message_id=message.id):
                result = self.client.post(
                    reverse("doctor-patient-consult-message-review", args=[message.id]),
                    {"action": "approve"}, format="json",
                )
                self.assertEqual(result.status_code, 404)
                stored = PatientConsultMessage.all_objects.get(pk=message.pk)
                self.assertEqual(stored.review_status, "pending")
                self.assertIsNone(stored.reviewed_at)
