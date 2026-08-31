# Keen Agent AI Server

Nest API 直接读写 `ai-agent/_data/models.json`，与命令行 Agent 共用同一份模型配置。

默认地址为 `http://127.0.0.1:3001/api`，可使用以下环境变量覆盖：

- `AI_SERVER_PORT`：监听端口，默认 `3001`
- `AI_SERVER_HOST`：监听地址，默认 `127.0.0.1`
- `AI_CHAT_ORIGIN`：允许跨域访问的前端来源，多个来源以逗号分隔
- `MODEL_CONFIG_PATH`：模型配置文件路径，主要用于测试或自定义部署

## API

- `GET /api/models`
- `GET /api/models/:id`
- `POST /api/models`
- `PUT /api/models/:id`
- `DELETE /api/models/:id`
- `PATCH /api/models/:id/active`
- `GET /api/health`
