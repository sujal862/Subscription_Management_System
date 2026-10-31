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

test('catalog step 1 & 2: products, variants, recurring plans, and primary-line pricing in isolation', async t => {
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
    // -------------------------------------------------------------------------
    // Step 1: Products Baseline
    // -------------------------------------------------------------------------

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

    let mainProductId: string;

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
      assert.equal(body.data.salesPriceMinor, 499900);
      assert.ok(Array.isArray(body.data.variants));
      mainProductId = body.data.id;
    });

    // -------------------------------------------------------------------------
    // Step 2: Product Variants
    // -------------------------------------------------------------------------

    let variant1Id: string;
    let variant2Id: string;

    await t.test('variant mutations require ADMIN, staff can read', async () => {
      const staffPost = await fetch(`${base}/products/${mainProductId}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'STAFF' },
        body: JSON.stringify({ name: '10 Users', priceAdjustmentMinor: 50000 }),
      });
      assert.equal(staffPost.status, 403);

      const staffGet = await fetch(`${base}/products/${mainProductId}/variants`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(staffGet.status, 200);
      const staffBody = await staffGet.json();
      assert.ok(Array.isArray(staffBody.data));
    });

    await t.test('admin creates variants with price adjustments', async () => {
      // Positive adjustment
      const res1 = await fetch(`${base}/products/${mainProductId}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ name: 'Enterprise Addon', priceAdjustmentMinor: 100000 }),
      });
      assert.equal(res1.status, 201);
      const body1 = await res1.json();
      assert.equal(body1.data.name, 'Enterprise Addon');
      assert.equal(body1.data.priceAdjustmentMinor, 100000);
      assert.equal(body1.data.productId, mainProductId);
      variant1Id = body1.data.id;

      // Negative adjustment (discount variant)
      const res2 = await fetch(`${base}/products/${mainProductId}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ name: 'Starter Tier Discount', priceAdjustmentMinor: -50000 }),
      });
      assert.equal(res2.status, 201);
      const body2 = await res2.json();
      assert.equal(body2.data.priceAdjustmentMinor, -50000);
      variant2Id = body2.data.id;
    });

    await t.test('variant name uniqueness is enforced per product', async () => {
      const dupRes = await fetch(`${base}/products/${mainProductId}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ name: 'Enterprise Addon', priceAdjustmentMinor: 20000 }),
      });
      assert.equal(dupRes.status, 409);
      const body = await dupRes.json();
      assert.equal(body.error.code, 'CONFLICT');
    });

    await t.test('admin can update variant and prevent cross-product mismatch', async () => {
      const patchRes = await fetch(`${base}/products/${mainProductId}/variants/${variant1Id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ priceAdjustmentMinor: 120000, isActive: true }),
      });
      assert.equal(patchRes.status, 200);
      const body = await patchRes.json();
      assert.equal(body.data.priceAdjustmentMinor, 120000);

      // Unrelated product ID returns 404
      const mismatchRes = await fetch(`${base}/products/other-product-id/variants/${variant1Id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ priceAdjustmentMinor: 100 }),
      });
      assert.equal(mismatchRes.status, 404);
    });

    await t.test('products list and details include variants', async () => {
      const detailRes = await fetch(`${base}/products/${mainProductId}`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(detailRes.status, 200);
      const detail = await detailRes.json();
      assert.equal(detail.data.variants.length, 2);

      const listRes = await fetch(`${base}/products`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(listRes.status, 200);
      const list = await listRes.json();
      const productWithVariants = list.data.items.find((p: any) => p.id === mainProductId);
      assert.ok(productWithVariants);
      assert.equal(productWithVariants.variants.length, 2);
    });

    // -------------------------------------------------------------------------
    // Step 2: Recurring Plans
    // -------------------------------------------------------------------------

    let monthlyPlanId: string;
    let yearlyPlanId: string;

    await t.test('plan validation rejects invalid dates, quantities, intervals, and product references', async () => {
      // Non-existent product reference
      const badProdRes = await fetch(`${base}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Invalid Product Plan',
          productId: 'non-existent-prod',
          priceMinor: 50000,
          interval: 'MONTHLY',
        }),
      });
      assert.equal(badProdRes.status, 400);

      // Invalid interval
      const badIntervalRes = await fetch(`${base}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Bad Interval',
          productId: mainProductId,
          priceMinor: 50000,
          interval: 'BIWEEKLY',
        }),
      });
      assert.equal(badIntervalRes.status, 400);

      // Negative minimumQuantity
      const badQtyRes = await fetch(`${base}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Bad Qty',
          productId: mainProductId,
          priceMinor: 50000,
          interval: 'MONTHLY',
          minimumQuantity: 0,
        }),
      });
      assert.equal(badQtyRes.status, 400);

      // Inverted date order (availableUntil < availableFrom)
      const badDateRes = await fetch(`${base}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Inverted Dates',
          productId: mainProductId,
          priceMinor: 50000,
          interval: 'MONTHLY',
          availableFrom: '2026-12-01',
          availableUntil: '2026-11-01',
        }),
      });
      assert.equal(badDateRes.status, 400);
      const badDateBody = await badDateRes.json();
      assert.equal(badDateBody.error.code, 'VALIDATION_ERROR');
    });

    await t.test('admin creates plans for daily, weekly, monthly, and yearly intervals', async () => {
      // Monthly plan
      const resMonthly = await fetch(`${base}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Pro Monthly Business Plan',
          productId: mainProductId,
          priceMinor: 299900,
          interval: 'MONTHLY',
          minimumQuantity: 5,
          availableFrom: '2026-01-01',
          availableUntil: '2026-12-31',
          autoClose: true,
          allowEarlyClose: true,
          allowPause: false,
          allowRenew: true,
          isActive: true,
        }),
      });
      assert.equal(resMonthly.status, 201);
      const monthly = await resMonthly.json();
      assert.equal(monthly.data.name, 'Pro Monthly Business Plan');
      assert.equal(monthly.data.interval, 'MONTHLY');
      assert.equal(monthly.data.priceMinor, 299900);
      assert.equal(monthly.data.minimumQuantity, 5);
      assert.ok(monthly.data.product);
      monthlyPlanId = monthly.data.id;

      // Yearly plan
      const resYearly = await fetch(`${base}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Pro Annual Enterprise Plan',
          productId: mainProductId,
          priceMinor: 2999900,
          interval: 'YEARLY',
          minimumQuantity: 1,
          autoClose: false,
        }),
      });
      assert.equal(resYearly.status, 201);
      yearlyPlanId = (await resYearly.json()).data.id;

      // Daily plan
      const resDaily = await fetch(`${base}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Pro Daily Trial Plan',
          productId: mainProductId,
          priceMinor: 15000,
          interval: 'DAILY',
          minimumQuantity: 1,
        }),
      });
      assert.equal(resDaily.status, 201);

      // Weekly plan
      const resWeekly = await fetch(`${base}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Pro Weekly Sprint Plan',
          productId: mainProductId,
          priceMinor: 75000,
          interval: 'WEEKLY',
          minimumQuantity: 1,
        }),
      });
      assert.equal(resWeekly.status, 201);
    });

    await t.test('get plan by id and list plans with pagination and filters', async () => {
      // Get by id
      const getPlan = await fetch(`${base}/plans/${monthlyPlanId}`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(getPlan.status, 200);
      const planBody = await getPlan.json();
      assert.equal(planBody.data.id, monthlyPlanId);
      assert.equal(planBody.data.minimumQuantity, 5);

      // List plans (Member 3 selector contract: returns { items, total, page, pageSize })
      const listPlans = await fetch(`${base}/plans?page=1&pageSize=2`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(listPlans.status, 200);
      const listBody = await listPlans.json();
      assert.equal(listBody.data.items.length, 2);
      assert.equal(listBody.data.total, 4);
      assert.ok(listBody.data.items[0].product);

      // Filter by interval
      const filterInterval = await fetch(`${base}/plans?interval=YEARLY`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(filterInterval.status, 200);
      const yearlyBody = await filterInterval.json();
      assert.equal(yearlyBody.data.total, 1);
      assert.equal(yearlyBody.data.items[0].id, yearlyPlanId);
    });

    await t.test('admin can update plan details and preserve date validity', async () => {
      const patchRes = await fetch(`${base}/plans/${monthlyPlanId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Pro Monthly Business Plan v2',
          priceMinor: 319900,
          minimumQuantity: 10,
        }),
      });
      assert.equal(patchRes.status, 200);
      const patched = await patchRes.json();
      assert.equal(patched.data.name, 'Pro Monthly Business Plan v2');
      assert.equal(patched.data.priceMinor, 319900);
      assert.equal(patched.data.minimumQuantity, 10);
    });

    // -------------------------------------------------------------------------
    // Step 2: Primary-Line Pricing Rule & Multi-line Calculation
    // -------------------------------------------------------------------------

    let addonProductId: string;

    await t.test('create addon product for testing primary-line pricing rule', async () => {
      const res = await fetch(`${base}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Additional Seat License',
          type: 'SERVICE',
          salesPriceMinor: 99900,
          costPriceMinor: 20000,
        }),
      });
      assert.equal(res.status, 201);
      addonProductId = (await res.json()).data.id;
    });

    await t.test('primary-line pricing calculates plan fee on line 1, product fee on add-ons, and adds variant adjustments', async () => {
      // Monthly Plan price: 319900, minimumQuantity: 10
      // Line 1: mainProduct with variant1 (Enterprise Addon: +120000), qty: 10
      //   -> unit price = 319900 + 120000 = 439900. subtotal = 439900 * 10 = 4399000
      // Line 2: addonProduct, qty: 2 (no variant)
      //   -> unit price = 99900 (Product.salesPriceMinor, NOT Plan.priceMinor!). subtotal = 99900 * 2 = 199800
      // Total subtotal = 4399000 + 199800 = 4598800

      const calcRes = await fetch(`${base}/pricing/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'STAFF' },
        body: JSON.stringify({
          planId: monthlyPlanId,
          lines: [
            { productId: mainProductId, variantId: variant1Id, quantity: 10 },
            { productId: addonProductId, variantId: null, quantity: 2 },
          ],
        }),
      });
      assert.equal(calcRes.status, 200);
      const calcBody = await calcRes.json();
      assert.equal(calcBody.data.lines[0].isPrimary, true);
      assert.equal(calcBody.data.lines[0].unitPriceMinor, 439900);
      assert.equal(calcBody.data.lines[0].subtotalMinor, 4399000);

      assert.equal(calcBody.data.lines[1].isPrimary, false);
      assert.equal(calcBody.data.lines[1].unitPriceMinor, 99900);
      assert.equal(calcBody.data.lines[1].subtotalMinor, 199800);

      assert.equal(calcBody.data.subtotalMinor, 4598800);
    });

    await t.test('pricing calculation rejects unrelated variant or primary mismatch', async () => {
      // Primary line mismatch (product does not match plan.productId)
      const mismatchProd = await fetch(`${base}/pricing/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'STAFF' },
        body: JSON.stringify({
          planId: monthlyPlanId,
          lines: [{ productId: addonProductId, quantity: 1 }],
        }),
      });
      assert.equal(mismatchProd.status, 400);

      // Primary line quantity below minimumQuantity (10)
      const belowMinQty = await fetch(`${base}/pricing/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'STAFF' },
        body: JSON.stringify({
          planId: monthlyPlanId,
          lines: [{ productId: mainProductId, quantity: 2 }],
        }),
      });
      assert.equal(belowMinQty.status, 400);

      // Unrelated variant on addon product
      const unrelatedVariant = await fetch(`${base}/pricing/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'STAFF' },
        body: JSON.stringify({
          planId: monthlyPlanId,
          lines: [
            { productId: mainProductId, quantity: 10 },
            { productId: addonProductId, variantId: variant1Id, quantity: 1 },
          ],
        }),
      });
      assert.equal(unrelatedVariant.status, 400);
    });

    // -------------------------------------------------------------------------
    // Remaining future endpoints check
    // -------------------------------------------------------------------------

    await t.test('future endpoints (taxes, discounts) still return 501', async () => {
      const endpoints = ['/taxes', '/discounts'];
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
