import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';

test('starter boots with an isolated database and exposes no unfinished features', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'brightloop-test-'));
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replaceAll('\\', '/')}`;
  writeFileSync(path.join(directory, 'test.db'), '');
  process.env.NODE_ENV = 'test';
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env, stdio: 'pipe',
  });
  const { app } = await import('../server/src/app.js');
  const { db } = await import('../server/src/lib/db.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  try {
    await t.test('health checks a real database', async () => {
      const response = await fetch(`${base}/health`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.data.database, 'connected');
      assert.ok(!Number.isNaN(Date.parse(body.data.time)));
    });
    await t.test('business modules and auth fail closed', async () => {
      for (const route of ['/auth/login', '/catalog/products', '/subscriptions', '/billing/invoices', '/staff', '/dashboard/summary', '/portal/invoices']) {
        const response = await fetch(`${base}${route}`);
        assert.equal(response.status, 501, route);
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
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.$disconnect();
    // Nonrecursive cleanup restricted to the verified temporary test directory.
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
    for (const filename of readdirSync(directory)) unlinkSync(path.join(directory, filename));
    rmdirSync(directory);
  }
});
