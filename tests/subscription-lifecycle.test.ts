import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { testServer } from './helpers/test-server.js';
import { createLifecycleFixture } from './fixtures/subscriptions.js';
import { HttpError } from '../server/src/lib/http.js';

test('subscription confirmation, activation, pause, closure and renewal', async t => {
  const { db, base } = await testServer(t);
  const { transitionSubscription: transition, renewSubscription: renew, processSubscriptionLifecycle: processDue } = await import('../server/src/modules/subscriptions/lifecycle.js');
  const { runBillingCycle } = await import('../server/src/modules/billing/recurring.js');
  const now = new Date('2026-11-01T12:00:00Z');
  const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise, error => error instanceof HttpError && error.code === code);
  await t.test('confirmation requires a valid quotation and preserves frozen prices and interval', async () => {
    const { subscription, plan } = await createLifecycleFixture(db, { status: 'QUOTATION' });
    await db.plan.update({ where: { id: plan.id }, data: { interval: 'YEARLY', priceMinor: 999 } });
    const confirmed = await transition(subscription.id, { action: 'CONFIRMED' }, now);
    assert.equal(confirmed.status, 'CONFIRMED'); assert.equal(confirmed.billingInterval, 'MONTHLY');
    assert.equal(confirmed.nextBillingDate, null); assert.equal(confirmed.billingAnchorDay, null);
    assert.equal(confirmed.lines[0].unitPriceMinor, 10000); assert.equal(await db.invoice.count(), 0);
    await rejects(transition(subscription.id, { action: 'CONFIRMED' }, now), 'INVALID_TRANSITION');
  });
  await t.test('missing, expired and exact-deadline quotations cannot be confirmed', async () => {
    for (const deadline of [null, new Date('2026-10-31T00:00:00Z'), now]) {
      const { subscription } = await createLifecycleFixture(db, { status: 'QUOTATION', quotationValidUntil: deadline });
      await rejects(transition(subscription.id, { action: 'CONFIRMED' }, now), 'QUOTATION_EXPIRED');
    }
  });
  await t.test('invalid date ordering, minimum quantity and plan availability reject confirmation', async () => {
    const { subscription, plan, product } = await createLifecycleFixture(db, { status: 'QUOTATION' });
    await db.subscription.update({ where: { id: subscription.id }, data: { expiryDate: subscription.startDate } });
    await rejects(transition(subscription.id, { action: 'CONFIRMED' }, now), 'VALIDATION_ERROR');
    await db.subscription.update({ where: { id: subscription.id }, data: { expiryDate: new Date('2027-01-31Z') } });
    await db.plan.update({ where: { id: plan.id }, data: { minimumQuantity: 3 } });
    await rejects(transition(subscription.id, { action: 'CONFIRMED' }, now), 'VALIDATION_ERROR');
    await db.plan.update({ where: { id: plan.id }, data: { minimumQuantity: 2, availableFrom: new Date('2026-02-01Z') } });
    await rejects(transition(subscription.id, { action: 'CONFIRMED' }, now), 'VALIDATION_ERROR');
    await db.plan.update({ where: { id: plan.id }, data: { availableFrom: null, isActive: false } });
    await rejects(transition(subscription.id, { action: 'CONFIRMED' }, now), 'VALIDATION_ERROR');
    await db.plan.update({ where: { id: plan.id }, data: { isActive: true } });
    await db.product.update({ where: { id: product.id }, data: { isActive: false } });
    await rejects(transition(subscription.id, { action: 'CONFIRMED' }, now), 'VALIDATION_ERROR');
  });
  await t.test('activation waits for start date, sets initial billing date and original anchor exactly once', async () => {
    const { subscription } = await createLifecycleFixture(db, { status: 'QUOTATION', startDate: new Date('2026-11-30Z') });
    await transition(subscription.id, { action: 'CONFIRMED' }, now);
    await rejects(transition(subscription.id, { action: 'ACTIVE' }, now), 'NOT_DUE');
    const active = await transition(subscription.id, { action: 'ACTIVE' }, new Date('2026-11-30Z'));
    assert.equal(active.nextBillingDate?.toISOString(), '2026-11-30T00:00:00.000Z'); assert.equal(active.billingAnchorDay, 30);
    await rejects(transition(subscription.id, { action: 'ACTIVE' }, new Date('2026-11-30Z')), 'INVALID_TRANSITION');
    assert.equal(await db.invoice.count(), 0);
  });
  await t.test('scheduler activates due confirmed records, skips future records and never makes invoices', async () => {
    const due = await createLifecycleFixture(db, { status: 'CONFIRMED', startDate: new Date('2026-10-31Z') });
    const future = await createLifecycleFixture(db, { status: 'CONFIRMED', startDate: new Date('2026-12-15Z') });
    const before = await db.invoice.count(); const result = await processDue({ now });
    assert.ok(result.activated.includes(due.subscription.id)); assert.ok(!result.activated.includes(future.subscription.id));
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: future.subscription.id } })).status, 'CONFIRMED');
    assert.equal(await db.invoice.count(), before);
  });
  await t.test('activation uses the preserved anchor through billing month-end catch-up', async () => {
    const { subscription } = await createLifecycleFixture(db, { status: 'CONFIRMED', startDate: new Date('2026-01-31Z') });
    await transition(subscription.id, { action: 'ACTIVE' }, new Date('2026-02-01Z'));
    const billed = await runBillingCycle({ subscriptionId: subscription.id, targetDate: new Date('2026-03-01Z') });
    assert.equal(billed.invoicesCreated, 2); assert.equal(billed.errors.length, 0);
    const saved = await db.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    assert.equal(saved.nextBillingDate?.toISOString(), '2026-03-31T00:00:00.000Z'); assert.equal(saved.billingAnchorDay, 31);
    assert.equal((await runBillingCycle({ subscriptionId: subscription.id, targetDate: new Date('2026-03-01Z') })).invoicesCreated, 0);
  });
  await t.test('pause requires permission and refuses to lose outstanding billing periods', async () => {
    const disallowed = await createLifecycleFixture(db, { allowPause: false });
    await rejects(transition(disallowed.subscription.id, { action: 'PAUSED' }, now), 'PLAN_ACTION_DENIED');
    const overdue = await createLifecycleFixture(db);
    await rejects(transition(overdue.subscription.id, { action: 'PAUSED' }, now), 'BILLING_PENDING');
    const exact = await createLifecycleFixture(db, { nextBillingDate: now });
    await rejects(transition(exact.subscription.id, { action: 'PAUSED' }, now), 'BILLING_PENDING');
  });
  await t.test('pause stops billing; resume schedules from resume date without paused-time catch-up', async () => {
    const { subscription } = await createLifecycleFixture(db, { nextBillingDate: new Date('2026-11-30Z') });
    const paused = await transition(subscription.id, { action: 'PAUSED' }, now);
    assert.equal(paused.status, 'PAUSED'); assert.equal(paused.pausedAt?.toISOString(), now.toISOString());
    assert.equal((await runBillingCycle({ subscriptionId: subscription.id, targetDate: new Date('2026-12-15Z') })).invoicesCreated, 0);
    const resumed = await transition(subscription.id, { action: 'RESUME' }, new Date('2026-12-15T14:00:00Z'));
    assert.equal(resumed.nextBillingDate?.toISOString(), '2026-12-15T00:00:00.000Z'); assert.equal(resumed.pausedAt, null); assert.equal(resumed.billingAnchorDay, 31);
    const billed = await runBillingCycle({ subscriptionId: subscription.id, targetDate: new Date('2026-12-15T14:00:00Z') });
    assert.equal(billed.invoicesCreated, 1);
    assert.equal((await db.invoice.findFirstOrThrow({ where: { subscriptionId: subscription.id } })).periodStart.toISOString(), '2026-12-15T00:00:00.000Z');
  });
  await t.test('expired or now-disallowed paused terms cannot resume', async () => {
    const expired = await createLifecycleFixture(db, { status: 'PAUSED', expiryDate: new Date('2026-10-31Z') });
    await rejects(transition(expired.subscription.id, { action: 'RESUME' }, now), 'VALIDATION_ERROR');
    const disallowed = await createLifecycleFixture(db, { status: 'PAUSED', allowPause: false });
    await rejects(transition(disallowed.subscription.id, { action: 'RESUME' }, now), 'PLAN_ACTION_DENIED');
  });
  await t.test('early closure checks plan permissions and billing cursor, then blocks new billing', async () => {
    const disallowed = await createLifecycleFixture(db, { allowEarlyClose: false });
    await rejects(transition(disallowed.subscription.id, { action: 'CLOSED' }, now), 'PLAN_ACTION_DENIED');
    const pending = await createLifecycleFixture(db);
    await rejects(transition(pending.subscription.id, { action: 'CLOSED' }, now), 'BILLING_PENDING');
    const allowed = await createLifecycleFixture(db, { nextBillingDate: new Date('2026-12-01Z') });
    const closed = await transition(allowed.subscription.id, { action: 'CLOSED' }, now);
    assert.equal(closed.status, 'CLOSED'); assert.equal(closed.closedAt?.toISOString(), now.toISOString());
    assert.equal((await runBillingCycle({ subscriptionId: allowed.subscription.id, targetDate: new Date('2027-01-01Z') })).invoicesCreated, 0);
  });
  await t.test('expiry auto-close defers capped catch-up, bills every eligible start, and excludes expiry itself', async () => {
    const fixture = await createLifecycleFixture(db, { status: 'CONFIRMED', interval: 'DAILY', startDate: new Date('2026-10-28Z'), expiryDate: new Date('2026-10-31Z'), allowEarlyClose: false });
    const recovered = await processDue({ now });
    assert.ok(recovered.activated.includes(fixture.subscription.id));
    assert.ok(recovered.deferred.some(item => item.id === fixture.subscription.id));
    await runBillingCycle({ subscriptionId: fixture.subscription.id, targetDate: now, maxCatchUpCycles: 1 });
    assert.ok((await processDue({ now })).deferred.some(item => item.id === fixture.subscription.id));
    const billed = await runBillingCycle({ subscriptionId: fixture.subscription.id, targetDate: now }); assert.equal(billed.invoicesCreated, 2);
    assert.ok((await processDue({ now })).closed.includes(fixture.subscription.id));
    assert.equal(await db.invoice.count({ where: { subscriptionId: fixture.subscription.id } }), 3);
    assert.equal(await db.invoice.count({ where: { subscriptionId: fixture.subscription.id, periodStart: { gte: new Date('2026-10-31Z') } } }), 0);
  });
  await t.test('autoClose false is respected; paused expired terms close without creating invoices', async () => {
    const manual = await createLifecycleFixture(db, { expiryDate: new Date('2026-10-31Z'), nextBillingDate: new Date('2026-10-31Z'), autoClose: false, allowEarlyClose: false });
    const paused = await createLifecycleFixture(db, { status: 'PAUSED', expiryDate: new Date('2026-10-31Z') });
    const before = await db.invoice.count(); const result = await processDue({ now });
    assert.ok(!result.closed.includes(manual.subscription.id)); assert.ok(result.closed.includes(paused.subscription.id)); assert.equal(await db.invoice.count(), before);
    assert.equal((await transition(manual.subscription.id, { action: 'CLOSED' }, now)).status, 'CLOSED');
  });
  await t.test('renewal creates an independent idempotent draft while preserving paid invoices', async () => {
    const source = await createLifecycleFixture(db, { startDate: new Date('2026-10-01Z'), expiryDate: new Date('2026-11-01Z') });
    await runBillingCycle({ subscriptionId: source.subscription.id, targetDate: now });
    const invoice = await db.invoice.findFirstOrThrow({ where: { subscriptionId: source.subscription.id }, include: { lines: true } });
    await db.payment.create({ data: { invoiceId: invoice.id, method: 'TEST_TRANSFER', amountMinor: invoice.totalMinor, paidAt: now } });
    await db.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
    const paid = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: true, payments: true } });
    const input = { startDate: '2026-11-01', expiryDate: '2026-12-01' };
    const renewed = await renew(source.subscription.id, input, now);
    assert.ok(renewed); assert.notEqual(renewed.id, source.subscription.id); assert.equal(renewed.status, 'DRAFT'); assert.equal(renewed.nextBillingDate, null);
    assert.match(renewed.lines[0].description, new RegExp(`Renewal of ${source.subscription.number}`)); assert.equal(renewed.lines[0].unitPriceMinor, 10000);
    assert.equal((await renew(source.subscription.id, input, now))?.id, renewed.id);
    assert.deepEqual(await db.invoice.findUniqueOrThrow({ where: { id: paid.id }, include: { lines: true, payments: true } }), paid);
    assert.deepEqual((await db.subscription.findUniqueOrThrow({ where: { id: source.subscription.id }, include: { lines: true } })).lines, source.subscription.lines);
    await rejects(renew(source.subscription.id, { ...input, expiryDate: '2026-12-02' }, now), 'RENEWAL_EXISTS');
  });
  await t.test('renewal permission, state, non-overlap, plan availability and minimum quantities are enforced', async () => {
    const disallowed = await createLifecycleFixture(db, { allowRenew: false });
    const input = { startDate: '2027-01-31', expiryDate: '2027-02-28' };
    await rejects(renew(disallowed.subscription.id, input, now), 'PLAN_ACTION_DENIED');
    const draft = await createLifecycleFixture(db, { status: 'DRAFT' });
    await rejects(renew(draft.subscription.id, input, now), 'INVALID_TRANSITION');
    const source = await createLifecycleFixture(db);
    await rejects(renew(source.subscription.id, { startDate: '2027-01-30', expiryDate: '2027-02-28' }, now), 'VALIDATION_ERROR');
    await db.plan.update({ where: { id: source.plan.id }, data: { availableUntil: new Date('2027-01-01Z') } });
    await rejects(renew(source.subscription.id, input, now), 'VALIDATION_ERROR');
    await db.plan.update({ where: { id: source.plan.id }, data: { availableUntil: null, minimumQuantity: 3 } });
    await rejects(renew(source.subscription.id, input, now), 'VALIDATION_ERROR');
  });
  await t.test('forbidden transition edges are rejected without changing the source', async () => {
    for (const [status, action] of [['DRAFT', 'ACTIVE'], ['DRAFT', 'CONFIRMED'], ['QUOTATION', 'ACTIVE'], ['CONFIRMED', 'PAUSED'], ['PAUSED', 'ACTIVE'], ['CLOSED', 'RESUME'], ['CLOSED', 'CLOSED']] as const) {
      const { subscription } = await createLifecycleFixture(db, { status });
      await rejects(transition(subscription.id, { action }, now), 'INVALID_TRANSITION');
      assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).status, status);
    }
  });
  await t.test('concurrent confirmations cannot both succeed or alter billing state', async () => {
    const { subscription } = await createLifecycleFixture(db, { status: 'QUOTATION' });
    const results = await Promise.allSettled([
      transition(subscription.id, { action: 'CONFIRMED' }, now),
      transition(subscription.id, { action: 'CONFIRMED' }, now),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const failed = results.find(result => result.status === 'rejected');
    assert.ok(failed && failed.status === 'rejected' && failed.reason instanceof HttpError);
    const saved = await db.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    assert.equal(saved.status, 'CONFIRMED'); assert.equal(saved.nextBillingDate, null);
  });
  await t.test('a renewal line write failure leaves no partial term and preserves the old term', async () => {
    const { subscription } = await createLifecycleFixture(db, { expiryDate: new Date('2026-11-01Z') });
    const before = await db.subscription.count(); const lineCount = await db.subscriptionLine.count();
    await db.$executeRawUnsafe("CREATE TRIGGER reject_renewal_lines BEFORE INSERT ON SubscriptionLine BEGIN SELECT RAISE(ABORT, 'renewal test failure'); END");
    try { await assert.rejects(renew(subscription.id, { startDate: '2026-11-01', expiryDate: '2026-12-01' }, now)); }
    finally { await db.$executeRawUnsafe('DROP TRIGGER reject_renewal_lines'); }
    assert.equal(await db.subscription.count(), before); assert.equal(await db.subscriptionLine.count(), lineCount);
    assert.deepEqual(await db.subscription.findUniqueOrThrow({ where: { id: subscription.id }, include: { lines: true } }), subscription);
  });
  await t.test('production APIs validate input and enforce session roles for lifecycle jobs and renewal', async () => {
    const { hashPassword } = await import('../server/src/lib/password.js');
    const password = randomBytes(18).toString('hex') + '!Aa'; const passwordHash = await hashPassword(password);
    const cookies: Record<string, string> = {};
    for (const role of ['STAFF', 'CUSTOMER'] as const) {
      const email = `${randomBytes(8).toString('hex')}@example.test`;
      await db.user.create({ data: { name: role, email, passwordHash, role } });
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      assert.equal(login.status, 200); cookies[role] = login.headers.get('set-cookie')!.split(';')[0];
    }
    const source = await createLifecycleFixture(db);
    async function post(route: string, body: unknown, role: string | null, expected: number) {
      const response = await fetch(`${base}/subscriptions${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(role ? { Cookie: cookies[role] } : {}) }, body: JSON.stringify(body) });
      assert.equal(response.status, expected, await response.text());
    }
    for (const role of [null, 'CUSTOMER']) {
      const expected = role ? 403 : 401;
      await post(`/${source.subscription.id}/transition`, { action: 'PAUSED' }, role, expected);
      await post(`/${source.subscription.id}/renew`, { startDate: '2027-01-31', expiryDate: '2027-02-28' }, role, expected);
      await post('/process-lifecycle', {}, role, expected);
    }
    await post('/process-lifecycle', { now: '2099-01-01' }, 'STAFF', 400);
    await post(`/${source.subscription.id}/transition`, { action: 'PAUSED', status: 'ACTIVE' }, 'STAFF', 400);
    await post(`/${source.subscription.id}/renew`, { startDate: '2027-02-30', expiryDate: '2027-01-01' }, 'STAFF', 400);
    await post('/missing/transition', { action: 'ACTIVE' }, 'STAFF', 404);
    await post(`/${source.subscription.id}/renew`, { startDate: '2027-01-31', expiryDate: '2027-02-28' }, 'STAFF', 201);
    await post('/process-lifecycle', {}, 'STAFF', 200);
  });
});
