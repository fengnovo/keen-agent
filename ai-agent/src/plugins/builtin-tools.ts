import { tool } from '@langchain/core/tools';
import {
  TavilyResearch,
  TavilyGetResearch,
  TavilyCrawl,
  TavilyExtract,
  TavilySearch,
} from '@langchain/tavily';
import { z } from 'zod';

/**
 * 系统工具注册表。
 * 外部配置只能引用这里登记的实现标识，不能通过管理页面注入 TypeScript。
 */
export const systemToolCatalog = {
  tiandi_tongshou: tool(({ a, b }) => Number(a) + Number(b) + 100, {
    // 部分 Anthropic 兼容接口只接受 ASCII 工具名。
    name: 'tiandi_tongshou',
    description: '天地同寿算法：给定两个数，返回两数之和再加 100',
    schema: z.object({
      a: z.number().describe('第一个数'),
      b: z.number().describe('第二个数'),
    }),
  }),
  tavily_search: tool(
    async ({ query }) => {
      const search = new TavilySearch({
        maxResults: 5, // 返回结果数量[reference:19]
        searchDepth: 'basic', // 或 "advanced"[reference:20]
        topic: 'general', // 搜索主题: "general" | "news" | "finance"[reference:21]
        includeAnswer: false, // 是否包含AI生成的摘要答案[reference:22]
      });
      // TavilySearch 本身就是 StructuredTool，通过 invoke 调用
      return await search.invoke({ query });
    },
    {
      name: 'tavily_search',
      description: 'Tavily 搜索工具：用于进行网络搜索',
      schema: z.object({
        query: z.string().describe('搜索查询'),
      }),
    },
  ),
  tavily_research: tool(
    async ({ query }) => {
      // 非流式模式：先创建研究任务拿到 request_id，再轮询直到研究完成
      const research = new TavilyResearch({
        stream: false,
      });
      const queued = await research.invoke({ input: query, stream: false });
      if (!('request_id' in queued)) {
        return queued;
      }
      const getResearch = new TavilyGetResearch();
      const maxAttempts = 50; // 每 5 秒轮询一次，最长约 4 分钟
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const result = await getResearch.invoke({
          requestId: queued.request_id,
        });
        if ('error' in result) {
          return result;
        }
        if (result.status === 'completed' || result.status === 'failed') {
          return result;
        }
      }
      return {
        request_id: queued.request_id,
        status: 'timeout',
        message: '研究任务超时，请稍后使用 request_id 重新查询研究结果',
      };
    },
    {
      name: 'tavily_research',
      description: 'Tavily 研究工具：用于进行网络研究，流式输出结果',
      schema: z.object({
        query: z.string().describe('研究查询'),
      }),
    },
  ),
  tavily_crawl: tool(
    async ({ url }) => {
      const crawl = new TavilyCrawl({
        maxDepth: 2, // 最大爬取深度[reference:24]
        maxBreadth: 20, // 每层最大页面数[reference:25]
        limit: 50, // 总页面数上限[reference:26]
      });
      // TavilyCrawl 本身就是 StructuredTool，通过 invoke 调用
      return await crawl.invoke({ url });
    },
    {
      name: 'tavily_crawl',
      description: 'Tavily 爬虫工具：用于抓取网页内容',
      schema: z.object({
        url: z.string().url().describe('要抓取的网页 URL'),
      }),
    },
  ),
  tavily_extract: tool(
    async ({ url }) => {
      const extract = new TavilyExtract({
        extractDepth: 'basic', // 或 "advanced"[reference:23]
      });
      // TavilyExtract 入参为 urls 数组
      return await extract.invoke({ urls: [url] });
    },
    {
      name: 'tavily_extract',
      description: 'Tavily 提取工具：用于从网页中提取文本内容',
      schema: z.object({
        url: z.string().url().describe('要提取内容的网页 URL'),
      }),
    },
  ),
} as const;

export type SystemTool =
  (typeof systemToolCatalog)[keyof typeof systemToolCatalog];
