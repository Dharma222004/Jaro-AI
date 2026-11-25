// lib/ai/orchestrator/execution-controller.ts
// Controlled tool planning & concurrent execution bridge with SSE status reporting.

import {
  createExecutionSessionCache,
  executeRegisteredTool,
  executeToolsParallel,
  type ExecutionSessionCache,
} from '@/lib/execution/tool-dispatcher';
import type { ExecutionPrincipal } from '@/lib/execution/tool-permissions';
import type { RegisteredToolName, ToolExecutionEnvelope } from '@/lib/execution/tool-schemas';

export interface ExecutionLifecycleHooks {
  onToolStarted?: (toolName: string, detail?: string) => void;
  onToolCompleted?: (toolName: string, envelope: ToolExecutionEnvelope<unknown>) => void;
}

export class ExecutionController {
  private readonly sessionCache: ExecutionSessionCache;

  constructor(
    private readonly principal: ExecutionPrincipal,
    private readonly hooks?: ExecutionLifecycleHooks,
    private readonly signal?: AbortSignal,
  ) {
    this.sessionCache = createExecutionSessionCache();
  }

  async runTool<Name extends RegisteredToolName>(
    toolName: Name,
    input: Parameters<typeof executeRegisteredTool<Name>>[0]['input'],
    detail?: string,
  ): Promise<ToolExecutionEnvelope<unknown>> {
    this.hooks?.onToolStarted?.(toolName, detail);
    const envelope = await executeRegisteredTool({
      toolName,
      input,
      principal: this.principal,
      sessionCache: this.sessionCache,
      signal: this.signal,
    });
    this.hooks?.onToolCompleted?.(toolName, envelope);
    return envelope;
  }

  async runParallel(
    tasks: Array<{ toolName: RegisteredToolName; input: unknown; detail?: string }>,
  ): Promise<ToolExecutionEnvelope<unknown>[]> {
    for (const t of tasks) {
      this.hooks?.onToolStarted?.(t.toolName, t.detail);
    }
    const results = await executeToolsParallel(
      tasks.map((t) => ({ toolName: t.toolName, input: t.input })),
      this.principal,
      { sessionCache: this.sessionCache, signal: this.signal },
    );
    for (let i = 0; i < tasks.length; i++) {
      this.hooks?.onToolCompleted?.(tasks[i].toolName, results[i]);
    }
    return results;
  }
}
