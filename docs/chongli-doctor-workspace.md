# 崇礼医生工作台：开发交付说明

本改动在既有医生端中增加日常工作台、服务记录复核入口、分步骤指南及免账号演示页。统计接口读取当前医生的数据，沿用现有模型，无数据库迁移。

## 已实现范围

| 功能 | 入口与行为 |
|---|---|
| 医生日常工作台 | `/workspace`：当前医生的患者与会话统计、成功 AI 回复、待复核及已复核数量、最近 7 天趋势、知识处理状态和素材配置情况 |
| 待处理会话 | 工作台按最早待复核时间列出最多 5 个会话。上游原复核页从「打开复核列表」进入。合入支持会话定位的复核页后，医生可用「处理下一条」或点选会话直达指定记录 |
| 使用指南 | `/guide`：资料、专业表达、知识、形象声音、试聊、记录复核六个可操作章节，另设明确标注规划中的发布章节 |
| 独立演示 | `/preview`、`/preview/guide`：使用合成数据，不绕过认证、不请求真实医生 API、不写入真实服务记录 |

工作台的累计统计与近 7 天趋势分别展示。统计排除软删除、关联不一致等不属于当前医生有效范围的数据；待复核只计成功生成且仍为待复核状态的 AI 回复。接口失败显示失败与重试状态，不把连接失败显示为“全部为零”。

## 接口与日期口径

`GET /api/doctor/workspace/` 只允许审核通过且有效的医生账号访问，返回统一响应包中的以下字段：

- `profile`：医生显示名称、机构、专业。
- `counts`：累计患者、会话、AI 回复及复核数量。
- `trend`、`period`：连续 7 个机构自然日及其统计口径，无数据日期补零。
- `pending_sessions`：待复核会话标识、患者显示名称、待复核数与最近消息时间，不包含对话正文。
- `knowledge`、`readiness`：知识处理数量及资料、形象、声音、视频、专业表达、试聊的配置情况。
- `generated_at`：本次汇总时间；响应使用 `Cache-Control: private, no-store`。

日期处理兼容 `USE_TZ=True` 和 `USE_TZ=False`。按项目配置的机构时区划分自然日；已有无时区时间按配置时区解释，不因请求临时激活另一时区改变统计口径。

会话消息分页和复核页的定向跳转由另一项变更提供。工作台根据随应用构建的复核页是否支持深链选择入口，无需更改后端配置。仅合入本改动时，待办行用于查阅；点击「打开复核列表」后由医生在列表中选择患者。

## 本地启动

使用 Node.js 22 与项目锁定依赖。在仓库根目录执行：

```bash
cd doctor_web_opus
npm ci
npm run dev -- --host 127.0.0.1
```

默认开发地址为 `http://127.0.0.1:5174`。直接打开 `/preview` 可查看演示工作台，无需医生账号。登录版需要已配置的本地开发后端，Vite 默认将 `/api` 代理到 `http://127.0.0.1:8000`；不要连接生产接口进行演示或测试。

生产构建检查使用 `npm run build`。生成构建文件不代表已经部署。

## 教程视频与学习进度

章节配置位于 `doctor_web_opus/src/lib/guide-content.ts`。当前 `video` 均为 `null`，页面提供实际文字步骤，并显示“教学视频待上传”，不会伪造播放或视频时长。

真实素材完成内容及使用权限核验后，可为对应章节配置：

```ts
video: {
  verified: true,
  src: '/tutorials/profile.mp4',
  captionsSrc: '/tutorials/profile.zh.vtt',
  transcript: '与真实视频一致的文字讲解',
}
```

这些是路径格式示例，素材文件需另行提供。站内文件放入前端 `public/tutorials/`；也可使用已核验的 HTTPS 地址。跨域视频与字幕需提供正确的 CORS 响应。页面提供原生播放控制、中文字幕和文字稿，不自动播放声音；无法播放时可继续阅读步骤。本轮未增加视频管理后台或上传接口。

阅读进度仅在当前浏览器保存章节 ID，按账号身份摘要区分，演示进度使用独立键。支持继续阅读、取消勾选和损坏存储恢复；阅读完成不代表数字医生配置完成，也不代表获得发布授权。

## 验证方式

后端使用 Python 3.12 及项目依赖。以下测试配置独立于生产配置，不读取 `.env`，使用内存 SQLite 并阻断网络连接；仅用于测试，不用于启动服务。

```bash
cd metaverse_doctor
python3.12 manage.py test \
  mdapi.test_workspace \
  --settings=metaverse_doctor.workspace_test_settings
```

教程纯函数检查（在 `doctor_web_opus` 目录）：

```bash
node --experimental-strip-types --test tests/guide-progress.test.mjs
```

浏览器检查使用 Playwright 和 Chromium。可先在独立工具目录安装测试依赖，避免修改业务依赖：

```bash
npm install --prefix /tmp/chongli-browser-tools --no-save playwright@1.56.1
```

启动上述前端服务后，在 `doctor_web_opus` 运行：

```bash
NODE_PATH=/tmp/chongli-browser-tools/node_modules \
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
WORKSPACE_TEST_ORIGIN=http://127.0.0.1:5174 \
node tests/workspace.browser.mjs
```

`NODE_PATH` 指向已安装 Playwright 的工具目录；`CHROME_PATH` 按本机浏览器位置调整，使用 Playwright 自带 Chromium 时可省略。浏览器检查使用独立上下文和本地接口替身，所有 `/api` 请求均拦截，不登录真实医生账号、不访问真实患者资料。

独立审核可设置 `WORKSPACE_TEST_REVIEW=list` 运行浏览器用例。另一个复核变更合入后设置 `WORKSPACE_TEST_REVIEW=linked`，同一脚本会继续验证指定会话、复核回写、历史消息、患者切换与空状态。

本分支有 16 项工作台后端测试、5 项指南单元测试。浏览器检查覆盖匿名及已登录条件下的演示隔离、账号间指南进度、待复核入口、真实接口失败和重试、零待办，以及 320/390/1280/1440 像素布局。

## 当前边界与素材来源

现有服务记录“审核”是 AI 回复生成后的事后复核，**不是发送前拦截**；驳回复核记录也不等于撤回已发送内容。工作台配置状态不表示已经通过发布审批。

本轮没有完成数字医生草稿/服务版本隔离、AI 辅助审查、院方审批、医生版本授权、多渠道统一发布或暂停；随访与科研也尚无本轮新增的业务后端。教程中的相关规划不可当作已上线功能。

崇礼院区院标沿用了项目已有原型素材，来源标注为[崇礼院区网站](https://www.clqrmyy.com/)。仓库未附权利方授权书，需由维护方确认院标的仓库再分发及上线使用范围，或替换为已授权素材。正式医生端的章节视频目前均待提供。
