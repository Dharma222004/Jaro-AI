'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Sparkles, Bot, User, RefreshCw, Copy, Check } from 'lucide-react';
import type { ResearchReport } from '@/types/research';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface Props {
  report: ResearchReport;
}



/* ── Inline markdown renderer ─────────────────────────────────────────── */
function formatInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{p.slice(2, -2)}</strong>
      : p
  );
}

function renderContent(text: string) {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('|') && lines[i + 1]?.trim().match(/^\|[-| ]+\|$/)) {
      const headers = line.trim().split('|').filter(Boolean).map(h => h.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim().split('|').filter(Boolean).map(c => c.trim()));
        i++;
      }
      out.push(
        <div key={`tbl-${i}`} style={{ overflowX: 'auto', margin: '0.75rem 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr>{headers.map((h, j) => <th key={j} style={{ padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--border-default)', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600 }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {row.map((cell, ci) => <td key={ci} style={{ padding: '0.4rem 0.75rem', color: 'var(--text-secondary)' }}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (line.startsWith('### ')) out.push(<p key={i} style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--accent)', margin: '0.9rem 0 0.2rem' }}>{line.slice(4)}</p>);
    else if (line.startsWith('## ')) out.push(<p key={i} style={{ fontWeight: 700, fontSize: '0.93rem', color: 'var(--text-primary)', margin: '0.9rem 0 0.2rem' }}>{line.slice(3)}</p>);
    else if (line.startsWith('- ') || line.startsWith('* ')) out.push(<li key={i} style={{ fontSize: '0.87rem', color: 'var(--text-secondary)', lineHeight: 1.7, marginLeft: '1.1rem', listStyleType: 'disc' }}>{formatInline(line.slice(2))}</li>);
    else if (line.startsWith('---')) out.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid var(--border-subtle)', margin: '0.7rem 0' }} />);
    else if (line.trim() === '') out.push(<div key={i} style={{ height: '0.3rem' }} />);
    else out.push(<p key={i} style={{ fontSize: '0.87rem', color: 'var(--text-secondary)', lineHeight: 1.75 }}>{formatInline(line)}</p>);
    i++;
  }
  return out;
}

/* ── Typing dots ──────────────────────────────────────────────────────── */
function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: '4px', padding: '4px 0', alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--accent)', animation: `chatPulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
      ))}
      <style>{`@keyframes chatPulse { 0%,80%,100%{opacity:0.3;transform:scale(0.85)} 40%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────── */
export function ResearchChat({ report }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  /* Auto-scroll to latest message */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: trimmed, timestamp: new Date() };
    const assistantId = `a-${Date.now() + 1}`;

    setMessages(prev => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '', timestamp: new Date() }]);
    setInput('');
    if (inputRef.current) { inputRef.current.style.height = 'auto'; }
    setIsStreaming(true);

    try {
      const res = await fetch('/api/research/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, report, history: messages }),
      });
      if (!res.body) throw new Error('No body');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value, { stream: true }).split('\n')) {
          if (line.startsWith('data: ')) {
            const token = line.slice(6);
            if (token === '[DONE]') break;
            full += token;
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: full } : m));
          }
        }
      }
    } catch {
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: 'Something went wrong. Please try again.' } : m));
    } finally {
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isStreaming, messages, report]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const hasMessages = messages.length > 0;

  return (
    <>
      {/* Inject spin keyframe once */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes chatFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/*
        TRUE ChatGPT layout:
        - Outer section fills 100vh exactly
        - Header: fixed height at top
        - Messages: flex-1, overflow-y auto (scrolls WITHIN)
        - Input: fixed height at bottom — ALWAYS VISIBLE
      */}
      <section
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-base)',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.85rem 1.5rem',
            background: 'var(--header-bg)',
            backdropFilter: 'blur(16px)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--gradient-brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Sparkles size={15} style={{ color: '#fff' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>Jaro AI Analyst</p>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {report.company.name} · Ask anything about this company
            </p>
          </div>
          {hasMessages && (
            <button
              onClick={() => setMessages([])}
              style={{ background: 'none', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '0.3rem 0.65rem', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.73rem', display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}
            >
              <RefreshCw size={11} style={{ flexShrink: 0 }} />
              New chat
            </button>
          )}
        </div>

        {/* ── Scrollable messages area ── */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '1.5rem 1.5rem 0.5rem',
          }}
        >
          <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '0' }}>


            {/* Message thread */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  alignItems: 'flex-start',
                  gap: '0.65rem',
                  marginBottom: '1.25rem',
                  animation: 'chatFadeIn 0.25s ease',
                }}
              >
                {/* Avatar */}
                <div style={{ width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: msg.role === 'user' ? 'var(--bg-elevated)' : 'var(--gradient-brand)', border: msg.role === 'user' ? '1px solid var(--border-subtle)' : 'none', marginTop: '2px' }}>
                  {msg.role === 'user' ? <User size={14} style={{ color: 'var(--text-muted)' }} /> : <Bot size={14} style={{ color: '#fff' }} />}
                </div>

                {/* Content */}
                <div style={{ maxWidth: 'min(78%, 560px)', minWidth: 0 }}>
                  {msg.role === 'user' ? (
                    <div style={{ background: 'var(--primary)', color: '#fff', padding: '0.65rem 1rem', borderRadius: '16px 16px 4px 16px', fontSize: '0.88rem', lineHeight: 1.6, fontWeight: 500 }}>
                      {msg.content}
                    </div>
                  ) : (
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '4px 16px 16px 16px', padding: '0.85rem 1rem' }}>
                      {msg.content === '' ? <TypingDots /> : (
                        <>
                          {renderContent(msg.content)}
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.4rem' }}>
                            <button onClick={() => copy(msg.id, msg.content)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.69rem', display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.15rem 0.3rem', borderRadius: '4px' }}>
                              {copiedId === msg.id ? <Check size={10} style={{ color: 'var(--positive)' }} /> : <Copy size={10} />}
                              {copiedId === msg.id ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            <div ref={bottomRef} style={{ height: '1px' }} />
          </div>
        </div>

        {/* ── Input — always pinned at the bottom ── */}
        <div
          style={{
            flexShrink: 0,
            padding: '0.85rem 1.5rem 1.1rem',
            background: 'var(--bg-base)',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ maxWidth: '720px', margin: '0 auto' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: '0.5rem',
                background: 'var(--bg-surface)',
                border: `1.5px solid ${isStreaming ? 'var(--accent)' : 'var(--border-default)'}`,
                borderRadius: '14px',
                padding: '0.55rem 0.55rem 0.55rem 1rem',
                transition: 'border-color 0.2s',
                boxShadow: isStreaming ? '0 0 0 3px rgba(20,184,166,0.1)' : 'none',
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={isStreaming ? 'Jaro AI is responding…' : `Ask anything about ${report.company.name}…`}
                disabled={isStreaming}
                rows={1}
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  resize: 'none',
                  lineHeight: 1.6,
                  maxHeight: '140px',
                  overflowY: 'auto',
                  scrollbarWidth: 'none',
                  paddingTop: '2px',
                }}
                onInput={e => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
                }}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isStreaming}
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '9px',
                  border: 'none',
                  background: input.trim() && !isStreaming ? 'var(--primary)' : 'var(--border-default)',
                  cursor: input.trim() && !isStreaming ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.2s',
                  flexShrink: 0,
                }}
              >
                <Send size={14} style={{ color: input.trim() && !isStreaming ? '#fff' : 'var(--text-muted)' }} />
              </button>
            </div>
            <p style={{ textAlign: 'center', fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '0.45rem' }}>
              Enter to send · Shift+Enter for new line · Grounded in {report.company.name} research context
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
