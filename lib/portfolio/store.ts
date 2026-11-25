// lib/portfolio/store.ts
// Authenticated, owner-isolated persistence for user portfolio holdings.

import { prisma } from '@/lib/database/client';
import { memoryOwnerKey } from '@/lib/memory/identity';

export interface SavedPortfolioHolding {
  id: string;
  instrumentKey?: string | null;
  ticker: string;
  exchange: 'NSE' | 'BSE';
  sector?: string | null;
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  stopLoss?: number | null;
  target?: number | null;
  notes?: string | null;
  updatedAt: string;
}

export async function listPortfolioHoldings(identity: string): Promise<SavedPortfolioHolding[]> {
  const ownerKey = memoryOwnerKey(identity);
  const rows = await prisma.portfolioHolding.findMany({
    where: { ownerKey },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    instrumentKey: r.instrumentKey,
    ticker: r.ticker,
    exchange: r.exchange === 'BSE' ? 'BSE' : 'NSE',
    sector: r.sector,
    side: r.side === 'short' ? 'short' : 'long',
    quantity: r.quantity,
    entryPrice: r.entryPrice,
    stopLoss: r.stopLoss,
    target: r.target,
    notes: r.notes,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function upsertPortfolioHoldings(
  identity: string,
  holdings: Array<{
    instrumentKey?: string;
    ticker: string;
    exchange?: 'NSE' | 'BSE';
    sector?: string;
    side?: 'long' | 'short';
    quantity: number;
    entryPrice: number;
    stopLoss?: number;
    target?: number;
    notes?: string;
  }>,
): Promise<SavedPortfolioHolding[]> {
  const ownerKey = memoryOwnerKey(identity);
  await prisma.$transaction(async (tx) => {
    for (const h of holdings.slice(0, 100)) {
      const ticker = h.ticker.trim().toUpperCase().slice(0, 30);
      const exchange = h.exchange === 'BSE' ? 'BSE' : 'NSE';
      if (!ticker || !Number.isFinite(h.quantity) || h.quantity <= 0 || !Number.isFinite(h.entryPrice) || h.entryPrice <= 0) {
        continue;
      }
      await tx.portfolioHolding.upsert({
        where: { ownerKey_ticker_exchange: { ownerKey, ticker, exchange } },
        create: {
          ownerKey,
          instrumentKey: h.instrumentKey?.slice(0, 120) ?? null,
          ticker,
          exchange,
          sector: h.sector?.slice(0, 80) ?? null,
          side: h.side === 'short' ? 'short' : 'long',
          quantity: h.quantity,
          entryPrice: h.entryPrice,
          stopLoss: h.stopLoss ?? null,
          target: h.target ?? null,
          notes: h.notes?.slice(0, 500) ?? null,
        },
        update: {
          instrumentKey: h.instrumentKey?.slice(0, 120) ?? undefined,
          sector: h.sector?.slice(0, 80) ?? undefined,
          side: h.side === 'short' ? 'short' : 'long',
          quantity: h.quantity,
          entryPrice: h.entryPrice,
          stopLoss: h.stopLoss ?? null,
          target: h.target ?? null,
          notes: h.notes?.slice(0, 500) ?? undefined,
        },
      });
    }
  });
  return listPortfolioHoldings(identity);
}

export async function deletePortfolioHolding(identity: string, id: string): Promise<boolean> {
  const ownerKey = memoryOwnerKey(identity);
  const res = await prisma.portfolioHolding.deleteMany({
    where: { id, ownerKey },
  });
  return res.count > 0;
}
