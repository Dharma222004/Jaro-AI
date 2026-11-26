-- CreateTable
CREATE TABLE "equity_security_master" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "isin" TEXT,
    "name" TEXT NOT NULL,
    "primaryTicker" TEXT NOT NULL,
    "nseSymbol" TEXT,
    "bseCode" TEXT,
    "nseInstrumentKey" TEXT,
    "bseInstrumentKey" TEXT,
    "angelNseToken" TEXT,
    "angelBseToken" TEXT,
    "mstockToken" TEXT,
    "exchangesJson" TEXT NOT NULL DEFAULT '[]',
    "segment" TEXT NOT NULL DEFAULT 'mainboard',
    "sector" TEXT,
    "industry" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sharesOutstanding" REAL,
    "sharesSource" TEXT,
    "marketCapInr" REAL,
    "marketCapCr" REAL,
    "marketCapSource" TEXT,
    "marketCapUpdatedAt" DATETIME,
    "lastPrice" REAL,
    "prevClose" REAL,
    "dailyVolume" REAL,
    "high52w" REAL,
    "low52w" REAL,
    "quoteProvider" TEXT,
    "quoteUpdatedAt" DATETIME,
    "fundamentalsJson" TEXT,
    "fundamentalProvider" TEXT,
    "fundamentalsUpdatedAt" DATETIME,
    "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "historical_daily_candles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "securityId" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL NOT NULL,
    "provider" TEXT NOT NULL,
    "exchangeTimestamp" TEXT NOT NULL,
    "adjusted" BOOLEAN NOT NULL DEFAULT true,
    "validated" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "historical_daily_candles_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "equity_security_master" ("companyId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "technical_daily_metrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "securityId" TEXT NOT NULL,
    "asOfDate" TEXT NOT NULL,
    "candleCount" INTEGER NOT NULL,
    "lastClose" REAL NOT NULL,
    "prevClose" REAL,
    "dailyVolume" REAL NOT NULL,
    "sma5" REAL,
    "sma10" REAL,
    "sma20" REAL,
    "sma50" REAL,
    "prevSma50" REAL,
    "sma50Prev5" REAL,
    "sma100" REAL,
    "sma100Prev5" REAL,
    "sma200" REAL,
    "ema9" REAL,
    "ema20" REAL,
    "ema50" REAL,
    "ema100" REAL,
    "ema200" REAL,
    "rsi14" REAL,
    "macd" REAL,
    "macdSignal" REAL,
    "macdHistogram" REAL,
    "atrPct" REAL,
    "bbWidthPct" REAL,
    "avgVol5d" REAL,
    "avgVol20d" REAL,
    "avgVol50d" REAL,
    "relativeVolume" REAL,
    "high52w" REAL,
    "low52w" REAL,
    "candleProvider" TEXT NOT NULL,
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "technical_daily_metrics_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "equity_security_master" ("companyId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_screener_job_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "specJson" TEXT NOT NULL,
    "coverageJson" TEXT NOT NULL DEFAULT '{}',
    "resultJson" TEXT NOT NULL DEFAULT '{}',
    "checkpointJson" TEXT NOT NULL DEFAULT '{}',
    "providerDiagnosticsJson" TEXT NOT NULL DEFAULT '[]',
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "evaluatedCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "unavailableCount" INTEGER NOT NULL DEFAULT 0,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "totalBatches" INTEGER NOT NULL DEFAULT 0,
    "completedBatches" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_screener_job_runs" ("coverageJson", "createdAt", "eligibleCount", "error", "id", "jobId", "matchedCount", "ownerKey", "query", "resultJson", "specJson", "status", "updatedAt") SELECT "coverageJson", "createdAt", "eligibleCount", "error", "id", "jobId", "matchedCount", "ownerKey", "query", "resultJson", "specJson", "status", "updatedAt" FROM "screener_job_runs";
DROP TABLE "screener_job_runs";
ALTER TABLE "new_screener_job_runs" RENAME TO "screener_job_runs";
CREATE UNIQUE INDEX "screener_job_runs_jobId_key" ON "screener_job_runs"("jobId");
CREATE INDEX "screener_job_runs_ownerKey_createdAt_idx" ON "screener_job_runs"("ownerKey", "createdAt");
CREATE INDEX "screener_job_runs_jobId_idx" ON "screener_job_runs"("jobId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "equity_security_master_companyId_key" ON "equity_security_master"("companyId");

-- CreateIndex
CREATE INDEX "equity_security_master_isin_idx" ON "equity_security_master"("isin");

-- CreateIndex
CREATE INDEX "equity_security_master_primaryTicker_idx" ON "equity_security_master"("primaryTicker");

-- CreateIndex
CREATE INDEX "equity_security_master_nseSymbol_idx" ON "equity_security_master"("nseSymbol");

-- CreateIndex
CREATE INDEX "equity_security_master_bseCode_idx" ON "equity_security_master"("bseCode");

-- CreateIndex
CREATE INDEX "equity_security_master_marketCapCr_idx" ON "equity_security_master"("marketCapCr");

-- CreateIndex
CREATE INDEX "equity_security_master_dailyVolume_idx" ON "equity_security_master"("dailyVolume");

-- CreateIndex
CREATE INDEX "historical_daily_candles_tradeDate_idx" ON "historical_daily_candles"("tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "historical_daily_candles_securityId_tradeDate_key" ON "historical_daily_candles"("securityId", "tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "technical_daily_metrics_securityId_key" ON "technical_daily_metrics"("securityId");

-- CreateIndex
CREATE INDEX "technical_daily_metrics_asOfDate_idx" ON "technical_daily_metrics"("asOfDate");

-- CreateIndex
CREATE INDEX "technical_daily_metrics_sma50_sma100_idx" ON "technical_daily_metrics"("sma50", "sma100");
