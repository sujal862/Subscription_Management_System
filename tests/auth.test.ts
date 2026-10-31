import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { testServer } from './helpers/test-server.js';

test('Hour 1 identity, session and access boundaries', async t => {
  const { app, db, base } = await testServer(t);
  const { hashSessionToken } = await import('../server/src/modules/auth/session.js');
  const { hashPassword } = await import('../server/src/lib/password.js');
  const { config } = await import('../server/src/lib/config.js');
  const password = 'StrongPass!2026';
  const signup = { name: 'Team Member', email: 'member@example.com', password };
  const post = (route: string, body?: unknown, extraHeaders: Record<string, string> = {}) => fetch(`${base}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const get = (route: string, cookie?: string) => fetch(`${base}${route}`, { headers: cookie ? { Cookie: cookie } : {} });
  const cookieFrom = (response: Response) => {
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'Expected a session cookie');
    return cookie;
  };
  let cookie = '';
  let userId = '';

  await t.test('signup validates every required field and exact password rules', async () => {
    for (const invalid of [
      { ...signup, name: ' ' }, { ...signup, email: 'invalid' },
      { ...signup, password: 'Abcdefg!' }, // eight characters is insufficient
      { ...signup, password: 'lowercase!2026' }, { ...signup, password: 'UPPERCASE!2026' },
      { ...signup, password: 'Uppercase2026' }, { ...signup, password: 'Uppercase 2026' },
      { ...signup, password: `Aa!${'x'.repeat(126)}` },
      { ...signup, role: 'ADMIN' }, { ...signup, customerId: 'someone-else' },
    ]) {
      const response = await post('/auth/signup', invalid);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
      assert.equal(response.headers.get('set-cookie'), null);
    }
    assert.equal(await db.user.count(), 0);
    assert.equal(await db.customer.count(), 0);
  });

  await t.test('signup creates a normalized customer identity and hashed persistent session', async () => {
    const response = await post('/auth/signup', { ...signup, name: '  Team Member  ', email: '  MEMBER@Example.com  ' });
    assert.equal(response.status, 201);
    const { data } = await response.json();
    assert.deepEqual(Object.keys(data).sort(), ['customerId', 'email', 'id', 'name', 'role']);
    assert.equal(data.email, signup.email);
    assert.equal(data.name, signup.name);
    assert.equal(data.role, 'CUSTOMER');
    assert.ok(data.customerId);
    userId = data.id;
    cookie = cookieFrom(response);
    const header = response.headers.get('set-cookie')!;
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Lax/i);
    assert.match(header, /Path=\//i);
    assert.match(header, /Max-Age=604800/i);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const raw = cookie.split('=')[1];
    const stored = await db.session.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(raw) } });
    assert.notEqual(stored.tokenHash, raw);
    assert.equal(stored.userId, data.id);
    assert.ok(stored.expiresAt.getTime() > Date.now() + 6 * 24 * 60 * 60 * 1000);
    const user = await db.user.findUniqueOrThrow({ where: { id: data.id } });
    assert.notEqual(user.passwordHash, password);
    assert.match(user.passwordHash, /^scrypt\$/);
    const customer = await db.customer.findUniqueOrThrow({ where: { id: data.customerId } });
    assert.equal(customer.email, signup.email);
  });

  await t.test('nine-character password is accepted and identical passwords receive different salts', async () => {
    const boundary = await post('/auth/signup', { ...signup, email: 'boundary@example.com', password: 'Abcdefgh!' });
    assert.equal(boundary.status, 201);
    const another = await post('/auth/signup', { ...signup, email: 'another@example.com' });
    assert.equal(another.status, 201);
    const users = await db.user.findMany({ where: { email: { in: [signup.email, 'another@example.com'] } } });
    assert.notEqual(users[0].passwordHash, users[1].passwordHash);
  });

  await t.test('duplicate emails cannot create partial user, customer or session records', async () => {
    const counts = [await db.user.count(), await db.customer.count(), await db.session.count()];
    const response = await post('/auth/signup', { ...signup, email: 'MEMBER@EXAMPLE.COM' });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'EMAIL_IN_USE');
    assert.deepEqual([await db.user.count(), await db.customer.count(), await db.session.count()], counts);
    await db.user.create({ data: { name: 'Unlinked User', email: 'unlinked@example.com', passwordHash: await hashPassword(password) } });
    const conflict = await post('/auth/signup', { ...signup, email: 'unlinked@example.com' });
    assert.equal(conflict.status, 409);
    assert.equal(await db.customer.count({ where: { email: 'unlinked@example.com' } }), 0);
  });

  await t.test('signup cannot claim an existing customer account by email', async () => {
    const existing = await db.customer.create({ data: { name: 'Existing Customer', email: 'existing@example.com' } });
    const response = await post('/auth/signup', { ...signup, email: existing.email });
    assert.equal(response.status, 409);
    assert.equal(await db.user.count({ where: { email: existing.email } }), 0);
    const unchanged = await db.customer.findUniqueOrThrow({ where: { id: existing.id }, include: { user: true } });
    assert.equal(unchanged.user, null);
    assert.equal(unchanged.name, 'Existing Customer');
  });

  await t.test('simultaneous signup for one email creates exactly one identity', async () => {
    const responses = await Promise.all([post('/auth/signup', { ...signup, email: 'race@example.com' }), post('/auth/signup', { ...signup, email: 'race@example.com' })]);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    assert.equal(await db.user.count({ where: { email: 'race@example.com' } }), 1);
    assert.equal(await db.customer.count({ where: { email: 'race@example.com' } }), 1);
  });

  await t.test('me exposes only public identity fields and rejects forged cookies', async () => {
    const response = await get('/auth/me', cookie);
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.id, userId);
    assert.deepEqual(Object.keys(data).sort(), ['customerId', 'email', 'id', 'name', 'role']);
    for (const invalid of [undefined, 'brightloop_session=bad', `brightloop_session=${'a'.repeat(64)}`, 'brightloop_session=j:%7B%22role%22%3A%22ADMIN%22%7D']) {
      assert.equal((await get('/auth/me', invalid)).status, 401);
    }
  });

  await t.test('login normalizes email, uses generic failures and never reuses an incoming token', async () => {
    const wrong = await post('/auth/login', { email: signup.email, password: 'WrongPassword!' });
    const absent = await post('/auth/login', { email: 'absent@example.com', password });
    assert.equal(wrong.status, 401);
    assert.equal(absent.status, 401);
    assert.deepEqual(await wrong.json(), await absent.json());
    assert.equal(wrong.headers.get('set-cookie'), null);
    const response = await post('/auth/login', { email: ' MEMBER@EXAMPLE.COM ', password }, { Cookie: cookie });
    assert.equal(response.status, 200);
    assert.notEqual(cookieFrom(response), cookie);
    assert.equal((await response.json()).data.id, userId);
  });

  await t.test('logout revokes only the current session, clears the cookie and is idempotent', async () => {
    const response = await post('/auth/login', { email: signup.email, password });
    const currentCookie = cookieFrom(response);
    const logout = await post('/auth/logout', undefined, { Cookie: currentCookie });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/i);
    assert.equal((await get('/auth/me', currentCookie)).status, 401);
    assert.equal((await get('/auth/me', cookie)).status, 200);
    assert.equal((await post('/auth/logout')).status, 200);
  });

  await t.test('expired sessions and disabled accounts are rejected', async () => {
    const login = await post('/auth/login', { email: signup.email, password });
    const expiring = cookieFrom(login);
    await db.session.update({ where: { tokenHash: hashSessionToken(expiring.split('=')[1]) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await get('/auth/me', expiring)).status, 401);
    await db.user.update({ where: { id: userId }, data: { isActive: false } });
    try {
      assert.equal((await get('/auth/me', cookie)).status, 401);
      assert.equal((await post('/auth/login', { email: signup.email, password })).status, 401);
    } finally { await db.user.update({ where: { id: userId }, data: { isActive: true } }); }
  });

  await t.test('role middleware separates customers, staff and admin without implementing their features', async () => {
    for (const role of ['STAFF', 'ADMIN'] as const) {
      const email = `${role.toLowerCase()}@example.com`;
      await db.user.create({ data: { name: role, email, role, passwordHash: await hashPassword(password) } });
      const login = await post('/auth/login', { email, password });
      const roleCookie = cookieFrom(login);
      assert.equal((await get('/staff', roleCookie)).status, role === 'ADMIN' ? 501 : 403);
      assert.equal((await get('/catalog/products', roleCookie)).status, 501);
      assert.equal((await get('/billing/invoices', roleCookie)).status, 501);
      assert.equal((await get('/portal/invoices', roleCookie)).status, 403);
      if (role === 'ADMIN') {
        await db.user.update({ where: { email }, data: { role: 'STAFF' } });
        assert.equal((await get('/staff', roleCookie)).status, 403, 'Role changes apply to existing sessions');
      }
    }
    assert.equal((await get('/staff', cookie)).status, 403);
    assert.equal((await get('/catalog/products', cookie)).status, 403);
    assert.equal((await get('/billing/invoices', cookie)).status, 403);
    assert.equal((await get('/portal/subscriptions', cookie)).status, 501);
  });

  await t.test('unsafe browser origins cannot sign up, log in or log out', async () => {
    for (const Origin of ['https://evil.example', 'null']) {
      assert.equal((await post('/auth/signup', { ...signup, email: 'blocked@example.com' }, { Origin })).status, 403);
      assert.equal((await post('/auth/login', { email: signup.email, password }, { Origin })).status, 403);
      assert.equal((await post('/auth/logout', undefined, { Origin, Cookie: cookie })).status, 403);
    }
    assert.equal((await post('/auth/logout', undefined, { 'Sec-Fetch-Site': 'cross-site', Cookie: cookie })).status, 403);
    assert.equal((await get('/auth/me', cookie)).status, 200);
    assert.equal(await db.user.count({ where: { email: 'blocked@example.com' } }), 0);
    const allowed = await post('/auth/login', { email: signup.email, password }, { Origin: config.allowedOrigins[0] });
    assert.equal(allowed.status, 200);
  });

  await t.test('production session cookies carry Secure', async () => {
    const previous = config.production;
    config.production = true;
    try {
      const response = await post('/auth/login', { email: signup.email, password });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('set-cookie')!, /; Secure/i);
    } finally { config.production = previous; }
  });

  await t.test('sessions persist across separate HTTP listeners', async () => {
    const second = app.listen(0, '127.0.0.1');
    await once(second, 'listening');
    const address = second.address();
    assert.ok(address && typeof address !== 'string');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data.id, userId);
    } finally {
      second.closeAllConnections();
      await new Promise<void>(resolve => second.close(() => resolve()));
    }
  });

  await t.test('oversized bodies and unknown login fields are rejected', async () => {
    const oversized = await post('/auth/signup', { ...signup, name: 'x'.repeat(110000) });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, 'PAYLOAD_TOO_LARGE');
    const extra = await post('/auth/login', { email: signup.email, password, role: 'ADMIN' });
    assert.equal(extra.status, 400);
  });

  await t.test('login attempts are rate-limited with structured errors', async () => {
    let blocked = false;
    for (let i = 0; i <= 30; i++) {
      const response = await post('/auth/login', {});
      if (response.status === 429) {
        assert.equal((await response.json()).error.code, 'RATE_LIMIT');
        assert.ok(response.headers.get('ratelimit'));
        blocked = true;
        break;
      }
      assert.equal(response.status, 400);
    }
    assert.ok(blocked);
  });
});
