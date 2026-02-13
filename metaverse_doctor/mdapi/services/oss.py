import mimetypes
import re
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

from django.conf import settings


class OSSConfigurationError(Exception):
    """Raised when OSS credentials or SDK is unavailable."""


class OSSUploadError(Exception):
    """Raised when upload to OSS failed."""


class OSSReadError(Exception):
    """Raised when generating OSS read URL failed."""


class AliyunOSSClient:
    def __init__(self):
        self.access_key_id = settings.ALIBABA_CLOUD_ACCESS_KEY_ID
        self.access_key_secret = settings.ALIBABA_CLOUD_ACCESS_KEY_SECRET
        self.bucket_name = settings.OSS_BUCKET
        self.region = settings.OSS_REGION
        self.public_base_url = (settings.OSS_PUBLIC_BASE_URL or "").rstrip("/")
        self.endpoint = self._build_endpoint(self.region)

        missing_keys = [
            key
            for key, value in {
                "ALIBABA_CLOUD_ACCESS_KEY_ID": self.access_key_id,
                "ALIBABA_CLOUD_ACCESS_KEY_SECRET": self.access_key_secret,
                "OSS_BUCKET": self.bucket_name,
                "OSS_REGION": self.region,
            }.items()
            if not value
        ]
        if missing_keys:
            missing = ", ".join(missing_keys)
            raise OSSConfigurationError(f"缺少 OSS 配置: {missing}")

        try:
            import oss2  # type: ignore
        except ImportError as exc:
            raise OSSConfigurationError(
                "未安装 oss2 SDK，请执行: pip install oss2"
            ) from exc

        auth = oss2.Auth(self.access_key_id, self.access_key_secret)
        self.bucket = oss2.Bucket(auth, self.endpoint, self.bucket_name)

    @staticmethod
    def _build_endpoint(region: str) -> str:
        if region.startswith("http://") or region.startswith("https://"):
            return region.rstrip("/")
        return f"https://oss-{region}.aliyuncs.com"

    @staticmethod
    def _sanitize_file_name(file_name: str) -> str:
        raw_name = Path(file_name).name.strip()
        if not raw_name:
            return f"file-{uuid.uuid4().hex}"

        # 保留中文和常见 Unicode 字符，主要清理路径分隔符与控制字符，便于 URL 可读性
        sanitized = re.sub(r"[\x00-\x1f\x7f]", "", raw_name)
        sanitized = re.sub(r"[\\/:\*\?\"<>\|]", "_", sanitized)
        sanitized = re.sub(r"\s+", "-", sanitized).strip("._-")
        if len(sanitized) > 180:
            stem = Path(sanitized).stem[:150]
            suffix = Path(sanitized).suffix[:20]
            sanitized = f"{stem}{suffix}"
        return sanitized or f"file-{uuid.uuid4().hex}"

    def build_object_key(
        self,
        doctor_id,
        file_name: str,
        prefix: str = "doctor-knowledge",
    ) -> str:
        date_path = datetime.now().strftime("%Y/%m/%d")
        safe_file_name = self._sanitize_file_name(file_name)
        safe_prefix = (prefix or "doctor-knowledge").strip("/ ")
        return (
            f"{safe_prefix}/{doctor_id}/{date_path}/"
            f"{uuid.uuid4().hex}_{safe_file_name}"
        )

    def build_public_url(self, object_key: str) -> str:
        base_url = self.public_base_url or (
            f"https://{self.bucket_name}.oss-{self.region}.aliyuncs.com"
        )
        encoded_key = quote(object_key.lstrip("/"), safe="/")
        return f"{base_url.rstrip('/')}/{encoded_key}"

    def build_signed_get_url(self, object_key: str, expires: int | None = None) -> str:
        expire_seconds = int(
            expires
            or getattr(settings, "OSS_SIGNED_URL_EXPIRE_SECONDS", 900)
        )
        try:
            return self.bucket.sign_url("GET", object_key, max(expire_seconds, 60))
        except Exception as exc:  # noqa: BLE001
            raise OSSReadError(f"生成 OSS 签名 URL 失败: {exc}") from exc

    def upload_file(self, uploaded_file, doctor_id, prefix: str = "doctor-knowledge") -> dict:
        object_key = self.build_object_key(
            doctor_id=doctor_id,
            file_name=uploaded_file.name,
            prefix=prefix,
        )
        content_type = (
            getattr(uploaded_file, "content_type", None)
            or mimetypes.guess_type(uploaded_file.name)[0]
            or "application/octet-stream"
        )

        headers = {"Content-Type": content_type}

        try:
            if hasattr(uploaded_file, "seek"):
                uploaded_file.seek(0)
            result = self.bucket.put_object(object_key, uploaded_file, headers=headers)
        except Exception as exc:  # noqa: BLE001
            raise OSSUploadError(f"上传到 OSS 失败: {exc}") from exc

        return {
            "object_key": object_key,
            "oss_url": self.build_public_url(object_key),
            "etag": getattr(result, "etag", None),
            "size_bytes": getattr(uploaded_file, "size", 0) or 0,
            "content_type": content_type,
        }


def get_oss_client() -> AliyunOSSClient:
    return AliyunOSSClient()


def extract_object_key_from_url(
    url: str | None,
    *,
    required_prefix: str | None = None,
) -> str | None:
    raw_url = str(url or "").strip()
    if not raw_url:
        return None

    parsed = urlparse(raw_url)
    object_key = unquote((parsed.path or "").lstrip("/")).strip()
    if not object_key:
        return None

    if required_prefix:
        prefix = required_prefix.strip("/ ")
        if prefix and not object_key.startswith(f"{prefix}/"):
            return None
    return object_key
