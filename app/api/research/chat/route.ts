import { NextRequest, NextResponse } from 'next/server';
import { streamChatWithGroq } from '@/lib/groq/client';

export const maxDuration = 120; // 2 minutes for complete institutional dossiers

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { company, reportContext, messages } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Messages array is required.' },
        { status: 400 }
      );
    }

    const companyName = company?.name || 'the company';
    const ticker = company?.ticker || '';

    // Build comprehensive institutional system prompt with all report facts
    const systemPrompt = `You are Jaro AI Institutional Equity Analyst Assistant.
You are in a continuous research dialogue with an institutional investor / equity analyst examining:
Company: ${companyName} (${ticker ? `NSE/BSE: ${ticker}` : ''})
${company?.sector ? `Sector: ${company.sector}` : ''}
${company?.industry ? `Industry: ${company.industry}` : ''}

You have access to the complete, verified equity research report and financial filings for this company:
${reportContext ? JSON.stringify(reportContext, null, 2) : 'No extra dossier context provided.'}

CORE OBJECTIVE:
Provide institutional-grade, highly structured, fact-grounded equity research responses.

OUTPUT TEMPLATE RULES:
1. When asked for an investment snapshot, readiness overview, evaluation, summary, or comprehensive analysis, ALWAYS use the following structured format:

   **${companyName} – Investment‑Readiness Snapshot (as of latest available reporting period)**

   | Metric | Value | Interpretation |
   |--------|-------|----------------|
   (Include: Market Capitalisation, Revenue, EBITDA, Net Profit, EPS, P/E, P/B, ROE, ROCE, Net Debt, Promoter Holding, Dividend Yield)

   ---

   ### Key Strengths (Fact‑Based)
   (Bullet points citing exact figures for high profitability, robust return ratios, leverage, and promoter alignment)

   ---

   ### Primary Concerns (Fact‑Based)
   | Concern | Evidence | Potential Impact |
   |---------|----------|------------------|
   (Detail revenue trajectory, valuation multiples, liquidity/cash visibility, raw material/execution risks, geographic or concentration risks, free-float)

   ---

   ### Catalysts & Headwinds (Fact‑Based)
   | Potential Catalyst | Reasoning |
   |--------------------|-----------|
   (2-3 key catalysts)

   | Potential Headwind | Reasoning |
   |--------------------|-----------|
   (2-3 key headwinds)

   ---

   ### Analytical Takeaways for an Institutional Investor
   | Consideration | What the data tells you |
   |---------------|------------------------|
   (Key synthesis on Profitability vs Growth, Balance Sheet health, and Valuation margin of safety)

2. When the user asks a specific doubt (e.g. debt details, margins, concall points, risks, promoter holdings):
   - Answer directly, factually, and cite exact numbers from the dossier.
   - Use clean markdown tables and bullet points wherever comparison or clarity is needed.

3. CRITICAL COMPLETION RULE:
   - Always complete every table and section fully. Never truncate or stop midway.
   - If a specific metric was not disclosed in the filings, state clearly: "Not disclosed in filings" in the table cell instead of fabricating.
   - Never give speculative buy/sell advice. Maintain institutional objectivity.`;

    // Format messages for Groq API
    const groqMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-8).map((m: { role: 'user' | 'assistant'; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    const encoder = new TextEncoder();
    const customReadable = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // connection might have closed
          }
        };

        try {
          await streamChatWithGroq({
            messages: groqMessages,
            temperature: 0.2,
            maxTokens: 3500,
            onDelta: (text) => {
              send({ delta: text });
            },
          });

          send({ done: true });
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : 'Error generating response';
          send({ error: errorMessage });
        } finally {
          controller.close();
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
