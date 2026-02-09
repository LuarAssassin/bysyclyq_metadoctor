#!/usr/bin/env python3
"""
患者端 API 测试脚本
测试 api.md 中第7章节的患者端问诊 API
"""

import os
import sys
import json
import time
import requests
from datetime import datetime
from typing import Optional

# 添加项目路径
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "metaverse_doctor.settings")

import django
django.setup()

from django.conf import settings

# API 基础配置
BASE_URL = "http://127.0.0.1:8000/api"
TEST_REPORT = []


def log_test(name: str, passed: bool, message: str = "", details: dict = None):
    """记录测试结果"""
    result = {
        "name": name,
        "passed": passed,
        "message": message,
        "details": details or {},
        "timestamp": datetime.now().isoformat(),
    }
    TEST_REPORT.append(result)
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status} | {name}")
    if message:
        print(f"    {message}")
    return result


def test_patient_register():
    """测试 7.1: POST /auth/patient/register/ - 患者注册"""
    url = f"{BASE_URL}/auth/patient/register/"
    
    # 生成唯一的用户名
    timestamp = int(time.time())
    username = f"test_patient_{timestamp}"
    
    payload = {
        "username": username,
        "password": "Test123456",
        "email": f"{username}@example.com",
        "phone": f"138{timestamp % 100000000:08d}",
        "nickname": f"测试患者{timestamp}",
    }
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        data = response.json()
        
        if response.status_code == 201:
            log_test(
                "7.1 患者注册",
                True,
                f"注册成功: {username}, ID={data.get('data', {}).get('id')}",
                {"username": username, "response": data},
            )
            return username, "Test123456", data.get("data", {}).get("id")
        else:
            log_test(
                "7.1 患者注册",
                False,
                f"注册失败: HTTP {response.status_code}, {data.get('message', '未知错误')}",
                {"response": data},
            )
            return None, None, None
    except Exception as e:
        log_test("7.1 患者注册", False, f"请求异常: {str(e)}")
        return None, None, None


def test_patient_login(username: str, password: str):
    """测试 7.2: POST /auth/login/ - 患者登录"""
    url = f"{BASE_URL}/auth/login/"
    
    payload = {
        "username": username,
        "password": password,
    }
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        data = response.json()
        
        if response.status_code == 200 and data.get("code") == 200:
            access_token = data.get("data", {}).get("access")
            refresh_token = data.get("data", {}).get("refresh")
            log_test(
                "7.2 患者登录",
                True,
                "登录成功，获取到 JWT Token",
                {"access_token_preview": access_token[:30] + "..." if access_token else None},
            )
            return access_token, refresh_token
        else:
            log_test(
                "7.2 患者登录",
                False,
                f"登录失败: {data.get('message', '未知错误')}",
                {"response": data},
            )
            return None, None
    except Exception as e:
        log_test("7.2 患者登录", False, f"请求异常: {str(e)}")
        return None, None


def test_doctor_directory(access_token: str):
    """测试 7.3: GET /patient/doctors/ - 医生目录"""
    url = f"{BASE_URL}/patient/doctors/"
    headers = {"Authorization": f"Bearer {access_token}"}
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        data = response.json()
        
        if response.status_code == 200 and data.get("code") == 200:
            doctors = data.get("data", [])
            log_test(
                "7.3 医生目录",
                True,
                f"获取到 {len(doctors)} 位医生",
                {"doctor_count": len(doctors), "sample": doctors[:1] if doctors else None},
            )
            return doctors
        else:
            log_test(
                "7.3 医生目录",
                False,
                f"获取失败: {data.get('message', '未知错误')}",
                {"response": data},
            )
            return []
    except Exception as e:
        log_test("7.3 医生目录", False, f"请求异常: {str(e)}")
        return []


def test_doctor_assets(access_token: str, doctor_id: int):
    """测试 7.4: GET /patient/doctors/{doctor_id}/assets/ - 获取医生素材"""
    url = f"{BASE_URL}/patient/doctors/{doctor_id}/assets/"
    headers = {"Authorization": f"Bearer {access_token}"}
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        data = response.json()
        
        if response.status_code == 200 and data.get("code") == 200:
            assets = data.get("data", {})
            voice_id = assets.get("voice_id")
            video_count = len(assets.get("videos", []))
            log_test(
                "7.4 医生素材",
                True,
                f"获取成功: voice_id={voice_id}, 视频数={video_count}",
                {"assets_summary": {
                    "voice_id": voice_id,
                    "tts_model": assets.get("tts_model"),
                    "video_count": video_count,
                    "doctor_name": assets.get("doctor", {}).get("nickname"),
                }},
            )
            return assets
        else:
            log_test(
                "7.4 医生素材",
                False,
                f"获取失败: {data.get('message', '未知错误')}",
                {"response": data},
            )
            return None
    except Exception as e:
        log_test("7.4 医生素材", False, f"请求异常: {str(e)}")
        return None


def test_create_session(access_token: str, doctor_id: int) -> Optional[int]:
    """测试 7.5: POST /patient/sessions/ - 创建问诊会话"""
    url = f"{BASE_URL}/patient/sessions/"
    headers = {"Authorization": f"Bearer {access_token}"}
    
    payload = {
        "doctor_id": doctor_id,
        "title": f"API测试会话-{int(time.time())}",
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        data = response.json()
        
        if response.status_code == 201 and data.get("code") == 201:
            session_id = data.get("data", {}).get("id")
            log_test(
                "7.5 创建问诊会话",
                True,
                f"创建成功: session_id={session_id}",
                {"session": data.get("data")},
            )
            return session_id
        else:
            log_test(
                "7.5 创建问诊会话",
                False,
                f"创建失败: {data.get('message', '未知错误')}",
                {"response": data},
            )
            return None
    except Exception as e:
        log_test("7.5 创建问诊会话", False, f"请求异常: {str(e)}")
        return None


def test_get_sessions(access_token: str):
    """测试 7.6: GET /patient/sessions/ - 获取会话列表"""
    url = f"{BASE_URL}/patient/sessions/"
    headers = {"Authorization": f"Bearer {access_token}"}
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        data = response.json()
        
        if response.status_code == 200 and data.get("code") == 200:
            sessions = data.get("data", [])
            log_test(
                "7.6 获取会话列表",
                True,
                f"获取到 {len(sessions)} 个会话",
                {"session_count": len(sessions)},
            )
            return sessions
        else:
            log_test(
                "7.6 获取会话列表",
                False,
                f"获取失败: {data.get('message', '未知错误')}",
                {"response": data},
            )
            return []
    except Exception as e:
        log_test("7.6 获取会话列表", False, f"请求异常: {str(e)}")
        return []


def test_get_session_messages(access_token: str, session_id: int):
    """测试 7.7: GET /patient/sessions/{session_id}/messages/ - 获取消息列表"""
    url = f"{BASE_URL}/patient/sessions/{session_id}/messages/"
    headers = {"Authorization": f"Bearer {access_token}"}
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        data = response.json()
        
        if response.status_code == 200 and data.get("code") == 200:
            messages = data.get("data", {}).get("messages", [])
            log_test(
                "7.7 获取消息列表",
                True,
                f"获取到 {len(messages)} 条消息",
                {"message_count": len(messages), "session_title": data.get("data", {}).get("session", {}).get("title")},
            )
            return messages
        else:
            log_test(
                "7.7 获取消息列表",
                False,
                f"获取失败: {data.get('message', '未知错误')}",
                {"response": data},
            )
            return []
    except Exception as e:
        log_test("7.7 获取消息列表", False, f"请求异常: {str(e)}")
        return []


def test_ask_stream(access_token: str, session_id: int):
    """测试 7.8: POST /patient/sessions/{session_id}/ask/stream/ - 流式问答"""
    url = f"{BASE_URL}/patient/sessions/{session_id}/ask/stream/"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    
    payload = {
        "question": "你好，我最近睡眠不好，有什么建议吗？",
        "forced_search": False,
        "enable_audio": False,  # 测试时禁用音频
    }
    
    events = []
    try:
        response = requests.post(url, json=payload, headers=headers, stream=True, timeout=60)
        
        if response.status_code != 200:
            log_test(
                "7.8 流式问答",
                False,
                f"请求失败: HTTP {response.status_code}",
                {"response": response.text[:500]},
            )
            return None
        
        full_content = ""
        message_id = None
        
        for line in response.iter_lines():
            if not line:
                continue
            
            line_str = line.decode("utf-8")
            if line_str.startswith("data: "):
                try:
                    event_data = json.loads(line_str[6:])
                    events.append(event_data)
                    
                    if event_data.get("event") == "start":
                        message_id = event_data.get("data", {}).get("answer_message_id")
                    elif event_data.get("event") == "delta":
                        full_content += event_data.get("data", {}).get("delta", "")
                except json.JSONDecodeError:
                    continue
        
        if events:
            log_test(
                "7.8 流式问答",
                True,
                f"成功接收流式响应: {len(events)} 个事件, 内容长度 {len(full_content)} 字符",
                {
                    "event_count": len(events),
                    "content_length": len(full_content),
                    "message_id": message_id,
                    "content_preview": full_content[:100] + "..." if len(full_content) > 100 else full_content,
                },
            )
            return {"events": events, "content": full_content, "message_id": message_id}
        else:
            log_test("7.8 流式问答", False, "未接收到任何事件数据")
            return None
            
    except Exception as e:
        log_test("7.8 流式问答", False, f"请求异常: {str(e)}")
        return None


def test_invalid_doctor_id(access_token: str):
    """测试边界情况: 无效 doctor_id"""
    url = f"{BASE_URL}/patient/sessions/"
    headers = {"Authorization": f"Bearer {access_token}"}
    
    payload = {"doctor_id": 99999}  # 不存在的医生ID
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        data = response.json()
        
        if response.status_code == 404 or data.get("code") == 404:
            log_test(
                "边界测试-无效doctor_id",
                True,
                "正确返回404错误",
                {"response": data},
            )
        else:
            log_test(
                "边界测试-无效doctor_id",
                False,
                f"未正确返回404: HTTP {response.status_code}",
                {"response": data},
            )
    except Exception as e:
        log_test("边界测试-无效doctor_id", False, f"请求异常: {str(e)}")


def test_unauthorized_access():
    """测试边界情况: 未授权访问"""
    url = f"{BASE_URL}/patient/doctors/"
    # 不提供 Authorization header
    
    try:
        response = requests.get(url, timeout=10)
        data = response.json()
        
        if response.status_code == 401:
            log_test(
                "边界测试-未授权访问",
                True,
                "正确返回401错误",
                {"response": data},
            )
        else:
            log_test(
                "边界测试-未授权访问",
                False,
                f"未正确返回401: HTTP {response.status_code}",
                {"response": data},
            )
    except Exception as e:
        log_test("边界测试-未授权访问", False, f"请求异常: {str(e)}")


def generate_report():
    """生成测试报告"""
    total = len(TEST_REPORT)
    passed = sum(1 for r in TEST_REPORT if r["passed"])
    failed = total - passed
    
    report = []
    report.append("\n" + "=" * 70)
    report.append("                    患者端 API 测试报告")
    report.append("=" * 70)
    report.append(f"\n测试时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    report.append(f"API 基础地址: {BASE_URL}")
    report.append(f"\n测试结果汇总:")
    report.append(f"  - 总测试数: {total}")
    report.append(f"  - 通过: {passed} ✅")
    report.append(f"  - 失败: {failed} ❌")
    report.append(f"  - 通过率: {passed/total*100:.1f}%" if total > 0 else "  - 通过率: N/A")
    
    report.append("\n" + "-" * 70)
    report.append("详细测试结果:")
    report.append("-" * 70)
    
    for i, r in enumerate(TEST_REPORT, 1):
        status = "✅ PASS" if r["passed"] else "❌ FAIL"
        report.append(f"\n{i}. {status} | {r['name']}")
        if r["message"]:
            report.append(f"   消息: {r['message']}")
        if r.get("details"):
            details_str = json.dumps(r["details"], ensure_ascii=False, indent=2)
            # 限制输出长度
            if len(details_str) > 500:
                details_str = details_str[:500] + "\n  ... (truncated)"
            report.append(f"   详情: {details_str}")
    
    report.append("\n" + "=" * 70)
    report.append("测试结束")
    report.append("=" * 70)
    
    return "\n".join(report)


def main():
    """主测试流程"""
    print("\n" + "=" * 70)
    print("           患者端 API 测试 - 开始")
    print("=" * 70)
    
    # 0. 测试未授权访问
    print("\n--- 边界测试: 未授权访问 ---")
    test_unauthorized_access()
    
    # 1. 患者注册
    print("\n--- 1. 患者注册 ---")
    username, password, user_id = test_patient_register()
    
    if not username:
        print("\n❌ 患者注册失败，终止后续测试")
        print(generate_report())
        sys.exit(1)
    
    # 2. 患者登录
    print("\n--- 2. 患者登录 ---")
    access_token, refresh_token = test_patient_login(username, password)
    
    if not access_token:
        print("\n❌ 患者登录失败，终止后续测试")
        print(generate_report())
        sys.exit(1)
    
    # 3. 医生目录
    print("\n--- 3. 医生目录 ---")
    doctors = test_doctor_directory(access_token)
    
    doctor_id = None
    if doctors:
        doctor_id = doctors[0].get("id")
    
    if doctor_id:
        # 4. 医生素材
        print("\n--- 4. 医生素材 ---")
        assets = test_doctor_assets(access_token, doctor_id)
        
        # 5. 创建问诊会话
        print("\n--- 5. 创建问诊会话 ---")
        session_id = test_create_session(access_token, doctor_id)
        
        # 边界测试: 无效 doctor_id
        print("\n--- 边界测试: 无效 doctor_id ---")
        test_invalid_doctor_id(access_token)
    else:
        print("\n⚠️  没有可用医生，跳过多项测试")
        session_id = None
    
    # 6. 获取会话列表
    print("\n--- 6. 获取会话列表 ---")
    sessions = test_get_sessions(access_token)
    
    # 7. 获取消息列表 & 8. 流式问答
    if session_id:
        print("\n--- 7. 获取消息列表 ---")
        messages = test_get_session_messages(access_token, session_id)
        
        print("\n--- 8. 流式问答 ---")
        result = test_ask_stream(access_token, session_id)
    else:
        print("\n⚠️  没有可用会话，跳过消息和流式问答测试")
    
    # 生成报告
    report = generate_report()
    print(report)
    
    # 保存报告到文件
    report_file = f"api-test-patient-{datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
    with open(report_file, "w", encoding="utf-8") as f:
        f.write("# 患者端 API 测试报告\n\n")
        f.write(f"- 测试时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"- API 基础地址: `{BASE_URL}`\n\n")
        f.write("```\n")
        f.write(report)
        f.write("\n```\n")
    
    print(f"\n📄 测试报告已保存到: {report_file}")
    
    # 返回退出码
    passed = sum(1 for r in TEST_REPORT if r["passed"])
    return 0 if passed == len(TEST_REPORT) else 1


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
