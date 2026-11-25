-- AlterTable
ALTER TABLE "conversation_messages" ADD COLUMN "intent" TEXT;
ALTER TABLE "conversation_messages" ADD COLUMN "requestId" TEXT;
ALTER TABLE "conversation_messages" ADD COLUMN "toolResultsJson" TEXT;

-- AlterTable
ALTER TABLE "research_sources" ADD COLUMN "dataFreshness" TEXT;
ALTER TABLE "research_sources" ADD COLUMN "reportingPeriod" TEXT;

-- CreateTable
CREATE TABLE "portfolio_holdings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT NOT NULL,
    "instrumentKey" TEXT,
    "ticker" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'NSE',
    "sector" TEXT,
    "side" TEXT NOT NULL DEFAULT 'long',
    "quantity" REAL NOT NULL,
    "entryPrice" REAL NOT NULL,
    "stopLoss" REAL,
    "target" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "security_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT,
    "eventType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "status" TEXT NOT NULL,
    "requestId" TEXT,
    "ipHash" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "tool_execution_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT,
    "ownerKey" TEXT,
    "toolName" TEXT NOT NULL,
    "paramsHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "dataFreshness" TEXT,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_conversation_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "summaryVersion" INTEGER NOT NULL DEFAULT 0,
    "summaryMessageCount" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" DATETIME,
    "entities" TEXT NOT NULL DEFAULT '[]',
    "openTasksJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_conversation_records" ("createdAt", "entities", "id", "lastMessageAt", "messageCount", "ownerKey", "status", "summary", "summaryVersion", "title", "updatedAt") SELECT "createdAt", "entities", "id", "lastMessageAt", "messageCount", "ownerKey", "status", "summary", "summaryVersion", "title", "updatedAt" FROM "conversation_records";
DROP TABLE "conversation_records";
ALTER TABLE "new_conversation_records" RENAME TO "conversation_records";
CREATE INDEX "conversation_records_ownerKey_status_lastMessageAt_idx" ON "conversation_records"("ownerKey", "status", "lastMessageAt");
CREATE TABLE "new_watchlists" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT NOT NULL DEFAULT 'legacy_default',
    "companyId" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "watchlists_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_watchlists" ("addedAt", "companyId", "id") SELECT "addedAt", "companyId", "id" FROM "watchlists";
DROP TABLE "watchlists";
ALTER TABLE "new_watchlists" RENAME TO "watchlists";
CREATE INDEX "watchlists_ownerKey_idx" ON "watchlists"("ownerKey");
CREATE UNIQUE INDEX "watchlists_ownerKey_companyId_key" ON "watchlists"("ownerKey", "companyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "portfolio_holdings_ownerKey_idx" ON "portfolio_holdings"("ownerKey");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_holdings_ownerKey_ticker_exchange_key" ON "portfolio_holdings"("ownerKey", "ticker", "exchange");

-- CreateIndex
CREATE INDEX "security_audit_logs_eventType_createdAt_idx" ON "security_audit_logs"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "security_audit_logs_ownerKey_createdAt_idx" ON "security_audit_logs"("ownerKey", "createdAt");

-- CreateIndex
CREATE INDEX "security_audit_logs_requestId_idx" ON "security_audit_logs"("requestId");

-- CreateIndex
CREATE INDEX "tool_execution_logs_requestId_idx" ON "tool_execution_logs"("requestId");

-- CreateIndex
CREATE INDEX "tool_execution_logs_toolName_createdAt_idx" ON "tool_execution_logs"("toolName", "createdAt");

-- CreateIndex
CREATE INDEX "tool_execution_logs_ownerKey_createdAt_idx" ON "tool_execution_logs"("ownerKey", "createdAt");

-- CreateIndex
CREATE INDEX "conversation_messages_requestId_idx" ON "conversation_messages"("requestId");

