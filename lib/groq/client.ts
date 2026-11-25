// NVIDIA-compatible LLM client (OpenAI-compatible API)
// Integrates intelligent model routing, secret redaction, clean cancellation, and safe fallback support.
import type { CompanyCandidate, CompanyIdentity } from '@/types/company';
import { getFallbackProviderConfig, getPrimaryProviderConfig, selectModel } from '@/lib/ai/model-router';
import { redactSecrets } from '@/lib/security/redactor';
import { validateSafeExternalUrl } from '@/lib/security/input-guard';

interface ProviderCredentials {
  provider: 'nvidia' | 'groq';
  apiKey: string;
  apiBase: string;
  model: string;
}

function resolveProviderCredentials(overrides?: {
  model?: string;
  apiBase?: string;
  provider?: 'nvidia' | 'groq';
}): ProviderCredentials {
  if (overrides?.provider === 'groq') {
    const fb = getFallbackProviderConfig();
    if (!fb.hasKey) {
      throw new Error('Fallback LLM provider credentials are not configured.');
    }
    const urlCheck = validateSafeExternalUrl(fb.apiBase);
    if (!urlCheck.valid) throw new Error('Invalid LLM endpoint configuration.');
    return {
      provider: 'groq',
      apiKey: process.env.GROQ_API_KEY!.trim(),
      apiBase: fb.apiBase,
      model: overrides.model || fb.model,
    };
  }

  const primary = getPrimaryProviderConfig();
  const key = process.env.NVIDIA_API_KEY?.trim();
  if (!key || !primary.hasKey) {
    throw new Error('Primary LLM provider credentials (NVIDIA_API_KEY) are not configured.');
  }
  const base = (overrides?.apiBase ?? primary.apiBase).replace(/\/$/, '');
  const urlCheck = validateSafeExternalUrl(base);
  if (!urlCheck.valid) {
    throw new Error('Unsafe or invalid LLM API base URL configuration.');
  }
  return {
    provider: 'nvidia',
    apiKey: key,
    apiBase: base,
    model: overrides?.model || primary.defaultModel,
  };
}

async function withRetry<T>(
  fn: (creds: ProviderCredentials) => Promise<T>,
  options: { model?: string; maxAttempts?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const max = options.maxAttempts ?? 2;
  const creds = resolveProviderCredentials({ model: options.model });
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < max; attempt++) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      return await fn(creds);
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError' || options.signal?.aborted) {
        throw err;
      }
      lastErr = err;
      const msg = redactSecrets(err instanceof Error ? err.message : '');
      const isTransient =
        msg.includes('429') ||
        msg.includes('500') ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('504') ||
        msg.toLowerCase().includes('timeout') ||
        msg.toLowerCase().includes('rate limit');

      if (isTransient && attempt < max - 1) {
        console.warn(`[llm:${creds.provider}] Attempt ${attempt + 1} transient error (${msg}), retrying...`);
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      break;
    }
  }

  // Controlled secondary provider fallback only when explicitly configured
  const fallback = getFallbackProviderConfig();
  if (fallback.hasKey && !options.signal?.aborted) {
    try {
      const fbCreds = resolveProviderCredentials({ provider: 'groq' });
      console.warn(`[llm] Falling back to secondary provider (${fbCreds.model})`);
      return await fn(fbCreds);
    } catch (fbErr) {
      lastErr = fbErr;
    }
  }

  throw lastErr instanceof Error ? new Error(redactSecrets(lastErr.message)) : new Error('LLM request failed.');
}

export interface CompanyResolutionResult { resolved: true; company: CompanyIdentity; }
export interface CompanyAmbiguousResult { resolved: false; candidates: CompanyCandidate[]; }
export type CompanyResolutionResponse = CompanyResolutionResult | CompanyAmbiguousResult;

export async function resolveCompany(query: string): Promise<CompanyResolutionResponse> {
  const route = selectModel({ complexity: 'simple', requiresJson: true });
  const content = await withRetry(async (creds) => {
    const r = await timedFetch(`${creds.apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${creds.apiKey}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        model: creds.model,
        messages: [
          {
            role: 'system',
            content: 'You are a company resolution assistant. Return JSON with resolved=true and company={name,ticker,exchange} or resolved=false and candidates=[].',
          },
          { role: 'user', content: query.slice(0, 500) },
        ],
        temperature: 0.1,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      }),
    }, 25_000);

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error(`[llm:${creds.provider}] Company resolution failed: ${r.status} ${redactSecrets(body).slice(0, 200)}`);
      throw new Error(`HTTP ${r.status}`);
    }
    const data = await r.json();
    return data.choices?.[0]?.message?.content ?? '';
  }, { model: route.model });

  const cleaned = (content ?? '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.resolved && parsed.company) return { resolved: true, company: parsed.company };
    return { resolved: false, candidates: parsed.candidates ?? [] };
  } catch {
    return { resolved: false, candidates: [] };
  }
}

export async function analyzeWithGroq(params: {
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  return withRetry(async (creds) => {
    const r = await timedFetch(`${creds.apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${creds.apiKey}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        model: creds.model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        temperature: 0.2,
        max_tokens: params.maxTokens ?? 4096,
        response_format: { type: 'json_object' },
      }),
    }, params.timeoutMs ?? 60_000, params.signal);

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error(`[llm:${creds.provider}] Analysis failed: ${r.status} ${redactSecrets(body).slice(0, 200)}`);
      throw new Error(`HTTP ${r.status}`);
    }
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content) throw new Error('Empty response from LLM provider');
    return JSON.parse(content);
  }, { model: params.model, signal: params.signal });
}

export async function streamChatWithGroq(params: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<void> {
  await withRetry(async (creds) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    const onExternalAbort = () => controller.abort();
    params.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const r = await fetch(`${creds.apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${creds.apiKey}`,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          model: creds.model,
          messages: params.messages,
          temperature: params.temperature ?? 0.2,
          max_tokens: params.maxTokens ?? 4096,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!r.ok) {
        const body = await r.text().catch(() => '');
        console.error(`[llm:${creds.provider}] Streaming failed: ${r.status} ${redactSecrets(body).slice(0, 200)}`);
        throw new Error(`HTTP ${r.status}`);
      }
      if (!r.body) throw new Error('LLM provider returned an empty stream');

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (controller.signal.aborted) break;
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          try {
            const data = JSON.parse(payload);
            const delta = data.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              params.onDelta(delta);
            }
          } catch {
            // Ignore non-JSON SSE comments
          }
        }

        if (done) break;
      }
    } finally {
      clearTimeout(timeout);
      params.signal?.removeEventListener('abort', onExternalAbort);
    }
  }, { model: params.model, signal: params.signal });
}

async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
