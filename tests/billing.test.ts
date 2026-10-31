import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import express from 'express';
import { calculateLine, calculateInvoice } from '../server/src/modules/billing/calculation.js';
import { calculateNextPeriod } from '../server/src/modules/billing/calendar.js';

test('Billing Phase 1 - Invoice Calculation Unit Tests', async t => {
  await t.test('calculates line subtotal, tax and total in integer paise', () => {
    // 2 seats * ₹500.00 (50000 paise) @ 18% tax (1800 bps)
    const line = calculateLine({
      quantity: 2,
      unitPriceMinor: 50000,
      taxRateBps: 1800,
    });

    assert.equal(line.subtotalMinor, 100000, 'Subtotal should be 100000 paise (₹1000)');
    assert.equal(line.discountMinor, 0, 'Discount should be 0 paise');
    assert.equal(line.taxableBaseMinor, 100000, 'Taxable base should be 100000 paise');
    assert.equal(line.taxMinor, 18000, 'Tax should be 18000 paise (₹180)');
    assert.equal(line.amountMinor, 118000, 'Total line amount should be 118000 paise (₹1180)');
  });

  await t.test('rounds tax to nearest paise correctly without floating point leakage', () => {
    // ₹199.99 (19999 paise) @ 18% (1800 bps)
    // 19999 * 1800 / 10000 = 3599.82 -> Math.round -> 3600 paise (₹36.00)
    const line = calculateLine({
      quantity: 1,
      unitPriceMinor: 19999,
      taxRateBps: 1800,
    });

    assert.equal(line.subtotalMinor, 19999);
    assert.equal(line.taxMinor, 3600);
    assert.equal(line.amountMinor, 23599);
  });

  await t.test('aggregates multi-line invoice with mixed tax rates', () => {
    const linesInput = [
      { quantity: 1, unitPriceMinor: 10000, taxRateBps: 1800 }, // 10000 + 1800 tax = 11800
      { quantity: 2, unitPriceMinor: 5000, taxRateBps: 0 },    // 10000 + 0 tax = 10000
    ];

    const invoice = calculateInvoice(linesInput);

    assert.equal(invoice.subtotalMinor, 20000, 'Subtotal should be ₹200.00');
    assert.equal(invoice.discountMinor, 0, 'Discount is 0');
    assert.equal(invoice.taxMinor, 1800, 'Tax should be ₹18.00');
    assert.equal(invoice.totalMinor, 21800, 'Total should be ₹218.00');
    assert.equal(invoice.lines.length, 2);
  });

  await t.test('rejects invalid quantities, negative prices, and bad tax rates', () => {
    assert.throws(() => calculateLine({ quantity: 0, unitPriceMinor: 100, taxRateBps: 1000 }), /positive integer/);
    assert.throws(() => calculateLine({ quantity: -1, unitPriceMinor: 100, taxRateBps: 1000 }), /positive integer/);
    assert.throws(() => calculateLine({ quantity: 1, unitPriceMinor: -50, taxRateBps: 1000 }), /non-negative integer/);
    assert.throws(() => calculateLine({ quantity: 1, unitPriceMinor: 100, taxRateBps: 10001 }), /between 0 and 10000/);
  });
});

test('Billing Phase 2 - Calendar Arithmetic & Anchor-Day Clamping Unit Tests', async t => {
  await t.test('calculates DAILY interval correctly (+1 day)', () => {
    const start = new Date('2026-03-15T00:00:00.000Z');
    const { nextPeriodStart, periodEnd } = calculateNextPeriod(start, 'DAILY');
    assert.equal(nextPeriodStart.toISOString(), '2026-03-16T00:00:00.000Z');
    assert.equal(periodEnd.toISOString(), '2026-03-15T23:59:59.999Z');
  });

  await t.test('calculates WEEKLY interval correctly (+7 days)', () => {
    const start = new Date('2026-03-01T00:00:00.000Z');
    const { nextPeriodStart, periodEnd } = calculateNextPeriod(start, 'WEEKLY');
    assert.equal(nextPeriodStart.toISOString(), '2026-03-08T00:00:00.000Z');
    assert.equal(periodEnd.toISOString(), '2026-03-07T23:59:59.999Z');
  });

  await t.test('preserves anchor-day across short months (Jan 31 -> Feb 28 -> Mar 31)', () => {
    // 31st January 2026
    const jan31 = new Date('2026-01-31T00:00:00.000Z');
    const febResult = calculateNextPeriod(jan31, 'MONTHLY', 31);

    // February in 2026 has 28 days -> clamped to Feb 28
    assert.equal(febResult.nextPeriodStart.toISOString(), '2026-02-28T00:00:00.000Z');

    // Next cycle from Feb 28 with anchorDay = 31 -> March has 31 days -> restored to Mar 31!
    const marResult = calculateNextPeriod(febResult.nextPeriodStart, 'MONTHLY', 31);
    assert.equal(marResult.nextPeriodStart.toISOString(), '2026-03-31T00:00:00.000Z');
  });

  await t.test('handles leap year clamping for YEARLY interval (Feb 29 -> Feb 28)', () => {
    // Leap year Feb 29, 2024
    const leapDay = new Date('2024-02-29T00:00:00.000Z');
    const result = calculateNextPeriod(leapDay, 'YEARLY', 29);
    // 2025 is not a leap year -> clamped to Feb 28, 2025
    assert.equal(result.nextPeriodStart.toISOString(), '2025-02-28T00:00:00.000Z');
  });
});

test('Billing Phase 1 & 2 - Invoice DB Snapshots, APIs & Recurring Engine', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'brightloop-billing-test-'));
  const dbPath = path.join(directory, 'billing-test.db');
  process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
  writeFileSync(dbPath, '');
  process.env.NODE_ENV = 'test';

  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
  });

  const { db } = await import('../server/src/lib/db.js');
  const { createInvoiceFromSubscription } = await import('../server/src/modules/billing/service.js');
  const { billingRouter } = await import('../server/src/modules/billing/router.js');

  // Build isolated test express server
  const testApp = express();
  testApp.use(express.json());

  let testUser: { id: string; name: string; email: string; role: string; customerId: string | null } | null = {
    id: 'staff-user',
    name: 'Staff Tester',
    email: 'staff@brightloop.test',
    role: 'STAFF',
    customerId: null,
  };

  testApp.use((req, _res, next) => {
    if (testUser) {
      (req as unknown as { user: typeof testUser }).user = testUser;
    }
    next();
  });

  testApp.use('/api/billing', billingRouter);

  testApp.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status ?? 500).json({
      error: { code: err.code ?? 'ERROR', message: err.message },
    });
  });

  const server = testApp.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/billing`;

  try {
    // 1. Seed Customer, Product, Plan, and Subscriptions
    const customer = await db.customer.create({
      data: {
        name: 'Bright Customer Inc',
        email: 'billing-lead@customer.test',
        company: 'Customer Inc',
        address: '42 Bangalore Tech City',
      },
    });

    const product = await db.product.create({
      data: {
        name: 'Brightloop Analytics',
        salesPriceMinor: 150000,
        costPriceMinor: 50000,
      },
    });

    const plan = await db.plan.create({
      data: {
        name: 'Growth Monthly',
        productId: product.id,
        priceMinor: 150000,
        interval: 'MONTHLY',
        minimumQuantity: 1,
      },
    });

    const startDate = new Date('2026-11-01T00:00:00.000Z');
    const periodEnd = new Date('2026-11-30T23:59:59.999Z');

    const subscription = await db.subscription.create({
      data: {
        number: 'SUB-2026-001',
        customerId: customer.id,
        planId: plan.id,
        status: 'ACTIVE',
        billingInterval: 'MONTHLY',
        billingAnchorDay: 1,
        startDate,
        nextBillingDate: startDate,
        paymentTermDays: 10,
        lines: {
          create: [
            {
              productId: product.id,
              description: 'Growth Monthly Plan Base',
              quantity: 2,
              unitPriceMinor: 150000,
              taxRateBps: 1800,
            },
          ],
        },
      },
    });

    let createdInvoiceId = '';

    await t.test('creates invoice with snapshot of customer, prices, and rates', async () => {
      const invoice = await createInvoiceFromSubscription({
        subscriptionId: subscription.id,
        periodStart: startDate,
        periodEnd,
      });

      assert.ok(invoice.id);
      assert.ok(invoice.number.startsWith('INV-202611-'));
      assert.equal(invoice.customerName, 'Bright Customer Inc');
      assert.equal(invoice.customerEmail, 'billing-lead@customer.test');
      assert.equal(invoice.customerAddress, '42 Bangalore Tech City');
      assert.equal(invoice.status, 'DRAFT');

      assert.equal(invoice.subtotalMinor, 300000);
      assert.equal(invoice.discountMinor, 0);
      assert.equal(invoice.taxMinor, 54000);
      assert.equal(invoice.totalMinor, 354000);

      assert.equal(invoice.lines.length, 1);
      const line = invoice.lines[0];
      assert.equal(line.description, 'Growth Monthly Plan Base');
      assert.equal(line.quantity, 2);
      assert.equal(line.unitPriceMinor, 150000);
      assert.equal(line.taxRateBps, 1800);
      assert.equal(line.taxMinor, 54000);
      assert.equal(line.amountMinor, 354000);

      createdInvoiceId = invoice.id;
    });

    await t.test('GET /invoices lists invoices with pagination and balances', async () => {
      const res = await fetch(`${base}/invoices?page=1&pageSize=10`);
      assert.equal(res.status, 200);
      const json = await res.json();

      assert.ok(json.data);
      assert.equal(json.data.page, 1);
      assert.equal(json.data.pageSize, 10);
      assert.equal(json.data.total, 1);
      assert.equal(json.data.items.length, 1);

      const inv = json.data.items[0];
      assert.equal(inv.id, createdInvoiceId);
      assert.equal(inv.paidAmountMinor, 0);
      assert.equal(inv.remainingBalanceMinor, 354000);
    });

    await t.test('GET /invoices/:id returns full detail with snapshots', async () => {
      const res = await fetch(`${base}/invoices/${createdInvoiceId}`);
      assert.equal(res.status, 200);
      const json = await res.json();

      assert.equal(json.data.id, createdInvoiceId);
      assert.equal(json.data.customerName, 'Bright Customer Inc');
      assert.equal(json.data.lines.length, 1);
    });

    // -------------------------------------------------------------
    // PHASE 2 RECURRING BILLING ENGINE INTEGRATION TESTS
    // -------------------------------------------------------------

    // Create a new subscription specifically for recurring billing runs
    const subRecurring = await db.subscription.create({
      data: {
        number: 'SUB-RECURRING-001',
        customerId: customer.id,
        planId: plan.id,
        status: 'ACTIVE',
        billingInterval: 'MONTHLY',
        billingAnchorDay: 1,
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        nextBillingDate: new Date('2026-10-01T00:00:00.000Z'),
        paymentTermDays: 7,
        lines: {
          create: [
            {
              productId: product.id,
              description: 'Recurring Analytics Seat',
              quantity: 1,
              unitPriceMinor: 200000,
              taxRateBps: 1800,
            },
          ],
        },
      },
    });

    await t.test('POST /run triggers recurring billing cycle and advances nextBillingDate', async () => {
      const res = await fetch(`${base}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDate: '2026-10-15T00:00:00.000Z',
          subscriptionId: subRecurring.id,
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.invoicesCreated, 1);
      assert.equal(json.data.skippedDuplicates, 0);

      // Verify subscription's nextBillingDate advanced to Nov 1, 2026
      const updatedSub = await db.subscription.findUnique({ where: { id: subRecurring.id } });
      assert.ok(updatedSub?.nextBillingDate);
      assert.equal(updatedSub?.nextBillingDate.toISOString(), '2026-11-01T00:00:00.000Z');

      // Verify invoice was created in DB for 2026-10-01
      const invoice = await db.invoice.findUnique({
        where: {
          subscriptionId_periodStart: {
            subscriptionId: subRecurring.id,
            periodStart: new Date('2026-10-01T00:00:00.000Z'),
          },
        },
      });
      assert.ok(invoice);
      assert.equal(invoice.totalMinor, 236000); // 200000 + 36000 tax
    });

    await t.test('POST /run is idempotent: repeated runs prevent duplicate invoices', async () => {
      // Run again for the exact same targetDate
      const res = await fetch(`${base}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDate: '2026-10-15T00:00:00.000Z',
          subscriptionId: subRecurring.id,
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      // nextBillingDate is already 2026-11-01, which is > 2026-10-15, so 0 invoices are created
      assert.equal(json.data.invoicesCreated, 0);

      // Verify total invoices for this subscription is still exactly 1
      const count = await db.invoice.count({ where: { subscriptionId: subRecurring.id } });
      assert.equal(count, 1);
    });

    await t.test('handles bounded catch-up without skipping missed periods', async () => {
      // Create a subscription that missed 3 monthly periods (June, July, August 2026)
      const subCatchUp = await db.subscription.create({
        data: {
          number: 'SUB-CATCHUP-001',
          customerId: customer.id,
          planId: plan.id,
          status: 'ACTIVE',
          billingInterval: 'MONTHLY',
          billingAnchorDay: 1,
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          nextBillingDate: new Date('2026-06-01T00:00:00.000Z'),
          paymentTermDays: 7,
          lines: {
            create: [
              {
                productId: product.id,
                description: 'Catch-up Line',
                quantity: 1,
                unitPriceMinor: 100000,
                taxRateBps: 0,
              },
            ],
          },
        },
      });

      // Target cutoff is August 15, 2026 -> should bill June 1, July 1, August 1 (3 periods)
      const res = await fetch(`${base}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDate: '2026-08-15T00:00:00.000Z',
          subscriptionId: subCatchUp.id,
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.invoicesCreated, 3, 'Should bill 3 missed periods sequentially');

      const updatedSub = await db.subscription.findUnique({ where: { id: subCatchUp.id } });
      assert.equal(updatedSub?.nextBillingDate?.toISOString(), '2026-09-01T00:00:00.000Z');

      const invoices = await db.invoice.findMany({
        where: { subscriptionId: subCatchUp.id },
        orderBy: { periodStart: 'asc' },
      });
      assert.equal(invoices.length, 3);
      assert.equal(invoices[0].periodStart.toISOString(), '2026-06-01T00:00:00.000Z');
      assert.equal(invoices[1].periodStart.toISOString(), '2026-07-01T00:00:00.000Z');
      assert.equal(invoices[2].periodStart.toISOString(), '2026-08-01T00:00:00.000Z');
    });

    await t.test('skips PAUSED or CLOSED subscriptions from billing runs', async () => {
      const subPaused = await db.subscription.create({
        data: {
          number: 'SUB-PAUSED-001',
          customerId: customer.id,
          planId: plan.id,
          status: 'PAUSED',
          billingInterval: 'MONTHLY',
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          nextBillingDate: new Date('2026-10-01T00:00:00.000Z'),
          paymentTermDays: 7,
          lines: {
            create: [
              {
                productId: product.id,
                description: 'Paused Line',
                quantity: 1,
                unitPriceMinor: 100000,
                taxRateBps: 0,
              },
            ],
          },
        },
      });

      const res = await fetch(`${base}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDate: '2026-10-15T00:00:00.000Z',
          subscriptionId: subPaused.id,
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.invoicesCreated, 0, 'Paused subscription must not be billed');
    });

    await t.test('respects subscription expiryDate boundary and stops billing past expiry', async () => {
      const subExpired = await db.subscription.create({
        data: {
          number: 'SUB-EXPIRED-001',
          customerId: customer.id,
          planId: plan.id,
          status: 'ACTIVE',
          billingInterval: 'MONTHLY',
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          expiryDate: new Date('2026-10-15T00:00:00.000Z'),
          nextBillingDate: new Date('2026-10-01T00:00:00.000Z'), // current period starts before expiry
          paymentTermDays: 7,
          lines: {
            create: [
              {
                productId: product.id,
                description: 'Expiring Line',
                quantity: 1,
                unitPriceMinor: 100000,
                taxRateBps: 0,
              },
            ],
          },
        },
      });

      // Run up to end of year:
      // Oct 1 period will be billed (starts before expiry).
      // Next period (Nov 1) starts AFTER expiryDate (Oct 15) -> must NOT be billed!
      const res = await fetch(`${base}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDate: '2026-12-31T00:00:00.000Z',
          subscriptionId: subExpired.id,
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.invoicesCreated, 1, 'Only the eligible final period should be billed');
    });

    await t.test('rollback behavior: failure during creation does NOT advance nextBillingDate', async () => {
      // Create a subscription with an invalid setup that fails calculation
      const subFailing = await db.subscription.create({
        data: {
          number: 'SUB-FAILING-001',
          customerId: customer.id,
          planId: plan.id,
          status: 'ACTIVE',
          billingInterval: 'MONTHLY',
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          nextBillingDate: new Date('2026-10-01T00:00:00.000Z'),
          paymentTermDays: 7,
          // No lines attached -> createInvoiceFromSubscription throws NO_LINES
        },
      });

      const res = await fetch(`${base}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDate: '2026-10-15T00:00:00.000Z',
          subscriptionId: subFailing.id,
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.invoicesCreated, 0);
      assert.equal(json.data.errors.length, 1);

      // Verify nextBillingDate was NOT advanced
      const subAfter = await db.subscription.findUnique({ where: { id: subFailing.id } });
      assert.equal(subAfter?.nextBillingDate?.toISOString(), '2026-10-01T00:00:00.000Z');
    });

  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    await db.$disconnect();

    // Cleanup directory
    for (const filename of readdirSync(directory)) {
      unlinkSync(path.join(directory, filename));
    }
    rmdirSync(directory);
  }
});
