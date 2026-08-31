# Keen Agent AI Server

Nest API 直接读写根目录 `.keen-agent/models.json`，与命令行 Agent 共用同一份模型配置。Web 聊天会话保存在 `.keen-agent/chat-conversations.json`。

默认地址为 `http://127.0.0.1:3001/api`，可使用以下环境变量覆盖：

- `AI_SERVER_PORT`：监听端口，默认 `3001`
- `AI_SERVER_HOST`：监听地址，默认 `127.0.0.1`
- `AI_CHAT_ORIGIN`：允许跨域访问的前端来源，多个来源以逗号分隔
- `MODEL_CONFIG_PATH`：模型配置文件路径，主要用于测试或自定义部署
- `CHAT_CONVERSATIONS_PATH`：Web 会话文件路径，主要用于测试或自定义部署
- `VISION_MODEL_ID`：内部图片解析模型的模型配置 ID，默认 `qwen3.5-ocr`

## 图片问答

上传图片且当前会话选择的不是视觉模型时，服务端会先调用 `VISION_MODEL_ID`
对应的模型提取 OCR、对象、布局和其他视觉事实，再把解析结果作为上下文交给当前
会话模型完成推理与回答。解析结果会随用户消息持久化，因此后续不带图片的追问也能
继续使用这些信息。如果当前会话直接选择了视觉模型，则保留图片直传模式。

模型注册表中必须同时存在主模型和视觉模型配置，并分别提供其 `apiKeyEnv` 与
`baseUrlEnv` 所指向的环境变量。视觉模型的默认配置 ID 应为 `qwen3.5-ocr`；使用其他
ID 时设置 `VISION_MODEL_ID` 即可。

## API

- `GET /api/models`
- `GET /api/models/:id`
- `POST /api/models`
- `PUT /api/models/:id`
- `DELETE /api/models/:id`
- `PATCH /api/models/:id/active`
- `GET /api/conversations`
- `GET /api/conversations/:id`
- `POST /api/conversations`
- `PATCH /api/conversations/:id`
- `DELETE /api/conversations/:id`
- `POST /api/chat/completions`（OpenAI 兼容 SSE）
- `GET /api/health`
