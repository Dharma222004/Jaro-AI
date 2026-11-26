// lib/screener/repository.ts
// Tenant-isolated persistence for saved screener specs and screener execution runs.

import { prisma } from '@/lib/database/client';
import type { SavedScreenerRecord, ScreenerExecutionResult, ScreenerSpec } from '@/types/screener';

export async function saveScreenerSpec(params: {
  ownerKey: string;
  name: string;
  spec: ScreenerSpec;
  lastMatchCount?: number | null;
}): Promise<SavedScreenerRecord> {
  const row = await prisma.savedScreener.create({
    data: {
      ownerKey: params.ownerKey,
      name: params.name.trim().slice(0, 120),
      specJson: JSON.stringify(params.spec),
      exchanges: params.spec.exchanges,
      timeframe: params.spec.conditions[0]?.timeframe ?? '1d',
      lastRunAt: params.lastMatchCount != null ? new Date() : null,
      lastMatchCount: params.lastMatchCount ?? null,
    },
  });

  return {
    id: row.id,
    name: row.name,
    spec: JSON.parse(row.specJson) as ScreenerSpec,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastMatchCount: row.lastMatchCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSavedScreeners(ownerKey: string): Promise<SavedScreenerRecord[]> {
  const rows = await prisma.savedScreener.findMany({
    where: { ownerKey },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    spec: JSON.parse(row.specJson) as ScreenerSpec,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastMatchCount: row.lastMatchCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function deleteSavedScreener(ownerKey: string, id: string): Promise<boolean> {
  const deleted = await prisma.savedScreener.deleteMany({
    where: { id, ownerKey },
  });
  return deleted.count > 0;
}

export async function persistScreenerRun(ownerKey: string, result: ScreenerExecutionResult): Promise<void> {
  await prisma.screenerJobRun.upsert({
    where: { jobId: result.jobId },
    update: {
      status: result.status,
      coverageJson: JSON.stringify(result.coverage),
      resultJson: JSON.stringify(result),
      matchedCount: result.coverage.matchedCount,
      eligibleCount: result.coverage.totalEligibleSecurities,
    },
    create: {
      jobId: result.jobId,
      ownerKey,
      query: result.query.slice(0, 500),
      status: result.status,
      specJson: JSON.stringify(result.spec),
      coverageJson: JSON.stringify(result.coverage),
      resultJson: JSON.stringify(result),
      matchedCount: result.coverage.matchedCount,
      eligibleCount: result.coverage.totalEligibleSecurities,
    },
  }).catch(() => {});
}

export async function getScreenerRun(ownerKey: string, jobId: string): Promise<ScreenerExecutionResult | null> {
  const row = await prisma.screenerJobRun.findFirst({
    where: { jobId, ownerKey },
  });
  if (!row || !row.resultJson) return null;
  try {
    return JSON.parse(row.resultJson) as ScreenerExecutionResult;
  } catch {
    return null;
  }
}
