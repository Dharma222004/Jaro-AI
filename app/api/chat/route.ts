import { NextRequest, NextResponse } from 'next/server';
import { runConversationalResearch } from '@/lib/research/conversational-orchestrator';
import { evaluateResearchSources } from '@/lib/research/evaluation';
import type { ConversationArtifact, ConversationContext, ConversationHistoryMessage } from '@/types/conversation';
import type { QueryClassification } from '@/types/conversation';
import { applyMemoryHints, buildMemoryCandidates } from '@/lib/memory/policy';
import { createOrUpdateMemory, retrieveMemories } from '@/lib/memory/store';
import { recordStrategySignal } from '@/lib/strategy/journal';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) return NextResponse.json({ error: 'A research question is required.' }, { status: 400 });
    if (query.length > 2_000) return NextResponse.json({ error: 'The question is too long.' }, { status: 400 });

    const history: ConversationHistoryMessage[] = Array.isArray(body.history)
      ? body.history
          .filter((message: unknown): message is ConversationHistoryMessage => {
            if (!message || typeof message !== 'object') return false;
            const item = message as Record<string, unknown>;
            return (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string';
          })
          .slice(-10)
          .map((message: ConversationHistoryMessage) => ({ role: message.role, content: message.content.slice(0, 8_000) }))
      : [];
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId.slice(0, 120) : crypto.randomUUID();
    const sourceMessageId = typeof body.sourceMessageId === 'string' ? body.sourceMessageId.slice(0, 120) : undefined;
    const memoryEnabled = body.memoryEnabled === true && typeof body.memoryIdentity === 'string';
    const memoryIdentity = memoryEnabled ? body.memoryIdentity as string : null;
    let context = sanitizeContext(body.context);
    if (memoryIdentity) {
      try {
        const { orchestrateMemoryRetrieval } = await import('@/lib/memory/orchestrator');
        const retrievalCtx = await orchestrateMemoryRetrieval({
          identity: memoryIdentity,
          query,
          conversationId,
          entities: context.activeCompanies.map((company) => company.ticker),
          includeDocuments: true,
        });

        // Assemble unified memories for LLM prompt context
        const unifiedMemories: typeof context.retrievedMemories = [...retrievalCtx.workingMemory];

        for (const ep of retrievalCtx.episodicMemories) {
          unifiedMemories.push({
            id: ep.id,
            type: 'episodic',
            eventType: ep.eventType,
            conversationId,
            summary: `[Previous ${ep.eventType} — ${new Date(ep.eventTimestamp).toLocaleDateString('en-IN')}] ${ep.summary}`,
            entities: ep.entities,
            confidence: 0.9,
            importance: 0.8,
            active: true,
            createdAt: ep.eventTimestamp,
            updatedAt: ep.eventTimestamp,
            relevance: ep.relevance,
            recency: 0.8,
          });
        }

        for (const ltm of retrievalCtx.longTermMemories) {
          unifiedMemories.push({
            id: ltm.id,
            type: ltm.category as any,
            eventType: 'long_term_fact',
            summary: `[Established ${ltm.category}] ${ltm.title}: ${ltm.value}`,
            entities: [],
            confidence: ltm.confidence,
            importance: ltm.importance,
            active: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            relevance: 0.85,
            recency: 1.0,
          });
        }

        for (const doc of retrievalCtx.documentChunks) {
          const pageRef = doc.pageNumber ? ` p.${doc.pageNumber}` : '';
          const secRef = doc.sectionTitle ? ` § ${doc.sectionTitle}` : '';
          unifiedMemories.push({
            id: `doc_${doc.documentId}_${doc.chunkIndex}`,
            type: 'semantic',
            eventType: 'document_evidence',
            summary: `[Document: ${doc.documentTitle}${pageRef}${secRef}] ${doc.content.slice(0, 500)}`,
            entities: [],
            confidence: 0.95,
            importance: 0.85,
            active: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            relevance: doc.score,
            recency: 1.0,
          });
        }

        context = applyMemoryHints(context, unifiedMemories);
      } catch (error) {
        console.warn('[/api/chat] Memory retrieval unavailable:', error instanceof Error ? error.message : 'unknown error');
      }
    }
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        let latestContext = context;
        let classification: QueryClassification | undefined;
        let latestArtifact: ConversationArtifact | undefined;
        const send = (event: Record<string, unknown>) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            closed = true;
          }
        };

        try {
          await runConversationalResearch({
            query,
            history,
            context,
            callbacks: {
              onStage: (stage, status, detail) => send({ type: 'stage', stage, status, detail }),
              onIntent: (nextClassification) => { classification = nextClassification; send({ type: 'intent', classification: nextClassification }); },
              onContext: (nextContext) => { latestContext = nextContext; send({ type: 'context', context: nextContext }); },
              onSources: (sources) => {
                send({ type: 'sources', sources });
                try {
                  const evalResult = evaluateResearchSources({ sources, query });
                  send({ type: 'research_eval', evaluation: evalResult });
                } catch {
                  // Evaluation is non-fatal; research continues without it.
                }
              },
              onArtifact: (artifact) => { latestArtifact = artifact; send({ type: 'artifact', artifact }); },
              onDelta: (() => {
                const forbiddenPatterns = [
                  /\*Source:\s*Yahoo Finance[^*\n]*\*\./gi,
                  /\*Source:\s*Yahoo Finance[^*\n]*\*/gi,
                  /Source:\s*Yahoo Finance[^\n]*/gi,
                  /\(may be delayed 15[–—-]20\s*min\)[^\n]*/gi,
                  /yahoo finance[^\n]*/gi,
                ];
                const sanitizeDelta = (text: string): string => {
                  let result = text;
                  for (const pattern of forbiddenPatterns) result = result.replace(pattern, '');
                  return result;
                };
                return (delta: string) => {
                  const sanitized = sanitizeDelta(delta);
                  if (sanitized) send({ type: 'delta', delta: sanitized });
                };
              })(),
              onSuggestions: (suggestions) => send({ type: 'suggestions', suggestions }),
            },
          });
          if (memoryIdentity) {
            try {
              const { extractAndStoreMemories } = await import('@/lib/memory/extraction');
              const { appendMessage } = await import('@/lib/memory/conversation-store');

              // Persist conversation messages
              await appendMessage(memoryIdentity, {
                conversationId,
                role: 'user',
                content: query,
              }).catch(() => {});

              await appendMessage(memoryIdentity, {
                conversationId,
                role: 'assistant',
                content: latestArtifact?.kind ? `Generated ${latestArtifact.kind} analysis` : 'Research response completed',
                stageJson: classification,
              }).catch(() => {});

              // Deep extraction into working, episodic, and long-term stores
              await extractAndStoreMemories({
                identity: memoryIdentity,
                query,
                response: latestArtifact?.kind ? `Generated ${latestArtifact.kind}` : '',
                conversationId,
                sourceMessageId,
                classification,
                context: latestContext,
              });

              if (latestArtifact?.kind === 'investment_decision') {
                await recordStrategySignal(memoryIdentity, latestArtifact.result).catch(() => null);
              }
            } catch (err) {
              console.warn('[/api/chat] Post-response memory extraction non-fatal error:', err);
            }
          }
          send({ type: 'done', dataTimestamp: new Date().toISOString() });
        } catch (error) {
          console.error('[/api/chat] Conversational research failed:', error);
          send({
            type: 'error',
            error: error instanceof Error ? error.message : 'Research could not be completed.',
          });
        } finally {
          if (!closed) {
            closed = true;
            try { controller.close(); } catch { /* already closed */ }
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('[/api/chat] Invalid request:', error);
    return NextResponse.json({ error: 'Invalid chat request.' }, { status: 400 });
  }
}

function sanitizeContext(value: unknown): ConversationContext {
  if (!value || typeof value !== 'object') return { activeCompanies: [], reports: {} };
  const raw = value as Partial<ConversationContext>;
  const activeCompanies = Array.isArray(raw.activeCompanies)
    ? raw.activeCompanies.filter((company) => company && typeof company.name === 'string' && typeof company.ticker === 'string').slice(0, 4)
    : [];
  const reports = raw.reports && typeof raw.reports === 'object'
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
    activeAssumptions: Array.isArray(raw.activeAssumptions) ? raw.activeAssumptions.filter((item): item is string => typeof item === 'string').slice(0, 12) : [],
    pendingClarifications: Array.isArray(raw.pendingClarifications) ? raw.pendingClarifications.filter((item): item is string => typeof item === 'string').slice(0, 8) : [],
  };
}
