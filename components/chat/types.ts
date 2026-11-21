import type { ResearchSourceMeta } from '@/types/research';
import type { ConversationArtifact, ConversationContext, ResearchIntent } from '@/types/conversation';
import type { ImageAttachment } from '@/types/attachment';
import { deleteAttachment, storeAttachment } from '@/lib/attachments/client-store';

export interface MessageStage {
  id: string;
  status: 'running' | 'completed' | 'failed';
  detail?: string;
}

export interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status?: 'streaming' | 'complete' | 'error';
  intent?: ResearchIntent;
  sources?: ResearchSourceMeta[];
  artifact?: ConversationArtifact;
  suggestions?: string[];
  dataTimestamp?: string;
  stages?: MessageStage[];
  error?: string;
  attachments?: ImageAttachment[];
}

export interface LocalConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: LocalMessage[];
  context: ConversationContext;
}

export const STORAGE_KEY = 'jaro_conversations_v2';
export const CURRENT_KEY = 'jaro_current_conversation_v2';

export function createConversation(): LocalConversation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: 'New research conversation',
    createdAt: now,
    updatedAt: now,
    messages: [],
    context: { activeCompanies: [], reports: {} },
  };
}

export function upsertStage(stages: MessageStage[], id: string, status: MessageStage['status'], detail?: string): MessageStage[] {
  const existing = stages.findIndex((stage) => stage.id === id);
  if (existing === -1) return [...stages, { id, status, detail }];
  return stages.map((stage, index) => index === existing ? { ...stage, status, detail: detail ?? stage.detail } : stage);
}

export function makeTitle(query: string): string {
  return query.length > 52 ? `${query.slice(0, 49)}…` : query;
}

export function relativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatMessageTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function deleteConversationAttachments(conversation: LocalConversation) {
  conversation.messages.flatMap((message) => message.attachments ?? []).forEach((attachment) => {
    void deleteAttachment(attachment.id).catch(() => undefined);
  });
}

export async function imageDimensions(file: File) {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

export function dedupeMessageSources(sources: import('@/types/research').ResearchSourceMeta[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (!source.url || seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

export function replaceInternalCitations(content: string, sources: import('@/types/research').ResearchSourceMeta[]) {
  const sourceNumbers = new Map<string, number>();
  sources.forEach((source, index) => {
    if (source.id) sourceNumbers.set(source.id, index + 1);
  });
  return content.replace(/\[([a-zA-Z][a-zA-Z0-9_-]*)\](?!\()/g, (_match, sourceId: string) => {
    const sourceNumber = sourceNumbers.get(sourceId);
    return sourceNumber ? `[${sourceNumber}]` : '';
  });
}

export async function addAttachments(
  files: FileList | null,
  pendingAttachments: ImageAttachment[],
  setPendingAttachments: (attachments: ImageAttachment[] | ((prev: ImageAttachment[]) => ImageAttachment[])) => void
) {
  if (!files) return;
  const available = Math.max(0, 20 - pendingAttachments.length);
  const selected = [...files].filter((file) => file.type.startsWith('image/') && file.size <= 10 * 1024 * 1024).slice(0, available);
  const prepared: ImageAttachment[] = [];
  for (const file of selected) {
    const id = crypto.randomUUID();
    const dimensions = await imageDimensions(file).catch(() => ({ width: 1, height: 1 }));
    await storeAttachment(id, file).catch(() => undefined);
    prepared.push({ id, name: file.name, mimeType: file.type, width: dimensions.width, height: dimensions.height, size: file.size, previewUrl: URL.createObjectURL(file) });
  }
  setPendingAttachments((current: ImageAttachment[]) => [...current, ...prepared].slice(0, 20));
}

export function removePendingAttachment(
  attachment: ImageAttachment,
  setPendingAttachments: (attachments: ImageAttachment[] | ((prev: ImageAttachment[]) => ImageAttachment[])) => void
) {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  void deleteAttachment(attachment.id).catch(() => undefined);
  setPendingAttachments((current: ImageAttachment[]) => current.filter((item) => item.id !== attachment.id));
}