// lib/ai/model-router.ts
// Complexity-based intelligent model routing with configurable context budgets and safe fallbacks.

export type TaskComplexity = 'simple' | 'medium' | 'complex';

export interface ModelRouteSelection {
  tier: TaskComplexity;
  provider: 'nvidia' | 'groq';
  model: string;
  apiBase: string;
  hasApiKey: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  temperature: number;
  supportsStreaming: boolean;
  supportsJsonMode: boolean;
  rationale: string;
}

const SIMPLE_INTENTS = new Set([
  'financial_education',
  'project_context',
  'follow_up',
]);

const COMPLEX_INTENTS = new Set([
  'company_research',
  'fundamental_analysis',
  'investment_decision',
  'stock_comparison',
  'stock_screening',
  'stock_discovery',
  'sector_ranking',
]);

export function determineTaskComplexity(params: {
  intent?: string;
  query: string;
  companyCount?: number;
  hasDocuments?: boolean;
}): TaskComplexity {
  const { intent, query, companyCount = 0, hasDocuments = false } = params;

  if (companyCount >= 2 || hasDocuments || query.length > 500) {
    return 'complex';
  }
  if (intent && COMPLEX_INTENTS.has(intent)) {
    return 'complex';
  }
  if (intent && SIMPLE_INTENTS.has(intent) && companyCount === 0 && !/\bcompare|analyse|analyze|balance sheet|cash flow\b/i.test(query)) {
    return 'simple';
  }
  return 'medium';
}

export function getPrimaryProviderConfig() {
  const apiKey = process.env.NVIDIA_API_KEY?.trim() ?? '';
  const hasKey = Boolean(apiKey && apiKey !== 'your_nvidia_api_key_here');
  const apiBase = (process.env.NVIDIA_API_BASE ?? 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
  const defaultModel = process.env.NVIDIA_MODEL?.trim() || 'nvidia/nemotron-3-ultra-550b-a55b';
  const fastModel = process.env.NVIDIA_FAST_MODEL?.trim() || defaultModel;
  const reasoningModel = process.env.NVIDIA_REASONING_MODEL?.trim() || defaultModel;

  return { hasKey, apiBase, defaultModel, fastModel, reasoningModel };
}

export function getFallbackProviderConfig() {
  const apiKey = process.env.GROQ_API_KEY?.trim() ?? '';
  const hasKey = Boolean(apiKey && !apiKey.startsWith('your_'));
  const apiBase = (process.env.GROQ_API_BASE ?? 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  const model = process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile';
  return { hasKey, apiBase, model };
}

export function selectModel(params: {
  complexity: TaskComplexity;
  intent?: string;
  requiresJson?: boolean;
}): ModelRouteSelection {
  const primary = getPrimaryProviderConfig();

  if (params.complexity === 'simple') {
    return {
      tier: 'simple',
      provider: 'nvidia',
      model: primary.fastModel,
      apiBase: primary.apiBase,
      hasApiKey: primary.hasKey,
      maxContextTokens: 8192,
      maxOutputTokens: 1500,
      timeoutMs: 20_000,
      temperature: params.requiresJson ? 0.1 : 0.25,
      supportsStreaming: true,
      supportsJsonMode: true,
      rationale: 'Lightweight/fast route for simple Q&A, definitions, and query classification.',
    };
  }

  if (params.complexity === 'complex') {
    return {
      tier: 'complex',
      provider: 'nvidia',
      model: primary.reasoningModel,
      apiBase: primary.apiBase,
      hasApiKey: primary.hasKey,
      maxContextTokens: 65536,
      maxOutputTokens: 4800,
      timeoutMs: 120_000,
      temperature: params.requiresJson ? 0.15 : 0.15,
      supportsStreaming: true,
      supportsJsonMode: true,
      rationale: 'High-capability reasoning route for multi-source synthesis, comparisons, and institutional dossiers.',
    };
  }

  return {
    tier: 'medium',
    provider: 'nvidia',
    model: primary.defaultModel,
    apiBase: primary.apiBase,
    hasApiKey: primary.hasKey,
    maxContextTokens: 32768,
    maxOutputTokens: 3600,
    timeoutMs: 60_000,
    temperature: params.requiresJson ? 0.15 : 0.25,
    supportsStreaming: true,
    supportsJsonMode: true,
    rationale: 'Balanced route for targeted company analysis, planning, and technical explanation.',
  };
}

export function selectFallbackModel(tier: TaskComplexity): ModelRouteSelection | null {
  const fallback = getFallbackProviderConfig();
  if (!fallback.hasKey) return null;

  return {
    tier,
    provider: 'groq',
    model: fallback.model,
    apiBase: fallback.apiBase,
    hasApiKey: true,
    maxContextTokens: tier === 'simple' ? 8192 : 32768,
    maxOutputTokens: tier === 'simple' ? 1500 : 3600,
    timeoutMs: tier === 'complex' ? 90_000 : 45_000,
    temperature: 0.2,
    supportsStreaming: true,
    supportsJsonMode: true,
    rationale: 'Controlled secondary OpenAI-compatible fallback preserving tool-grounded evidence guarantees.',
  };
}
