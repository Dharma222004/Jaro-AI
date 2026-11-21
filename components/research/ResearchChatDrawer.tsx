'use client';

import React, { useState, useRef, useCallback } from 'react';
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
  Globe,
  ExternalLink,
} from 'lucide-react';
import type { ResearchReport } from '@/types/research';

export interface ChatSourceLink {
  title: string;
  url: string;
  domain: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: ChatSourceLink[];
}

interface Props {
  report: ResearchReport;
  mode?: 'docked' | 'full' | 'floating';
  onClose?: () => void;
}

const STARTER_QUESTIONS = [
  'Generate Investment-Readiness Snapshot & Valuation Matrix',
  'What are the key technical support, resistance & DMA levels?',
  'Summarize latest news, order book & management concall guidance',
  'Compare fundamentals & P/E with top sector peers via web search',
];

function createWelcomeMessage(companyName: string, id = 'welcome'): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: `Welcome to Jaro AI Institutional Chat. I have synthesized the audited regulatory filings, Screener financial statements, and concall disclosures for **${companyName}**.\n\nYou can click **"Generate Investment-Readiness Snapshot"** below or ask any specific doubt regarding their margins, debt profile, future catalysts, or valuation.`,
    timestamp: new Date(0),
  };
}

export function ResearchChatDrawer({ report }: Props) {
  const company = report.company;
  const [isOpen, setIsOpen] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createWelcomeMessage(company.name)]);
  const [messageSequence, setMessageSequence] = useState(0);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);

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
      analystVerdict: report.analystVerdict,
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
        revenuePeriod: report.financials?.revenue?.period,
        revenueGrowth: report.financials?.revenueGrowth?.value,
        ebitda: report.financials?.ebitda?.value,
        profit: report.financials?.profit?.value,
        profitGrowth: report.financials?.profitGrowth?.value,
        eps: report.financials?.eps?.value,
        debt: report.financials?.debt?.value,
        cash: report.financials?.cash?.value,
        netDebt: report.financials?.netDebt?.value,
        debtToEquity: report.financials?.debtToEquity?.value,
        ebitdaMargin: report.profitability?.ebitdaMargin?.value,
        netMargin: report.profitability?.netMargin?.value,
        roce: report.profitability?.roce?.value,
        roe: report.profitability?.roe?.value,
      },
      technicalAnalysis: report.technicalAnalysis,
      growthDrivers: report.growthDrivers?.slice(0, 6),
      futureCatalysts: report.futureCatalysts?.slice(0, 6),
      strengths: report.strengths?.slice(0, 6),
      risks: report.risks?.slice(0, 6)?.map((r) => ({
        category: r.category,
        risk: r.risk,
        severity: r.severity,
        description: r.description,
        whyItMatters: r.whyItMatters,
      })),
      managementCommentary: report.managementCommentary?.slice(0, 6),
      recentDevelopments: report.recentDevelopments?.slice(0, 6)?.map((d) => ({
        headline: d.headline,
        whatHappened: d.whatHappened || d.description,
        whyItMatters: d.whyItMatters,
        date: d.date,
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
      sources: report.sources?.slice(0, 10),
    };
  }, [report]);

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || isStreaming) return;

    const sequence = messageSequence + 1;
    setMessageSequence(sequence);

    const userMessage: ChatMessage = {
      id: `usr-${sequence}`,
      role: 'user',
      content: query,
      timestamp: new Date(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);

    const assistantMsgId = `asst-${sequence}`;
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

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.delta) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMsgId
                      ? { ...msg, content: msg.content + parsed.delta }
                      : msg
                  )
                );
              } else if (parsed.sources && Array.isArray(parsed.sources)) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMsgId
                      ? { ...msg, sources: parsed.sources }
                      : msg
                  )
                );
              } else if (parsed.error) {
                const errorContent = `\n\n*Error: ${parsed.error}*`;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMsgId
                      ? { ...msg, content: msg.content + errorContent }
                      : msg
                  )
                );
              }
            } catch {
              // Ignore partial JSON
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
        ...createWelcomeMessage(company.name, 'welcome-reset'),
        content: `Conversation reset. Ask any question or clarify doubts regarding **${company.name}**.`,
      },
    ]);
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Floating mode closed/minimized states
  if (mode === 'floating' && !isOpen) {
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
        >
          <MessageSquare size={16} style={{ color: 'var(--accent)' }} />
          <span>Ask Analyst AI ({company.ticker})</span>
        </button>
      </div>
    );
  }

  if (mode === 'floating' && isMinimized) {
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
            <Sparkles size={14} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Jaro AI Analyst: {company.name}
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

  const containerStyle: React.CSSProperties =
    mode === 'docked'
      ? {
          width: '100%',
          height: 'calc(100vh - 3.6rem)',
          position: 'sticky',
          top: '3.6rem',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border-subtle)',
          overflow: 'hidden',
        }
      : mode === 'full'
      ? {
          width: '100%',
          maxWidth: '920px',
          margin: '0 auto',
          height: 'calc(100vh - 5.5rem)',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '12px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          overflow: 'hidden',
        }
      : {
          position: 'fixed',
          bottom: '1.5rem',
          right: '1.5rem',
          zIndex: 50,
          width: isExpanded ? 'min(860px, calc(100vw - 2rem))' : 'min(560px, calc(100vw - 2rem))',
          height: isExpanded ? 'min(780px, calc(100vh - 3.5rem))' : 'min(640px, calc(100vh - 4.5rem))',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '14px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 16px 48px -4px rgba(0, 0, 0, 0.85)',
          overflow: 'hidden',
        };

  return (
    <div style={containerStyle}>
      {/* Chat Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.85rem 1.15rem',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                Jaro AI Analyst Chat
              </h3>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                · Web Search + Dossier Grounded
              </span>
            </div>
            <p style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
              {company.name} ({company.ticker}) · Live follow-up & market Q&A
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          {mode === 'floating' && (
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
              title={isExpanded ? 'Standard Size' : 'Expand Width'}
            >
              {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}

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

          {mode === 'floating' && (
            <>
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
            </>
          )}

          {onClose && mode !== 'floating' && (
            <button
              onClick={onClose}
              style={{
                padding: '0.4rem',
                borderRadius: '6px',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Hide Chat Panel"
            >
              <X size={15} />
            </button>
          )}
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
                maxWidth: isUser ? '86%' : '100%',
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
                  fontSize: '0.85rem',
                  lineHeight: 1.6,
                  wordBreak: 'break-word',
                  width: isUser ? 'auto' : '100%',
                }}
              >
                {isUser ? (
                  <p style={{ margin: 0, color: '#FFFFFF', fontWeight: 500 }}>{msg.content}</p>
                ) : (
                  <MarkdownRenderer content={msg.content} />
                )}

                {/* Grounded Web Sources cited in this response */}
                {!isUser && msg.sources && msg.sources.length > 0 && (
                  <div
                    style={{
                      marginTop: '0.75rem',
                      paddingTop: '0.6rem',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        fontSize: '0.68rem',
                        color: 'var(--text-muted)',
                        marginBottom: '0.35rem',
                        fontWeight: 600,
                      }}
                    >
                      <Globe size={11} style={{ color: 'var(--accent)' }} />
                      <span>Grounded Web Sources</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {msg.sources.slice(0, 5).map((src, sIdx) => (
                        <a
                          key={sIdx}
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            fontSize: '0.7rem',
                            color: 'var(--text-secondary)',
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '5px',
                            padding: '0.2rem 0.45rem',
                            textDecoration: 'none',
                            maxWidth: '210px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={src.title}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {src.domain || src.title}
                          </span>
                          <ExternalLink size={9} style={{ flexShrink: 0, color: 'var(--accent)' }} />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Assistant Copy Helper */}
                {!isUser && msg.content && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      marginTop: '0.5rem',
                      paddingTop: '0.35rem',
                      borderTop: '1px solid var(--border-subtle)',
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
                          <span>Copy response</span>
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: 'var(--text-muted)',
              fontSize: '0.78rem',
              paddingLeft: '2.3rem',
            }}
          >
            <Globe size={13} style={{ color: 'var(--accent)' }} />
            <span>Searching live web & analyzing dossier for your query...</span>
          </div>
        )}

        {/* Follow-up Analyst Prompts */}
        {!isStreaming && messages.length <= 2 && (
          <div style={{ marginTop: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            <p
              style={{
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                fontWeight: 600,
              }}
            >
              Continue Analyst Deep-Dive:
            </p>
            {STARTER_QUESTIONS.map((q, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(q)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.55rem 0.8rem',
                  borderRadius: '8px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.8rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {idx === 0 && <BarChart2 size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                  <span>{q}</span>
                </div>
                <ArrowRight size={12} style={{ color: 'var(--accent)', flexShrink: 0, marginLeft: '0.5rem' }} />
              </button>
            ))}
          </div>
        )}

      </div>

      {/* Sticky Input Footer */}
      <div
        style={{
          padding: '0.75rem 1rem',
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)',
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
            padding: '0.5rem 0.65rem',
          }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask about ${company.ticker}, peer comparison, technicals, or any finance question...`}
            disabled={isStreaming}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              resize: 'none',
              lineHeight: 1.45,
              maxHeight: '90px',
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

        <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.35rem', textAlign: 'center' }}>
          Live Google Search Grounding + Verified Filings · Press Enter to ask
        </p>
      </div>
    </div>
  );
}

/**
 * Institutional GFM Markdown Renderer:
 * Handles Markdown tables, bold headers, dividers, bullet points & code snippets
 */
function isMarkdownTableRow(line: string) {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|');
}

function renderMarkdownTable(tableLines: string[], key: number) {
  const parseCells = (line: string) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());

  const headers = parseCells(tableLines[0]);
  const rows = tableLines.slice(2).map(parseCells);

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
            {headers.map((header, headerIndex) => (
              <th
                key={headerIndex}
                style={{
                  padding: '0.6rem 0.85rem',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  letterSpacing: '0.01em',
                }}
              >
                {renderInlineMarkdown(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              style={{
                borderBottom: rowIndex < rows.length - 1 ? '1px solid var(--border-default)' : 'none',
                background: rowIndex % 2 === 1 ? 'rgba(255, 255, 255, 0.018)' : 'transparent',
              }}
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
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
}

function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;

  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (isMarkdownTableRow(line)) {
      const tableLines = [trimmed];
      let tableEnd = index + 1;
      while (tableEnd < lines.length && isMarkdownTableRow(lines[tableEnd])) {
        tableLines.push(lines[tableEnd].trim());
        tableEnd += 1;
      }
      blocks.push(renderMarkdownTable(tableLines, index));
      index = tableEnd - 1;
      continue;
    }

    if (trimmed === '---' || trimmed === '***') {
      blocks.push(
        <hr
          key={`hr-${index}`}
          style={{
            border: 'none',
            height: '1px',
            background: 'var(--border-default)',
            margin: '0.85rem 0',
          }}
        />
      );
      continue;
    }

    if (trimmed.startsWith('#### ')) {
      blocks.push(
        <h5
          key={`h4-${i}`}
          style={{
            fontSize: '0.88rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            margin: '0.8rem 0 0.3rem',
          }}
        >
          {renderInlineMarkdown(trimmed.slice(5))}
        </h5>
      );
      continue;
    }

    if (trimmed.startsWith('### ')) {
      blocks.push(
        <h4
          key={`h3-${index}`}
          style={{
            fontSize: '0.94rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            margin: '0.9rem 0 0.35rem',
          }}
        >
          {renderInlineMarkdown(trimmed.slice(4))}
        </h4>
      );
      continue;
    }

    if (trimmed.startsWith('## ')) {
      blocks.push(
        <h3
          key={`h2-${index}`}
          style={{
            fontSize: '1.02rem',
            fontWeight: 800,
            color: 'var(--text-primary)',
            margin: '1rem 0 0.4rem',
          }}
        >
          {renderInlineMarkdown(trimmed.slice(3))}
        </h3>
      );
      continue;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      blocks.push(
        <div key={`li-${index}`} style={{ display: 'flex', gap: '0.5rem', margin: '0.25rem 0', alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 700, lineHeight: 1.6 }}>•</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', lineHeight: 1.6 }}>
            {renderInlineMarkdown(trimmed.slice(2))}
          </span>
        </div>
      );
      continue;
    }

    if (trimmed.length === 0) {
      blocks.push(<div key={`sp-${index}`} style={{ height: '0.4rem' }} />);
      continue;
    }

    blocks.push(
      <p key={`p-${index}`} style={{ margin: '0.25rem 0', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.6 }}>
        {renderInlineMarkdown(line)}
      </p>
    );
  }

  return <div>{blocks}</div>;
}

function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);

  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={idx}
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            padding: '0.1rem 0.35rem',
            borderRadius: '4px',
            fontSize: '0.76rem',
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
