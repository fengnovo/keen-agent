import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { pollResearch, readCallLimit, tavilyRequest } from './tavily-client.ts';

/** One catalog per conversation run: all workers/replans share limits and results. */
export function createSystemToolCatalog() {
  const used = new Map<string, number>();
  const cache = new Map<string, Promise<Record<string, unknown>>>();
  const limits = {
    tavily_search: readCallLimit('TAVILY_SEARCH_MAX_CALLS', 20),
    tavily_research: readCallLimit('TAVILY_RESEARCH_MAX_CALLS', 0),
    tavily_crawl: readCallLimit('TAVILY_CRAWL_MAX_CALLS', 2),
    tavily_extract: readCallLimit('TAVILY_EXTRACT_MAX_CALLS', 10),
  };
  async function run(name: keyof typeof limits, input: string, signal: AbortSignal | undefined,
    execute: () => Promise<Record<string, unknown>>) {
    signal?.throwIfAborted();
    const key = `${name}:${input.trim().replace(/\s+/g, ' ')}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const count = used.get(name) ?? 0;
    if (count >= limits[name]) return { error: `${name} 已达到本轮共享调用上限（${limits[name]}）。请根据已有证据完成回答并说明资料缺口，不要重复尝试或换工具绕过限制。` };
    used.set(name, count + 1);
    const pending = execute();
    cache.set(key, pending);
    try { return await pending; }
    catch (error) {
      // A Research POST may already have created a billable remote task.
      if (name !== 'tavily_research') cache.delete(key);
      throw error;
    }
  }
  return {
    tiandi_tongshou: tool(({ a, b }) => Number(a) + Number(b) + 100, {
      name: 'tiandi_tongshou', description: '天地同寿算法：给定两个数，返回两数之和再加 100',
      schema: z.object({ a: z.number().describe('第一个数'), b: z.number().describe('第二个数') }),
    }),
    tavily_search: tool(async ({ query }, config) => run('tavily_search', query, config.signal,
      () => tavilyRequest('/search', { query, max_results: 5, search_depth: 'basic', topic: 'general', include_answer: false }, config.signal)), {
      name: 'tavily_search', metadata: { readOnlyHint: true },
      description: `普通网页搜索，适合查证具体事实。全体 Agent 每轮共享最多 ${limits.tavily_search} 次查询；相同查询复用结果。优先使用此工具。`,
      schema: z.object({ query: z.string().describe('搜索查询') }),
    }),
    tavily_research: tool(async ({ query }, config) => run('tavily_research', query, config.signal, async () => {
      const queued = await tavilyRequest('/research', { input: query, stream: false, model: 'mini' }, config.signal);
      if (typeof queued.request_id !== 'string') return queued;
      return pollResearch(queued.request_id, config.signal);
    }), {
      name: 'tavily_research',
      description: `启动 Tavily 托管的付费深度研究，可能耗时数分钟且消耗大量额度；不是普通搜索。每轮共享最多 ${limits.tavily_research} 次。停止本地等待不能撤销已经提交的远程研究任务。`,
      schema: z.object({ query: z.string().describe('研究问题') }),
    }),
    tavily_crawl: tool(async ({ url }, config) => run('tavily_crawl', url, config.signal,
      () => tavilyRequest('/crawl', { url, max_depth: 1, max_breadth: 5, limit: 5 }, config.signal)), {
      name: 'tavily_crawl', metadata: { readOnlyHint: true },
      description: '抓取网站页面，每次最多 5 页；单个页面优先使用 tavily_extract。',
      schema: z.object({ url: z.string().url() }),
    }),
    tavily_extract: tool(async ({ url }, config) => run('tavily_extract', url, config.signal,
      () => tavilyRequest('/extract', { urls: [url], extract_depth: 'basic' }, config.signal)), {
      name: 'tavily_extract', metadata: { readOnlyHint: true }, description: '提取单个网页的文本内容。',
      schema: z.object({ url: z.string().url() }),
    }),
  } as const;
}

/** Names/schema for registry validation; execution uses a fresh catalog. */
export const systemToolCatalog = createSystemToolCatalog();
export type SystemTool = (typeof systemToolCatalog)[keyof typeof systemToolCatalog];
