# Jaro AI — AI-Powered Stock Research

A production-quality AI-powered Indian stock research platform.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure API keys

Copy the example environment file:

```bash
cp .env.example .env.local
```

Edit `.env.local` and add your keys:

```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
TAVILY_API_KEY=your_tavily_api_key_here
DATABASE_URL="file:./dev.db"
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Get API keys:**
- Groq: https://console.groq.com/keys
- Tavily: https://app.tavily.com

### 3. Set up the database

```bash
npm run db:push
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Architecture

```
jaro-ai/
├── app/                    # Next.js App Router pages
│   ├── page.tsx            # Landing page
│   ├── dashboard/          # Research interface
│   ├── watchlist/          # Saved companies
│   ├── history/            # Research history
│   ├── settings/           # API configuration
│   └── api/                # Server-side API routes
│       ├── research/       # POST /api/research
│       ├── watchlist/      # GET/POST /api/watchlist
│       └── ...
├── components/             # React components
│   ├── navigation/         # Sidebar
│   └── research/           # Research UI components
├── lib/                    # Server-side logic
│   ├── groq/               # Groq LLM client
│   ├── tavily/             # Tavily research engine
│   ├── database/           # Prisma operations
│   ├── research/           # Research orchestrator
│   └── validation/         # Zod schemas
├── prompts/                # LLM prompt templates
├── types/                  # TypeScript types
└── prisma/                 # Database schema
```

## Research Pipeline

1. User enters company/query
2. Groq resolves company identity (NSE ticker, name)
3. Tavily performs multi-query web research
4. Sources filtered and prioritized by authority
5. Research context built and sent to Groq
6. Groq generates structured JSON report
7. Report validated with Zod
8. Stored in SQLite + rendered to UI

## Technology

- **Frontend**: Next.js 16, TypeScript, Tailwind CSS
- **LLM**: Groq (LLaMA 3.3 70B)
- **Research**: Tavily Search API
- **Database**: SQLite via Prisma ORM
- **Validation**: Zod

## Notes

- All API keys remain server-side (never exposed to browser)
- Research is cached for 24 hours per company
- Empty states are shown when data is unavailable (no fabrication)
- Reports include source citations with external links
