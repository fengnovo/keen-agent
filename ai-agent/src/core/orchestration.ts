import { modelRetryMiddleware } from 'langchain';

const TRANSIENT_ERROR_PATTERN =
  /(?:terminated|econnreset|econnrefused|econnaborted|etimedout|ehostunreach|enotfound|epipe|socket hang up|fetch failed|network error|connection ?error|connection reset|premature close|other side closed|und_err_socket|timeout|timed out|rate.?limit|too many requests|overloaded|bad gateway|service unavailable|gateway timeout)/i;
const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

/** Only retry transient model failures, never replay a whole worker's side effects. */
export const isTransientSubagentError = (error: Error): boolean => {
  if (error.name === 'AbortError') return false;
  let current: unknown = error;
  const visited = new Set<unknown>();
  for (let depth = 0; depth < 5 && current; depth++) {
    if (visited.has(current)) break;
    visited.add(current);
    if (typeof current === 'object') {
      const record = current as Record<string, unknown>;
      const status = Number(record.status ?? record.statusCode);
      if (Number.isFinite(status) && status >= 400) return TRANSIENT_STATUS_CODES.has(status);
      const searchable = [record.name, record.message, record.code].filter(v => typeof v === 'string').join(' ');
      if (TRANSIENT_ERROR_PATTERN.test(searchable)) return true;
      current = record.cause;
    } else return TRANSIENT_ERROR_PATTERN.test(String(current));
  }
  return false;
};

export const createSubagentModelRetryMiddleware = (maxRetries = 2) =>
  modelRetryMiddleware({
    maxRetries: Number.isFinite(maxRetries) && maxRetries >= 0 ? Math.floor(maxRetries) : 2,
    retryOn: isTransientSubagentError,
    initialDelayMs: 1_000, backoffFactor: 2, maxDelayMs: 4_000, jitter: true,
    onFailure: 'error',
  });
