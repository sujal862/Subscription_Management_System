import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { testServer } from './helpers/test-server.js';
import { createLifecycleFixture } from './fixtures/subscriptions.js';

test('dashboard accounting, filters, authorization and representative query performance', async t => {
  const { db, base } = await testServer(t);
  const { hashPassword } = await import('../server/src/lib/password.js');
  const { dashboardSummary, overdueInvoices, overdueQuerySchema } = await import('../server/src/modules/dashboard/service.js');
  const password = 'Dashboard!2026';
  const passwordHash = await hashPassword(password);
  const cookies: Record<string, string> = {};
  for (const role of ['ADMIN', 'STAFF', 'CUSTOMER'] as const) {
    const email = `${role.toLowerCase()}@dashboard.test`;
    await db.user.create({ data: { name: role, email, passwordHash, role } });
    const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 200);
    cookies[role] = response.headers.get('set-cookie')!.split(';')[0];
  }
  const get = (path: string, role = 'ADMIN') => fetch(`${base}/dashboard/${path}`, { headers: cookies[role] ? { Cookie: cookies[role] } : {} });
  const now = new Date('2026-10-31T12:00:00Z');
  await t.test('empty totals are numeric zero and only internal users can read', async () => {
    const expected = { activeSubscriptions: 0, invoicedRevenueMinor: 0, collectedMinor: 0, outstandingMinor: 0, overdueMinor: 0, overdueInvoices: 0, invoiceCount: 0, currency: 'INR', asOf: now.toISOString() };
    assert.deepEqual(await dashboardSummary({}, now), expected);
    for (const path of ['summary', 'overdue']) {
      assert.equal((await get(path, 'ANONYMOUS')).status, 401);
      assert.equal((await get(path, 'CUSTOMER')).status, 403);
      assert.equal((await get(path, 'STAFF')).status, 200);
    }
  });
  const { subscription, customer, plan } = await createLifecycleFixture(db);
  await createLifecycleFixture(db, { status: 'PAUSED' });
  let sequence = 0;
  async function invoice(options: { status?: 'DRAFT' | 'CONFIRMED' | 'PAID' | 'CANCELLED'; issuedAt?: string; dueDate?: string; payments?: number[] } = {}) {
    sequence++;
    return db.invoice.create({ data: {
      number: `INV-DASH-${sequence}`, subscriptionId: subscription.id, customerId: customer.id,
      customerName: customer.name, customerEmail: customer.email, status: options.status ?? 'CONFIRMED',
      periodStart: new Date(Date.UTC(2026, 0, sequence)), periodEnd: new Date(Date.UTC(2026, 0, sequence + 1)),
      issuedAt: new Date(options.issuedAt ?? '2026-10-10T12:00:00Z'), dueDate: new Date(options.dueDate ?? '2026-10-20T00:00:00Z'),
      subtotalMinor: 10000, discountMinor: 1000, taxMinor: 1620, totalMinor: 10620,
      payments: { create: (options.payments ?? []).map(amountMinor => ({ amountMinor, method: 'CASH', paidAt: new Date('2026-11-10T00:00:00Z') })) },
    } });
  }
  const partial = await invoice({ payments: [1000, 2000] });
  await invoice({ status: 'PAID', payments: [10620] });
  await invoice({ dueDate: '2026-12-01T00:00:00Z' });
  await invoice({ status: 'DRAFT', payments: [999] });
  await invoice({ status: 'CANCELLED', payments: [999] });
  await t.test('net revenue excludes tax and drafts/cancellations; multiple payments never duplicate revenue', async () => {
    const result = await dashboardSummary({}, now);
    assert.equal(result.activeSubscriptions, 1);
    assert.equal(result.invoiceCount, 3);
    assert.equal(result.invoicedRevenueMinor, 27000);
    assert.equal(result.collectedMinor, 13620);
    assert.equal(result.outstandingMinor, 18240);
    assert.equal(result.overdueMinor, 7620);
    assert.equal(result.overdueInvoices, 1);
    const list = await overdueInvoices(overdueQuerySchema.parse({}), now);
    assert.equal(list.total, 1); assert.equal(list.items[0].id, partial.id);
    assert.equal(list.items[0].paidMinor, 3000); assert.equal(list.items[0].outstandingMinor, 7620);
    assert.equal(list.items[0].dueDate, '2026-10-20T00:00:00.000Z');
  });
  await t.test('issued calendar days use Kolkata boundaries and status filters retain invoice-cohort payments', async () => {
    await invoice({ issuedAt: '2026-10-09T18:29:59.999Z' });
    await invoice({ issuedAt: '2026-10-09T18:30:00Z' });
    await invoice({ issuedAt: '2026-10-10T18:29:59.999Z' });
    await invoice({ issuedAt: '2026-10-10T18:30:00Z' });
    const summary = await (await get('summary?from=2026-10-10&to=2026-10-10')).json();
    assert.equal(summary.data.invoiceCount, 5);
    assert.equal(summary.data.collectedMinor, 13620, 'Payments outside issue-date range are still included');
    const paid = await (await get('summary?status=PAID')).json();
    assert.equal(paid.data.invoiceCount, 1); assert.equal(paid.data.outstandingMinor, 0);
    assert.equal(paid.data.activeSubscriptions, 1, 'Current active count is independent of invoice filters');
    const none = await (await get('summary?from=2028-01-01')).json();
    assert.equal(none.data.invoiceCount, 0); assert.equal(none.data.activeSubscriptions, 1);
  });
  await t.test('overdue means positive balance strictly before now, with stable database pagination', async () => {
    await invoice({ dueDate: now.toISOString() });
    await invoice({ payments: [11000] }); // Defensive clamp for pre-existing inconsistent data.
    const result = await dashboardSummary({}, now);
    assert.equal(result.overdueInvoices, 5);
    const first = await overdueInvoices(overdueQuerySchema.parse({ pageSize: 2 }), now);
    const second = await overdueInvoices(overdueQuerySchema.parse({ pageSize: 2, page: 2 }), now);
    assert.equal(first.total, 5); assert.equal(first.items.length, 2);
    assert.ok(first.items.every(item => second.items.every(other => item.id !== other.id)));
    assert.equal((await overdueInvoices(overdueQuerySchema.parse({ page: 100 }), now)).items.length, 0);
  });
  await t.test('invalid calendar dates, statuses, ranges, duplicates and excessive pages are rejected', async () => {
    for (const query of ['from=2026-02-30', 'from=2026-02-01&to=2025-01-01', 'status=DRAFT', 'status=CANCELLED', 'from=garbage', 'from=2026-01-01&from=2026-02-01', 'extra=x']) {
      assert.equal((await get(`summary?${query}`)).status, 400, query);
    }
    for (const query of ['page=0', 'pageSize=101', 'page=100001', 'page=1.5']) assert.equal((await get(`overdue?${query}`)).status, 400);
  });
  await t.test('thousands of subscriptions/invoices use indexed aggregation and bounded pages', async () => {
    const n = 3000;
    await db.subscription.createMany({ data: Array.from({ length: n }, (_, i) => ({
      id: `perf-sub-${i}`, number: `SUB-PERF-${i}`, customerId: customer.id, planId: plan.id,
      status: 'ACTIVE' as const, startDate: now, billingInterval: 'MONTHLY' as const,
    })) });
    for (let offset = 0; offset < n * 2; offset += 500) {
      const data = Array.from({ length: 500 }, (_, index) => {
        const i = offset + index;
        return { id: `perf-invoice-${i}`, number: `INV-PERF-${i}`, subscriptionId: `perf-sub-${i % n}`, customerId: customer.id,
          customerName: 'Performance buyer', customerEmail: 'performance@example.test', status: 'CONFIRMED' as const,
          periodStart: new Date(i < n ? '2026-01-01' : '2026-02-01'), periodEnd: new Date('2026-03-01'),
          issuedAt: now, dueDate: new Date('2026-10-01'), subtotalMinor: 10000, totalMinor: 11800, taxMinor: 1800 };
      });
      await db.invoice.createMany({ data });
      await db.payment.createMany({ data: data.map(row => ({ invoiceId: row.id, method: 'CASH', amountMinor: 1800, paidAt: now })) });
    }
    const timings: number[] = [];
    for (let i = 0; i < 6; i++) {
      const start = performance.now();
      const summary = await get('summary?from=2026-10-31&to=2026-10-31&status=CONFIRMED');
      assert.equal(summary.status, 200);
      const { data } = await summary.json();
      assert.equal(data.invoiceCount, 6000); assert.equal(data.invoicedRevenueMinor, 60000000);
      assert.equal(data.collectedMinor, 10800000); assert.equal(data.activeSubscriptions, 3001);
      const list = await get('overdue?page=20&pageSize=20&status=CONFIRMED');
      assert.equal(list.status, 200); assert.equal((await list.json()).data.items.length, 20);
      timings.push(performance.now() - start);
    }
    const planRows = await db.$queryRaw<{ detail: string }[]>`EXPLAIN QUERY PLAN SELECT i.id, (SELECT SUM(p.amountMinor) FROM Payment p WHERE p.invoiceId=i.id) FROM Invoice i WHERE i.status='CONFIRMED' AND i.issuedAt >= ${now}`;
    assert.match(planRows.map(row => row.detail).join(' '), /Invoice_status_issuedAt_idx/);
    assert.match(planRows.map(row => row.detail).join(' '), /Payment_invoiceId_idx/);
    t.diagnostic(`Dashboard benchmark: 3002 subscriptions, ${await db.invoice.count()} invoices, ${await db.payment.count()} payments; 6 HTTP summary+page pairs in ms: ${timings.map(value => value.toFixed(1)).join(', ')}; max=${Math.max(...timings).toFixed(1)}ms. Includes auth/API/JSON, excludes browser rendering.`);
    assert.ok(Math.max(...timings) < 2000, 'Summary plus paginated overdue API should complete within two seconds on this test machine');
  });
});
