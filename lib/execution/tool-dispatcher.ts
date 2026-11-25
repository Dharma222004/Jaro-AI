// lib/execution/tool-dispatcher.ts
// Central controlled gateway between AI orchestrator and external financial/data services.

import { z } from 'zod';
import { getRegisteredTool } from './tool-registry';
import { authorizeToolAccess, type ExecutionPrincipal } from './tool-permissions';
import { ToolInputSchemas, type RegisteredToolName, type ToolExecutionEnvelope } from './tool-schemas';
import { validateToolInput, validateToolOutputIntegrity, ToolValidationError } from './execution-validator';
import { runWithTimeoutAndRetry } from './retry-manager';
import { hashToolParams, logToolExecution } from './execution-logger';
import { safePublicError } from '@/lib/security/redactor';

export interface ExecutionSessionCache {
  inFlight: Map<string, Promise<ToolExecutionEnvelope<unknown>>>;
}

export function createExecutionSessionCache(): ExecutionSessionCache {
  return { inFlight: new Map() };
}

export async function executeRegisteredTool<Name extends RegisteredToolName>(params: {
  toolName: Name;
  input: z.input<(typeof ToolInputSchemas)[Name]>;
  principal: ExecutionPrincipal;
  sessionCache?: ExecutionSessionCache;
  signal?: AbortSignal;
}): Promise<ToolExecutionEnvelope<unknown>> {
  const startedAt = Date.now();
  const retrievalTimestamp = new Date().toISOString();
  const tool = getRegisteredTool(params.toolName);

  if (!tool) {
    await logToolExecution({
      requestId: params.principal.requestId,
      ownerKey: params.principal.ownerKey,
      toolName: params.toolName,
      paramsHash: 'unregistered',
      status: 'denied',
      durationMs: 0,
      errorCode: 'UNREGISTERED_TOOL',
      clientIp: params.principal.clientIp,
    });
    return {
      toolName: params.toolName,
      status: 'denied',
      data: null,
      provenance: {
        source: 'Tool Registry',
        provider: 'none',
        dataTimestamp: null,
        retrievalTimestamp,
        timezone: 'Asia/Kolkata',
        dataFreshness: 'unavailable',
        cached: false,
      },
      durationMs: 0,
      error: {
        code: 'UNREGISTERED_TOOL',
        message: `Tool "${params.toolName}" is not permitted in the tool registry.`,
        retryable: false,
      },
    };
  }

  // 1. Authorization & tenant isolation check BEFORE parameter execution
  const authResult = authorizeToolAccess(tool.name, tool.permissionScope, params.principal);
  if (!authResult.authorized) {
    await logToolExecution({
      requestId: params.principal.requestId,
      ownerKey: params.principal.ownerKey,
      toolName: tool.name,
      paramsHash: 'unauthorized',
      status: 'denied',
      durationMs: Date.now() - startedAt,
      errorCode: 'UNAUTHORIZED',
      clientIp: params.principal.clientIp,
    });
    return {
      toolName: tool.name,
      status: 'denied',
      data: null,
      provenance: {
        source: 'Permission Guard',
        provider: 'none',
        dataTimestamp: null,
        retrievalTimestamp,
        timezone: 'Asia/Kolkata',
        dataFreshness: 'unavailable',
        cached: false,
      },
      durationMs: Date.now() - startedAt,
      error: {
        code: 'UNAUTHORIZED',
        message: authResult.reason ?? 'Unauthorized tool invocation.',
        retryable: false,
      },
    };
  }

  // 2. Strict Zod parameter validation
  let validatedInput: unknown;
  try {
    validatedInput = validateToolInput(tool.name, params.input);
  } catch (err) {
    const code = err instanceof ToolValidationError ? err.code : 'INVALID_PARAMETERS';
    const message = safePublicError(err, 'Invalid tool parameters.');
    await logToolExecution({
      requestId: params.principal.requestId,
      ownerKey: authResult.ownerKey,
      toolName: tool.name,
      paramsHash: hashToolParams(tool.name, params.input),
      status: 'failed',
      durationMs: Date.now() - startedAt,
      errorCode: code,
      clientIp: params.principal.clientIp,
    });
    return {
      toolName: tool.name,
      status: 'failed',
      data: null,
      provenance: {
        source: 'Execution Validator',
        provider: 'none',
        dataTimestamp: null,
        retrievalTimestamp,
        timezone: 'Asia/Kolkata',
        dataFreshness: 'unavailable',
        cached: false,
      },
      durationMs: Date.now() - startedAt,
      error: { code, message, retryable: false },
    };
  }

  const pHash = hashToolParams(tool.name, validatedInput);
  const cacheKey = `${tool.name}:${pHash}:${authResult.ownerKey ?? 'public'}`;

  // 3. Request-scoped idempotency & duplicate execution suppression
  if (tool.idempotent && params.sessionCache?.inFlight.has(cacheKey)) {
    const existing = await params.sessionCache.inFlight.get(cacheKey)!;
    return {
      ...existing,
      provenance: { ...existing.provenance, cached: true },
    };
  }

  const runPromise = (async (): Promise<ToolExecutionEnvelope<unknown>> => {
    try {
      const outcome = await runWithTimeoutAndRetry({
        fn: () => tool.handler(validatedInput as never, { ...params.principal, ownerKey: authResult.ownerKey }),
        timeoutMs: tool.timeoutMs,
        maxRetries: tool.maxRetries,
        signal: params.signal,
      });

      const integrity = validateToolOutputIntegrity(tool.name, outcome.data);
      if (!integrity.valid) {
        throw new Error(integrity.warnings[0] ?? 'Tool output failed integrity validation.');
      }

      const durationMs = Date.now() - startedAt;
      await logToolExecution({
        requestId: params.principal.requestId,
        ownerKey: authResult.ownerKey,
        toolName: tool.name,
        paramsHash: pHash,
        status: outcome.cached ? 'cached' : 'success',
        durationMs,
        provider: outcome.provider,
        dataFreshness: outcome.dataFreshness,
        clientIp: params.principal.clientIp,
      });

      return {
        toolName: tool.name,
        status: 'completed',
        data: outcome.data,
        provenance: {
          source: outcome.source,
          provider: outcome.provider,
          dataTimestamp: outcome.dataTimestamp,
          retrievalTimestamp: new Date().toISOString(),
          timezone: 'Asia/Kolkata',
          dataFreshness: outcome.dataFreshness,
          cached: Boolean(outcome.cached),
        },
        durationMs,
      };
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || params.signal?.aborted) {
        throw err;
      }
      const durationMs = Date.now() - startedAt;
      const msg = safePublicError(err, `Tool "${tool.name}" failed.`);
      const isTimeout = msg.includes('TOOL_TIMEOUT');
      await logToolExecution({
        requestId: params.principal.requestId,
        ownerKey: authResult.ownerKey,
        toolName: tool.name,
        paramsHash: pHash,
        status: isTimeout ? 'timeout' : 'failed',
        durationMs,
        errorCode: isTimeout ? 'TOOL_TIMEOUT' : 'TOOL_EXECUTION_FAILED',
        clientIp: params.principal.clientIp,
      });

      return {
        toolName: tool.name,
        status: 'failed',
        data: null,
        provenance: {
          source: tool.name,
          provider: 'unavailable',
          dataTimestamp: null,
          retrievalTimestamp: new Date().toISOString(),
          timezone: 'Asia/Kolkata',
          dataFreshness: 'unavailable',
          cached: false,
        },
        durationMs,
        error: {
          code: isTimeout ? 'TOOL_TIMEOUT' : 'TOOL_EXECUTION_FAILED',
          message: msg,
          retryable: isTimeout,
        },
      };
    }
  })();

  if (tool.idempotent && params.sessionCache) {
    params.sessionCache.inFlight.set(cacheKey, runPromise);
  }

  return runPromise;
}

/**
 * Executes independent tool calls concurrently while collecting structured provenance envelopes.
 */
export async function executeToolsParallel(
  tasks: Array<{
    toolName: RegisteredToolName;
    input: unknown;
  }>,
  principal: ExecutionPrincipal,
  options: { sessionCache?: ExecutionSessionCache; signal?: AbortSignal } = {},
): Promise<ToolExecutionEnvelope<unknown>[]> {
  const sessionCache = options.sessionCache ?? createExecutionSessionCache();
  return Promise.all(
    tasks.map((task) =>
      executeRegisteredTool({
        toolName: task.toolName,
        input: task.input as never,
        principal,
        sessionCache,
        signal: options.signal,
      }),
    ),
  );
}
