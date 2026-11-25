"""Explicit offline test settings; never import production settings or .env.

Run from metaverse_doctor with:
python manage.py test mdapi.test_workspace --settings=metaverse_doctor.workspace_test_settings
"""

import socket
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
PROMPT_DIR = BASE_DIR / "prompts"
SECRET_KEY = "chongli-workspace-offline-tests-only-not-for-serving"
DEBUG = False
ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "mdapi",
]
MIDDLEWARE = [
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]
ROOT_URLCONF = "metaverse_doctor.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
AUTH_USER_MODEL = "mdapi.CustomUser"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "Asia/Shanghai"
LANGUAGE_CODE = "zh-hans"
STATIC_URL = "/static/"
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "EXCEPTION_HANDLER": "mdapi.utils.api_response.custom_exception_handler",
}
LOGGING = {"version": 1, "disable_existing_loggers": True}
ALIBABA_CLOUD_ACCESS_KEY_ID = ""
ALIBABA_CLOUD_ACCESS_KEY_SECRET = ""
OSS_BUCKET = ""
OSS_REGION = "cn-beijing"
OSS_PUBLIC_BASE_URL = ""
DASHSCOPE_API_KEY = ""


def _block_network(*args, **kwargs):
    raise RuntimeError("Network access is disabled in workspace offline tests")


socket.socket.connect = _block_network
socket.socket.connect_ex = _block_network
socket.create_connection = _block_network
socket.getaddrinfo = _block_network
