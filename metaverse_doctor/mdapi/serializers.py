from rest_framework import serializers

from mdapi.models import (
    DoctorAvatarVideo,
    DoctorKnowledge,
    DoctorNarrativeAnnotation,
    DoctorNarrativeKernel,
    DoctorRehearsalFeedback,
    DoctorRehearsalMessage,
    DoctorRehearsalSession,
    DoctorVoiceProfile,
    KnowledgeTag,
)


class KnowledgeTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = KnowledgeTag
        fields = ["id", "name"]
        read_only_fields = fields


class DoctorKnowledgeSerializer(serializers.ModelSerializer):
    tags = KnowledgeTagSerializer(many=True, read_only=True)

    class Meta:
        model = DoctorKnowledge
        fields = [
            "id",
            "doctor",
            "file_name",
            "object_key",
            "oss_url",
            "content_type",
            "size_bytes",
            "etag",
            "upload_status",
            "knowledge_status",
            "extract_status",
            "qwen_file_id",
            "qwen_knowledge_base_id",
            "knowledge_description",
            "extract_raw_output",
            "extract_error",
            "extracted_at",
            "extract_retry_count",
            "tags",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "doctor",
            "object_key",
            "oss_url",
            "content_type",
            "size_bytes",
            "etag",
            "upload_status",
            "knowledge_status",
            "extract_status",
            "qwen_file_id",
            "qwen_knowledge_base_id",
            "knowledge_description",
            "extract_raw_output",
            "extract_error",
            "extracted_at",
            "extract_retry_count",
            "tags",
            "created_at",
            "updated_at",
        ]


class DoctorKnowledgeIndexSerializer(serializers.ModelSerializer):
    file_id = serializers.CharField(source="qwen_file_id", read_only=True)
    description = serializers.CharField(source="knowledge_description", read_only=True)
    tags = serializers.SerializerMethodField()

    class Meta:
        model = DoctorKnowledge
        fields = [
            "file_name",
            "file_id",
            "tags",
            "description",
        ]
        read_only_fields = fields

    def get_tags(self, obj):
        return [tag.name for tag in obj.tags.all()]


class DoctorVoiceProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = DoctorVoiceProfile
        fields = [
            "id",
            "name",
            "preferred_name",
            "target_model",
            "qwen_voice_id",
            "sample_file_name",
            "sample_oss_url",
            "sample_content_type",
            "sample_size_bytes",
            "is_active",
            "status",
            "error_message",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class DoctorAvatarVideoSerializer(serializers.ModelSerializer):
    class Meta:
        model = DoctorAvatarVideo
        fields = [
            "id",
            "image_file_name",
            "image_oss_url",
            "video_model",
            "scene_key",
            "scene_name",
            "prompt",
            "negative_prompt",
            "resolution",
            "duration_seconds",
            "prompt_extend",
            "watermark",
            "audio_enabled",
            "task_request_id",
            "task_id",
            "task_status",
            "video_url_external",
            "video_file_name",
            "video_oss_url",
            "video_content_type",
            "video_size_bytes",
            "error_message",
            "completed_at",
            "last_synced_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class DoctorNarrativeKernelSerializer(serializers.ModelSerializer):
    class Meta:
        model = DoctorNarrativeKernel
        fields = [
            "id",
            "schema_version",
            "kernel_name",
            "revision",
            "payload",
            "compiled_prompt",
            "last_annotation_at",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "schema_version",
            "kernel_name",
            "revision",
            "compiled_prompt",
            "last_annotation_at",
            "created_at",
            "updated_at",
        ]


class DoctorNarrativeAnnotationSerializer(serializers.ModelSerializer):
    class Meta:
        model = DoctorNarrativeAnnotation
        fields = [
            "id",
            "source",
            "question",
            "answer",
            "comment",
            "delta",
            "llm_applied",
            "llm_delta",
            "llm_error",
            "revision_after",
            "created_at",
        ]
        read_only_fields = fields


class DoctorRehearsalSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = DoctorRehearsalSession
        fields = [
            "id",
            "title",
            "status",
            "summary",
            "last_message_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class DoctorRehearsalMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = DoctorRehearsalMessage
        fields = [
            "id",
            "session",
            "role",
            "turn_index",
            "generation_status",
            "reply_to",
            "content",
            "content_markdown",
            "edited_markdown",
            "edited_at",
            "model_name",
            "selected_file_ids",
            "selected_file_meta",
            "grounding_answer",
            "grounding_sources",
            "search_sources",
            "input_tokens",
            "output_tokens",
            "total_tokens",
            "error_message",
            "meta",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class DoctorRehearsalFeedbackSerializer(serializers.ModelSerializer):
    annotation_id = serializers.IntegerField(
        source="narrative_annotation_id",
        read_only=True,
    )

    class Meta:
        model = DoctorRehearsalFeedback
        fields = [
            "id",
            "message",
            "comment",
            "edited_markdown",
            "status",
            "apply_to_kernel",
            "annotation_id",
            "error_message",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields
