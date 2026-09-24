'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Send,
  X,
  Sparkles,
  RotateCcw,
  Minimize2,
  Maximize2,
  ChevronDown,
  Bot,
  User,
  Check,
  Copy,
  ArrowRight,
  BarChart2,
} from 'lucide-react';
import type { ResearchReport } from '@/types/research';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface Props {
  report: ResearchReport;
}

const STARTER_QUESTIONS = [
  'Generate Investment-Readiness Snapshot',
  'Summarize management concall guidance & outlook',
  'What are the primary balance sheet & operational risks?',
  'Explain current valuation multiples & P/E positioning',
];

export function ResearchChatDrawer({ report }: Props) {
  const [isOpen, setIsOpen] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const company = report.company;

  // Auto-scroll on new tokens / messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (isOpen && !isMinimized) {
      scrollToBottom();
    }
  }, [messages, isOpen, isMinimized, scrollToBottom]);

  // Initial welcome message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: `Welcome to Jaro AI Institutional Chat. I have synthesized the audited regulatory filings, Screener financial statements, and concall disclosures for **${company.name}**.\n\nYou can click **"Generate Investment-Readiness Snapshot"** below or ask any specific doubt regarding their margins, debt profile, future catalysts, or valuation.`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [company.name, messages.length]);

  // Extract comprehensive structured context from report
  const buildReportContext = useCallback(() => {
    return {
      company: {
        name: report.company.name,
        ticker: report.company.ticker,
        exchange: report.company.exchange,
        sector: report.company.sector,
        industry: report.company.industry,
        description: report.company.description,
      },
      valuation: {
        marketCap: report.valuation?.marketCap?.value,
        pe: report.valuation?.pe?.value,
        pb: report.valuation?.pb?.value,
        evEbitda: report.valuation?.evEbitda?.value,
        ev: report.valuation?.ev?.value,
        dividendYield: report.valuation?.dividendYield?.value,
      },
      researchSummary: report.researchSummary,
      financialHighlights: {
        revenue: report.financials?.revenue?.value,
        ebitda: report.financials?.ebitda?.value,
        profit: report.financials?.profit?.value,
        eps: report.financials?.eps?.value,
        debt: report.financials?.debt?.value,
        netDebt: report.financials?.netDebt?.value,
        debtToEquity: report.financials?.debtToEquity?.value,
        operatingProfit: report.financials?.operatingProfit?.value,
        freeCashFlow: report.financials?.freeCashFlow?.value,
        ebitdaMargin: report.profitability?.ebitdaMargin?.value,
        netMargin: report.profitability?.netMargin?.value,
        operatingMargin: report.profitability?.operatingMargin?.value,
        roce: report.profitability?.roce?.value,
        roe: report.profitability?.roe?.value,
      },
      growthDrivers: report.growthDrivers?.slice(0, 5),
      futureCatalysts: report.futureCatalysts?.slice(0, 5),
      strengths: report.strengths?.slice(0, 5),
      risks: report.risks?.slice(0, 6)?.map((r) => ({
        category: r.category,
        risk: r.risk,
        severity: r.severity,
        description: r.description,
        evidence: r.evidence,
      })),
      managementCommentary: report.managementCommentary?.slice(0, 6),
      recentDevelopments: report.recentDevelopments?.slice(0, 6)?.map((d) => ({
        headline: d.headline,
        description: d.description,
        whatHappened: d.whatHappened,
      })),
      shareholding: report.shareholding
        ? {
            promoter: report.shareholding.promoter?.value,
            fii: report.shareholding.fii?.value,
            dii: report.shareholding.dii?.value,
            public: report.shareholding.public?.value,
            pledged: report.shareholding.pledged?.value,
          }
        : undefined,
    };
  }, [report]);

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || isStreaming) return;

    const userMessage: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: new Date(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);

    const assistantMsgId = `asst-${Date.now()}`;
    const initialAssistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };

    setMessages([...newMessages, initialAssistantMsg]);

    try {
      const response = await fetch('/api/research/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: {
            name: company.name,
            ticker: company.ticker,
            exchange: company.exchange,
            sector: company.sector,
            industry: company.industry,
          },
          reportContext: buildReportContext(),
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to connect to research chat service.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.delta) {
                accumulatedContent += parsed.delta;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMsgId
                      ? { ...msg, content: accumulatedContent }
                      : msg
                  )
                );
              } else if (parsed.error) {
                accumulatedContent += `\n\n*Error: ${parsed.error}*`;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMsgId
                      ? { ...msg, content: accumulatedContent }
                      : msg
                  )
                );
              }
            } catch {
              // Ignore parse chunk errors
            }
          }
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unable to generate reply';
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? { ...msg, content: `Apologies, I encountered an issue: ${errorMsg}. Please try asking again.` }
            : msg
        )
      );
    } finally {
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleResetChat = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: 'assistant',
        content: `Conversation reset. Ask any question or clarify doubts regarding **${company.name}**.`,
        timestamp: new Date(),
      },
    ]);
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Minimized / Closed Floating Launcher Pill
  if (!isOpen) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: '1.75rem',
          right: '1.75rem',
          zIndex: 50,
        }}
      >
        <button
          onClick={() => {
            setIsOpen(true);
            setIsMinimized(false);
          }}
          className="card"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.65rem',
            padding: '0.75rem 1.25rem',
            borderRadius: '9999px',
            background: 'var(--bg-surface)',
            border: '1.5px solid var(--accent)',
            boxShadow: '0 8px 24px rgba(37, 99, 235, 0.35)',
            cursor: 'pointer',
            color: 'var(--text-primary)',
            fontWeight: 600,
            fontSize: '0.88rem',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 12px 30px rgba(37, 99, 235, 0.5)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 24px rgba(37, 99, 235, 0.35)';
          }}
        >
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: 'var(--brand-jade)',
              boxShadow: '0 0 8px var(--brand-jade)',
            }}
          />
          <MessageSquare size={16} style={{ color: 'var(--accent)' }} />
          <span>Ask AI about {company.name}</span>
          <span
            style={{
              fontSize: '0.7rem',
              padding: '0.15rem 0.45rem',
              borderRadius: '10px',
              background: 'var(--accent-dim)',
              color: 'var(--text-accent)',
              fontWeight: 700,
            }}
          >
            {messages.length > 1 ? `${messages.length - 1}` : 'Active'}
          </span>
        </button>
      </div>
    );
  }

  // Minimized Window Header Bar
  if (isMinimized) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: '1.5rem',
          right: '1.75rem',
          zIndex: 50,
          width: '360px',
        }}
      >
        <div
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.75rem 1rem',
            borderRadius: '10px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.7)',
            cursor: 'pointer',
          }}
          onClick={() => setIsMinimized(false)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'var(--brand-jade)',
                boxShadow: '0 0 6px var(--brand-jade)',
              }}
            />
            <span style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              AI Chat: {company.name}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsMinimized(false);
              }}
              style={{ padding: '0.3rem', color: 'var(--text-muted)' }}
              title="Expand"
            >
              <Maximize2 size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
              }}
              style={{ padding: '0.3rem', color: 'var(--text-muted)' }}
              title="Close"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Full Expanded Interactive Chat Box
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1.5rem',
        right: '1.5rem',
        zIndex: 50,
        width: isExpanded ? 'min(860px, calc(100vw - 2rem))' : 'min(580px, calc(100vw - 2rem))',
        height: isExpanded ? 'min(780px, calc(100vh - 3.5rem))' : 'min(640px, calc(100vh - 4.5rem))',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '14px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        boxShadow: '0 16px 48px -4px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(37, 99, 235, 0.2)',
        overflow: 'hidden',
        animation: 'slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        transition: 'width 0.2s ease, height 0.2s ease',
      }}
    >
      {/* Drawer Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.85rem 1.15rem',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-default)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div
            style={{
              width: '1.85rem',
              height: '1.85rem',
              borderRadius: '7px',
              background: 'var(--gradient-brand)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
            }}
          >
            <Sparkles size={14} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                Jaro AI Analyst
              </h3>
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--brand-jade)',
                  boxShadow: '0 0 6px var(--brand-jade)',
                }}
                title="Context Active & Grounded"
              />
            </div>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
              {company.name} ({company.ticker})
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              padding: '0.4rem',
              borderRadius: '6px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={isExpanded ? 'Standard Size' : 'Expand Width for Tables'}
          >
            {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>

          <button
            onClick={handleResetChat}
            style={{
              padding: '0.4rem',
              borderRadius: '6px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Reset Conversation"
          >
            <RotateCcw size={14} />
          </button>

          <button
            onClick={() => setIsMinimized(true)}
            style={{
              padding: '0.4rem',
              borderRadius: '6px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Minimize"
          >
            <ChevronDown size={16} />
          </button>

          <button
            onClick={() => setIsOpen(false)}
            style={{
              padding: '0.4rem',
              borderRadius: '6px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Close Chat"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Message Thread Body */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1.15rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.15rem',
          scrollbarWidth: 'thin',
        }}
      >
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                gap: '0.65rem',
                alignItems: 'flex-start',
                alignSelf: isUser ? 'flex-end' : 'flex-start',
                maxWidth: isUser ? '85%' : '98%',
                width: isUser ? 'auto' : '100%',
              }}
            >
              {!isUser && (
                <div
                  style={{
                    width: '1.65rem',
                    height: '1.65rem',
                    borderRadius: '6px',
                    background: 'var(--accent-dim)',
                    border: '1px solid var(--border-default)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent)',
                    flexShrink: 0,
                    marginTop: '0.15rem',
                  }}
                >
                  <Bot size={13} />
                </div>
              )}

              <div
                style={{
                  position: 'relative',
                  padding: '0.85rem 1.05rem',
                  borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  background: isUser ? 'var(--primary)' : 'var(--bg-elevated)',
                  border: isUser ? 'none' : '1px solid var(--border-default)',
                  color: isUser ? '#FFFFFF' : 'var(--text-primary)',
                  fontSize: '0.86rem',
                  lineHeight: 1.6,
                  wordBreak: 'break-word',
                  width: isUser ? 'auto' : '100%',
                }}
              >
                {/* Structured GFM Table & Markdown Content */}
                <MarkdownRenderer content={msg.content} />

                {/* Assistant Copy Helper */}
                {!isUser && msg.content && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      marginTop: '0.6rem',
                      paddingTop: '0.4rem',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <button
                      onClick={() => handleCopy(msg.id, msg.content)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontSize: '0.7rem',
                        color: 'var(--text-muted)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check size={11} style={{ color: 'var(--brand-jade)' }} />
                          <span style={{ color: 'var(--brand-jade)' }}>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy size={11} />
                          <span>Copy markdown</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {isUser && (
                <div
                  style={{
                    width: '1.65rem',
                    height: '1.65rem',
                    borderRadius: '6px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-secondary)',
                    flexShrink: 0,
                    marginTop: '0.15rem',
                  }}
                >
                  <User size={13} />
                </div>
              )}
            </div>
          );
        })}

        {/* Streaming Loading Indicator */}
        {isStreaming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.8rem', paddingLeft: '2.3rem' }}>
            <div
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'var(--accent)',
                animation: 'pulse-dot 1s infinite',
              }}
            />
            <span>Jaro AI is calculating metrics & generating snapshot...</span>
          </div>
        )}

        {/* Starter Doubt Suggestions (When conversation is fresh) */}
        {messages.length <= 1 && (
          <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Suggested Inquiries
            </p>
            {STARTER_QUESTIONS.map((q, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(q)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.6rem 0.85rem',
                  borderRadius: '8px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.82rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-default)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {idx === 0 && <BarChart2 size={13} style={{ color: 'var(--accent)' }} />}
                  <span>{q}</span>
                </div>
                <ArrowRight size={12} style={{ color: 'var(--accent)', flexShrink: 0, marginLeft: '0.5rem' }} />
              </button>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Sticky Input Footer */}
      <div
        style={{
          padding: '0.75rem 1rem',
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-default)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: '9px',
            padding: '0.45rem 0.65rem',
          }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask any doubt about ${company.ticker || company.name}...`}
            disabled={isStreaming}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: '0.86rem',
              resize: 'none',
              lineHeight: 1.4,
              maxHeight: '80px',
              fontFamily: 'inherit',
            }}
          />

          <button
            onClick={() => handleSendMessage()}
            disabled={!input.trim() || isStreaming}
            style={{
              width: '2rem',
              height: '2rem',
              borderRadius: '7px',
              background: input.trim() && !isStreaming ? 'var(--primary)' : 'transparent',
              color: input.trim() && !isStreaming ? '#FFFFFF' : 'var(--text-muted)',
              border: 'none',
              cursor: input.trim() && !isStreaming ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
              flexShrink: 0,
            }}
          >
            <Send size={13} />
          </button>
        </div>

        <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.4rem', textAlign: 'center' }}>
          Deterministic equity synthesis · Grounded in regulatory filings & Screener
        </p>
      </div>
    </div>
  );
}

/**
 * Institutional GFM Markdown Renderer:
 * Handles Markdown tables, bold headers, dividers, bullet points & code snippets
 */
function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;

  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let tableBuffer: string[] = [];

  const flushTable = (key: number) => {
    if (tableBuffer.length === 0) return null;
    const tableLines = [...tableBuffer];
    tableBuffer = [];

    // Table parsing: line 0 = headers, line 1 = delimiter, lines 2+ = rows
    const headerLine = tableLines[0];
    const dataLines = tableLines.slice(2);

    const parseCells = (line: string) =>
      line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());

    const headers = parseCells(headerLine);
    const rows = dataLines.map(parseCells);

    return (
      <div
        key={`tbl-${key}`}
        style={{
          overflowX: 'auto',
          margin: '0.85rem 0',
          borderRadius: '8px',
          border: '1px solid var(--border-default)',
          background: 'var(--bg-surface)',
          maxWidth: '100%',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)' }}>
              {headers.map((h, hIdx) => (
                <th
                  key={hIdx}
                  style={{
                    padding: '0.6rem 0.85rem',
                    color: '#FFFFFF',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    letterSpacing: '0.01em',
                  }}
                >
                  {renderInlineMarkdown(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rIdx) => (
              <tr
                key={rIdx}
                style={{
                  borderBottom: rIdx < rows.length - 1 ? '1px solid var(--border-default)' : 'none',
                  background: rIdx % 2 === 1 ? 'rgba(255, 255, 255, 0.018)' : 'transparent',
                }}
              >
                {row.map((cell, cIdx) => (
                  <td
                    key={cIdx}
                    style={{
                      padding: '0.55rem 0.85rem',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.5,
                      verticalAlign: 'top',
                    }}
                  >
                    {renderInlineMarkdown(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check if table row
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      tableBuffer.push(trimmed);
      continue;
    } else if (tableBuffer.length > 0) {
      const rendered = flushTable(i);
      if (rendered) blocks.push(rendered);
    }

    // Horizontal Rule / Divider
    if (trimmed === '---' || trimmed === '***') {
      blocks.push(
        <hr
          key={`hr-${i}`}
          style={{
            border: 'none',
            height: '1px',
            background: 'var(--border-default)',
            margin: '1rem 0',
          }}
        />
      );
      continue;
    }

    // Heading 3
    if (trimmed.startsWith('### ')) {
      blocks.push(
        <h4
          key={`h3-${i}`}
          style={{
            fontSize: '0.96rem',
            fontWeight: 700,
            color: '#FFFFFF',
            margin: '0.95rem 0 0.4rem',
            letterSpacing: '-0.01em',
          }}
        >
          {renderInlineMarkdown(trimmed.slice(4))}
        </h4>
      );
      continue;
    }

    // Heading 2
    if (trimmed.startsWith('## ')) {
      blocks.push(
        <h3
          key={`h2-${i}`}
          style={{
            fontSize: '1.05rem',
            fontWeight: 800,
            color: '#FFFFFF',
            margin: '1.15rem 0 0.45rem',
            letterSpacing: '-0.02em',
          }}
        >
          {renderInlineMarkdown(trimmed.slice(3))}
        </h3>
      );
      continue;
    }

    // Bullet items
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      blocks.push(
        <div key={`li-${i}`} style={{ display: 'flex', gap: '0.5rem', margin: '0.25rem 0', alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 700, lineHeight: 1.6 }}>•</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.6 }}>
            {renderInlineMarkdown(trimmed.slice(2))}
          </span>
        </div>
      );
      continue;
    }

    // Empty space
    if (trimmed.length === 0) {
      blocks.push(<div key={`sp-${i}`} style={{ height: '0.4rem' }} />);
      continue;
    }

    // Regular paragraphs
    blocks.push(
      <p key={`p-${i}`} style={{ margin: '0.25rem 0', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.6 }}>
        {renderInlineMarkdown(line)}
      </p>
    );
  }

  if (tableBuffer.length > 0) {
    const rendered = flushTable(lines.length);
    if (rendered) blocks.push(rendered);
  }

  return <div>{blocks}</div>;
}

/**
 * Parses bold text and inline code chips
 */
function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  // Split by bold (**...**) and code (`...`)
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);

  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} style={{ color: '#FFFFFF', fontWeight: 700 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={idx}
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            padding: '0.1rem 0.35rem',
            borderRadius: '4px',
            fontSize: '0.78rem',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-accent)',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
