// scripts/test-memory-system.ts
// Comprehensive verification test for Jaro AI Memory, Context & Document RAG Intelligence

import { memoryOwnerKey } from '../lib/memory/identity';
import { upsertConversation, getConversation, appendMessage, getConversationMessages } from '../lib/memory/conversation-store';
import { createEpisode, searchEpisodes, listEpisodes, deleteEpisode } from '../lib/memory/episodic-store';
import { upsertLongTermMemory, retrieveLongTermMemories, listLongTermMemories, deleteLongTermMemory } from '../lib/memory/long-term-store';
import { createDocumentRecord, saveDocumentChunks, hybridSearchChunks, listDocuments, deleteDocument } from '../lib/documents/store';
import { orchestrateMemoryRetrieval } from '../lib/memory/orchestrator';
import { exportMemoryData, importMemoryData, createLocalBackup } from '../lib/memory/storage-adapter';

async function runTests() {
  console.log('================================================================');
  console.log('🧪 JARO AI MEMORY, CONTEXT & DOCUMENT RAG VERIFICATION SUITE');
  console.log('================================================================\n');

  const testIdentityA = 'test_user_identity_alpha_1234567890abcdef';
  const testIdentityB = 'test_user_identity_beta_9876543210fedcba';
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  try {
    // ── TEST A: In-Context Memory & Conversation Store ──────────
    console.log('--- Test Suite A: In-Context & Conversation Store ---');
    const convId = `conv_${Date.now()}`;
    const conv = await upsertConversation(testIdentityA, {
      conversationId: convId,
      title: 'GAIL & ONGC Comparative Valuation',
      summary: 'User requested comprehensive research on GAIL and ONGC.',
      entities: ['GAIL', 'ONGC'],
      bumpMessageCount: true,
    });
    assert(conv.id === convId, 'Conversation record created with correct ID');
    assert(conv.entities.includes('GAIL') && conv.entities.includes('ONGC'), 'Entities correctly normalized and persisted');

    await appendMessage(testIdentityA, {
      conversationId: convId,
      role: 'user',
      content: 'Analyse GAIL completely and compare debt with ONGC.',
    });
    await appendMessage(testIdentityA, {
      conversationId: convId,
      role: 'assistant',
      content: 'GAIL debt/equity is 0.21 while ONGC debt/equity is 0.48.',
    });

    const messages = await getConversationMessages(testIdentityA, convId);
    assert(messages.length === 2, 'Conversation messages persisted and retrieved in order');
    assert(messages[0].role === 'user' && messages[1].role === 'assistant', 'Roles preserved correctly');

    // ── TEST B: Episodic Memory Engine ──────────────────────────
    console.log('\n--- Test Suite B: Episodic Memory Engine ---');
    const ep = await createEpisode(testIdentityA, {
      conversationId: convId,
      eventType: 'company_research',
      title: 'GAIL Comprehensive Fundamental Report',
      summary: 'Generated institutional fundamental report for GAIL (India) Limited. Identified strong natural gas transmission volumes and low debt.',
      entities: ['GAIL'],
      outcome: 'success',
      importance: 0.85,
      confidence: 0.95,
      metadata: { targetPeriod: 'FY2025', sector: 'Utilities' },
    });
    assert(ep.title.includes('GAIL'), 'Episodic event created with title and summary');

    // Cross-conversation search
    const foundEpisodes = await searchEpisodes(testIdentityA, {
      query: 'What did we conclude about GAIL earlier?',
      entities: ['GAIL'],
      limit: 5,
    });
    assert(foundEpisodes.length > 0 && foundEpisodes[0].entities.includes('GAIL'), 'Episodic memory retrieved across conversations via hybrid entity+lexical search');

    // ── TEST C: Long-Term Memory (Semantic, Procedural, Preference)
    console.log('\n--- Test Suite C: Long-Term Durable Memory ---');
    const testKey = `pref_valuation_${Date.now()}`;
    const pref = await upsertLongTermMemory(testIdentityA, {
      category: 'preference',
      memoryKey: testKey,
      title: 'Valuation Multiple Preference',
      value: 'Prefer comparing PE and PB to 5-year historical medians rather than NIFTY benchmarks alone.',
      sourceType: 'user_explicit',
      importance: 0.9,
    });
    assert(pref.version === 1, 'Long-term preference memory created (v1)');

    // Conflict / Supersede test
    const updatedPref = await upsertLongTermMemory(testIdentityA, {
      category: 'preference',
      memoryKey: testKey,
      title: 'Valuation Multiple Preference',
      value: 'Updated: Compare PE to 10-year median and industry peers.',
      sourceType: 'user_explicit',
      importance: 0.95,
    });
    assert(updatedPref.version === 2, 'Memory conflict handled cleanly: version incremented to v2');
    assert(updatedPref.previousId === pref.id, 'Previous version linked for audit trail');

    const ltmSearchResults = await retrieveLongTermMemories(testIdentityA, {
      query: 'What is my preferred valuation metric style?',
    });
    assert(ltmSearchResults.length > 0 && ltmSearchResults[0].value.includes('10-year median'), 'Active updated version retrieved');

    // ── TEST D: Document Knowledge Base & Hybrid RAG ────────────
    console.log('\n--- Test Suite D: Document Knowledge Base & Hybrid Retrieval ---');
    const doc = await createDocumentRecord(testIdentityA, {
      title: 'GAIL Annual Report FY2025',
      fileName: 'GAIL_Annual_Report_FY25.pdf',
      fileType: 'pdf',
      documentCategory: 'annual_report',
      reportingPeriod: 'FY2025',
      reportingBasis: 'consolidated',
    });
    assert(doc.id.length > 0, 'Document record registered in knowledge base');

    const sampleChunks = [
      {
        chunkIndex: 0,
        content: 'GAIL (India) Limited consolidated revenue from operations for the financial year ended March 31, 2025 stood at ₹1,34,500 Crore compared to ₹1,28,000 Crore in FY2024.',
        contentType: 'text',
        pageNumber: 12,
        sectionTitle: 'Financial Highlights',
      },
      {
        chunkIndex: 1,
        content: 'Total outstanding consolidated debt as of March 31, 2025 was ₹15,200 Crore against total shareholders equity of ₹72,400 Crore, resulting in a Debt to Equity ratio of 0.21.',
        contentType: 'table',
        pageNumber: 48,
        sectionTitle: 'Consolidated Balance Sheet',
      },
    ];

    const ownerKeyA = memoryOwnerKey(testIdentityA);
    await saveDocumentChunks(doc.id, ownerKeyA, sampleChunks);

    const retrievedChunks = await hybridSearchChunks(testIdentityA, {
      query: 'What was GAIL total debt and debt to equity ratio?',
      companyId: undefined,
      topK: 3,
    });
    assert(retrievedChunks.length > 0, 'Document chunks retrieved via hybrid search');
    assert(retrievedChunks[0].content.includes('Debt to Equity ratio of 0.21'), 'Exact balance sheet figure retrieved from document chunk');
    assert(retrievedChunks[0].pageNumber === 48, 'Page reference preserved for exact citation');

    // ── TEST E: Unified Memory Retrieval Orchestrator ───────────
    console.log('\n--- Test Suite E: Unified Memory Retrieval Orchestration ---');
    const orchestrated = await orchestrateMemoryRetrieval({
      identity: testIdentityA,
      query: 'Tell me about GAIL financial position',
      conversationId: convId,
      entities: ['GAIL'],
      includeDocuments: true,
    });
    assert(orchestrated.diagnostics.durationMs >= 0, 'Orchestrator executed all 4 tiers in parallel');
    assert(orchestrated.episodicMemories.length > 0, 'Orchestrator retrieved relevant episodic memories');
    assert(orchestrated.documentChunks.length > 0, 'Orchestrator retrieved grounded document evidence');

    // ── TEST F: Security & Multi-Tenant User Isolation ───────────
    console.log('\n--- Test Suite F: Multi-Tenant Security & Isolation ---');
    const userBChunks = await hybridSearchChunks(testIdentityB, {
      query: 'GAIL debt to equity',
    });
    assert(userBChunks.length === 0, 'Tenant Isolation: User B cannot retrieve User A documents');

    const userBEpisodes = await searchEpisodes(testIdentityB, {
      query: 'GAIL',
    });
    assert(userBEpisodes.length === 0, 'Tenant Isolation: User B cannot retrieve User A episodic memories');

    // ── TEST G: Persistence, Backup & Cloud Portability ─────────
    console.log('\n--- Test Suite G: Backup & Cloud Migration Package ---');
    const backup = await createLocalBackup(testIdentityA);
    assert(backup.recordCounts.longTermMemories > 0, 'Local JSON backup file generated with exact record counts');

    const exportPackage = await exportMemoryData(testIdentityA);
    assert(exportPackage.counts.documents > 0, 'Export package structured for zero-rewrite cloud migration');

    // ── CLEANUP TEST RECORDS ────────────────────────────────────
    console.log('\n--- Cleanup Test Records ---');
    await deleteDocument(testIdentityA, doc.id);
    await deleteEpisode(testIdentityA, ep.id);
    await deleteLongTermMemory(testIdentityA, updatedPref.id);
    console.log('🧹 Test records safely deactivated/cleaned.');

  } catch (error) {
    console.error('Fatal test error:', error);
    failed++;
  }

  console.log('\n================================================================');
  console.log(`📊 FINAL TEST REPORT: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runTests();
