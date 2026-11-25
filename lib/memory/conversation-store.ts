// lib/memory/conversation-store.ts
// Production in-context and conversational persistence
// Manages ConversationRecord and ConversationMessage with rolling summaries, tool metadata, and tenant isolation.

import { prisma } from '@/lib/database/client';
import { memoryOwnerKey } from './identity';
import { redactSecrets } from '@/lib/security/redactor';

export interface ConversationRecordData {
  id: string;
  title?: string | null;
  summary?: string | null;
  summaryVersion: number;
  summaryMessageCount: number;
  messageCount: number;
  lastMessageAt?: string | null;
  entities: string[];
  openTasks: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessageData {
  id: string;
  conversationId: string;
  requestId?: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  contentSummary?: string | null;
  intent?: string | null;
  toolResults?: unknown;
  attachments: unknown[];
  memoryRefs: string[];
  stageJson?: unknown;
  createdAt: string;
}

export async function upsertConversation(identity: string, params: {
  conversationId: string;
  title?: string;
  summary?: string;
  summaryMessageCount?: number;
  entities?: string[];
  openTasks?: string[];
  bumpMessageCount?: boolean;
}): Promise<ConversationRecordData> {
  const ownerKey = memoryOwnerKey(identity);
  const existing = await prisma.conversationRecord.findFirst({
    where: { id: params.conversationId, ownerKey },
  });

  const normalizedEntities = params.entities
    ? [...new Set(params.entities.map((e) => e.trim().toUpperCase()).filter(Boolean))].slice(0, 30)
    : undefined;
  const normalizedTasks = params.openTasks
    ? [...new Set(params.openTasks.map((t) => t.trim()).filter(Boolean))].slice(0, 12)
    : undefined;

  if (existing) {
    const mergedEntities = normalizedEntities
      ? [...new Set([...parseJson<string[]>(existing.entities, []), ...normalizedEntities])].slice(0, 30)
      : undefined;

    const record = await prisma.conversationRecord.update({
      where: { id: params.conversationId },
      data: {
        ...(params.title ? { title: params.title.slice(0, 200) } : {}),
        ...(params.summary ? { summary: params.summary.slice(0, 4000), summaryVersion: { increment: 1 } } : {}),
        ...(params.summaryMessageCount != null ? { summaryMessageCount: params.summaryMessageCount } : {}),
        ...(mergedEntities ? { entities: JSON.stringify(mergedEntities) } : {}),
        ...(normalizedTasks ? { openTasksJson: JSON.stringify(normalizedTasks) } : {}),
        ...(params.bumpMessageCount ? { messageCount: { increment: 1 }, lastMessageAt: new Date() } : {}),
      },
    });
    return toConvData(record);
  }

  const record = await prisma.conversationRecord.create({
    data: {
      id: params.conversationId,
      ownerKey,
      title: params.title?.slice(0, 200),
      summary: params.summary?.slice(0, 4000),
      summaryMessageCount: params.summaryMessageCount ?? 0,
      entities: JSON.stringify(normalizedEntities ?? []),
      openTasksJson: JSON.stringify(normalizedTasks ?? []),
      messageCount: params.bumpMessageCount ? 1 : 0,
      lastMessageAt: params.bumpMessageCount ? new Date() : null,
      status: 'active',
    },
  });
  return toConvData(record);
}

export async function getConversation(identity: string, conversationId: string): Promise<ConversationRecordData | null> {
  const ownerKey = memoryOwnerKey(identity);
  const record = await prisma.conversationRecord.findFirst({
    where: { id: conversationId, ownerKey, status: { not: 'deleted' } },
  });
  return record ? toConvData(record) : null;
}

export async function listConversations(identity: string, limit = 50): Promise<ConversationRecordData[]> {
  const ownerKey = memoryOwnerKey(identity);
  const records = await prisma.conversationRecord.findMany({
    where: { ownerKey, status: { not: 'deleted' } },
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    take: Math.min(limit, 200),
  });
  return records.map(toConvData);
}

export async function appendMessage(identity: string, params: {
  conversationId: string;
  requestId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  intent?: string;
  toolResults?: unknown;
  attachments?: unknown[];
  memoryRefs?: string[];
  stageJson?: unknown;
}): Promise<string> {
  const ownerKey = memoryOwnerKey(identity);
  await upsertConversation(identity, { conversationId: params.conversationId, bumpMessageCount: true });

  // Double-check ownership BEFORE inserting message to prevent cross-tenant append
  const conv = await prisma.conversationRecord.findFirst({ where: { id: params.conversationId, ownerKey } });
  if (!conv) {
    throw new Error('Conversation not found for this identity.');
  }

  const cleanContent = redactSecrets(params.content).slice(0, 32000);
  const msg = await prisma.conversationMessage.create({
    data: {
      conversationId: params.conversationId,
      requestId: params.requestId ?? null,
      role: params.role,
      content: cleanContent,
      contentSummary: cleanContent.length > 2000 ? `${cleanContent.slice(0, 600)}…` : null,
      intent: params.intent?.slice(0, 80) ?? null,
      toolResultsJson: params.toolResults ? JSON.stringify(params.toolResults).slice(0, 24000) : null,
      attachmentsJson: JSON.stringify(params.attachments ?? []),
      memoryRefs: JSON.stringify(params.memoryRefs ?? []),
      stageJson: params.stageJson ? JSON.stringify(params.stageJson) : null,
    },
  });

  return msg.id;
}

export async function getConversationMessages(
  identity: string,
  conversationId: string,
  limit = 20,
): Promise<ConversationMessageData[]> {
  const ownerKey = memoryOwnerKey(identity);
  const conv = await prisma.conversationRecord.findFirst({ where: { id: conversationId, ownerKey } });
  if (!conv) return [];

  // Query newest N messages then return chronologically
  const msgs = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
  });

  return msgs.reverse().map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    requestId: m.requestId,
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
    contentSummary: m.contentSummary,
    intent: m.intent,
    toolResults: parseJson(m.toolResultsJson, null),
    attachments: parseJson(m.attachmentsJson, []),
    memoryRefs: parseJson(m.memoryRefs, []),
    stageJson: parseJson(m.stageJson, null),
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function updateConversationSummary(
  identity: string,
  conversationId: string,
  summary: string,
  summaryMessageCount?: number,
): Promise<void> {
  const ownerKey = memoryOwnerKey(identity);
  await prisma.conversationRecord.updateMany({
    where: { id: conversationId, ownerKey },
    data: {
      summary: summary.slice(0, 4000),
      ...(summaryMessageCount != null ? { summaryMessageCount } : {}),
      summaryVersion: { increment: 1 },
    },
  });
}

export async function deleteConversation(identity: string, conversationId: string): Promise<boolean> {
  const ownerKey = memoryOwnerKey(identity);
  const result = await prisma.conversationRecord.updateMany({
    where: { id: conversationId, ownerKey },
    data: { status: 'deleted' },
  });
  return result.count > 0;
}

function toConvData(r: {
  id: string;
  title: string | null;
  summary: string | null;
  summaryVersion: number;
  summaryMessageCount: number;
  messageCount: number;
  lastMessageAt: Date | null;
  entities: string;
  openTasksJson: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): ConversationRecordData {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    summaryVersion: r.summaryVersion,
    summaryMessageCount: r.summaryMessageCount,
    messageCount: r.messageCount,
    lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
    entities: parseJson(r.entities, []),
    openTasks: parseJson(r.openTasksJson, []),
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function parseJson<T>(v: string | null | undefined, fallback: T): T {
  if (!v) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}
