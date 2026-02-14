from django.utils import timezone
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from mdapi.models import CustomUser
from mdapi.utils.tencent_sms import normalize_auth_target


def _generate_patient_username() -> str:
    return f"patient_{timezone.now().strftime('%Y%m%d%H%M%S%f')}"


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
    username = serializers.CharField(required=False, allow_blank=True, max_length=150)
    password = serializers.CharField(write_only=True, min_length=6, required=False, allow_blank=True)

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
        if not str(value or "").strip():
            return value
        exists = CustomUser.all_objects.filter(username=value).exists()
        if exists:
            raise serializers.ValidationError("用户名已存在")
        return value

    def create(self, validated_data):
        username = str(validated_data.pop("username", "") or "").strip()
        password = str(validated_data.pop("password", "") or "").strip() or None
        if not username:
            username = _generate_patient_username()
            while CustomUser.all_objects.filter(username=username).exists():
                username = _generate_patient_username()
        user = CustomUser.objects.create_user(
            username=username,
            password=password,
            is_doctor=False,
            is_active=True,
            **validated_data,
        )
        return user


class PatientAuthCodeSendSerializer(serializers.Serializer):
    channel = serializers.ChoiceField(choices=["sms", "email"])
    target = serializers.CharField(max_length=128)

    def validate(self, attrs):
        try:
            channel, target = normalize_auth_target(
                attrs.get("channel"),
                attrs.get("target"),
            )
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages[0] if exc.messages else str(exc))
        attrs["channel"] = channel
        attrs["target"] = target
        return attrs


class PatientAuthCodeLoginSerializer(PatientAuthCodeSendSerializer):
    code = serializers.CharField(max_length=8)
    nickname = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=50,
    )

    def validate_code(self, value):
        code = str(value or "").strip()
        if not code.isdigit() or len(code) < 4:
            raise serializers.ValidationError("验证码格式不正确")
        return code


class DoctorAuthCodeSendSerializer(PatientAuthCodeSendSerializer):
    pass


class DoctorAuthCodeLoginSerializer(DoctorAuthCodeSendSerializer):
    code = serializers.CharField(max_length=8)

    def validate_code(self, value):
        code = str(value or "").strip()
        if not code.isdigit() or len(code) < 4:
            raise serializers.ValidationError("验证码格式不正确")
        return code


class DoctorAuthCodeRegisterSerializer(DoctorAuthCodeLoginSerializer):
    nickname = serializers.CharField(max_length=50)
    institution = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=100,
    )
    profession = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=50,
    )

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


class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomUser
        fields = [
            "id",
            "username",
            "nickname",
            "email",
            "phone",
            "gender",
            "birthday",
            "age",
            "institution",
            "profession",
            "address",
            "avatar",
            "is_doctor",
            "doctor_apply_status",
            "doctor_applied_at",
            "doctor_reviewed_at",
            "doctor_review_note",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "username",
            "age",
            "avatar",
            "is_doctor",
            "doctor_apply_status",
            "doctor_applied_at",
            "doctor_reviewed_at",
            "doctor_review_note",
            "created_at",
            "updated_at",
        ]
