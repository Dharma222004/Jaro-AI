import Groq from 'groq-sdk';
import {
  companyResolutionSystemPrompt,
  buildCompanyResolutionPrompt,
} from '@/prompts/company-resolution';
import {
  researchSystemPrompt,
  buildResearchAnalysisPrompt,
} from '@/prompts/research-system';
import type { CompanyIdentity, CompanyCandidate } from '@/types/company';
import type { ResearchReport } from '@/types/research';

// ---- Multi-key Groq client with round-robin rotation ----
// Supports up to 4 API keys for rate-limit resilience

let clientPool: Groq[] = [];
let currentKeyIndex = 0;

function buildClientPool(): Groq[] {
  const keys: string[] = [];

  // Primary key (required)
  const primary = process.env.GROQ_API_KEY;
  if (primary && primary !== 'your_groq_api_key_here') {
    keys.push(primary);
  }

  // Additional keys (optional)
  const extras = [
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
  ];

  for (const k of extras) {
    if (k && k.trim()) keys.push(k.trim());
  }

  if (keys.length === 0) {
    throw new Error(
      'No GROQ_API_KEY configured. Please add your Groq API key to .env.local'
    );
  }

  console.log(`[groq] Initialized client pool with ${keys.length} key(s)`);
  return keys.map((apiKey) => new Groq({ apiKey }));
}

function getGroqClient(): Groq {
  if (clientPool.length === 0) {
    clientPool = buildClientPool();
  }
  // Round-robin rotation
  const client = clientPool[currentKeyIndex % clientPool.length];
  currentKeyIndex = (currentKeyIndex + 1) % clientPool.length;
  return client;
}

function getModel(): string {
  return process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b';
}

// ---- Retry with key rotation on rate limit ----

async function withRetry<T>(
  fn: (client: Groq) => Promise<T>,
  maxAttempts?: number
): Promise<T> {
  const attempts = maxAttempts ?? Math.max(clientPool.length || 1, 2);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const client = getGroqClient();
    try {
      return await fn(client);
    } catch (err: unknown) {
      const isRateLimit =
        err instanceof Error &&
        (err.message.includes('429') ||
          err.message.toLowerCase().includes('rate limit') ||
          err.message.toLowerCase().includes('quota'));

      if (isRateLimit && attempt < attempts - 1) {
        console.warn(
          `[groq] Rate limit hit (attempt ${attempt + 1}/${attempts}), rotating to next key...`
        );
        continue;
      }
      throw err;
    }
  }
  throw new Error('[groq] All API keys exhausted or request failed');
}

// ---- Company Resolution ----

export interface CompanyResolutionResult {
  resolved: true;
  company: CompanyIdentity;
}

export interface CompanyAmbiguousResult {
  resolved: false;
  candidates: CompanyCandidate[];
}

export type CompanyResolutionResponse =
  | CompanyResolutionResult
  | CompanyAmbiguousResult;

export async function resolveCompany(
  query: string
): Promise<CompanyResolutionResponse> {
  return withRetry(async (client) => {
    const response = await client.chat.completions.create({
      model: getModel(),
      messages: [
        { role: 'system', content: companyResolutionSystemPrompt },
        { role: 'user', content: buildCompanyResolutionPrompt(query) },
      ],
      temperature: 0.1,
      max_tokens: 512,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty response from Groq');

    const parsed = JSON.parse(content);

    if (parsed.resolved && parsed.company) {
      return { resolved: true, company: parsed.company };
    }

    return {
      resolved: false,
      candidates: parsed.candidates ?? [],
    };
  });
}

export async function analyzeWithGroq(params: {
  systemPrompt: string;
  userPrompt: string;
}): Promise<Record<string, any>> {
  const model = getModel();
  return withRetry(async (client) => {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 3500,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty response from Groq');

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
  await withRetry(async (client) => {
    const stream = await client.chat.completions.create({
      model,
      messages: params.messages,
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 1500,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        params.onDelta(delta);
      }
    }
  });
}


