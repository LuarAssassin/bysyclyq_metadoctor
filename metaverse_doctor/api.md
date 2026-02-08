# API 文档（前端关键接口）

## 1. 基础信息

- Base URL：`http://127.0.0.1:8000/api`
- 鉴权方式：JWT Bearer
- Header：`Authorization: Bearer <access_token>`

统一响应结构（非分页）：

```json
{
  "code": 200,
  "message": "操作成功",
  "data": {}
}
```

分页响应结构：

```json
{
  "code": 200,
  "message": "获取成功",
  "data": {
    "count": 0,
    "next": null,
    "previous": null,
    "results": [],
    "total_pages": 0,
    "current_page": 1
  }
}
```

## 2. 认证与医生审核

### 2.1 `POST /auth/doctor/register/`

功能：提交医生注册申请，进入待审核状态，审核通过后才能登录。

- Auth：无需
- Content-Type：`application/json`
- Body：

```json
{
  "username": "doctor_zhang",
  "password": "12345678",
  "email": "doctor_zhang@example.com",
  "phone": "13800001111",
  "nickname": "张医生",
  "institution": "北医三院",
  "profession": "骨科"
}
```

- 成功（201）：

```json
{
  "code": 201,
  "message": "医生注册申请已提交，审核通过后可登录",
  "data": {
    "id": 12,
    "username": "doctor_zhang",
    "nickname": "张医生",
    "email": "doctor_zhang@example.com",
    "phone": "13800001111",
    "institution": "北医三院",
    "profession": "骨科",
    "doctor_apply_status": "pending",
    "doctor_applied_at": "2026-02-08T10:00:00",
    "doctor_reviewed_at": null,
    "doctor_review_note": null,
    "created_at": "2026-02-08T10:00:00"
  }
}
```

### 2.2 `POST /auth/login/`

功能：医生或管理员登录，返回 JWT；医生未审核通过会被拦截。

- Auth：无需
- Content-Type：`application/json`
- Body：

```json
{
  "username": "doctor_zhang",
  "password": "12345678"
}
```

- 成功（200）：

```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "refresh": "xxx",
    "access": "xxx"
  }
}
```

- 失败示例（医生待审核，401）：

```json
{
  "code": 401,
  "message": "医生账号审核中，审核通过后才能登录",
  "data": null
}
```

### 2.3 `POST /auth/token/refresh/`

功能：用 refresh token 换新 access token。

- Auth：无需
- Content-Type：`application/json`
- Body：

```json
{
  "refresh": "<refresh_token>"
}
```

### 2.4 `GET /auth/doctor/applications/`

功能：管理员查看医生申请列表并按状态筛选。

- Auth：管理员 token
- Query：
  - `status`: `pending | approved | rejected | all`（默认 `pending`）
  - `page`, `page_size`

### 2.5 `PATCH /auth/doctor/applications/{user_id}/review/`

功能：管理员审核医生申请（通过/拒绝）。

- Auth：管理员 token
- Content-Type：`application/json`
- Body：

```json
{
  "status": "approved",
  "review_note": "资质审核通过"
}
```

## 3. 医生知识库文件与抽取

### 3.1 `POST /doctor/knowledge/`

功能：医生上传知识文件到 OSS，并创建抽取任务（异步队列执行）。

- Auth：医生 token
- Content-Type：`multipart/form-data`
- Form-Data：
  - 单文件：`file`
  - 多文件：`files`（同名 key 多个）
- 限制：
  - 单文件最大 150MB（图片文件最大 20MB）
  - 单次最多 10 个
  - 支持格式（与 Qwen 抽取链路对齐）：
    `.txt .md .pdf .doc .docx .xls .xlsx .ppt .pptx .csv .json .epub .mobi .jpe .jpg .jpeg .png .gif .bmp`

- 成功（201）返回字段重点：
  - `extract_queued_count`: 成功进入抽取队列的文件数
  - `extract_failed_count`: 抽取初始化失败数
  - `items[]`: 每个文件详细记录（含 `qwen_file_id`、`extract_status`、`knowledge_status`）

### 3.2 `GET /doctor/knowledge/`

功能：分页获取医生自己的知识文件完整列表（后台管理页常用）。

- Auth：医生 token
- Query：`page`, `page_size`

返回 `results[]` 里包含核心状态字段：

- `qwen_file_id`
- `extract_status`：`pending | queued | running | success | failed`
- `knowledge_status`：`pending | synced | failed`
- `knowledge_description`
- `tags`
- `extract_error`

### 3.3 `GET /doctor/knowledge/indexes/`

功能：获取医生“知识索引”列表，给前端检索/展示用的轻量数据。

- Auth：医生 token
- 返回（200）：

```json
{
  "code": 200,
  "message": "获取成功",
  "data": [
    {
      "file_name": "运动损伤那些事终稿.pdf",
      "file_id": "file-fe-3305a91fcbb549288c53b337",
      "tags": ["运动损伤", "康复训练"],
      "description": "文档介绍常见运动损伤的成因、预防和康复方案..."
    }
  ]
}
```

### 3.4 `GET /doctor/knowledge/tags/`

功能：获取医生名下标签聚合统计（标签云、图表场景）。

- Auth：医生 token
- 返回 `data[]`：

```json
[
  {
    "id": 1,
    "name": "运动损伤",
    "file_count": 6
  }
]
```

### 3.5 `POST /doctor/knowledge/{knowledge_id}/extract/`

功能：手动重触发某个文件的抽取任务（重新入队）。

- Auth：医生 token
- 成功（200）：`message = "已加入抽取队列"`

### 3.6 `DELETE /doctor/knowledge/{knowledge_id}/`

功能：删除医生自己的知识文件记录（软删除）。

- Auth：医生 token
- 成功（200）：

```json
{
  "code": 200,
  "message": "删除成功",
  "data": null
}
```

## 4. 医生数字人素材（菜单2）

### 4.1 `POST /doctor/digital-human/voice/`

功能：上传医生录音样本并调用 Qwen `create_voice` 创建专属音色，结果入库。

- Auth：医生 token
- Content-Type：`multipart/form-data`
- Form-Data：
  - `audio`：音频文件（必填）
  - `name`：音色名称（可选）
  - `preferred_name`：Qwen 音色偏好名（可选）
  - `target_model`：目标语音模型（可选，默认 `qwen3-tts-vc-realtime-2026-01-15`）
  - `set_active`：是否设为当前生效音色（可选，默认 `true`）
- 限制：
  - 音频最大 20MB
  - 支持扩展名：`.mp3 .wav .m4a .aac .flac .ogg`

### 4.2 `GET /doctor/digital-human/voice/`

功能：获取当前医生的音色档案列表（用于演练和患者问诊选用）。

- Auth：医生 token

### 4.3 `POST /doctor/digital-human/videos/`

功能：上传医生正面图片后，默认一次提交 5 个“图生无声视频”任务（讲解 + 待机等场景模板）。

- Auth：医生 token
- Content-Type：`multipart/form-data`
- Form-Data：
  - `image`：首帧图片（必填）
  - `prompt`：补充正向要求（可选）
  - `negative_prompt`：补充负向要求（可选）
  - `duration`：视频时长，2~15 秒（可选，默认 5）
  - `resolution`：`720P` 或 `1080P`（可选，默认 `720P`）
  - `model`：图生视频模型（可选，默认 `wan2.6-i2v-flash`）
  - `generate_count`：本次生成任务数量（可选，默认 `5`，范围 `1~5`）
  - `prompt_extend`：是否启用提示词扩展（可选，默认 `true`）
  - `watermark`：是否加水印（可选，默认 `true`）
  - `seed`：随机种子（可选）
- 当前实现：
  - 固定生成无声视频（`audio=false`）
  - 使用场景模板批量提交异步任务，默认模板：
    - `talking_explain`（健康讲解）
    - `idle_standby`（待机轻动）
    - `nod_acknowledge`（点头确认）
    - `gentle_gesture`（温和手势）
    - `listening_pause`（倾听停顿）
  - 返回批量结果：`count`、`failed_count`、`items`、`failed_items`

### 4.4 `GET /doctor/digital-human/videos/`

功能：获取当前医生的图生视频任务列表（含场景标识、任务状态、外部视频URL、落 OSS 结果）。

- Auth：医生 token

### 4.5 `POST /doctor/digital-human/videos/{video_id}/refresh/`

功能：主动刷新图生视频任务状态；成功后自动把 DashScope 视频下载并存入 OSS。

- Auth：医生 token
