import type { CorrelationEntry, PortfolioPosition } from '@/types/portfolio';

/**
 * Pearson correlation between two aligned price series.
 * Returns null when either series has fewer than 2 usable points.
 */
export function seriesCorrelation(seriesA: number[], seriesB: number[]): number | null {
  const n = Math.min(seriesA.length, seriesB.length);
  if (n < 2) return null;

  const a = seriesA.slice(0, n);
  const b = seriesB.slice(0, n);

  const meanA = a.reduce((sum, v) => sum + v, 0) / n;
  const meanB = b.reduce((sum, v) => sum + v, 0) / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;

  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  const denom = Math.sqrt(varA * varB);
  if (!denom || !Number.isFinite(denom)) return null;

  const corr = cov / denom;
  return Number.isFinite(corr) ? Math.max(-1, Math.min(1, corr)) : null;
}

/**
 * Build pairwise correlation entries from aligned close-price series.
 * Series are aligned by index; missing values are skipped pairwise.
 */
export function buildCorrelations(
  seriesByInstrument: Map<string, number[]>,
  lookbackDays: number,
): CorrelationEntry[] {
  const keys = Array.from(seriesByInstrument.keys());
  const entries: CorrelationEntry[] = [];

  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = seriesByInstrument.get(keys[i])!;
      const b = seriesByInstrument.get(keys[j])!;
      const corr = seriesCorrelation(a, b);
      if (corr != null) {
        entries.push({
          instrumentKeyA: keys[i],
          instrumentKeyB: keys[j],
          correlation: corr,
          lookbackDays,
        });
      }
    }
  }

  return entries;
}

/**
 * Find the maximum absolute correlation involving a given instrument within a cluster.
 */
export function maxCorrelationForInstrument(
  instrumentKey: string,
  correlations: CorrelationEntry[],
): number {
  let max = 0;
  for (const c of correlations) {
    if (c.instrumentKeyA === instrumentKey || c.instrumentKeyB === instrumentKey) {
      max = Math.max(max, Math.abs(c.correlation));
    }
  }
  return max;
}

/**
 * Cluster positions by high pairwise correlation (greedy single-linkage).
 * Returns clusters of instrument keys where members are highly correlated.
 */
export function correlationClusters(
  positions: PortfolioPosition[],
  correlations: CorrelationEntry[],
  threshold: number,
): string[][] {
  const byKey = new Map(positions.map((p) => [p.instrumentKey, p]));
  const visited = new Set<string>();
  const clusters: string[][] = [];

  for (const position of positions) {
    if (visited.has(position.instrumentKey)) continue;

    const cluster: string[] = [position.instrumentKey];
    visited.add(position.instrumentKey);
    const queue = [position.instrumentKey];

    while (queue.length) {
      const current = queue.shift()!;
      for (const c of correlations) {
        if (Math.abs(c.correlation) < threshold) continue;
        const other = c.instrumentKeyA === current ? c.instrumentKeyB : c.instrumentKeyB === current ? c.instrumentKeyA : null;
        if (other && byKey.has(other) && !visited.has(other)) {
          visited.add(other);
          cluster.push(other);
          queue.push(other);
        }
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}
