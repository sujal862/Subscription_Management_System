import test from 'node:test';
import assert from 'node:assert/strict';
import { testServer } from './helpers/test-server.js';
import { createLifecycleFixture } from './fixtures/subscriptions.js';
import { outboxMessages } from './helpers/outbox.js';

test('final billing review regressions with real SQLite and auth gates', async t => {
  const { db, base } = await testServer(t);
  const { allocateDiscount, selectBestEligibleDiscount } = await import('../server/src/modules/billing/discounts.js');
  const { createInvoiceFromSubscription, confirmInvoice, cancelInvoice, recordPayment } = await import('../server/src/modules/billing/service.js');
  const { calculateInvoice, calculateLine } = await import('../server/src/modules/billing/calculation.js');
  const { runBillingCycle } = await import('../server/src/modules/billing/recurring.js');
  const { runScheduledBillingCycle } = await import('../server/src/modules/billing/scheduler.js');
  const { hashPassword } = await import('../server/src/lib/password.js');
  const password = 'FinalReview!2026';
  const hash = await hashPassword(password);
  await db.user.create({ data: { name: 'Review admin', email: 'review-admin@example.test', role: 'ADMIN', passwordHash: hash } });
  const login = async (email: string) => {
    const result = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(result.status, 200); return result.headers.get('set-cookie')!.split(';')[0];
  };
  const admin = await login('review-admin@example.test');
  const call = (route: string, cookie = admin, body?: unknown) => fetch(`${base}${route}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const rule = (extra: object = {}) => db.discountRule.create({ data: { name: 'Review savings', kind: 'FIXED', scope: 'SUBSCRIPTION', value: 2,
    startsAt: new Date('2020-01-01'), ...extra } });

  await t.test('one-paise proportional shares conserve exact savings and reject monetary overflow', async () => {
    const discount = await rule();
    const lines = Array.from({ length: 4 }, () => ({ productId: 'same', quantity: 1, unitPriceMinor: 1, taxRateBps: 0 }));
    const allocation = allocateDiscount(lines, selectBestEligibleDiscount([discount], lines, new Date()));
    assert.deepEqual(allocation, [1, 1, 0, 0]);
    const invoice = calculateInvoice(lines.map((line, index) => ({ ...line, discountMinor: allocation[index] })));
    assert.equal(invoice.discountMinor, 2); assert.equal(invoice.totalMinor, 2);
    assert.throws(() => calculateLine({ quantity: 1000000, unitPriceMinor: 2147483647, taxRateBps: 10000 }), /monetary range/);
    assert.throws(() => calculateLine({ quantity: 1, unitPriceMinor: 10, discountMinor: .5, taxRateBps: 0 }), /integer/);
    await db.discountRule.updateMany({ data: { isActive: false } });
  });
  await t.test('product discounts combine multiple variants/lines for eligibility and allocation', async () => {
    const fixture = await createLifecycleFixture(db);
    const discount = await rule({ scope: 'PRODUCT', productId: fixture.product.id, value: 150, minimumQuantity: 2, minimumPurchaseMinor: 200 });
    const lines = [
      { productId: fixture.product.id, quantity: 1, unitPriceMinor: 100, taxRateBps: 0 },
      { productId: fixture.product.id, quantity: 1, unitPriceMinor: 100, taxRateBps: 0 },
      { productId: 'another-product', quantity: 1, unitPriceMinor: 200, taxRateBps: 0 },
    ];
    const selected = selectBestEligibleDiscount([discount], lines, new Date());
    assert.equal(selected?.savingsMinor, 150);
    assert.deepEqual(allocateDiscount(lines, selected), [75, 75, 0]);
    await db.discountRule.updateMany({ data: { isActive: false } });
  });
  await t.test('failed redemption rolls back invoice, lines and reserved discount use', async () => {
    const fixture = await createLifecycleFixture(db);
    const discount = await rule({ value: 1000, usageLimit: 1 });
    await db.$executeRawUnsafe("CREATE TRIGGER review_redemption_failure BEFORE INSERT ON DiscountRedemption BEGIN SELECT RAISE(ABORT, 'review fixture failure'); END");
    try {
      await assert.rejects(createInvoiceFromSubscription({ subscriptionId: fixture.subscription.id, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-02-01') }));
    } finally { await db.$executeRawUnsafe('DROP TRIGGER review_redemption_failure'); }
    assert.equal(await db.invoice.count({ where: { subscriptionId: fixture.subscription.id } }), 0);
    assert.equal((await db.discountRule.findUniqueOrThrow({ where: { id: discount.id } })).uses, 0);
    await db.discountRule.updateMany({ data: { isActive: false } });
  });
  await t.test('overlapping billing runs never duplicate periods or regress the saved cursor', async () => {
    const { subscription } = await createLifecycleFixture(db, { startDate: new Date('2026-01-31'), nextBillingDate: new Date('2026-01-31') });
    const runs = await Promise.all([1, 2, 3].map(() => runBillingCycle({ subscriptionId: subscription.id, targetDate: new Date('2026-03-01') })));
    // A busy worker can safely retry; the persisted cursor remains authoritative.
    await runBillingCycle({ subscriptionId: subscription.id, targetDate: new Date('2026-03-01') });
    const invoices = await db.invoice.findMany({ where: { subscriptionId: subscription.id }, orderBy: { periodStart: 'asc' } });
    assert.equal(invoices.length, 2); assert.equal(new Set(invoices.map(row => row.periodStart.toISOString())).size, 2);
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).nextBillingDate?.toISOString(), '2026-03-31T00:00:00.000Z');
    assert.equal(runs.reduce((sum, run) => sum + run.invoicesCreated, 0), 2);
  });
  await t.test('limited discount use is not exceeded by independent concurrent invoices', async () => {
    const discount = await rule({ value: 1000, usageLimit: 1 });
    const fixtures = await Promise.all([1, 2].map(() => createLifecycleFixture(db)));
    const issue = (index: number) => createInvoiceFromSubscription({ subscriptionId: fixtures[index].subscription.id,
      periodStart: new Date('2026-04-01'), periodEnd: new Date('2026-05-01') });
    const settled = await Promise.allSettled([issue(0), issue(1)]);
    for (let index = 0; index < settled.length; index++) if (settled[index].status === 'rejected') await issue(index);
    assert.equal(await db.discountRedemption.count({ where: { discountId: discount.id } }), 1);
    assert.equal((await db.discountRule.findUniqueOrThrow({ where: { id: discount.id } })).uses, 1);
    assert.equal(await db.invoice.count({ where: { subscriptionId: { in: fixtures.map(row => row.subscription.id) } } }), 2);
    await db.discountRule.updateMany({ data: { isActive: false } });
  });
  await t.test('cancellation and payment cannot leave payments on a cancelled invoice', async () => {
    const fixture = await createLifecycleFixture(db);
    const invoice = await createInvoiceFromSubscription({ subscriptionId: fixture.subscription.id, periodStart: new Date('2026-05-01'), periodEnd: new Date('2026-06-01') });
    await confirmInvoice(invoice.id);
    await Promise.allSettled([cancelInvoice(invoice.id), recordPayment(invoice.id, { method: 'CASH', amountMinor: 100 })]);
    const final = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { payments: true } });
    assert.ok(final.status !== 'CANCELLED' || final.payments.length === 0);
    assert.ok(final.status === 'CANCELLED' || final.payments.length === 1);
  });
  await t.test('customer invoice and print DTOs omit staff notes/internal rules; mail escapes untrusted text', async () => {
    const fixture = await createLifecycleFixture(db);
    await db.user.create({ data: { name: 'Invoice customer', email: 'invoice-customer@example.test', role: 'CUSTOMER', customerId: fixture.customer.id, passwordHash: hash } });
    const customer = await login('invoice-customer@example.test');
    const discount = await rule({ value: 1000 });
    const invoice = await createInvoiceFromSubscription({ subscriptionId: fixture.subscription.id, periodStart: new Date('2026-06-01'), periodEnd: new Date('2026-07-01') });
    await confirmInvoice(invoice.id);
    await recordPayment(invoice.id, { method: 'BANK', amountMinor: 100, note: 'PRIVATE STAFF NOTE', reference: 'PRIVATE-BANK-REFERENCE' });
    await db.invoice.update({ where: { id: invoice.id }, data: { customerName: '<img src=x onerror=alert(1)>', customerAddress: '<script>secret()</script>' } });
    await db.invoiceLine.updateMany({ where: { invoiceId: invoice.id }, data: { description: '<svg onload=alert(1)>' } });
    for (const path of ['/portal/invoices', `/portal/invoices/${invoice.id}`, `/portal/invoices/${invoice.id}/print`]) {
      const response = await call(path, customer); assert.equal(response.status, 200);
      const text = await response.text();
      for (const secret of ['PRIVATE STAFF NOTE', 'PRIVATE-BANK-REFERENCE', 'usageLimit', 'minimumPurchaseMinor', 'costPriceMinor', 'passwordHash', 'subscriptionId']) assert.ok(!text.includes(secret), secret);
    }
    const sent = await call(`/billing/invoices/${invoice.id}/send`, admin, {});
    assert.equal(sent.status, 200); assert.equal((await sent.json()).data.deliveryMode, 'file');
    const body = outboxMessages().at(-1)!.body.split('<!DOCTYPE html>')[1];
    assert.ok(body.includes('&lt;img')); assert.ok(body.includes('&lt;script&gt;')); assert.ok(body.includes('&lt;svg'));
    assert.ok(!body.includes('<img src=x')); assert.ok(!body.includes('<script>secret'));
    await db.discountRule.updateMany({ where: { id: discount.id }, data: { isActive: false } });
    const other = await createLifecycleFixture(db);
    const hidden = await createInvoiceFromSubscription({ subscriptionId: other.subscription.id, periodStart: new Date('2026-06-01'), periodEnd: new Date('2026-07-01') });
    assert.equal((await call(`/portal/invoices/${hidden.id}`, customer)).status, 404);
    assert.equal((await call(`/portal/invoices/${hidden.id}/print`, customer)).status, 404);
  });
  await t.test('overdue API excludes zero-balance confirmed invoices before paginating and rejects bad filters', async () => {
    const fixture = await createLifecycleFixture(db);
    await db.invoice.create({ data: { number: 'INV-ZERO-BALANCE', subscriptionId: fixture.subscription.id,
      customerId: fixture.customer.id, customerName: fixture.customer.name, customerEmail: fixture.customer.email,
      status: 'CONFIRMED', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-02-01'), dueDate: new Date('2020-01-01'), subtotalMinor: 0, totalMinor: 0 } });
    const result = await call('/billing/invoices?overdue=true&pageSize=100');
    assert.equal(result.status, 200); const { data } = await result.json();
    assert.ok(data.items.every((row: { remainingBalanceMinor: number }) => row.remainingBalanceMinor > 0));
    assert.equal((await call('/billing/invoices?overdue=garbage')).status, 400);
    assert.equal((await call('/catalog/discounts', admin, { name: 'Invalid date', kind: 'FIXED', scope: 'SUBSCRIPTION', value: 100, startsAt: '2026-02-30' })).status, 400);
    assert.equal((await call('/catalog/products', admin, { name: 'Overflow', salesPriceMinor: 2147483648 })).status, 400);
  });
  await t.test('scheduled activation, billing catch-up and expiry closure execute in order', async () => {
    // Stop unrelated fixtures from participating in this focused scheduler check.
    await db.subscription.updateMany({ data: { status: 'CLOSED' } });
    const now = new Date(); const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const fixture = await createLifecycleFixture(db, { status: 'CONFIRMED', interval: 'DAILY',
      startDate: new Date(today.getTime() - 2 * 86400000), expiryDate: today });
    const [run, overlap] = await Promise.all([runScheduledBillingCycle(), runScheduledBillingCycle()]);
    assert.ok(run); assert.equal(overlap, null);
    assert.equal(await db.invoice.count({ where: { subscriptionId: fixture.subscription.id } }), 2);
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: fixture.subscription.id } })).status, 'CLOSED');
  });
});
