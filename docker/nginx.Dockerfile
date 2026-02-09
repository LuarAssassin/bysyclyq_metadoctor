# ───────────────────────────────────────────────────────
# 北医三院·医生元宇宙 — 前端构建 + Nginx 镜像
# 构建上下文：仓库根目录
# ───────────────────────────────────────────────────────

# ── Stage 1: 构建医生端前端 ──
FROM node:20-alpine AS doctor-build
WORKDIR /build
COPY doctor_web_opus/package.json doctor_web_opus/package-lock.json ./
RUN npm ci --ignore-scripts
COPY doctor_web_opus/ .
# 以 /doctor/ 子路径构建，前端代码通过 import.meta.env.BASE_URL 自动适配
RUN npm run build -- --base=/doctor/

# ── Stage 2: 构建患者端前端 ──
FROM node:20-alpine AS patient-build
WORKDIR /build
COPY patient_web_opus/package.json patient_web_opus/package-lock.json ./
RUN npm ci --ignore-scripts
COPY patient_web_opus/ .
RUN npm run build

# ── Stage 3: Nginx 生产镜像 ──
FROM nginx:1.27-alpine

# 移除默认配置
RUN rm -f /etc/nginx/conf.d/default.conf

# 拷贝自定义 Nginx 配置
COPY docker/nginx.conf /etc/nginx/conf.d/app.conf

# 拷贝前端构建产物
COPY --from=doctor-build  /build/dist /usr/share/nginx/html/doctor
COPY --from=patient-build /build/dist /usr/share/nginx/html/patient

EXPOSE 80
