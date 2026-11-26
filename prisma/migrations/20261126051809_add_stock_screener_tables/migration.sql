-- CreateTable
CREATE TABLE "saved_screeners" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specJson" TEXT NOT NULL,
    "exchanges" TEXT NOT NULL DEFAULT 'BOTH',
    "timeframe" TEXT NOT NULL DEFAULT '1d',
    "lastRunAt" DATETIME,
    "lastMatchCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "screener_job_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "specJson" TEXT NOT NULL,
    "coverageJson" TEXT NOT NULL DEFAULT '{}',
    "resultJson" TEXT NOT NULL DEFAULT '{}',
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "saved_screeners_ownerKey_updatedAt_idx" ON "saved_screeners"("ownerKey", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "screener_job_runs_jobId_key" ON "screener_job_runs"("jobId");

-- CreateIndex
CREATE INDEX "screener_job_runs_ownerKey_createdAt_idx" ON "screener_job_runs"("ownerKey", "createdAt");

-- CreateIndex
CREATE INDEX "screener_job_runs_jobId_idx" ON "screener_job_runs"("jobId");
