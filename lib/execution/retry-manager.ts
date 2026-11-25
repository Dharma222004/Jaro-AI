// lib/execution/retry-manager.ts
// Controlled exponential backoff with AbortSignal and timeout enforcement for transient failures.

export async function runWithTimeoutAndRetry<T>(params: {
  fn: () => Promise<T>;
  timeoutMs: number;
  maxRetries: number;
  signal?: AbortSignal;
  isRetryable?: (err: unknown) => boolean;
}): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= params.maxRetries; attempt++) {
    if (params.signal?.aborted) {
      throw new DOMException('Tool execution aborted by client', 'AbortError');
    }

    try {
      return await withTimeout(params.fn, params.timeoutMs, params.signal);
    } catch (err) {
      lastError = err;
      if ((err as Error)?.name === 'AbortError' || params.signal?.aborted) {
        throw err;
      }
      const retryable = params.isRetryable ? params.isRetryable(err) : defaultIsRetryable(err);
      if (!retryable || attempt >= params.maxRetries) {
        throw err;
      }
      const backoffMs = 400 * 2 ** attempt + Math.floor(Math.random() * 150);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }

  throw lastError;
}

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`TOOL_TIMEOUT after ${timeoutMs}ms`));
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    fn()
      .then((res) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}

function defaultIsRetryable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (/invalid|missing|not found|unauthorized|forbidden|permission|validation|400|401|403|404|422/.test(msg)) {
    return false;
  }
  return /429|500|502|503|504|timeout|network|econnreset|etimedout/.test(msg);
}
