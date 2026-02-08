# 医生端前端交付补充说明（联调必读）

本文是 `/api.md` 和 `/docs/doctor_side_brainstorm.md` 的补充，重点写前端联调时容易踩坑、但必须提前约定的实现细节。

## 1. 交付范围与菜单对应

- 菜单1：知识库与索引中心
- 菜单2：数字人素材中心
- 菜单3：叙事底座中心（含红线规则）
- 菜单5：AI 问诊演练场

以上菜单接口都已具备可联调能力，建议先按菜单顺序接入，再做跨菜单联动。

## 2. 通用接口约定（前端必须统一处理）

- 鉴权：全部医生端接口都要带 `Authorization: Bearer <access_token>`。
- 响应结构：优先读 `code / message / data`，不要只看 HTTP 状态码。
- 时间字段：后端当前是 `USE_TZ=False`（`Asia/Shanghai`），前端按本地时区显示即可。
- 软删除：删除接口通常是“业务删除”，列表里默认已过滤，不要期待物理删除。

## 3. 菜单1（知识库）接入要点

- `POST /doctor/knowledge/` 上传后是异步抽取，不代表马上有标签和描述。
- 建议轮询 `GET /doctor/knowledge/`：
  - 轮询间隔：`2~3s`
  - 停止条件：`extract_status in [success, failed]`
- 展示字段建议：
  - `extract_status`（抽取状态）
  - `knowledge_description`（抽取描述）
  - `tags`（标签）
  - `extract_error`（失败原因）
- 检索页建议优先用 `GET /doctor/knowledge/indexes/`（轻量、前端渲染友好）。

## 4. 菜单2（数字人素材）接入要点

- 音色：
  - `POST /doctor/digital-human/voice/` 创建后即可在演练场播放资产里使用。
  - 若没有医生音色，后端会回默认音色。
- 视频：
  - `POST /doctor/digital-human/videos/` 是批量异步任务，默认最多 5 条。
  - 列表接口 `GET /doctor/digital-human/videos/` 每条都有：
    - `video_oss_url`（原始地址，排查用）
    - `video_play_url`（签名播放地址，播放器优先用这个）
  - `POST /doctor/digital-human/videos/{video_id}/refresh/` 可主动刷新状态与播放地址。

## 5. 私有桶签名 URL 约定（非常关键）

- 当前 OSS 是私有桶，前端播放必须使用签名地址（`video_play_url` 或 `video_url`）。
- 签名地址有过期时间（当前默认 30 分钟），前端不要长期缓存。
- 建议策略：
  - 页面进入时拉一次播放资产接口
  - 播放失败或超时后，重新请求播放资产接口拿新 URL

## 6. 菜单3（叙事底座）接入要点

- `GET /doctor/narrative-kernel/`：首次调用会自动初始化默认底座。
- `PUT` 适合整份覆盖，`PATCH` 适合局部改动。
- 批注学习 `POST /doctor/narrative-kernel/annotations/`：
  - 设计上是“必须走大模型抽取”，失败会直接报错，不做规则兜底。
  - 前端应把失败信息直接展示给医生，不要静默吞错。

## 7. 菜单5（AI 问诊演练）接入要点

### 7.1 会话与消息

- 先建会话：`POST /doctor/rehearsal/sessions/`
- 再拉消息：`GET /doctor/rehearsal/sessions/{session_id}/messages/`
- 返回消息已按时间正序，前端可直接渲染。

### 7.2 流式问答（SSE）

- 接口：`POST /doctor/rehearsal/sessions/{session_id}/ask/stream/`
- 返回：`text/event-stream`
- 事件：
  - `start`：含 `answer_message_id`、`selected_file_ids` 等
  - `delta`：增量文本
  - `done`：最终 `usage`、`search_sources`
  - `error`：流内错误

- 兼容策略：
  - 后端对 qwen-long 做了“多文件失败自动逐文件回退合并”，前端无需处理该差异，按统一 SSE 事件消费即可。
  - 当 `start.selected_file_ids=[]` 时表示本轮无需私有知识，后端会跳过 qwen-long，直接走 qwen-max。

注意两点：

- 该接口是 `POST + 鉴权`，建议用 `fetch + ReadableStream` 解析 SSE，不建议用原生 `EventSource`。
- 在流启动前若后端前置步骤失败，可能返回普通 JSON 错误（不是 SSE），前端要同时兼容两种返回类型。

### 7.3 回放资源与批改

- 播放资源：`GET /doctor/rehearsal/playback-assets/`
  - 返回 `video_urls`（全部可播地址数组）和 `videos`（含场景信息），前端自己随机。
- Markdown 保存：`PATCH /doctor/rehearsal/messages/{message_id}/markdown/`
- 批复学习：`POST /doctor/rehearsal/messages/{message_id}/feedback/`
  - 建议先保存 Markdown，再提交反馈。

## 8. 推荐前端页面状态机

- 知识上传：`上传中 -> 已入队 -> 抽取中 -> 成功/失败`
- 视频任务：`submitted/running -> succeeded/failed`
- 问诊回答：`请求中 -> 流式输出中 -> done/error`
- 批复学习：`saved -> applied/failed`

前端页面上建议显式展示这些状态，减少“接口成功但业务没完成”的误解。

## 9. 联调建议顺序（高效）

1. 登录鉴权与 token 刷新
2. 菜单1 文件上传与抽取状态流转
3. 菜单2 音色与视频素材
4. 菜单3 底座读取与批注写回
5. 菜单5 演练流式、播放资产、Markdown、反馈闭环

## 10. 需要前端特别避免的实现

- 不要把签名 URL 当永久资源地址缓存。
- 不要把“创建成功”当“业务完成”，异步任务必须看状态字段。
- 不要假设所有错误都在 HTTP 层，SSE 流内也会有 `error` 事件。
- 不要跳过 `message_id` 关联，Markdown/反馈都依赖演练消息 ID。
