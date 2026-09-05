import { posix } from 'node:path';
import type { StructuredTool } from '@langchain/core/tools';
import { createMiddleware } from 'langchain';
import type { TaskSpec } from './task-plan.ts';

const READ_TOOLS = ['ls', 'read_file', 'glob', 'grep'];
const WRITE_TOOLS = ['write_file', 'edit_file', 'delete'];

export interface CapabilityPolicy {
  tools: Record<string, { names: string[]; effect: 'read' | 'write' | 'exclusive' }>;
}

export function createCapabilityPolicy(tools: StructuredTool[], shellEnabled: boolean): CapabilityPolicy {
  const capabilities: CapabilityPolicy['tools'] = {
    filesystem_read: { names: READ_TOOLS, effect: 'read' },
    filesystem_write: { names: WRITE_TOOLS, effect: 'write' },
  };
  if (shellEnabled) capabilities.shell = { names: ['execute'], effect: 'exclusive' };
  for (const tool of tools) {
    if (Object.hasOwn(capabilities, tool.name) || Object.hasOwn(Object.prototype, tool.name) ||
        [...READ_TOOLS, ...WRITE_TOOLS, 'execute', 'plan_tasks', 'task', 'submit_task_result', 'write_todos'].includes(tool.name)) {
      throw new Error(`插件工具名与运行时保留能力冲突：${tool.name}`);
    }
    // Unknown external operations are conservatively exclusive. Metadata is trusted
    // only as a scheduling hint; the enabled plugin registry remains the authority.
    const readOnly = tool.name === 'tiandi_tongshou' || tool.metadata?.readOnlyHint === true;
    capabilities[tool.name] = { names: [tool.name], effect: readOnly ? 'read' : 'exclusive' };
  }
  return { tools: capabilities };
}

export function validScope(path: string): boolean {
  return path.startsWith('/') && path !== '/' && !/[\\\x00*?\[\]{}]/.test(path) &&
    !path.split('/').includes('..') && !path.startsWith('/skills') &&
    !path.startsWith('/mnt/skills');
}

export function pathWithin(path: string, scopes: string[]): boolean {
  if (!validScope(path)) return false;
  const target = posix.normalize(path);
  return scopes.some(scope => {
    const prefix = posix.normalize(scope).replace(/\/$/, '');
    return target === prefix || target.startsWith(`${prefix}/`);
  });
}

export function validateTaskPolicy(task: TaskSpec, policy: CapabilityPolicy): string[] {
  const errors: string[] = [];
  for (const name of task.capabilities) {
    const capability = Object.hasOwn(policy.tools, name) ? policy.tools[name] : undefined;
    if (!capability) errors.push(`任务 ${task.id} 请求未授权能力：${name}`);
    else if (capability.effect === 'exclusive' && task.access !== 'exclusive') {
      errors.push(`能力 ${name} 必须使用 exclusive 模式`);
    } else if (capability.effect === 'write' && task.access === 'read') {
      errors.push(`只读任务 ${task.id} 不得请求写入能力`);
    }
  }
  if (task.access === 'read' && task.writeScopes.length > 0) errors.push('只读任务不得声明写范围');
  if (task.capabilities.includes('filesystem_write') && !task.writeScopes.length) errors.push('文件写入必须声明 writeScopes');
  if (task.writeScopes.some(s => !validScope(s))) errors.push('写范围必须为规范绝对路径，禁止根目录、Skill 目录、glob 和路径穿越');
  if (task.capabilities.includes('shell') && !task.writeScopes.includes('/mnt/user-data')) {
    errors.push('shell 无法按文件约束，必须显式授权 /mnt/user-data 并独占工作区');
  }
  return errors;
}

export function allowedTaskTools(task: TaskSpec, policy: CapabilityPolicy): Set<string> {
  const issues = validateTaskPolicy(task, policy);
  if (issues.length) throw new Error(issues.join('；'));
  return new Set(task.capabilities.flatMap(c => policy.tools[c]?.names ?? []));
}

/** Each instance belongs to one invocation. The immutable TaskSpec is not parsed from model text. */
export function createWorkerPolicy(task: TaskSpec, policy: CapabilityPolicy, validateWritePath?: (path: string) => Promise<void>) {
  const allowed = allowedTaskTools(task, policy);
  allowed.add('submit_task_result');
  return createMiddleware({
    name: 'workerCapabilityPolicy',
    wrapModelCall: (request, handler) => handler({
      ...request,
      tools: request.tools.filter(t => 'name' in t && allowed.has(String(t.name))),
    }),
    wrapToolCall: async (request, handler) => {
      const { name, args } = request.toolCall;
      if (!allowed.has(name)) throw new Error(`任务 ${task.id} 无权使用工具 ${name}`);
      if (WRITE_TOOLS.includes(name)) {
        const path = args.file_path ?? args.path;
        if (typeof path !== 'string' || !pathWithin(path, task.writeScopes)) {
          throw new Error(`任务 ${task.id} 写入越界`);
        }
        await validateWritePath?.(path);
      }
      return handler(request);
    },
  });
}
