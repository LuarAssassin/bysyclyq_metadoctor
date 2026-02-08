# API 测试报告 - 医生数字人素材（菜单2）

**测试时间**: 2026-02-09  
**测试环境**: http://127.0.0.1:8000/api  
**测试人员**: Kimi Code CLI  
**测试素材**:
- voice.MP3 (1.3MB) - 声音样本
- yangyuping.png (1.4MB) - 医生照片

---

## 测试概览

| 接口 | 方法 | 状态 | 说明 |
|-----|------|-----|-----|
| POST /doctor/digital-human/voice/ | 创建音色 | ✅ 通过 | 成功创建Qwen音色 |
| GET /doctor/digital-human/voice/ | 获取音色列表 | ✅ 通过 | 返回已创建音色 |
| POST /doctor/digital-human/videos/ | 创建视频任务 | ✅ **通过** | 修复后成功创建 |
| GET /doctor/digital-human/videos/ | 获取视频列表 | ✅ 通过 | 返回任务列表 |
| POST /doctor/digital-human/videos/{id}/refresh/ | 刷新状态 | ✅ 通过 | 状态正常刷新 |

**通过率**: 5/5 (100%) ✅

---

## 详细测试记录

### 1. 医生登录

**请求**:
```bash
POST /api/auth/login/
Content-Type: application/json
Body: {"username": "doctor_li", "password": "12345678"}
```

**响应**: ✅ 成功  
**Token**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

---

### 2. POST /doctor/digital-human/voice/ ✅

**功能**: 上传医生录音样本并调用 Qwen create_voice 创建专属音色

**请求**:
```bash
POST /api/doctor/digital-human/voice/
Authorization: Bearer <token>
Content-Type: multipart/form-data
Body:
  - audio: voice.MP3 (1.3MB)
  - name: "杨渝平医生音色"
  - preferred_name: "yangyuping_voice"
  - set_active: true
```

**响应** (201 Created):
```json
{
  "code": 201,
  "message": "音色创建成功",
  "data": {
    "id": 1,
    "name": "杨渝平医生音色",
    "preferred_name": "yangyuping_voice",
    "target_model": "qwen3-tts-vc-realtime-2026-01-15",
    "qwen_voice_id": "qwen-tts-vc-yangyuping_voice-voice-20260209005435515-b4d1",
    "sample_file_name": "voice.MP3",
    "sample_oss_url": "http://oss.x3yun.com/doctor-digital-human/voice-samples/2/2026/02/09/...",
    "sample_size_bytes": 1412543,
    "is_active": true,
    "status": "ready"
  }
}
```

**验证点**:
- ✅ HTTP 201 状态码
- ✅ 音色创建成功，qwen_voice_id 已生成
- ✅ 文件上传到OSS成功
- ✅ is_active: true, status: ready

---

### 3. GET /doctor/digital-human/voice/ ✅

**功能**: 获取当前医生的音色档案列表

**请求**:
```bash
GET /api/doctor/digital-human/voice/
Authorization: Bearer <token>
```

**响应** (200 OK):
```json
{
  "code": 200,
  "message": "获取成功",
  "data": [
    {
      "id": 1,
      "name": "杨渝平医生音色",
      "qwen_voice_id": "qwen-tts-vc-yangyuping_voice-voice-20260209005435515-b4d1",
      "status": "ready",
      "is_active": true
    }
  ]
}
```

---

### 4. POST /doctor/digital-human/videos/ ✅ **(修复后)**

**功能**: 上传医生正面图片并提交"图生无声讲解视频"任务

**请求**:
```bash
POST /api/doctor/digital-human/videos/
Authorization: Bearer <token>
Content-Type: multipart/form-data
Body:
  - image: yangyuping.png (1.4MB)
  - prompt: "医生讲解医学知识，专业自信，手势自然"
  - duration: 5
  - resolution: "720P"
```

**响应** (201 Created):
```json
{
  "code": 201,
  "message": "图生视频任务已创建",
  "data": {
    "id": 1,
    "image_file_name": "yangyuping.png",
    "image_oss_url": "http://oss.x3yun.com/doctor-digital-human/images/2/2026/02/09/9c3e98e3b6f24abebce3af91766172a1_yangyuping.png",
    "video_model": "wan2.6-i2v-flash",
    "prompt": "请基于输入的医生正面照片生成一个无声健康科普短视频...",
    "negative_prompt": "夸张表情, 剧烈动作, 镜头抖动...",
    "resolution": "720P",
    "duration_seconds": 5,
    "audio_enabled": false,
    "task_id": "fd09643a-926d-423b-96f5-d504dc1cb68b",
    "task_status": "submitted",
    "video_url_external": "",
    "video_oss_url": null,
    "created_at": "2026-02-09T01:02:32.620750"
  }
}
```

**验证点**:
- ✅ HTTP 201 状态码（修复前 500）
- ✅ 任务创建成功
- ✅ task_id 已生成
- ✅ task_status: submitted
- ✅ 图片上传到OSS成功
- ✅ 参数正确：audio_enabled=false, resolution=720P, duration=5

---

### 5. GET /doctor/digital-human/videos/ ✅

**功能**: 获取当前医生的图生视频任务列表

**请求**:
```bash
GET /api/doctor/digital-human/videos/
Authorization: Bearer <token>
```

**响应** (200 OK):
```json
{
  "code": 200,
  "message": "获取成功",
  "data": [
    {
      "id": 1,
      "image_file_name": "yangyuping.png",
      "video_model": "wan2.6-i2v-flash",
      "resolution": "720P",
      "duration_seconds": 5,
      "task_status": "submitted",
      "video_url_external": "",
      "video_oss_url": null,
      "created_at": "2026-02-09T01:02:32.620750"
    }
  ]
}
```

---

### 6. POST /doctor/digital-human/videos/{id}/refresh/ ✅

**功能**: 主动刷新图生视频任务状态

**请求**:
```bash
POST /api/doctor/digital-human/videos/1/refresh/
Authorization: Bearer <token>
```

**响应** (200 OK):
```json
{
  "code": 200,
  "message": "任务状态已刷新",
  "data": {
    "id": 1,
    "task_id": "fd09643a-926d-423b-96f5-d504dc1cb68b",
    "task_status": "running",
    "video_url_external": "",
    "video_oss_url": null,
    "last_synced_at": "2026-02-09T01:03:00.483393",
    "updated_at": "2026-02-09T01:03:00.484857"
  }
}
```

**验证点**:
- ✅ HTTP 200 状态码
- ✅ 状态从 `submitted` 变为 `running`
- ✅ last_synced_at 已更新

---

## 测试结论

### ✅ 全部接口测试通过

1. **声音创建**: 成功创建Qwen专属音色（ID=1）
2. **声音列表**: 正常获取音色档案
3. **视频创建**: 修复后成功创建异步任务（ID=1）
4. **视频列表**: 正常获取任务列表
5. **状态刷新**: 正常同步DashScope任务状态

### 修复验证 ✅

| 问题 | 修复前 | 修复后 |
|-----|-------|-------|
| 视频创建接口 | 500: 'model_dump' | ✅ 201: 任务已创建 |
| DashScope响应解析 | 依赖model_dump失败 | ✅ 兼容dict-mixin对象 |
| 回归测试 | - | ✅ 4 tests通过 |

### 异步任务状态流转

```
created (submitted) -> running -> succeeded/failed
     ↑                    ↓
     └──────── refresh ───┘
```

当前视频任务状态: **running** (处理中)

---

## 附件

### 完整测试命令

```bash
# 1. 登录
curl -X POST http://127.0.0.1:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username": "doctor_li", "password": "12345678"}'

# 2. 创建音色
curl -X POST http://127.0.0.1:8000/api/doctor/digital-human/voice/ \
  -H "Authorization: Bearer <token>" \
  -F "audio=@voice.MP3" \
  -F "name=杨渝平医生音色" \
  -F "preferred_name=yangyuping_voice" \
  -F "set_active=true"

# 3. 获取音色列表
curl -X GET http://127.0.0.1:8000/api/doctor/digital-human/voice/ \
  -H "Authorization: Bearer <token>"

# 4. 创建视频任务
curl -X POST http://127.0.0.1:8000/api/doctor/digital-human/videos/ \
  -H "Authorization: Bearer <token>" \
  -F "image=@yangyuping.png" \
  -F "prompt=医生讲解医学知识，专业自信，手势自然" \
  -F "duration=5" \
  -F "resolution=720P"

# 5. 获取视频列表
curl -X GET http://127.0.0.1:8000/api/doctor/digital-human/videos/ \
  -H "Authorization: Bearer <token>"

# 6. 刷新任务状态
curl -X POST http://127.0.0.1:8000/api/doctor/digital-human/videos/1/refresh/ \
  -H "Authorization: Bearer <token>"
```

---

*报告更新时间: 2026-02-09 01:03*  
**测试总结: ✅ 所有接口测试通过，修复验证成功！**
