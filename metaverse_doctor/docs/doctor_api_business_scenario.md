# 北医三院崇礼院区元宇宙医生智能体

## 医生端接口业务场景说明

### 医生知识库管理
医生登录系统后，先通过知识上传接口（`POST /api/doctor/knowledge/`）把门诊资料、科普文档、论文或指南上传到平台，系统会把文件存入 OSS 并同步到 Qwen 获取 `file_id`，随后在后台异步抽取出该文件的标签和描述；医生在日常使用中通过知识列表接口（`GET /api/doctor/knowledge/`）查看每个文件的抽取状态和完整信息，通过知识索引接口（`GET /api/doctor/knowledge/indexes/`）快速拿到“文件名 + file_id + 标签 + 描述”的轻量数据用于前端检索和展示，通过标签聚合接口（`GET /api/doctor/knowledge/tags/`）查看自己的知识结构分布，并可在需要时对单个文件触发重新抽取（`POST /api/doctor/knowledge/{knowledge_id}/extract/`）或删除无效资料（`DELETE /api/doctor/knowledge/{knowledge_id}/`），形成一个持续沉淀、持续整理的个人医生知识库闭环。
