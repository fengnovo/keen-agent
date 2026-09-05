import { setTimeout as sleep } from 'node:timers/promises';

/**
 * 已安装的 Tavily SDK 不会将 AbortSignal 传递给 fetch 请求。
 * 请在 HTTP 边界处取消请求，并且只需跟踪一次公共工具，而不是每次轮询都跟踪。
 */
export async function tavilyRequest(
  path: string,
  body: Record<string, unknown> | undefined,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  signal?.throwIfAborted();
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('缺少 TAVILY_API_KEY');
  const response = await fetch(`https://api.tavily.com${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(60_000),
    ]),
  });
  if (!response.ok)
    throw new Error(`Tavily 请求失败（HTTP ${response.status}）`);
  return response.json();
}

export async function pollResearch(
  requestId: string,
  signal?: AbortSignal,
  request = tavilyRequest,
  intervalMs = 5_000,
  maxAttempts = 50,
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(intervalMs, undefined, { signal });
    signal?.throwIfAborted();
    const result = await request(
      `/research/${encodeURIComponent(requestId)}`,
      undefined,
      signal,
    );
    if (
      result.error ||
      result.status === 'completed' ||
      result.status === 'failed'
    )
      return result;
  }
  return {
    request_id: requestId,
    status: 'timeout',
    message:
      '研究仍在 Tavily 端执行，本地已停止等待。不要重复创建同一研究任务。',
  };
}

export function readCallLimit(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} 必须是非负整数`);
  return value;
}
