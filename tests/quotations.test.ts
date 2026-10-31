import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import express, { type ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../server/src/lib/http.js';

test('quotation templates and quotations use independent database records', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'brightloop-quotations-'));
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replaceAll('\\', '/')}`;
  process.env.NODE_ENV = 'test';
  writeFileSync(path.join(directory, 'test.db'), '');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const { db } = await import('../server/src/lib/db.js');
  const { createSubscriptionHandlers, subscriptionsRouter } = await import('../server/src/modules/subscriptions/router.js');
  const app = express(); app.use(express.json());
  app.use('/guarded', subscriptionsRouter); app.use('/subscriptions', createSubscriptionHandlers());
  let expectedDatabaseFailure = false;
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) return void res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } });
    if (error instanceof HttpError) return void res.status(error.status).json({ error: { code: error.code, message: error.message } });
    if (!expectedDatabaseFailure) console.error(error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
  };
  app.use(errors);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  async function request(route: string, method = 'GET', body?: unknown, expected = 200) {
    const response = await fetch(`${base}${route}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result.data;
  }
  try {
    const customer = await db.customer.create({ data: { name: 'Acme', email: 'acme@example.com' } });
    const product = await db.product.create({ data: { name: 'Workspace', salesPriceMinor: 50000 } });
    const addon = await db.product.create({ data: { name: 'Storage', salesPriceMinor: 1001 } });
    const variant = await db.productVariant.create({ data: { name: 'Pro', productId: product.id, priceAdjustmentMinor: 500 } });
    const foreignVariant = await db.productVariant.create({ data: { name: 'Extra', productId: addon.id } });
    const plan = await db.plan.create({ data: { name: 'Monthly', productId: product.id, priceMinor: 10000, interval: 'MONTHLY', minimumQuantity: 2, availableFrom: new Date('2026-01-01Z'), availableUntil: new Date('2027-01-01Z') } });
    const tax = await db.taxRule.create({ data: { name: 'GST', rateBps: 1800 } });
    const lines = [{ productId: product.id, variantId: variant.id, quantity: 2, unitPriceMinor: 10500, taxRuleId: tax.id }, { productId: addon.id, quantity: 3, unitPriceMinor: 1001, taxRuleId: tax.id }];
    const payload = { name: ' Monthly quotation ', planId: plan.id, validDays: 30, paymentTermDays: 21, lines };
    let template: any, quotation: any;
    await t.test('template and transition production routes retain the shared role gate', async () => {
      await request('/guarded/templates', 'GET', undefined, 401);
      await request('/guarded/example/transition', 'POST', { action: 'QUOTATION' }, 401);
    });
    await t.test('create template with calculated totals and no duplicated plan price', async () => {
      template = await request('/subscriptions/templates', 'POST', payload, 201);
      assert.equal(template.name, 'Monthly quotation'); assert.equal(template.validDays, 30); assert.equal(template.paymentTermDays, 21);
      assert.equal(template.lines.length, 2); assert.equal(template.subtotalMinor, 24003); assert.equal(template.taxMinor, 4321); assert.equal(template.totalMinor, 28324);
      assert.equal(template.lines[0].productId, product.id); assert.equal(template.lines[0].unitPriceMinor, 10500);
    });
    await t.test('template routes take precedence; list, search, detail and pagination work', async () => {
      await request('/subscriptions/templates', 'POST', { ...payload, name: 'Annual offer' }, 201);
      const list = await request('/subscriptions/templates?pageSize=1&page=2'); assert.equal(list.total, 2); assert.equal(list.items.length, 1);
      assert.equal((await request('/subscriptions/templates?search=Monthly')).total, 2);
      assert.equal((await request('/subscriptions/templates?search=Annual')).total, 1);
      assert.equal((await request(`/subscriptions/templates/${template.id}`)).totalMinor, 28324);
      await request('/subscriptions/templates/missing', 'GET', undefined, 404);
      await request('/subscriptions/templates?pageSize=101', 'GET', undefined, 400);
    });
    await t.test('template validation rejects invalid metadata and catalog relationships', async () => {
      const count = await db.quotationTemplate.count();
      for (const patch of [{ name: '' }, { validDays: 0 }, { validDays: 366 }, { validDays: 1.5 }, { paymentTermDays: -1 }, { lines: [] }, { status: 'ACTIVE' }]) await request('/subscriptions/templates', 'POST', { ...payload, ...patch }, 400);
      await request('/subscriptions/templates', 'POST', { ...payload, planId: 'missing' }, 404);
      for (const patch of [{ productId: addon.id }, { variantId: foreignVariant.id }, { variantId: 'missing' }, { quantity: 1 }, { quantity: 0 }, { quantity: 2.5 }, { unitPriceMinor: -1 }, { unitPriceMinor: 1 }, { taxRuleId: 'missing' }]) await request('/subscriptions/templates', 'POST', { ...payload, lines: [{ ...lines[0], ...patch }] }, 400);
      assert.equal(await db.quotationTemplate.count(), count);
    });
    await t.test('partial template edits preserve omitted metadata, and reject invalid replacements', async () => {
      const updated = await request(`/subscriptions/templates/${template.id}`, 'PATCH', { name: 'Updated offer' });
      assert.equal(updated.validDays, 30); assert.equal(updated.paymentTermDays, 21); assert.equal(updated.lines.length, 2);
      await request(`/subscriptions/templates/${template.id}`, 'PATCH', {}, 400);
      await request('/subscriptions/templates/missing', 'PATCH', { name: 'Unknown' }, 404);
      const otherPlan = await db.plan.create({ data: { name: 'Other', productId: addon.id, priceMinor: 1001, interval: 'WEEKLY' } });
      await request(`/subscriptions/templates/${template.id}`, 'PATCH', { planId: otherPlan.id }, 400);
      await request(`/subscriptions/templates/${template.id}`, 'PATCH', { lines: [{ ...lines[0], variantId: foreignVariant.id }] }, 400);
      assert.equal((await request(`/subscriptions/templates/${template.id}`)).totalMinor, 28324);
    });
    const quotationInput = { templateId: '', customerId: customer.id, startDate: '2026-11-01', expiryDate: '2027-11-01' };
    await t.test('create quotation from template with copied terms, prices and validity', async () => {
      quotationInput.templateId = template.id;
      const before = Date.now();
      quotation = await request('/subscriptions', 'POST', quotationInput, 201);
      assert.equal(quotation.status, 'QUOTATION'); assert.equal(quotation.paymentTermDays, 21); assert.equal(quotation.billingInterval, 'MONTHLY');
      assert.equal(quotation.nextBillingDate, null); assert.equal(quotation.billingAnchorDay, null); assert.equal(quotation.totalMinor, 28324);
      assert.equal(quotation.lines[0].taxRateBps, 1800);
      assert.ok(quotation.lines.every((line: any) => !template.lines.some((source: any) => source.id === line.id)));
      const deadline = Date.parse(quotation.quotationValidUntil); assert.ok(deadline >= before + 30 * 86400000 && deadline <= Date.now() + 30 * 86400000);
      const second = await request('/subscriptions', 'POST', quotationInput, 201); assert.notEqual(second.number, quotation.number);
      assert.equal((await request('/subscriptions?status=QUOTATION')).total, 2);
    });
    await t.test('template edits do not rewrite quotation lines or terms', async () => {
      await request(`/subscriptions/templates/${template.id}`, 'PATCH', { validDays: 3, paymentTermDays: 1, lines: [{ ...lines[0], quantity: 4 }] });
      const unchanged = await request(`/subscriptions/${quotation.id}`);
      assert.deepEqual(unchanged.lines, quotation.lines); assert.equal(unchanged.paymentTermDays, 21); assert.equal(unchanged.quotationValidUntil, quotation.quotationValidUntil);
      const newer = await request('/subscriptions', 'POST', quotationInput, 201); assert.equal(newer.lines.length, 1); assert.equal(newer.lines[0].quantity, 4); assert.equal(newer.paymentTermDays, 1);
    });
    await t.test('quotation input cannot override templates or submit invalid references/dates', async () => {
      const before = await db.subscription.count();
      for (const [patch, status] of [[{ templateId: 'missing' }, 404], [{ customerId: 'missing' }, 404], [{ planId: 'different' }, 400], [{ lines }, 400], [{ paymentTermDays: 0 }, 400], [{ quotationValidUntil: '2099-01-01' }, 400], [{ status: 'ACTIVE' }, 400], [{ expiryDate: '2026-10-01' }, 400], [{ startDate: '2026-02-30' }, 400], [{ startDate: '2027-02-01' }, 400]] as const) await request('/subscriptions', 'POST', { ...quotationInput, ...patch }, status);
      assert.equal(await db.subscription.count(), before);
    });
    await t.test('catalog changes preserve template prices and capture tax at quotation creation', async () => {
      await db.plan.update({ where: { id: plan.id }, data: { priceMinor: 40000 } });
      await db.product.update({ where: { id: product.id }, data: { name: 'New workspace' } });
      await db.taxRule.update({ where: { id: tax.id }, data: { rateBps: 1000 } });
      const newQuote = await request('/subscriptions', 'POST', quotationInput, 201); assert.equal(newQuote.lines[0].unitPriceMinor, 10500); assert.equal(newQuote.lines[0].taxRateBps, 1000); assert.equal(newQuote.lines[0].description, 'New workspace — Pro');
      assert.equal((await request(`/subscriptions/${quotation.id}`)).totalMinor, quotation.totalMinor);
      await db.plan.update({ where: { id: plan.id }, data: { priceMinor: 10000 } });
    });
    await t.test('inactive plan, product, variant and tax block new quotations', async () => {
      await db.plan.update({ where: { id: plan.id }, data: { isActive: false } }); await request('/subscriptions', 'POST', quotationInput, 400); await db.plan.update({ where: { id: plan.id }, data: { isActive: true } });
      await db.product.update({ where: { id: product.id }, data: { isActive: false } }); await request('/subscriptions', 'POST', quotationInput, 400); await db.product.update({ where: { id: product.id }, data: { isActive: true } });
      await db.productVariant.update({ where: { id: variant.id }, data: { isActive: false } }); await request('/subscriptions', 'POST', quotationInput, 400); await db.productVariant.update({ where: { id: variant.id }, data: { isActive: true } });
      await db.taxRule.update({ where: { id: tax.id }, data: { isActive: false } }); await request('/subscriptions', 'POST', quotationInput, 400); await db.taxRule.update({ where: { id: tax.id }, data: { isActive: true } });
    });
    await t.test('DRAFT to QUOTATION preserves snapshots and rejects repeat/future transitions', async () => {
      const draft = await request('/subscriptions', 'POST', { customerId: customer.id, planId: plan.id, startDate: '2026-11-01', paymentTermDays: 7, lines }, 201);
      const converted = await request(`/subscriptions/${draft.id}/transition`, 'POST', { action: 'QUOTATION', validDays: 10 });
      assert.equal(converted.status, 'QUOTATION'); assert.deepEqual(converted.lines, draft.lines); assert.equal(converted.totalMinor, draft.totalMinor);
      assert.equal(converted.nextBillingDate, null); assert.equal(converted.billingAnchorDay, null);
      assert.ok(Math.abs(Date.parse(converted.quotationValidUntil) - Date.now() - 10 * 86400000) < 5000);
      await request(`/subscriptions/${draft.id}/transition`, 'POST', { action: 'QUOTATION' }, 409);
      for (const input of [{ action: 'ACTIVE' }, { action: 'CONFIRMED' }, { action: 'QUOTATION', validDays: 0 }, { action: 'QUOTATION', status: 'ACTIVE' }]) await request(`/subscriptions/${draft.id}/transition`, 'POST', input, 400);
      await request('/subscriptions/missing/transition', 'POST', { action: 'QUOTATION' }, 404);
    });
    await t.test('failed template replacement and quotation insertion roll back atomically', async () => {
      const old = await request(`/subscriptions/templates/${template.id}`);
      await db.$executeRawUnsafe("CREATE TRIGGER reject_template_lines BEFORE INSERT ON QuotationTemplateLine BEGIN SELECT RAISE(ABORT, 'test template failure'); END");
      expectedDatabaseFailure = true;
      try { await request(`/subscriptions/templates/${template.id}`, 'PATCH', { name: 'Should roll back', lines }, 500); }
      finally { await db.$executeRawUnsafe('DROP TRIGGER reject_template_lines'); expectedDatabaseFailure = false; }
      assert.deepEqual(await request(`/subscriptions/templates/${template.id}`), old);
      const before = await db.subscription.count(); const beforeLines = await db.subscriptionLine.count();
      await db.$executeRawUnsafe("CREATE TRIGGER reject_quotation_lines BEFORE INSERT ON SubscriptionLine BEGIN SELECT RAISE(ABORT, 'test quotation failure'); END");
      expectedDatabaseFailure = true;
      try { await request('/subscriptions', 'POST', quotationInput, 500); }
      finally { await db.$executeRawUnsafe('DROP TRIGGER reject_quotation_lines'); expectedDatabaseFailure = false; }
      assert.equal(await db.subscription.count(), before); assert.equal(await db.subscriptionLine.count(), beforeLines);
    });
    await t.test('deleting a template preserves issued quotation records', async () => {
      await request(`/subscriptions/templates/${template.id}`, 'DELETE');
      await request(`/subscriptions/templates/${template.id}`, 'GET', undefined, 404);
      await request(`/subscriptions/templates/${template.id}`, 'DELETE', undefined, 404);
      await request('/subscriptions', 'POST', quotationInput, 404);
      assert.deepEqual((await request(`/subscriptions/${quotation.id}`)).lines, quotation.lines);
    });
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await db.$disconnect();
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
    for (const file of readdirSync(directory)) unlinkSync(path.join(directory, file)); rmdirSync(directory);
  }
});
