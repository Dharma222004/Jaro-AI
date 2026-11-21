export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural' | 'profile' | 'project';

export interface MemoryRecordData {
  id: string;
  type: MemoryType;
  eventType?: string | null;
  conversationId?: string | null;
  summary: string;
  content?: Record<string, unknown> | null;
  entities: string[];
  sourceMessageId?: string | null;
  sourceReportId?: string | null;
  confidence: number;
  importance: number;
  active: boolean;
  expiresAt?: string | null;
  lastAccessedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RetrievedMemory extends MemoryRecordData {
  relevance: number;
  recency: number;
}

export interface MemoryCandidate {
  type: MemoryType;
  eventType?: string;
  conversationId?: string;
  summary: string;
  content?: Record<string, unknown>;
  entities?: string[];
  sourceMessageId?: string;
  sourceReportId?: string;
  confidence?: number;
  importance?: number;
  expiresAt?: Date;
}
