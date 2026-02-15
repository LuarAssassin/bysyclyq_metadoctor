# 患者端发送消息业务流（当前实现）

## 范围
本文描述患者端在聊天页点击发送后，从前端发起请求到后端流式返回、落库、可中断收尾的完整路径。

对应核心接口：

- `POST /api/patient/sessions/{session_id}/ask/stream/`
- `POST /api/patient/sessions/{session_id}/attachments/`
- `POST /api/patient/sessions/{session_id}/messages/{message_id}/interrupt/`
- `GET /api/patient/sessions/{session_id}/messages/`

## 1. 前端发起提问

患者在聊天页可先上传附件，再发送问题：

- 上传附件：`POST /api/patient/sessions/{session_id}/attachments/`（OSS 存储 + Qwen `file_id` 注册）
- 发送问题：`askPatientStream(sessionId, { question, attachment_ids, enable_audio: true })`

- 请求方式：`fetch + SSE`（不是 `EventSource`）
- 请求头：`Authorization: Bearer <access_token>`
- 特性：若返回 `401`，前端先刷新 token，再自动重试一次

前端页面与流解析位置：

- `patient_web_opus/src/pages/ChatPage.tsx`
- `patient_web_opus/src/lib/stream.ts`

## 2. 后端鉴权与会话校验

后端入口是 `PatientConsultAskStreamView.post`，权限要求：

- `IsAuthenticated`
- `IsPatient`（必须是非医生账号）

随后校验：

- `session_id` 必须属于当前患者
- `question` 不能为空

实现位置：

- `mdapi/views.py` 中 `PatientConsultAskStreamView`
- `mdapi/permissions.py` 中 `IsPatient`

## 3. 建立本轮消息（先落库）

后端先写入两条消息：

1. 患者消息（`role=user`）
   - `generation_status=succeeded`
   - `review_status=approved`
   - 如本轮有附件：`meta.attachments` 记录附件元信息，并在消息正文追加 `[附件]` 文本摘要
2. 助手消息占位（`role=assistant`）
   - `generation_status=generating`
   - `review_status=pending`
   - 初始内容为 `[生成中]`

并更新会话 `last_message_at`。  
若是首轮且标题仍是自动前缀，会把标题改成“问题截断标题”。

## 4. 知识准备（医生私有知识 + 会话历史）

后端分两条分支准备知识：

1. 有 `attachment_ids` 时（优先附件分支）
   - 从缓存解析本轮附件元数据
   - 图片附件：`qwen3-vl-plus` 基于图片 URL 生成图片理解摘要
   - 文档附件：`qwen-long` 基于 `fileid://...` 生成文档摘要
   - 合并为本轮 `grounding_answer`

2. 无附件时（医生知识库分支）
   - 从医生知识库筛 `extract_status=success` 且有 `qwen_file_id` 的条目
   - 基于问题关键词做初排
   - 调用 Qwen（selector）从候选中选最多 2 个 `file_id`
   - `qwen-long` 对选中文档生成 `grounding_answer`

然后统一拼装最终消息：

- 医生叙事底座（narrative kernel）
- 内部知识摘要（若命中）
- 最近历史对话
- 当前问题

## 5. 开始流式回答（SSE）

后端返回 `StreamingHttpResponse(text/event-stream)`，并持续推送：

- `start`：消息 ID、选中文件、grounding 来源、音频初始化信息
- `start.question_attachments`：本轮附件元数据（如有）
- `delta`：文本增量
- `audio_delta`：TTS PCM 音频分片（可选）
- `audio_error`：TTS 错误（不阻断文本主流程）
- `done`：最终 usage、search_sources、selected_file_ids、是否 interrupted
- `error`：主流程错误

前端行为：

- `onStart`：把本地临时消息替换为真实 message id，并插入 assistant 占位消息
- `onDelta`：持续追加 assistant 文本
- `onAudioDelta`：实时喂给 PCM 播放器
- `onDone`：更新 token 统计、来源列表
- 流结束后再 `GET /messages/` 拉最终一致数据

## 6. 正常完成时的后端落库

流结束后，后端会把 assistant 消息更新为最终状态：

- `generation_status=succeeded`
- `content/content_markdown`：完整答案
- `selected_file_ids/selected_file_meta`
- `grounding_answer/grounding_sources`
- `search_sources`（联网检索来源）
- `input_tokens/output_tokens/total_tokens`
- `meta.audio`（语音状态、统计）
- `meta.question_attachments`（本轮附件快照）

并更新会话 `last_message_at`。

## 7. 用户中断（停止按钮）

前端“停止”时会做两件事：

1. 中止当前 SSE 请求（`AbortController`）
2. 调用 `/interrupt/`，把当前已生成的 partial 内容传给后端保存

后端在 `/interrupt/` 中：

- 设置“取消标记”（cache/fallback 内存标记）
- 将该 assistant 消息标记为已中断并保存 partial 内容
- `meta.interrupted=true`、`meta.interrupted_at=...`

主流式循环也会周期检查取消标记，命中后走“中断收尾分支”，输出 `done(interrupted=true)` 并最终落库。

## 8. 异常与降级策略

- Rehearsal 配置异常：直接返回 `500`
- 检索/归纳失败：assistant 记 `failed`，SSE 返回 `error`
- TTS 初始化或流中异常：仅影响音频事件，不阻断文本生成
- SSE 连接断开（`GeneratorExit/BrokenPipeError`）：按中断分支收尾，尽量保留已生成内容

## 9. 关键数据状态约定

`PatientConsultMessage.generation_status`：

- `generating`：生成中
- `succeeded`：生成成功（含“被中断但已保存 partial”）
- `failed`：生成失败

`PatientConsultMessage.review_status`：

- `pending`：待医生审核（assistant 默认）
- `approved`：审核通过
- `approved_edited`：编辑后通过
- `rejected`：审核驳回

## 10. 一句话总结

当前患者问诊链路是“先落库占位 + 后流式增量 + 结束/中断再一致性落库”的模式；  
当用户上传附件时优先走“附件理解分支（qwen-vl + qwen-long）”，否则走医生私有知识分支，联网来源通过 `search_sources` 回传并展示。
