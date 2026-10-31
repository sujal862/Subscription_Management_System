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

test('customer and subscription draft API with isolated SQLite', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'brightloop-subscriptions-'));
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replaceAll('\\', '/')}`;
  process.env.NODE_ENV = 'test';
  writeFileSync(path.join(directory, 'test.db'), '');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const { db } = await import('../server/src/lib/db.js');
  const { createSubscriptionHandlers, subscriptionsRouter } = await import('../server/src/modules/subscriptions/router.js');
  const app = express();
  app.use(express.json());
  app.use('/guarded', subscriptionsRouter);
  app.use('/subscriptions', createSubscriptionHandlers());
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) return void res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } });
    if (error instanceof HttpError) return void res.status(error.status).json({ error: { code: error.code, message: error.message } });
    console.error(error); res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
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
    await t.test('production role gate remains fail closed', async () => { await request('/guarded/customers', 'GET', undefined, 401); });
    let customer: any, second: any;
    await t.test('create, normalize, validate and deduplicate customers', async () => {
      customer = await request('/subscriptions/customers', 'POST', { name: '  Acme  ', email: ' CONTACT@ACME.COM ', company: ' Acme Inc ' }, 201);
      assert.equal(customer.email, 'contact@acme.com'); assert.equal(customer.name, 'Acme'); assert.equal(customer.company, 'Acme Inc');
      assert.equal(customer._count.subscriptions, 0);
      for (const body of [{ name: 'Bad', email: 'bad' }, { email: 'ok@example.com' }, { name: ' ', email: 'ok@example.com' }, { name: 'Ok', email: 'ok@example.com', userId: 'injected' }]) await request('/subscriptions/customers', 'POST', body, 400);
      await request('/subscriptions/customers', 'POST', { name: 'Duplicate', email: 'Contact@Acme.com' }, 409);
      second = await request('/subscriptions/customers', 'POST', { name: 'Beta', email: 'beta@example.com' }, 201);
      await db.customer.create({ data: { name: 'Legacy', email: 'LEGACY@example.com' } });
      await request('/subscriptions/customers', 'POST', { name: 'Legacy duplicate', email: 'legacy@example.com' }, 409);
    });
    await t.test('customer detail, edit, unique conflicts, linked identity and paging', async () => {
      assert.equal((await request(`/subscriptions/customers/${customer.id}`)).id, customer.id);
      await request('/subscriptions/customers/missing', 'GET', undefined, 404);
      await request('/subscriptions/customers/missing', 'PATCH', { name: 'Missing' }, 404);
      const user = await db.user.create({ data: { name: 'Linked', email: 'linked@example.com', passwordHash: 'test-only', customerId: customer.id } });
      const changed = await request(`/subscriptions/customers/${customer.id}`, 'PATCH', { name: 'Acme updated', phone: '123', email: 'new@acme.com' });
      assert.equal(changed.phone, '123'); assert.equal(changed.company, 'Acme Inc');
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).customerId, customer.id);
      await request(`/subscriptions/customers/${customer.id}`, 'PATCH', { email: 'BETA@example.com' }, 409);
      await request(`/subscriptions/customers/${customer.id}`, 'PATCH', { id: 'changed' }, 400);
      await request(`/subscriptions/customers/${customer.id}`, 'PATCH', {}, 400);
      const found = await request('/subscriptions/customers?search=acme&pageSize=1'); assert.equal(found.total, 1); assert.equal(found.items.length, 1);
      const page = await request('/subscriptions/customers?page=2&pageSize=1'); assert.equal(page.items.length, 1); assert.equal(page.total, 3);
      await request('/subscriptions/customers?pageSize=101', 'GET', undefined, 400);
    });
    const product = await db.product.create({ data: { name: 'Workspace', salesPriceMinor: 20000 } });
    const addon = await db.product.create({ data: { name: 'Storage', salesPriceMinor: 1001 } });
    const variant = await db.productVariant.create({ data: { productId: product.id, name: 'Pro', priceAdjustmentMinor: 500 } });
    const addonVariant = await db.productVariant.create({ data: { productId: addon.id, name: 'Extra', priceAdjustmentMinor: 50 } });
    const plan = await db.plan.create({ data: { name: 'Monthly', productId: product.id, priceMinor: 10000, interval: 'MONTHLY', minimumQuantity: 2, availableFrom: new Date('2026-01-01Z'), availableUntil: new Date('2027-01-01Z') } });
    const tax = await db.taxRule.create({ data: { name: 'GST', rateBps: 1800 } });
    const payload = { customerId: customer.id, planId: plan.id, startDate: '2026-11-01', expiryDate: '2027-11-01', paymentTermDays: 7, lines: [{ productId: product.id, variantId: variant.id, quantity: 2, unitPriceMinor: 10500, taxRuleId: tax.id }, { productId: addon.id, quantity: 3, unitPriceMinor: 1001, taxRuleId: tax.id }] };
    let draft: any;
    await t.test('draft creation, totals, snapshot and frozen billing fields', async () => {
      draft = await request('/subscriptions', 'POST', payload, 201);
      assert.equal(draft.status, 'DRAFT'); assert.match(draft.number, /^SUB-\d{4}-[A-F0-9]{16}$/);
      assert.equal(draft.billingInterval, 'MONTHLY'); assert.equal(draft.nextBillingDate, null); assert.equal(draft.billingAnchorDay, null);
      assert.equal(draft.startDate, '2026-11-01T00:00:00.000Z');
      assert.equal(draft.subtotalMinor, 24003); assert.equal(draft.taxMinor, 4321); assert.equal(draft.totalMinor, 28324);
      const primary = draft.lines.find((line: any) => line.productId === product.id);
      assert.equal(primary.description, 'Workspace — Pro'); assert.equal(primary.taxRateBps, 1800);
      const other = await request('/subscriptions', 'POST', { ...payload, expiryDate: null }, 201); assert.notEqual(other.number, draft.number);
      const defaultPrice = await request('/subscriptions', 'POST', { ...payload, lines: [{ productId: product.id, quantity: 2 }] }, 201);
      assert.equal(defaultPrice.lines[0].unitPriceMinor, 10000);
    });
    await t.test('reject invalid inputs and references without partial writes', async () => {
      const count = await db.subscription.count(); const lineCount = await db.subscriptionLine.count();
      for (const [change, status] of [
        [{ customerId: 'missing' }, 404], [{ planId: 'missing' }, 404], [{ expiryDate: '2026-10-01' }, 400], [{ expiryDate: '2026-11-01' }, 400], [{ startDate: '2026-02-30' }, 400], [{ startDate: '2026-11-01T01:00:00Z' }, 400], [{ startDate: '2025-11-01' }, 400], [{ startDate: '2027-02-01' }, 400], [{ paymentTermDays: -1 }, 400], [{ paymentTermDays: 366 }, 400], [{ status: 'ACTIVE' }, 400], [{ lines: [] }, 400],
      ] as const) await request('/subscriptions', 'POST', { ...payload, ...change }, status);
      for (const change of [{ quantity: 0 }, { quantity: 1 }, { quantity: 1.5 }, { unitPriceMinor: -1 }, { unitPriceMinor: 9 }, { productId: addon.id }, { productId: 'missing' }, { variantId: addonVariant.id }, { variantId: 'missing' }, { taxRuleId: 'missing' }, { taxRateBps: 0 }, { quantity: 1000000 }]) {
        await request('/subscriptions', 'POST', { ...payload, lines: [{ ...payload.lines[0], ...change }] }, 400);
      }
      await request('/subscriptions', 'POST', { ...payload, lines: [payload.lines[0], { productId: 'missing', quantity: 1 }] }, 400);
      assert.equal(await db.subscription.count(), count); assert.equal(await db.subscriptionLine.count(), lineCount);
    });
    await t.test('reject archived catalog records', async () => {
      for (const [model, id] of [['plan', plan.id], ['product', product.id], ['productVariant', variant.id], ['taxRule', tax.id]] as const) {
        // Each delegate accepts the same isActive update shape, with distinct generated types.
        if (model === 'plan') await db.plan.update({ where: { id }, data: { isActive: false } });
        if (model === 'product') await db.product.update({ where: { id }, data: { isActive: false } });
        if (model === 'productVariant') await db.productVariant.update({ where: { id }, data: { isActive: false } });
        if (model === 'taxRule') await db.taxRule.update({ where: { id }, data: { isActive: false } });
        await request('/subscriptions', 'POST', payload, 400);
        if (model === 'plan') await db.plan.update({ where: { id }, data: { isActive: true } });
        if (model === 'product') await db.product.update({ where: { id }, data: { isActive: true } });
        if (model === 'productVariant') await db.productVariant.update({ where: { id }, data: { isActive: true } });
        if (model === 'taxRule') await db.taxRule.update({ where: { id }, data: { isActive: true } });
      }
    });
    await t.test('a database failure inserting lines rolls back the parent draft', async () => {
      const before = await db.subscription.count();
      const beforeLines = await db.subscriptionLine.count();
      await db.$executeRawUnsafe("CREATE TRIGGER reject_test_lines BEFORE INSERT ON SubscriptionLine BEGIN SELECT RAISE(ABORT, 'test line write failure'); END");
      const originalError = console.error;
      const reported: unknown[] = [];
      console.error = error => { reported.push(error); };
      try {
        await request('/subscriptions', 'POST', payload, 500);
        assert.equal(reported.length, 1);
        assert.equal(await db.subscription.count(), before);
        assert.equal(await db.subscriptionLine.count(), beforeLines);
      } finally {
        console.error = originalError;
        await db.$executeRawUnsafe('DROP TRIGGER reject_test_lines');
      }
    });
    await t.test('detail and pagination use saved data; catalog changes preserve snapshots', async () => {
      await db.product.update({ where: { id: product.id }, data: { name: 'Renamed', salesPriceMinor: 1 } });
      await db.plan.update({ where: { id: plan.id }, data: { interval: 'YEARLY', priceMinor: 1 } });
      await db.taxRule.update({ where: { id: tax.id }, data: { rateBps: 1000 } });
      const saved = await request(`/subscriptions/${draft.id}`); assert.equal(saved.totalMinor, draft.totalMinor); assert.equal(saved.billingInterval, 'MONTHLY'); assert.equal(saved.lines.find((line: any) => line.productId === product.id).description, 'Workspace — Pro');
      await request('/subscriptions/missing', 'GET', undefined, 404);
      const list = await request('/subscriptions?status=DRAFT&pageSize=1&page=2'); assert.equal(list.total, 3); assert.equal(list.items.length, 1);
      assert.equal((await request(`/subscriptions?search=${draft.number}`)).total, 1);
      assert.equal((await request(`/subscriptions?customerId=${second.id}`)).total, 0);
      assert.equal((await request('/subscriptions?status=ACTIVE')).total, 0);
      await request('/subscriptions?status=INVALID', 'GET', undefined, 400);
      assert.equal((await request(`/subscriptions/customers/${customer.id}`))._count.subscriptions, 3);
    });
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.$disconnect();
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
    for (const file of readdirSync(directory)) unlinkSync(path.join(directory, file)); rmdirSync(directory);
  }
});
