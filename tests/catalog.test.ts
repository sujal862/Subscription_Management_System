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

test('catalog step 1 to 6: products, variants, plans, taxes, discounts, and e2e flow verification in isolation', async t => {
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
    // Step 3: Plan Lifecycle Controls, Availability Filter, & Archiving
    // -------------------------------------------------------------------------

    let lifecyclePlanId = '';
    await t.test('create plan persists default lifecycle flags (autoClose=true, allowEarlyClose=true, allowPause=false, allowRenew=true)', async () => {
      const res = await fetch(`${base}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Default Lifecycle Plan',
          productId: mainProductId,
          priceMinor: 199900,
          interval: 'MONTHLY',
          minimumQuantity: 1,
        }),
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      lifecyclePlanId = body.data.id;
      assert.equal(body.data.autoClose, true);
      assert.equal(body.data.allowEarlyClose, true);
      assert.equal(body.data.allowPause, false);
      assert.equal(body.data.allowRenew, true);
      assert.equal(body.data.isActive, true);
    });

    await t.test('patch plan updates lifecycle controls and availability dates', async () => {
      const res = await fetch(`${base}/plans/${lifecyclePlanId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          autoClose: false,
          allowEarlyClose: false,
          allowPause: true,
          allowRenew: false,
          availableFrom: '2026-06-01',
          availableUntil: '2026-12-31',
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.autoClose, false);
      assert.equal(body.data.allowEarlyClose, false);
      assert.equal(body.data.allowPause, true);
      assert.equal(body.data.allowRenew, false);
      assert.equal(body.data.availableFrom.slice(0, 10), '2026-06-01');
      assert.equal(body.data.availableUntil.slice(0, 10), '2026-12-31');
    });

    await t.test('GET /plans filters by availableAt selector date', async () => {
      // 2026-07-15 is inside [2026-06-01, 2026-12-31]
      const insideRes = await fetch(`${base}/plans?availableAt=2026-07-15`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(insideRes.status, 200);
      const insideBody = await insideRes.json();
      const foundInside = insideBody.data.items.some((p: any) => p.id === lifecyclePlanId);
      assert.equal(foundInside, true);

      // 2026-05-15 is before availableFrom
      const beforeRes = await fetch(`${base}/plans?availableAt=2026-05-15`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(beforeRes.status, 200);
      const beforeBody = await beforeRes.json();
      const foundBefore = beforeBody.data.items.some((p: any) => p.id === lifecyclePlanId);
      assert.equal(foundBefore, false);

      // 2027-01-01 is after availableUntil
      const afterRes = await fetch(`${base}/plans?availableAt=2027-01-01`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(afterRes.status, 200);
      const afterBody = await afterRes.json();
      const foundAfter = afterBody.data.items.some((p: any) => p.id === lifecyclePlanId);
      assert.equal(foundAfter, false);
    });

    await t.test('plan archiving via POST /archive and /unarchive preserves financial history', async () => {
      // Archive plan
      const archiveRes = await fetch(`${base}/plans/${lifecyclePlanId}/archive`, {
        method: 'POST',
        headers: { 'x-user-role': 'ADMIN' },
      });
      assert.equal(archiveRes.status, 200);
      const archiveBody = await archiveRes.json();
      assert.equal(archiveBody.data.isActive, false);

      // Inactive plans excluded when isActive=true filter applied
      const activeListRes = await fetch(`${base}/plans?isActive=true`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(activeListRes.status, 200);
      const activeListBody = await activeListRes.json();
      assert.equal(activeListBody.data.items.some((p: any) => p.id === lifecyclePlanId), false);

      // Unarchive plan
      const unarchiveRes = await fetch(`${base}/plans/${lifecyclePlanId}/unarchive`, {
        method: 'POST',
        headers: { 'x-user-role': 'ADMIN' },
      });
      assert.equal(unarchiveRes.status, 200);
      const unarchiveBody = await unarchiveRes.json();
      assert.equal(unarchiveBody.data.isActive, true);

      // DELETE /plans/:id archives rather than hard deleting
      const deleteRes = await fetch(`${base}/plans/${lifecyclePlanId}`, {
        method: 'DELETE',
        headers: { 'x-user-role': 'ADMIN' },
      });
      assert.equal(deleteRes.status, 200);
      const deleteBody = await deleteRes.json();
      assert.equal(deleteBody.data.isActive, false);
      assert.equal(deleteBody.data.archived, true);
    });

    await t.test('product archiving via POST /archive and /unarchive', async () => {
      const archiveProdRes = await fetch(`${base}/products/${addonProductId}/archive`, {
        method: 'POST',
        headers: { 'x-user-role': 'ADMIN' },
      });
      assert.equal(archiveProdRes.status, 200);
      const archiveProdBody = await archiveProdRes.json();
      assert.equal(archiveProdBody.data.isActive, false);

      // DELETE /products/:id archives to protect references
      const deleteProdRes = await fetch(`${base}/products/${addonProductId}`, {
        method: 'DELETE',
        headers: { 'x-user-role': 'ADMIN' },
      });
      assert.equal(deleteProdRes.status, 200);
      const deleteProdBody = await deleteProdRes.json();
      assert.equal(deleteProdBody.data.isActive, false);
      assert.equal(deleteProdBody.data.archived, true);

      // Restore product
      const unarchiveProdRes = await fetch(`${base}/products/${addonProductId}/unarchive`, {
        method: 'POST',
        headers: { 'x-user-role': 'ADMIN' },
      });
      assert.equal(unarchiveProdRes.status, 200);
      assert.equal((await unarchiveProdRes.json()).data.isActive, true);
    });

    // -------------------------------------------------------------------------
    // Step 4: Tax Rules (Basis Points, Role Validation, Archiving)
    // -------------------------------------------------------------------------

    let gst18Id = '';
    let exemptTaxId = '';

    await t.test('unauthenticated tax access returns 401', async () => {
      const res = await fetch(`${base}/taxes`);
      assert.equal(res.status, 401);
    });

    await t.test('customer role cannot access or mutate tax rules (403 FORBIDDEN)', async () => {
      const getRes = await fetch(`${base}/taxes`, {
        headers: { 'x-user-role': 'CUSTOMER' },
      });
      assert.equal(getRes.status, 403);

      const postRes = await fetch(`${base}/taxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'CUSTOMER' },
        body: JSON.stringify({ name: 'Hacked Tax', rateBps: 1800 }),
      });
      assert.equal(postRes.status, 403);
    });

    await t.test('staff role can read taxes but cannot mutate (mutations require ADMIN)', async () => {
      const getRes = await fetch(`${base}/taxes`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(getRes.status, 200);

      const postRes = await fetch(`${base}/taxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'STAFF' },
        body: JSON.stringify({ name: 'Unauthorized Tax', rateBps: 1800 }),
      });
      assert.equal(postRes.status, 403);
    });

    await t.test('admin creates valid tax rules with integer basis points (0 to 10000)', async () => {
      // 18% GST (1800 bps)
      const gstRes = await fetch(`${base}/taxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'GST 18%',
          rateBps: 1800,
          isActive: true,
        }),
      });
      assert.equal(gstRes.status, 201);
      const gstBody = await gstRes.json();
      gst18Id = gstBody.data.id;
      assert.equal(gstBody.data.name, 'GST 18%');
      assert.equal(gstBody.data.rateBps, 1800);
      assert.equal(gstBody.data.isActive, true);

      // 0% Tax Exempt (0 bps is valid)
      const zeroRes = await fetch(`${base}/taxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Exempt 0%',
          rateBps: 0,
        }),
      });
      assert.equal(zeroRes.status, 201);
      const zeroBody = await zeroRes.json();
      exemptTaxId = zeroBody.data.id;
      assert.equal(zeroBody.data.rateBps, 0);

      // 100% Tax (10000 bps max limit)
      const maxRes = await fetch(`${base}/taxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Maximum 100%',
          rateBps: 10000,
        }),
      });
      assert.equal(maxRes.status, 201);
    });

    await t.test('tax creation rejects negative rates, over 10000 bps, and non-integers', async () => {
      // Negative basis points
      const negRes = await fetch(`${base}/taxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ name: 'Negative', rateBps: -50 }),
      });
      assert.equal(negRes.status, 400);

      // Over 10000 basis points (> 100%)
      const overRes = await fetch(`${base}/taxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ name: 'Too High', rateBps: 10001 }),
      });
      assert.equal(overRes.status, 400);

      // Non-integer basis points (e.g. 18.5)
      const floatRes = await fetch(`${base}/taxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ name: 'Float Rate', rateBps: 18.5 }),
      });
      assert.equal(floatRes.status, 400);

      // Empty name
      const emptyNameRes = await fetch(`${base}/taxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ name: '', rateBps: 500 }),
      });
      assert.equal(emptyNameRes.status, 400);
    });

    await t.test('GET /taxes returns paginated envelope compatible with Member 3 subscription selector', async () => {
      const res = await fetch(`${base}/taxes?page=1&pageSize=10`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.data.items));
      assert.equal(typeof body.data.total, 'number');
      assert.equal(body.data.page, 1);
      assert.equal(body.data.pageSize, 10);
      assert.ok(body.data.items.length >= 2);

      // Test search filter
      const searchRes = await fetch(`${base}/taxes?search=GST`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(searchRes.status, 200);
      const searchBody = await searchRes.json();
      assert.ok(searchBody.data.items.some((t: any) => t.id === gst18Id));
    });

    await t.test('GET /taxes/:id returns single tax rule', async () => {
      const res = await fetch(`${base}/taxes/${gst18Id}`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.id, gst18Id);
      assert.equal(body.data.rateBps, 1800);
    });

    await t.test('PATCH /taxes/:id updates tax rule', async () => {
      const res = await fetch(`${base}/taxes/${gst18Id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'GST 18% (Standard)',
          rateBps: 1800,
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.name, 'GST 18% (Standard)');
    });

    await t.test('tax rule archiving via POST /archive, /unarchive, and DELETE /taxes/:id', async () => {
      // Archive tax rule
      const archiveRes = await fetch(`${base}/taxes/${exemptTaxId}/archive`, {
        method: 'POST',
        headers: { 'x-user-role': 'ADMIN' },
      });
      assert.equal(archiveRes.status, 200);
      assert.equal((await archiveRes.json()).data.isActive, false);

      // Filter active taxes excludes archived rule
      const activeListRes = await fetch(`${base}/taxes?isActive=true`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(activeListRes.status, 200);
      const activeListBody = await activeListRes.json();
      assert.equal(activeListBody.data.items.some((t: any) => t.id === exemptTaxId), false);

      // Restore tax rule
      const unarchiveRes = await fetch(`${base}/taxes/${exemptTaxId}/unarchive`, {
        method: 'POST',
        headers: { 'x-user-role': 'ADMIN' },
      });
      assert.equal(unarchiveRes.status, 200);
      assert.equal((await unarchiveRes.json()).data.isActive, true);

      // DELETE /taxes/:id sets isActive=false without deleting invoice snapshot history
      const deleteRes = await fetch(`${base}/taxes/${exemptTaxId}`, {
        method: 'DELETE',
        headers: { 'x-user-role': 'ADMIN' },
      });
      assert.equal(deleteRes.status, 200);
      const deleteBody = await deleteRes.json();
      assert.equal(deleteBody.data.isActive, false);
      assert.equal(deleteBody.data.archived, true);
    });

    // -------------------------------------------------------------------------
    // Step 5: Discount Rules (CRUD, Validation, Single-Discount Preview & Archive)
    // -------------------------------------------------------------------------

    let subDiscountId = '';
    let prodDiscountId = '';

    await t.test('unauthenticated discount access returns 401', async () => {
      const res = await fetch(`${base}/discounts`);
      assert.equal(res.status, 401);
    });

    await t.test('customer role cannot access or mutate discounts (403 FORBIDDEN)', async () => {
      const getRes = await fetch(`${base}/discounts`, {
        headers: { 'x-user-role': 'CUSTOMER' },
      });
      assert.equal(getRes.status, 403);

      const postRes = await fetch(`${base}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'CUSTOMER' },
        body: JSON.stringify({
          name: 'Customer Discount Hack',
          kind: 'PERCENTAGE',
          scope: 'SUBSCRIPTION',
          value: 5000,
          startsAt: '2026-01-01',
        }),
      });
      assert.equal(postRes.status, 403);
    });

    await t.test('staff role can read discounts but cannot mutate (mutations require ADMIN)', async () => {
      const getRes = await fetch(`${base}/discounts`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(getRes.status, 200);

      const postRes = await fetch(`${base}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'STAFF' },
        body: JSON.stringify({
          name: 'Staff Unauthorized Discount',
          kind: 'FIXED',
          scope: 'SUBSCRIPTION',
          value: 10000,
          startsAt: '2026-01-01',
        }),
      });
      assert.equal(postRes.status, 403);
    });

    await t.test('admin creates subscription-scoped percentage discount (10% = 1000 bps)', async () => {
      const res = await fetch(`${base}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Annual Subscription 10% Off',
          kind: 'PERCENTAGE',
          scope: 'SUBSCRIPTION',
          value: 1000, // 1000 basis points = 10%
          minimumPurchaseMinor: 400000, // ₹4,000.00
          minimumQuantity: 1,
          startsAt: '2026-01-01T00:00:00.000Z',
          endsAt: '2026-12-31T23:59:59.000Z',
          usageLimit: 100,
          isActive: true,
        }),
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      subDiscountId = body.data.id;
      assert.equal(body.data.name, 'Annual Subscription 10% Off');
      assert.equal(body.data.kind, 'PERCENTAGE');
      assert.equal(body.data.scope, 'SUBSCRIPTION');
      assert.equal(body.data.value, 1000);
      assert.equal(body.data.productId, null);
      assert.equal(body.data.minimumPurchaseMinor, 400000);
      assert.equal(body.data.usageLimit, 100);
    });

    await t.test('admin creates product-scoped fixed discount (₹500 = 50000 paise)', async () => {
      const res = await fetch(`${base}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Core Workspace ₹500 Discount',
          kind: 'FIXED',
          scope: 'PRODUCT',
          productId: mainProductId,
          value: 50000, // 50000 paise = ₹500.00
          minimumPurchaseMinor: 0,
          minimumQuantity: 1,
          startsAt: '2026-01-01T00:00:00.000Z',
          isActive: true,
        }),
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      prodDiscountId = body.data.id;
      assert.equal(body.data.name, 'Core Workspace ₹500 Discount');
      assert.equal(body.data.kind, 'FIXED');
      assert.equal(body.data.scope, 'PRODUCT');
      assert.equal(body.data.productId, mainProductId);
      assert.equal(body.data.value, 50000);
    });

    await t.test('discount validation rejects percentage > 10000 bps, negative values, and scope mismatches', async () => {
      // Percentage > 100% (> 10000 bps)
      const overPctRes = await fetch(`${base}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Too generous',
          kind: 'PERCENTAGE',
          scope: 'SUBSCRIPTION',
          value: 10001,
          startsAt: '2026-01-01',
        }),
      });
      assert.equal(overPctRes.status, 400);

      // Negative value
      const negRes = await fetch(`${base}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Negative discount',
          kind: 'FIXED',
          scope: 'SUBSCRIPTION',
          value: -100,
          startsAt: '2026-01-01',
        }),
      });
      assert.equal(negRes.status, 400);

      // Product scope missing productId
      const missingProdRes = await fetch(`${base}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Missing product',
          kind: 'FIXED',
          scope: 'PRODUCT',
          value: 5000,
          startsAt: '2026-01-01',
        }),
      });
      assert.equal(missingProdRes.status, 400);

      // Product scope with non-existent productId
      const nonExistentProdRes = await fetch(`${base}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Fake product',
          kind: 'FIXED',
          scope: 'PRODUCT',
          productId: 'non-existent-product-id',
          value: 5000,
          startsAt: '2026-01-01',
        }),
      });
      assert.equal(nonExistentProdRes.status, 400);

      // Subscription scope with productId specified
      const subWithProdRes = await fetch(`${base}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Conflict scope',
          kind: 'PERCENTAGE',
          scope: 'SUBSCRIPTION',
          productId: mainProductId,
          value: 1000,
          startsAt: '2026-01-01',
        }),
      });
      assert.equal(subWithProdRes.status, 400);

      // Invalid dates (endsAt < startsAt)
      const invalidDatesRes = await fetch(`${base}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Backwards dates',
          kind: 'FIXED',
          scope: 'SUBSCRIPTION',
          value: 5000,
          startsAt: '2026-12-31',
          endsAt: '2026-01-01',
        }),
      });
      assert.equal(invalidDatesRes.status, 400);
    });

    await t.test('GET /discounts lists and filters rules', async () => {
      const res = await fetch(`${base}/discounts?page=1&pageSize=10`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.data.items));
      assert.ok(body.data.total >= 2);

      // Filter by scope
      const subOnlyRes = await fetch(`${base}/discounts?scope=SUBSCRIPTION`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(subOnlyRes.status, 200);
      const subOnlyBody = await subOnlyRes.json();
      assert.ok(subOnlyBody.data.items.every((d: any) => d.scope === 'SUBSCRIPTION'));

      // Filter by productId
      const prodOnlyRes = await fetch(`${base}/discounts?productId=${mainProductId}`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(prodOnlyRes.status, 200);
      const prodOnlyBody = await prodOnlyRes.json();
      assert.ok(prodOnlyBody.data.items.some((d: any) => d.id === prodDiscountId));
    });

    await t.test('GET /discounts/:id and PATCH /discounts/:id', async () => {
      const getRes = await fetch(`${base}/discounts/${subDiscountId}`, {
        headers: { 'x-user-role': 'STAFF' },
      });
      assert.equal(getRes.status, 200);
      const getBody = await getRes.json();
      assert.equal(getBody.data.id, subDiscountId);

      const patchRes = await fetch(`${base}/discounts/${subDiscountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({
          name: 'Updated 15% Annual Discount',
          value: 1500, // 15%
          usageLimit: 250,
        }),
      });
      assert.equal(patchRes.status, 200);
      const patchBody = await patchRes.json();
      assert.equal(patchBody.data.name, 'Updated 15% Annual Discount');
      assert.equal(patchBody.data.value, 1500);
      assert.equal(patchBody.data.usageLimit, 250);
    });

    await t.test('POST /discounts/preview demonstrates deterministic single-discount policy', async () => {
      // Lines meeting the minimum purchase threshold of ₹4,000 (400000 paise)
      // Line: mainProduct × 1 unit @ 439900 paise (₹4,399.00)
      // 15% of 439900 = 65985 paise savings vs ₹500 (50000 paise).
      // Deterministic policy selects 15% (highest savings).
      const previewRes = await fetch(`${base}/discounts/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'STAFF' },
        body: JSON.stringify({
          lines: [
            { productId: mainProductId, quantity: 1, unitPriceMinor: 439900, taxRateBps: 1800 },
          ],
          periodStart: '2026-06-01T00:00:00.000Z',
        }),
      });
      assert.equal(previewRes.status, 200);
      const previewBody = await previewRes.json();
      assert.equal(previewBody.data.eligible, true);
      assert.equal(previewBody.data.selectedDiscount.id, subDiscountId);
      assert.equal(previewBody.data.savingsMinor, 65985); // 15% of 439900 = 65985 paise

      // Verify that preview did NOT increment discount uses
      const checkDiscount = await db.discountRule.findUnique({ where: { id: subDiscountId } });
      assert.equal(checkDiscount?.uses, 0);
    });

    await t.test('discount archiving via archive/unarchive and DELETE /discounts/:id', async () => {
      const archiveRes = await fetch(`${base}/discounts/${prodDiscountId}/archive`, {
        method: 'POST',
        headers: { 'x-user-role': 'ADMIN' },
      });
      assert.equal(archiveRes.status, 200);
      assert.equal((await archiveRes.json()).data.isActive, false);

      const unarchiveRes = await fetch(`${base}/discounts/${prodDiscountId}/unarchive`, {
        method: 'POST',
        headers: { 'x-user-role': 'ADMIN' },
      });
      assert.equal(unarchiveRes.status, 200);
      assert.equal((await unarchiveRes.json()).data.isActive, true);

      // DELETE archives rather than hard deleting
      const deleteRes = await fetch(`${base}/discounts/${prodDiscountId}`, {
        method: 'DELETE',
        headers: { 'x-user-role': 'ADMIN' },
      });
      assert.equal(deleteRes.status, 200);
      const deleteBody = await deleteRes.json();
      assert.equal(deleteBody.data.isActive, false);
      assert.equal(deleteBody.data.archived, true);
    });

    // -------------------------------------------------------------------------
    // Step 6: End-to-End Workflow & Old Invoice Snapshot Preservation
    // -------------------------------------------------------------------------

    await t.test('catalog edits preserve existing issued invoice and subscription line snapshots', async () => {
      // 1. Create a customer
      const cust = await db.customer.create({
        data: {
          name: 'Snapshot Preservation Buyer',
          email: 'buyer-preserve@brightloop.local',
        },
      });

      // 2. Create subscription with lines snapshotting product price and tax rate
      const sub = await db.subscription.create({
        data: {
          number: 'SUB-SNAPSHOT-001',
          customerId: cust.id,
          planId: monthlyPlanId,
          status: 'ACTIVE',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          paymentTermDays: 7,
          billingInterval: 'MONTHLY',
          lines: {
            create: [
              {
                productId: mainProductId,
                description: 'Original Product Snapshot',
                quantity: 1,
                unitPriceMinor: 439900, // original price ₹4,399.00
                taxRuleId: gst18Id,
                taxRateBps: 1800,        // original 18% tax
              },
            ],
          },
        },
      });

      // 3. Create an invoice capturing the original amounts
      const originalSubtotal = 439900;
      const originalTax = Math.round((originalSubtotal * 1800) / 10000); // 79182
      const originalTotal = originalSubtotal + originalTax; // 519082

      const invoice = await db.invoice.create({
        data: {
          number: 'INV-SNAPSHOT-001',
          customerId: cust.id,
          customerName: cust.name,
          customerEmail: cust.email,
          subscriptionId: sub.id,
          status: 'CONFIRMED',
          periodStart: new Date('2026-06-01T00:00:00.000Z'),
          periodEnd: new Date('2026-07-01T00:00:00.000Z'),
          dueDate: new Date('2026-06-08T00:00:00.000Z'),
          subtotalMinor: originalSubtotal,
          taxMinor: originalTax,
          discountMinor: 0,
          totalMinor: originalTotal,
          lines: {
            create: [
              {
                productId: mainProductId,
                description: 'Original Product Snapshot Line',
                quantity: 1,
                unitPriceMinor: originalSubtotal,
                taxRateBps: 1800,
                taxMinor: originalTax,
                discountMinor: 0,
                amountMinor: originalTotal,
              },
            ],
          },
        },
        include: { lines: true },
      });

      assert.equal(invoice.subtotalMinor, 439900);
      assert.equal(invoice.taxMinor, 79182);

      // 4. Admin edits the product price and tax rule in catalog
      const patchProd = await fetch(`${base}/products/${mainProductId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ salesPriceMinor: 999900 }), // increased to ₹9,999.00
      });
      assert.equal(patchProd.status, 200);

      const patchTax = await fetch(`${base}/taxes/${gst18Id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'ADMIN' },
        body: JSON.stringify({ rateBps: 500 }), // reduced to 5%
      });
      assert.equal(patchTax.status, 200);

      // 5. Verify the existing invoice and subscription lines retained their exact snapshots!
      const invoiceAfter = await db.invoice.findUnique({
        where: { id: invoice.id },
        include: { lines: true },
      });
      assert.ok(invoiceAfter);
      assert.equal(invoiceAfter.subtotalMinor, 439900, 'Original invoice subtotal must not be recalculated');
      assert.equal(invoiceAfter.taxMinor, 79182, 'Original invoice tax must not be recalculated');
      assert.equal(invoiceAfter.lines[0].unitPriceMinor, 439900, 'Original line unit price must be preserved');
      assert.equal(invoiceAfter.lines[0].taxRateBps, 1800, 'Original line tax rate must be preserved');
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.$disconnect();
    for (const filename of readdirSync(directory)) unlinkSync(path.join(directory, filename));
    rmdirSync(directory);
  }
});
