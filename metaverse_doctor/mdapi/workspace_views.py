"""Read-only summaries for the doctor's day-to-day workspace.

Review counts describe retrospective checks of generated replies. They are not
publication approvals, clinical outcomes, or a claim that a digital doctor is live.
"""

from datetime import datetime, time, timedelta

from django.conf import settings
from django.db.models import Count, F, Min, Q
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.views import APIView

from mdapi.models import (
    DoctorAvatarVideo,
    DoctorKnowledge,
    DoctorNarrativeKernel,
    DoctorRehearsalMessage,
    DoctorVoiceProfile,
    PatientConsultMessage,
)
from mdapi.utils.api_response import APIResponse


def _institution_time(value, tz):
    """Naive database timestamps use the project's configured local timezone."""
    if timezone.is_naive(value):
        return timezone.make_aware(value, tz)
    return timezone.localtime(value, tz)


class IsApprovedWorkspaceDoctor(BasePermission):
    message = "仅审核通过且有效的医生账号可查看工作台"

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and user.is_doctor
            and user.is_active
            and not user.is_deleted
            and user.doctor_apply_status == "approved"
        )


class DoctorWorkspaceView(APIView):
    permission_classes = [IsAuthenticated, IsApprovedWorkspaceDoctor]

    def get(self, request):
        doctor = request.user
        now = timezone.now()
        # Keep one institution-day definition even if a request activates another
        # timezone. The existing project stores local naive times (USE_TZ=False).
        tz = timezone.get_default_timezone()
        local_now = _institution_time(now, tz)
        today = local_now.date()
        first_day = today - timedelta(days=6)
        start = datetime.combine(first_day, time.min)
        end = datetime.combine(today + timedelta(days=1), time.min)
        if settings.USE_TZ:
            start = timezone.make_aware(start, tz)
            end = timezone.make_aware(end, tz)

        # Related-object managers do not automatically filter soft-deleted rows.
        messages = PatientConsultMessage.objects.filter(
            doctor=doctor,
            session__doctor=doctor,
            session__is_deleted=False,
            patient__is_deleted=False,
            patient_id=F("session__patient_id"),
        )
        succeeded = Q(role="assistant", generation_status="succeeded")
        pending = succeeded & Q(review_status="pending")
        counts = messages.aggregate(
            patients=Count("patient_id", distinct=True),
            sessions=Count("session_id", distinct=True),
            ai_replies=Count("id", filter=succeeded),
            pending_reviews=Count("id", filter=pending),
            reviewed_replies=Count(
                "id",
                filter=succeeded
                & Q(
                    review_status__in=["approved", "approved_edited", "rejected"],
                    reviewed_at__isnull=False,
                ),
            ),
            failed_replies=Count(
                "id", filter=Q(role="assistant", generation_status="failed")
            ),
        )

        daily_rows = (
            messages.filter(created_at__gte=start, created_at__lt=end)
            .order_by()
            .annotate(day=TruncDate("created_at", tzinfo=tz if settings.USE_TZ else None))
            .values("day")
            .annotate(
                ai_replies=Count("id", filter=succeeded),
                patient_messages=Count("id", filter=Q(role="user")),
            )
        )
        days = {row["day"]: row for row in daily_rows}
        trend = []
        for offset in range(7):
            day = first_day + timedelta(days=offset)
            values = days.get(day, {})
            trend.append(
                {
                    "date": day.isoformat(),
                    "ai_replies": values.get("ai_replies", 0),
                    "patient_messages": values.get("patient_messages", 0),
                }
            )

        # Oldest outstanding work first; fixed limit keeps the dashboard bounded.
        queue_rows = (
            messages.filter(pending)
            .order_by()
            .values(
                "session_id",
                "patient_id",
                "patient__nickname",
                "patient__username",
                "session__last_message_at",
            )
            .annotate(pending_count=Count("id"), oldest_pending_at=Min("created_at"))
            .order_by("oldest_pending_at", "session_id")[:5]
        )
        pending_sessions = [
            {
                "session_id": row["session_id"],
                "patient": {
                    "id": row["patient_id"],
                    "display_name": row["patient__nickname"]
                    or row["patient__username"],
                },
                "pending_count": row["pending_count"],
                "last_message_at": (
                    _institution_time(row["session__last_message_at"], tz).isoformat()
                    if row["session__last_message_at"] else None
                ),
            }
            for row in queue_rows
        ]

        failed_knowledge = (
            Q(upload_status="failed")
            | Q(knowledge_status="failed")
            | Q(extract_status="failed")
        )
        ready_knowledge = (
            ~failed_knowledge
            & Q(extract_status="success", qwen_file_id__isnull=False)
            & ~Q(qwen_file_id="")
        )
        knowledge = DoctorKnowledge.objects.filter(doctor=doctor).aggregate(
            total=Count("id"),
            ready=Count("id", filter=ready_knowledge),
            failed=Count("id", filter=failed_knowledge),
        )
        knowledge["processing"] = knowledge["total"] - knowledge["ready"] - knowledge["failed"]

        # Readiness describes configured assets, never review/release status.
        kernel = (
            DoctorNarrativeKernel.objects.filter(doctor=doctor)
            .values("revision", "compiled_prompt")
            .first()
        )
        readiness = {
            "profile": bool(
                (doctor.nickname or "").strip()
                and (doctor.institution or "").strip()
                and (doctor.profession or "").strip()
            ),
            "avatar": bool((doctor.avatar or "").strip()),
            "voice": DoctorVoiceProfile.objects.filter(
                doctor=doctor, is_active=True, status="ready"
            ).exists(),
            "video": DoctorAvatarVideo.objects.filter(
                doctor=doctor, task_status="succeeded"
            ).filter(
                (Q(video_object_key__isnull=False) & ~Q(video_object_key=""))
                | (Q(video_oss_url__isnull=False) & ~Q(video_oss_url=""))
            ).exists(),
            "kernel": bool(kernel and (kernel["compiled_prompt"] or "").strip()),
            "kernel_revision": kernel["revision"] if kernel else None,
            "knowledge": knowledge["ready"] > 0,
            "rehearsal": DoctorRehearsalMessage.objects.filter(
                doctor=doctor,
                session__doctor=doctor,
                session__is_deleted=False,
                role="assistant",
                generation_status="succeeded",
            ).exists(),
        }
        response = APIResponse.success(
            data={
                "profile": {
                    "id": doctor.id,
                    "display_name": doctor.nickname or doctor.username,
                    "institution": doctor.institution or "",
                    "profession": doctor.profession or "",
                },
                "counts": counts,
                "trend": trend,
                "period": {
                    "start_date": first_day.isoformat(),
                    "end_date": today.isoformat(),
                    "time_zone": str(tz),
                    "days": 7,
                },
                "pending_sessions": pending_sessions,
                "knowledge": knowledge,
                "readiness": readiness,
                "generated_at": local_now.isoformat(),
            },
            message="工作台已更新",
        )
        response["Cache-Control"] = "private, no-store"
        return response
