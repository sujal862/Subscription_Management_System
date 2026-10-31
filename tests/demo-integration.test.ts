import test from 'node:test';
import assert from 'node:assert/strict';
import { testServer } from './helpers/test-server.js';

test('integrated authenticated catalog to quotation, activation, billing and reporting path', async t => {
  const { db, base } = await testServer(t);
  const { hashPassword } = await import('../server/src/lib/password.js');
  const password = 'Integrated!2026';
  await db.user.create({ data: { name: 'Demo admin', email: 'admin@integration.test', role: 'ADMIN', passwordHash: await hashPassword(password) } });
  const call = (path: string, body?: unknown, cookie?: string) => fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const admin = await call('/auth/login', { email: 'admin@integration.test', password });
  const cookie = admin.headers.get('set-cookie')!.split(';')[0];
  async function save(path: string, body: unknown, status = 201) {
    const response = await call(path, body, cookie);
    const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result.data;
  }
  const signup = await call('/auth/signup', { name: 'Demo buyer', email: 'buyer@integration.test', password });
  const customerCookie = signup.headers.get('set-cookie')!.split(';')[0];
  const customer = (await signup.json()).data;
  const product = await save('/catalog/products', { name: 'Integrated workspace', salesPriceMinor: 12000 });
  const variant = await save(`/catalog/products/${product.id}/variants`, { name: 'Plus', priceAdjustmentMinor: 500 });
  const tax = await save('/catalog/taxes', { name: 'GST 18%', rateBps: 1800 });
  const plan = await save('/catalog/plans', { name: 'Monthly workspace', productId: product.id, priceMinor: 10000, interval: 'MONTHLY', allowPause: true });
  const template = await save('/subscriptions/templates', { name: 'Monthly quotation', planId: plan.id, validDays: 14,
    lines: [{ productId: product.id, variantId: variant.id, quantity: 2, taxRuleId: tax.id }] });
  const today = new Date().toISOString().slice(0, 10);
  const quotation = await save('/subscriptions', { templateId: template.id, customerId: customer.customerId, startDate: today });
  assert.equal(quotation.status, 'QUOTATION');
  const confirmed = await save(`/subscriptions/${quotation.id}/transition`, { action: 'CONFIRMED' }, 200);
  assert.equal(confirmed.status, 'CONFIRMED');
  const active = await save(`/subscriptions/${quotation.id}/transition`, { action: 'ACTIVE' }, 200);
  assert.equal(active.status, 'ACTIVE');
  const firstRun = await save('/billing/run', { subscriptionId: active.id, targetDate: new Date().toISOString() }, 200);
  assert.equal(firstRun.invoicesCreated, 1); assert.deepEqual(firstRun.errors, []);
  const again = await save('/billing/run', { subscriptionId: active.id, targetDate: new Date().toISOString() }, 200);
  assert.equal(again.invoicesCreated, 0);
  const list = await (await call('/billing/invoices', undefined, cookie)).json();
  assert.equal(list.data.total, 1); assert.equal(list.data.items[0].status, 'DRAFT');
  assert.equal(list.data.items[0].totalMinor, 24780);
  const detail = await (await call(`/billing/invoices/${list.data.items[0].id}`, undefined, cookie)).json();
  assert.equal(detail.data.customerEmail, customer.email); assert.equal(detail.data.lines.length, 1);
  const summary = await (await call('/dashboard/summary', undefined, cookie)).json();
  assert.equal(summary.data.activeSubscriptions, 1); assert.equal(summary.data.invoicedRevenueMinor, 0, 'Draft billing must not fabricate recognized revenue');
  const invoiceId = list.data.items[0].id;
  await save(`/billing/invoices/${invoiceId}/confirm`, {}, 200);
  const partial = await save(`/billing/invoices/${invoiceId}/payments`, { method: 'CASH', amountMinor: 5000, paidAt: new Date().toISOString(), reference: 'DEMO-PARTIAL' });
  assert.equal(partial.invoice.status, 'CONFIRMED'); assert.equal(partial.invoice.remainingBalanceMinor, 19780);
  const partialSummary = (await (await call('/dashboard/summary', undefined, cookie)).json()).data;
  assert.equal(partialSummary.invoicedRevenueMinor, 21000); assert.equal(partialSummary.collectedMinor, 5000);
  assert.equal(partialSummary.outstandingMinor, 19780);
  for (const invalid of [{ method: 'CASH', amountMinor: 50000 }, { method: 'CASH', amountMinor: 10, paidAt: 'bad' }, { method: 'CASH', amountMinor: 10, paidAt: '2026-02-30T00:00:00Z' }]) {
    assert.equal((await call(`/billing/invoices/${invoiceId}/payments`, invalid, cookie)).status, 400);
  }
  assert.equal((await call(`/billing/invoices/${invoiceId}/cancel`, {}, cookie)).status, 400);
  const paid = await save(`/billing/invoices/${invoiceId}/payments`, { method: 'BANK', amountMinor: 19780, reference: 'DEMO-FINAL' });
  assert.equal(paid.invoice.status, 'PAID');
  const paidSummary = (await (await call('/dashboard/summary', undefined, cookie)).json()).data;
  assert.equal(paidSummary.invoicedRevenueMinor, 21000); assert.equal(paidSummary.collectedMinor, 24780);
  assert.equal(paidSummary.outstandingMinor, 0);
  for (const path of ['/dashboard/summary', '/billing/invoices', '/subscriptions', '/catalog/products']) {
    assert.equal((await call(path, undefined, customerCookie)).status, 403);
  }
  for (const input of [{ targetDate: 'tomorrow' }, { targetDate: '2026-02-30T00:00:00Z' }, { maxCatchUpCycles: 1000000 }, { subscriptionId: '' }]) {
    assert.equal((await call('/billing/run', input, cookie)).status, 400);
  }
  await db.subscriptionLine.deleteMany({ where: { subscriptionId: active.id } });
  await db.subscription.update({ where: { id: active.id }, data: { nextBillingDate: new Date('2026-01-01') } });
  const failed = await save('/billing/run', { subscriptionId: active.id, maxCatchUpCycles: 1 }, 200);
  assert.equal(failed.errors.length, 1);
  assert.equal(failed.errors[0].error, 'Billing could not complete for this subscription. Check its configuration and retry.');
});
