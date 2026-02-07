from rest_framework import serializers

from mdapi.models import DoctorKnowledge, KnowledgeTag


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
