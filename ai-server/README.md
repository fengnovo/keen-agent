# Keen Agent AI Server

Nest API 直接读写根目录 `.keen-agent/models.json` 和 `.keen-agent/plugins.json`，与命令行 Agent 共用模型及插件配置。Web 聊天会话保存在 `.keen-agent/chat-conversations.json`。

默认地址为 `http://127.0.0.1:3001/api`，可使用以下环境变量覆盖：

- `AI_SERVER_PORT`：监听端口，默认 `3001`
- `AI_SERVER_HOST`：监听地址，默认 `127.0.0.1`
- `AI_CHAT_ORIGIN`：允许跨域访问的前端来源，多个来源以逗号分隔
- `MODEL_CONFIG_PATH`：模型配置文件路径，主要用于测试或自定义部署
- `PLUGIN_CONFIG_PATH`：插件配置文件路径，主要用于测试或自定义部署
- `CHAT_CONVERSATIONS_PATH`：Web 会话文件路径，主要用于测试或自定义部署
- `VISION_MODEL_ID`：内部图片解析模型的模型配置 ID，默认 `qwen3.5-ocr`

## 图片问答

上传图片且当前会话选择的不是视觉模型时，服务端会先调用 `VISION_MODEL_ID`
对应的模型完整提取图片文字，再把 OCR 结果作为上下文交给当前
会话模型完成推理与回答。解析结果会随用户消息持久化，因此后续不带图片的追问也能
继续使用这些信息。

多图不会放在一次 OCR 请求中：服务端会为每张图片发起独立调用，并按上传顺序添加
“第 N 张图片”边界后合并缓存。这样可以避免 OpenAI 兼容端点只返回第一张图片结果，
同时防止某一张长文档占满缓存导致后续图片内容丢失。如果当前会话直接选择视觉模型，
也复用相同的逐图识别流程，只是不再调用主 Agent。

模型注册表中必须同时存在主模型和视觉模型配置，并分别提供其 `apiKeyEnv` 与
Base URL。视觉模型的默认配置 ID 应为 `qwen3.5-ocr`；使用其他 ID 时设置
`VISION_MODEL_ID` 即可。

`qwen3.5-ocr` 必须配置为 `provider: "openai"`，Base URL 使用阿里云百炼工作空间的
`https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。不要使用
`/apps/anthropic`：该端点会错误处理 OCR 图片请求。DeepSeek 等主模型可以继续使用
`provider: "anthropic"`。模型管理页面支持选择这两种兼容协议。

## 会话级 Agent 能力

每条 Web 会话会额外保存 `thinkingEnabled` 和 `toolsEnabled`。旧会话读取时默认补为
`true`，不需要手动迁移会话文件。`PATCH /api/conversations/:id` 可以修改这两个字段；
下一轮聊天准备阶段会把它们传给 `ai-agent` 的 `createAgentRuntime`。

`thinkingEnabled` 控制回答策略提示，`toolsEnabled` 是全部插件的会话级总开关。关闭时运行时使用不带工具的普通 Agent，避免 DeepAgent 隐式提供内置工具。直接选择
OCR 模型时服务端绕过 DeepAgent，所以开关只会保存，不影响该次 OCR 直连请求。

## 插件运行时

`PluginsService` 提供插件注册表 CRUD、启停和连接测试。聊天准备阶段会读取一份注册表快照：

1. 本地工具通过源码中的实现目录解析。
2. 已启用 MCP 通过官方 LangChain MCP Adapter 加载工具，并在流结束或取消时关闭连接。
3. Skill 默认从 `ai-agent/.skills/` 解析，校验 `SKILL.md` 元数据及目录名后，把完整目录映射到内存 StateBackend；不会跟随符号链接，也不会自动执行其中的脚本。
4. `deepagent-core` 开启时创建 DeepAgent，关闭时退回普通 LangChain Agent。

插件管理可以启动本地 MCP 进程并读取 Skill 文件，属于管理员能力。面向公网部署时应在反向代理或应用鉴权层保护 `/api/plugins`，不要开放给普通聊天用户。

MCP 的真实环境变量值只在 AI Server 进程内解析，API 返回和 JSON 文件中都只有变量名称。

## API

- `GET /api/models`
- `GET /api/models/:id`
- `POST /api/models`
- `PUT /api/models/:id`
- `DELETE /api/models/:id`
- `PATCH /api/models/:id/active`
- `GET /api/plugins`
- `GET /api/plugins/:id`
- `POST /api/plugins`
- `PUT /api/plugins/:id`
- `PATCH /api/plugins/:id/enabled`
- `POST /api/plugins/:id/test`
- `DELETE /api/plugins/:id`
- `GET /api/conversations`
- `GET /api/conversations/:id`
- `POST /api/conversations`
- `PATCH /api/conversations/:id`
- `DELETE /api/conversations/:id`
- `POST /api/chat/completions`（OpenAI 兼容 SSE）
- `GET /api/health`
