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
  - 单文件最大 100MB
  - 单次最多 10 个

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

