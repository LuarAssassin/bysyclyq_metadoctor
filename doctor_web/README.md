# Doctor Web

北医三院医生元宇宙智能体医生端前端（Vue3 + Vite + TypeScript）。

## 开发启动

```bash
npm install
npm run dev
```

默认开发地址：`http://127.0.0.1:5173`

开发代理：`/api -> http://127.0.0.1:8000`

## 生产构建

```bash
npm run build
npm run preview
```

## 环境变量

复制 `.env.example` 到 `.env`：

```env
VITE_API_BASE_URL=/api
```

如果后端不走同域代理，可改为完整地址，例如：

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```
