# 医生录音流程回归

先安装项目依赖并启动 Vite（例如 `npm run dev -- --host 127.0.0.1 --port 5187`）。测试环境需要 Playwright 和 Chromium，可通过 `CHROME_PATH` 指定本机浏览器，通过 `VOICE_TEST_ORIGIN` 指定开发服务地址。

运行 `node tests/voice-recording.browser.mjs`。如果 Playwright 安装在外部工具目录，可通过 `NODE_PATH` 指定该目录。

测试使用独立浏览器、合成麦克风和本地接口替身，不登录真实医生账号、不调用真实音色创建接口。覆盖权限请求重复点击、转码重入、失败资源释放、卸载清理、超限文件、单次上传与后台默认模型，以及 Chrome 原生 MediaRecorder 的 WebM→16-bit WAV 链路。

后端回归为 `mdapi.test_voice_workflow`，使用禁网容器与 `scripts/tts_repair_tests/offline_settings.py` 的内存 SQLite 配置运行。
