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

功能：获取当前医生的图生视频任务列表（含场景、状态、原始 OSS 地址和可直接播放的签名地址）。

- Auth：医生 token
- 返回字段重点：
  - `video_oss_url`：OSS 原始地址（用于排查）
  - `video_play_url`：签名播放地址（私有桶可直接播放，默认 30 分钟过期）

### 4.5 `POST /doctor/digital-human/videos/{video_id}/refresh/`

功能：主动刷新图生视频任务状态；成功后自动把 DashScope 视频下载并存入 OSS，并返回最新签名播放地址。

- Auth：医生 token

## 5. 医生叙事底座（菜单3+4合并）

### 5.1 `GET /doctor/narrative-kernel/`

功能：获取当前医生的 Narrative Kernel 底座；如果还没有，会自动按医生资料初始化一份默认 DSL。

- Auth：医生 token
- 返回字段重点：
  - `revision`：当前版本号（每次更新会递增）
  - `payload`：结构化底座数据（后端持久化主数据）
  - `compiled_prompt`：编译后的 DSL 文本（可直接给模型作为系统底座）

### 5.2 `PUT /doctor/narrative-kernel/`

功能：整份覆盖医生底座（适合一次性导入新的结构化人格+策略文件）。

- Auth：医生 token
- Content-Type：`application/json`
- Body：

```json
{
  "payload": {
    "KERNEL": {
      "IDENTITY": {"NAME": "杨医生"},
      "CLINICAL_STYLE": {"TREATMENT_PREFERENCE": "balanced"}
    },
    "DYNAMIC": {
      "STATE": {"energy": "medium"}
    }
  },
  "note": "根据访谈稿重建底座"
}
```

### 5.3 `PATCH /doctor/narrative-kernel/`

功能：局部更新医生底座（按 `changes` 深度 merge 到当前版本）。

- Auth：医生 token
- Content-Type：`application/json`
- Body：

```json
{
  "changes": {
    "KERNEL": {
      "CLINICAL_STYLE": {
        "EXPLANATION_DEPTH": "detailed",
        "EMPATHY_INTENSITY": "high"
      }
    }
  },
  "note": "补充门诊沟通风格"
}
```

### 5.4 `POST /doctor/narrative-kernel/annotations/`

功能：医生在演练后提交批注，系统把批注写回底座并生成新版本（后续菜单5可直接调用）。

- Auth：医生 token
- Content-Type：`application/json`
- Body：

```json
{
  "source": "rehearsal",
  "question": "我这个病要不要手术？",
  "answer": "先做影像评估，再决定手术时机。",
  "comment": "这类场景先稳住情绪，再解释风险，整体偏保守一点。",
  "negative_rules": [
    "不要在证据不足时给出确定性结论",
    "避免恐吓式表达"
  ],
  "delta": {
    "KERNEL": {
      "CLINICAL_STYLE": {
        "FOLLOWUP_STYLE": "stepwise_risk_clarification"
      }
    }
  }
}
```

- 行为说明：
  - `comment` 为必填。
  - `negative_rules` 为可选，适合记录“哪些回答不好/不能说”，会进入底座红线规则。
  - `delta` 为可选，若提供会和 Qwen-Max 抽取结果一起 merge 到底座。
  - 系统会优先调用 Qwen-Max（Responses API）基于“问题+回答+批注+当前底座”抽取结构化增量，再与手工 `delta` 合并（手工优先级更高）。
  - Qwen-Max 抽取失败时，本接口会直接返回错误，不会回退到规则引擎。
  - 当本次批注最终产出了 `negative_rules` 且携带 `answer` 时，会把这条问答作为“反例样本”写入 `KERNEL.SAFETY_RULES.BAD_RESPONSE_EXAMPLES`。

### 5.5 `GET /doctor/narrative-kernel/annotations/?limit=20`

功能：获取最近批注记录（用于“底座更新历史”面板）。

- Auth：医生 token
- Query：
  - `limit`：返回条数，默认 20，最大 100

### 5.6 `GET /doctor/narrative-kernel/redlines/`

功能：获取当前医生的红线规则与“不好回答”反例列表。

- Auth：医生 token
- 返回字段：
  - `revision`
  - `negative_rules[]`
  - `bad_response_examples[]`

### 5.7 `POST /doctor/narrative-kernel/redlines/`

功能：手工新增红线规则（菜单6）。

- Auth：医生 token
- Content-Type：`application/json`
- Body：

```json
{
  "rules": [
    "不要省略风险提示",
    "不能用绝对化表述给出保证"
  ],
  "comment": "门诊安全边界补充"
}
```

### 5.8 `DELETE /doctor/narrative-kernel/redlines/`

功能：手工删除红线规则。

- Auth：医生 token
- Content-Type：`application/json`
- Body：

```json
{
  "rules": [
    "不要省略风险提示"
  ]
}
```

## 6. AI 问诊演练场（菜单5）

### 6.1 `POST /doctor/rehearsal/sessions/`

功能：创建一个医生问诊演练会话。

- Auth：医生 token
- Content-Type：`application/json`
- Body（可选）：

```json
{
  "title": "糖尿病随访演练"
}
```

### 6.2 `GET /doctor/rehearsal/sessions/`

功能：获取当前医生全部演练会话列表。

- Auth：医生 token

### 6.3 `GET /doctor/rehearsal/sessions/{session_id}/messages/?limit=100`

功能：获取某个演练会话的消息列表（支持多轮上下文回显）。

- Auth：医生 token
- Query：
  - `limit`：默认 100，最大 300

### 6.4 `POST /doctor/rehearsal/sessions/{session_id}/ask/stream/`

功能：流式问答核心接口（菜单5主入口）。

- Auth：医生 token
- Content-Type：`application/json`
- Body：

```json
{
  "question": "血压偏高并伴有头痛，应该怎么处理？",
  "forced_search": true,
  "enable_audio": true
}
```

- 后端流程（已实现）：
  - 基于问题检索医生知识库候选文件
  - 用 Qwen-Max 判断是否需要私有知识；需要时最多选择 2 个 `file_id`
  - 用 Qwen-Long 生成“知识摘要+出处”（优先多文件；若模型侧报 `Invalid file`，自动回退为逐文件归纳后合并）
  - 若未选中文件（`selected_file_ids=[]`），跳过 qwen-long，直接走 qwen-max 最终回答
  - 将医生人格底座注入系统提示词
  - 用 Qwen-Max + 联网搜索进行最终流式回答（带来源）
  - 返回 token 消耗，并落库会话消息、出处、文件选择记录

- 返回类型：`text/event-stream`
- 事件：
  - `start`：返回 `answer_message_id`、`selected_file_ids`，以及 `audio` 初始化信息
  - `delta`：流式增量文本
  - `audio_delta`：语音增量片段（`pcm16/24000Hz/mono`，base64）
  - `audio_error`：语音流错误（不影响文本继续输出）
  - `done`：最终 `usage`（`input_tokens/output_tokens/total_tokens`）与来源信息
  - `error`：错误信息

- 语音说明（`enable_audio=true`）：
  - 音色优先使用“医生最近上传且可用（status=ready）”的 `voice_id`，若无则使用系统默认音色。
  - 语音按文本增量实时送入合成（低延迟优先），不再等待句号分段。
  - 若实时语音失败，文本流式问答仍会继续并正常落库；失败信息通过 `audio_error` 事件返回。

### 6.5 `GET /doctor/rehearsal/playback-assets/`

功能：获取问诊朗读播放资源（音色 + 全部可播放数字人视频链接，前端自己随机）。

- Auth：医生 token
- 返回字段：
  - `voice_id`：优先医生最近上传且可用的复刻音色，若无则返回默认音色
  - `tts_model`
  - `video_urls`：全部可用签名视频地址数组（私有桶可直接播放，可能为空）
  - `videos`：视频详情数组（含 `video_id`、`scene_key`、`scene_name`、`video_url`、`video_oss_url`）

### 6.6 `PATCH /doctor/rehearsal/messages/{message_id}/markdown/`

功能：md-editor-v3 保存医生对回答的 Markdown 编辑内容。

- Auth：医生 token
- Content-Type：`application/json`
- Body：

```json
{
  "markdown": "## 修改后的回答\n先做血压监测，再决定用药..."
}
```

### 6.7 `POST /doctor/rehearsal/messages/{message_id}/feedback/`

功能：提交医生批复，并可选择写入叙事底座（学习医生习惯）。

- Auth：医生 token
- Content-Type：`application/json`
- Body：

```json
{
  "comment": "这类患者先安抚，再强调风险，回答不要太绝对。",
  "edited_markdown": "## 更合适的话术 ...",
  "apply_to_kernel": true
}
```

- 行为：
  - 每条 assistant 消息都会有一条关联批复记录（`DoctorRehearsalFeedback`）
  - 当 `apply_to_kernel=true` 时，调用 Qwen-Max 抽取结构化增量，写入医生叙事底座并产生关联批注记录
  - Qwen-Max 失败时直接报错，不回退规则兜底

## 7. 患者端问诊 API

### 7.1 `POST /auth/patient/register/`

功能：患者注册账号（注册后默认可登录）。

- Auth：无需
- Content-Type：`application/json`
- Body：

```json
{
  "username": "patient_li",
  "password": "12345678",
  "email": "patient_li@example.com",
  "phone": "13800002222",
  "nickname": "李女士"
}
```

### 7.2 `GET /patient/doctors/`

功能：患者端医生目录，仅返回“审核通过且可用”的医生。

- Auth：患者 token（必须登录）
- 返回：医生基础信息列表（`id/username/nickname/avatar/institution/profession`）

### 7.3 `GET /patient/doctors/{doctor_id}/assets/`

功能：获取指定医生可播放素材（语音 + 数字人视频）。

- Auth：患者 token
- 返回字段重点：
  - `voice_id`：优先该医生最近上传且可用音色（`status=ready`），否则默认音色
  - `tts_model`
  - `video_urls[]`：可直接播放的视频签名地址数组
  - `videos[]`：含 `video_id/scene_key/scene_name/video_url/video_oss_url`

### 7.4 `POST /patient/sessions/`

功能：创建患者问诊会话（会话与单个医生绑定）。

- Auth：患者 token
- Content-Type：`application/json`
- Body：

```json
{
  "doctor_id": 12,
  "title": "术后恢复咨询"
}
```

- 说明：
  - `doctor_id` 必填，且必须是审核通过且可用医生。
  - `title` 可选，不传则自动生成默认标题。

### 7.5 `GET /patient/sessions/`

功能：获取当前患者自己的会话列表。

- Auth：患者 token

### 7.6 `GET /patient/sessions/{session_id}/messages/?limit=100`

功能：获取患者会话消息列表。

- Auth：患者 token
- Query：
  - `limit`：默认 `100`，最大 `300`

### 7.7 `POST /patient/sessions/{session_id}/ask/stream/`

功能：患者端流式问答主接口（SSE）。

- Auth：患者 token
- Content-Type：`application/json`
- Body：

```json
{
  "question": "我最近睡眠不好，白天也很疲惫，应该先做什么检查？",
  "forced_search": true,
  "enable_audio": true
}
```

- 关键行为：
  - `enable_audio` 默认 `true`（不传即开启语音流）。
  - 会复用所选医生的知识库、叙事底座、形象和音色能力。
  - 仅落库患者会话消息，不会写回医生叙事底座（默认不学习医生侧内核）。
  - 若语音通道异常，文本流式继续，`audio_error` 事件返回错误。

- 返回类型：`text/event-stream`
- 事件：
  - `start`
  - `delta`
  - `audio_delta`
  - `audio_error`
  - `done`
  - `error`
