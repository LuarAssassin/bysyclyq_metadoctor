# Prompts

这个目录用于集中管理项目里的静态提示词（system / user prompt）。

## 目录约定

- `qwen/`：Qwen 相关提示词。

## 变量占位符

在提示词模板里可以使用下面的变量：

- `{{file_name}}`：上传文件名

当前 `mdapi/services/qwen.py` 会从以下文件读取提示词：

- `qwen/knowledge_extract_system.txt`
- `qwen/knowledge_extract_user.txt`

如果文件不存在或为空，会自动回退到代码内默认提示词。
