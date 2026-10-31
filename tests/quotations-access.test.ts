import test from 'node:test';
import assert from 'node:assert/strict';
import { testServer } from './helpers/test-server.js';

test('quotation management enforces real sessions and staff permissions', async t => {
  const { db, base } = await testServer(t);
  const { hashPassword } = await import('../server/src/lib/password.js');
  const password = 'QuotationTest!123';
  const passwordHash = await hashPassword(password);
  const cookies: Record<string, string> = {};
  for (const role of ['ADMIN', 'STAFF', 'CUSTOMER'] as const) {
    const email = `${role.toLowerCase()}@quotations.example`;
    await db.user.create({ data: { name: role, email, passwordHash, role } });
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie); cookies[role] = cookie;
  }
  async function request(route: string, method: string, role: string | null, body: unknown, expected: number) {
    const response = await fetch(`${base}/subscriptions${route}`, { method,
      headers: { ...(role ? { Cookie: cookies[role] } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result.data;
  }
  const customer = await db.customer.create({ data: { name: 'Buyer', email: 'buyer@quotations.example' } });
  const product = await db.product.create({ data: { name: 'Workspace', salesPriceMinor: 10000 } });
  const plan = await db.plan.create({ data: { name: 'Monthly', productId: product.id, priceMinor: 5000, interval: 'MONTHLY' } });
  const templateInput = { name: 'Monthly offer', planId: plan.id, validDays: 14, paymentTermDays: 7, lines: [{ productId: product.id, quantity: 1 }] };
  await t.test('anonymous and customer users cannot access template management', async () => {
    await request('/templates', 'GET', null, undefined, 401);
    await request('/templates', 'POST', null, templateInput, 401);
    await request('/templates', 'GET', 'CUSTOMER', undefined, 403);
    await request('/templates', 'POST', 'CUSTOMER', templateInput, 403);
  });
  const template = await request('/templates', 'POST', 'STAFF', templateInput, 201);
  await t.test('staff create/edit and administrators read templates through production app', async () => {
    assert.equal((await request(`/templates/${template.id}`, 'GET', 'ADMIN', undefined, 200)).name, templateInput.name);
    await request(`/templates/${template.id}`, 'PATCH', 'STAFF', { name: 'Revised offer' }, 200);
    await request(`/templates/${template.id}`, 'PATCH', 'CUSTOMER', { name: 'Forbidden' }, 403);
    await request(`/templates/${template.id}`, 'DELETE', 'CUSTOMER', undefined, 403);
  });
  await t.test('staff can create quotations; customers cannot create or transition staff records', async () => {
    const input = { templateId: template.id, customerId: customer.id, startDate: '2026-11-01' };
    await request('', 'POST', 'CUSTOMER', input, 403);
    const quotation = await request('', 'POST', 'STAFF', input, 201);
    assert.equal(quotation.status, 'QUOTATION'); assert.equal(quotation.totalMinor, 5000);
    await request(`/${quotation.id}`, 'GET', 'CUSTOMER', undefined, 403);
    const draft = await request('', 'POST', 'ADMIN', { customerId: customer.id, planId: plan.id, startDate: '2026-11-01', lines: [{ productId: product.id, quantity: 1 }] }, 201);
    await request(`/${draft.id}/transition`, 'POST', null, { action: 'QUOTATION' }, 401);
    await request(`/${draft.id}/transition`, 'POST', 'CUSTOMER', { action: 'QUOTATION' }, 403);
    const converted = await request(`/${draft.id}/transition`, 'POST', 'STAFF', { action: 'QUOTATION' }, 200);
    assert.equal(converted.status, 'QUOTATION');
  });
  await request(`/templates/${template.id}`, 'DELETE', 'ADMIN', undefined, 200);
});
