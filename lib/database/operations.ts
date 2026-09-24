import { prisma } from './client';
import type { ResearchReport, ResearchSourceMeta, WatchlistItem } from '@/types/research';

// ---- Research Reports ----

export async function createResearchReport(params: {
  companyId: string;
  query: string;
  status?: string;
}) {
  return prisma.researchReport.create({
    data: {
      companyId: params.companyId,
      query: params.query,
      status: params.status ?? 'running',
    },
  });
}

export async function updateResearchReport(
  id: string,
  params: {
    status?: string;
    reportJson?: string;
    errorMsg?: string;
    processingMs?: number;
  }
) {
  return prisma.researchReport.update({
    where: { id },
    data: params,
  });
}

export async function getResearchReport(id: string) {
  return prisma.researchReport.findUnique({
    where: { id },
    include: { company: true, sources: true },
  });
}

export async function getResearchHistory(limit = 20) {
  const reports = await prisma.researchReport.findMany({
    where: { status: { in: ['completed', 'failed'] } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { company: true },
  });
  return reports;
}

export async function getLatestReportForCompany(companyId: string) {
  return prisma.researchReport.findFirst({
    where: { companyId, status: 'completed' },
    orderBy: { createdAt: 'desc' },
    include: { company: true, sources: true },
  });
}

// ---- Companies ----

export async function upsertCompany(params: {
  name: string;
  ticker: string;
  exchange: string;
  sector?: string;
  industry?: string;
  country?: string;
}) {
  return prisma.company.upsert({
    where: { ticker_exchange: { ticker: params.ticker, exchange: params.exchange } },
    create: {
      name: params.name,
      ticker: params.ticker,
      exchange: params.exchange,
      sector: params.sector,
      industry: params.industry,
      country: params.country ?? 'India',
    },
    update: {
      name: params.name,
      sector: params.sector,
      industry: params.industry,
    },
  });
}

// ---- Sources ----

export async function saveResearchSources(
  reportId: string,
  sources: ResearchSourceMeta[]
) {
  const data = sources.map((s) => ({
    reportId,
    url: s.url,
    title: s.title,
    domain: s.domain,
    sourceType: s.sourceType,
    authority: s.authority,
    relevance: s.relevance,
    publishedAt: s.publishedAt ? new Date(s.publishedAt) : undefined,
    snippet: s.snippet,
  }));

  // Insert sources one by one to handle potential duplicate URLs gracefully
  for (const item of data) {
    try {
      await prisma.researchSource.create({ data: item });
    } catch {
      // Skip duplicates silently
    }
  }
}

// ---- Watchlist ----

export async function getWatchlist(): Promise<WatchlistItem[]> {
  const items = await prisma.watchlist.findMany({
    include: { company: { include: { reports: { where: { status: 'completed' }, orderBy: { createdAt: 'desc' }, take: 1 } } } },
    orderBy: { addedAt: 'desc' },
  });

  return items.map((w) => ({
    id: w.id,
    companyId: w.companyId,
    companyName: w.company.name,
    ticker: w.company.ticker,
    exchange: w.company.exchange,
    addedAt: w.addedAt.toISOString(),
    lastResearch: w.company.reports[0]?.createdAt?.toISOString(),
  }));
}

export async function addToWatchlist(companyId: string) {
  return prisma.watchlist.upsert({
    where: { companyId },
    create: { companyId },
    update: {},
  });
}

export async function removeFromWatchlist(id: string) {
  return prisma.watchlist.delete({ where: { id } });
}

export async function isInWatchlist(companyId: string): Promise<boolean> {
  const item = await prisma.watchlist.findUnique({ where: { companyId } });
  return !!item;
}
