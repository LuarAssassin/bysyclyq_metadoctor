#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# 北医三院·医生元宇宙智能体 — 一键部署脚本
# 用法: bash deploy.sh [命令]
#
# 命令:
#   up       构建并启动所有服务（默认）
#   down     停止并移除所有服务
#   restart  重启所有服务
#   rebuild  强制重新构建并启动
#   logs     查看实时日志
#   status   查看服务状态
#   backup   备份 PostgreSQL 数据库
#   shell    进入后端容器 shell
# ═══════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE=".env.production"
COMPOSE_CMD="docker compose --env-file ${ENV_FILE}"
BACKUP_DIR="./backups"

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── 检查前置条件 ──
check_prereqs() {
    command -v docker >/dev/null 2>&1 || error "请先安装 Docker"
    docker compose version >/dev/null 2>&1 || error "请先安装 Docker Compose V2"

    if [ ! -f "$ENV_FILE" ]; then
        warn "未找到 ${ENV_FILE}"
        if [ -f ".env.production.example" ]; then
            info "正在从模板创建..."
            cp .env.production.example "$ENV_FILE"
            warn "请编辑 ${ENV_FILE} 填入真实密钥，然后重新运行此脚本"
            exit 1
        else
            error "缺少 ${ENV_FILE} 和模板文件"
        fi
    fi
}

# ── 命令实现 ──
cmd_up() {
    info "构建并启动所有服务..."
    $COMPOSE_CMD up -d --build
    echo ""
    ok "部署完成！"
    cmd_status
    echo ""
    local port
    port=$(grep -E '^EXPOSE_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]')
    port="${port:-13579}"
    ok "访问地址:"
    info "  患者端: http://<服务器IP>:${port}/"
    info "  医生端: http://<服务器IP>:${port}/doctor/"
    info "  API:    http://<服务器IP>:${port}/api/"
    info "  Admin:  http://<服务器IP>:${port}/admin/"
}

cmd_down() {
    info "停止所有服务..."
    $COMPOSE_CMD down
    ok "已停止"
}

cmd_restart() {
    info "重启所有服务..."
    $COMPOSE_CMD restart
    ok "已重启"
    cmd_status
}

cmd_rebuild() {
    info "强制重新构建..."
    $COMPOSE_CMD down
    $COMPOSE_CMD build --no-cache
    $COMPOSE_CMD up -d
    ok "重建完成"
    cmd_status
}

cmd_logs() {
    local service="${1:-}"
    if [ -n "$service" ]; then
        $COMPOSE_CMD logs -f "$service"
    else
        $COMPOSE_CMD logs -f
    fi
}

cmd_status() {
    info "服务状态:"
    $COMPOSE_CMD ps
}

cmd_backup() {
    mkdir -p "$BACKUP_DIR"
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${BACKUP_DIR}/metaverse_doctor_${timestamp}.sql.gz"

    info "备份 PostgreSQL 数据库..."
    $COMPOSE_CMD exec -T postgres pg_dump \
        -U "${DB_USER:-postgres}" \
        "${DB_NAME:-metaverse_doctor}" \
        | gzip > "$backup_file"

    ok "备份已保存到: ${backup_file}"
    ls -lh "$backup_file"
}

cmd_shell() {
    info "进入后端容器..."
    $COMPOSE_CMD exec backend /bin/sh
}

# ── 入口 ──
main() {
    check_prereqs

    local cmd="${1:-up}"
    shift 2>/dev/null || true

    case "$cmd" in
        up)       cmd_up ;;
        down)     cmd_down ;;
        restart)  cmd_restart ;;
        rebuild)  cmd_rebuild ;;
        logs)     cmd_logs "$@" ;;
        status)   cmd_status ;;
        backup)   cmd_backup ;;
        shell)    cmd_shell ;;
        *)
            echo "用法: bash deploy.sh [up|down|restart|rebuild|logs|status|backup|shell]"
            exit 1
            ;;
    esac
}

main "$@"
