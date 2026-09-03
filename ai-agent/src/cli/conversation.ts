// ---------- 对话交互模块 ----------
// 负责命令行交互、流式响应处理与多轮对话管理

import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { stdin as input, stdout as output } from 'node:process';
import { select } from '@inquirer/prompts';
import { isBaseMessage } from '@langchain/core/messages';

import {
  createAgentRuntime,
  createLivenessCallback,
  type LivenessPhase,
} from '../core/agent.ts';
import { publishLocalArtifact } from '../sandbox/index.ts';
import {
  CONVERSATION_FILE,
  loadConversationHistory,
  saveConversationHistory,
} from './conversation-store.ts';
import {
  MODEL_CONFIG_FILE,
  findModel,
  getActiveModel,
  loadModelRegistry,
  saveModelRegistry,
  withActiveModel,
  type ModelConfig,
  type ModelRegistry,
} from '../config/model-config.ts';
import {
  createLoading,
  formatValue,
  resetMessageSection,
  terminalColor,
  writeMessageChunk,
} from './terminal.ts';

// 加载动画实例：用于在等待模型响应时展示动态进度
const loading = createLoading();

const getModelGeneratingTimeoutMs = (): number => {
  const value = Number(
    process.env.AI_AGENT_MODEL_TIMEOUT_MS || 15 * 60_000,
  );
  return Number.isInteger(value) && value >= 10_000 && value <= 60 * 60_000
    ? value
    : 15 * 60_000;
};

const getIdleTimeoutMs = (): number => {
  const value = Number(process.env.AI_AGENT_IDLE_TIMEOUT_MS || 3 * 60_000);
  return Number.isInteger(value) && value >= 10_000 && value <= 60 * 60_000
    ? value
    : 3 * 60_000;
};

const createCliAgentRuntime = (model: ModelConfig) =>
  createAgentRuntime(model, {
    sandbox: { publishArtifact: publishLocalArtifact },
  });

/**
 * 从命令行读取一行用户输入
 * @param question 展示给用户的提示语
 * @returns 去除首尾空格后的用户输入
 */
const askUser = (question: string): Promise<string> => {
  const rl = readline.createInterface({ input, output });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
};

/**
 * 打印 AI 返回的消息内容
 * 支持两种结构：
 * - 纯字符串内容（直接作为最终回答）
 * - 分块内容（区分思考过程 / 最终回答）
 */
const printAiMessage = (message: any) => {
  // 情况一：内容为纯字符串
  if (typeof message.content === 'string') {
    writeMessageChunk('text', '[最终回答]', message.content);
    return;
  }

  // 情况二：内容为分块数组，逐块判断类型
  for (const block of message.content) {
    // 思考过程：thinking 或 reasoning 类型
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      writeMessageChunk('thinking', '[思考过程]', block.thinking);
    } else if (
      block.type === 'reasoning' &&
      typeof block.reasoning === 'string'
    ) {
      writeMessageChunk('thinking', '[思考过程]', block.reasoning);
    }
    // 最终回答：text 类型
    else if (block.type === 'text' && typeof block.text === 'string') {
      writeMessageChunk('text', '[最终回答]', block.text);
    }
  }
};

/**
 * 处理 Agent 执行工具过程中的各类事件
 * 事件类型：
 * - on_tool_start：工具开始执行
 * - on_tool_event：工具执行过程中的中间事件
 * - on_tool_end：工具执行完成
 * - on_tool_error：工具执行出错
 */
const handleToolEvent = (payload: any) => {
  // 重置消息显示区域，避免与流式输出重叠
  resetMessageSection();

  switch (payload.event) {
    case 'on_tool_start':
      console.log(
        `\n\n${terminalColor.toolCall(`[工具调用] ${payload.name}`)}`,
      );
      console.log(
        `${terminalColor.input('[入参]')}\n${formatValue(payload.input)}`,
      );
      loading.start('正在执行工具...');
      break;

    case 'on_tool_event':
      console.log(
        `${terminalColor.toolEvent('[工具事件]')}\n${formatValue(payload.data)}`,
      );
      loading.start('工具仍在执行...');
      break;

    case 'on_tool_end':
      console.log(
        `${terminalColor.output('[出参]')}\n${formatValue(payload.output)}`,
      );
      loading.start('正在等待模型继续响应...');
      break;

    case 'on_tool_error':
      console.error(
        `${terminalColor.error('[工具错误]')}\n${formatValue(payload.error)}`,
      );
      loading.start('正在等待模型处理工具错误...');
      break;
  }
};

const printModelList = (
  registry: ModelRegistry,
  activeModel: ModelConfig,
): void => {
  console.log('\n可用模型：');
  registry.models.forEach((model, index) => {
    const activeMarker = model.id === activeModel.id ? '*' : ' ';
    console.log(
      `${activeMarker} ${index + 1}. ${model.name} (${model.id}) -> ${model.model}`,
    );
  });
  console.log(`\n模型配置：${MODEL_CONFIG_FILE}`);
};

/**
 * 运行持续对话：
 * 1. 循环读取用户输入
 * 2. 将本轮用户消息发送给 Agent
 * 3. 流式处理模型消息与工具事件
 * 4. 将完整上下文保存到本地 JSON 文件
 */
export const runConversation = async () => {
  const loadedModelRegistry = await loadModelRegistry();
  let modelRegistry = loadedModelRegistry.registry;
  let activeModel = getActiveModel(modelRegistry);
  let agentRuntime = await createCliAgentRuntime(activeModel);
  let agent = agentRuntime.agent;

  // 每次启动使用新的内存线程，并在首次请求时注入磁盘中恢复的历史消息
  let threadId = randomUUID();
  let restoredMessages = await loadConversationHistory();

  console.log(
    '开始持续对话，输入 /model 可切换模型，输入 exit、quit 或 退出 即可结束会话。',
  );
  console.log(`当前模型：${activeModel.name} (${activeModel.id})`);
  if (loadedModelRegistry.created) {
    console.log(`已创建本地模型配置：${MODEL_CONFIG_FILE}`);
  }
  if (restoredMessages.length > 0) {
    console.log(
      `已从 ${CONVERSATION_FILE} 恢复 ${restoredMessages.length} 条历史消息。\n`,
    );
  } else {
    console.log(`当前是新会话，历史将保存到 ${CONVERSATION_FILE}。\n`);
  }

  // 无限循环，直到用户主动退出
  while (true) {
    // 1. 读取用户输入
    const userInput = await askUser('你：\n');

    // 2. 判断是否为退出指令
    const isExit =
      userInput.toLowerCase() === 'exit' ||
      userInput.toLowerCase() === 'quit' ||
      userInput === '退出';

    if (isExit) {
      await agentRuntime.close().catch(() => undefined);
      console.log('对话已结束，再见！');
      break;
    }

    // 忽略空输入
    if (!userInput) continue;

    const modelCommand = userInput.match(/^\/model(?:\s+(.*))?$/i);
    if (modelCommand) {
      resetMessageSection();
      let selection = modelCommand[1]?.trim() ?? '';

      if (selection === 'list' || selection === 'ls') {
        printModelList(modelRegistry, activeModel);
        continue;
      }

      if (selection === 'current') {
        console.log(`当前模型：${activeModel.name} (${activeModel.id})`);
        continue;
      }

      if (!selection) {
        console.log(`\n模型配置：${MODEL_CONFIG_FILE}`);

        try {
          selection = await select({
            message: '请选择要使用的模型',
            choices: modelRegistry.models.map((model) => ({
              name: `${model.id === activeModel.id ? '✓ ' : ''}${model.name} (${model.id})`,
              value: model.id,
              short: `${model.name} (${model.id})`,
              description: `请求模型：${model.model} · Provider：${model.provider}`,
            })),
            default: activeModel.id,
            pageSize: Math.min(Math.max(modelRegistry.models.length, 7), 12),
            loop: false,
            theme: {
              indexMode: 'number',
            },
          });
        } catch (error) {
          if (error instanceof Error && error.name === 'ExitPromptError') {
            console.log('已取消模型切换。');
            continue;
          }

          const message =
            error instanceof Error ? error.message : formatValue(error);
          console.error(
            terminalColor.error(`无法显示模型选择器：${message}`),
          );
          continue;
        }
      }

      const selectedModel = findModel(modelRegistry, selection);
      if (!selectedModel) {
        console.error(
          terminalColor.error(
            `未找到模型“${selection}”，请输入 /model 查看可用模型。`,
          ),
        );
        continue;
      }

      if (selectedModel.id === activeModel.id) {
        console.log(`当前已经是 ${activeModel.name} (${activeModel.id})。`);
        continue;
      }

      let nextAgentRuntime:
        | Awaited<ReturnType<typeof createAgentRuntime>>
        | undefined;

      try {
        // 先验证新模型环境配置，再持久化选择并替换运行中的 Agent
        nextAgentRuntime = await createCliAgentRuntime(selectedModel);
        const nextRestoredMessages = await loadConversationHistory();
        const nextRegistry = withActiveModel(
          modelRegistry,
          selectedModel.id,
        );
        await saveModelRegistry(nextRegistry);

        await agentRuntime.close().catch(() => undefined);
        agentRuntime = nextAgentRuntime;
        agent = nextAgentRuntime.agent;
        nextAgentRuntime = undefined;
        activeModel = selectedModel;
        modelRegistry = nextRegistry;
        threadId = randomUUID();
        restoredMessages = nextRestoredMessages;

        console.log(
          terminalColor.output(
            `已切换到 ${activeModel.name} (${activeModel.id})。`,
          ),
        );
      } catch (error) {
        await nextAgentRuntime?.close().catch(() => undefined);
        const message =
          error instanceof Error ? error.message : formatValue(error);
        console.error(
          terminalColor.error(`模型切换失败：${message}`),
        );
      }

      continue;
    }

    loading.start('正在等待模型响应...');

    // 两级超时：model-generating 宽裕（15 min），idle 短（3 min）
    const idleController = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    let currentPhase: LivenessPhase = 'idle';

    const armTimer = (phase: LivenessPhase) => {
      currentPhase = phase;
      if (timer) clearTimeout(timer);
      const ms =
        phase === 'model-generating'
          ? getModelGeneratingTimeoutMs()
          : getIdleTimeoutMs();
      timer = setTimeout(() => idleController.abort(), ms);
    };
    armTimer('idle');

    // LangChain callback：token 级别活跃信号，弥补 stream event 稀疏
    const livenessCallback = createLivenessCallback((phase) => armTimer(phase));

    try {
      // 每轮只提交新增的用户消息，历史由 checkpointer 根据 thread_id 自动恢复
      const messages = [
        ...restoredMessages,
        { role: 'user' as const, content: userInput },
      ];

      const stream = await agent.stream(
        {
          messages,
          ...(agentRuntime.skillFiles
            ? { files: agentRuntime.skillFiles }
            : {}),
        },
        {
          configurable: { thread_id: threadId },
          streamMode: ['messages', 'tools'],
          signal: idleController.signal,
          callbacks: [livenessCallback],
        },
      );

      for await (const event of stream) {
        armTimer(currentPhase);
        if (!Array.isArray(event) || event.length < 2) continue;
        const [mode, payload] = event;
        loading.stop();

        // mode 为 'messages'：模型返回的消息
        if (mode === 'messages') {
          if (!Array.isArray(payload)) continue;
          const [message] = payload;
          if (!isBaseMessage(message) || message.getType() !== 'ai') continue;

          printAiMessage(message);
          continue;
        }

        // mode 为 'tools'：工具执行事件
        handleToolEvent(payload);
      }

      const artifacts = await agentRuntime.collectArtifacts();
      if (artifacts.length > 0) {
        resetMessageSection();
        console.log('\n生成的文件：');
        for (const artifact of artifacts) {
          console.log(`- ${artifact.name}: ${artifact.url}`);
        }
      }
      const previews = await agentRuntime.collectPreviews();
      if (previews.length > 0) {
        resetMessageSection();
        console.log('\n生成的网站预览：');
        for (const preview of previews) {
          console.log(`- ${preview.name}: ${preview.url}`);
        }
      }

      process.stdout.write('\n');

      // 首次请求已经把磁盘历史注入当前线程，后续轮次只需发送新增消息
      restoredMessages = [];

      // 从 checkpointer 获取这一轮结束后的完整消息链并保存到本地
      const state = (await agent.getState({
        configurable: { thread_id: threadId },
      })) as unknown as { values: { messages?: unknown } };
      const stateMessages = state.values.messages;

      if (
        !Array.isArray(stateMessages) ||
        !stateMessages.every(isBaseMessage)
      ) {
        throw new Error('Agent 状态中缺少可持久化的完整消息列表');
      }

      await saveConversationHistory(stateMessages);
    } catch (error) {
      loading.stop();
      resetMessageSection();

      const errorDetails =
        error instanceof Error
          ? (error.stack ?? `${error.name}: ${error.message}`)
          : formatValue(error);

      console.error(`\n${terminalColor.error('[本轮对话失败]')}`);
      console.error(errorDetails);
    } finally {
      loading.stop();
      if (timer) clearTimeout(timer);
    }
  }
};
