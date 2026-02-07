#!/usr/bin/env python3
"""
清空 PostgreSQL 数据库中所有业务表的数据。

用法:
    uv run --with psycopg2-binary scripts/clear_database.py
    # 或跳过确认:
    uv run --with psycopg2-binary scripts/clear_database.py --yes

脚本从 metaverse_doctor/.env 读取数据库连接信息（DB_NAME / DB_USER / DB_PASSWORD / DB_HOST / DB_PORT）。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# 1. 解析 .env 文件
# ---------------------------------------------------------------------------

ENV_PATH = Path(__file__).resolve().parent.parent / "metaverse_doctor" / ".env"


def load_env(path: Path) -> dict[str, str]:
    """简易 .env 解析器，只处理 KEY=VALUE 格式。"""
    env: dict[str, str] = {}
    if not path.exists():
        print(f"[错误] 找不到 .env 文件: {path}")
        sys.exit(1)
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip()
    return env


# ---------------------------------------------------------------------------
# 2. 主流程
# ---------------------------------------------------------------------------


def main() -> None:
    env = load_env(ENV_PATH)

    db_name = env.get("DB_NAME")
    db_user = env.get("DB_USER")
    db_password = env.get("DB_PASSWORD")
    db_host = env.get("DB_HOST")
    db_port = env.get("DB_PORT")

    if not all([db_name, db_user, db_password, db_host, db_port]):
        print("[错误] .env 中缺少必要的数据库配置 (DB_NAME/DB_USER/DB_PASSWORD/DB_HOST/DB_PORT)")
        sys.exit(1)

    # 尝试导入 psycopg2
    try:
        import psycopg2  # type: ignore
    except ImportError:
        print("[错误] 缺少 psycopg2，请使用: uv run --with psycopg2-binary scripts/clear_database.py")
        sys.exit(1)

    # 连接数据库
    print(f"正在连接数据库 {db_name}@{db_host}:{db_port} ...")
    try:
        conn = psycopg2.connect(
            dbname=db_name,
            user=db_user,
            password=db_password,
            host=db_host,
            port=db_port,
        )
        conn.autocommit = False
    except Exception as e:
        print(f"[错误] 数据库连接失败: {e}")
        sys.exit(1)

    # 获取 public schema 下所有用户表
    with conn.cursor() as cur:
        cur.execute("""
            SELECT tablename
            FROM   pg_tables
            WHERE  schemaname = 'public'
            ORDER  BY tablename;
        """)
        tables = [row[0] for row in cur.fetchall()]

    if not tables:
        print("数据库中没有找到任何表，无需清空。")
        conn.close()
        return

    print(f"\n将清空以下 {len(tables)} 张表的全部数据:\n")
    for t in tables:
        print(f"  - {t}")

    # 确认
    skip_confirm = "--yes" in sys.argv or "-y" in sys.argv
    if not skip_confirm:
        print(f"\n⚠️  此操作将删除数据库 [{db_name}] 中以上所有表的数据，且不可恢复！")
        answer = input("确认清空？请输入 yes 继续: ")
        if answer.strip().lower() != "yes":
            print("已取消。")
            conn.close()
            return

    # 执行 TRUNCATE（CASCADE 处理外键依赖）
    print("\n正在清空数据 ...")
    try:
        with conn.cursor() as cur:
            table_list = ", ".join(f'"{t}"' for t in tables)
            cur.execute(f"TRUNCATE TABLE {table_list} CASCADE;")
        conn.commit()
        print(f"✅ 成功清空 {len(tables)} 张表的全部数据。")
    except Exception as e:
        conn.rollback()
        print(f"[错误] 清空数据失败: {e}")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
