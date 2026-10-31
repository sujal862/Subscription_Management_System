import test from 'node:test';
import assert from 'node:assert/strict';
import { testServer } from './helpers/test-server.js';

test('foundation API and unfinished modules remain explicit', async t => {
  const { base } = await testServer(t);
  await t.test('health checks a real database', async () => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.database, 'connected');
    assert.ok(!Number.isNaN(Date.parse(body.data.time)));
  });
  await t.test('business APIs now require a session', async () => {
    for (const route of ['/catalog/products', '/subscriptions', '/billing/invoices', '/staff', '/dashboard/summary', '/portal/invoices']) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 401, route);
      assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
    }
  });
  await t.test('password reset stays unimplemented until Hour 4', async () => {
    for (const route of ['/auth/forgot-password', '/auth/reset-password']) {
      const response = await fetch(`${base}${route}`, { method: 'POST' });
      assert.equal(response.status, 501);
      assert.equal((await response.json()).error.code, 'NOT_IMPLEMENTED');
    }
  });
  await t.test('unknown API is a structured 404', async () => {
    const response = await fetch(`${base}/unknown`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  });
  await t.test('invalid JSON is a structured validation error', async () => {
    const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_JSON');
  });
});
