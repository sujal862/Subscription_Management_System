import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { testServer } from './helpers/test-server.js';

test('staff administration and integrated role boundaries', async t => {
  const { db, base } = await testServer(t);
  const { hashPassword, verifyPassword } = await import('../server/src/lib/password.js');
  const password = 'StaffAccess!2026';
  const passwordHash = await hashPassword(password);
  await db.user.create({ data: { name: 'Admin', email: 'admin@staff.test', passwordHash, role: 'ADMIN' } });
  const call = (route: string, method = 'GET', body?: unknown, cookie?: string) => fetch(`${base}${route}`, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const login = async (email: string) => {
    const response = await call('/auth/login', 'POST', { email, password });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  const adminCookie = await login('admin@staff.test');
  const customerSignup = await call('/auth/signup', 'POST', { name: 'Customer', email: 'customer@staff.test', password });
  const customerCookie = customerSignup.headers.get('set-cookie')!.split(';')[0];
  let staffCookie = '';
  await t.test('only admin creates staff; password and session data are never returned', async () => {
    const input = { name: '  Day Staff  ', email: ' STAFF@STAFF.TEST ', password };
    assert.equal((await call('/staff', 'POST', input)).status, 401);
    assert.equal((await call('/staff', 'POST', input, customerCookie)).status, 403);
    const response = await call('/staff', 'POST', input, adminCookie);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('set-cookie'), null, 'Creating staff must not replace the admin session');
    const { data } = await response.json();
    assert.deepEqual(Object.keys(data).sort(), ['customerId', 'email', 'id', 'name', 'role']);
    assert.equal(data.role, 'STAFF'); assert.equal(data.customerId, null);
    assert.equal(data.email, 'staff@staff.test'); assert.equal(data.name, 'Day Staff');
    const stored = await db.user.findUniqueOrThrow({ where: { id: data.id } });
    assert.ok(await verifyPassword(password, stored.passwordHash));
    staffCookie = await login(data.email);
  });
  await t.test('staff cannot create staff/admin and customers cannot read staff APIs', async () => {
    for (const role of [undefined, 'STAFF', 'ADMIN']) {
      const input = { name: 'Forbidden', email: 'forbidden@staff.test', password, ...(role ? { role } : {}) };
      assert.equal((await call('/staff', 'POST', input, staffCookie)).status, 403);
      assert.equal((await call('/staff', 'POST', input, customerCookie)).status, 403);
    }
    assert.equal((await call('/staff', 'GET', undefined, staffCookie)).status, 403);
    assert.equal((await call('/staff', 'GET', undefined, customerCookie)).status, 403);
    assert.equal(await db.user.count({ where: { email: 'forbidden@staff.test' } }), 0);
    for (const role of ['STAFF', 'ADMIN']) {
      assert.equal((await call('/auth/signup', 'POST', { name: 'Injected', email: 'inject@staff.test', password, role })).status, 400);
      assert.equal((await call('/staff', 'POST', { name: 'Injected', email: 'inject@staff.test', password, role }, adminCookie)).status, 400);
    }
  });
  await t.test('staff list is paginated, searchable and excludes admins/customers', async () => {
    const response = await call('/staff?page=1&pageSize=1&search=staff', 'GET', undefined, adminCookie);
    assert.equal(response.status, 200); const { data } = await response.json();
    assert.equal(data.total, 1); assert.equal(data.items.length, 1);
    assert.equal(data.items[0].role, 'STAFF'); assert.equal(data.items[0].passwordHash, undefined);
    assert.equal((await call('/staff?pageSize=101', 'GET', undefined, adminCookie)).status, 400);
  });
  await t.test('duplicate and invalid staff inputs produce safe errors without partial records', async () => {
    const response = await call('/staff', 'POST', { name: 'Duplicate', email: 'STAFF@STAFF.TEST', password }, adminCookie);
    assert.equal(response.status, 409); const error = await response.json();
    assert.equal(error.error.code, 'EMAIL_IN_USE');
    assert.ok(!/Prisma|passwordHash|stack|INSERT|SELECT/.test(JSON.stringify(error)));
    for (const body of [{ name: ' ', email: 'invalid@staff.test', password }, { name: 'Valid', email: 'bad', password }, { name: 'Valid', email: 'invalid@staff.test', password: 'short' }]) {
      assert.equal((await call('/staff', 'POST', body, adminCookie)).status, 400);
    }
    assert.equal(await db.user.count({ where: { role: 'STAFF' } }), 1);
  });
  await t.test('staff can operate sales/billing but cannot mutate catalog; customers stay in portal', async () => {
    assert.equal((await call('/catalog/products', 'GET', undefined, staffCookie)).status, 200);
    assert.equal((await call('/catalog/products', 'POST', { name: 'Forbidden Product', salesPriceMinor: 1000 }, staffCookie)).status, 403);
    assert.equal((await call('/subscriptions/customers', 'POST', { name: 'Operational Customer', email: 'operations@staff.test' }, staffCookie)).status, 201);
    assert.equal((await call('/billing/invoices', 'GET', undefined, staffCookie)).status, 200);
    for (const route of ['/subscriptions/customers', '/billing/invoices', '/catalog/products']) {
      assert.equal((await call(route, 'GET', undefined, customerCookie)).status, 403);
    }
    assert.equal((await call('/portal/invoices', 'GET', undefined, staffCookie)).status, 403);
    const customer = await db.user.findUniqueOrThrow({ where: { email: 'customer@staff.test' } });
    assert.equal((await call('/portal/subscriptions?customerId=someone-else', 'GET', undefined, customerCookie)).status, 400);
    await db.user.update({ where: { id: customer.id }, data: { customerId: null } });
    assert.equal((await call('/portal/subscriptions', 'GET', undefined, customerCookie)).status, 403);
  });
  await t.test('explicit local admin bootstrap does not overwrite or promote an existing account', async () => {
    const env = { ...process.env, ADMIN_NAME: 'Bootstrap Admin', ADMIN_EMAIL: 'bootstrap@staff.test', ADMIN_PASSWORD: password };
    const result = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/create-admin.ts'], { env, encoding: 'utf8' });
    assert.ok(!result.includes(password));
    assert.equal((await db.user.findUniqueOrThrow({ where: { email: 'bootstrap@staff.test' } })).role, 'ADMIN');
    assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/create-admin.ts'], {
      env: { ...env, ADMIN_EMAIL: 'staff@staff.test' }, stdio: 'pipe',
    }));
    assert.equal((await db.user.findUniqueOrThrow({ where: { email: 'staff@staff.test' } })).role, 'STAFF');
  });
});
