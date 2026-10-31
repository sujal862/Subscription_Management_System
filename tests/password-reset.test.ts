import test from 'node:test';
import assert from 'node:assert/strict';
import { testServer } from './helpers/test-server.js';
import { outboxMessages, tokenFromEmail, resetLink } from './helpers/outbox.js';

test('password recovery email, single-use tokens and session revocation', async t => {
  const { db, base } = await testServer(t);
  const { waitForPasswordResetDeliveries, hashResetToken, RESET_REQUEST_MESSAGE } = await import('../server/src/modules/auth/password-reset.js');
  const { config } = await import('../server/src/lib/config.js');
  const password = 'OriginalPass!2026'; const nextPassword = 'NewPassword!2026';
  const post = (route: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const signup = async (email: string) => {
    const response = await post('/auth/signup', { name: 'Reset Customer', email, password });
    assert.equal(response.status, 201);
    return { user: (await response.json()).data, cookie: response.headers.get('set-cookie')!.split(';')[0] };
  };
  const alice = await signup('alice@reset.test'); const bob = await signup('bob@reset.test');
  let initialToken = ''; let currentToken = '';
  async function issue(email = alice.user.email) {
    // Age the resend throttle in the isolated DB so tests need no clock delays.
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await db.passwordResetToken.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 61000) } });
    const before = new Set(outboxMessages().map(message => message.filename));
    const response = await post('/auth/forgot-password', { email }, { Host: 'untrusted.example' });
    assert.equal(response.status, 200); await waitForPasswordResetDeliveries();
    const messages = outboxMessages().filter(message => !before.has(message.filename));
    assert.equal(messages.length, 1);
    return { token: tokenFromEmail(messages[0].body), message: messages[0] };
  }
  await t.test('known, missing and disabled accounts receive identical generic responses', async () => {
    const disabled = await signup('disabled@reset.test');
    await db.user.update({ where: { id: disabled.user.id }, data: { isActive: false } });
    const bodies = [];
    for (const email of [' ALICE@RESET.TEST ', 'missing@reset.test', 'disabled@reset.test']) {
      const response = await post('/auth/forgot-password', { email });
      assert.equal(response.status, 200); bodies.push(await response.json());
    }
    assert.deepEqual(bodies[0], { data: { message: RESET_REQUEST_MESSAGE } });
    assert.deepEqual(bodies[0], bodies[1]); assert.deepEqual(bodies[0], bodies[2]);
    await waitForPasswordResetDeliveries();
    const messages = outboxMessages(); assert.equal(messages.length, 1);
    assert.ok(messages[0].raw.includes('alice@reset.test'));
    initialToken = tokenFromEmail(messages[0].body);
    const record = await db.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: hashResetToken(initialToken) } });
    assert.ok(record.tokenHash !== initialToken);
    assert.ok(record.expiresAt.getTime() > Date.now() + 29 * 60000);
    assert.ok(!JSON.stringify(bodies).includes(initialToken));
    assert.equal((await fetch(`${base}/auth/me`, { headers: { Cookie: alice.cookie } })).status, 200, 'Requesting a link does not log out sessions');
  });
  await t.test('resend cooldown prevents email flooding; a later resend replaces the previous token', async () => {
    const before = outboxMessages().length;
    assert.equal((await post('/auth/forgot-password', { email: alice.user.email })).status, 200);
    await waitForPasswordResetDeliveries(); assert.equal(outboxMessages().length, before);
    const issued = await issue(); currentToken = issued.token;
    assert.ok(currentToken !== initialToken);
    assert.equal(resetLink(issued.message.body).origin, new URL(config.appUrl).origin);
    assert.equal(resetLink(issued.message.body).pathname, '/account/reset-password');
    assert.equal(resetLink(issued.message.body).search, '', 'Token belongs in the URL fragment, not server logs/query');
    assert.equal((await post('/auth/reset-password', { token: initialToken, password: nextPassword })).status, 400);
  });
  await t.test('weak passwords and extra fields are rejected without consuming the token', async () => {
    for (const weak of ['Abcdefg!', 'lowercase!2026', 'UPPERCASE!2026', 'Uppercase2026']) {
      const response = await post('/auth/reset-password', { token: currentToken, password: weak });
      assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
    }
    assert.equal((await post('/auth/reset-password', { token: currentToken, password: nextPassword, userId: bob.user.id })).status, 400);
    assert.equal(await db.passwordResetToken.count({ where: { tokenHash: hashResetToken(currentToken) } }), 1);
  });
  await t.test('expired tokens are rejected without changing credentials or sessions', async () => {
    await db.passwordResetToken.update({ where: { tokenHash: hashResetToken(currentToken) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const response = await post('/auth/reset-password', { token: currentToken, password: nextPassword });
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'INVALID_RESET_TOKEN');
    assert.equal((await fetch(`${base}/auth/me`, { headers: { Cookie: alice.cookie } })).status, 200);
  });
  await t.test('successful reset revokes every target session and leaves other accounts unchanged', async () => {
    const second = await post('/auth/login', { email: alice.user.email, password });
    const secondCookie = second.headers.get('set-cookie')!.split(';')[0];
    currentToken = (await issue()).token;
    const response = await post('/auth/reset-password', { token: currentToken, password: nextPassword });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('set-cookie')?.includes('Expires=Thu, 01 Jan 1970'));
    assert.ok(!JSON.stringify(await response.json()).includes(currentToken));
    assert.equal(await db.session.count({ where: { userId: alice.user.id } }), 0);
    assert.equal(await db.passwordResetToken.count({ where: { userId: alice.user.id } }), 0);
    for (const cookie of [alice.cookie, secondCookie]) assert.equal((await fetch(`${base}/auth/me`, { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await fetch(`${base}/auth/me`, { headers: { Cookie: bob.cookie } })).status, 200);
    assert.equal((await post('/auth/login', { email: alice.user.email, password })).status, 401);
    assert.equal((await post('/auth/login', { email: alice.user.email, password: nextPassword })).status, 200);
    assert.equal((await post('/auth/reset-password', { token: currentToken, password: 'DifferentPass!2026' })).status, 400);
  });
  await t.test('concurrent token consumption succeeds once', async () => {
    const token = (await issue()).token;
    const passwords = ['ConcurrentOne!2026', 'ConcurrentTwo!2026'];
    const responses = await Promise.all(passwords.map(password => post('/auth/reset-password', { token, password })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
    const winner = responses.findIndex(response => response.status === 200);
    assert.equal((await post('/auth/login', { email: alice.user.email, password: passwords[winner] })).status, 200);
    assert.equal(await db.passwordResetToken.count({ where: { userId: alice.user.id } }), 0);
  });
  await t.test('an account disabled after issuance cannot consume its token', async () => {
    const token = (await issue()).token;
    await db.user.update({ where: { id: alice.user.id }, data: { isActive: false } });
    assert.equal((await post('/auth/reset-password', { token, password: nextPassword })).status, 400);
    await db.user.update({ where: { id: alice.user.id }, data: { isActive: true } });
  });
  await t.test('mail failure is generic, invalidates undelivered tokens and logs no link/token', async () => {
    const saved = { mode: process.env.MAIL_MODE, host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER };
    const originalError = console.error; const logs: string[] = [];
    process.env.MAIL_MODE = 'smtp'; process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = '0'; process.env.SMTP_USER = '';
    console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
    try {
      await db.passwordResetToken.deleteMany({ where: { userId: alice.user.id } });
      const response = await post('/auth/forgot-password', { email: alice.user.email });
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { data: { message: RESET_REQUEST_MESSAGE } });
      await waitForPasswordResetDeliveries();
      assert.equal(await db.passwordResetToken.count({ where: { userId: alice.user.id } }), 0);
      assert.ok(logs.length > 0);
      assert.ok(logs.every(line => !/https?:|[a-f0-9]{64}|passwordHash/i.test(line)));
    } finally {
      console.error = originalError;
      for (const [key, value] of Object.entries({ MAIL_MODE: saved.mode, SMTP_HOST: saved.host, SMTP_PORT: saved.port, SMTP_USER: saved.user })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  await t.test('recovery endpoints validate inputs, reject cross-origin requests and rate-limit abuse', async () => {
    assert.equal((await post('/auth/forgot-password', { email: 'invalid' })).status, 400);
    assert.equal((await post('/auth/reset-password', { token: 'invalid', password: nextPassword })).status, 400);
    assert.equal((await post('/auth/forgot-password', { email: bob.user.email }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('/auth/reset-password', { token: 'f'.repeat(64), password: nextPassword }, { Origin: 'https://evil.example' })).status, 403);
    for (const route of ['/auth/forgot-password', '/auth/reset-password']) {
      let limited = false;
      for (let i = 0; i <= 30; i++) {
        const response = await post(route, route.endsWith('forgot-password') ? { email: 'missing@reset.test' } : { token: 'f'.repeat(64), password: nextPassword });
        if (response.status === 429) { limited = true; assert.equal((await response.json()).error.code, 'RATE_LIMIT'); break; }
      }
      assert.ok(limited);
    }
  });
});
