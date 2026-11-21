const UPSTOX_BASE_URL = 'https://api.upstox.com';

export type UpstoxErrorCategory =
  | 'token_missing'
  | 'authentication_failed'
  | 'endpoint_unsupported'
  | 'invalid_instrument'
  | 'rate_limited'
  | 'no_data'
  | 'stale_data'
  | 'timeout'
  | 'network_error'
  | 'provider_error'
  | 'unknown';

interface UpstoxRuntimeState {
  lastSuccessfulAt: string | null;
  lastSuccessfulEndpoint: string | null;
  lastErrorAt: string | null;
  lastErrorCategory: UpstoxErrorCategory | null;
  lastErrorCode: string | null;
  successfulRequests: number;
}

const globalState = globalThis as typeof globalThis & { __jaroUpstoxRuntime?: UpstoxRuntimeState };
const runtimeState = globalState.__jaroUpstoxRuntime ?? {
  lastSuccessfulAt: null,
  lastSuccessfulEndpoint: null,
  lastErrorAt: null,
  lastErrorCategory: null,
  lastErrorCode: null,
  successfulRequests: 0,
};
globalState.__jaroUpstoxRuntime = runtimeState;

export class UpstoxApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly retryable = false,
    public readonly category: UpstoxErrorCategory = 'provider_error',
  ) {
    super(message);
    this.name = 'UpstoxApiError';
  }
}

interface RequestOptions {
  timeoutMs?: number;
  retries?: number;
}

const TOKEN_ENV_KEYS = [
  'UPSTOX_ANALYTICS_TOKEN',
  // Backward-compatible aliases. New deployments should use only the canonical key above.
  'UPSTOX_ACCESS_TOKEN',
  'UPSTOX_TOKEN',
] as const;

export function getUpstoxConfiguration() {
  const configured = resolveToken();
  return {
    tokenConfigured: Boolean(configured),
    clientInitialized: Boolean(configured),
    configurationSource: configured?.key === 'UPSTOX_ANALYTICS_TOKEN' ? 'canonical' as const : configured ? 'legacy_alias' as const : null,
    expectedVariable: 'UPSTOX_ANALYTICS_TOKEN' as const,
  };
}

export function getUpstoxRuntimeStatus(): UpstoxRuntimeState {
  return { ...runtimeState };
}

export function toPublicUpstoxError(error: unknown) {
  if (error instanceof UpstoxApiError) {
    return {
      category: error.category,
      code: error.code ?? null,
      status: error.status,
      retryable: error.retryable,
      message: error.message,
    };
  }
  return {
    category: 'unknown' as const,
    code: null,
    status: 500,
    retryable: false,
    message: error instanceof Error ? error.message : 'Unknown Upstox integration error.',
  };
}

export async function upstoxGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const configured = resolveToken();
  if (!configured) {
    const error = new UpstoxApiError(
      'Upstox market-data credentials are not available in the backend environment.',
      503,
      'TOKEN_NOT_CONFIGURED',
      false,
      'token_missing',
    );
    recordError(error);
    throw error;
  }

  const timeoutMs = options.timeoutMs ?? 15_000;
  const retries = options.retries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${UPSTOX_BASE_URL}${path}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${configured.token}`,
        },
        signal: controller.signal,
        cache: 'no-store',
      });

      if (response.ok) {
        const data = await response.json() as T;
        recordSuccess(path);
        return data;
      }

      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      const errorEntry = Array.isArray(body.errors) ? body.errors[0] as Record<string, unknown> | undefined : undefined;
      const code = typeof errorEntry?.errorCode === 'string' ? errorEntry.errorCode : undefined;
      const rawMessage = typeof errorEntry?.message === 'string'
        ? errorEntry.message
        : typeof body.message === 'string' ? body.message : `Upstox request failed with status ${response.status}`;
      const providerMessage = sanitizeProviderMessage(rawMessage, configured.token);
      const category = classifyProviderError(response.status, code, providerMessage);
      const retryable = category === 'rate_limited' || response.status >= 500;
      const message = publicErrorMessage(category, providerMessage);
      const error = new UpstoxApiError(message, response.status, code, retryable, category);

      if (!retryable || attempt === retries) {
        recordError(error);
        throw error;
      }
      lastError = error;
    } catch (error) {
      if (error instanceof UpstoxApiError && !error.retryable) throw error;
      lastError = error;
      if (attempt === retries) break;
    } finally {
      clearTimeout(timeout);
    }
    await wait(300 * 2 ** attempt + Math.floor(Math.random() * 120));
  }

  if (lastError instanceof UpstoxApiError) {
    recordError(lastError);
    throw lastError;
  }
  if (lastError instanceof Error && lastError.name === 'AbortError') {
    const error = new UpstoxApiError('Upstox request timed out.', 504, 'TIMEOUT', true, 'timeout');
    recordError(error);
    throw error;
  }
  const error = new UpstoxApiError(
    'Upstox could not be reached after safe retries.',
    502,
    'NETWORK_REQUEST_FAILED',
    true,
    'network_error',
  );
  recordError(error);
  throw error;
}

function resolveToken(): { token: string; key: typeof TOKEN_ENV_KEYS[number] } | null {
  for (const key of TOKEN_ENV_KEYS) {
    const raw = process.env[key];
    if (!raw) continue;
    const token = raw.trim().replace(/^['"]|['"]$/g, '');
    if (!token || /^(?:YOUR_TOKEN|YOUR_[A-Z_]+|REPLACE_ME|PLACEHOLDER)$/i.test(token)) continue;
    return { token, key };
  }
  return null;
}

function classifyProviderError(status: number, code: string | undefined, message: string): UpstoxErrorCategory {
  const value = `${code ?? ''} ${message}`.toLowerCase();
  if (status === 401 || status === 403) return 'authentication_failed';
  if (status === 429) return 'rate_limited';
  if (/instrument|instrument_key|symbol/.test(value) && /invalid|not found|does not exist/.test(value)) return 'invalid_instrument';
  if (/not supported|unsupported|method not allowed/.test(value) || status === 405) return 'endpoint_unsupported';
  if (/no data|empty|no candle/.test(value)) return 'no_data';
  return 'provider_error';
}

function publicErrorMessage(category: UpstoxErrorCategory, fallback: string): string {
  if (category === 'authentication_failed') return 'Upstox rejected the configured credentials. Check the supported authentication method and token validity.';
  if (category === 'rate_limited') return 'Upstox rate-limited the market-data request. Retry after the provider window resets.';
  if (category === 'invalid_instrument') return 'Could not resolve the selected stock to a valid exchange instrument.';
  if (category === 'endpoint_unsupported') return 'The configured Upstox credential does not support the requested endpoint.';
  if (category === 'no_data') return 'No validated market data was returned for the requested instrument and timeframe.';
  if (category === 'stale_data') return 'Available market data is older than the required freshness threshold.';
  return fallback || 'Upstox market data is currently unavailable.';
}

function sanitizeProviderMessage(message: string, token: string) {
  return message.replaceAll(token, '[redacted]').slice(0, 500);
}

function recordSuccess(path: string) {
  runtimeState.lastSuccessfulAt = new Date().toISOString();
  runtimeState.lastSuccessfulEndpoint = path.split('?')[0];
  runtimeState.lastErrorAt = null;
  runtimeState.lastErrorCategory = null;
  runtimeState.lastErrorCode = null;
  runtimeState.successfulRequests += 1;
}

function recordError(error: UpstoxApiError) {
  runtimeState.lastErrorAt = new Date().toISOString();
  runtimeState.lastErrorCategory = error.category;
  runtimeState.lastErrorCode = error.code ?? null;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
