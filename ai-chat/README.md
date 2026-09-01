# Keen Agent 聊天前端

`ai-chat` 是 Keen Agent 的浏览器聊天界面，基于 Next.js App Router、React、Ant Design X 和 TypeScript。它负责会话交互、模型选择、图片附件与流式消息展示，不直接持有 API Key，也不直接请求模型厂商。

## 主要功能

- 创建、切换、重命名和删除服务端会话。
- 为每个会话独立选择模型，刷新页面后恢复模型与完整消息历史。
- 展示模型正式回答、思考过程和 Markdown 代码块。
- 管理 Anthropic 兼容与 OpenAI 兼容的模型配置。
- 通过选择文件、拖拽和粘贴上传图片。
- 在请求期间取消生成，并在结束后刷新会话标题与排序。

## 调用边界

```text
浏览器中的 ai-chat
  → Next.js 同源代理 /api/ai-server/*
  → ai-server（Nest）
  → ai-agent 的模型工厂或 DeepAgent
  → 上游模型服务
```

浏览器只提交会话 ID、当前模型、用户文字和图片。模型鉴权、图片 OCR、Agent 执行与会话持久化全部由 `ai-server` 完成。服务端历史是事实来源，前端消息状态只用于当前页面展示。

## 目录说明

| 路径 | 职责 |
| --- | --- |
| `app/independent.tsx` | 聊天页面状态、会话切换、模型切换和消息提交 |
| `app/_components/ChatSender.tsx` | 输入框、图片附件、模型下拉框和取消请求 |
| `app/_components/ChatList.tsx` | 用户与助手消息列表 |
| `app/_components/ModelManagerModal.tsx` | 模型注册表的增删改查界面 |
| `app/_utils/provider.tsx` | Ant Design X Provider、SSE 请求和 Markdown 渲染 |
| `app/_utils/conversation-api.ts` | 会话 API 客户端 |
| `app/_utils/model-api.ts` | 模型管理 API 客户端 |
| `app/_utils/image.ts` | 图片类型、数量、大小校验与 Data URL 转换 |
| `next.config.ts` | Nest 同源代理和请求体大小配置 |

## 图片问答流程

支持 JPEG、PNG、GIF 和 WebP，每次最多 3 张，单张不超过 4 MB，总大小不超过 6 MB。前端校验后会把图片转换成 Data URL；Nest 会再次校验并随会话保存。

当会话选择 DeepSeek 等主模型时：

1. `ai-server` 先调用内部视觉模型，默认是 `qwen3.5-ocr`。
2. Qwen 只负责完整提取图片文字，识别结果会写入当前用户消息。
3. OCR 文本作为低权限上下文交给主模型的 DeepAgent。
4. 后续不再上传图片的追问可以继续复用已保存的 OCR。

当会话直接选择 `qwen3.5-ocr` 时，图片会直接发送给底层 OCR 模型，不创建 DeepAgent，也不会调用 DeepSeek。该模式适合提取文字；需要解释代码、分析报错或连续推理时，应选择 DeepSeek 等主模型。

## 本地运行

在仓库根目录执行：

```bash
pnpm install
pnpm dev
```

默认访问地址为 [http://localhost:3000](http://localhost:3000)，Nest 服务默认监听 `http://127.0.0.1:3001/api`。

模型密钥配置在 `ai-agent/.env`，模型注册表保存在仓库根目录的 `.keen-agent/models.json`。不要在 `ai-chat` 中添加模型 API Key。

## 代理配置

如需连接其他 Nest 地址，在 `ai-chat/.env.local` 中设置：

```bash
AI_SERVER_URL=http://127.0.0.1:3001
```

`/api/ai-server/:path*` 会被 Next.js 重写到该地址的 `/api/:path*`。图片使用 Base64 JSON 传输，因此代理请求体限制设置为 12 MB。

## 模型配置注意事项

- `provider` 表示上游 API 兼容协议，不是模型厂商名称。
- DeepSeek 等当前主模型使用 `anthropic`。
- `qwen3.5-ocr` 必须使用 `openai`，Base URL 指向阿里云百炼工作空间的 `/compatible-mode/v1`。
- `/apps/anthropic` 不能用于 Qwen OCR 图片请求，否则可能产生与图片无关的识别结果。

## 质量检查

```bash
pnpm --filter @keen-agent/ai-chat typecheck
pnpm --filter @keen-agent/ai-chat lint
pnpm --filter @keen-agent/ai-chat build
```

## 生产运行

先确保 Nest 服务和环境变量已经部署，再构建并启动前端：

```bash
pnpm --filter @keen-agent/ai-chat build
pnpm --filter @keen-agent/ai-chat start
```

`AI_SERVER_URL` 应指向生产环境可访问的 Nest 服务地址。
