import { NextRequest, NextResponse } from 'next/server';
import { streamChatWithGroq } from '@/lib/groq/client';
import { isGeminiConfigured, streamChatWithGemini } from '@/lib/gemini/client';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { company, reportContext, messages, message, report, history } = body;

    // Normalize messages from either ResearchChatDrawer or ResearchChat
    let normalizedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (Array.isArray(messages) && messages.length > 0) {
      normalizedMessages = messages.map((m: { role: 'user' | 'assistant'; content: string }) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || ''),
      }));
    } else if (typeof message === 'string' && message.trim()) {
      const prior = Array.isArray(history)
        ? history.map((m: { role: 'user' | 'assistant'; content: string }) => ({
            role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
            content: String(m.content || ''),
          }))
        : [];
      normalizedMessages = [...prior, { role: 'user', content: message.trim() }];
    }

    if (normalizedMessages.length === 0) {
      return NextResponse.json(
        { error: 'Messages array is required.' },
        { status: 400 }
      );
    }

    const activeCompany = company || report?.company;
    const companyName = activeCompany?.name || 'the Indian & Global Stock Market';
    const ticker = activeCompany?.ticker || '';
    const dossierContext = reportContext || report || null;

    const systemPrompt = `You are Jaro AI — Senior Institutional Equity Research Analyst & Financial Market Intelligence Agent.
You are in an interactive research session with an investor/analyst examining:
Primary Company / Context: ${companyName} ${ticker ? `(${activeCompany?.exchange || 'NSE'}: ${ticker})` : ''}
${activeCompany?.sector ? `Sector: ${activeCompany.sector}` : ''}
${activeCompany?.industry ? `Industry: ${activeCompany.industry}` : ''}

VERIFIED REPORT DOSSIER & SOURCE CONTEXT:
${dossierContext ? JSON.stringify(dossierContext, null, 2).slice(0, 18000) : 'General Finance & Stock Market Inquiry Mode.'}

CORE CAPABILITIES & OPERATING RULES:
1. LIVE WEB SEARCH + DOSSIER GROUNDING:
   - You have access to both the company's verified equity dossier above AND live Google Search grounding.
   - Whenever the user asks about the company's fundamentals, valuation, technicals, concall, latest news, peer comparison, OR any general finance, macroeconomic, sector, or stock market question, use the dossier AND live web search to give a complete, up-to-date, fact-grounded answer.
2. HIGH-LEVEL ANALYST STRUCTURE:
   - Structure your responses like a top-tier institutional analyst (clear headings, Markdown tables for financial numbers/comparisons, bullet points with bold key takeaways).
   - Always include exact figures, units (₹ Cr, %, x), and reporting periods when discussing financial metrics.
   - Cover Fundamental Values (ROE, ROCE, P/E, P/B, EV/EBITDA, Revenue/PAT growth, Debt/Equity), Technical Structure (50/200 DMA, RSI, Support/Resistance, 52W High/Low), Latest News & Catalysts, and Analyst Verdict/Recommendations whenever relevant.
3. INVESTMENT-READINESS SNAPSHOT TEMPLATE:
   - If asked for an "Investment-Readiness Snapshot", "Full Summary", or "Analyst Verdict", include:
     a) **Executive Thesis & Institutional Stance**
     b) **Key Fundamental & Valuation Matrix** (Markdown Table: Metric | Reported Value | Analyst Interpretation)
     c) **Technical Structure & Key Levels** (Trend, 50/200 DMA, RSI, Support & Resistance)
     d) **Bull Case Catalysts vs. Bear Case Risks**
     e) **Bottom-Line Analytical Takeaway**
4. OBJECTIVITY & COMPLETION:
   - Never truncate tables or stop mid-sentence.
   - Maintain institutional objectivity and cite evidence clearly.`;

    const encoder = new TextEncoder();
    const customReadable = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // connection closed
          }
        };

        try {
          if (isGeminiConfigured()) {
            await streamChatWithGemini({
              systemInstruction: systemPrompt,
              messages: normalizedMessages.slice(-10),
              onDelta: (text) => {
                send({ delta: text });
              },
              onSources: (sources) => {
                send({ sources });
              },
            });
          } else {
            const groqMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
              { role: 'system', content: systemPrompt },
              ...normalizedMessages.slice(-8),
            ];
            await streamChatWithGroq({
              messages: groqMessages,
              temperature: 0.2,
              maxTokens: 3500,
              onDelta: (text) => {
                send({ delta: text });
              },
            });
          }

          send({ done: true });
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : 'Error generating response';
          send({ error: errorMessage });
        } finally {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
    });

    return new Response(customReadable, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err: unknown) {
    console.error('[research-chat-api] Error:', err);
    return NextResponse.json(
      { error: 'Failed to process chat query.' },
      { status: 500 }
    );
  }
}
