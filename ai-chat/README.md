# Keen Agent 聊天前端

`ai-chat` 是 Keen Agent 的浏览器聊天界面，基于 Next.js App Router、React、Ant Design X 和 TypeScript。它负责会话交互、模型选择、图片附件与流式消息展示，不直接持有 API Key，也不直接请求模型厂商。

从用户发送生成任务到 Docker 执行、下载链接签发和 iframe 页面预览的完整流程见
[沙箱执行、产物下载与页面预览架构](../docs/sandbox-architecture.md)。

## 主要功能

- 创建、切换、重命名和删除服务端会话。
- 为每个会话独立选择模型，刷新页面后恢复模型与完整消息历史。
- 为每个会话独立保存“深度思考”和“工具调用”开关。
- 展示模型正式回答、思考过程和 Markdown 代码块。
- 展示沙箱自动生成的 PPTX、PDF、DOCX、XLSX 等产物下载链接。
- 在回答中直接嵌入沙箱构建的 React/Vite 静态网站预览。
- 管理 Anthropic 兼容与 OpenAI 兼容的模型配置。
- 管理 DeepAgent 系统工具、本地工具、MCP 服务和 Skills 插件。
- 点击输入框纸夹直接打开系统文件选择器，也支持拖拽和粘贴图片。
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
| `app/_components/PluginManagerModal.tsx` | 插件分类、启停、测试和 MCP/Skill 编辑界面 |
| `app/_components/MarkdownLink.tsx` | 识别签名预览链接并选择普通链接或页面预览 |
| `app/_components/WebPreview.tsx` | 使用受限 iframe 展示沙箱生成的静态站点 |
| `app/_utils/provider.tsx` | Ant Design X Provider、SSE 请求和 Markdown 渲染 |
| `app/_utils/conversation-api.ts` | 会话 API 客户端 |
| `app/_utils/model-api.ts` | 模型管理 API 客户端 |
| `app/_utils/plugin-api.ts` | 插件管理 API 客户端 |
| `app/_utils/image.ts` | 图片类型、数量、大小校验与 Data URL 转换 |
| `next.config.ts` | Nest 同源代理和请求体大小配置 |

## 会话能力开关

输入框底部的“深度思考”和“工具调用”属于当前会话。点击后前端会先通过
`PATCH /api/conversations/:id` 保存设置，再更新按钮状态；切换会话或刷新页面时会从
Nest 恢复。新会话和没有这两个字段的旧会话默认都开启这两项能力。

- 深度思考：切换主 Agent 的回答策略提示。关闭时要求模型优先直接回答；模型服务是否
  仍返回原生 reasoning 字段，最终取决于该模型和上游接口。
- 工具调用：当前会话的插件总开关。关闭时不会连接 MCP、读取 Skill 或向模型发送任何
  工具定义；DeepAgent 内置工具也会一并移除。

直接选择 `qwen3.5-ocr` 时不会创建 DeepAgent，因此这两个开关会继续随会话保存，但只在
之后切换到主模型时生效。

## 插件管理

侧栏底部“模型管理”旁边提供“插件管理”入口。页面按系统工具、MCP 和 Skills 分类：

- DeepAgent 内置工具和项目内置工具可以启停，但不能删除。
- MCP 支持 stdio 与 Streamable HTTP，可以使用表单或单服务 `mcpServers` JSON 配置命令、参数、服务地址和超时；两种配置方式会在切换时双向同步。stdio 启动命令允许留空保存，实际测试或运行前仍需填写；相对工作目录以 `ai-agent/.mcp/<插件 ID>/` 为基准。
- MCP 鉴权只填写环境变量名称，不在浏览器或 `.keen-agent/plugins.json` 中保存密钥。
- MCP 新建和编辑弹窗可以在保存前直接测试草稿连接；列表中的测试入口继续用于复测已保存配置。
- Skill 默认放在 `ai-agent/.skills/<name>/`，路径可以只填写 Skill 名称，也可以填写 `SKILL.md` 或目录的仓库相对路径；目录名称必须与 frontmatter 中的 `name` 一致。
- Skills 页支持粘贴 `npx` 或 `uvx`（兼容 `ux` 写法）安装命令。命令固定在 `ai-agent` 工作目录执行且不经过 shell；完成后会扫描常见项目级 Skills 目录、校验新增内容并自动注册。
- 每个插件都可以先执行“测试”，确认系统能力、MCP 工具列表或 Skill 元数据及资源文件可读取。
- 单个 MCP 连接失败不会再让聊天请求整体返回 400；回答会展示插件降级提醒，管理页“测试”会显示鉴权、额度或超时等具体原因。

启用“Docker 隔离执行器”系统插件后，完整 Skill 会只读挂载到容器，Agent 可以在断网沙箱内执行脚本。工作文件位于 `/mnt/user-data/workspace`，写入 `/mnt/user-data/outputs` 的最终文件会自动变成同源下载链接；浏览器点击链接直接调用 Nest 下载 API。

需要创建网站时，模型通过同一组沙箱文件工具创建 React/Vite 源码，调用镜像内离线依赖完成构建，再把静态产物放到 `/mnt/user-data/previews/<名称>/`。回答中的签名预览链接会渲染成 iframe 和“新窗口打开”入口。iframe 本身不授予同源、表单、下载或打开新窗口的能力，并由 Nest 的 CSP 禁止访问外部网络；因此适合查看和操作纯前端静态页面，不适合依赖远程 API 的应用。

插件管理可以启动本地 MCP 进程、读取 Skill 文件并执行第三方 Skill 安装器，属于管理员能力；只应安装可信来源。面向公网部署时需要为插件管理 API 增加鉴权或访问控制。

管理页的全局启用状态与会话“工具调用”总开关共同决定下一轮 Agent 的实际能力；修改后无需重启 Web 服务。

## 图片问答流程

支持 JPEG、PNG、GIF 和 WebP，每次最多 3 张，单张不超过 4 MB，总大小不超过 6 MB。
点击纸夹会直接打开操作系统的文件选择器；选择完成后才展开附件预览。前端校验后会把
图片转换成 Data URL；Nest 会再次校验并随会话保存。

当会话选择 DeepSeek 等主模型时：

1. `ai-server` 先调用内部视觉模型，默认是 `qwen3.5-ocr`。
2. 多张图片会分别发起 OCR 请求，再按上传顺序合并为带序号的结果，避免遗漏其中一张。
3. Qwen 只负责完整提取图片文字，合并后的识别结果会写入当前用户消息。
4. OCR 文本作为低权限上下文交给主模型的 DeepAgent。
5. 后续不再上传图片的追问可以继续复用已保存的 OCR。

当会话直接选择 `qwen3.5-ocr` 时，同样会逐张识别并合并结果，不创建 DeepAgent，也不会调用 DeepSeek。该模式适合提取文字；需要解释代码、分析报错或连续推理时，应选择 DeepSeek 等主模型。

## 本地运行

在仓库根目录执行：

```bash
pnpm install
docker build -t keen-agent-sandbox:latest ai-agent/.sandbox
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
