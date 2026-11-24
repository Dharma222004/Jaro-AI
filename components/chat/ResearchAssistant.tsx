'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowDown,
  LoaderCircle,
  Paperclip,
  Plus,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { JaroLogo } from '@/components/brand/JaroLogo';
import { MessageBubble } from './MessageBubble';
import { getMemoryEnabled } from '@/lib/memory/client';
import { AttachmentGallery } from './AttachmentGallery';
import type { ImageAttachment } from '@/types/attachment';
import {
  formatMessageTime,
  createConversation,
  makeTitle,
  relativeTime,
  deleteConversationAttachments,
  addAttachments,
  removePendingAttachment,
  STORAGE_KEY,
  CURRENT_KEY,
  type LocalMessage,
  type LocalConversation,
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
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 80;
      if (!nearBottom) setShowJumpToLatest(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [current?.messages, isStreaming]);

  const handleConversationScroll = useCallback(() => {
    const container = messagesRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 100;
    setShowJumpToLatest(!nearBottom);
  }, []);

  const jumpToLatest = useCallback(() => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
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

  // Listen for global mobile header "New" event
  useEffect(() => {
    const handler = () => newConversation();
    window.addEventListener('jaro-new-chat', handler);
    return () => window.removeEventListener('jaro-new-chat', handler);
  }, [newConversation]);

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
    const flushContent = () => {
      if (contentFrame != null) cancelAnimationFrame(contentFrame);
      contentFrame = null;
      updateMessage(conversationId, assistantId, { content: accumulated });
    };

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          message: query,
          history: priorHistory,
          context: requestContext,
          memoryEnabled,
          attachments: messageAttachments,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errPayload = await response.json().catch(() => null);
        throw new Error(errPayload?.error || `Request failed with HTTP status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const event = JSON.parse(raw);
            if (event.type === 'stage') {
              const stageObj = event.stage && typeof event.stage === 'object'
                ? event.stage
                : { id: event.stage, status: event.status ?? 'completed', detail: event.detail };
              updateMessage(conversationId, assistantId, (message) => ({
                ...message,
                stages: [
                  ...(message.stages ?? []).filter((s) => s.id !== stageObj.id),
                  stageObj,
                ],
              }));
            } else if (event.type === 'token' || event.type === 'delta') {
              const textPiece = event.text ?? event.delta ?? '';
              accumulated += textPiece;
              if (contentFrame == null) {
                contentFrame = requestAnimationFrame(flushContent);
              }
            } else if (event.type === 'sources') {
              updateMessage(conversationId, assistantId, { sources: event.sources });
            } else if (event.type === 'artifact') {
              updateMessage(conversationId, assistantId, { artifact: event.artifact });
            } else if (event.type === 'complete' || event.type === 'done') {
              flushContent();
              updateMessage(conversationId, assistantId, {
                status: 'complete',
                intent: event.intent,
                suggestions: event.suggestions,
                dataTimestamp: event.dataTimestamp,
              });
            } else if (event.type === 'error') {
              throw new Error(event.message || event.error || 'Stream received error signal.');
            }
          } catch (parseError) {
            console.warn('[Research Stream Parse Error]', parseError);
          }
        }
      }
      flushContent();
      updateMessage(conversationId, assistantId, { status: 'complete' });
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        const errMsg = err instanceof Error ? err.message : 'Research pipeline encountered an unexpected issue.';
        updateMessage(conversationId, assistantId, {
          status: 'error',
          error: errMsg,
          content: accumulated || 'An error occurred while analyzing the company. Please retry.',
        });
      }
    } finally {
      if (contentFrame != null) cancelAnimationFrame(contentFrame);
      abortRef.current = null;
      setIsStreaming(false);
      // Only focus on desktop/non-touch to prevent keyboard viewport jump on mobile
      if (typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches) {
        inputRef.current?.focus();
      }
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
      {/* Desktop conversation title and header (Clean, hidden on mobile to avoid redundant header rows) */}
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
            className="btn-new-chat desktop-only-btn"
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

      {/* Mobile-only compact title pill when messages exist */}
      {current.messages.length > 0 && (
        <div className="mobile-conversation-title-bar" aria-hidden="true">
          <span>{current.title || 'Research Conversation'}</span>
        </div>
      )}

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
                <span className="brand-label">JARO AI · FINANCIAL INTELLIGENCE FOR INVESTORS</span>
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
          {/* Bottom spacer ensures the final lines of the response can always scroll cleanly above the floating composer */}
          <div className="assistant-bottom-spacer" style={{ height: '7.5rem', width: '100%', flexShrink: 0, pointerEvents: 'none' }} aria-hidden="true" />
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
            <Paperclip size={16} />
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
              event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 140)}px`;
            }}
            rows={1}
            placeholder="Ask me anything about stocks, companies, markets or your portfolio..."
            disabled={isStreaming}
            aria-label="Ask Jaro AI"
            enterKeyHint="send"
            autoComplete="off"
            spellCheck={false}
          />
          {isStreaming ? (
            <button className="composer-send stop" onClick={stop} title="Stop response" aria-label="Stop generating response"><Square size={12} fill="currentColor" /></button>
          ) : (
            <button className="composer-send" onClick={() => sendMessage(input, true)} disabled={!input.trim()} title="Send" aria-label="Send message"><Send size={15} /></button>
          )}
        </div>

        <p className="composer-disclaimer">Source-grounded research <span>·</span> Market quotes may be delayed <span>·</span> Not investment advice</p>
      </div>
    </div>
  );
}
