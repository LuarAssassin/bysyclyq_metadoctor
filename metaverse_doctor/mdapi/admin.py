from django.contrib import admin
from mdapi.models import (
    CustomUser,
    DoctorAvatarVideo,
    DoctorKnowledge,
    DoctorNarrativeAnnotation,
    DoctorNarrativeKernel,
    DoctorRehearsalFeedback,
    DoctorRehearsalMessage,
    DoctorRehearsalSession,
    DoctorVoiceProfile,
    KnowledgeTag,
    PatientConsultMessage,
    PatientConsultSession,
)


@admin.register(CustomUser)
class CustomUserAdmin(admin.ModelAdmin):
    list_display = (
        "username",
        "nickname",
        "is_doctor",
        "doctor_apply_status",
        "is_staff",
        "is_active",
        "is_deleted",
        "date_joined",
    )
    list_filter = (
        "is_doctor",
        "doctor_apply_status",
        "is_staff",
        "is_active",
        "is_deleted",
    )
    search_fields = ("username", "nickname", "phone", "email")


@admin.register(DoctorKnowledge)
class DoctorKnowledgeAdmin(admin.ModelAdmin):
    list_display = (
        "file_name",
        "doctor",
        "upload_status",
        "knowledge_status",
        "extract_status",
        "extract_retry_count",
        "size_bytes",
        "created_at",
    )
    list_filter = ("upload_status", "knowledge_status", "extract_status", "is_deleted")
    search_fields = ("file_name", "doctor__username", "object_key")
    filter_horizontal = ("tags",)


@admin.register(KnowledgeTag)
class KnowledgeTagAdmin(admin.ModelAdmin):
    list_display = ("name", "created_at")
    search_fields = ("name",)


@admin.register(DoctorVoiceProfile)
class DoctorVoiceProfileAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "doctor",
        "target_model",
        "is_active",
        "status",
        "created_at",
    )
    list_filter = ("is_active", "status", "is_deleted")
    search_fields = ("name", "doctor__username", "qwen_voice_id", "preferred_name")


@admin.register(DoctorAvatarVideo)
class DoctorAvatarVideoAdmin(admin.ModelAdmin):
    list_display = (
        "scene_name",
        "image_file_name",
        "doctor",
        "video_model",
        "task_status",
        "duration_seconds",
        "resolution",
        "created_at",
    )
    list_filter = ("task_status", "video_model", "is_deleted")
    search_fields = ("scene_name", "image_file_name", "doctor__username", "task_id")


@admin.register(DoctorNarrativeKernel)
class DoctorNarrativeKernelAdmin(admin.ModelAdmin):
    list_display = (
        "doctor",
        "kernel_name",
        "schema_version",
        "revision",
        "last_annotation_at",
        "updated_at",
    )
    list_filter = ("schema_version", "is_deleted")
    search_fields = ("doctor__username", "doctor__nickname", "kernel_name")


@admin.register(DoctorNarrativeAnnotation)
class DoctorNarrativeAnnotationAdmin(admin.ModelAdmin):
    list_display = (
        "doctor",
        "source",
        "llm_applied",
        "revision_after",
        "created_at",
    )
    list_filter = ("source", "llm_applied", "is_deleted")
    search_fields = ("doctor__username", "comment", "question")


@admin.register(DoctorRehearsalSession)
class DoctorRehearsalSessionAdmin(admin.ModelAdmin):
    list_display = (
        "doctor",
        "title",
        "status",
        "last_message_at",
        "updated_at",
    )
    list_filter = ("status", "is_deleted")
    search_fields = ("doctor__username", "title", "summary")


@admin.register(DoctorRehearsalMessage)
class DoctorRehearsalMessageAdmin(admin.ModelAdmin):
    list_display = (
        "session",
        "doctor",
        "role",
        "turn_index",
        "generation_status",
        "total_tokens",
        "created_at",
    )
    list_filter = ("role", "generation_status", "is_deleted")
    search_fields = ("doctor__username", "content", "model_name")


@admin.register(DoctorRehearsalFeedback)
class DoctorRehearsalFeedbackAdmin(admin.ModelAdmin):
    list_display = (
        "doctor",
        "message",
        "status",
        "apply_to_kernel",
        "created_at",
    )
    list_filter = ("status", "apply_to_kernel", "is_deleted")
    search_fields = ("doctor__username", "comment", "message__content")


@admin.register(PatientConsultSession)
class PatientConsultSessionAdmin(admin.ModelAdmin):
    list_display = (
        "patient",
        "doctor",
        "title",
        "status",
        "last_message_at",
        "updated_at",
    )
    list_filter = ("status", "is_deleted")
    search_fields = ("patient__username", "doctor__username", "title", "summary")


@admin.register(PatientConsultMessage)
class PatientConsultMessageAdmin(admin.ModelAdmin):
    list_display = (
        "session",
        "patient",
        "doctor",
        "role",
        "turn_index",
        "generation_status",
        "total_tokens",
        "created_at",
    )
    list_filter = ("role", "generation_status", "is_deleted")
    search_fields = ("patient__username", "doctor__username", "content", "model_name")
