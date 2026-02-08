# 北医三院崇礼院区 · 医生智能体前端

> 运动康复元宇宙诊疗平台 - 医生端 Web 应用

## 技术栈

- **框架**: Vue 3.4+ (Composition API + `<script setup>`)
- **构建工具**: Vite 5+
- **语言**: TypeScript 5+
- **UI 组件库**: Element Plus
- **状态管理**: Pinia
- **路由**: Vue Router 4
- **样式**: Tailwind CSS 3 + SCSS
- **Markdown 编辑器**: md-editor-v3
- **图标**: @element-plus/icons-vue

## 项目特色

### 🎨 设计亮点

- **冰雪主题**: 以北医三院崇礼院区冰雪运动康复特色为灵感，采用冰川蓝、雪白色系
- **现代高级感**: 玻璃态效果、微妙动画、圆角设计、渐变色彩
- **暗黑模式**: 支持亮色/暗色/跟随系统三种主题切换

### ✨ 核心功能

| 模块 | 功能 |
|------|------|
| **认证** | 医生注册、登录、审核中拦截页面 |
| **知识库** | 拖拽上传、异步抽取状态轮询、标签云、索引检索 |
| **数字人素材** | 音色复刻、图生视频批量生成、播放素材管理 |
| **叙事底座** | 人格底座 DSL 编辑、红线规则管理、批注历史 |
| **AI 演练场** | Claude 风格对话、SSE 流式输出、Markdown 编辑、反馈闭环 |

## 快速开始

### 安装依赖

```bash
cd doctor_web_by_kimi
npm install
```

### 开发模式

```bash
npm run dev
```

### 生产构建

```bash
npm run build
```

## 环境变量

创建 `.env.local` 文件：

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api
VITE_APP_TITLE=北医三院崇礼院区 · 医生智能体
VITE_APP_SUBTITLE=运动康复元宇宙诊疗平台
```

## 项目结构

```
doctor_web_by_kimi/
├── src/
│   ├── api/              # API 接口封装
│   ├── assets/           # 静态资源
│   ├── components/       # 公共组件
│   ├── composables/      # 组合式函数
│   ├── layouts/          # 布局组件
│   ├── router/           # 路由配置
│   ├── stores/           # Pinia 状态管理
│   ├── types/            # TypeScript 类型
│   ├── utils/            # 工具函数
│   └── views/            # 页面视图
│       ├── auth/         # 认证相关
│       ├── dashboard/    # 首页
│       ├── knowledge/    # 知识库
│       ├── digitalHuman/ # 数字人素材
│       ├── narrative/    # 叙事底座
│       └── rehearsal/    # AI 演练场
├── dist/                 # 构建输出
└── ...
```

## 关键功能说明

### 1. 鉴权策略

- 使用 JWT Bearer Token
- 登录时保存 access_token 和 refresh_token
- 自动刷新 token 机制
- 医生审核中状态拦截

### 2. SSE 流式问答

```typescript
const response = await askStream(sessionId, { question, forced_search })
const reader = response.body?.getReader()
// 解析 stream 数据，实时更新 UI
```

### 3. 文件上传拖拽

知识库支持拖拽上传，自动轮询抽取状态：
- 状态: pending → queued → running → success/failed
- 轮询间隔: 3 秒
- 展示抽取错误信息

### 4. md-editor-v3 集成

演练场支持 Markdown 编辑反馈：
- 完整工具栏
- 实时预览
- 代码高亮

## 设计系统

### 色彩

```scss
// 冰川蓝系列
--ice-primary: #0ea5e9;
--ice-primary-light: #38bdf8;
--ice-primary-dark: #0284c7;

// 极光点缀
--aurora-cyan: #22d3ee;
--aurora-teal: #14b8a6;
--aurora-purple: #a78bfa;
```

### 动画

- 雪花飘落: `animation: snow 10s linear infinite`
- 悬浮效果: `animation: float 6s ease-in-out infinite`
- 呼吸灯: `animation: pulse 1.5s infinite`

## 后端接口

详见 `/metaverse_doctor/api.md`

Base URL: `http://127.0.0.1:8000/api`

## 浏览器支持

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## License

Internal Use Only
