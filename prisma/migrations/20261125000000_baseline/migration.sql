-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'NSE',
    "sector" TEXT,
    "industry" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentSummary" TEXT,
    "attachmentsJson" TEXT NOT NULL DEFAULT '[]',
    "memoryRefs" TEXT NOT NULL DEFAULT '[]',
    "stageJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("conversationId") REFERENCES "conversation_records" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "conversation_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "summaryVersion" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" DATETIME,
    "entities" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'text',
    "pageNumber" INTEGER,
    "sectionTitle" TEXT,
    "parentChunkId" TEXT,
    "embeddingJson" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("documentId") REFERENCES "document_records" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER,
    "contentHash" TEXT,
    "sourceUrl" TEXT,
    "sourceName" TEXT,
    "companyId" TEXT,
    "documentCategory" TEXT NOT NULL DEFAULT 'general',
    "publicationDate" DATETIME,
    "reportingPeriod" TEXT,
    "reportingBasis" TEXT,
    "ingestionStatus" TEXT NOT NULL DEFAULT 'uploaded',
    "ingestionError" TEXT,
    "pageCount" INTEGER,
    "chunkCount" INTEGER,
    "storageKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "episodic_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT NOT NULL,
    "conversationId" TEXT,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "entitiesJson" TEXT NOT NULL DEFAULT '[]',
    "documentIds" TEXT NOT NULL DEFAULT '[]',
    "sourceMessageId" TEXT,
    "outcome" TEXT,
    "importance" REAL NOT NULL DEFAULT 0.5,
    "confidence" REAL NOT NULL DEFAULT 0.8,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "eventTimestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "long_term_memories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "memoryKey" TEXT,
    "title" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceRef" TEXT,
    "confidence" REAL NOT NULL DEFAULT 0.8,
    "importance" REAL NOT NULL DEFAULT 0.7,
    "sensitivity" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'active',
    "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATETIME,
    "expirationPolicy" TEXT NOT NULL DEFAULT 'manual',
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "memory_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "eventType" TEXT,
    "conversationId" TEXT,
    "summary" TEXT NOT NULL,
    "contentJson" TEXT,
    "entitiesJson" TEXT NOT NULL DEFAULT '[]',
    "sourceMessageId" TEXT,
    "sourceReportId" TEXT,
    "confidence" REAL NOT NULL DEFAULT 0.7,
    "importance" REAL NOT NULL DEFAULT 0.5,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" DATETIME,
    "lastAccessedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "memory_retrieval_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT NOT NULL,
    "conversationId" TEXT,
    "query" TEXT NOT NULL,
    "episodicCount" INTEGER NOT NULL DEFAULT 0,
    "longTermCount" INTEGER NOT NULL DEFAULT 0,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "selectedSourceIds" TEXT NOT NULL DEFAULT '[]',
    "retrievalMs" INTEGER NOT NULL DEFAULT 0,
    "contextTokenEstimate" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "research_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reportJson" TEXT,
    "errorMsg" TEXT,
    "processingMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "research_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "sourceType" TEXT,
    "authority" TEXT,
    "relevance" REAL,
    "publishedAt" DATETIME,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snippet" TEXT,
    FOREIGN KEY ("reportId") REFERENCES "research_reports" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "strategy_backtest_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runKey" TEXT NOT NULL,
    "resultHash" TEXT NOT NULL,
    "instrumentKey" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "benchmarkKey" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyVersion" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "coverageFrom" DATETIME,
    "coverageTo" DATETIME,
    "candleCount" INTEGER NOT NULL,
    "settingsJson" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "strategy_signals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signalKey" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "instrumentKey" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyVersion" TEXT NOT NULL,
    "decisionStatus" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'shadow',
    "marketTimestamp" DATETIME NOT NULL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "setupJson" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "outcomeStatus" TEXT NOT NULL DEFAULT 'pending',
    "outcomeJson" TEXT,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "trade_journal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT NOT NULL,
    "signalId" TEXT,
    "instrumentKey" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "strategyId" TEXT,
    "strategyVersion" TEXT,
    "actualEntry" REAL NOT NULL,
    "actualExit" REAL,
    "quantity" INTEGER NOT NULL,
    "actualCharges" REAL,
    "realizedPnl" REAL,
    "entryAt" DATETIME NOT NULL,
    "exitAt" DATETIME,
    "notes" TEXT,
    "userConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("signalId") REFERENCES "strategy_signals" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "watchlists" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_ticker_exchange_key" ON "companies"("ticker" ASC, "exchange" ASC);

-- CreateIndex
CREATE INDEX "conversation_messages_conversationId_createdAt_idx" ON "conversation_messages"("conversationId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "conversation_records_ownerKey_status_lastMessageAt_idx" ON "conversation_records"("ownerKey" ASC, "status" ASC, "lastMessageAt" ASC);

-- CreateIndex
CREATE INDEX "document_chunks_ownerKey_idx" ON "document_chunks"("ownerKey" ASC);

-- CreateIndex
CREATE INDEX "document_chunks_documentId_chunkIndex_idx" ON "document_chunks"("documentId" ASC, "chunkIndex" ASC);

-- CreateIndex
CREATE INDEX "document_records_contentHash_idx" ON "document_records"("contentHash" ASC);

-- CreateIndex
CREATE INDEX "document_records_ownerKey_companyId_idx" ON "document_records"("ownerKey" ASC, "companyId" ASC);

-- CreateIndex
CREATE INDEX "document_records_ownerKey_documentCategory_ingestionStatus_idx" ON "document_records"("ownerKey" ASC, "documentCategory" ASC, "ingestionStatus" ASC);

-- CreateIndex
CREATE INDEX "episodic_events_ownerKey_conversationId_idx" ON "episodic_events"("ownerKey" ASC, "conversationId" ASC);

-- CreateIndex
CREATE INDEX "episodic_events_ownerKey_eventType_eventTimestamp_idx" ON "episodic_events"("ownerKey" ASC, "eventType" ASC, "eventTimestamp" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "long_term_memories_ownerKey_category_memoryKey_key" ON "long_term_memories"("ownerKey" ASC, "category" ASC, "memoryKey" ASC);

-- CreateIndex
CREATE INDEX "long_term_memories_ownerKey_status_importance_idx" ON "long_term_memories"("ownerKey" ASC, "status" ASC, "importance" ASC);

-- CreateIndex
CREATE INDEX "long_term_memories_ownerKey_category_status_idx" ON "long_term_memories"("ownerKey" ASC, "category" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "memory_records_ownerKey_updatedAt_idx" ON "memory_records"("ownerKey" ASC, "updatedAt" ASC);

-- CreateIndex
CREATE INDEX "memory_records_ownerKey_conversationId_idx" ON "memory_records"("ownerKey" ASC, "conversationId" ASC);

-- CreateIndex
CREATE INDEX "memory_records_ownerKey_type_active_idx" ON "memory_records"("ownerKey" ASC, "type" ASC, "active" ASC);

-- CreateIndex
CREATE INDEX "memory_retrieval_logs_ownerKey_createdAt_idx" ON "memory_retrieval_logs"("ownerKey" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "strategy_backtest_runs_generatedAt_idx" ON "strategy_backtest_runs"("generatedAt" ASC);

-- CreateIndex
CREATE INDEX "strategy_backtest_runs_instrumentKey_strategyId_strategyVersion_idx" ON "strategy_backtest_runs"("instrumentKey" ASC, "strategyId" ASC, "strategyVersion" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "strategy_backtest_runs_runKey_key" ON "strategy_backtest_runs"("runKey" ASC);

-- CreateIndex
CREATE INDEX "strategy_signals_ownerKey_outcomeStatus_idx" ON "strategy_signals"("ownerKey" ASC, "outcomeStatus" ASC);

-- CreateIndex
CREATE INDEX "strategy_signals_ownerKey_ticker_strategyId_idx" ON "strategy_signals"("ownerKey" ASC, "ticker" ASC, "strategyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "strategy_signals_signalKey_key" ON "strategy_signals"("signalKey" ASC);

-- CreateIndex
CREATE INDEX "trade_journal_ownerKey_entryAt_idx" ON "trade_journal"("ownerKey" ASC, "entryAt" ASC);

-- CreateIndex
CREATE INDEX "trade_journal_ownerKey_ticker_idx" ON "trade_journal"("ownerKey" ASC, "ticker" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "watchlists_companyId_key" ON "watchlists"("companyId" ASC);

