# 患者端 H5 嵌入接口文档

## 1. 说明

当前线上患者端 H5 页面入口是：

- `https://meta-chongli.x3yun.com/auth/login`

这个地址是前端页面路由，不是患者登录 API。

当前线上部署是“同域前端 + `/api` 反向代理后端”，因此真实 API 根地址应视为：

- `https://meta-chongli.x3yun.com/api`

当前患者端 H5 的真实登录方式是：

1. `POST /api/auth/patient/code/send/`
2. `POST /api/auth/patient/code/login/`
3. 可选 `POST /api/auth/patient/google/login/`

注意：`POST /api/auth/login/` 在当前项目里是医生/管理员用户名密码登录接口，不是患者 H5 的主登录接口。

## 2. 用途范围

本文用于在其他应用中，以纯前端方式复现当前患者端 H5 的核心能力，并嵌入以下链路：

1. 手机号/邮箱验证码登录
2. 医生列表
3. 创建问诊会话
4. 历史消息拉取
5. 附件上传
6. 流式问诊
7. 中断生成
8. 语音转文字

如果还要完整复刻“问诊记录”和“我的”页面，可以继续接入会话管理和个人资料接口。

## 3. 最小接入闭环

推荐按下面顺序实现：

1. 登录页输入手机号或邮箱
2. 调 `POST /api/auth/patient/code/send/`
3. 用户输入验证码，调 `POST /api/auth/patient/code/login/`
4. 保存 `access`、`refresh`、`profile`
5. 调 `GET /api/patient/doctors/` 获取医生列表
6. 用户选中医生后调 `POST /api/patient/sessions/` 创建会话
7. 进入聊天页先调 `GET /api/patient/sessions/{session_id}/messages/`
8. 如需上传图片或文档，先调 `POST /api/patient/sessions/{session_id}/attachments/`
9. 再调 `POST /api/patient/sessions/{session_id}/ask/stream/` 发起流式问诊
10. 流结束后重新调用 `GET /api/patient/sessions/{session_id}/messages/`，以服务端最终落库结果为准

## 4. 统一约定

### 4.1 Base URL

生产环境建议直接使用：

```text
https://meta-chongli.x3yun.com/api
```

### 4.2 鉴权

- `Authorization: Bearer <access_token>`
- 登录后需要保存 `access` 和 `refresh`
- 普通请求与流式请求都要处理 `401`

### 4.3 Token 刷新

当前患者端的前端行为是：

1. 请求返回 `401`
2. 调 `POST /api/auth/token/refresh/`
3. 刷新成功后重试原请求一次
4. 刷新失败则清空登录态并跳回登录页

刷新接口请求体：

```json
{
  "refresh": "<refresh_token>"
}
```

成功响应：

```json
{
  "access": "<new_access_token>"
}
```

### 4.4 通用响应结构

除 SSE 流外，普通接口统一返回：

```json
{
  "code": 200,
  "message": "获取成功",
  "data": {}
}
```

常见状态含义：

- `200`：成功
- `201`：创建成功
- `400`：参数错误或业务校验失败
- `401`：未登录或 token 失效
- `404`：资源不存在
- `409`：账号标识冲突
- `429`：验证码发送过频
- `500`：服务端配置或模型服务异常

### 4.5 SSE 说明

当前问诊流不是 `EventSource`，而是：

- `fetch`
- `POST`
- `Authorization` 头
- `Content-Type: application/json`
- 服务端返回 `text/event-stream`

因此前端必须手动解析 `event:` 和 `data:` 行。

### 4.6 跨域嵌入提醒

当前线上默认同域。如果你的宿主前端不在 `meta-chongli.x3yun.com` 域下，建议优先采用你自己的后端代理转发。若要浏览器直连，需要额外确认：

1. 后端已开放所需 CORS
2. 网关支持 SSE 长连接
3. 中间层没有开启流缓冲

## 5. 页面与接口映射

| 页面能力 | 前端路由 | 实际 API |
| --- | --- | --- |
| 登录页 | `/auth/login` | `/api/auth/patient/code/send/`、`/api/auth/patient/code/login/`、`/api/auth/patient/google/login/` |
| 找医生 | `/doctors` | `/api/patient/doctors/`、`/api/patient/doctors/{doctor_id}/assets/` |
| 聊天问诊 | `/chat/{session_id}` | `/api/patient/sessions/{session_id}/messages/`、`/api/patient/sessions/{session_id}/attachments/`、`/api/patient/sessions/{session_id}/ask/stream/`、`/api/patient/sessions/{session_id}/messages/{message_id}/interrupt/`、`/api/patient/asr/transcribe/` |
| 问诊记录 | `/sessions` | `/api/patient/sessions/`、`PATCH /api/patient/sessions/{session_id}/`、`DELETE /api/patient/sessions/{session_id}/` |
| 我的 | `/profile` | `/api/auth/me/`、`PATCH /api/auth/me/`、`POST /api/auth/me/avatar/` |

## 6. 接口清单

### 6.1 发送验证码

`POST /api/auth/patient/code/send/`

用途：患者手机号或邮箱接码。

Auth：否

请求体：

```json
{
  "channel": "sms",
  "target": "13800001111"
}
```

字段说明：

- `channel`：`sms` 或 `email`
- `target`：手机号或邮箱，服务端会做规范化校验

成功响应：

```json
{
  "code": 200,
  "message": "验证码已发送",
  "data": {
    "channel": "sms",
    "target": "13800001111",
    "expire_seconds": 300
  }
}
```

### 6.2 验证码登录

`POST /api/auth/patient/code/login/`

用途：验证码登录；若该手机号或邮箱首次登录，服务端会自动创建患者账号。

Auth：否

请求体：

```json
{
  "channel": "sms",
  "target": "13800001111",
  "code": "123456",
  "nickname": "张女士"
}
```

字段说明：

- `code` 必须是纯数字，长度至少 4 位，最大 8 位
- `nickname` 可为空；首次创号时若未传，服务端会自动生成默认昵称

成功响应：

```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "refresh": "<refresh_token>",
    "access": "<access_token>",
    "profile": {
      "id": 23,
      "username": "patient_20260612093000_ab12cd34",
      "nickname": "张女士",
      "email": null,
      "phone": "13800001111",
      "gender": "U",
      "birthday": null,
      "age": null,
      "institution": null,
      "profession": null,
      "address": null,
      "avatar": null,
      "is_doctor": false,
      "doctor_apply_status": "pending",
      "doctor_applied_at": null,
      "doctor_reviewed_at": null,
      "doctor_review_note": null,
      "created_at": "2026-06-12T09:30:00",
      "updated_at": "2026-06-12T09:30:00"
    },
    "created": true,
    "login_channel": "sms",
    "login_target": "13800001111"
  }
}
```

典型失败：

```json
{
  "code": 400,
  "message": "验证码错误或已过期",
  "data": null
}
```

### 6.3 Google 登录（可选）

`POST /api/auth/patient/google/login/`

Auth：否

请求体：

```json
{
  "credential": "<google_identity_token>"
}
```

说明：

1. 只有服务端配置了 `GOOGLE_CLIENT_ID`，前端才应该显示 Google 登录按钮
2. 成功响应结构与验证码登录一致，只是 `login_channel` 为 `google`

### 6.4 获取当前用户

`GET /api/auth/me/`

用途：恢复登录态、渲染“我的”页面。

Auth：是

### 6.5 更新当前用户

`PATCH /api/auth/me/`

用途：修改昵称、手机号、邮箱、性别、生日、机构、职业、地址等资料。

Auth：是

当前患者端常见提交字段：

```json
{
  "nickname": "张女士",
  "gender": "U",
  "birthday": null,
  "address": "北京市海淀区"
}
```

### 6.6 上传头像

`POST /api/auth/me/avatar/`

Auth：是

请求格式：`multipart/form-data`

表单字段：

- `image`

### 6.7 获取医生列表

`GET /api/patient/doctors/`

用途：渲染“找医生”页面。

Auth：是

成功响应：

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
    }
  ]
}
```

说明：只返回已审核通过且可服务的医生。

### 6.8 获取医生素材

`GET /api/patient/doctors/{doctor_id}/assets/`

用途：数字人视频、开场白、语音音色等素材。

Auth：是

成功响应核心字段：

```json
{
  "code": 200,
  "message": "获取成功",
  "data": {
    "doctor": {
      "id": 4,
      "username": "doctor_zhao",
      "nickname": "赵医生",
      "avatar": null,
      "institution": "中山医院",
      "profession": "消化内科"
    },
    "tts_model": "qwen3-tts-vc-realtime-2026-01-15",
    "voice_id": "qwen-tts-voice-id",
    "voice_name": "赵医生音色",
    "opening": {
      "text": "您好，我先了解一下您的情况。",
      "audio_url": null
    },
    "video_urls": ["https://..."],
    "videos": [
      {
        "video_id": 6,
        "scene_key": "listening_pause",
        "scene_name": "倾听停顿",
        "video_url": "https://...",
        "video_oss_url": "https://..."
      }
    ]
  }
}
```

说明：

1. 纯文本问诊时，这个接口不是强依赖
2. `video_url` 可能是签名地址，不适合长期缓存

### 6.9 创建问诊会话

`POST /api/patient/sessions/`

用途：开始一场新的问诊。

Auth：是

请求体：

```json
{
  "doctor_id": 4,
  "title": "术后恢复咨询"
}
```

说明：

- `doctor_id` 必填
- `title` 可选；不传时服务端会自动生成默认标题

成功响应：

```json
{
  "code": 201,
  "message": "患者问诊会话已创建",
  "data": {
    "id": 15,
    "doctor": {
      "id": 4,
      "username": "doctor_zhao",
      "nickname": "赵医生",
      "avatar": null,
      "institution": "中山医院",
      "profession": "消化内科"
    },
    "title": "术后恢复咨询",
    "status": "active",
    "is_pinned": false,
    "pinned_at": null,
    "summary": null,
    "last_message_at": null,
    "created_at": "2026-06-12T09:35:00",
    "updated_at": "2026-06-12T09:35:00"
  }
}
```

### 6.10 获取会话列表

`GET /api/patient/sessions/`

用途：渲染“问诊记录”页面。

Auth：是

说明：返回当前患者自己的会话，并按置顶和最近更新时间排序。

### 6.11 会话置顶

`PATCH /api/patient/sessions/{session_id}/`

用途：切换会话置顶状态。

Auth：是

请求体：

```json
{
  "is_pinned": true
}
```

### 6.12 删除会话

`DELETE /api/patient/sessions/{session_id}/`

用途：删除当前患者自己的会话。

Auth：是

成功响应：

```json
{
  "code": 200,
  "message": "会话已删除",
  "data": null
}
```

### 6.13 获取消息列表

`GET /api/patient/sessions/{session_id}/messages/?limit=100`

用途：进入聊天页时拉历史，也用于流结束后的最终一致性回拉。

Auth：是

查询参数：

- `limit` 默认 100，最大 300

成功响应结构：

```json
{
  "code": 200,
  "message": "获取成功",
  "data": {
    "session": {
      "id": 15,
      "title": "术后恢复咨询",
      "status": "active"
    },
    "messages": [
      {
        "id": 101,
        "session": 15,
        "role": "user",
        "turn_index": 1,
        "generation_status": "succeeded",
        "review_status": "approved",
        "content": "我最近胸闷两周了",
        "content_markdown": "我最近胸闷两周了",
        "selected_file_ids": [],
        "selected_file_meta": [],
        "grounding_answer": null,
        "grounding_sources": [],
        "search_sources": [],
        "meta": null,
        "created_at": "2026-06-12T09:40:00",
        "updated_at": "2026-06-12T09:40:00"
      },
      {
        "id": 102,
        "session": 15,
        "role": "assistant",
        "turn_index": 1,
        "generation_status": "succeeded",
        "review_status": "pending",
        "content": "您好，请再描述一下症状持续时间……",
        "content_markdown": "您好，请再描述一下症状持续时间……",
        "selected_file_ids": ["file-xxx"],
        "search_sources": [],
        "meta": {
          "audio": {
            "enabled": true,
            "status": "succeeded"
          }
        },
        "created_at": "2026-06-12T09:40:01",
        "updated_at": "2026-06-12T09:40:10"
      }
    ]
  }
}
```

前端重点使用字段：

- `role`
- `content` 或 `content_markdown`
- `generation_status`
- `review_status`
- `search_sources`
- `meta.attachments`
- `meta.audio`

### 6.14 上传附件

`POST /api/patient/sessions/{session_id}/attachments/`

用途：发送问题之前上传图片或文档，后续在问诊流里通过 `attachment_id` 引用。

Auth：是

请求格式：`multipart/form-data`

表单字段：

- 多文件：`files`
- 兼容单文件：`file`

服务端默认限制：

- 单次最多 5 个附件
- 单文件最大 20MB
- 图片单文件最大 10MB
- 附件缓存有效期 30 天

支持图片扩展名：

```text
.jpe .jpg .jpeg .png .gif .bmp .webp
```

支持文档扩展名：

```text
.txt .md .pdf .doc .docx .xls .xlsx .ppt .pptx .csv .json .epub .mobi
```

成功响应：

```json
{
  "code": 200,
  "message": "附件上传成功",
  "data": {
    "attachments": [
      {
        "attachment_id": "b91b629d7f1d4e2ba5f0c123456789ab",
        "file_kind": "image",
        "file_name": "report.jpg",
        "content_type": "image/jpeg",
        "size_bytes": 345678,
        "file_url": "https://...signed-url...",
        "preview_url": "https://...signed-url...",
        "created_at": "2026-06-12T09:42:00+08:00"
      }
    ],
    "expire_seconds": 2592000
  }
}
```

接入注意：

1. 发问诊时传的是 `attachment_id`，不是 `file_url`
2. 若服务端提示“部分附件已失效”，需要重新上传

### 6.15 语音转写

`POST /api/patient/asr/transcribe/`

用途：把录音转为文本输入。

Auth：是

请求格式：`multipart/form-data`

表单字段：

- `audio`

服务端默认限制：

- 最大 12MB
- 支持：`.mp3 .wav .m4a .aac .flac .ogg .webm .amr .mp4`

成功响应：

```json
{
  "code": 200,
  "message": "语音识别成功",
  "data": {
    "text": "我最近胸闷两周了",
    "model": "qwen-asr",
    "content_type": "audio/webm",
    "size_bytes": 182736
  }
}
```

### 6.16 发起流式问诊

`POST /api/patient/sessions/{session_id}/ask/stream/`

用途：核心问诊接口，返回 SSE 文本流，支持附件分析、知识检索、联网来源和实时音频片段。

Auth：是

请求头：

```http
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: text/event-stream
```

请求体：

```json
{
  "question": "我最近胸闷两周了，偶尔会心慌，该怎么办？",
  "attachment_ids": ["b91b629d7f1d4e2ba5f0c123456789ab"],
  "forced_search": false,
  "enable_audio": true
}
```

字段说明：

- `question`：可为空；若带了附件且 `question` 为空，服务端会自动补一句默认提问
- `attachment_ids`：来自上传附件接口返回的 `attachment_id`
- `forced_search`：可选，是否强制联网检索
- `enable_audio`：可选，是否返回音频增量事件，默认 `true`

SSE 常见事件：

1. `start`
2. `delta`
3. `audio_delta`
4. `audio_error`
5. `done`
6. `error`

`start` 事件示例：

```text
event: start
data: {"session_id":15,"question_message_id":101,"answer_message_id":102,"doctor_id":4,"selected_file_ids":["file-xxx"],"selected_file_meta":[],"grounding_sources":[],"question_attachments":[{"attachment_id":"b91b629d7f1d4e2ba5f0c123456789ab","file_kind":"image","file_name":"report.jpg","content_type":"image/jpeg","size_bytes":345678,"file_url":"https://...","preview_url":"https://...","created_at":"2026-06-12T09:42:00+08:00"}],"audio":{"enabled":true,"status":"streaming","voice_id":"qwen-tts-voice-id","voice_name":"赵医生音色","tts_model":"qwen3-tts-vc-realtime-2026-01-15","audio_format":"pcm16","sample_rate":24000,"channels":1}}
```

`delta` 事件示例：

```text
event: delta
data: {"message_id":102,"delta":"您好，先不要紧张。"}
```

`audio_delta` 事件示例：

```text
event: audio_delta
data: {"message_id":102,"audio_format":"pcm16","sample_rate":24000,"channels":1,"delta":"<base64_pcm_chunk>"}
```

`done` 事件示例：

```text
event: done
data: {"message_id":102,"usage":{"input_tokens":1024,"output_tokens":356,"total_tokens":1380},"search_sources":[{"index":1,"title":"...","url":"https://..."}],"selected_file_ids":["file-xxx"],"question_attachments":[{"attachment_id":"b91b629d7f1d4e2ba5f0c123456789ab","file_kind":"image","file_name":"report.jpg","content_type":"image/jpeg","size_bytes":345678,"file_url":"https://...","preview_url":"https://...","created_at":"2026-06-12T09:42:00+08:00"}],"interrupted":false,"audio":{"enabled":true,"status":"succeeded","audio_format":"pcm16","sample_rate":24000,"channels":1}}
```

`error` 事件示例：

```text
event: error
data: {"message":"问诊请求失败"}
```

前端处理建议：

1. 本地先插入“用户临时消息”和“助手生成中消息”
2. 收到 `start` 后，用真实 `question_message_id` 和 `answer_message_id` 替换临时 ID
3. 每次收到 `delta` 都追加到助手消息正文
4. 每次收到 `audio_delta` 都解码后推给 PCM 播放器
5. 收到 `done` 后更新来源、token 用量、音频状态
6. 流结束后再调一次 `/messages/` 做最终一致性同步

### 6.17 中断生成

`POST /api/patient/sessions/{session_id}/messages/{message_id}/interrupt/`

用途：用户点击“停止生成”时保存当前已生成内容。

Auth：是

请求体：

```json
{
  "partial_content": "您好，结合您目前描述的情况，建议先..."
}
```

说明：

1. `message_id` 必须是当前会话中正在生成的 `assistant` 消息 ID
2. `partial_content` 建议回传当前前端已拼接出的文本，便于服务端落库

成功响应：

```json
{
  "code": 200,
  "message": "已停止生成并保存当前内容",
  "data": {
    "id": 102,
    "generation_status": "succeeded",
    "content": "您好，结合您目前描述的情况，建议先...",
    "meta": {
      "interrupted": true,
      "interrupted_at": "2026-06-12T09:45:00+08:00"
    }
  }
}
```

推荐前端动作：

1. 先 `AbortController.abort()` 中止当前流请求
2. 再调用 `/interrupt/`
3. 成功后重新拉一次 `/messages/`

## 7. 纯前端实现建议

### 7.1 普通请求

建议统一封装：

1. 自动带 `Authorization`
2. 遇到 `401` 自动刷新并重试一次
3. 错误优先展示响应里的 `message`

### 7.2 流式请求

建议用 `fetch` + `ReadableStream` 手动解析 SSE。示意代码：

```ts
async function askPatientStream(sessionId: number, payload: {
  question: string
  attachment_ids?: string[]
  forced_search?: boolean
  enable_audio?: boolean
}) {
  const res = await fetch(`/api/patient/sessions/${sessionId}/ask/stream/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const reader = res.body!.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let eventName = 'message'
  let dataLines: string[] = []

  const emit = () => {
    if (!dataLines.length) return
    const raw = dataLines.join('\n')
    const data = JSON.parse(raw)
    if (eventName === 'start') onStart(data)
    if (eventName === 'delta') onDelta(data)
    if (eventName === 'audio_delta') onAudioDelta(data)
    if (eventName === 'done') onDone(data)
    if (eventName === 'error') onError(data)
    if (eventName === 'audio_error') onAudioError(data)
    eventName = 'message'
    dataLines = []
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    while (true) {
      const idx = buffer.indexOf('\n')
      if (idx < 0) break
      const line = buffer.slice(0, idx).trimEnd()
      buffer = buffer.slice(idx + 1)
      if (!line) {
        emit()
        continue
      }
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
        continue
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim())
      }
    }
  }
}
```

### 7.3 语音相关

当前患者端的语音能力拆成两段：

1. 浏览器录音后通过 `/api/patient/asr/transcribe/` 做语音转文字
2. 问诊流里通过 `audio_delta` 事件下发 Base64 PCM 音频分片

如果宿主应用暂时不需要播报能力，可以在问诊流里传：

```json
{
  "enable_audio": false
}
```

## 8. 最容易踩坑的点

1. 不要把 `/auth/login` 当成 API，它只是患者 H5 页面路由。
2. 患者当前主登录接口不是 `/api/auth/login/`，而是验证码登录接口。
3. `/ask/stream/` 必须用 `POST`，并手动解析 SSE。
4. 附件上传后后续发问传的是 `attachment_id`，不是文件 URL。
5. 流结束后一定再拉一次 `/messages/`，否则前端状态可能和服务端落库不一致。
6. `video_url`、`file_url`、`preview_url` 通常是带有效期的签名地址，不应永久缓存。
7. 若要跨域嵌入，优先做你自己的后端代理，浏览器直连更容易在 CORS、鉴权和 SSE 上出问题。

## 9. 推荐给外部接入方的最小接口包

如果对方只需要嵌入“问诊能力”，不追求和当前 H5 一模一样，建议最少交付：

1. `POST /api/auth/patient/code/send/`
2. `POST /api/auth/patient/code/login/`
3. `POST /api/auth/token/refresh/`
4. `GET /api/patient/doctors/`
5. `POST /api/patient/sessions/`
6. `GET /api/patient/sessions/{session_id}/messages/`
7. `POST /api/patient/sessions/{session_id}/ask/stream/`
8. `POST /api/patient/sessions/{session_id}/attachments/`
9. `POST /api/patient/sessions/{session_id}/messages/{message_id}/interrupt/`
10. `POST /api/patient/asr/transcribe/`

这组接口已经足够在其他前端应用中复现当前患者端 H5 的核心问诊能力。