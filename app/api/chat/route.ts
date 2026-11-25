import { NextRequest, NextResponse } from 'next/server';
import { validateAndPrepareRequest } from '@/lib/ai/orchestrator/request-pipeline';
import { executeChatOrchestration } from '@/lib/ai/orchestrator/orchestrator';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const prepared = await validateAndPrepareRequest(request);
  if (!prepared.ok) {
    return NextResponse.json(
      { error: prepared.error },
      { status: prepared.status, headers: prepared.headers },
    );
  }

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  const onRequestAbort = () => abortController.abort();
  request.signal.addEventListener('abort', onRequestAbort, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed || abortController.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
          abortController.abort();
        }
      };

      try {
        await executeChatOrchestration({
          request: prepared.value,
          signal: abortController.signal,
          emit: (event) => {
            send(event);
            // Backward-compatible event aliases alongside canonical Section 11 lifecycle names
            if (event.type === 'response_text_delta') {
              send({
                type: 'delta',
                requestId: event.requestId,
                messageId: event.messageId,
                delta: event.delta,
                text: event.text,
              });
            } else if (event.type === 'request_completed') {
              send({
                type: 'complete',
                requestId: event.requestId,
                messageId: event.messageId,
                dataTimestamp: event.dataTimestamp,
                intent: event.intent,
                artifact: event.artifact,
                suggestions: event.suggestions,
              });
            } else if (event.type === 'request_failed') {
              send({
                type: 'error',
                requestId: event.requestId,
                messageId: event.messageId,
                error: event.error,
              });
            }
          },
        });
      } finally {
        request.signal.removeEventListener('abort', onRequestAbort);
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
        }
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Request-Id': prepared.value.requestId,
    },
  });
}
