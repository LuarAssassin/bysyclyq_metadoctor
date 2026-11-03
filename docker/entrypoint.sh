#!/bin/sh
set -e

echo "══════════════════════════════════════════"
echo "  北医三院·医生元宇宙 — 后端启动"
echo "══════════════════════════════════════════"

echo "[1/3] 数据库迁移..."
if [ "${SKIP_STARTUP_MIGRATIONS:-0}" = "1" ]; then
    echo "已按配置跳过数据库迁移"
else
    uv run python manage.py migrate --noinput
fi

echo "[2/3] 收集静态文件..."
uv run python manage.py collectstatic --noinput

echo "[3/3] 启动 Gunicorn (workers=${GUNICORN_WORKERS:-4}, threads=${GUNICORN_THREADS:-4})..."
exec uv run gunicorn metaverse_doctor.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers "${GUNICORN_WORKERS:-4}" \
    --threads "${GUNICORN_THREADS:-4}" \
    --timeout "${GUNICORN_TIMEOUT:-300}" \
    --graceful-timeout 30 \
    --access-logfile - \
    --error-logfile -
