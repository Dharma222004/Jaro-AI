import { identifyCompany } from '../lib/research/company-resolver';
import { classifyDomain, extractFallbackCompanies } from '../lib/research/query-classifier';
import { resolveCompanyFromQuery } from '../lib/research/orchestrator';

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('JARO AI — UNIVERSAL COMPANY RESOLUTION & DOMAIN ROUTING TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} — ${detail ?? ''}`);
      failed++;
    }
  }

  // 1. Failure 1: V2 Retail queries
  console.log('--- TEST GROUP 1: V2 Retail Resolution (Failure 1) ---');
  const testV2_1 = await identifyCompany('Explain about the V2 retail');
  assert(
    testV2_1.resolved && testV2_1.company?.ticker === 'V2RETAIL',
    'Query "Explain about the V2 retail" resolves to V2RETAIL',
    `Resolved: ${testV2_1.company?.name} (${testV2_1.company?.ticker})`,
  );
  assert(
    testV2_1.company?.ticker !== 'RELIANCE',
    'Query "Explain about the V2 retail" does NOT resolve to Reliance',
    `Matched: ${testV2_1.company?.name}`,
  );

  const testV2_2 = await identifyCompany('V2RETAIL');
  assert(testV2_2.resolved && testV2_2.company?.ticker === 'V2RETAIL', 'Ticker "V2RETAIL" resolves');

  const testV2_3 = await identifyCompany('INE945H01021');
  assert(testV2_3.resolved && testV2_3.company?.ticker === 'V2RETAIL', 'ISIN "INE945H01021" resolves to V2RETAIL');

  const testV2_4 = await identifyCompany('BSE: 532867');
  assert(testV2_4.resolved && testV2_4.company?.ticker === 'V2RETAIL', 'BSE code 532867 resolves to V2RETAIL');

  // 2. Failure 2: Apollo Hospitals queries
  console.log('\n--- TEST GROUP 2: Apollo Hospitals In-Domain & Resolution (Failure 2) ---');
  const domainApollo = classifyDomain('Explain about the Apollo Hospital');
  assert(
    domainApollo.domain === 'finance',
    'Query "Explain about the Apollo Hospital" is classified as IN-DOMAIN (finance)',
    `Classified: ${domainApollo.domain} (${domainApollo.reason})`,
  );

  const testApollo_1 = await identifyCompany('Explain about the Apollo Hospital');
  assert(
    testApollo_1.resolved && testApollo_1.company?.ticker === 'APOLLOHOSP',
    'Query "Explain about the Apollo Hospital" resolves to APOLLOHOSP',
    `Resolved: ${testApollo_1.company?.name} (${testApollo_1.company?.ticker})`,
  );

  const testApollo_2 = await identifyCompany('APOLLOHOSP');
  assert(testApollo_2.resolved && testApollo_2.company?.ticker === 'APOLLOHOSP', 'Ticker "APOLLOHOSP" resolves');

  const testApollo_3 = await identifyCompany('INE437A01024');
  assert(testApollo_3.resolved && testApollo_3.company?.ticker === 'APOLLOHOSP', 'ISIN "INE437A01024" resolves to APOLLOHOSP');

  // 3. Failure 3: Swiggy and Exchange Prefixes
  console.log('\n--- TEST GROUP 3: Swiggy & Exchange Prefixes ---');
  const testSwiggy_1 = await identifyCompany('Swiggy');
  assert(testSwiggy_1.resolved && testSwiggy_1.company?.ticker === 'SWIGGY', 'Query "Swiggy" resolves to SWIGGY');

  const testSwiggy_2 = await identifyCompany('Swiggy Limited, XNSE: SWIGGY');
  assert(
    testSwiggy_2.resolved && testSwiggy_2.company?.ticker === 'SWIGGY',
    'Query "Swiggy Limited, XNSE: SWIGGY" resolves to SWIGGY',
    `Resolved: ${testSwiggy_2.company?.name} (${testSwiggy_2.company?.ticker})`,
  );

  const testSwiggy_3 = await identifyCompany('XNSE: SWIGGY');
  assert(testSwiggy_3.resolved && testSwiggy_3.company?.ticker === 'SWIGGY', 'Prefix "XNSE: SWIGGY" resolves to SWIGGY');

  // 4. Jio Platforms standalone
  console.log('\n--- TEST GROUP 4: Jio Platforms Standalone Resolution ---');
  const testJPL = await identifyCompany('Jio Platforms');
  assert(
    testJPL.resolved && testJPL.company?.ticker === 'JPL',
    'Query "Jio Platforms" resolves to JPL (Jio Platforms Limited)',
    `Resolved: ${testJPL.company?.name} (${testJPL.company?.ticker})`,
  );
  assert(testJPL.company?.ticker !== 'RELIANCE', 'Jio Platforms does NOT collapse to Reliance');

  // 5. Typo correction
  console.log('\n--- TEST GROUP 5: Common Financial Typos ---');
  const testHdfc_1 = await identifyCompany('HDFC babk');
  assert(
    testHdfc_1.resolved && testHdfc_1.company?.ticker === 'HDFCBANK',
    'Typo "HDFC babk" resolves to HDFCBANK',
    `Resolved: ${testHdfc_1.company?.name}`,
  );

  const testHdfc_2 = await identifyCompany('HDFC bak');
  assert(
    testHdfc_2.resolved && testHdfc_2.company?.ticker === 'HDFCBANK',
    'Typo "HDFC bak" resolves to HDFCBANK',
    `Resolved: ${testHdfc_2.company?.name}`,
  );

  const testZomato = await identifyCompany('zomatto');
  assert(
    testZomato.resolved && (testZomato.company?.ticker === 'ZOMATO' || testZomato.company?.ticker === 'ETERNAL'),
    'Typo "zomatto" resolves to ZOMATO/ETERNAL',
    `Resolved: ${testZomato.company?.name}`,
  );

  // 6. Non-financial Domain Gating
  console.log('\n--- TEST GROUP 6: Domain Gating Verification ---');
  const dWeather = classifyDomain('What is the weather forecast in Mumbai today?');
  assert(dWeather.domain === 'non_finance', 'Weather query is non_finance');

  const dRecipe = classifyDomain('Give me a recipe for chicken biryani');
  assert(dRecipe.domain === 'non_finance', 'Recipe query is non_finance');

  const dMedical = classifyDomain('Diagnose my fever and headache');
  assert(dMedical.domain === 'non_finance', 'Personal symptom query is non_finance');

  // 7. Orchestrator safety check
  console.log('\n--- TEST GROUP 7: Orchestrator Safety Check ---');
  const orchApollo = await resolveCompanyFromQuery('Explain about the Apollo Hospital');
  assert(orchApollo.resolved && orchApollo.company?.ticker === 'APOLLOHOSP', 'Orchestrator resolveCompanyFromQuery resolves Apollo Hospital');

  const orchV2 = await resolveCompanyFromQuery('Explain about the V2 retail');
  assert(orchV2.resolved && orchV2.company?.ticker === 'V2RETAIL', 'Orchestrator resolveCompanyFromQuery resolves V2 Retail');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
