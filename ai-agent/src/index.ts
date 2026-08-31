/**
 * ============================================================
 * DeepAgent 命令行对话程序（程序入口）
 * ------------------------------------------------------------
 * 功能说明：
 * 1. 启动程序后，通过命令行与 AI Agent 进行持续多轮对话。
 * 2. 实时展示模型的思考过程、工具调用详情与最终回答。
 * 3. 支持使用「天地同寿算法」自定义工具进行数值计算。
 * 4. 输入 exit、quit 或 退出 即可结束会话。
 *
 * 运行方式：在项目根目录执行 `pnpm dev`
 * ============================================================
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

import { createAgent } from './agent.ts';
import { runConversation } from './conversation.ts';

// ---------- 1. 环境变量配置 ----------
dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
});

// ---------- 2. 程序入口 ----------
// 创建 Agent 实例
const agent = createAgent();

// 启动持续对话，用户可在命令行逐轮输入 user message
runConversation(agent);
