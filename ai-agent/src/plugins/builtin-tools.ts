import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 系统工具注册表。
 * 外部配置只能引用这里登记的实现标识，不能通过管理页面注入 TypeScript。
 */
export const systemToolCatalog = {
  tiandi_tongshou: tool(
    ({ a, b }) => Number(a) + Number(b) + 100,
    {
      // 部分 Anthropic 兼容接口只接受 ASCII 工具名。
      name: 'tiandi_tongshou',
      description: '天地同寿算法：给定两个数，返回两数之和再加 100',
      schema: z.object({
        a: z.number().describe('第一个数'),
        b: z.number().describe('第二个数'),
      }),
    },
  ),
} as const;

export type SystemTool =
  (typeof systemToolCatalog)[keyof typeof systemToolCatalog];
