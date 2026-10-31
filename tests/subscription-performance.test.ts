import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { testServer } from './helpers/test-server.js';
import { createLifecycleFixture } from './fixtures/subscriptions.js';

test('subscription pages and due-date query remain bounded with 6000 SQLite records', async t => {
  const { db, base } = await testServer(t);
  const { hashPassword } = await import('../server/src/lib/password.js');
  const fixture = await createLifecycleFixture(db); const second = await createLifecycleFixture(db);
  const password = randomBytes(20).toString('hex') + '!Aa'; const passwordHash = await hashPassword(password);
  const cookies: Record<string, string> = {};
  for (const role of ['STAFF', 'CUSTOMER'] as const) {
    const email = `${role.toLowerCase()}@performance.example.test`;
    await db.user.create({ data: { name: role, role, email, passwordHash, ...(role === 'CUSTOMER' ? { customerId: fixture.customer.id } : {}) } });
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200); cookies[role] = login.headers.get('set-cookie')!.split(';')[0];
  }
  const now = new Date();
  // Bulk fixtures exercise read paths only; lifecycle/billing suites use full line-bearing fixtures.
  await db.subscription.createMany({ data: Array.from({ length: 6000 }, (_, index) => ({
    id: `c${randomBytes(12).toString('hex')}`, number: `SUB-PERFORMANCE-${String(index).padStart(6, '0')}`,
    customerId: index % 2 ? second.customer.id : fixture.customer.id, planId: fixture.plan.id,
    status: index % 3 ? 'ACTIVE' as const : 'PAUSED' as const, startDate: new Date('2026-01-01Z'),
    billingInterval: 'MONTHLY' as const, nextBillingDate: new Date(now.getTime() + (index % 2 ? 86400000 : -86400000)), billingAnchorDay: 1,
  })) });
  const plan = await db.$queryRawUnsafe<{ detail: string }[]>("EXPLAIN QUERY PLAN SELECT id FROM Subscription WHERE status = 'ACTIVE' AND nextBillingDate <= ? ORDER BY nextBillingDate ASC", now.getTime());
  assert.ok(plan.some(row => row.detail.includes('Subscription_status_nextBillingDate_idx')), plan.map(row => row.detail).join('; '));
  const ownerPlan = await db.$queryRawUnsafe<{ detail: string }[]>("EXPLAIN QUERY PLAN SELECT id FROM Subscription WHERE customerId = ? AND status = 'ACTIVE'", fixture.customer.id);
  assert.ok(ownerPlan.some(row => row.detail.includes('Subscription_customerId_status_idx')), ownerPlan.map(row => row.detail).join('; '));
  const dueStart = performance.now();
  const due = await db.subscription.findMany({ where: { status: 'ACTIVE', nextBillingDate: { lte: now } }, select: { id: true, nextBillingDate: true }, orderBy: { nextBillingDate: 'asc' } });
  const dueMs = performance.now() - dueStart; assert.ok(due.length > 1000); assert.ok(dueMs < 2000, `Due-date query took ${dueMs.toFixed(1)}ms`);
  async function measure(path: string, role: string, expected: number) {
    const start = performance.now(); const response = await fetch(`${base}${path}`, { headers: { Cookie: cookies[role] } });
    const body = await response.json(); const ms = performance.now() - start;
    assert.equal(response.status, 200); assert.equal(body.data.items.length, 20); assert.equal(body.data.total, expected);
    assert.ok(ms < 2000, `${path} took ${ms.toFixed(1)}ms`); return ms;
  }
  const staffMs = await measure('/subscriptions?page=100&pageSize=20&search=SUB-PERFORMANCE', 'STAFF', 6000);
  const portalMs = await measure('/portal/subscriptions?page=100&pageSize=20&search=SUB-PERFORMANCE', 'CUSTOMER', 3000);
  t.diagnostic(`6000 records: due query ${dueMs.toFixed(1)}ms; staff page ${staffMs.toFixed(1)}ms; own-customer page ${portalMs.toFixed(1)}ms. Both agreed indexes used.`);
});
