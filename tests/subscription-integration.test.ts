import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { testServer } from './helpers/test-server.js';

test('catalog APIs -> template -> quotation -> active subscription -> recurring invoice', async t => {
  const { db, base } = await testServer(t);
  const { hashPassword } = await import('../server/src/lib/password.js');
  const password = randomBytes(18).toString('hex') + '!Aa';
  const passwordHash = await hashPassword(password);
  const cookies: Record<string, string> = {};
  for (const role of ['ADMIN', 'STAFF'] as const) {
    const email = `${role.toLowerCase()}@integration.example.test`;
    await db.user.create({ data: { name: role, email, passwordHash, role } });
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200); cookies[role] = login.headers.get('set-cookie')!.split(';')[0];
  }
  async function request(path: string, method = 'GET', body?: unknown, role = 'STAFF', expected = 200) {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookies[role], ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result.data;
  }
  const now = new Date(); const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const later = (days: number) => new Date(day.getTime() + days * 86400000).toISOString().slice(0, 10);
  let product: any, addon: any, variant: any, plan: any, customer: any, template: any, quotation: any;
  // Tax APIs are still Member 2's pending increment. Seed only this tax fixture in
  // the disposable test DB; all products/plans/variants are created via catalog APIs.
  const tax = await db.taxRule.create({ data: { name: 'GST test fixture', rateBps: 1800 } });
  await t.test('real catalog selectors supply products, variants and plans', async () => {
    product = await request('/catalog/products', 'POST', { name: 'Workspace', salesPriceMinor: 50000, costPriceMinor: 33333, notes: 'Private supplier notes' }, 'ADMIN', 201);
    addon = await request('/catalog/products', 'POST', { name: 'Storage', salesPriceMinor: 1001 }, 'ADMIN', 201);
    variant = await request(`/catalog/products/${product.id}/variants`, 'POST', { name: 'Pro', priceAdjustmentMinor: 500 }, 'ADMIN', 201);
    plan = await request('/catalog/plans', 'POST', { name: 'Workspace monthly', productId: product.id, priceMinor: 10000, interval: 'MONTHLY', minimumQuantity: 2, allowPause: true, allowEarlyClose: true, allowRenew: true, availableFrom: later(-1), availableUntil: later(120) }, 'ADMIN', 201);
    assert.ok((await request('/catalog/products?pageSize=100')).items.find((item: any) => item.id === product.id).variants.some((item: any) => item.id === variant.id));
    assert.ok((await request('/catalog/plans?pageSize=100')).items.some((item: any) => item.id === plan.id));
    customer = await request('/subscriptions/customers', 'POST', { name: 'Buyer', email: 'buyer@integration.example.test' }, 'STAFF', 201);
  });
  await t.test('template quotation copies final line prices exactly once and retains its independent lines', async () => {
    template = await request('/subscriptions/templates', 'POST', { name: 'Monthly offer', planId: plan.id, validDays: 14, paymentTermDays: 7, lines: [{ productId: product.id, variantId: variant.id, quantity: 2, unitPriceMinor: 10500, taxRuleId: tax.id }, { productId: addon.id, quantity: 3, unitPriceMinor: 1001, taxRuleId: tax.id }] }, 'STAFF', 201);
    quotation = await request('/subscriptions', 'POST', { templateId: template.id, customerId: customer.id, startDate: later(0), expiryDate: later(30) }, 'STAFF', 201);
    assert.equal(quotation.subtotalMinor, 24003); assert.equal(quotation.taxMinor, 4321); assert.equal(quotation.totalMinor, 28324);
    await request(`/subscriptions/templates/${template.id}`, 'PATCH', { lines: [{ productId: product.id, variantId: variant.id, quantity: 4, unitPriceMinor: 10500, taxRuleId: tax.id }] });
    assert.deepEqual((await request(`/subscriptions/${quotation.id}`)).lines, quotation.lines);
  });
  await t.test('catalog edits do not change quotation prices, tax snapshots or the frozen billing interval', async () => {
    await request(`/catalog/products/${product.id}`, 'PATCH', { name: 'Renamed workspace', salesPriceMinor: 99999 }, 'ADMIN');
    await request(`/catalog/products/${product.id}/variants/${variant.id}`, 'PATCH', { priceAdjustmentMinor: 9999 }, 'ADMIN');
    await request(`/catalog/plans/${plan.id}`, 'PATCH', { priceMinor: 88888, interval: 'YEARLY' }, 'ADMIN');
    await db.taxRule.update({ where: { id: tax.id }, data: { rateBps: 1000 } });
    const saved = await request(`/subscriptions/${quotation.id}`); assert.equal(saved.totalMinor, 28324); assert.equal(saved.billingInterval, 'MONTHLY'); assert.deepEqual(saved.lines, quotation.lines);
  });
  await t.test('staff confirmation/activation feeds Member 4 a valid billable subscription', async () => {
    const confirmed = await request(`/subscriptions/${quotation.id}/transition`, 'POST', { action: 'CONFIRMED' }); assert.equal(confirmed.status, 'CONFIRMED');
    const active = await request(`/subscriptions/${quotation.id}/transition`, 'POST', { action: 'ACTIVE' });
    assert.equal(active.status, 'ACTIVE'); assert.equal(active.billingAnchorDay, day.getUTCDate()); assert.equal(active.nextBillingDate, day.toISOString()); assert.equal(active.billingInterval, 'MONTHLY');
    assert.equal(await db.invoice.count(), 0);
    const run = await request('/billing/run', 'POST', { subscriptionId: quotation.id, targetDate: now.toISOString() }); assert.equal(run.invoicesCreated, 1); assert.equal(run.errors.length, 0);
    const invoice = await db.invoice.findFirstOrThrow({ where: { subscriptionId: quotation.id }, include: { lines: true } });
    assert.equal(invoice.totalMinor, 28324); assert.equal(invoice.customerName, customer.name); assert.equal(invoice.lines.find(line => line.productId === product.id)?.description, 'Workspace — Pro');
    assert.equal((await request('/billing/run', 'POST', { subscriptionId: quotation.id, targetDate: now.toISOString() })).invoicesCreated, 0);
  });
  await t.test('renewal and closure preserve issued, paid historical invoices and payments', async () => {
    const invoice = await db.invoice.findFirstOrThrow({ where: { subscriptionId: quotation.id } });
    // Payment API is owned by Member 4. Populate historical payment state only in
    // this isolated fixture rather than implementing finance behavior here.
    await db.payment.create({ data: { invoiceId: invoice.id, amountMinor: invoice.totalMinor, method: 'TEST_TRANSFER', paidAt: now } });
    await db.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
    const old = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: true, payments: true } });
    const renewal = await request(`/subscriptions/${quotation.id}/renew`, 'POST', { startDate: later(30), expiryDate: later(60) }, 'STAFF', 201);
    assert.equal(renewal.status, 'DRAFT'); assert.notEqual(renewal.id, quotation.id); assert.equal(renewal.billingInterval, 'YEARLY');
    assert.equal((await request(`/subscriptions/${quotation.id}/transition`, 'POST', { action: 'CLOSED' })).status, 'CLOSED');
    assert.deepEqual(await db.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: true, payments: true } }), old);
    const filtered = await request(`/subscriptions?status=CLOSED&search=${quotation.number}&customerId=${customer.id}`); assert.equal(filtered.total, 1);
  });
  await t.test('archived catalog references block new drafts and renewal without touching prior records', async () => {
    await request(`/catalog/products/${product.id}`, 'PATCH', { isActive: false }, 'ADMIN');
    await request('/subscriptions', 'POST', { customerId: customer.id, planId: plan.id, startDate: later(0), lines: [{ productId: product.id, quantity: 2 }] }, 'STAFF', 400);
    await request(`/subscriptions/${quotation.id}/renew`, 'POST', { startDate: later(61), expiryDate: later(90) }, 'STAFF', 400);
    assert.equal((await request(`/subscriptions/${quotation.id}`)).totalMinor, 28324);
  });
});
