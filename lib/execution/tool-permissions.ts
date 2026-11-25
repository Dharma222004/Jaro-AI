// lib/execution/tool-permissions.ts
// Enforces authorization scopes for every tool execution before accessing private or external data.

import { memoryOwnerKey } from '@/lib/memory/identity';

export type ToolPermissionScope = 'public_market' | 'research_read' | 'authenticated_private';

export interface ExecutionPrincipal {
  authenticated: boolean;
  identity?: string | null;
  ownerKey?: string | null;
  clientIp?: string | null;
  requestId?: string;
}

export class ToolPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolPermissionError';
  }
}

export function authorizeToolAccess(
  toolName: string,
  requiredScope: ToolPermissionScope,
  principal: ExecutionPrincipal,
): { authorized: boolean; ownerKey: string | null; reason?: string } {
  if (requiredScope === 'public_market' || requiredScope === 'research_read') {
    return {
      authorized: true,
      ownerKey: principal.ownerKey ?? null,
    };
  }

  // authenticated_private strictly requires verified user identity & derived ownerKey
  if (!principal.authenticated || !principal.identity) {
    return {
      authorized: false,
      ownerKey: null,
      reason: `Authentication required to execute protected tool "${toolName}".`,
    };
  }

  try {
    const derivedOwnerKey = principal.ownerKey ?? memoryOwnerKey(principal.identity);
    return { authorized: true, ownerKey: derivedOwnerKey };
  } catch {
    return {
      authorized: false,
      ownerKey: null,
      reason: `Invalid user credentials for protected tool "${toolName}".`,
    };
  }
}
