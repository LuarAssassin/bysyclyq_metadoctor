from django.contrib import admin
from mdapi.models import (
    CustomUser,
    DoctorAvatarVideo,
    DoctorKnowledge,
    DoctorVoiceProfile,
    KnowledgeTag,
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
