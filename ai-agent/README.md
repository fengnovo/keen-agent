# Keen Agent 核心包

`ai-agent` 是整个仓库共享的 AI 核心包，负责模型与插件配置、LangChain 模型客户端、DeepAgent、工具运行时以及命令行会话。`ai-server` 会直接复用它导出的模型工厂和 Agent 运行时，避免 Web 与命令行各自维护一套模型和插件连接逻辑。

## 整体架构

```mermaid
flowchart LR
  Browser[浏览器 ai-chat] -->|同源 API 与 SSE| Server[ai-server Nest]
  Server -->|createAgentRuntime| MainAgent[DeepAgent 或普通 Agent]
  Server -->|createChatModel| OCR[Qwen OCR 底层模型]
  CLI[ai-agent 命令行] -->|createAgentRuntime| MainAgent
  MainAgent --> Providers[Anthropic/OpenAI 兼容模型服务]
  OCR --> Providers
  ModelRegistry[models.json] --> Server
  ModelRegistry --> CLI
  PluginRegistry[plugins.json] --> Server
  PluginRegistry --> CLI
  Server --> WebHistory[chat-conversations.json]
  CLI --> CliHistory[conversation.json]
```

三个工作区的职责如下：

| 工作区 | 职责 |
| --- | --- |
| `ai-chat` | 浏览器界面、图片选择、模型选择和 SSE 展示 |
| `ai-server` | HTTP API、会话持久化、图片校验与双模型编排 |
| `ai-agent` | 模型配置、Provider 工厂、DeepAgent、工具和命令行入口 |

Web 与命令行共用模型和插件注册表，但会话历史相互独立：

- 模型注册表：`.keen-agent/models.json`
- 插件注册表：`.keen-agent/plugins.json`

- Web 会话：`.keen-agent/chat-conversations.json`
- 命令行会话：`.keen-agent/conversation.json`

## 内部模块

目录分层参考 [Pi Coding Agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/src) 的 `core`、`cli` 与资源加载器设计，但按本项目规模保留更少层级：

```text
ai-agent/
├── .skills/                       # 项目级 Skill 完整资源包
├── .mcp/                          # 本地 stdio MCP 包和工作目录
└── src/
    ├── core/
    │   └── agent.ts               # 模型工厂、提示词与 Agent 运行时
    ├── config/
    │   ├── paths.ts               # 仓库、状态和资源根目录
    │   ├── model-config.ts        # 模型注册表
    │   └── plugin-config.ts       # 插件注册表与路径迁移
    ├── plugins/
    │   ├── builtin-tools.ts       # 系统内置工具目录
    │   ├── mcp-loader.ts          # MCP 连接和工具发现
    │   ├── skill-loader.ts        # Skill 校验与完整目录装载
    │   └── runtime.ts             # 本轮插件能力聚合
    ├── cli/
    │   ├── conversation.ts        # 命令行多轮会话
    │   ├── conversation-store.ts  # 命令行历史持久化
    │   └── terminal.ts            # 终端展示工具
    └── index.ts                   # CLI 启动入口
```

包导出仍保留 `@keen-agent/ai-agent/agent`、`model-config`、`plugin-config` 和 `plugin-runtime`，因此内部移动不会要求其他工作区同步修改导入语句。

## 本地资源目录

- `.skills/<name>/` 保存包含 `SKILL.md`、`scripts/`、`references/` 和 `assets/` 的完整 Skill。插件路径可以只填写 `<name>`，也可以填写 `ai-agent/.skills/<name>`。
- `.mcp/<plugin-id>/` 保存本地 stdio MCP 包。配置中的相对 `cwd` 以该目录为基准；HTTP MCP 不需要本地目录。
- `.keen-agent/plugins.json` 仍是启停状态和连接参数的共享索引，不保存 Skill 正文、MCP 源码或密钥。

旧的 `ai-agent/skills/...` 配置会在读取注册表时自动迁移为 `ai-agent/.skills/...`。

## 模型调用层次

### 底层聊天模型

`createChatModel(config)` 根据 `provider` 创建 LangChain 客户端：

- `anthropic`：创建 `ChatAnthropic`，用于 Anthropic Messages 兼容接口。
- `openai`：创建 `ChatOpenAI`，用于 OpenAI Chat Completions 兼容接口。

这里不挂载工具，也不运行 Agent 循环。Nest 的 Qwen OCR 预处理会直接使用这个函数。

### Agent 运行时

`createAgentRuntime(config, features)` 读取插件注册表并返回 Agent、Skill 虚拟文件和资源清理函数。运行时会注入：

- 统一中文系统提示词；
- 当前模型身份；
- OCR、文件和网页内容的提示词注入防护；
- 当前已启用的本地工具、MCP 工具和 Skills；
- `MemorySaver` 内存检查点。

`features` 支持两个可选开关，省略时都默认为 `true`，因此命令行入口保持原有行为：

- `thinkingEnabled`：选择“充分分析”或“优先直接回答”的系统提示策略。
- `toolsEnabled`：当前会话的插件总开关。关闭时不会读取 Skill、连接 MCP 或暴露任何工具。

当 `toolsEnabled` 和 `deepagent-core` 都开启时创建 DeepAgent，提供规划、临时文件工作区和任务委派等内置能力。关闭其中任意一项时改用普通 LangChain Agent，因此不是只靠提示词隐藏 DeepAgent 内置工具。

命令行聊天和 Web 的主模型回答都使用这个工厂。Web 会从当前会话读取上述开关，每次请求
创建临时线程并注入服务端完整历史；命令行则在进程内持续复用同一线程。

## 图片双模型流程

图片功能是 `ai-server` 中的固定两阶段编排，不是主 Agent 自主调用的子 Agent：

```text
图片
  → createChatModel(qwen3.5-ocr)
  → 完整 OCR 与结果规范化
  → 缓存到用户消息的 imageAnalysis
  → 原问题 + 低权限 OCR 上下文
  → createAgentRuntime(DeepSeek 等主模型)
  → 最终回答
```

这种方式保证每次上传图片都会先完成 OCR，并且不会让不支持图片的主模型接收图片数据块。OCR 结果会持久化，后续文字追问无需重复识别。

如果用户直接选择 `qwen3.5-ocr`，Nest 会绕过 DeepAgent 和工具定义，直接调用底层模型。原因是 OCR 模型不支持工具调用，而且它的职责只是文字提取。

## 插件注册表

默认文件为 `.keen-agent/plugins.json`，包含四类插件：

- `builtin`：DeepAgent 自带的规划、文件工作区和 `task` 等能力，作为一个系统插件管理。
- `tool`：项目源码中实现并登记在工具目录中的本地工具。
- `mcp`：通过 `@langchain/mcp-adapters` 连接的 stdio 或 Streamable HTTP MCP 服务。
- `skill`：位于 `.skills/` 或显式路径中的完整 Agent Skills 目录；必须包含 `SKILL.md`，且目录名称与 frontmatter 中的 `name` 一致。

系统插件可启停但不能删除或在线修改实现。MCP 和 Skill 可以从 Web 管理页增删改查和测试。MCP 配置只保存环境变量名称：stdio 使用“子进程变量 → 宿主变量”，HTTP 使用“Header → 宿主变量”映射，真实密钥仍保存在 `ai-agent/.env`。

启用 Skill 时，运行时会把目录中的 `SKILL.md`、`scripts/`、`references/` 和 `assets/` 等文件完整映射到内存 StateBackend 的 `/skills/<name>/`，不会因此获得仓库真实磁盘权限。符号链接不会被跟随；每个 Skill 最多 128 个文件、单文件 10 MB、总计 20 MB。当 DeepAgent 核心插件关闭时，只有 `SKILL.md` 内容会加入普通 Agent 的系统指令。

StateBackend 不提供宿主机 shell，Skill 脚本当前可以被 Agent 查看，但不会自动执行。来自其他 Agent 平台、依赖 `/mnt`、`execute` 或其他 Skill 的包，需要配置对应依赖和受控执行器，不能仅复制一个目录就视为可运行。

## 模型注册表

默认文件为仓库根目录的 `.keen-agent/models.json`。示例：

```json
{
  "version": 1,
  "activeModelId": "deepseek-v4-flash",
  "models": [
    {
      "id": "qwen3.5-ocr",
      "name": "qwen3.5-ocr",
      "provider": "openai",
      "model": "qwen3.5-ocr",
      "apiKeyEnv": "QWEN_API_KEY",
      "baseUrl": "https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      "temperature": 0,
      "timeoutMs": 15000,
      "maxRetries": 1
    },
    {
      "id": "deepseek-v4-flash",
      "name": "deepseek-v4-flash",
      "provider": "anthropic",
      "model": "deepseek-v4-flash",
      "apiKeyEnv": "DS_ANTHROPIC_API_KEY",
      "baseUrlEnv": "DS_ANTHROPIC_BASE_URL",
      "temperature": 0,
      "timeoutMs": 15000,
      "maxRetries": 1
    }
  ]
}
```

`provider` 表示 API 兼容协议，不代表模型厂商。Qwen OCR 官方端点使用 OpenAI 兼容协议；当前 DeepSeek 接口使用 Anthropic 兼容协议。

配置只保存环境变量名，不保存密钥。`resolveModelConfig` 会在创建模型时读取 `apiKeyEnv` 和可选的 `baseUrlEnv`；也可以直接使用 `baseUrl`。

如果模型注册表不存在，程序会读取 `MODEL`、`ANTHROPIC_API_KEY` 和 `ANTHROPIC_BASE_URL` 创建一条默认的 Anthropic 兼容配置。

## 环境变量

在 `ai-agent/.env` 中配置模型注册表引用的变量，例如：

```bash
QWEN_API_KEY=你的百炼密钥
DS_ANTHROPIC_API_KEY=你的主模型密钥
DS_ANTHROPIC_BASE_URL=https://api.example.com/anthropic
```

不要把真实密钥写进 README、源码或 `.keen-agent/models.json`。

Web 图片编排还支持：

```bash
VISION_MODEL_ID=qwen3.5-ocr
```

未配置时默认使用 `qwen3.5-ocr`。

## 命令行运行

在仓库根目录执行：

```bash
pnpm install
pnpm dev:server
```

命令行支持：

- `/model`：打开模型选择器。
- `/model list`：列出模型。
- `/model current`：显示当前模型。
- `/model <模型 ID 或序号>`：切换模型。
- `exit`、`quit` 或 `退出`：结束会话。

命令行启动或切换模型时会读取共享插件注册表；管理页修改插件后，重新启动命令行即可使用新配置。OCR 图片上传由 Web/Nest 流程负责。

## 被其他工作区调用

包对外导出：

```typescript
import {
  createAgentRuntime,
  createChatModel,
} from '@keen-agent/ai-agent/agent';
import {
  loadModelRegistry,
  resolveModelConfig,
} from '@keen-agent/ai-agent/model-config';
import { loadPluginRegistry } from '@keen-agent/ai-agent/plugin-config';
```

`ai-server` 通过 workspace 依赖直接引用这些 TypeScript 模块。

## 质量检查

```bash
pnpm --filter @keen-agent/ai-agent typecheck
```

如需验证整个仓库：

```bash
pnpm typecheck
pnpm --filter @keen-agent/ai-server build
pnpm --filter @keen-agent/ai-chat build
```
