import logging
import json
from pathlib import Path
import uuid
from urllib import error as url_error
from urllib import parse as url_parse
from urllib import request as url_request

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from mdapi.auth_serializers import (
    DoctorAuthCodeLoginSerializer,
    DoctorAuthCodeRegisterSerializer,
    DoctorAuthCodeSendSerializer,
    DoctorApplicationReviewSerializer,
    DoctorApplicationSerializer,
    DoctorRegisterSerializer,
    DoctorTokenObtainPairSerializer,
    PatientAuthCodeLoginSerializer,
    PatientAuthCodeSendSerializer,
    PatientGoogleLoginSerializer,
    PatientRegisterSerializer,
    UserProfileSerializer,
)
from mdapi.models import CustomUser
from mdapi.services.oss import (
    OSSConfigurationError,
    OSSReadError,
    OSSUploadError,
    extract_object_key_from_url,
    get_oss_client,
)
from mdapi.utils.tencent_sms import (
    PatientAuthCodeService,
    VerificationCodeConfigurationError,
    VerificationCodeError,
    VerificationCodeRateLimitError,
)
from mdapi.utils.api_response import APIResponse
from mdapi.utils.pagnition import StandardResultsSetPagination


logger = logging.getLogger("mdapi")


def _build_profile_avatar_url(avatar_url: str | None, *, oss_client=None) -> str | None:
    raw_url = str(avatar_url or "").strip()
    if not raw_url:
        return None

    object_key = extract_object_key_from_url(raw_url)
    if not object_key:
        return raw_url

    expire_seconds = int(
        getattr(settings, "OSS_AVATAR_SIGNED_URL_EXPIRE_SECONDS", 24 * 60 * 60)
    )
    try:
        client = oss_client or get_oss_client()
        return client.build_signed_get_url(object_key, expires=max(expire_seconds, 60))
    except (OSSConfigurationError, OSSReadError, AttributeError):
        return raw_url


def _serialize_profile(user, *, oss_client=None) -> dict:
    data = dict(UserProfileSerializer(user).data)
    data["avatar"] = _build_profile_avatar_url(data.get("avatar"), oss_client=oss_client)
    return data


def _default_patient_nickname(channel: str, target: str) -> str:
    safe_target = str(target or "")
    if channel == "sms":
        return f"患者{safe_target[-4:]}" if len(safe_target) >= 4 else "患者用户"
    username_part = safe_target.split("@", 1)[0]
    return username_part[:20] or "患者用户"


def _generate_patient_username() -> str:
    return f"patient_{timezone.now().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"


def _issue_tokens_for_user(user: CustomUser) -> dict:
    refresh = RefreshToken.for_user(user)
    return {
        "refresh": str(refresh),
        "access": str(refresh.access_token),
    }


def _find_patient_by_identity(channel: str, target: str) -> CustomUser | None:
    if channel == "sms":
        qs = CustomUser.objects.filter(is_doctor=False, phone=target)
    else:
        qs = CustomUser.objects.filter(is_doctor=False, email=target)

    count = qs.count()
    if count > 1:
        raise ValueError("该登录标识存在重复账号，请联系管理员处理")
    return qs.first()


def _find_doctor_by_identity(channel: str, target: str) -> CustomUser | None:
    if channel == "sms":
        qs = CustomUser.objects.filter(is_doctor=True, phone=target)
    else:
        qs = CustomUser.objects.filter(is_doctor=True, email=target)

    count = qs.count()
    if count > 1:
        raise ValueError("该登录标识存在重复医生账号，请联系管理员处理")
    return qs.first()


def _generate_doctor_username() -> str:
    return f"doctor_{timezone.now().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"


def _allowed_google_client_ids() -> list[str]:
    raw = str(getattr(settings, "GOOGLE_CLIENT_ID", "") or "").strip()
    return [item.strip() for item in raw.split(",") if item.strip()]


def _verify_google_identity_token(credential: str) -> dict:
    client_ids = _allowed_google_client_ids()
    if not client_ids:
        raise RuntimeError("Google 登录尚未配置，请联系管理员")

    token = str(credential or "").strip()
    if not token:
        raise ValueError("Google 凭证不能为空")

    query = url_parse.urlencode({"id_token": token})
    verify_url = f"https://oauth2.googleapis.com/tokeninfo?{query}"

    try:
        with url_request.urlopen(verify_url, timeout=8) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except url_error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        message = "Google 身份校验失败"
        if detail:
            try:
                parsed = json.loads(detail)
                message = str(
                    parsed.get("error_description")
                    or parsed.get("error")
                    or message
                )
            except json.JSONDecodeError:
                message = detail[:200]
        raise ValueError(message) from exc
    except (url_error.URLError, TimeoutError) as exc:
        raise ValueError("Google 身份校验网络异常，请稍后重试") from exc
    except json.JSONDecodeError as exc:
        raise ValueError("Google 身份校验响应解析失败") from exc

    audience = str(payload.get("aud") or "").strip()
    if audience not in client_ids:
        raise ValueError("Google 客户端不匹配，请刷新页面后重试")

    email = str(payload.get("email") or "").strip().lower()
    email_verified = str(payload.get("email_verified") or "").strip().lower()
    if email_verified not in {"true", "1"}:
        raise ValueError("Google 邮箱未验证，暂不支持登录")
    if not email:
        raise ValueError("Google 账号未返回邮箱")

    return {
        "email": email,
        "name": str(payload.get("name") or "").strip(),
    }


class DoctorRegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = DoctorRegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        data = DoctorApplicationSerializer(user).data
        return APIResponse.created(data=data, message="医生注册申请已提交，审核通过后可登录")


class PatientRegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PatientRegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        data = {
            "id": user.id,
            "username": user.username,
            "nickname": user.nickname,
            "email": user.email,
            "phone": user.phone,
            "created_at": user.created_at,
        }
        return APIResponse.created(data=data, message="患者注册成功")


class PatientAuthCodeSendView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PatientAuthCodeSendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        channel = serializer.validated_data["channel"]
        target = serializer.validated_data["target"]

        try:
            result = PatientAuthCodeService.send_code(channel=channel, target=target)
        except VerificationCodeRateLimitError as exc:
            return APIResponse.error(message=str(exc), code=429, status_code=status.HTTP_429_TOO_MANY_REQUESTS)
        except (VerificationCodeConfigurationError, VerificationCodeError) as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return APIResponse.success(
            data={
                "channel": result["channel"],
                "target": result["target"],
                "expire_seconds": result["expire_seconds"],
            },
            message="验证码已发送",
        )


class PatientAuthCodeLoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PatientAuthCodeLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        channel = serializer.validated_data["channel"]
        target = serializer.validated_data["target"]
        code = serializer.validated_data["code"]
        nickname_raw = serializer.validated_data.get("nickname")
        nickname = str(nickname_raw or "").strip()

        if not PatientAuthCodeService.verify_code(channel=channel, target=target, code=code):
            return APIResponse.error(message="验证码错误或已过期", code=400)

        try:
            user = _find_patient_by_identity(channel, target)
        except ValueError as exc:
            return APIResponse.error(message=str(exc), code=409, status_code=status.HTTP_409_CONFLICT)

        created = False
        if not user:
            username = _generate_patient_username()
            while CustomUser.all_objects.filter(username=username).exists():
                username = _generate_patient_username()
            user = CustomUser.objects.create_user(
                username=username,
                password=None,
                is_doctor=False,
                is_active=True,
                nickname=nickname or _default_patient_nickname(channel, target),
                phone=target if channel == "sms" else None,
                email=target if channel == "email" else None,
            )
            created = True
        else:
            update_fields = ["updated_at"]
            if not user.is_active:
                user.is_active = True
                update_fields.append("is_active")
            if channel == "sms" and not (user.phone or "").strip():
                user.phone = target
                update_fields.append("phone")
            if channel == "email" and not (user.email or "").strip():
                user.email = target
                update_fields.append("email")
            if nickname and not (user.nickname or "").strip():
                user.nickname = nickname
                update_fields.append("nickname")
            if update_fields:
                user.save(update_fields=update_fields)

        try:
            oss_client = get_oss_client()
        except OSSConfigurationError:
            oss_client = None

        return APIResponse.success(
            data={
                **_issue_tokens_for_user(user),
                "profile": _serialize_profile(user, oss_client=oss_client),
                "created": created,
                "login_channel": channel,
                "login_target": target,
            },
            message="登录成功",
        )


class PatientGoogleLoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PatientGoogleLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        credential = serializer.validated_data["credential"]

        try:
            google_profile = _verify_google_identity_token(credential)
        except RuntimeError as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        except ValueError as exc:
            return APIResponse.error(message=str(exc), code=400)

        email = str(google_profile.get("email") or "").strip().lower()
        nickname = str(google_profile.get("name") or "").strip()

        try:
            user = _find_patient_by_identity("email", email)
        except ValueError as exc:
            return APIResponse.error(message=str(exc), code=409, status_code=status.HTTP_409_CONFLICT)

        created = False
        if not user:
            username = _generate_patient_username()
            while CustomUser.all_objects.filter(username=username).exists():
                username = _generate_patient_username()
            user = CustomUser.objects.create_user(
                username=username,
                password=None,
                is_doctor=False,
                is_active=True,
                nickname=nickname or _default_patient_nickname("email", email),
                email=email,
            )
            created = True
        else:
            update_fields = ["updated_at"]
            if not user.is_active:
                user.is_active = True
                update_fields.append("is_active")
            if not (user.email or "").strip():
                user.email = email
                update_fields.append("email")
            if nickname and not (user.nickname or "").strip():
                user.nickname = nickname
                update_fields.append("nickname")
            if update_fields:
                user.save(update_fields=update_fields)

        try:
            oss_client = get_oss_client()
        except OSSConfigurationError:
            oss_client = None

        return APIResponse.success(
            data={
                **_issue_tokens_for_user(user),
                "profile": _serialize_profile(user, oss_client=oss_client),
                "created": created,
                "login_channel": "google",
                "login_target": email,
            },
            message="登录成功",
        )


class DoctorAuthCodeSendView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = DoctorAuthCodeSendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        channel = serializer.validated_data["channel"]
        target = serializer.validated_data["target"]

        try:
            result = PatientAuthCodeService.send_code(channel=channel, target=target)
        except VerificationCodeRateLimitError as exc:
            return APIResponse.error(message=str(exc), code=429, status_code=status.HTTP_429_TOO_MANY_REQUESTS)
        except (VerificationCodeConfigurationError, VerificationCodeError) as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return APIResponse.success(
            data={
                "channel": result["channel"],
                "target": result["target"],
                "expire_seconds": result["expire_seconds"],
            },
            message="验证码已发送",
        )


class DoctorAuthCodeRegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = DoctorAuthCodeRegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        channel = serializer.validated_data["channel"]
        target = serializer.validated_data["target"]
        code = serializer.validated_data["code"]
        nickname = str(serializer.validated_data.get("nickname") or "").strip()
        institution = str(serializer.validated_data.get("institution") or "").strip()
        profession = str(serializer.validated_data.get("profession") or "").strip()

        if not PatientAuthCodeService.verify_code(channel=channel, target=target, code=code):
            return APIResponse.error(message="验证码错误或已过期", code=400)

        try:
            existing = _find_doctor_by_identity(channel, target)
        except ValueError as exc:
            return APIResponse.error(message=str(exc), code=409, status_code=status.HTTP_409_CONFLICT)

        if existing and existing.doctor_apply_status == "approved" and existing.is_active:
            return APIResponse.error(
                message="该账号已审核通过，请直接登录",
                code=409,
                status_code=status.HTTP_409_CONFLICT,
            )

        if existing:
            was_pending = existing.doctor_apply_status == "pending"
            was_rejected = existing.doctor_apply_status == "rejected"
            doctor = existing
            update_fields = [
                "is_doctor",
                "nickname",
                "institution",
                "profession",
                "doctor_apply_status",
                "doctor_applied_at",
                "doctor_reviewed_at",
                "doctor_review_note",
                "is_active",
                "updated_at",
            ]
            doctor.nickname = nickname
            doctor.institution = institution or doctor.institution
            doctor.profession = profession or doctor.profession
            doctor.is_doctor = True
            doctor.is_active = False
            doctor.doctor_apply_status = "pending"
            doctor.doctor_applied_at = timezone.now()
            doctor.doctor_reviewed_at = None
            doctor.doctor_review_note = None
            if channel == "sms":
                doctor.phone = target
                update_fields.append("phone")
            else:
                doctor.email = target
                update_fields.append("email")
            doctor.save(update_fields=update_fields)
            action = "already_pending" if was_pending and not was_rejected else "reapplied"
            logger.info(
                "doctor code register resolved existing account: channel=%s target=%s doctor_id=%s action=%s",
                channel,
                target,
                doctor.id,
                action,
            )

            message = (
                "该账号已提交过医生申请，当前仍在审核中"
                if action == "already_pending"
                else "医生注册申请已重新提交，审核通过后可登录"
            )
            return APIResponse.success(
                data={
                    **DoctorApplicationSerializer(doctor).data,
                    "created": False,
                    "resubmitted": action == "reapplied",
                },
                message=message,
            )
        else:
            username = _generate_doctor_username()
            while CustomUser.all_objects.filter(username=username).exists():
                username = _generate_doctor_username()
            doctor = CustomUser.objects.create_user(
                username=username,
                password=None,
                is_doctor=True,
                is_active=False,
                doctor_apply_status="pending",
                doctor_applied_at=timezone.now(),
                nickname=nickname,
                institution=institution or None,
                profession=profession or None,
                phone=target if channel == "sms" else None,
                email=target if channel == "email" else None,
            )
            logger.info(
                "doctor code register created account: channel=%s target=%s doctor_id=%s",
                channel,
                target,
                doctor.id,
            )

        return APIResponse.created(
            data={
                **DoctorApplicationSerializer(doctor).data,
                "created": True,
                "resubmitted": False,
            },
            message="医生注册申请已提交，审核通过后可登录",
        )


class DoctorAuthCodeLoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = DoctorAuthCodeLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        channel = serializer.validated_data["channel"]
        target = serializer.validated_data["target"]
        code = serializer.validated_data["code"]

        if not PatientAuthCodeService.verify_code(channel=channel, target=target, code=code):
            return APIResponse.error(message="验证码错误或已过期", code=400)

        try:
            doctor = _find_doctor_by_identity(channel, target)
        except ValueError as exc:
            return APIResponse.error(message=str(exc), code=409, status_code=status.HTTP_409_CONFLICT)

        if not doctor:
            return APIResponse.not_found(message="医生账号不存在，请先完成注册申请")

        if doctor.doctor_apply_status == "pending":
            return APIResponse.error(
                message="医生账号审核中，审核通过后才能登录",
                code=403,
                status_code=status.HTTP_403_FORBIDDEN,
            )
        if doctor.doctor_apply_status == "rejected":
            return APIResponse.error(
                message="医生账号审核未通过，请联系管理员",
                code=403,
                status_code=status.HTTP_403_FORBIDDEN,
            )
        if not doctor.is_active:
            return APIResponse.error(
                message="医生账号未激活，请联系管理员",
                code=403,
                status_code=status.HTTP_403_FORBIDDEN,
            )

        try:
            oss_client = get_oss_client()
        except OSSConfigurationError:
            oss_client = None

        return APIResponse.success(
            data={
                **_issue_tokens_for_user(doctor),
                "profile": _serialize_profile(doctor, oss_client=oss_client),
                "login_channel": channel,
                "login_target": target,
            },
            message="登录成功",
        )


class DoctorTokenObtainPairView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = DoctorTokenObtainPairSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return APIResponse.success(data=serializer.validated_data, message="登录成功")


class DoctorApplicationListView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request):
        status_value = request.query_params.get("status", "pending")
        queryset = CustomUser.objects.filter(is_doctor=True).order_by("-doctor_applied_at")

        if status_value != "all":
            queryset = queryset.filter(doctor_apply_status=status_value)

        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer = DoctorApplicationSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class DoctorApplicationReviewView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def patch(self, request, user_id):
        doctor = CustomUser.objects.filter(id=user_id, is_doctor=True).first()
        if not doctor:
            return APIResponse.not_found(message="医生申请记录不存在")

        serializer = DoctorApplicationReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        review_status = serializer.validated_data["status"]
        review_note = serializer.validated_data.get("review_note")

        doctor.doctor_apply_status = review_status
        doctor.doctor_review_note = review_note
        doctor.doctor_reviewed_at = timezone.now()
        doctor.is_active = review_status == "approved"
        doctor.save(
            update_fields=[
                "doctor_apply_status",
                "doctor_review_note",
                "doctor_reviewed_at",
                "is_active",
                "updated_at",
            ]
        )

        data = DoctorApplicationSerializer(doctor).data
        return APIResponse.success(data=data, message="医生申请审核完成")


class CustomTokenRefreshView(TokenRefreshView):
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            return APIResponse.success(data=response.data, message="刷新成功")
        return response


class UserProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            oss_client = get_oss_client()
        except OSSConfigurationError:
            oss_client = None
        return APIResponse.success(
            data=_serialize_profile(request.user, oss_client=oss_client),
            message="获取成功",
        )

    def patch(self, request):
        payload = request.data.copy()
        payload.pop("phone", None)
        payload.pop("email", None)

        serializer = UserProfileSerializer(
            request.user,
            data=payload,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        try:
            oss_client = get_oss_client()
        except OSSConfigurationError:
            oss_client = None
        return APIResponse.success(
            data=_serialize_profile(request.user, oss_client=oss_client),
            message="保存成功",
        )

    def put(self, request):
        return self.patch(request)


class UserProfileAvatarView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        image_file = request.FILES.get("image")
        if not image_file:
            return APIResponse.error(message="请上传头像图片（字段名: image）", code=400)

        vl_config = getattr(settings, "QWEN_VL_UPLOAD_CONFIG", {})
        image_max_size = int(vl_config.get("IMAGE_MAX_FILE_SIZE", 10 * 1024 * 1024))
        allowed_image_extensions = {
            ext.lower() for ext in vl_config.get("IMAGE_ALLOWED_EXTENSIONS", [])
        }
        content_type = (image_file.content_type or "").lower()
        file_extension = Path(image_file.name or "").suffix.lower()

        if image_file.size > image_max_size:
            return APIResponse.error(
                message=f"头像图片超过大小限制（最大 {image_max_size // (1024 * 1024)}MB）",
                code=400,
            )
        if allowed_image_extensions and file_extension not in allowed_image_extensions:
            supported = ", ".join(sorted(allowed_image_extensions))
            return APIResponse.error(
                message=f"头像图片格式不支持，支持扩展名: {supported}",
                code=400,
            )
        if not (
            content_type.startswith("image/")
            or (allowed_image_extensions and file_extension in allowed_image_extensions)
        ):
            return APIResponse.error(message="上传文件不是图片类型", code=400)

        prefix = (
            "doctor-digital-human/avatars"
            if bool(getattr(request.user, "is_doctor", False))
            else "patient-avatars"
        )

        try:
            oss_client = get_oss_client()
            upload_result = oss_client.upload_file(
                image_file,
                doctor_id=request.user.id,
                prefix=prefix,
            )
        except (OSSConfigurationError, OSSUploadError) as exc:
            return APIResponse.error(
                message=str(exc),
                code=500,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        request.user.avatar = upload_result["oss_url"]
        request.user.save(update_fields=["avatar", "updated_at"])
        return APIResponse.success(
            data=_serialize_profile(request.user, oss_client=oss_client),
            message="头像上传成功",
        )
