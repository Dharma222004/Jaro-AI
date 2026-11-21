import { createHash } from 'node:crypto';
import { prisma } from '@/lib/database/client';
import type { SystematicBacktestResult } from '@/types/systematic-backtest';

export async function recordBacktestHistory(results: SystematicBacktestResult[]) {
  return Promise.all(results.map(async (result) => {
    const stableResult = { ...result, generatedAt: undefined };
    const resultJson = JSON.stringify(result);
    const resultHash = digest(JSON.stringify(stableResult));
    const runKey = digest(JSON.stringify({
      instrumentKey: result.instrument.instrument_key,
      benchmarkKey: result.benchmark.instrument_key,
      strategyVersion: result.strategyVersion,
      timeframe: result.timeframe,
      coverage: result.coverage,
      assumptions: result.assumptions,
      resultHash,
    }));
    const record = await prisma.strategyBacktestRun.upsert({
      where: { runKey },
      create: {
        runKey,
        resultHash,
        instrumentKey: result.instrument.instrument_key,
        ticker: result.instrument.trading_symbol,
        benchmarkKey: result.benchmark.instrument_key,
        strategyId: result.strategyId,
        strategyVersion: result.strategyVersion,
        timeframe: result.timeframe,
        coverageFrom: result.coverage.from ? new Date(result.coverage.from) : null,
        coverageTo: result.coverage.to ? new Date(result.coverage.to) : null,
        candleCount: result.coverage.candles,
        settingsJson: JSON.stringify({ strategyParameters: result.strategyParameters, assumptions: result.assumptions, coverage: result.coverage, benchmark: result.benchmark }),
        resultJson,
        generatedAt: new Date(result.generatedAt),
      },
      update: {},
      select: { id: true, runKey: true, resultHash: true, createdAt: true },
    });
    return { ...record, createdAt: record.createdAt.toISOString() };
  }));
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
