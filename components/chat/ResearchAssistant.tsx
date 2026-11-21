'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  ArrowDown,
  ArrowRight,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  FileSearch,
  LoaderCircle,
  MessageSquarePlus,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { MarkdownAnswer } from './MarkdownAnswer';
import { TechnicalChart } from './TechnicalChart';
import { InvestmentDecisionCard } from './InvestmentDecisionCard';
import { JaroLogo } from '@/components/brand/JaroLogo';
import { MessageBubble } from './MessageBubble';
import type { ResearchSourceMeta } from '@/types/research';
import type {
  ConversationArtifact,
  ConversationContext,
  ResearchIntent,
} from '@/types/conversation';
import { getMemoryEnabled, getMemoryIdentity } from '@/lib/memory/client';
import { AttachmentGallery } from './AttachmentGallery';

import type { ImageAttachment } from '@/types/attachment';
import {
  formatMessageTime,
  dedupeMessageSources,
  replaceInternalCitations,
  createConversation,
  upsertStage,
  makeTitle,
  relativeTime,
  deleteConversationAttachments,
  imageDimensions,
  addAttachments,
  removePendingAttachment,
  STORAGE_KEY,
  CURRENT_KEY,
  type LocalMessage,
  type LocalConversation,
  type MessageStage,
} from './types';

export function ResearchAssistant() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<LocalConversation[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [input, setInput] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [visibleMessageCount, setVisibleMessageCount] = useState(20);
  const [memoryEnabled, setMemoryEnabledState] = useState(true);
  const [pendingAttachments, setPendingAttachments] = useState<ImageAttachment[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as LocalConversation[];
        if (Array.isArray(parsed) && parsed.length) {
          const bounded = parsed.slice(0, 20).map((conversation) => ({ ...conversation, messages: conversation.messages.slice(-60) }));
          setConversations(bounded);
          const preferred = localStorage.getItem(CURRENT_KEY);
          setCurrentId(bounded.some((item) => item.id === preferred) ? preferred! : bounded[0].id);
        } else {
          const first = createConversation();
          setConversations([first]);
          setCurrentId(first.id);
        }
      } catch {
        const first = createConversation();
        setConversations([first]);
        setCurrentId(first.id);
      }
      setHydrated(true);
      setMemoryEnabledState(getMemoryEnabled());
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated || isStreaming) return;
    const timeout = window.setTimeout(() => {
      try {
        const bounded = conversations.slice(0, 20).map((conversation) => ({
          ...conversation,
          messages: conversation.messages.slice(-60),
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
        localStorage.setItem(CURRENT_KEY, currentId);
      } catch (error) {
        console.warn('[Jaro conversations] Could not persist conversation:', error);
      }
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [conversations, currentId, hydrated, isStreaming]);

  const current = useMemo(
    () => conversations.find((item) => item.id === currentId) ?? conversations[0],
    [conversations, currentId],
  );

  useEffect(() => {
    if (!isStreaming || !current?.messages.length) return;
    const frame = requestAnimationFrame(() => {
      const container = messagesRef.current;
      if (!container) return;
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 40;
      if (!nearBottom) setShowJumpToLatest(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [current?.messages, isStreaming]);

  const handleConversationScroll = useCallback(() => {
    const container = messagesRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 120;
    setShowJumpToLatest(!nearBottom);
  }, []);

  const jumpToLatest = useCallback(() => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    setShowJumpToLatest(false);
    setVisibleMessageCount(20);
  }, []);

  const updateConversation = useCallback((id: string, updater: (conversation: LocalConversation) => LocalConversation) => {
    setConversations((previous) => previous.map((item) => item.id === id ? updater(item) : item));
  }, []);

  const updateMessage = useCallback((conversationId: string, messageId: string, patch: Partial<LocalMessage> | ((message: LocalMessage) => LocalMessage)) => {
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      updatedAt: new Date().toISOString(),
      messages: conversation.messages.map((message) => message.id === messageId
        ? typeof patch === 'function' ? patch(message) : { ...message, ...patch }
        : message),
    }));
  }, [updateConversation]);

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    const next = createConversation();
    conversations.slice(19).forEach(deleteConversationAttachments);
    setConversations([next, ...conversations].slice(0, 20));
    setShowJumpToLatest(false);
    setVisibleMessageCount(20);
    setCurrentId(next.id);
    setHistoryOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [conversations]);

  useEffect(() => {
    if (!hydrated) return;
    const isNew = searchParams.get('new');
    const queryParam = searchParams.get('q');
    if (isNew === '1') {
      newConversation();
      router.replace('/');
    } else if (queryParam) {
      setInput(queryParam);
      setTimeout(() => inputRef.current?.focus(), 50);
      router.replace('/');
    }
  }, [hydrated, searchParams, newConversation, router]);

  const deleteConversation = (id: string) => {
    if (conversations.length === 1) {
      deleteConversationAttachments(conversations[0]);
      const next = createConversation();
      setConversations([next]);
      setCurrentId(next.id);
      setShowJumpToLatest(false);
      setVisibleMessageCount(20);
      setHistoryOpen(false);
      return;
    }
    const removed = conversations.find((item) => item.id === id);
    if (removed) deleteConversationAttachments(removed);
    const remaining = conversations.filter((item) => item.id !== id);
    setConversations(remaining);
    if (currentId === id) {
      setShowJumpToLatest(false);
      setVisibleMessageCount(20);
      setCurrentId(remaining[0].id);
    }
  };

  const sendMessage = useCallback(async (text: string, includePendingAttachments = false) => {
    const query = text.trim();
    if (!query || isStreaming || !current) return;

    const conversationId = current.id;
    const messageAttachments = includePendingAttachments
      ? pendingAttachments.map(({ id, name, mimeType, width, height, size }) => ({ id, name, mimeType, width, height, size }))
      : [];
    const userMessage: LocalMessage = {
      id: crypto.randomUUID(), role: 'user', content: query, createdAt: new Date().toISOString(), status: 'complete', attachments: messageAttachments,
    };
    const assistantId = crypto.randomUUID();
    const assistantMessage: LocalMessage = {
      id: assistantId, role: 'assistant', content: '', createdAt: new Date().toISOString(), status: 'streaming', stages: [],
    };
    const priorHistory = current.messages.slice(-10).map((message) => ({ role: message.role, content: message.content }));
    const requestContext = current.context;
    setShowJumpToLatest(true);
    setVisibleMessageCount((count) => Math.min(current.messages.length + 2, count + 2));

    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      title: conversation.messages.length === 0 ? makeTitle(query) : conversation.title,
      updatedAt: new Date().toISOString(),
      messages: [...conversation.messages, userMessage, assistantMessage],
    }));
    setInput('');
    if (includePendingAttachments) {
      pendingAttachments.forEach((attachment) => { if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl); });
      setPendingAttachments([]);
    }
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let accumulated = '';
    let contentFrame: number | null = null;
    let hasSentFirstChunk = false;
    const flushContent = () => {
      if (contentFrame != null) cancelAnimationFrame(contentFrame);
      contentFrame = null;
      updateMessage(conversationId, assistantId, { content: accumulated });
    };

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          query,
          conversationId,
          sourceMessageId: userMessage.id,
          history: priorHistory,
          context: requestContext,
          memoryEnabled,
          memoryIdentity: memoryEnabled ? getMemoryIdentity() : undefined,
          attachments: messageAttachments.map(({ id, name, mimeType, width, height, size }) => ({ id, name, mimeType, width, height, size })),
        }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'The research service did not respond.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const eventBlock of events) {
          const dataLine = eventBlock.split('\n').find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          const event = JSON.parse(dataLine.replace(/^data:\s*/, ''));
          if (event.type === 'delta') {
            accumulated += event.delta;
            if (!hasSentFirstChunk) {
              hasSentFirstChunk = true;
            }
            if (contentFrame == null) {
              contentFrame = requestAnimationFrame(() => {
                contentFrame = null;
                updateMessage(conversationId, assistantId, { content: accumulated });
              });
            }
          } else if (event.type === 'stage') {
            updateMessage(conversationId, assistantId, (message) => ({
              ...message,
              stages: upsertStage(message.stages ?? [], event.stage, event.status, event.detail),
            }));
          } else if (event.type === 'intent') {
            updateMessage(conversationId, assistantId, { intent: event.classification.intent });
          } else if (event.type === 'sources') {
            updateMessage(conversationId, assistantId, { sources: event.sources });
          } else if (event.type === 'artifact') {
            updateMessage(conversationId, assistantId, { artifact: event.artifact });
          } else if (event.type === 'context') {
            updateConversation(conversationId, (conversation) => ({ ...conversation, context: event.context, updatedAt: new Date().toISOString() }));
          } else if (event.type === 'done') {
            flushContent();
            updateMessage(conversationId, assistantId, { status: 'complete', dataTimestamp: event.dataTimestamp });
          } else if (event.type === 'error') {
            throw new Error(event.error || 'Research failed.');
          }
        }
      }
      flushContent();
      updateMessage(conversationId, assistantId, (message) => ({ ...message, status: 'complete' }));
    } catch (error) {
      if (controller.signal.aborted) {
        updateMessage(conversationId, assistantId, (message) => ({
          ...message,
          status: 'complete',
          content: message.content || 'Response stopped.',
        }));
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Research failed.';
        const isNetworkError = errorMessage.toLowerCase().includes('network') ||
          errorMessage.toLowerCase().includes('fetch') ||
          errorMessage.toLowerCase().includes('connection');
        const isTimeout = errorMessage.toLowerCase().includes('timeout');

        let userFriendlyMessage = 'I could not complete this research request.';
        if (isNetworkError) {
          userFriendlyMessage = 'The connection was interrupted. Please check your connection and try again.';
        } else if (isTimeout) {
          userFriendlyMessage = 'The request timed out. Please try again.';
        } else {
          userFriendlyMessage = 'An unexpected error occurred. Please try again.';
        }

        updateMessage(conversationId, assistantId, (message) => {
          if (message.status === 'error') return message;
          return {
            ...message,
            status: 'error',
            error: errorMessage,
            content: accumulated || userFriendlyMessage,
          };
        });
      }
    } finally {
      if (contentFrame != null) cancelAnimationFrame(contentFrame);
      abortRef.current = null;
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [current, isStreaming, memoryEnabled, pendingAttachments, updateConversation, updateMessage]);

  const addAttachmentsHandler = async (files: FileList | null) => {
    await addAttachments(files, pendingAttachments, setPendingAttachments);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePendingAttachmentHandler = (attachment: ImageAttachment) => {
    removePendingAttachment(attachment, setPendingAttachments);
  };

  const stop = () => abortRef.current?.abort();
  const copy = (message: LocalMessage) => {
    navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  if (!hydrated || !current) return <div className="assistant-loading"><LoaderCircle className="animate-spin" size={24} /></div>;

  return (
    <div className={`research-assistant ${current.messages.length === 0 ? 'is-empty' : 'has-messages'}`}>
      <header className="assistant-header">
        <div className="assistant-header-left">
          <div className="assistant-header-info">
            <h1 className="assistant-header-title">
              {current.messages.length > 0 ? (current.title || 'Research Conversation') : 'Equity Research Workspace'}
            </h1>
          </div>
        </div>
        <div className="assistant-header-actions">
          <button
            className="btn-new-chat"
            aria-label="New chat"
            title="Start new conversation"
            type="button"
            onClick={newConversation}
          >
            <Plus size={15} strokeWidth={2.4} />
            <span>New Chat</span>
          </button>
        </div>
      </header>

      {historyOpen && (
        <>
          <button className="conversation-panel-scrim" aria-label="Close conversation history" onClick={() => setHistoryOpen(false)} />
          <aside className="conversation-panel" role="dialog" aria-modal="true" aria-label="Conversation history">
            <div className="conversation-panel-header">
              <div><strong>Conversations</strong><span>Stored securely in this browser</span></div>
              <button className="btn-ghost" onClick={() => setHistoryOpen(false)} aria-label="Close"><X size={17} /></button>
            </div>
            <button className="conversation-new" onClick={newConversation}><JaroLogo variant="compact" /> New conversation</button>
            <div className="conversation-list">
              {conversations.map((conversation) => (
                <div className={`conversation-row ${conversation.id === currentId ? 'active' : ''}`} key={conversation.id}>
                  <button onClick={() => { setShowJumpToLatest(false); setVisibleMessageCount(20); setCurrentId(conversation.id); setHistoryOpen(false); }}>
                    <span>{conversation.title}</span>
                    <small>{relativeTime(conversation.updatedAt)}</small>
                  </button>
                  <button className="conversation-delete" onClick={() => deleteConversation(conversation.id)} title="Delete conversation"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          </aside>
        </>
      )}

      <div className="assistant-messages" ref={messagesRef} onScroll={handleConversationScroll}>
        <div className="assistant-thread">
          {current.messages.length === 0 && (
            <section className="assistant-topic minimal" aria-labelledby="assistant-topic-heading">
              <div className="hero-logo-box">
                <video
                  src="/jaro-institutional-logo.mp4"
                  autoPlay
                  loop
                  muted
                  playsInline
                  poster="/jaro-institutional-logo-128.png"
                  className="hero-logo-video"
                />
              </div>
              <div className="assistant-topic-brand">

                <span className="brand-label">JARO AI · FINANCIAL INTELLIGENCE FOR INVESTOR</span>
              </div>
              <h2 id="assistant-topic-heading" className="assistant-topic-heading">
                AI-Powered Indian Equity Research
              </h2>
            </section>
          )}
          {current.messages.length > visibleMessageCount && (
            <button className="load-earlier-messages" onClick={() => setVisibleMessageCount((count) => count + 20)}>
              Show earlier messages ({current.messages.length - visibleMessageCount} remaining)
            </button>
          )}
          {current.messages.slice(-visibleMessageCount).map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              copied={copiedId === message.id}
              onCopy={() => copy(message)}
              onSuggestion={sendMessage}
              onRetry={() => {
                const index = current.messages.findIndex((item) => item.id === message.id);
                const previous = [...current.messages.slice(0, index)].reverse().find((item) => item.role === 'user');
                if (message.role === 'assistant' && (message.status === 'error' || !message.content)) {
                  updateConversation(current.id, (conv) => ({
                    ...conv,
                    messages: conv.messages.filter((m) => m.id !== message.id),
                  }));
                }
                if (previous) sendMessage(previous.content);
              }}
            />
          ))}
        </div>
      </div>

      {showJumpToLatest && (
        <button className="jump-to-latest" onClick={jumpToLatest} aria-label="Jump to the latest response">
          <ArrowDown size={14} /> <span>{isStreaming ? 'New response' : 'Jump to latest'}</span>
        </button>
      )}

      <div className="assistant-composer-wrap">
        {pendingAttachments.length > 0 && <div className="composer-attachments"><AttachmentGallery attachments={pendingAttachments} compact onRemove={removePendingAttachmentHandler} /></div>}
        <div className="assistant-composer">
          <input ref={fileInputRef} className="composer-file-input" type="file" accept="image/*" multiple onChange={(event) => void addAttachmentsHandler(event.target.files)} />
          <button className="composer-attach" type="button" onClick={() => fileInputRef.current?.click()} disabled={isStreaming || pendingAttachments.length >= 20} aria-label="Attach images" title="Attach images">
            <Paperclip size={17} />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage(input, true);
              }
            }}
            onInput={(event) => {
              event.currentTarget.style.height = 'auto';
              event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`;
            }}
            rows={1}
            placeholder="Ask anything about Indian stocks, fundamentals, technicals, or portfolio..."
            disabled={isStreaming}
            aria-label="Ask Jaro AI"
            enterKeyHint="send"
            autoComplete="off"
            spellCheck={false}
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
          />
          {isStreaming ? (
            <button className="composer-send stop" onClick={stop} title="Stop response" aria-label="Stop generating response"><Square size={13} fill="currentColor" /></button>
          ) : (
            <button className="composer-send" onClick={() => sendMessage(input, true)} disabled={!input.trim()} title="Send" aria-label="Send message"><Send size={16} /></button>
          )}
        </div>

        <p className="composer-disclaimer">Source-grounded research <span>·</span> Market quotes may be delayed <span>·</span> Not investment advice</p>
      </div>
    </div>
  );
}