import { prisma } from '../lib/database/client';
import { memoryOwnerKey, createAuthenticatedUserToken } from '../lib/memory/identity';
import { createTradeJournalEntry, listTradeJournal, deleteJournalRecord } from '../lib/strategy/journal';

async function main() {
  console.log('--- Testing Database Client & User Authorization ---');

  // Test 1: User A identity and token
  const tokenUserA = createAuthenticatedUserToken('user_test_alpha_01');
  const tokenUserB = createAuthenticatedUserToken('user_test_beta_02');

  const ownerA = memoryOwnerKey(tokenUserA);
  const ownerB = memoryOwnerKey(tokenUserB);

  console.log('✅ User A Owner Key:', ownerA.slice(0, 16) + '...');
  console.log('✅ User B Owner Key:', ownerB.slice(0, 16) + '...');

  if (ownerA === ownerB) {
    throw new Error('User A and User B owner keys must not match!');
  }

  // Test 2: Clean up any prior test records
  await prisma.tradeJournal.deleteMany({ where: { ownerKey: { in: [ownerA, ownerB] } } });

  // Test 3: User A creates trade journal entry
  const entryAt = new Date();
  const tradeA = await createTradeJournalEntry(tokenUserA, {
    ticker: 'TCS',
    instrumentKey: 'NSE_EQ|INE467B01029',
    actualEntry: 3850.5,
    quantity: 10,
    entryAt,
    notes: 'User A swing entry',
  });

  console.log('✅ Trade record created for User A with ID:', tradeA.id);

  // Test 4: List trades for User A
  const tradesA = await listTradeJournal(tokenUserA);
  console.log('✅ User A retrieved trades count:', tradesA.length);
  if (tradesA.length !== 1 || tradesA[0].id !== tradeA.id) {
    throw new Error('User A could not retrieve their own trade record!');
  }

  // Test 5: Verify User B CANNOT see User A's trade
  const tradesB = await listTradeJournal(tokenUserB);
  console.log('✅ User B retrieved trades count:', tradesB.length);
  if (tradesB.length !== 0) {
    throw new Error('DATA LEAK: User B was able to see User A\'s trade record!');
  }

  // Test 6: Verify User B CANNOT delete User A's trade
  const deleteResultByB = await deleteJournalRecord(tokenUserB, 'trade', tradeA.id);
  console.log('✅ User B deletion attempt deleted count:', deleteResultByB.count);
  if (deleteResultByB.count !== 0) {
    throw new Error('SECURITY VIOLATION: User B was able to delete User A\'s record!');
  }

  // Test 7: User A can delete their own trade
  const deleteResultByA = await deleteJournalRecord(tokenUserA, 'trade', tradeA.id);
  console.log('✅ User A deletion count:', deleteResultByA.count);
  if (deleteResultByA.count !== 1) {
    throw new Error('User A was unable to delete their own record!');
  }

  console.log('🎉 ALL DATABASE PERSISTENCE & USER AUTHORIZATION TESTS PASSED SUCCESSFULLY!');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
