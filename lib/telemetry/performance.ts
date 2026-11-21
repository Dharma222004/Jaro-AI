export interface TelemetryEvent {
  name: string;
  durationMs: number;
  timestamp: string;
  route?: string;
  status?: number;
  error?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface TelemetrySummary {
  totalRequests: number;
  averageDurationMs: number;
  p95DurationMs: number;
  errorCount: number;
  slowestRoutes: Array<{ route: string; avgDurationMs: number; count: number }>;
  generatedAt: string;
}

export class PerformanceTelemetry {
  private events: TelemetryEvent[] = [];
  private readonly maxEvents: number;

  constructor(maxEvents = 1000) {
    this.maxEvents = maxEvents;
  }

  start(name: string, metadata?: Record<string, string | number | boolean>): { end: (status?: number, error?: string) => TelemetryEvent } {
    const startTime = process.hrtime.bigint();
    return {
      end: (status?: number, error?: string) => {
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1_000_000;
        const event: TelemetryEvent = {
          name,
          durationMs: Math.round(durationMs * 100) / 100,
          timestamp: new Date().toISOString(),
          status,
          error,
          metadata,
        };
        this.record(event);
        return event;
      },
    };
  }

  private record(event: TelemetryEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  getEvents(route?: string): TelemetryEvent[] {
    if (route) {
      return this.events.filter((e) => e.route === route);
    }
    return [...this.events];
  }

  getSummary(): TelemetrySummary {
    const events = this.events;
    if (!events.length) {
      return {
        totalRequests: 0,
        averageDurationMs: 0,
        p95DurationMs: 0,
        errorCount: 0,
        slowestRoutes: [],
        generatedAt: new Date().toISOString(),
      };
    }

    const totalRequests = events.length;
    const averageDurationMs = round2(events.reduce((sum, e) => sum + e.durationMs, 0) / totalRequests);
    const sorted = [...events].sort((a, b) => b.durationMs - a.durationMs);
    const p95Index = Math.ceil(totalRequests * 0.95) - 1;
    const p95DurationMs = sorted[Math.max(0, p95Index)]?.durationMs ?? 0;
    const errorCount = events.filter((e) => e.error || (e.status != null && e.status >= 400)).length;

    const byRoute = new Map<string, { total: number; count: number }>();
    for (const e of events) {
      if (!e.route) continue;
      const existing = byRoute.get(e.route) ?? { total: 0, count: 0 };
      byRoute.set(e.route, { total: existing.total + e.durationMs, count: existing.count + 1 });
    }

    const slowestRoutes = Array.from(byRoute.entries())
      .map(([route, stats]) => ({ route, avgDurationMs: round2(stats.total / stats.count), count: stats.count }))
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
      .slice(0, 10);

    return {
      totalRequests,
      averageDurationMs,
      p95DurationMs,
      errorCount,
      slowestRoutes,
      generatedAt: new Date().toISOString(),
    };
  }

  clear(): void {
    this.events = [];
  }
}

let globalTelemetry: PerformanceTelemetry | null = null;

export function getTelemetry(): PerformanceTelemetry {
  if (!globalTelemetry) {
    globalTelemetry = new PerformanceTelemetry();
  }
  return globalTelemetry;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
