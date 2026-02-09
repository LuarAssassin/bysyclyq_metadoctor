# API 测试报告 - 患者端问诊 API（第7节）

**测试时间**: 2026-02-09  
**测试环境**: http://127.0.0.1:8000/api  
**测试人员**: Kimi Code CLI

---

## 测试概览

| 接口 | 方法 | 状态 | 说明 |
|-----|------|-----|-----|
| 7.1 POST /auth/patient/register/ | 患者注册 | ✅ 通过 | 创建患者账号 |
| 7.2 GET /patient/doctors/ | 医生目录 | ✅ 通过 | 返回可用医生列表 |
| 7.3 GET /patient/doctors/{id}/assets/ | 医生素材 | ✅ 通过 | 返回音色+6个视频 |
| 7.4 POST /patient/sessions/ | 创建会话 | ✅ 通过 | 绑定医生创建会话 |
| 7.5 GET /patient/sessions/ | 会话列表 | ✅ 通过 | 返回患者会话 |
| 7.6 GET /patient/sessions/{id}/messages/ | 消息列表 | ✅ 通过 | 返回会话消息 |
| 7.7 POST /patient/sessions/{id}/ask/stream/ | 流式问答 | ✅ 通过 | SSE文本+音频流 |

**通过率**: 7/7 (100%) ✅

---

## 详细测试记录

### 7.1 POST /auth/patient/register/ ✅

**功能**: 患者注册账号

**请求**:
```json
{
  "username": "patient_zhang",
  "password": "12345678",
  "email": "patient_zhang@example.com",
  "phone": "13800003333",
  "nickname": "张女士"
}
```

**响应** (201 Created):
```json
{
  "code": 201,
  "message": "患者注册成功",
  "data": {
    "id": 6,
    "username": "patient_zhang",
    "nickname": "张女士",
    "email": "patient_zhang@example.com",
    "phone": "13800003333",
    "created_at": "2026-02-09T16:37:50.263650"
  }
}
```

**验证点**:
- ✅ HTTP 201
- ✅ 患者ID=6
- ✅ 默认可直接登录（无需审核）

---

### 7.2 GET /patient/doctors/ ✅

**功能**: 获取可用医生目录

**响应** (200 OK):
```json
{
  "code": 200,
  "message": "获取成功",
  "data": [
    {
      "id": 4,
      "username": "doctor_zhao",
      "nickname": "赵医生",
      "avatar": null,
      "institution": "中山医院",
      "profession": "消化内科"
    },
    {
      "id": 2,
      "username": "doctor_li",
      "nickname": "李医生",
      "avatar": null,
      "institution": "协和医院",
      "profession": "心内科"
    }
  ]
}
```

**验证点**:
- ✅ 返回2个审核通过的医生
- ✅ 包含基础信息（昵称、机构、科室）

---

### 7.3 GET /patient/doctors/2/assets/ ✅

**功能**: 获取医生可播放素材

**响应** (200 OK):
```json
{
  "code": 200,
  "message": "获取成功",
  "data": {
    "doctor": {
      "id": 2,
      "username": "doctor_li",
      "nickname": "李医生",
      "institution": "协和医院",
      "profession": "心内科"
    },
    "tts_model": "qwen3-tts-vc-realtime-2026-01-15",
    "voice_id": "qwen-tts-vc-yangyuping_voice-voice-20260209005435515-b4d1",
    "voice_name": "杨渝平医生音色",
    "video_urls": ["...6个签名视频链接..."],
    "videos": [
      {
        "video_id": 6,
        "scene_key": "listening_pause",
        "scene_name": "倾听停顿",
        "video_url": "https://...签名链接...",
        "video_oss_url": "http://oss.x3yun.com/..."
      },
      {
        "video_id": 5,
        "scene_key": "gentle_gesture",
        "scene_name": "温和手势",
        "video_url": "https://...签名链接...",
        "video_oss_url": "http://oss.x3yun.com/..."
      },
      {
        "video_id": 4,
        "scene_key": "nod_acknowledge",
        "scene_name": "点头确认",
        "video_url": "https://...签名链接...",
        "video_oss_url": "http://oss.x3yun.com/..."
      },
      {
        "video_id": 3,
        "scene_key": "idle_standby",
        "scene_name": "待机轻动",
        "video_url": "https://...签名链接...",
        "video_oss_url": "http://oss.x3yun.com/..."
      },
      {
        "video_id": 2,
        "scene_key": "talking_explain",
        "scene_name": "健康讲解",
        "video_url": "https://...签名链接...",
        "video_oss_url": "http://oss.x3yun.com/..."
      },
      {
        "video_id": 1,
        "scene_key": null,
        "scene_name": null,
        "video_url": "https://...签名链接...",
        "video_oss_url": "http://oss.x3yun.com/..."
      }
    ]
  }
}
```

**验证点**:
- ✅ 返回医生音色（杨渝平医生音色）
- ✅ 返回6个视频素材
- ✅ 视频包含场景标识和签名URL
- ✅ 可直接播放

---

### 7.4 POST /patient/sessions/ ✅

**功能**: 创建患者问诊会话

**请求**:
```json
{
  "doctor_id": 2,
  "title": "术后恢复咨询"
}
```

**响应** (201 Created):
```json
{
  "code": 201,
  "message": "患者问诊会话已创建",
  "data": {
    "id": 1,
    "doctor": {
      "id": 2,
      "username": "doctor_li",
      "nickname": "李医生",
      "institution": "协和医院",
      "profession": "心内科"
    },
    "title": "术后恢复咨询",
    "status": "active",
    "summary": null,
    "last_message_at": null,
    "created_at": "2026-02-09T16:39:22.108110",
    "updated_at": "2026-02-09T16:39:22.108117"
  }
}
```

**验证点**:
- ✅ HTTP 201
- ✅ 会话ID=1
- ✅ 绑定医生ID=2
- ✅ status=active

---

### 7.5 GET /patient/sessions/ ✅

**功能**: 获取患者会话列表

**响应** (200 OK):
```json
{
  "code": 200,
  "message": "获取成功",
  "data": [
    {
      "id": 1,
      "doctor": {
        "id": 2,
        "username": "doctor_li",
        "nickname": "李医生",
        "institution": "协和医院",
        "profession": "心内科"
      },
      "title": "术后恢复咨询",
      "status": "active",
      "summary": null,
      "last_message_at": null,
      "created_at": "2026-02-09T16:39:22.108110"
    }
  ]
}
```

---

### 7.6 GET /patient/sessions/1/messages/ ✅

**功能**: 获取会话消息列表

**响应** (200 OK):
```json
{
  "code": 200,
  "message": "获取成功",
  "data": {
    "session": {
      "id": 1,
      "doctor": { ... },
      "title": "术后恢复咨询",
      "status": "active"
    },
    "messages": []
  }
}
```

---

### 7.7 POST /patient/sessions/1/ask/stream/ ✅

**功能**: 患者端流式问答（SSE）

**请求**:
```json
{
  "question": "我最近睡眠不好，白天也很疲惫，应该先做什么检查？",
  "forced_search": true,
  "enable_audio": true
}
```

**响应** (SSE 流):

```
event: start
data: {
  "session_id": 1,
  "question_message_id": 1,
  "answer_message_id": 2,
  "doctor_id": 2,
  "selected_file_ids": [],
  "audio": {
    "enabled": true,
    "status": "streaming",
    "voice_id": "qwen-tts-vc-yangyuping_voice-voice-20260209005435515-b4d1",
    "voice_name": "杨渝平医生音色",
    "tts_model": "qwen3-tts-vc-realtime-2026-01-15",
    "audio_format": "pcm16",
    "sample_rate": 24000,
    "channels": 1
  }
}

event: delta
data: {"message_id": 2, "delta": "**结论**：\n您最近睡眠不好且白天疲惫..."}

event: delta
data: {"message_id": 2, "delta": "建议先从简单、无创的检查入手..."}

event: audio_delta
data: {"message_id": 2, "audio_format": "pcm16", "delta": "...base64音频数据..."}

event: delta
data: {"message_id": 2, "delta": "比如记录睡眠日记和进行心理评估量表筛查。"}

...更多 delta 和 audio_delta 事件...

event: done
data: {"usage": {...}, "sources": [...]}
```

**验证点**:
- ✅ SSE 连接成功
- ✅ start 事件返回会话和音频配置
- ✅ delta 事件返回文本流
- ✅ audio_delta 事件返回音频流（PCM16, 24kHz）
- ✅ 使用医生音色（杨渝平医生音色）
- ✅ 回答内容专业且完整

**生成的回答摘要**:
> **结论**：您最近睡眠不好且白天疲惫，建议先从简单、无创的检查入手，比如记录睡眠日记和进行心理评估量表筛查。

---

## 功能验证

### ✅ 患者端完整流程

1. **注册/登录**: 患者注册并登录 ✅
2. **选择医生**: 查看可用医生目录 ✅
3. **获取素材**: 获取医生音色和视频 ✅
4. **创建会话**: 与医生建立问诊会话 ✅
5. **流式问诊**: 文本+音频实时回答 ✅

### ✅ 与医生端对比

| 功能 | 医生端 | 患者端 | 差异 |
|-----|-------|-------|-----|
| 会话创建 | 演练场 | 真实问诊 | 患者端绑定医生 |
| 知识库 | 用于学习 | 用于回答 | 患者端只读 |
| 叙事底座 | 可编辑 | 只读使用 | 患者端不修改 |
| 语音输出 | 无 | 有 | 患者端默认开启 |
| 学习反馈 | 写入底座 | 无 | 患者端不学习 |

---

## 测试命令参考

```bash
# 1. 患者注册
curl -X POST http://127.0.0.1:8000/api/auth/patient/register/ \
  -H "Content-Type: application/json" \
  -d '{"username": "patient_zhang", "password": "12345678", "nickname": "张女士"}'

# 2. 患者登录
curl -X POST http://127.0.0.1:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username": "patient_zhang", "password": "12345678"}'

# 3. 获取医生目录
curl -X GET http://127.0.0.1:8000/api/patient/doctors/ \
  -H "Authorization: Bearer <patient_token>"

# 4. 获取医生素材
curl -X GET http://127.0.0.1:8000/api/patient/doctors/2/assets/ \
  -H "Authorization: Bearer <patient_token>"

# 5. 创建会话
curl -X POST http://127.0.0.1:8000/api/patient/sessions/ \
  -H "Authorization: Bearer <patient_token>" \
  -H "Content-Type: application/json" \
  -d '{"doctor_id": 2, "title": "术后恢复咨询"}'

# 6. 获取会话列表
curl -X GET http://127.0.0.1:8000/api/patient/sessions/ \
  -H "Authorization: Bearer <patient_token>"

# 7. 获取消息列表
curl -X GET "http://127.0.0.1:8000/api/patient/sessions/1/messages/?limit=100" \
  -H "Authorization: Bearer <patient_token>"

# 8. 流式问答
curl -N -X POST http://127.0.0.1:8000/api/patient/sessions/1/ask/stream/ \
  -H "Authorization: Bearer <patient_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "我最近睡眠不好怎么办？",
    "forced_search": true,
    "enable_audio": true
  }'
```

---

## 测试数据

**患者账号**:
- 用户名: `patient_zhang`
- 密码: `12345678`
- ID: 6

**创建的会话**:
- 会话ID: 1
- 绑定医生: 李医生（ID=2）
- 标题: 术后恢复咨询

**可用医生**:
- 李医生（ID=2）- 协和医院 - 心内科
- 赵医生（ID=4）- 中山医院 - 消化内科

---

*报告生成时间: 2026-02-09 16:45*  
**测试总结: ✅ 全部7个接口测试通过，患者端问诊功能完整可用！**
