import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import express from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../server/src/lib/http.js';
import type { ErrorRequestHandler } from 'express';

test('catalog step 1: database-backed product management in isolation', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'brightloop-catalog-test-'));
  const dbPath = path.join(directory, 'test.db');
  process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
  writeFileSync(dbPath, '');
  process.env.NODE_ENV = 'test';

  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
  });

  const { catalogRouter } = await import('../server/src/modules/catalog/router.js');
  const { db } = await import('../server/src/lib/db.js');

  const isolatedApp = express();
  isolatedApp.use(express.json());

  // Test auth simulation middleware for isolated router testing
  isolatedApp.use((req, _res, next) => {
    const role = req.headers['x-user-role'] as string | undefined;
    if (role) {
      (req as any).user = {
        id: 'test-user-id',
        name: 'Test User',
        email: `${role.toLowerCase()}@brightloop.local`,
        role,
        customerId: role === 'CUSTOMER' ? 'cust-test' : null,
      };
    }
    next();
  });

  isolatedApp.use('/api/catalog', catalogRouter);

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) {
      return void res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.issues },
      });
    }
    if (error instanceof HttpError) {
      return void res.status(error.status).json({
        error: { code: error.code, message: error.message },
      });
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  };
  isolatedApp.use(errorHandler);

  const server = isolatedApp.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/catalog`;

  try {
    await t.test('unauthenticated requests fail with 401', async () => {
      const response = await fetch(`${base}/products`);
      assert.equal(response.status, 401);
      const body = await response.json();
      assert.equal(body.error.code, 'UNAUTHORIZED');
    });

    await t.test('customer role cannot read or mutate catalog (fails with 403)', async () => {
      const getRes = await fetch(`${base}/products`, {
        headers: { 'x-user-role': 'CUSTOMER' },
      });
      assert.equal(getRes.status, 403);
      assert.equal((await getRes.json()).error.code, 'FORBIDDEN');

      const postRes = await fetch(`${base}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'CUSTOMER' },
        body: JSON.stringify({ name: 'Hack', salesPriceMinor: 100 }),
      });
      assert.equal(postRes.status, 403);
      assert.equal((await postRes.json()).error.code, 'FORBIDDEN');
    });

    await t.test('staff role can read but cannot mutate catalog (mutations require ADMIN)', async () => {
      const getRes = await fetch(`${base}/products`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(getRes.status, 200);
      const getBody = await getRes.json();
      assert.ok(Array.isArray(getBody.data.items));

      const postRes = await fetch(`${base}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'STAFF' },
        body: JSON.stringify({ name: 'Staff Product', salesPriceMinor: 1000 }),
      });
      assert.equal(postRes.status, 403);
      assert.equal((await postRes.json()).error.code, 'FORBIDDEN');
    });

    await t.test('validation rejects invalid names, non-integers, and negative money', async () => {
      // Empty name
      const emptyNameRes = await fetch(`${base}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ name: '  ', salesPriceMinor: 1000 }),
      });
      assert.equal(emptyNameRes.status, 400);
      assert.equal((await emptyNameRes.json()).error.code, 'VALIDATION_ERROR');

      // Negative salesPriceMinor
      const negSalesRes = await fetch(`${base}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ name: 'Cloud Storage', salesPriceMinor: -500 }),
      });
      assert.equal(negSalesRes.status, 400);
      assert.equal((await negSalesRes.json()).error.code, 'VALIDATION_ERROR');

      // Float salesPriceMinor
      const floatSalesRes = await fetch(`${base}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ name: 'Cloud Storage', salesPriceMinor: 19.99 }),
      });
      assert.equal(floatSalesRes.status, 400);
      assert.equal((await floatSalesRes.json()).error.code, 'VALIDATION_ERROR');

      // Negative costPriceMinor
      const negCostRes = await fetch(`${base}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ name: 'Cloud Storage', salesPriceMinor: 5000, costPriceMinor: -100 }),
      });
      assert.equal(negCostRes.status, 400);
      assert.equal((await negCostRes.json()).error.code, 'VALIDATION_ERROR');
    });

    let createdId: string;

    await t.test('admin creates product with nonnegative integer money and notes', async () => {
      const res = await fetch(`${base}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Pro Subscription Suite',
          type: 'SOFTWARE',
          salesPriceMinor: 499900,
          costPriceMinor: 150000,
          notes: 'Flagship enterprise tier offering',
        }),
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.ok(body.data);
      assert.equal(body.data.name, 'Pro Subscription Suite');
      assert.equal(body.data.type, 'SOFTWARE');
      assert.equal(body.data.salesPriceMinor, 499900);
      assert.equal(body.data.costPriceMinor, 150000);
      assert.equal(body.data.notes, 'Flagship enterprise tier offering');
      assert.equal(body.data.isActive, true);
      assert.ok(body.data.id);
      createdId = body.data.id;
    });

    await t.test('get product by id returns full details or 404', async () => {
      const res = await fetch(`${base}/products/${createdId}`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.id, createdId);
      assert.equal(body.data.name, 'Pro Subscription Suite');

      const notFoundRes = await fetch(`${base}/products/non-existent-id`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(notFoundRes.status, 404);
      assert.equal((await notFoundRes.json()).error.code, 'NOT_FOUND');
    });

    await t.test('admin edits product fields via PATCH', async () => {
      const patchRes = await fetch(`${base}/products/${createdId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Pro Subscription Suite v2',
          salesPriceMinor: 549900,
          notes: 'Updated description for v2',
          isActive: false,
        }),
      });
      assert.equal(patchRes.status, 200);
      const body = await patchRes.json();
      assert.equal(body.data.name, 'Pro Subscription Suite v2');
      assert.equal(body.data.salesPriceMinor, 549900);
      assert.equal(body.data.costPriceMinor, 150000); // unchanged
      assert.equal(body.data.notes, 'Updated description for v2');
      assert.equal(body.data.isActive, false);

      // Invalid PATCH with negative price
      const invalidPatch = await fetch(`${base}/products/${createdId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ salesPriceMinor: -10 }),
      });
      assert.equal(invalidPatch.status, 400);
      assert.equal((await invalidPatch.json()).error.code, 'VALIDATION_ERROR');
    });

    await t.test('pagination and search filtering work with standard envelopes', async () => {
      // Add 2 more products
      await fetch(`${base}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ name: 'Consulting Onboarding', type: 'SERVICE', salesPriceMinor: 200000 }),
      });
      await fetch(`${base}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ name: 'Dedicated Server Hardware', type: 'HARDWARE', salesPriceMinor: 800000 }),
      });

      // Page 1 with pageSize 2 (total = 3)
      const page1Res = await fetch(`${base}/products?page=1&pageSize=2`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(page1Res.status, 200);
      const page1Body = await page1Res.json();
      assert.equal(page1Body.data.items.length, 2);
      assert.equal(page1Body.data.page, 1);
      assert.equal(page1Body.data.pageSize, 2);
      assert.equal(page1Body.data.total, 3);

      // Page 2
      const page2Res = await fetch(`${base}/products?page=2&pageSize=2`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(page2Res.status, 200);
      const page2Body = await page2Res.json();
      assert.equal(page2Body.data.items.length, 1);
      assert.equal(page2Body.data.page, 2);
      assert.equal(page2Body.data.pageSize, 2);
      assert.equal(page2Body.data.total, 3);

      // Search filter
      const searchRes = await fetch(`${base}/products?search=Consulting`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(searchRes.status, 200);
      const searchBody = await searchRes.json();
      assert.equal(searchBody.data.total, 1);
      assert.equal(searchBody.data.items[0].name, 'Consulting Onboarding');

      // Type filter
      const typeRes = await fetch(`${base}/products?type=HARDWARE`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(typeRes.status, 200);
      const typeBody = await typeRes.json();
      assert.equal(typeBody.data.total, 1);
      assert.equal(typeBody.data.items[0].type, 'HARDWARE');
    });

    await t.test('future endpoints (variants, plans, taxes, discounts) return 501', async () => {
      const endpoints = [
        `/products/${createdId}/variants`,
        '/plans',
        '/taxes',
        '/discounts',
      ];
      for (const ep of endpoints) {
        const res = await fetch(`${base}${ep}`, {
          headers: { 'x-user-role': 'ADMIN' },
        });
        assert.equal(res.status, 501, `Expected 501 for ${ep}`);
        const body = await res.json();
        assert.equal(body.error.code, 'NOT_IMPLEMENTED');
      }
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.$disconnect();
    for (const filename of readdirSync(directory)) unlinkSync(path.join(directory, filename));
    rmdirSync(directory);
  }
});

