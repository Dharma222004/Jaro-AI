import { PrismaClient } from '@prisma/client';

interface MemCompany {
  id: string;
  name: string;
  ticker: string;
  exchange: string;
  sector?: string | null;
  industry?: string | null;
  country: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MemReport {
  id: string;
  companyId: string;
  query: string;
  status: string;
  reportJson?: string | null;
  errorMsg?: string | null;
  processingMs?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MemSource {
  id: string;
  reportId: string;
  url: string;
  title: string;
  domain: string;
  sourceType?: string | null;
  authority?: string | null;
  relevance?: number | null;
  publishedAt?: Date | null;
  retrievedAt: Date;
  snippet?: string | null;
}

interface MemWatchlist {
  id: string;
  companyId: string;
  addedAt: Date;
}

interface MemoryStore {
  companies: Map<string, MemCompany>;
  reports: Map<string, MemReport>;
  sources: Map<string, MemSource[]>;
  watchlists: Map<string, MemWatchlist>;
}

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __jaroMemStore: MemoryStore | undefined;
}

function getMemStore(): MemoryStore {
  if (!global.__jaroMemStore) {
    global.__jaroMemStore = {
      companies: new Map(),
      reports: new Map(),
      sources: new Map(),
      watchlists: new Map(),
    };
  }
  return global.__jaroMemStore;
}

function buildInMemoryPrisma(): PrismaClient {
  const store = getMemStore();

  const mock = {
    company: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { ticker_exchange?: { ticker: string; exchange: string }; id?: string };
        create: Partial<MemCompany>;
        update: Partial<MemCompany>;
      }) => {
        const key = where.ticker_exchange
          ? `${where.ticker_exchange.ticker.toUpperCase()}_${where.ticker_exchange.exchange.toUpperCase()}`
          : where.id || `comp_${Date.now()}`;
        const existing = Array.from(store.companies.values()).find(
          (c) =>
            (where.ticker_exchange &&
              c.ticker.toUpperCase() === where.ticker_exchange.ticker.toUpperCase() &&
              c.exchange.toUpperCase() === where.ticker_exchange.exchange.toUpperCase()) ||
            (where.id && c.id === where.id)
        );
        if (existing) {
          const updated: MemCompany = {
            ...existing,
            ...update,
            updatedAt: new Date(),
          };
          store.companies.set(existing.id, updated);
          return updated;
        }
        const id = `comp_${key}_${Date.now()}`;
        const created: MemCompany = {
          id,
          name: create.name || 'Company',
          ticker: create.ticker || 'TICKER',
          exchange: create.exchange || 'NSE',
          sector: create.sector ?? null,
          industry: create.industry ?? null,
          country: create.country || 'India',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.companies.set(id, created);
        return created;
      },
      findUnique: async ({ where }: { where: { id?: string } }) => {
        if (where.id) return store.companies.get(where.id) ?? null;
        return null;
      },
    },
    researchReport: {
      create: async ({ data }: { data: Partial<MemReport> }) => {
        const id = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const record: MemReport = {
          id,
          companyId: data.companyId || '',
          query: data.query || '',
          status: data.status || 'running',
          reportJson: data.reportJson ?? null,
          errorMsg: data.errorMsg ?? null,
          processingMs: data.processingMs ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.reports.set(id, record);
        return record;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<MemReport> }) => {
        const existing = store.reports.get(where.id);
        const updated: MemReport = {
          ...(existing || {
            id: where.id,
            companyId: '',
            query: '',
            status: 'completed',
            createdAt: new Date(),
          }),
          ...data,
          updatedAt: new Date(),
        };
        store.reports.set(where.id, updated);
        return updated;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const rep = store.reports.get(where.id);
        if (!rep) return null;
        const company = store.companies.get(rep.companyId) || {
          id: rep.companyId,
          name: 'Listed Company',
          ticker: 'NSE',
          exchange: 'NSE',
          country: 'India',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const sources = store.sources.get(rep.id) || [];
        return { ...rep, company, sources };
      },
      findFirst: async ({ where }: { where?: { companyId?: string; status?: string } }) => {
        const all = Array.from(store.reports.values())
          .filter((r) => {
            if (where?.companyId && r.companyId !== where.companyId) return false;
            if (where?.status && r.status !== where.status) return false;
            return true;
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const rep = all[0];
        if (!rep) return null;
        const company = store.companies.get(rep.companyId) || {
          id: rep.companyId,
          name: 'Listed Company',
          ticker: 'NSE',
          exchange: 'NSE',
          country: 'India',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const sources = store.sources.get(rep.id) || [];
        return { ...rep, company, sources };
      },
      findMany: async ({ take = 20 }: { take?: number } = {}) => {
        return Array.from(store.reports.values())
          .filter((r) => r.status === 'completed' || r.status === 'failed')
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take)
          .map((rep) => ({
            ...rep,
            company: store.companies.get(rep.companyId) || {
              id: rep.companyId,
              name: 'Listed Company',
              ticker: 'NSE',
              exchange: 'NSE',
              country: 'India',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          }));
      },
    },
    researchSource: {
      create: async ({ data }: { data: Partial<MemSource> }) => {
        const reportId = data.reportId || '';
        const list = store.sources.get(reportId) || [];
        const src: MemSource = {
          id: `src_${list.length + 1}_${Date.now()}`,
          reportId,
          url: data.url || '',
          title: data.title || '',
          domain: data.domain || '',
          sourceType: data.sourceType ?? 'other',
          authority: data.authority ?? 'medium',
          relevance: data.relevance ?? null,
          publishedAt: data.publishedAt ?? null,
          retrievedAt: new Date(),
          snippet: data.snippet ?? null,
        };
        list.push(src);
        store.sources.set(reportId, list);
        return src;
      },
    },
    watchlist: {
      findMany: async () => {
        return Array.from(store.watchlists.values())
          .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime())
          .map((w) => {
            const company = store.companies.get(w.companyId) || {
              id: w.companyId,
              name: 'Company',
              ticker: 'NSE',
              exchange: 'NSE',
              country: 'India',
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            const reports = Array.from(store.reports.values())
              .filter((r) => r.companyId === w.companyId && r.status === 'completed')
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
              .slice(0, 1);
            return {
              ...w,
              company: {
                ...company,
                reports,
              },
            };
          });
      },
      upsert: async ({
        where,
        create,
      }: {
        where: { companyId: string };
        create: { companyId: string };
      }) => {
        const companyId = where.companyId || create.companyId;
        const existing = Array.from(store.watchlists.values()).find(
          (w) => w.companyId === companyId
        );
        if (existing) return existing;
        const item: MemWatchlist = {
          id: `wl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          companyId,
          addedAt: new Date(),
        };
        store.watchlists.set(item.id, item);
        return item;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const item = store.watchlists.get(where.id);
        store.watchlists.delete(where.id);
        return item ?? {};
      },
      findUnique: async ({ where }: { where: { companyId?: string; id?: string } }) => {
        if (where.id) return store.watchlists.get(where.id) ?? null;
        if (where.companyId) {
          return (
            Array.from(store.watchlists.values()).find(
              (w) => w.companyId === where.companyId
            ) ?? null
          );
        }
        return null;
      },
    },
  };

  return mock as unknown as PrismaClient;
}

let prisma: PrismaClient;
if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') {
  try {
    prisma =
      global.prisma ??
      new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
      });
    if (process.env.NODE_ENV !== 'production') {
      global.prisma = prisma;
    }
  } catch {
    console.warn('[AI Studio] Database connection failed — using in-memory store');
    prisma = buildInMemoryPrisma();
  }
} else {
  prisma = buildInMemoryPrisma();
}

export { prisma };
