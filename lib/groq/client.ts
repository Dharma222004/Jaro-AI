// NVIDIA-compatible LLM client (OpenAI-compatible API)
// Configured to use a single dedicated NVIDIA API key and Nemotron reasoning model
// Env: NVIDIA_API_KEY, NVIDIA_API_BASE, NVIDIA_MODEL
import type { CompanyCandidate, CompanyIdentity } from '@/types/company';

function getApiKey(): string {
  const key = process.env.NVIDIA_API_KEY?.trim();
  if (!key || key === 'your_nvidia_api_key_here') {
    throw new Error('No NVIDIA_API_KEY configured. Please check .env.local');
  }
  return key;
}

function getModel(): string {
  return process.env.NVIDIA_MODEL?.trim() || 'nvidia/nemotron-3-ultra-550b-a55b';
}

const BASE = (process.env.NVIDIA_API_BASE ?? 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');

async function withRetry<T>(fn: (apiKey: string) => Promise<T>, max = 2): Promise<T> {
  const apiKey = getApiKey();
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await fn(apiKey);
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : '';
      const isTransient =
        msg.includes('429') ||
        msg.includes('500') ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('504') ||
        msg.toLowerCase().includes('timeout') ||
        msg.toLowerCase().includes('rate limit');

      if (isTransient && attempt < max - 1) {
        console.warn(`[nvidia] Request attempt ${attempt + 1} encountered transient issue (${msg}), retrying...`);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface CompanyResolutionResult { resolved: true; company: CompanyIdentity; }
export interface CompanyAmbiguousResult { resolved: false; candidates: CompanyCandidate[]; }
export type CompanyResolutionResponse = CompanyResolutionResult | CompanyAmbiguousResult;

export async function resolveCompany(query: string): Promise<CompanyResolutionResponse> {
  const model = getModel();
  const content = await withRetry(async (apiKey) => {
    const r = await timedFetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a company resolution assistant. Return JSON with resolved=true and company={name,ticker,exchange} or resolved=false and candidates=[].',
          },
          { role: 'user', content: query },
        ],
        temperature: 0.1,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      }),
    }, 25_000);

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error(`[nvidia] Request failed: ${r.status} ${body.slice(0, 200)}`);
      throw new Error(`HTTP ${r.status} ${body.slice(0, 200)}`);
    }
    const data = await r.json();
    return data.choices?.[0]?.message?.content ?? '';
  });

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
}): Promise<Record<string, unknown>> {
  const model = getModel();
  return withRetry(async (apiKey) => {
    const r = await timedFetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        temperature: 0.2,
        max_tokens: params.maxTokens ?? 4096,
        response_format: { type: 'json_object' },
      }),
    }, params.timeoutMs ?? 60_000);

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error(`[nvidia] Request failed: ${r.status} ${body.slice(0, 200)}`);
      throw new Error(`HTTP ${r.status} ${body.slice(0, 200)}`);
    }
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content) throw new Error('Empty response from NVIDIA');
    return JSON.parse(content);
  });
}

export async function streamChatWithGroq(params: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
  onDelta: (text: string) => void;
}): Promise<void> {
  const model = getModel();
  await withRetry(async (apiKey) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const r = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          model,
          messages: params.messages,
          temperature: params.temperature ?? 0.2,
          max_tokens: params.maxTokens ?? 4096,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!r.ok) {
        const body = await r.text().catch(() => '');
        console.error(`[nvidia] Streaming request failed: ${r.status} ${body.slice(0, 200)}`);
        throw new Error(`HTTP ${r.status} ${body.slice(0, 200)}`);
      }
      if (!r.body) throw new Error('NVIDIA returned an empty stream');

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
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
            // Nemotron outputs reasoning in delta.reasoning_content and final answer in delta.content
            const delta = data.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              params.onDelta(delta);
            }
          } catch {
            // Ignore non-JSON SSE comments or malformed chunks
          }
        }

        if (done) break;
      }
    } finally {
      clearTimeout(timeout);
    }
  });
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
