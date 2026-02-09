from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from mdapi.models import CustomUser


class DoctorRegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)

    class Meta:
        model = CustomUser
        fields = [
            "id",
            "username",
            "password",
            "email",
            "phone",
            "nickname",
            "institution",
            "profession",
            "doctor_apply_status",
            "doctor_applied_at",
        ]
        read_only_fields = ["id", "doctor_apply_status", "doctor_applied_at"]

    def validate_username(self, value):
        exists = CustomUser.all_objects.filter(username=value).exists()
        if exists:
            raise serializers.ValidationError("用户名已存在")
        return value

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = CustomUser.objects.create_user(
            password=password,
            is_doctor=True,
            is_active=False,
            doctor_apply_status="pending",
            doctor_applied_at=timezone.now(),
            **validated_data,
        )
        return user


class PatientRegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)

    class Meta:
        model = CustomUser
        fields = [
            "id",
            "username",
            "password",
            "email",
            "phone",
            "nickname",
            "institution",
            "profession",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate_username(self, value):
        exists = CustomUser.all_objects.filter(username=value).exists()
        if exists:
            raise serializers.ValidationError("用户名已存在")
        return value

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = CustomUser.objects.create_user(
            password=password,
            is_doctor=False,
            is_active=True,
            **validated_data,
        )
        return user


class DoctorApplicationSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomUser
        fields = [
            "id",
            "username",
            "nickname",
            "email",
            "phone",
            "institution",
            "profession",
            "doctor_apply_status",
            "doctor_applied_at",
            "doctor_reviewed_at",
            "doctor_review_note",
            "created_at",
        ]
        read_only_fields = fields


class DoctorApplicationReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["approved", "rejected"])
    review_note = serializers.CharField(required=False, allow_blank=True, allow_null=True)


class DoctorTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def _query_user(cls, identifier: str):
        username_field = CustomUser.USERNAME_FIELD
        if hasattr(CustomUser, "all_objects"):
            return CustomUser.all_objects.filter(**{username_field: identifier}).first()
        return CustomUser.objects.filter(**{username_field: identifier}).first()

    def validate(self, attrs):
        username_field = CustomUser.USERNAME_FIELD
        identifier = attrs.get(username_field)
        if identifier:
            user = self._query_user(identifier)
            if user and user.is_doctor:
                if user.doctor_apply_status == "pending":
                    raise AuthenticationFailed("医生账号审核中，审核通过后才能登录")
                if user.doctor_apply_status == "rejected":
                    raise AuthenticationFailed("医生账号审核未通过，请联系管理员")
                if not user.is_active:
                    raise AuthenticationFailed("医生账号未激活，请联系管理员")

        data = super().validate(attrs)

        if self.user.is_doctor and self.user.doctor_apply_status != "approved":
            raise AuthenticationFailed("医生账号未审核通过，暂不可登录")

        return data
