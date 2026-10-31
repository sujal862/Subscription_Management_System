import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import express from 'express';
import { calculateLine, calculateInvoice } from '../server/src/modules/billing/calculation.js';

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

test('Billing Phase 1 - Invoice Database Snapshots & API Endpoints', async t => {
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

  // Mock authenticated user context on request
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

  // Global test error handler
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
    // 1. Seed isolated DB fixtures: Customer, Product, Plan, Subscription & Lines
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
        startDate,
        paymentTermDays: 10,
        lines: {
          create: [
            {
              productId: product.id,
              description: 'Growth Monthly Plan Base',
              quantity: 2,
              unitPriceMinor: 150000, // ₹1,500.00 each
              taxRateBps: 1800,       // 18% tax
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

      // 2 * 150000 = 300000 subtotal, 0 discount, 54000 tax (18%), 354000 total
      assert.equal(invoice.subtotalMinor, 300000);
      assert.equal(invoice.discountMinor, 0);
      assert.equal(invoice.taxMinor, 54000);
      assert.equal(invoice.totalMinor, 354000);

      // Verify line snapshot
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
      assert.equal(json.data.lines[0].description, 'Growth Monthly Plan Base');
    });

    await t.test('GET /invoices/:id returns 404 for unknown id', async () => {
      const res = await fetch(`${base}/invoices/unknown-invoice-id`);
      assert.equal(res.status, 404);
      const json = await res.json();
      assert.equal(json.error.code, 'NOT_FOUND');
    });

    await t.test('role enforcement: blocks CUSTOMER role from accessing staff invoices', async () => {
      testUser = {
        id: 'cust-user',
        name: 'Regular Customer',
        email: 'customer@test.com',
        role: 'CUSTOMER',
        customerId: customer.id,
      };

      const res = await fetch(`${base}/invoices`);
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.error.code, 'FORBIDDEN');
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    await db.$disconnect();

    // Directory cleanup
    for (const filename of readdirSync(directory)) {
      unlinkSync(path.join(directory, filename));
    }
    rmdirSync(directory);
  }
});
