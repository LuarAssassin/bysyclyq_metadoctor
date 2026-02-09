# ───────────────────────────────────────────────────────
# 北医三院·医生元宇宙 — 后端 Django 镜像
# 构建上下文：仓库根目录
# ───────────────────────────────────────────────────────
FROM python:3.12-slim AS base

# 系统依赖：libpq（psycopg2 运行时需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 curl && \
    rm -rf /var/lib/apt/lists/*

# 安装 uv（极速 Python 包管理器）
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# ── 1. 先拷贝依赖声明（利用 Docker 缓存层） ──
COPY pyproject.toml uv.lock ./

# 安装 Python 依赖（含 gunicorn, psycopg2-binary 等）
RUN uv sync --frozen --no-dev

# ── 2. 拷贝后端源码 ──
COPY metaverse_doctor/ ./metaverse_doctor/

# ── 3. 准备数据目录 ──
RUN mkdir -p metaverse_doctor/logs \
             metaverse_doctor/media \
             metaverse_doctor/static \
             metaverse_doctor/staticfiles

# ── 4. 拷贝启动脚本 ──
COPY docker/entrypoint.sh /entrypoint.sh
COPY docker/worker-entrypoint.sh /worker-entrypoint.sh
RUN chmod +x /entrypoint.sh /worker-entrypoint.sh

WORKDIR /app/metaverse_doctor

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
