import json
import logging
import random
import re
from typing import Literal

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.utils import timezone

logger = logging.getLogger("mdapi")
audit_logger = logging.getLogger("mdapi.auth_code_audit")

AuthChannel = Literal["sms", "email"]
SUPPORTED_AUTH_CHANNELS: tuple[AuthChannel, AuthChannel] = ("sms", "email")
PHONE_PATTERN = re.compile(r"^1\d{10}$")
CODE_PATTERN = re.compile(r"^\d{4,8}$")


class VerificationCodeError(Exception):
    """验证码相关业务错误。"""


class VerificationCodeRateLimitError(VerificationCodeError):
    """触发验证码发送频率限制。"""

    def __init__(self, retry_after: int):
        self.retry_after = max(1, int(retry_after or 1))
        super().__init__(f"请求过于频繁，请 {self.retry_after} 秒后再试")


class VerificationCodeConfigurationError(VerificationCodeError):
    """短信/邮件服务配置错误。"""


class VerificationCodeSendError(VerificationCodeError):
    """短信/邮件网关发送失败。"""


def normalize_phone(raw_phone: str) -> str:
    value = re.sub(r"[\s\-()]+", "", str(raw_phone or "").strip())
    if value.startswith("+86"):
        value = value[3:]
    elif value.startswith("86") and len(value) == 13:
        value = value[2:]
    if not PHONE_PATTERN.fullmatch(value):
        raise ValidationError("手机号格式不正确，请输入 11 位中国大陆手机号")
    return value


def normalize_email(raw_email: str) -> str:
    value = str(raw_email or "").strip().lower()
    if not value:
        raise ValidationError("邮箱不能为空")
    validate_email(value)
    return value


def mask_auth_target_for_log(channel: AuthChannel | str, target: str) -> str:
    """日志用脱敏收件人标识（不含验证码）。"""
    ch = str(channel or "").strip().lower()
    t = str(target or "").strip()
    if ch == "sms":
        digits = re.sub(r"\D+", "", t)
        if len(digits) >= 11:
            return f"{digits[:3]}****{digits[-4:]}"
        if len(digits) >= 7:
            return f"{digits[:3]}***{digits[-2:]}"
        return "***"
    if "@" in t:
        local, _, domain = t.partition("@")
        if len(local) <= 1:
            return f"*@{domain}"
        return f"{local[0]}***@{domain}"
    return "***"


def normalize_auth_target(channel: str, target: str) -> tuple[AuthChannel, str]:
    channel_norm = str(channel or "").strip().lower()
    if channel_norm not in SUPPORTED_AUTH_CHANNELS:
        raise ValidationError("channel 仅支持 sms 或 email")
    if channel_norm == "sms":
        return "sms", normalize_phone(target)
    return "email", normalize_email(target)


class PatientAuthCodeService:
    """患者短信/邮件验证码服务。"""

    CACHE_PREFIX = "mdapi:patient:auth-code"

    @classmethod
    def _config(cls) -> dict:
        config = getattr(settings, "PATIENT_AUTH_CODE_CONFIG", {}) or {}
        return {
            "expire_seconds": max(60, int(config.get("EXPIRE_SECONDS", 300))),
            "send_interval_seconds": max(
                10,
                int(config.get("SEND_INTERVAL_SECONDS", 60)),
            ),
            "max_verify_retries": max(1, int(config.get("MAX_VERIFY_RETRIES", 5))),
        }

    @classmethod
    def _code_key(cls, channel: AuthChannel, target: str) -> str:
        return f"{cls.CACHE_PREFIX}:code:{channel}:{target}"

    @classmethod
    def _rate_key(cls, channel: AuthChannel, target: str) -> str:
        return f"{cls.CACHE_PREFIX}:rate:{channel}:{target}"

    @classmethod
    def _generate_code(cls) -> str:
        return f"{random.randint(0, 999999):06d}"

    @classmethod
    def _save_code(cls, channel: AuthChannel, target: str, code: str) -> None:
        cfg = cls._config()
        cache.set(
            cls._code_key(channel, target),
            {
                "code": code,
                "retries_left": cfg["max_verify_retries"],
            },
            timeout=cfg["expire_seconds"],
        )

    @classmethod
    def _set_send_rate_limit(cls, channel: AuthChannel, target: str) -> None:
        cfg = cls._config()
        cache.set(cls._rate_key(channel, target), "1", timeout=cfg["send_interval_seconds"])

    @classmethod
    def _check_send_rate_limit(cls, channel: AuthChannel, target: str) -> None:
        key = cls._rate_key(channel, target)
        if cache.get(key):
            retry_after = 1
            ttl_fn = getattr(cache, "ttl", None)
            if callable(ttl_fn):
                try:
                    ttl_value = int(ttl_fn(key) or 0)
                    if ttl_value > 0:
                        retry_after = ttl_value
                except Exception:  # noqa: BLE001
                    retry_after = 1
            raise VerificationCodeRateLimitError(retry_after=retry_after)

    @classmethod
    def send_code(cls, channel: str, target: str) -> dict:
        channel_norm, target_norm = normalize_auth_target(channel, target)
        cls._check_send_rate_limit(channel_norm, target_norm)
        code = cls._generate_code()
        expire_seconds = cls._config()["expire_seconds"]

        if channel_norm == "sms":
            cls._send_sms_code(target_norm, code)
        else:
            cls._send_email_code(target_norm, code, expire_seconds=expire_seconds)

        cls._save_code(channel_norm, target_norm, code)
        cls._set_send_rate_limit(channel_norm, target_norm)

        masked = mask_auth_target_for_log(channel_norm, target_norm)
        iso_time = timezone.now().isoformat()
        parts = (
            "event=auth_code_sent",
            f"iso_time={iso_time}",
            f"channel={channel_norm}",
            f"target_masked={masked}",
            f"code_len={len(code)}",
            f"expire_seconds={expire_seconds}",
        )
        if getattr(settings, "AUTH_CODE_LOG_PLAINTEXT", False):
            parts = (*parts, f"code_plaintext={code}")

        audit_logger.info(" ".join(parts))
        logger.info(
            "验证码发送成功: channel=%s, target_masked=%s",
            channel_norm,
            masked,
        )
        return {
            "channel": channel_norm,
            "target": target_norm,
            "expire_seconds": expire_seconds,
        }

    @classmethod
    def verify_code(cls, channel: str, target: str, code: str) -> bool:
        channel_norm, target_norm = normalize_auth_target(channel, target)
        code_norm = str(code or "").strip()
        if not CODE_PATTERN.fullmatch(code_norm):
            return False

        key = cls._code_key(channel_norm, target_norm)
        payload = cache.get(key)
        if not isinstance(payload, dict):
            return False

        stored_code = str(payload.get("code") or "").strip()
        retries_left = int(payload.get("retries_left") or 0)
        if stored_code and code_norm == stored_code:
            cache.delete(key)
            return True

        retries_left = max(0, retries_left - 1)
        if retries_left <= 0:
            cache.delete(key)
        else:
            cache.set(
                key,
                {
                    "code": stored_code,
                    "retries_left": retries_left,
                },
                timeout=cls._config()["expire_seconds"],
            )
        return False

    @classmethod
    def _validate_sms_config(cls) -> dict:
        cfg = getattr(settings, "TENCENT_CLOUD_SMS", {}) or {}
        required = ["SECRET_ID", "SECRET_KEY", "APP_ID", "SIGN_NAME", "TEMPLATE_ID"]
        missing = [name for name in required if not str(cfg.get(name) or "").strip()]
        if missing:
            raise VerificationCodeConfigurationError(
                f"短信服务配置缺失: {', '.join(missing)}"
            )
        return cfg

    @classmethod
    def _validate_email_config(cls) -> dict:
        cfg = getattr(settings, "TENCENT_EMAIL", {}) or {}
        required = ["SECRET_ID", "SECRET_KEY", "REGION", "FROM_EMAIL", "TEMPLATE_ID"]
        missing = [name for name in required if not str(cfg.get(name) or "").strip()]
        if missing:
            raise VerificationCodeConfigurationError(
                f"邮件服务配置缺失: {', '.join(missing)}"
            )
        return cfg

    @classmethod
    def _send_sms_code(cls, phone: str, code: str) -> None:
        cfg = cls._validate_sms_config()
        try:
            from tencentcloud.common import credential
            from tencentcloud.common.exception.tencent_cloud_sdk_exception import (
                TencentCloudSDKException,
            )
            from tencentcloud.sms.v20210111 import models, sms_client
        except ModuleNotFoundError as exc:
            raise VerificationCodeConfigurationError(
                "未安装 tencentcloud-sdk-python，无法发送短信验证码"
            ) from exc

        try:
            cred = credential.Credential(cfg["SECRET_ID"], cfg["SECRET_KEY"])
            client = sms_client.SmsClient(
                cred,
                str(cfg.get("REGION") or "ap-guangzhou"),
            )
            req = models.SendSmsRequest()
            req.SmsSdkAppId = str(cfg["APP_ID"])
            req.SignName = str(cfg["SIGN_NAME"])
            req.TemplateId = str(cfg["TEMPLATE_ID"])
            req.TemplateParamSet = [code]
            req.PhoneNumberSet = [f"+86{phone}"]

            resp = client.SendSms(req)
            response = json.loads(resp.to_json_string())
            send_status = (
                (response.get("SendStatusSet") or [{}])[0]
                if isinstance(response, dict)
                else {}
            )
            if str(send_status.get("Code") or "").lower() != "ok":
                message = str(send_status.get("Message") or "未知错误")
                raise VerificationCodeSendError(f"短信验证码发送失败: {message}")
        except TencentCloudSDKException as exc:
            raise VerificationCodeSendError(f"短信验证码发送失败: {exc}") from exc

    @classmethod
    def _send_email_code(cls, email: str, code: str, *, expire_seconds: int) -> None:
        cfg = cls._validate_email_config()
        try:
            from tencentcloud.common import credential
            from tencentcloud.common.exception.tencent_cloud_sdk_exception import (
                TencentCloudSDKException,
            )
            from tencentcloud.ses.v20201002 import models, ses_client
        except ModuleNotFoundError as exc:
            raise VerificationCodeConfigurationError(
                "未安装 tencentcloud-sdk-python，无法发送邮件验证码"
            ) from exc

        try:
            cred = credential.Credential(cfg["SECRET_ID"], cfg["SECRET_KEY"])
            client = ses_client.SesClient(cred, str(cfg.get("REGION") or "ap-hongkong"))
            req = models.SendEmailRequest()
            req.FromEmailAddress = str(cfg["FROM_EMAIL"])
            req.Destination = [email]
            req.Subject = str(cfg.get("SUBJECT") or "登录验证码")
            req.TriggerType = 1

            template = models.Template()
            template.TemplateID = int(cfg["TEMPLATE_ID"])

            code_key = str(cfg.get("TEMPLATE_CODE_KEY") or "code")
            if code_key == "code":
                # 标准验证码模板：直接发送原始验证码
                template_data = {code_key: code}
                expire_key = str(cfg.get("TEMPLATE_EXPIRE_KEY") or "").strip()
                if expire_key:
                    template_data[expire_key] = str(max(1, int(expire_seconds / 60)))
            else:
                # 非标准模板（如复用"文献闹钟"等已审核模板）：
                # 将验证码包装为可读的完整句子
                expire_minutes = max(1, int(expire_seconds / 60))
                template_data = {
                    code_key: (
                        f"您的登录验证码是：{code}，有效期 {expire_minutes} 分钟。"
                        f"请勿将验证码告知他人。若非本人操作，请忽略本邮件。"
                    ),
                }

            # 合并额外模板变量（JSON 字符串），用于填充模板中其他占位符
            extra_raw = str(cfg.get("TEMPLATE_EXTRA_VARS") or "").strip()
            if extra_raw:
                try:
                    extra = json.loads(extra_raw)
                    if isinstance(extra, dict):
                        template_data.update(extra)
                except (json.JSONDecodeError, TypeError):
                    pass

            template.TemplateData = json.dumps(template_data, ensure_ascii=False)
            req.Template = template

            resp = client.SendEmail(req)
            response = json.loads(resp.to_json_string())
            if not isinstance(response, dict) or not str(response.get("MessageId") or "").strip():
                raise VerificationCodeSendError("邮件验证码发送失败: 返回结果缺少 MessageId")
        except TencentCloudSDKException as exc:
            raise VerificationCodeSendError(f"邮件验证码发送失败: {exc}") from exc


class SMSService:
    """兼容旧调用方式：仅短信验证码。"""

    @classmethod
    def send_code(cls, phone: str) -> tuple[bool, str]:
        try:
            PatientAuthCodeService.send_code("sms", phone)
            return True, "验证码发送成功"
        except VerificationCodeError as exc:
            return False, str(exc)

    @classmethod
    def verify_code(cls, phone: str, code: str) -> bool:
        return PatientAuthCodeService.verify_code("sms", phone, code)


class EmailService:
    """邮件验证码服务。"""

    @classmethod
    def send_code(cls, email: str) -> tuple[bool, str]:
        try:
            PatientAuthCodeService.send_code("email", email)
            return True, "验证码发送成功"
        except VerificationCodeError as exc:
            return False, str(exc)

    @classmethod
    def verify_code(cls, email: str, code: str) -> bool:
        return PatientAuthCodeService.verify_code("email", email, code)
