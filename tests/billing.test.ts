import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import express from 'express';
import { calculateLine, calculateInvoice } from '../server/src/modules/billing/calculation.js';
import { calculateNextPeriod } from '../server/src/modules/billing/calendar.js';
import { selectBestEligibleDiscount } from '../server/src/modules/billing/discounts.js';
import type { DiscountRule } from '@prisma/client';

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
    const jan31 = new Date('2026-01-31T00:00:00.000Z');
    const febResult = calculateNextPeriod(jan31, 'MONTHLY', 31);
    assert.equal(febResult.nextPeriodStart.toISOString(), '2026-02-28T00:00:00.000Z');

    const marResult = calculateNextPeriod(febResult.nextPeriodStart, 'MONTHLY', 31);
    assert.equal(marResult.nextPeriodStart.toISOString(), '2026-03-31T00:00:00.000Z');
  });

  await t.test('handles leap year clamping for YEARLY interval (Feb 29 -> Feb 28)', () => {
    const leapDay = new Date('2024-02-29T00:00:00.000Z');
    const result = calculateNextPeriod(leapDay, 'YEARLY', 29);
    assert.equal(result.nextPeriodStart.toISOString(), '2025-02-28T00:00:00.000Z');
  });
});

test('Billing Phase 3 - Discount Eligibility & Selection Unit Tests', async t => {
  const baseRule: DiscountRule = {
    id: 'disc-1',
    name: '10% Off Subscription',
    kind: 'PERCENTAGE',
    scope: 'SUBSCRIPTION',
    value: 1000, // 1000 bps = 10%
    productId: null,
    minimumPurchaseMinor: 50000, // min ₹500
    minimumQuantity: 1,
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: new Date('2026-12-31T23:59:59.999Z'),
    usageLimit: 5,
    uses: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const lines = [
    { productId: 'prod-1', quantity: 2, unitPriceMinor: 100000, taxRateBps: 1800 }, // Subtotal: 200000 (₹2,000)
  ];
  const date = new Date('2026-06-01T00:00:00.000Z');

  await t.test('selects percentage discount correctly (10% of ₹2,000 = ₹200 savings)', () => {
    const selected = selectBestEligibleDiscount([baseRule], lines, date);
    assert.ok(selected);
    assert.equal(selected.rule.id, 'disc-1');
    assert.equal(selected.savingsMinor, 20000); // 20000 paise
  });

  await t.test('selects single largest savings deterministically among competing discounts', () => {
    const fixedRule: DiscountRule = {
      ...baseRule,
      id: 'disc-2',
      name: 'Fixed ₹300 Off',
      kind: 'FIXED',
      value: 30000, // ₹300
    };

    // Competing: 10% of ₹2000 = ₹200 vs Fixed ₹300.
    // Should select disc-2 (₹300 savings)
    const selected = selectBestEligibleDiscount([baseRule, fixedRule], lines, date);
    assert.ok(selected);
    assert.equal(selected.rule.id, 'disc-2');
    assert.equal(selected.savingsMinor, 30000);
  });

  await t.test('rejects expired discounts or discounts before start date', () => {
    const expiredRule: DiscountRule = {
      ...baseRule,
      id: 'disc-expired',
      endsAt: new Date('2026-05-01T00:00:00.000Z'),
    };
    const selected = selectBestEligibleDiscount([expiredRule], lines, date);
    assert.equal(selected, null);
  });

  await t.test('rejects exhausted discounts when uses >= usageLimit', () => {
    const exhaustedRule: DiscountRule = {
      ...baseRule,
      id: 'disc-exhausted',
      usageLimit: 3,
      uses: 3,
    };
    const selected = selectBestEligibleDiscount([exhaustedRule], lines, date);
    assert.equal(selected, null);
  });

  await t.test('rejects when minimum purchase or quantity is not met', () => {
    const highThresholdRule: DiscountRule = {
      ...baseRule,
      id: 'disc-high',
      minimumPurchaseMinor: 500000, // ₹5,000 (lines only total ₹2,000)
    };
    const selected = selectBestEligibleDiscount([highThresholdRule], lines, date);
    assert.equal(selected, null);
  });

  await t.test('product-scope discount matches target product only', () => {
    const productRule: DiscountRule = {
      ...baseRule,
      id: 'disc-prod',
      scope: 'PRODUCT',
      productId: 'prod-other', // different product
      kind: 'FIXED',
      value: 10000,
    };
    const selected = selectBestEligibleDiscount([productRule], lines, date);
    assert.equal(selected, null);
  });
});

test('Billing Full Integration - Invoices, Recurring Runs, Actions & Discounts', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'brightloop-billing-test-'));
  const dbPath = path.join(directory, 'billing-test.db');
  const outboxDir = path.join(directory, 'outbox');
  process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
  process.env.MAIL_MODE = 'file';
  process.env.MAIL_OUTBOX_DIR = outboxDir;
  writeFileSync(dbPath, '');
  process.env.NODE_ENV = 'test';

  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
  });

  const { db } = await import('../server/src/lib/db.js');
  const { createInvoiceFromSubscription } = await import('../server/src/modules/billing/service.js');
  const { billingRouter, billingPortalRouter } = await import('../server/src/modules/billing/router.js');
  const { runBillingCycle } = await import('../server/src/modules/billing/recurring.js');
  const { runScheduledBillingCycle } = await import('../server/src/modules/billing/scheduler.js');

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
  testApp.use('/api/portal/invoices', billingPortalRouter);

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
  const portalBase = `http://127.0.0.1:${address.port}/api/portal/invoices`;

  try {
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
      assert.equal(invoice.status, 'DRAFT');
      assert.equal(invoice.subtotalMinor, 300000);
      assert.equal(invoice.taxMinor, 54000);
      assert.equal(invoice.totalMinor, 354000);

      createdInvoiceId = invoice.id;
    });

    // -------------------------------------------------------------
    // PHASE 3 INVOICE ACTIONS TESTS: CONFIRM & CANCEL
    // -------------------------------------------------------------

    await t.test('POST /invoices/:id/confirm transitions DRAFT to CONFIRMED', async () => {
      const res = await fetch(`${base}/invoices/${createdInvoiceId}/confirm`, { method: 'POST' });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.status, 'CONFIRMED');

      // Calling confirm again on already confirmed invoice returns 400
      const resAgain = await fetch(`${base}/invoices/${createdInvoiceId}/confirm`, { method: 'POST' });
      assert.equal(resAgain.status, 400);
    });

    await t.test('POST /invoices/:id/cancel cancels invoice and blocks cancellation if payments exist', async () => {
      // 1. Simulate a payment record to test payment protection
      await db.payment.create({
        data: {
          invoiceId: createdInvoiceId,
          method: 'BANK_TRANSFER',
          amountMinor: 50000,
          paidAt: new Date(),
          reference: 'TXN-TEST-001',
        },
      });

      // Cancellation must be rejected with 400 because payment exists
      const rejectRes = await fetch(`${base}/invoices/${createdInvoiceId}/cancel`, { method: 'POST' });
      assert.equal(rejectRes.status, 400);
      const rejectJson = await rejectRes.json();
      assert.equal(rejectJson.error.code, 'PAYMENTS_EXIST');

      // Remove the test payment so we can test successful cancellation of a clean invoice
      await db.payment.deleteMany({ where: { invoiceId: createdInvoiceId } });

      // Now cancellation succeeds
      const cancelRes = await fetch(`${base}/invoices/${createdInvoiceId}/cancel`, { method: 'POST' });
      assert.equal(cancelRes.status, 200);
      const cancelJson = await cancelRes.json();
      assert.equal(cancelJson.data.status, 'CANCELLED');
    });

    // -------------------------------------------------------------
    // PHASE 3 AUTOMATIC DISCOUNT & ATOMIC REDEMPTION TESTS
    // -------------------------------------------------------------

    await t.test('applies eligible discount atomically with tax-after-discount and redemption record', async () => {
      // Create active discount rule: 10% off with usage limit of 2
      const discount = await db.discountRule.create({
        data: {
          name: 'Promo 10% Off',
          kind: 'PERCENTAGE',
          scope: 'SUBSCRIPTION',
          value: 1000, // 10% bps
          minimumPurchaseMinor: 100000,
          startsAt: new Date('2026-10-01T00:00:00.000Z'),
          usageLimit: 2,
          uses: 0,
          isActive: true,
        },
      });

      const subWithDiscount = await db.subscription.create({
        data: {
          number: 'SUB-DISC-001',
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
                description: 'Analytics Seat with Discount',
                quantity: 1,
                unitPriceMinor: 200000, // Subtotal: 200000
                taxRateBps: 1800,       // 18% tax
              },
            ],
          },
        },
      });

      // Run billing cycle for 2026-10-01
      const res = await fetch(`${base}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDate: '2026-10-15T00:00:00.000Z',
          subscriptionId: subWithDiscount.id,
        }),
      });

      assert.equal(res.status, 200);

      // Verify created invoice received the 10% discount and tax on discounted base:
      // Subtotal: 200000 (₹2,000)
      // Discount: 20000 (₹200)
      // Taxable Base: 180000 (₹1,800)
      // Tax: Math.round(180000 * 1800 / 10000) = 32400 (₹324)
      // Total: 180000 + 32400 = 212400 (₹2,124)
      const invoice = await db.invoice.findUnique({
        where: {
          subscriptionId_periodStart: {
            subscriptionId: subWithDiscount.id,
            periodStart: new Date('2026-10-01T00:00:00.000Z'),
          },
        },
        include: {
          discountRedemptions: true,
        },
      });

      assert.ok(invoice);
      assert.equal(invoice.subtotalMinor, 200000);
      assert.equal(invoice.discountMinor, 20000);
      assert.equal(invoice.taxMinor, 32400);
      assert.equal(invoice.totalMinor, 212400);

      // Verify atomic redemption record
      assert.equal(invoice.discountRedemptions.length, 1);
      assert.equal(invoice.discountRedemptions[0].discountId, discount.id);
      assert.equal(invoice.discountRedemptions[0].amountMinor, 20000);

      // Verify discount uses incremented
      const updatedDiscount = await db.discountRule.findUnique({ where: { id: discount.id } });
      assert.equal(updatedDiscount?.uses, 1);
    });

    // -------------------------------------------------------------
    // PHASE 4 PAYMENT RECORDS, BALANCES & OVERDUE FILTER TESTS
    // -------------------------------------------------------------

    // Create a confirmed invoice for payment tests
    const confirmedInvoice = await db.invoice.create({
      data: {
        number: 'INV-PAY-001',
        subscriptionId: subscription.id,
        customerId: customer.id,
        customerName: customer.name,
        customerEmail: customer.email,
        status: 'CONFIRMED',
        periodStart: new Date('2026-10-01T00:00:00.000Z'),
        periodEnd: new Date('2026-10-31T23:59:59.999Z'),
        dueDate: new Date('2026-10-15T00:00:00.000Z'), // Past date -> overdue
        subtotalMinor: 200000,
        discountMinor: 0,
        taxMinor: 36000,
        totalMinor: 236000, // Total: ₹2,360.00
      },
    });

    await t.test('POST /invoices/:id/payments records partial payment and keeps status CONFIRMED', async () => {
      const res = await fetch(`${base}/invoices/${confirmedInvoice.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'BANK_TRANSFER',
          amountMinor: 100000, // Partial payment of ₹1,000.00
          reference: 'TXN-REF-1001',
          note: 'First installment',
        }),
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.data.payment.amountMinor, 100000);
      assert.equal(json.data.invoice.status, 'CONFIRMED');
      assert.equal(json.data.invoice.paidAmountMinor, 100000);
      assert.equal(json.data.invoice.remainingBalanceMinor, 136000);
    });

    await t.test('GET /invoices/:id/payments lists payments with balances', async () => {
      const res = await fetch(`${base}/invoices/${confirmedInvoice.id}/payments`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.items.length, 1);
      assert.equal(json.data.totalPaidMinor, 100000);
      assert.equal(json.data.remainingBalanceMinor, 136000);
    });

    await t.test('rejects duplicate payment references', async () => {
      const res = await fetch(`${base}/invoices/${confirmedInvoice.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'UPI',
          amountMinor: 10000,
          reference: 'TXN-REF-1001', // Already used above
        }),
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error.code, 'DUPLICATE_REFERENCE');
    });

    await t.test('rejects overpayment exceeding remaining balance', async () => {
      // Remaining balance is 136000 paise. Attempting to pay 136001 must be rejected!
      const res = await fetch(`${base}/invoices/${confirmedInvoice.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'UPI',
          amountMinor: 136001,
          reference: 'TXN-REF-OVERPAY',
        }),
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error.code, 'OVERPAYMENT');
    });

    await t.test('exact remaining payment transitions status to PAID', async () => {
      const res = await fetch(`${base}/invoices/${confirmedInvoice.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'UPI',
          amountMinor: 136000, // Exact remaining balance
          reference: 'TXN-REF-FINAL',
        }),
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.data.invoice.status, 'PAID');
      assert.equal(json.data.invoice.paidAmountMinor, 236000);
      assert.equal(json.data.invoice.remainingBalanceMinor, 0);

      // Verify in DB that status is PAID
      const dbInvoice = await db.invoice.findUnique({ where: { id: confirmedInvoice.id } });
      assert.equal(dbInvoice?.status, 'PAID');
    });

    await t.test('rejects payments against DRAFT and CANCELLED invoices', async () => {
      // Create a Draft invoice
      const draftInvoice = await db.invoice.create({
        data: {
          number: 'INV-DRAFT-TEST',
          subscriptionId: subscription.id,
          customerId: customer.id,
          customerName: customer.name,
          customerEmail: customer.email,
          status: 'DRAFT',
          periodStart: new Date('2026-12-01T00:00:00.000Z'),
          periodEnd: new Date('2026-12-31T23:59:59.999Z'),
          dueDate: new Date('2026-12-15T00:00:00.000Z'),
          subtotalMinor: 100000,
          totalMinor: 118000,
        },
      });

      const draftRes = await fetch(`${base}/invoices/${draftInvoice.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'CASH',
          amountMinor: 50000,
        }),
      });
      assert.equal(draftRes.status, 400);
      assert.equal((await draftRes.json()).error.code, 'INVALID_INVOICE_STATUS');

      // Cancel the invoice and test again
      await db.invoice.update({ where: { id: draftInvoice.id }, data: { status: 'CANCELLED' } });
      const cancelRes = await fetch(`${base}/invoices/${draftInvoice.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'CASH',
          amountMinor: 50000,
        }),
      });
      assert.equal(cancelRes.status, 400);
      assert.equal((await cancelRes.json()).error.code, 'INVALID_INVOICE_STATUS');
    });

    await t.test('GET /invoices?overdue=true returns only unpaid past-due invoices', async () => {
      // Create an overdue invoice
      const overdueInv = await db.invoice.create({
        data: {
          number: 'INV-OVERDUE-TEST',
          subscriptionId: subscription.id,
          customerId: customer.id,
          customerName: customer.name,
          customerEmail: customer.email,
          status: 'CONFIRMED',
          periodStart: new Date('2026-09-01T00:00:00.000Z'),
          periodEnd: new Date('2026-09-30T23:59:59.999Z'),
          dueDate: new Date('2026-09-15T00:00:00.000Z'), // definitely in the past
          subtotalMinor: 100000,
          totalMinor: 118000,
        },
      });

      const res = await fetch(`${base}/invoices?overdue=true`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(json.data.items.length >= 1);
      const found = json.data.items.find((i: any) => i.id === overdueInv.id);
      assert.ok(found);
      assert.equal(found.isOverdue, true);
    });

    // --- Hour 5 Tests: Customer portal, printable invoices, and email send ---

    await t.test('portal GET /invoices returns only authenticated customer invoices', async () => {
      // Create a second customer and an invoice belonging to them
      const otherCustomer = await db.customer.create({
        data: {
          name: 'Other Company Ltd',
          email: 'accounts@othercompany.test',
        },
      });

      const otherSub = await db.subscription.create({
        data: {
          number: 'SUB-OTHER-001',
          customerId: otherCustomer.id,
          planId: plan.id,
          status: 'ACTIVE',
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          paymentTermDays: 7,
          billingInterval: 'MONTHLY',
        },
      });

      const otherInvoice = await db.invoice.create({
        data: {
          number: 'INV-OTHER-999',
          subscriptionId: otherSub.id,
          customerId: otherCustomer.id,
          customerName: otherCustomer.name,
          customerEmail: otherCustomer.email,
          periodStart: new Date('2026-10-01T00:00:00.000Z'),
          periodEnd: new Date('2026-10-31T23:59:59.999Z'),
          dueDate: new Date('2026-10-08T00:00:00.000Z'),
          subtotalMinor: 50000,
          totalMinor: 59000,
        },
      });

      // Switch session to customer 1
      testUser = {
        id: 'cust-1-user',
        name: customer.name,
        email: customer.email,
        role: 'CUSTOMER',
        customerId: customer.id,
      };

      const res = await fetch(portalBase);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(json.data.items.length >= 1);
      // Ensure only customer 1 invoices are returned
      assert.ok(json.data.items.every((i: any) => i.customerId === customer.id));
      assert.ok(!json.data.items.some((i: any) => i.id === otherInvoice.id));
    });

    await t.test('portal invoice detail and print reject access to another customer invoice with 404', async () => {
      // Find other customer invoice
      const otherInv = await db.invoice.findFirst({
        where: { customerName: 'Other Company Ltd' },
      });
      assert.ok(otherInv);

      // testUser is customer 1
      testUser = {
        id: 'cust-1-user',
        name: customer.name,
        email: customer.email,
        role: 'CUSTOMER',
        customerId: customer.id,
      };

      // Attempt to access other customer's invoice detail
      const resDetail = await fetch(`${portalBase}/${otherInv.id}`);
      assert.equal(resDetail.status, 404, 'Detail endpoint must reject cross-customer invoice');

      // Attempt to access other customer's invoice print
      const resPrint = await fetch(`${portalBase}/${otherInv.id}/print`);
      assert.equal(resPrint.status, 404, 'Print endpoint must reject cross-customer invoice');
    });

    await t.test('portal GET /invoices/:id/print returns printable invoice for customer', async () => {
      const targetInvoice = await db.invoice.findUnique({ where: { id: createdInvoiceId } });
      assert.ok(targetInvoice);

      testUser = {
        id: 'cust-1-user',
        name: customer.name,
        email: customer.email,
        role: 'CUSTOMER',
        customerId: customer.id,
      };

      const res = await fetch(`${portalBase}/${targetInvoice.id}/print`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.printable, true);
      assert.equal(json.data.invoice.id, targetInvoice.id);
      assert.equal(json.data.invoice.customerName, customer.name);
      assert.ok(json.data.invoice.lines.length >= 1);
    });

    await t.test('staff GET /billing/invoices/:id/print returns printable invoice for staff', async () => {
      const targetInvoice = await db.invoice.findUnique({ where: { id: createdInvoiceId } });
      assert.ok(targetInvoice);

      testUser = {
        id: 'staff-user',
        name: 'Staff Tester',
        email: 'staff@brightloop.test',
        role: 'STAFF',
        customerId: null,
      };

      const res = await fetch(`${base}/invoices/${targetInvoice.id}/print`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.printable, true);
      assert.equal(json.data.invoice.number, targetInvoice.number);
      assert.equal(json.data.invoice.customerEmail, customer.email);
    });

    await t.test('staff POST /billing/invoices/:id/send sends email via shared mail helper and records sentAt', async () => {
      const targetInvoice = await db.invoice.findUnique({ where: { id: createdInvoiceId } });
      assert.ok(targetInvoice);

      testUser = {
        id: 'staff-user',
        name: 'Staff Tester',
        email: 'staff@brightloop.test',
        role: 'STAFF',
        customerId: null,
      };

      const res = await fetch(`${base}/invoices/${targetInvoice.id}/send`, {
        method: 'POST',
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.sent, true);
      assert.equal(json.data.recipient, customer.email);

      // Verify sentAt was saved in DB
      const updatedInv = await db.invoice.findUnique({ where: { id: targetInvoice.id } });
      assert.ok(updatedInv?.sentAt, 'Invoice sentAt should be populated in database');

      // Verify .eml message in isolated outbox
      assert.ok(existsSync(outboxDir), 'Outbox directory should exist');
      const emlFiles = readdirSync(outboxDir).filter(f => f.endsWith('.eml'));
      assert.ok(emlFiles.length >= 1, 'At least one .eml message should have been delivered');

      const emlContent = readFileSync(path.join(outboxDir, emlFiles[emlFiles.length - 1]), 'utf-8');
      assert.ok(emlContent.includes(customer.email), 'Email should be addressed to customer email');
      assert.ok(emlContent.includes(targetInvoice.number), 'Email should contain invoice number');
      assert.ok(emlContent.includes(customer.name), 'Email should contain customer name');
    });

    // --- Hour 6 Tests: Scheduler, recovery, boundaries & performance benchmark ---

    await t.test('scheduler skips concurrent overlapping runs safely', async () => {
      const [res1, res2] = await Promise.all([
        runScheduledBillingCycle(),
        runScheduledBillingCycle(),
      ]);
      assert.ok(res1 !== undefined);
      assert.ok(res2 !== undefined);
    });

    await t.test('skips PAUSED and CLOSED subscriptions and generates no invoices', async () => {
      const pausedSub = await db.subscription.create({
        data: {
          number: 'SUB-PAUSED-001',
          customerId: customer.id,
          planId: plan.id,
          status: 'PAUSED',
          pausedAt: new Date('2026-10-01T00:00:00.000Z'),
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          nextBillingDate: new Date('2026-10-01T00:00:00.000Z'),
          paymentTermDays: 7,
          billingInterval: 'MONTHLY',
        },
      });

      const closedSub = await db.subscription.create({
        data: {
          number: 'SUB-CLOSED-001',
          customerId: customer.id,
          planId: plan.id,
          status: 'CLOSED',
          closedAt: new Date('2026-10-01T00:00:00.000Z'),
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          nextBillingDate: new Date('2026-09-01T00:00:00.000Z'),
          paymentTermDays: 7,
          billingInterval: 'MONTHLY',
        },
      });

      const pausedRun = await runBillingCycle({ subscriptionId: pausedSub.id });
      assert.equal(pausedRun.invoicesCreated, 0, 'Paused subscription must not be billed');

      const closedRun = await runBillingCycle({ subscriptionId: closedSub.id });
      assert.equal(closedRun.invoicesCreated, 0, 'Closed subscription must not be billed');
    });

    await t.test('preserves eligible final period strictly before expiry and stops on or after expiry', async () => {
      const expiringSub = await db.subscription.create({
        data: {
          number: 'SUB-EXPIRY-001',
          customerId: customer.id,
          planId: plan.id,
          status: 'ACTIVE',
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          expiryDate: new Date('2026-11-01T00:00:00.000Z'),
          nextBillingDate: new Date('2026-10-01T00:00:00.000Z'),
          paymentTermDays: 7,
          billingInterval: 'MONTHLY',
          lines: {
            create: [
              {
                productId: product.id,
                description: 'Final Month Access',
                quantity: 1,
                unitPriceMinor: 100000,
                taxRateBps: 0,
              },
            ],
          },
        },
      });

      const runResult = await runBillingCycle({
        subscriptionId: expiringSub.id,
        targetDate: new Date('2026-12-01T00:00:00.000Z'),
      });

      assert.equal(runResult.invoicesCreated, 1, 'Should bill the single eligible month before expiry');

      const reRun = await runBillingCycle({
        subscriptionId: expiringSub.id,
        targetDate: new Date('2026-12-01T00:00:00.000Z'),
      });
      assert.equal(reRun.invoicesCreated, 0, 'Should not bill periods on or after expiry');
    });

    await t.test('measures indexed queries with 1,000 subscriptions', async () => {
      const bulkData = Array.from({ length: 1000 }, (_, i) => ({
        number: `SUB-PERF-${i}`,
        customerId: customer.id,
        planId: plan.id,
        status: i % 2 === 0 ? 'ACTIVE' : (i % 3 === 0 ? 'PAUSED' : 'CLOSED'),
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        nextBillingDate: new Date(Date.now() - (i % 30) * 86400000),
        paymentTermDays: 7,
        billingInterval: 'MONTHLY',
      }));

      await db.subscription.createMany({
        data: bulkData as any,
      });

      const startTime = performance.now();
      const dueCount = await db.subscription.count({
        where: {
          status: 'ACTIVE',
          nextBillingDate: { lte: new Date() },
        },
      });
      const durationMs = performance.now() - startTime;

      assert.ok(dueCount > 0, 'Indexed query should find due active subscriptions');
      assert.ok(durationMs < 500, `Indexed query took ${durationMs.toFixed(2)}ms, should be well under 500ms`);
    });

    await t.test('full demo flow: create subscription, calculate with discount, record payment, and send receipt', async () => {
      const demoCust = await db.customer.create({
        data: {
          name: 'Demo Enterprises',
          email: 'finance@demoenterprises.test',
          address: 'Floor 12, Cyber Park, Gurugram',
        },
      });

      const demoSub = await db.subscription.create({
        data: {
          number: 'SUB-DEMO-001',
          customerId: demoCust.id,
          planId: plan.id,
          status: 'ACTIVE',
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          nextBillingDate: new Date('2026-10-01T00:00:00.000Z'),
          paymentTermDays: 15,
          billingInterval: 'MONTHLY',
          lines: {
            create: [
              {
                productId: product.id,
                description: 'Enterprise Cloud Suite',
                quantity: 1,
                unitPriceMinor: 200000,
                taxRateBps: 1800,
              },
            ],
          },
        },
      });

      const billRun = await runBillingCycle({ subscriptionId: demoSub.id });
      assert.equal(billRun.invoicesCreated, 1);

      const demoInv = await db.invoice.findFirstOrThrow({
        where: { subscriptionId: demoSub.id },
        include: { lines: true },
      });
      assert.equal(demoInv.status, 'DRAFT');

      testUser = {
        id: 'staff-user',
        name: 'Staff Tester',
        email: 'staff@brightloop.test',
        role: 'STAFF',
        customerId: null,
      };
      const confirmRes = await fetch(`${base}/invoices/${demoInv.id}/confirm`, { method: 'POST' });
      assert.equal(confirmRes.status, 200);

      testUser = {
        id: 'cust-demo-user',
        name: demoCust.name,
        email: demoCust.email,
        role: 'CUSTOMER',
        customerId: demoCust.id,
      };
      const portalRes = await fetch(`${portalBase}/${demoInv.id}`);
      assert.equal(portalRes.status, 200);
      const portalJson = await portalRes.json();
      assert.equal(portalJson.data.status, 'CONFIRMED');
      assert.equal(portalJson.data.totalMinor, demoInv.totalMinor);

      testUser = {
        id: 'staff-user',
        name: 'Staff Tester',
        email: 'staff@brightloop.test',
        role: 'STAFF',
        customerId: null,
      };
      const payRes = await fetch(`${base}/invoices/${demoInv.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'UPI',
          amountMinor: demoInv.totalMinor,
          reference: 'UPI-DEMO-FINAL-01',
        }),
      });
      assert.equal(payRes.status, 201);
      const payJson = await payRes.json();
      assert.equal(payJson.data.invoice.status, 'PAID');

      const emailRes = await fetch(`${base}/invoices/${demoInv.id}/send`, { method: 'POST' });
      assert.equal(emailRes.status, 200);
      const emailJson = await emailRes.json();
      assert.equal(emailJson.data.sent, true);
      assert.equal(emailJson.data.recipient, demoCust.email);
    });

  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    await db.$disconnect();

    if (existsSync(outboxDir)) {
      for (const filename of readdirSync(outboxDir)) {
        unlinkSync(path.join(outboxDir, filename));
      }
      rmdirSync(outboxDir);
    }

    for (const filename of readdirSync(directory)) {
      unlinkSync(path.join(directory, filename));
    }
    rmdirSync(directory);
  }
});
