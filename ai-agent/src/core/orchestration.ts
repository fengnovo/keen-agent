import type { StructuredTool } from '@langchain/core/tools';
import { ToolMessage } from '@langchain/core/messages';
import type { SubAgent } from 'deepagents';
import {
  createMiddleware,
  modelRetryMiddleware,
  type ModelRequest,
} from 'langchain';

/**
 * 主 Agent 的协调协议。
 *
 * DeepAgents 只负责提供 task 机制；细粒度拆解、角色选择以及依赖关系仍由主模型
 * 决策。这里把可验收的决策流程显式交给所有模型，并用两阶段门保障明显复杂任务
 * 至少完成规划与委派，避免依赖某个 Provider 私有的 harness profile。
 */
export const MULTI_AGENT_ORCHESTRATION_PROMPT = [
  '<multi_agent_orchestration>',
  '你是总协调 Agent，负责判断任务复杂度、拆解工作、选择子 Agent、整合结果并对最终质量负责。',
  '',
  '决策规则：',
  '1. 简单任务直接完成；不要为了展示多 Agent 而委派。',
  '2. 当任务包含至少两个可独立推进的工作流，或同时涉及调研、实现、验证时，视为复杂任务。',
  '3. 复杂任务先调用 write_todos 建立可验收计划；若另一个系统约束规定首个工具必须是特定工具，则先满足该约束，并在下一模型回合立即补计划。',
  '4. 为计划标出依赖关系。没有依赖的工作包必须在同一条 assistant 消息中并行发出多个 task 调用；有依赖的工作包按阶段执行。受并发上限限制的剩余工作包放到下一批。',
  '5. 每个 task 都必须写清目标、必要上下文、允许修改的文件或范围、禁止事项、期望输出和验收标准。子 Agent 看不到当前对话，不得依赖隐含上下文。',
  '6. 并行写文件时给每个 implementer 分配互不重叠的文件所有权；同一文件只能由一个 Agent 修改。共享文件由主 Agent 在汇总阶段串行整合。',
  '7. 所有子 Agent 返回后，检查证据和冲突，不能直接拼接报告。实现任务完成后，使用 reviewer 做独立复核；根据复核结果修正并重新验证。',
  '8. 每完成一个阶段就更新 write_todos；结束前不得留下 pending 或 in_progress 项。',
  '',
  '角色选择：planner 负责拆解和依赖分析，researcher 负责信息收集，implementer 负责边界明确的实现，reviewer 负责独立验证。',
  '你仍是最终责任人：子 Agent 失败时应缩小任务、改派或自行完成，并向用户准确说明无法完成的部分。',
  '</multi_agent_orchestration>',
].join('\n');

const PLANNER_PROMPT = [
  '你是规划子 Agent。只负责分析目标、约束、依赖、风险和验收标准，不负责实现。',
  '返回一个可执行的工作包列表；明确哪些工作包可并行、哪些必须串行，以及每个工作包应交给哪类 Agent。',
  '优先读取现有资料形成证据，不要修改工作区文件。结果必须简洁且足以让总协调 Agent 直接派工。',
  '最终报告不超过 600 个汉字或等量英文。',
].join('\n');

const RESEARCHER_PROMPT = [
  '你是调研子 Agent。围绕收到的单一目标收集代码库或外部资料证据，并给出带来源位置的结论。',
  '区分事实、推断和未知项；不要修改工作区文件。不要扩展任务范围。',
  '最终只返回与验收标准直接相关的发现、风险和建议。',
  '除非任务另有要求，最终报告不超过 600 个汉字或等量英文。',
].join('\n');

const IMPLEMENTER_PROMPT = [
  '你是实现子 Agent。只在任务明确授予的文件或目录范围内修改内容，并遵循现有项目约定。',
  '开始前读取相关文件；完成后运行与改动相称的最小验证。不要修改其他 Agent 拥有的文件，也不要承担未分配的共享文件整合。',
  '最终返回修改文件、关键决策、验证命令及结果，以及需要总协调 Agent 处理的剩余事项。',
  '最终交接报告不超过 600 个汉字或等量英文。',
].join('\n');

const REVIEWER_PROMPT = [
  '你是独立复核子 Agent。根据任务目标和验收标准检查已有结果、文件与测试证据。',
  '默认只读，不要替实现者静默修复；按严重程度报告可复现问题、遗漏和具体证据。',
  '如果没有发现问题，也要列出实际执行过的检查，不能只给主观结论。',
  '最终复核报告不超过 600 个汉字或等量英文。',
].join('\n');

const GENERAL_PURPOSE_PROMPT = [
  '你是通用执行子 Agent，只处理总协调 Agent 交给你的一个边界清晰、无法归入其他专职角色的任务。',
  '严格依据任务中的上下文、范围和验收标准工作；不要猜测当前对话中未提供的信息。',
  '完成后返回结果、证据和仍未解决的问题。',
].join('\n');

const TRANSIENT_ERROR_PATTERN =
  /(?:terminated|econnreset|econnrefused|econnaborted|etimedout|ehostunreach|enotfound|epipe|socket hang up|fetch failed|network error|connection ?error|connection reset|premature close|other side closed|und_err_socket|timeout|timed out|rate.?limit|too many requests|overloaded|bad gateway|service unavailable|gateway timeout)/i;
const TRANSIENT_STATUS_CODES = new Set([
  408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524,
]);

/**
 * 只重试网络抖动、限流和临时服务端错误。鉴权、余额、参数校验等
 * 确定性错误不应被重试掩盖。
 */
export const isTransientSubagentError = (error: Error): boolean => {
  if (error.name === 'AbortError') return false;

  let current: unknown = error;
  const visited = new Set<unknown>();
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);

    if (typeof current === 'object') {
      const record = current as Record<string, unknown>;
      const status = Number(record.status ?? record.statusCode);
      if (TRANSIENT_STATUS_CODES.has(status)) return true;

      const searchable = [record.name, record.message, record.code]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
      if (TRANSIENT_ERROR_PATTERN.test(searchable)) return true;
      current = record.cause;
      continue;
    }

    if (TRANSIENT_ERROR_PATTERN.test(String(current))) return true;
    break;
  }

  return false;
};

/** 子 Agent 模型调用的短退避重试；耗尽后继续抛错，保持验收结果真实。 */
export const createSubagentModelRetryMiddleware = (maxRetries = 2) =>
  modelRetryMiddleware({
    maxRetries:
      Number.isFinite(maxRetries) && maxRetries >= 0
        ? Math.floor(maxRetries)
        : 2,
    retryOn: isTransientSubagentError,
    initialDelayMs: 1_000,
    backoffFactor: 2,
    maxDelayMs: 4_000,
    jitter: true,
    onFailure: 'error',
  });

/** 为主 Agent 注册具名角色，让 task 的 subagent_type 成为真正的路由决策。 */
export const createOrchestrationSubagents = (
  tools: StructuredTool[],
  skills?: string[],
  model?: SubAgent['model'],
  maxRetries = 2,
): SubAgent[] => {
  const skillConfig = skills?.length ? { skills } : {};
  const modelConfig = model ? { model } : {};
  const resilientMiddleware = () => [
    createSubagentModelRetryMiddleware(maxRetries),
  ];

  return [
    {
      name: 'general-purpose',
      description:
        '通用后备执行 Agent；仅用于不适合 planner、researcher、implementer 或 reviewer 的独立复杂工作。',
      systemPrompt: GENERAL_PURPOSE_PROMPT,
      tools,
      middleware: resilientMiddleware(),
      ...skillConfig,
      ...modelConfig,
    },
    {
      name: 'planner',
      description:
        '复杂任务的规划与依赖分析专家；当边界、执行顺序或并行工作包不清楚时主动使用。',
      systemPrompt: PLANNER_PROMPT,
      tools,
      middleware: resilientMiddleware(),
      ...modelConfig,
    },
    {
      name: 'researcher',
      description:
        '代码库与外部资料调研专家；用于可独立并行的信息收集、方案比较和事实核验。',
      systemPrompt: RESEARCHER_PROMPT,
      tools,
      middleware: resilientMiddleware(),
      ...skillConfig,
      ...modelConfig,
    },
    {
      name: 'implementer',
      description:
        '边界明确的实现专家；用于修改被独占分配的文件、执行命令并提交验证结果。',
      systemPrompt: IMPLEMENTER_PROMPT,
      tools,
      middleware: resilientMiddleware(),
      ...skillConfig,
      ...modelConfig,
    },
    {
      name: 'reviewer',
      description:
        '独立质量复核专家；在调研或实现完成后检查正确性、遗漏、回归与验收证据。',
      systemPrompt: REVIEWER_PROMPT,
      tools,
      middleware: resilientMiddleware(),
      ...skillConfig,
      ...modelConfig,
    },
  ];
};

interface TaskWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const abortReason = (signal: AbortSignal): Error => {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('子 Agent 在等待并发槽位时被取消');
  error.name = 'AbortError';
  return error;
};

/**
 * 限制 task 工具内部真正运行的子 Agent 数。主模型仍可在一条消息中
 * 并行发出多个 task，超出上限的调用在进程内排队，避免兼容端点断流。
 */
export const createTaskConcurrencyMiddleware = (maxConcurrency = 2) => {
  const limit =
    Number.isFinite(maxConcurrency) && maxConcurrency >= 1
      ? Math.floor(maxConcurrency)
      : 2;
  const queue: TaskWaiter[] = [];
  let active = 0;

  const acquire = async (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) throw abortReason(signal);
    if (active < limit) {
      active += 1;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: TaskWaiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = queue.indexOf(waiter);
          if (index >= 0) queue.splice(index, 1);
          reject(abortReason(signal));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      queue.push(waiter);
    });
  };

  const release = (): void => {
    while (queue.length > 0) {
      const waiter = queue.shift();
      if (!waiter) break;
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }
      if (waiter.signal?.aborted) {
        waiter.reject(abortReason(waiter.signal));
        continue;
      }
      // 当前槽位直接交给队首，active 数量不变。
      waiter.resolve();
      return;
    }
    active -= 1;
  };

  return createMiddleware({
    name: 'taskConcurrencyLimit',
    wrapToolCall: async (request, handler) => {
      if (request.toolCall.name !== 'task') return handler(request);

      await acquire(request.runtime.signal);
      try {
        try {
          return await handler(request);
        } catch (error) {
          // 用户取消或整轮超时必须继续向上抛出；普通子 Agent
          // 失败则返回可机读的 error ToolMessage，让主 Agent 能缩小任务或改派。
          if (
            request.runtime.signal?.aborted ||
            (error instanceof Error && error.name === 'AbortError')
          ) {
            throw error;
          }
          const message =
            error instanceof Error ? error.message : String(error);
          return new ToolMessage({
            name: 'task',
            tool_call_id: request.toolCall.id ?? 'unknown-task',
            status: 'error',
            content:
              `[keen-subagent-error] 子 Agent 执行失败：${message.slice(0, 500)}\n` +
              '请主 Agent 根据原计划缩小工作包、改派或自行完成，不得把该结果当作成功。',
          });
        }
      } finally {
        release();
      }
    },
  });
};

const COMPLEX_OBJECTIVE_PATTERN =
  /(?:迁移|重构|架构|开发|实现|调研|研究|评审|审计|排查|方案|系统|项目|端到端|migration|refactor|architect|implement|research|review|audit|project|end[ -]to[ -]end)/i;
const EXPLICIT_MULTI_WORKSTREAM_PATTERN =
  /(?:并行|多个(?:任务|模块|方向|部分|工作流)|至少[二两2]个|分别.{0,20}(?:以及|和|、)|parallel|multiple (?:tasks|modules|workstreams)|at least (?:two|2))/i;

/**
 * 保守识别“明显包含多个工作流”的请求，用于确定性地启用首轮规划门。
 * 未命中不代表任务一定简单：主模型仍可依据协调协议主动调用 write_todos。
 */
export const isComplexAgentRequest = (content: string): boolean => {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (EXPLICIT_MULTI_WORKSTREAM_PATTERN.test(normalized)) return true;
  if (!COMPLEX_OBJECTIVE_PATTERN.test(normalized) || normalized.length < 60) {
    return false;
  }

  const separators = normalized.match(/[、；;]|(?:以及|同时|并且|然后|并给出)/g);
  return (separators?.length ?? 0) >= 2;
};

const extractTextContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      if ('text' in block && typeof block.text === 'string') return block.text;
      return '';
    })
    .join('');
};

const getMessageType = (message: unknown): string | undefined => {
  if (!message || typeof message !== 'object') return undefined;
  if ('getType' in message && typeof message.getType === 'function') {
    return message.getType();
  }
  if ('role' in message && typeof message.role === 'string') {
    return message.role === 'user' ? 'human' : message.role;
  }
  return undefined;
};

interface ComplexTurn {
  key: string;
  hasPlanResult: boolean;
  hasTaskResult: boolean;
}

const getComplexTurn = (request: ModelRequest): ComplexTurn | undefined => {
  let lastHumanIndex = -1;
  let humanCount = 0;
  for (const message of request.messages) {
    if (getMessageType(message) === 'human') humanCount += 1;
  }
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    if (getMessageType(request.messages[index]) === 'human') {
      lastHumanIndex = index;
      break;
    }
  }
  if (lastHumanIndex < 0) return undefined;

  const userMessage = request.messages[lastHumanIndex];
  const content =
    userMessage && 'content' in userMessage
      ? extractTextContent(userMessage.content)
      : '';
  if (!isComplexAgentRequest(content)) return undefined;

  const toolResults = request.messages.slice(lastHumanIndex + 1).filter(
    (message) => getMessageType(message) === 'tool',
  );
  const hasToolResult = (toolName: string): boolean =>
    toolResults.some(
      (message) =>
        'name' in message &&
        typeof message.name === 'string' &&
        message.name === toolName,
    );

  const userMessageId =
    userMessage &&
    'id' in userMessage &&
    typeof userMessage.id === 'string' &&
    userMessage.id
      ? userMessage.id
      : undefined;
  return {
    key: userMessageId ?? `${humanCount}:${lastHumanIndex}:${content}`,
    hasPlanResult: hasToolResult('write_todos'),
    hasTaskResult: hasToolResult('task'),
  };
};

const getForcedToolChoice = (
  provider: 'anthropic' | 'openai',
  normalizedModel: string | undefined,
  toolName: string,
): ModelRequest['toolChoice'] =>
  provider === 'anthropic'
    ? normalizedModel === 'kimi-k3'
      ? 'auto'
      : (toolName as ModelRequest['toolChoice'])
    : { type: 'function', function: { name: toolName } };

/**
 * 明显复杂任务的确定性两阶段门：主 Agent 首轮只能规划，第二轮只能委派，
 * 子 Agent 返回后才恢复全部工具。Kimi 等模型不会把“写完计划”误当成任务完成。
 */
export const createComplexPlanningMiddleware = (
  provider: 'anthropic' | 'openai',
  model?: string,
  maxTaskConcurrency = 2,
) => {
  // 一个 runtime 可服务多个 CLI 对话轮次；以最新 HumanMessage 为键，分别记录
  // 每个复杂用户轮次的规划门和委派门，不依赖 Provider 如何合并 ToolMessage。
  const plannedTurns = new Set<string>();
  const delegationGatedTurns = new Set<string>();
  const normalizedModel = model?.trim().toLowerCase().split('/').at(-1);

  return createMiddleware({
    name: 'complexPlanningGate',
    wrapModelCall: async (request, handler) => {
      const turn = getComplexTurn(request);
      if (!turn) return handler(request);
      const planComplete = plannedTurns.has(turn.key) || turn.hasPlanResult;

      if (planComplete) {
        const delegationComplete =
          delegationGatedTurns.has(turn.key) || turn.hasTaskResult;
        if (delegationComplete) return handler(request);

        const task = request.tools.find(
          (candidate) => 'name' in candidate && candidate.name === 'task',
        );
        if (!task) throw new Error('复杂任务缺少必需的 task 工具');

        delegationGatedTurns.add(turn.key);
        try {
          return await handler({
            ...request,
            tools: [task],
            toolChoice: getForcedToolChoice(
              provider,
              normalizedModel,
              'task',
            ),
            systemMessage: request.systemMessage.concat(
              `计划已经建立。本回合必须根据计划调用 task，不要继续改写计划或输出最终答案。把没有依赖的工作包在这一条消息中并行发出至少两个 task，但本批最多 ${Math.max(2, Math.floor(maxTaskConcurrency))} 个；剩余工作包在收到本批结果后继续委派。每个 description 必须包含完整上下文和验收标准。`,
            ),
          });
        } catch (error) {
          delegationGatedTurns.delete(turn.key);
          throw error;
        }
      }

      const writeTodos = request.tools.find(
        (candidate) => 'name' in candidate && candidate.name === 'write_todos',
      );
      if (!writeTodos) {
        throw new Error('复杂任务缺少必需的 write_todos 工具');
      }

      plannedTurns.add(turn.key);
      try {
        const response = await handler({
          ...request,
          tools: [writeTodos],
          toolChoice: getForcedToolChoice(
            provider,
            normalizedModel,
            'write_todos',
          ),
          systemMessage: request.systemMessage.concat(
            '当前请求已被规划门判定为明显复杂任务。本回合只能调用一次 write_todos 建立工作包、依赖和验收标准；不要输出最终答案。',
          ),
        });

        // Kimi K3 必须保持 toolChoice=auto，偶尔会在唯一工具可见时仍生成
        // 多个 write_todos。只保留第一项，避免 Todo middleware 拒绝整批调用。
        const writeCalls = response.tool_calls?.filter(
          (call) => call.name === 'write_todos',
        );
        const firstWriteCall = writeCalls?.[0];
        if (firstWriteCall && writeCalls.length > 1) {
          response.tool_calls = [firstWriteCall];
        }
        return response;
      } catch (error) {
        plannedTurns.delete(turn.key);
        throw error;
      }
    },
  });
};

export interface OrchestrationToolEvent {
  event: 'on_tool_start' | 'on_tool_end' | 'on_tool_error';
  name: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
}

export interface OrchestrationVerification {
  passed: boolean;
  plannedBeforeDelegation: boolean;
  delegatedTaskCount: number;
  subagentTypes: string[];
  maximumTaskConcurrency: number;
  allDelegationsSettled: boolean;
  errors: string[];
}

const getSubagentType = (input: unknown): string | undefined => {
  if (typeof input === 'string') {
    try {
      return getSubagentType(JSON.parse(input));
    } catch {
      return undefined;
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const value = (input as Record<string, unknown>).subagent_type;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const isFailedTaskOutput = (output: unknown): boolean => {
  if (typeof output === 'string') {
    return output.includes('[keen-subagent-error]');
  }
  if (!output || typeof output !== 'object') return false;

  const record = output as Record<string, unknown>;
  if (record.status === 'error') return true;
  if (isFailedTaskOutput(record.content)) return true;
  return isFailedTaskOutput(record.kwargs);
};

/**
 * 根据 LangChain tools 流验证一次运行是否真的发生了“先规划、再并行委派”。
 * 这比检查最终回答里是否声称使用了多个 Agent 更可靠。
 */
export const verifyOrchestrationEvents = (
  events: OrchestrationToolEvent[],
): OrchestrationVerification => {
  const activeTasks = new Map<string, number>();
  const anonymousTaskIds: string[] = [];
  const subagentTypes = new Set<string>();
  const errors: string[] = [];
  let sequence = 0;
  let planSequence: number | undefined;
  let firstTaskSequence: number | undefined;
  let delegatedTaskCount = 0;
  let settledTaskCount = 0;
  let maximumTaskConcurrency = 0;

  for (const event of events) {
    sequence += 1;

    if (event.name === 'write_todos' && event.event === 'on_tool_start') {
      planSequence ??= sequence;
      continue;
    }

    if (event.name !== 'task') continue;

    if (event.event === 'on_tool_start') {
      delegatedTaskCount += 1;
      firstTaskSequence ??= sequence;
      const callId = event.toolCallId ?? `anonymous-task-${delegatedTaskCount}`;
      activeTasks.set(callId, sequence);
      if (!event.toolCallId) anonymousTaskIds.push(callId);
      maximumTaskConcurrency = Math.max(
        maximumTaskConcurrency,
        activeTasks.size,
      );
      const subagentType = getSubagentType(event.input);
      if (subagentType) subagentTypes.add(subagentType);
      continue;
    }

    const callId = event.toolCallId ?? anonymousTaskIds.shift();
    if (callId && activeTasks.delete(callId)) settledTaskCount += 1;
    if (event.event === 'on_tool_error') {
      errors.push(`子 Agent 调用失败：${callId ?? 'unknown'}`);
    } else if (isFailedTaskOutput(event.output)) {
      errors.push(`子 Agent 返回失败结果：${callId ?? 'unknown'}`);
    }
  }

  const plannedBeforeDelegation =
    planSequence !== undefined &&
    firstTaskSequence !== undefined &&
    planSequence < firstTaskSequence;
  const allDelegationsSettled =
    delegatedTaskCount > 0 &&
    activeTasks.size === 0 &&
    settledTaskCount === delegatedTaskCount &&
    errors.length === 0;
  const passed =
    plannedBeforeDelegation &&
    delegatedTaskCount >= 2 &&
    maximumTaskConcurrency >= 2 &&
    allDelegationsSettled;

  if (planSequence === undefined) errors.push('未观察到 write_todos 规划调用');
  if (firstTaskSequence === undefined) errors.push('未观察到 task 委派调用');
  if (delegatedTaskCount < 2) errors.push('委派数量少于 2，未形成多 Agent 协作');
  if (maximumTaskConcurrency < 2) errors.push('task 调用没有并行重叠');
  if (!allDelegationsSettled) errors.push('并非所有 task 调用都成功结束');

  return {
    passed,
    plannedBeforeDelegation,
    delegatedTaskCount,
    subagentTypes: [...subagentTypes],
    maximumTaskConcurrency,
    allDelegationsSettled,
    errors: [...new Set(errors)],
  };
};
