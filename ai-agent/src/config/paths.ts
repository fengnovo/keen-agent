import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** ai-agent 包根目录；资源目录与源码目录相互独立。 */
export const AI_AGENT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Monorepo 根目录；共享的模型、插件和会话状态保存在这里。 */
export const REPOSITORY_ROOT = fileURLToPath(
  new URL('../../../', import.meta.url),
);

export const LOCAL_STATE_ROOT = join(REPOSITORY_ROOT, '.keen-agent');
export const SKILLS_ROOT = join(AI_AGENT_ROOT, '.skills');
export const MCP_ROOT = join(AI_AGENT_ROOT, '.mcp');
