"""Isolated SQLite settings for this repair's regression run, without network."""
import os
import socket

import dotenv

dotenv.load_dotenv = lambda *args, **kwargs: False
os.environ["DB_ENGINE"] = "sqlite3"

from metaverse_doctor.settings import *  # noqa: F403,E402

SECRET_KEY = "offline-tts-regression-only"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
ALIBABA_CLOUD_ACCESS_KEY_ID = "offline-access-key"
ALIBABA_CLOUD_ACCESS_KEY_SECRET = "offline-access-secret"
OSS_BUCKET = "offline-tts-bucket"
OSS_REGION = "cn-beijing"
OSS_PUBLIC_BASE_URL = "https://offline-tts-bucket.invalid"


def _block_network(*args, **kwargs):
    raise RuntimeError("Network disabled in TTS offline regression")


socket.socket.connect = _block_network
socket.socket.connect_ex = _block_network
