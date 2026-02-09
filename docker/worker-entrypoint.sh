#!/bin/sh
set -e

echo "══════════════════════════════════════════"
echo "  北医三院·医生元宇宙 — 知识提取 Worker"
echo "══════════════════════════════════════════"

echo "等待后端就绪..."
sleep 5

echo "启动 Knowledge Worker..."
exec uv run python manage.py run_knowledge_worker
