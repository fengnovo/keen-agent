/**
 * ============================================================
 * DeepAgent 命令行对话程序（程序入口）
 * ------------------------------------------------------------
 * 功能说明：
 * 1. 启动程序后，通过命令行与 AI Agent 进行持续多轮对话。
 * 2. 实时展示模型的思考过程、工具调用详情与最终回答。
 * 3. 按共享插件注册表装配 DeepAgent 内置能力、本地工具、MCP 与 Skills。
 * 4. 输入 /model 可在运行时查看并切换本地配置的模型。
 * 5. 输入 exit、quit 或 退出 即可结束会话。
 *
 * 运行方式：在项目根目录执行 `pnpm run dev:server`
 * ============================================================
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

import { runConversation } from './cli/conversation.ts';

// ---------- 1. 环境变量配置 ----------
dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
});

// ---------- 2. 程序入口 ----------
// 加载本地模型配置并启动持续对话
await runConversation();
