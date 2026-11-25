// lib/ai/orchestrator/orchestrator.ts
// Central JARO AI Orchestration Engine managing the full end-to-end request lifecycle.

import { buildManagedContext } from '@/lib/ai/context-manager';
import { planExecutionTask } from './task-classifier';
import { buildStructuredResponseEnvelope } from './response-builder';
import { validateAndSanitizeFinalResponse } from './response-validator';
import { runConversationalResearch } from '@/lib/research/conversational-orchestrator';
import { evaluateResearchSources } from '@/lib/research/evaluation';
import { applyMemoryHints } from '@/lib/memory/policy';
import { appendMessage, upsertConversation } from '@/lib/memory/conversation-store';
import { extractAndStoreMemories } from '@/lib/memory/extraction';
import { recordStrategySignal } from '@/lib/strategy/journal';
import { recordSecurityAudit } from '@/lib/security/audit-logger';
import { safePublicError } from '@/lib/security/redactor';
import { formatIstDateTime } from '@/lib/validation/financial-accuracy';
import type { DataFreshnessState, ToolProvenance } from '@/lib/execution/tool-schemas';
import type {
  ConversationArtifact,
  ConversationContext,
  QueryClassification,
} from '@/types/conversation';
import type { ResearchSourceMeta } from '@/types/research';
import type { ValidatedChatRequest } from './request-pipeline';

export type OrchestratorEventEmitter = (event: Record<string, unknown>) => void;

export async function executeChatOrchestration(params: {
  request: ValidatedChatRequest;
  signal?: AbortSignal;
  emit: OrchestratorEventEmitter;
}): Promise<void> {
  const { request: req, signal, emit } = params;
  const startedAt = Date.now();

  let latestContext: ConversationContext = req.context;
  let classification: QueryClassification | undefined;
  let latestArtifact: ConversationArtifact | undefined;
  let latestSources: ResearchSourceMeta[] = [];
  let latestSuggestions: string[] = [];
  let accumulatedResponse = '';
  let generationStartedEmitted = false;
  const provenanceList: ToolProvenance[] = [];
  const toolSummaries: Array<{ toolName: string; status: string; provider: string; durationMs: number }> = [];

  try {
    // 1. Request Started
    emit({
      type: 'request_started',
      requestId: req.requestId,
      messageId: req.messageId,
      conversationId: req.conversationId,
      timestamp: new Date().toISOString(),
    });

    // 2. Context, Memory & Financial Knowledge Retrieval (3-Layer Context + Hybrid RAG)
    emit({
      type: 'context_retrieval_started',
      requestId: req.requestId,
      messageId: req.messageId,
    });
    emit({
      type: 'stage',
      stage: { id: 'context_retrieval', status: 'running', detail: 'Hydrating conversation history, memory, and financial documents' },
      status: 'running',
      detail: 'Hydrating conversation history, memory, and financial documents',
    });

    const managed = await buildManagedContext({
      identity: req.auth.identity,
      conversationId: req.conversationId,
      query: req.query,
      clientHistory: req.history,
      clientContext: req.context,
      memoryEnabled: req.memoryEnabled,
    });

    latestContext = managed.retrievedMemories.length > 0
      ? applyMemoryHints(managed.context, managed.retrievedMemories)
      : managed.context;

    emit({
      type: 'stage',
      stage: {
        id: 'context_retrieval',
        status: 'completed',
        detail: `${managed.history.length} recent turns · ${managed.retrievedMemories.length} memories · ${managed.knowledgeResult.passages.length} knowledge passages`,
      },
      status: 'completed',
      detail: `${managed.history.length} recent turns · ${managed.retrievedMemories.length} memories · ${managed.knowledgeResult.passages.length} knowledge passages`,
    });

    // 3. Intent Classification, Execution Path & Intelligent Model Selection
    emit({
      type: 'planning_started',
      requestId: req.requestId,
      messageId: req.messageId,
    });

    const planned = await planExecutionTask({
      query: req.query,
      context: latestContext,
      hasDocuments: managed.knowledgeResult.passages.length > 0,
    });
    classification = planned.classification;

    emit({ type: 'intent', classification: planned.classification });
    emit({
      type: 'stage',
      stage: {
        id: 'planning',
        status: 'completed',
        detail: `Path: ${planned.path.replaceAll('_', ' ')} · Model tier: ${planned.modelRoute.tier}`,
      },
      status: 'completed',
      detail: `Path: ${planned.path.replaceAll('_', ' ')} · Model tier: ${planned.modelRoute.tier}`,
    });

    // 4. Controlled Execution & Response Generation
    await runConversationalResearch({
      query: req.query,
      history: managed.history,
      context: latestContext,
      signal,
      principal: {
        authenticated: req.auth.authenticated,
        identity: req.auth.identity,
        ownerKey: req.auth.ownerKey,
        clientIp: req.auth.clientIp,
        requestId: req.requestId,
      },
      model: planned.modelRoute.model,
      conversationSummary: managed.conversationSummary,
      knowledgeContext: managed.knowledgeResult.formattedEvidence,
      longTermPreferences: managed.longTermPreferencesText,
      plannedClassification: planned.isGreeting ? undefined : planned.classification,
      callbacks: {
        onStage: (stage, status, detail) =>
          emit({
            type: 'stage',
            requestId: req.requestId,
            stage: { id: stage, status, detail },
            status,
            detail,
          }),
        onIntent: (nextClassification) => {
          classification = nextClassification;
          emit({ type: 'intent', requestId: req.requestId, classification: nextClassification });
        },
        onContext: (nextContext) => {
          latestContext = nextContext;
          emit({ type: 'context', requestId: req.requestId, context: nextContext });
        },
        onSources: (sources) => {
          latestSources = sources;
          emit({ type: 'sources', requestId: req.requestId, sources });
          try {
            const evalResult = evaluateResearchSources({ sources, query: req.query });
            emit({ type: 'research_eval', requestId: req.requestId, evaluation: evalResult });
          } catch {
            // Non-fatal
          }
        },
        onArtifact: (artifact) => {
          latestArtifact = artifact;
          emit({ type: 'artifact', requestId: req.requestId, artifact });
        },
        onToolStarted: (toolName, detail) => {
          emit({
            type: 'tool_execution_started',
            requestId: req.requestId,
            messageId: req.messageId,
            toolName,
            detail,
          });
        },
        onToolCompleted: (toolName, envelope) => {
          provenanceList.push(envelope.provenance);
          toolSummaries.push({
            toolName,
            status: envelope.status,
            provider: envelope.provenance.provider,
            durationMs: envelope.durationMs,
          });
          emit({
            type: 'tool_execution_completed',
            requestId: req.requestId,
            messageId: req.messageId,
            toolName,
            status: envelope.status,
            durationMs: envelope.durationMs,
            provenance: envelope.provenance,
          });
        },
        onSuggestions: (suggestions) => {
          latestSuggestions = suggestions;
          emit({ type: 'suggestions', requestId: req.requestId, suggestions });
        },
        onDelta: (delta: string) => {
          if (!generationStartedEmitted) {
            generationStartedEmitted = true;
            emit({
              type: 'response_generation_started',
              requestId: req.requestId,
              messageId: req.messageId,
            });
          }
          accumulatedResponse += delta;
          emit({
            type: 'response_text_delta',
            requestId: req.requestId,
            messageId: req.messageId,
            delta,
            text: delta,
          });
        },
      },
    });

    if (signal?.aborted) {
      return;
    }

    // 5. Financial Accuracy & Compliance Validation
    const inferredFreshness: DataFreshnessState =
      latestArtifact?.kind === 'investment_decision'
        ? normalizeFreshness(latestArtifact.result.marketDataStatus)
        : latestArtifact?.kind === 'technical_analysis'
          ? normalizeFreshness(latestArtifact.result.dataStatus)
          : provenanceList.find((p) => p.dataFreshness !== 'unavailable')?.dataFreshness ?? 'end_of_day';

    const evidenceDigest = [
      managed.knowledgeResult.formattedEvidence,
      ...latestContext.activeCompanies.map((c) => JSON.stringify(latestContext.reports?.[c.ticker] ?? {}).slice(0, 6000)),
    ].join('\n');

    const validation = validateAndSanitizeFinalResponse({
      text: accumulatedResponse,
      evidenceText: evidenceDigest,
      sources: latestSources,
      freshness: inferredFreshness,
      isResearchResponse: planned.requiresResearchTools,
    });

    // If post-validation produced an additional limitation warning not yet streamed, stream it cleanly
    if (!validation.passed && validation.warnings.length > 0 && accumulatedResponse.length > 0) {
      const note = `\n\n> **Verification Note:** ${validation.warnings[0]}`;
      accumulatedResponse += note;
      emit({
        type: 'response_text_delta',
        requestId: req.requestId,
        messageId: req.messageId,
        delta: note,
        text: note,
      });
    }

    const activePrimary = latestContext.activeCompanies[0];
    const responseEnvelope = buildStructuredResponseEnvelope({
      intent: classification?.intent ?? 'company_research',
      companyName: activePrimary?.name ?? null,
      ticker: activePrimary?.ticker ?? null,
      exchange: activePrimary?.exchange ?? null,
      marketDataStatus: inferredFreshness,
      dataTimestamp:
        latestArtifact?.kind === 'investment_decision'
          ? latestArtifact.result.marketTimestamp
          : latestArtifact?.kind === 'technical_analysis'
            ? latestArtifact.result.lastCandleAt
            : new Date().toISOString(),
      sources: latestSources,
      provenanceList,
      limitations: validation.warnings,
    });

    // 6. Conversation Persistence & Memory Extraction (strictly user-isolated)
    if (req.auth.authenticated && req.auth.identity) {
      try {
        const entityTickers = latestContext.activeCompanies.map((c) => c.ticker);
        await upsertConversation(req.auth.identity, {
          conversationId: req.conversationId,
          title: entityTickers.length ? `${entityTickers.join(' / ')} — ${req.query.slice(0, 80)}` : req.query.slice(0, 120),
          entities: entityTickers,
        });

        await appendMessage(req.auth.identity, {
          conversationId: req.conversationId,
          requestId: req.requestId,
          role: 'user',
          content: req.query,
          intent: classification?.intent,
        }).catch(() => {});

        await appendMessage(req.auth.identity, {
          conversationId: req.conversationId,
          requestId: req.requestId,
          role: 'assistant',
          content: validation.sanitizedText || (latestArtifact?.kind ? `Generated ${latestArtifact.kind} analysis.` : 'Response completed.'),
          intent: classification?.intent,
          toolResults: toolSummaries.length ? toolSummaries : undefined,
          stageJson: classification,
        }).catch(() => {});

        if (req.memoryEnabled) {
          await extractAndStoreMemories({
            identity: req.auth.identity,
            query: req.query,
            response: validation.sanitizedText.slice(0, 1500),
            conversationId: req.conversationId,
            sourceMessageId: req.sourceMessageId ?? req.messageId,
            classification,
            context: latestContext,
          });
        }

        if (latestArtifact?.kind === 'investment_decision') {
          await recordStrategySignal(req.auth.identity, latestArtifact.result).catch(() => null);
        }
      } catch (persistErr) {
        console.warn('[orchestrator] Non-fatal persistence error:', safePublicError(persistErr));
      }
    }

    const completedAt = new Date().toISOString();
    emit({
      type: 'request_completed',
      requestId: req.requestId,
      messageId: req.messageId,
      conversationId: req.conversationId,
      dataTimestamp: completedAt,
      dataTimestampIst: formatIstDateTime(completedAt),
      durationMs: Date.now() - startedAt,
      intent: classification?.intent,
      artifact: latestArtifact,
      suggestions: latestSuggestions,
      responseEnvelope,
      validationWarnings: validation.warnings,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError' || signal?.aborted) {
      return;
    }
    const safeMsg = safePublicError(error, 'Research could not be completed.');
    await recordSecurityAudit({
      ownerKey: req.auth.ownerKey,
      eventType: 'provider_failure',
      action: 'chat_orchestration_failed',
      resource: '/api/chat',
      status: 'error',
      requestId: req.requestId,
      clientIp: req.auth.clientIp,
      metadata: { error: safeMsg },
    });
    emit({
      type: 'request_failed',
      requestId: req.requestId,
      messageId: req.messageId,
      error: safeMsg,
      message: safeMsg,
    });
  }
}

function normalizeFreshness(raw?: string | null): DataFreshnessState {
  const s = (raw ?? '').toLowerCase();
  if (s === 'live' || s === 'realtime') return 'realtime';
  if (s === 'delayed' || s === 'stale-cache') return 'delayed';
  if (s === 'historical' || s === 'latest-available' || s === 'cached') return 'end_of_day';
  return 'unavailable';
}
