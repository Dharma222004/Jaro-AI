// lib/security/audit-logger.ts
// Persistent, redacted security and operational audit logging into SecurityAuditLog.

import { createHash } from 'node:crypto';
import { prisma } from '@/lib/database/client';
import { redactSecrets, sanitizeLogObject } from './redactor';

export type SecurityAuditEventType =
  | 'auth'
  | 'access_denied'
  | 'tool_execution'
  | 'provider_failure'
  | 'memory_change'
  | 'export'
  | 'rate_limit'
  | 'security_guard';

export interface AuditEventInput {
  ownerKey?: string | null;
  eventType: SecurityAuditEventType;
  action: string;
  resource?: string | null;
  status: 'success' | 'denied' | 'error' | 'blocked';
  requestId?: string | null;
  clientIp?: string | null;
  metadata?: Record<string, unknown>;
}

export function hashClientIp(ip?: string | null): string | null {
  const clean = ip?.split(',')[0]?.trim();
  if (!clean) return null;
  return createHash('sha256').update(`jaro-ip-audit:${clean}`).digest('hex').slice(0, 24);
}

/**
 * Records an operational or security event without storing full confidential prompt content or secrets.
 */
export async function recordSecurityAudit(input: AuditEventInput): Promise<void> {
  try {
    const safeMetadata = input.metadata ? sanitizeLogObject(input.metadata) : {};
    await prisma.securityAuditLog.create({
      data: {
        ownerKey: input.ownerKey ?? null,
        eventType: input.eventType,
        action: redactSecrets(input.action).slice(0, 120),
        resource: input.resource ? redactSecrets(input.resource).slice(0, 180) : null,
        status: input.status,
        requestId: input.requestId ?? null,
        ipHash: hashClientIp(input.clientIp),
        metadataJson: JSON.stringify(safeMetadata).slice(0, 4000),
      },
    });
  } catch (err) {
    // Non-fatal: audit logging must never break production responses, though console records redacted trace.
    console.warn('[security-audit] Failed to write audit log:', redactSecrets(err instanceof Error ? err.message : String(err)));
  }
}
