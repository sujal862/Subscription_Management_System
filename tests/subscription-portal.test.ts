import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { testServer } from './helpers/test-server.js';
import { createLifecycleFixture } from './fixtures/subscriptions.js';

test('customer portal scopes reads and mutations using real authenticated identity', async t => {
  const { db, base } = await testServer(t);
  const { hashPassword } = await import('../server/src/lib/password.js');
  const password = randomBytes(20).toString('hex') + '!Aa'; const passwordHash = await hashPassword(password);
  const accounts: Record<string, { cookie: string; customerId: string | null }> = {};
  for (const role of ['CUSTOMER_A', 'CUSTOMER_B', 'UNLINKED', 'STAFF', 'ADMIN']) {
    const customer = role.startsWith('CUSTOMER_') ? await db.customer.create({ data: { name: role, email: `${role.toLowerCase()}@portal.example.test` } }) : null;
    const email = `${role.toLowerCase()}@portal-login.example.test`;
    await db.user.create({ data: { name: role, email, passwordHash, role: role === 'STAFF' || role === 'ADMIN' ? role : 'CUSTOMER', customerId: customer?.id } });
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200); accounts[role] = { cookie: login.headers.get('set-cookie')!.split(';')[0], customerId: customer?.id ?? null };
  }
  const now = new Date(); const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const later = (days: number) => new Date(day.getTime() + days * 86400000);
  async function owned(role: string, options: Parameters<typeof createLifecycleFixture>[1] = {}) {
    const fixture = await createLifecycleFixture(db, { startDate: later(-2), expiryDate: later(20), nextBillingDate: later(1), ...options });
    await db.subscription.update({ where: { id: fixture.subscription.id }, data: { customerId: accounts[role].customerId! } });
    return fixture;
  }
  const own = await owned('CUSTOMER_A'); const other = await owned('CUSTOMER_B');
  await db.product.update({ where: { id: own.product.id }, data: { costPriceMinor: 777777, notes: 'Internal supplier notes' } });
  async function call(path: string, role: string | null, method = 'GET', body?: unknown, expected = 200) {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(role ? { Cookie: accounts[role].cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
  }
  function safe(value: unknown) {
    const forbidden = new Set(['customerId', 'customer', 'email', 'user', 'passwordHash', 'costPriceMinor', 'notes', 'product', 'variant', 'taxRule', 'planId', 'billingAnchorDay']);
    function inspect(node: unknown) {
      if (!node || typeof node !== 'object') return;
      for (const [key, child] of Object.entries(node)) { assert.ok(!forbidden.has(key), `Private field ${key} leaked`); inspect(child); }
    }
    inspect(value);
  }
  await t.test('anonymous, unlinked and staff identities cannot enter the customer portal', async () => {
    await call('/portal/subscriptions', null, 'GET', undefined, 401);
    for (const role of ['UNLINKED', 'STAFF', 'ADMIN']) await call('/portal/subscriptions', role, 'GET', undefined, 403);
  });
  await t.test('list and detail return only the signed-in customer records and safe fields', async () => {
    for (const [role, id, forbiddenNumber] of [['CUSTOMER_A', own.subscription.id, other.subscription.number], ['CUSTOMER_B', other.subscription.id, own.subscription.number]]) {
      const list = await call('/portal/subscriptions', role); assert.equal(list.data.total, 1); assert.equal(list.data.items[0].id, id); safe(list);
      const detail = await call(`/portal/subscriptions/${id}`, role); safe(detail); assert.equal(detail.data.totalMinor, 23600);
      assert.ok(!JSON.stringify(list).includes(forbiddenNumber)); assert.ok(!JSON.stringify(detail).includes(forbiddenNumber));
    }
  });
  await t.test('cross-customer ID guessing returns the same 404 as a missing resource', async () => {
    for (const [role, id] of [['CUSTOMER_A', other.subscription.id], ['CUSTOMER_B', own.subscription.id]]) {
      const forbidden = await call(`/portal/subscriptions/${id}`, role, 'GET', undefined, 404);
      const absent = await call('/portal/subscriptions/missing', role, 'GET', undefined, 404);
      assert.deepEqual(forbidden, absent);
      await call(`/portal/subscriptions/${id}/transition`, role, 'POST', { action: 'PAUSED' }, 404);
      await call(`/portal/subscriptions/${id}/transition`, role, 'POST', { action: 'CLOSED' }, 404);
      await call(`/portal/subscriptions/${id}/renew`, role, 'POST', { startDate: later(20).toISOString().slice(0, 10), expiryDate: later(40).toISOString().slice(0, 10) }, 404);
    }
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: other.subscription.id } })).status, 'ACTIVE');
  });
  await t.test('submitted ownership, status and commercial fields cannot override session scope', async () => {
    await call(`/portal/subscriptions?customerId=${accounts.CUSTOMER_B.customerId}`, 'CUSTOMER_A', 'GET', undefined, 400);
    await call('/portal/subscriptions?pageSize=101', 'CUSTOMER_A', 'GET', undefined, 400);
    await call('/portal/subscriptions?status=INVALID', 'CUSTOMER_A', 'GET', undefined, 400);
    await call(`/portal/subscriptions/${own.subscription.id}/transition`, 'CUSTOMER_A', 'POST', { action: 'PAUSED', customerId: accounts.CUSTOMER_B.customerId }, 400);
    for (const action of ['ACTIVE', 'CONFIRMED', 'QUOTATION', 'UNKNOWN']) await call(`/portal/subscriptions/${own.subscription.id}/transition`, 'CUSTOMER_A', 'POST', { action }, 400);
    await call(`/portal/subscriptions/${own.subscription.id}/renew`, 'CUSTOMER_A', 'POST', { startDate: later(20).toISOString().slice(0, 10), expiryDate: later(40).toISOString().slice(0, 10), customerId: accounts.CUSTOMER_B.customerId }, 400);
    await call('/subscriptions', 'CUSTOMER_A', 'GET', undefined, 403);
    await call('/subscriptions/customers', 'CUSTOMER_A', 'GET', undefined, 403);
  });
  await t.test('search, status and pagination are database-scoped, including counts', async () => {
    await owned('CUSTOMER_A', { status: 'CLOSED' });
    const list = await call('/portal/subscriptions?pageSize=1&page=2', 'CUSTOMER_A'); assert.equal(list.data.items.length, 1); assert.equal(list.data.total, 2);
    assert.equal((await call('/portal/subscriptions?status=CLOSED', 'CUSTOMER_A')).data.total, 1);
    assert.equal((await call(`/portal/subscriptions?search=${other.subscription.number}`, 'CUSTOMER_A')).data.total, 0);
    assert.equal((await call(`/portal/subscriptions?search=${own.subscription.number}`, 'CUSTOMER_A')).data.total, 1);
    assert.equal((await call('/portal/subscriptions?page=100', 'CUSTOMER_A')).data.items.length, 0);
  });
  await t.test('plan-denied pause, closure and renewal remain denied in customer routes', async () => {
    const restricted = await owned('CUSTOMER_A', { allowPause: false, allowEarlyClose: false, allowRenew: false });
    await call(`/portal/subscriptions/${restricted.subscription.id}/transition`, 'CUSTOMER_A', 'POST', { action: 'PAUSED' }, 403);
    await call(`/portal/subscriptions/${restricted.subscription.id}/transition`, 'CUSTOMER_A', 'POST', { action: 'CLOSED' }, 403);
    await call(`/portal/subscriptions/${restricted.subscription.id}/renew`, 'CUSTOMER_A', 'POST', { startDate: later(20).toISOString().slice(0, 10), expiryDate: later(40).toISOString().slice(0, 10) }, 403);
  });
  await t.test('own pause/resume/renew/close succeed without leaking staff data', async () => {
    safe(await call(`/portal/subscriptions/${own.subscription.id}/transition`, 'CUSTOMER_A', 'POST', { action: 'PAUSED' }));
    safe(await call(`/portal/subscriptions/${own.subscription.id}/transition`, 'CUSTOMER_A', 'POST', { action: 'RESUME' }));
    const renewal = await call(`/portal/subscriptions/${own.subscription.id}/renew`, 'CUSTOMER_A', 'POST', { startDate: later(20).toISOString().slice(0, 10), expiryDate: later(40).toISOString().slice(0, 10) }, 201);
    safe(renewal); assert.equal(renewal.data.status, 'DRAFT');
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: renewal.data.id } })).customerId, accounts.CUSTOMER_A.customerId);
    await call(`/portal/subscriptions/${renewal.data.id}`, 'CUSTOMER_B', 'GET', undefined, 404);
    // Resuming schedules today's period. Customer cannot bypass that pending billing.
    const pending = await call(`/portal/subscriptions/${own.subscription.id}/transition`, 'CUSTOMER_A', 'POST', { action: 'CLOSED' }, 409);
    assert.match(pending.error.message, /contact support/);
    const { runBillingCycle } = await import('../server/src/modules/billing/recurring.js');
    await runBillingCycle({ subscriptionId: own.subscription.id });
    safe(await call(`/portal/subscriptions/${own.subscription.id}/transition`, 'CUSTOMER_A', 'POST', { action: 'CLOSED' }));
  });
  await t.test('ownership is checked atomically inside the reusable mutation service', async () => {
    const { transitionSubscription, renewSubscription } = await import('../server/src/modules/subscriptions/lifecycle.js');
    await assert.rejects(transitionSubscription(other.subscription.id, { action: 'PAUSED' }, now, accounts.CUSTOMER_A.customerId!), { status: 404 });
    await assert.rejects(renewSubscription(other.subscription.id, { startDate: later(20).toISOString().slice(0, 10), expiryDate: later(40).toISOString().slice(0, 10) }, now, accounts.CUSTOMER_A.customerId!), { status: 404 });
  });
});
