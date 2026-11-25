// lib/ai/orchestrator/request-pipeline.ts
// Stage 1-3: Request parsing, validation, authentication verification, rate limiting, and injection protection.

import type { NextRequest } from 'next/server';
import { resolveRequestAuth, enforceRouteRateLimit, type AuthContext } from '@/lib/security/auth';
import { assessPromptInjection, sanitizeUserMessage } from '@/lib/security/input-guard';
import { recordSecurityAudit } from '@/lib/security/audit-logger';
import type { ConversationContext, ConversationHistoryMessage } from '@/types/conversation';

export interface ValidatedChatRequest {
  requestId: string;
  messageId: string;
  conversationId: string;
  sourceMessageId?: string;
  query: string;
  history: ConversationHistoryMessage[];
  context: ConversationContext;
  memoryEnabled: boolean;
  auth: AuthContext;
  injectionFlagged: boolean;
  injectionReasons: string[];
}

export type RequestPipelineResult =
  | { ok: true; value: ValidatedChatRequest }
  | { ok: false; status: number; error: string; headers?: Record<string, string> };

export async function validateAndPrepareRequest(request: NextRequest): Promise<RequestPipelineResult> {
  const requestId = crypto.randomUUID();
  const messageId = crypto.randomUUID();

  let auth: AuthContext;
  try {
    auth = resolveRequestAuth(request);
  } catch {
    return { ok: false, status: 401, error: 'Invalid authentication session credentials.' };
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON request payload.' };
  }

  const rawQuery =
    typeof body.message === 'string' && body.message.trim() ? body.message :
    typeof body.query === 'string' && body.query.trim() ? body.query :
    typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt :
    typeof body.text === 'string' && body.text.trim() ? body.text :
    typeof body.content === 'string' && body.content.trim() ? body.content :
    '';

  const msgCheck = sanitizeUserMessage(rawQuery, 2000);
  if (!msgCheck.valid) {
    return { ok: false, status: 400, error: msgCheck.error ?? 'A message or question is required.' };
  }

  // Tiered rate limit check (lighter limit for greetings/short queries vs deeper research)
  const isLikelySimple = msgCheck.text.length < 40 && /^(hi|hello|hey|thanks|thank you|what is|explain)\b/i.test(msgCheck.text);
  const limit = enforceRouteRateLimit({
    request,
    bucket: isLikelySimple ? 'chat_simple' : 'chat_research',
    auth,
    requestId,
  });
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Too many requests in a short window. Please retry shortly.',
      headers: { 'Retry-After': String(limit.retryAfterSec) },
    };
  }

  // Prompt injection / SQLi / XSS protection
  const injection = assessPromptInjection(msgCheck.text, 'user');
  if (injection.severity === 'high') {
    await recordSecurityAudit({
      ownerKey: auth.ownerKey,
      eventType: 'security_guard',
      action: 'high_risk_prompt_injection_blocked',
      resource: '/api/chat',
      status: 'blocked',
      requestId,
      clientIp: auth.clientIp,
      metadata: { reasons: injection.reasons },
    });
    return {
      ok: false,
      status: 400,
      error: 'Request contains disallowed control or script instructions and cannot be processed.',
    };
  }

  const history: ConversationHistoryMessage[] = Array.isArray(body.history)
    ? body.history
        .filter((message: unknown): message is ConversationHistoryMessage => {
          if (!message || typeof message !== 'object') return false;
          const item = message as Record<string, unknown>;
          return (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string';
        })
        .slice(-10)
        .map((message) => ({
          role: message.role,
          content: assessPromptInjection(message.content.slice(0, 8_000), 'user').sanitized,
        }))
    : [];

  const rawConvId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
  const conversationId = /^[a-zA-Z0-9_-]{8,120}$/.test(rawConvId) ? rawConvId : crypto.randomUUID();
  const sourceMessageId = typeof body.sourceMessageId === 'string' ? body.sourceMessageId.slice(0, 120) : undefined;

  // Never trust unauthenticated body.memoryIdentity over verified auth header/cookie
  const memoryEnabled = auth.authenticated && body.memoryEnabled !== false;

  return {
    ok: true,
    value: {
      requestId,
      messageId,
      conversationId,
      sourceMessageId,
      query: injection.sanitized,
      history,
      context: sanitizeContext(body.context),
      memoryEnabled,
      auth,
      injectionFlagged: injection.flagged,
      injectionReasons: injection.reasons,
    },
  };
}

export function sanitizeContext(value: unknown): ConversationContext {
  if (!value || typeof value !== 'object') return { activeCompanies: [], reports: {} };
  const raw = value as Partial<ConversationContext>;
  const activeCompanies = Array.isArray(raw.activeCompanies)
    ? raw.activeCompanies
        .filter((company) => company && typeof company.name === 'string' && typeof company.ticker === 'string')
        .slice(0, 4)
    : [];
  const reports =
    raw.reports && typeof raw.reports === 'object'
      ? Object.fromEntries(Object.entries(raw.reports).slice(0, 4))
      : {};
  return {
    activeCompanies,
    activeSector: typeof raw.activeSector === 'string' ? raw.activeSector.slice(0, 100) : null,
    lastIntent: raw.lastIntent,
    reports,
    lastComparisonTickers: Array.isArray(raw.lastComparisonTickers) ? raw.lastComparisonTickers.slice(0, 4) : [],
    investorProfile: raw.investorProfile && typeof raw.investorProfile === 'object' ? raw.investorProfile : undefined,
    lastDecision: raw.lastDecision && typeof raw.lastDecision === 'object' ? raw.lastDecision : undefined,
    selectedTimeframe: typeof raw.selectedTimeframe === 'string' ? raw.selectedTimeframe.slice(0, 30) : null,
    currentTask: typeof raw.currentTask === 'string' ? raw.currentTask.slice(0, 120) : null,
    activeAssumptions: Array.isArray(raw.activeAssumptions)
      ? raw.activeAssumptions.filter((item): item is string => typeof item === 'string').slice(0, 12)
      : [],
    pendingClarifications: Array.isArray(raw.pendingClarifications)
      ? raw.pendingClarifications.filter((item): item is string => typeof item === 'string').slice(0, 8)
      : [],
    conversationSummary: typeof raw.conversationSummary === 'string' ? raw.conversationSummary.slice(0, 3500) : undefined,
  };
}
