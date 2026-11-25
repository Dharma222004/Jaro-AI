// lib/execution/execution-logger.ts
// Persists redacted tool execution logs to ToolExecutionLog and failures/denials to SecurityAuditLog.

import { createHash } from 'node:crypto';
import { prisma } from '@/lib/database/client';
import { redactSecrets } from '@/lib/security/redactor';
import { recordSecurityAudit } from '@/lib/security/audit-logger';
import type { DataFreshnessState } from './tool-schemas';

export function hashToolParams(toolName: string, params: unknown): string {
  const serialized = JSON.stringify({ toolName, params }) ?? '';
  return createHash('sha256').update(serialized).digest('hex').slice(0, 32);
}

export async function logToolExecution(entry: {
  requestId?: string;
  ownerKey?: string | null;
  toolName: string;
  paramsHash: string;
  status: 'success' | 'failed' | 'timeout' | 'denied' | 'cached';
  durationMs: number;
  provider?: string;
  dataFreshness?: DataFreshnessState;
  errorCode?: string;
  clientIp?: string | null;
}): Promise<void> {
  try {
    await prisma.toolExecutionLog.create({
      data: {
        requestId: entry.requestId ?? null,
        ownerKey: entry.ownerKey ?? null,
        toolName: entry.toolName.slice(0, 80),
        paramsHash: entry.paramsHash.slice(0, 64),
        status: entry.status,
        durationMs: Math.max(0, Math.round(entry.durationMs)),
        provider: entry.provider ? redactSecrets(entry.provider).slice(0, 80) : null,
        dataFreshness: entry.dataFreshness ?? null,
        errorCode: entry.errorCode ? redactSecrets(entry.errorCode).slice(0, 80) : null,
      },
    });

    if (entry.status === 'denied' || entry.status === 'failed' || entry.status === 'timeout') {
      await recordSecurityAudit({
        ownerKey: entry.ownerKey,
        eventType: entry.status === 'denied' ? 'access_denied' : 'tool_execution',
        action: `tool_${entry.status}:${entry.toolName}`,
        resource: entry.toolName,
        status: entry.status === 'denied' ? 'denied' : 'error',
        requestId: entry.requestId,
        clientIp: entry.clientIp,
        metadata: {
          durationMs: entry.durationMs,
          provider: entry.provider,
          errorCode: entry.errorCode,
        },
      });
    }
  } catch (err) {
    console.warn('[execution-logger] Non-fatal log failure:', redactSecrets(err instanceof Error ? err.message : String(err)));
  }
}
