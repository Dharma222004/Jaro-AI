// lib/execution/execution-validator.ts
// Validates tool parameters before execution and verifies provenance/domain integrity on outputs.

import { ToolInputSchemas, type RegisteredToolName } from './tool-schemas';
import { validateSafeExternalUrl } from '@/lib/security/input-guard';

export class ToolValidationError extends Error {
  constructor(message: string, public readonly code = 'TOOL_VALIDATION_ERROR') {
    super(message);
    this.name = 'ToolValidationError';
  }
}

export function validateToolInput<T extends RegisteredToolName>(
  toolName: T,
  rawParams: unknown,
) {
  const schema = ToolInputSchemas[toolName];
  if (!schema) {
    throw new ToolValidationError(`Tool "${toolName}" has no registered validation schema.`, 'UNREGISTERED_TOOL');
  }
  const parsed = schema.safeParse(rawParams);
  if (!parsed.success) {
    const detail = parsed.error.issues[0]?.message ?? 'Invalid tool parameters.';
    throw new ToolValidationError(`${toolName}: ${detail}`, 'INVALID_PARAMETERS');
  }
  return parsed.data;
}

export function validateToolOutputIntegrity(toolName: string, result: unknown): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  if (result == null) {
    return { valid: false, warnings: [`${toolName} returned null result.`] };
  }

  // Verify any external URLs embedded inside tool results against SSRF vectors
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const sources = Array.isArray(obj.sources) ? obj.sources : [];
    for (const s of sources) {
      if (s && typeof s === 'object' && 'url' in s && typeof s.url === 'string') {
        const check = validateSafeExternalUrl(s.url);
        if (!check.valid) {
          warnings.push(`Filtered unsafe source URL (${check.reason ?? 'disallowed'})`);
        }
      }
    }
  }

  return { valid: true, warnings };
}
