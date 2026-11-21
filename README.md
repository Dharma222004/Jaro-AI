# JARO AI — Institutional Quantitative Equity Research & Confluence Engine

<div align="center">
  <img src="public/jaro-institutional-logo.png" alt="JARO AI Logo" width="160" />
  <h3>Systematic Indian Cash-Equity Intelligence</h3>
  <p>Deterministic QTVT Confluence Engine · Point-in-Time Data · Institutional Risk Management</p>
</div>

---

## Executive Overview

**JARO AI** is a professional-grade, source-grounded Indian equity intelligence platform built for NSE cash-equity swing trading (3–40 sessions) and position investing (6–36 months).

It replaces legacy heuristic trade ideas with **JARO Method v2 — QTVT Confluence Engine (Quality · Trend · Value · Trigger)**. 

### The Golden Rule: *Code Computes Every Number. The LLM Only Explains.*
- **Zero Hallucinated Numbers:** Trade levels, structural stop-losses, price targets, net reward-to-risk, position sizing, and composite scores are computed deterministically in pure TypeScript. The LLM is strictly restricted to interpreting and citing verified evidence.
- **Market-Structure Invalidation:** Stop-loss is pegged strictly to market structure and ATR buffers, never artificially tightened to satisfy a desired R/R. If R/R fails at the current market price, the engine returns `WAIT_FOR_ENTRY` with a calculated entry alert price ($E_{max}$), rather than an unsafe fill.
- **Fail-Closed Audit Pipeline:** Every check resolves strictly as `PASS`, `WAIT`, `UNVERIFIED`, `FAIL`, or `N/A`. Missing or stale data is never treated as a pass.
- **Point-in-Time Integrity:** Financial statement figures are keyed to filing release dates rather than period ends to prevent restatement lookahead bias.

---

## 1. JARO Method v2 — QTVT Confluence Engine

```
L0 Data Preflight ──► L1 Quality (FQS) ──► L2 Valuation ──► L3 Trend & Relative Strength
                                                                    │
Verdict ◄── L8 Net R/R & Sizing ◄── L7 Staged Targets ◄── L6 Stop ◄── L5 Setup & Trigger ◄── L4 Event Risk
```

### The 4 Confluence Dimensions (QTVT)

1. **Quality (Fundamental Quality Score, FQS 0–100):**
   - **Non-Financial:** Profitability stability (ROCE $\ge$ 15%, ROE $\ge$ 12%), cash conversion, and balance-sheet health.
   - **Banks / NBFC:** RoA $\ge$ 1.0%, RoE $\ge$ 12%, GNPA $\le$ 3.0%, NNPA $\le$ 1.0%, Capital Adequacy (CRAR) $\ge$ 14%.
   - **Hard Vetoes:** Promoter pledge $> 25\%$ or Interest Coverage $< 1.5\times$ triggers an immediate hard veto, capping the verdict at `AVOID`.
2. **Trend & Relative Strength:**
   - Structural daily/weekly higher-high/higher-low progression.
   - Price $\ge$ SMA200 and 30-Week Moving Average with flat/rising slope.
   - Outperformance vs NIFTY 50 and mapped sector benchmark over 1-month and 3-month lookbacks.
3. **Value & Margin of Safety:**
   - Discounted Multiple & Historical Multiple Valuation Frameworks.
   - Computes Bear, Base, and Bull Fair Values.
   - Requires Margin of Safety (MoS) $\ge -15\%$ relative to Base Fair Value.
4. **Trigger & Timing:**
   - Pullback into confluence pocket ($[S, S + 1.5 \cdot \text{ATR}]$ around 20-day EMA and prior support).
   - Setup-aware RSI(14) momentum reset (cooldown into 40–58 zone turning upward).
   - Volume-confirmed buying trigger (daily close above prior day's high with $\ge 1.2\times$ 20-day median turnover).

---

## 2. 10-Gate Sequential Verification Pipeline

| Level | Gate | Requirement | Behavioral Impact on Failure |
|---|---|---|---|
| **L0** | Exchange Data & Candles | $\ge 150$ validated daily candles | Blocks execution (`DATA_ERROR`) |
| **L1** | Fundamental Quality (FQS) | Score $\ge 55/100$ and zero hard vetoes | Veto $\rightarrow$ `AVOID` |
| **L2** | Valuation & Margin of Safety | Margin of Safety $\ge -15\%$ to Base FV | Valuation fail $\rightarrow$ `WAIT_FOR_ENTRY` |
| **L3** | Higher-Timeframe Trend | Price $\ge$ SMA200 with rising slope | Trend break $\rightarrow$ `AVOID` |
| **L3** | Liquidity Floor | $\ge ₹5\text{ Cr}$ 20-day median turnover | Illiquid $\rightarrow$ `AVOID` |
| **L4** | Event & Surveillance Risk | Corporate intimations $> 5$ sessions away | Unverified earnings $\rightarrow$ verdict capped at `WATCHLIST` |
| **L5** | Pullback & Zone Confluence | $\le 2.0\text{ ATR}$ above support pocket | Extended $> 2.0\text{ ATR} \rightarrow$ `WAIT_FOR_ENTRY` |
| **L5** | RSI(14) Momentum Reset | RSI 40–58 cooldown turning upward | RSI $> 58 \rightarrow$ `WAIT` (extended momentum) |
| **L6** | Volume-Confirmed Trigger | Close $>$ Prior High with $\ge 1.2\times$ volume | Pending trigger $\rightarrow$ `WAIT_FOR_ENTRY` |
| **L8** | Net Reward / Risk Hurdle | Net blended R/R $\ge 1.5:1$ (Swing) or $\ge 2.0:1$ | Poor R/R $\rightarrow$ Solver calculates $E_{max}$ |

---

## 3. Mathematical Rigor: The Closed-Form Entry Solver

When reward-to-risk fails at Current Market Price (CMP) due to price extension, JARO AI does not guess a level or tighten the stop. It computes the exact **Maximum Viable Entry Price ($E_{max}$)** satisfying the minimum R/R hurdle:

$$E_{max} = \frac{\sum w_i T_i - C_{fixed} + R_{req} \cdot (S - \text{slip})}{w_{net} + R_{req} \cdot (1 + \text{slip})}$$

Where:
- $T_i$: Staged price targets (Target 1: +10% resistance, Target 2: 1.618 Fib, Target 3: 5.0 ATR runner)
- $w_i$: Scale-out weights (40% / 30% / 30%)
- $S$: Structural stop-loss (Structural swing low $- 0.75\text{ ATR}$)
- $C_{fixed}$: Statutory exchange turnover costs, STT, and clearing fees
- $\text{slip}$: Configured two-sided execution slippage (0.15%)
- $R_{req}$: Minimum statutory net hurdle ($1.5:1$ for Swing, $2.0:1$ for Position)

---

## 4. Institutional Score Cards & Analytics Dimensions

JARO AI synthesizes research through four structured, traceable score cards:

1. **Fundamentals (FQS):** Evaluates Return on Capital (ROCE), Return on Equity (ROE), operating margins, free cash flow generation, and debt-to-equity leverage.
2. **Valuation Multiple:** Evaluates Trailing P/E, Forward P/E, Price-to-Book, and EV/EBITDA against 5-year historical medians and sector averages.
3. **Technical Trend & Momentum:** Tracks moving average alignment (SMA20, SMA50, SMA200), structural stage, RSI(14), and relative volume.
4. **Risk Resilience:** Gauges price volatility, promoter share pledge %, debt coverage ratios, and 20-day average daily turnover (ADTV).

---

## 5. Verified Financial History & Multi-Metric Charting

The **Verified Financial History** component provides interactive, institutional-grade statement analysis:
- **Interactive Multi-Metric SVG Chart:** Simultaneous plotting of **Revenue** (Cyan `#38bdf8`), **Operating Profit / EBITDA** (Indigo `#818cf8`), and **Net Profit** (Emerald `#10b981`, with Rose `#ef4444` for losses).
- **Exact Numeric Overlay:** Formatted value tags (`₹ Cr`) rendered directly above/below bars.
- **Dynamic Zero-Line Baseline:** Accurately renders negative net profits below a solid baseline without SVG clipping.
- **Dual-Mode View:** Instant toggle between visual chart and full tabular financial data sheet.

---

## 6. Technology Stack

- **Framework:** [Next.js 16](https://nextjs.org/) (App Router & Turbopack)
- **Language:** TypeScript 5.x (Strict typing enabled)
- **Styling:** Modular CSS & Tailwind with Institutional Dark Financial Palette (`#0B0F14` Canvas, `#111827` Cards, `#263244` Borders)
- **Database / ORM:** [Prisma ORM](https://www.prisma.io/) with SQLite (local development) and PostgreSQL schema compatibility
- **Market Data:** Upstox API v2 (Read-only historical candles, technical indicators, and quote validation)
- **Deep Web Evidence:** Tavily AI Search & Raw Document Extraction
- **LLM Reasoning Engine:** NVIDIA / Groq LLMs with interactive collapsible reasoning steppers (`ThinkingPanel`)

---

## 7. Quick Start & Setup

### 1. Prerequisites
- Node.js 20.x or later
- npm or pnpm

### 2. Clone and Install
```bash
git clone https://github.com/Dharma222004/Jaro-AI.git
cd Jaro-AI
npm install
```

### 3. Environment Variables Configuration
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Fill in your server-side API keys:
```env
# Server Port
PORT=3001
NEXT_PUBLIC_APP_URL=http://localhost:3001

# LLM Providers (NVIDIA / Groq)
NVIDIA_API_KEY=your_nvidia_api_key_here
NVIDIA_MODEL=moonshotai/kimi-k3.1-pro
NVIDIA_API_BASE=https://integrate.api.nvidia.com/v1

# Research Evidence Engine
TAVILY_API_KEY=your_tavily_api_key_here

# Upstox Market Data (Read-Only Analytics Token)
UPSTOX_ANALYTICS_TOKEN=your_upstox_read_only_token_here

# Database
DATABASE_URL="file:./dev.db"

# Compliance & Safeguards
JARO_COMPLIANCE_MODE=education_and_general_research
JARO_PERSONALIZED_ADVICE_ENABLED=false
```

> **Security Note:** Keep `UPSTOX_ANALYTICS_TOKEN` strictly server-side. Never prefix with `NEXT_PUBLIC_`. It is restricted to read-only quotes and candles and cannot execute transactions.

### 4. Initialize Database
```bash
npx prisma db push
```

### 5. Launch the Application
```bash
npm run dev
```
Open [http://localhost:3001](http://localhost:3001) in your browser.

---

## 8. Verification & Test Suites

JARO AI includes comprehensive verification suites to validate mathematical models and data bindings:

```bash
# 1. Run QTVT Confluence Engine Acceptance Suite
npx tsx scripts/test-qtvt-acceptance.ts

# 2. Run Score Cards Data Binding Verification Suite
npx tsx scripts/test-score-cards-pipeline.ts

# 3. Production Build Compilation Check
npm run build
```

---

## 9. Regulatory & Research Disclosure

JARO AI is an educational technology and financial research platform. It is **not** a SEBI-registered Research Analyst (RA) or Investment Adviser (IA). 

- All trade plans, entry zones, stops, targets, and ratios generated by the system are quantitative research scenarios and do not constitute personalized investment advice or trade execution instructions.
- Market investments carry structural risk. Past simulated performance is not indicative of future returns. Stop-losses do not guarantee fills during circuit limits, gap openings, or adverse liquidity events.

---

<div align="center">
  <sub>Developed for quantitative research and institutional equity intelligence. JARO AI © 2026.</sub>
</div>
