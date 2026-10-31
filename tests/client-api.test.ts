import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, SESSION_EXPIRED_EVENT } from '../client/src/lib/api.js';

test('client API reports errors and signals expired protected sessions', async t => {
  const originalFetch = globalThis.fetch;
  const events = new EventTarget();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  });

  await t.test('preserves Headers objects and sends same-origin credentials with JSON', async () => {
    globalThis.fetch = async (input, options) => {
      assert.equal(input, '/api/auth/login');
      assert.equal(options?.credentials, 'same-origin');
      assert.equal(new Headers(options?.headers).get('X-Request-Id'), 'test');
      assert.equal(new Headers(options?.headers).get('Content-Type'), 'application/json');
      return new Response(JSON.stringify({ data: { success: true } }), { status: 200 });
    };
    assert.deepEqual(await api('/auth/login', { method: 'POST', body: '{}', headers: new Headers({ 'X-Request-Id': 'test' }) }), { success: true });
  });
  await t.test('only a protected API 401 emits a session-expiry event', async () => {
    let expired = 0;
    events.addEventListener(SESSION_EXPIRED_EVENT, () => { expired++; });
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in' } }), { status: 401 });
    await assert.rejects(api('/subscriptions'), (error: unknown) => error instanceof ApiError && error.status === 401);
    assert.equal(expired, 1);
    await assert.rejects(api('/auth/login'));
    await assert.rejects(api('/auth/me'));
    assert.equal(expired, 1);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'No access' } }), { status: 403 });
    await assert.rejects(api('/staff'));
    assert.equal(expired, 1);
  });
  await t.test('network failures get a useful message while cancellations remain cancellations', async () => {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(api('/auth/me'), (error: unknown) => error instanceof ApiError && error.code === 'NETWORK_ERROR');
    const controller = new AbortController(); controller.abort();
    const aborted = new DOMException('Aborted', 'AbortError');
    globalThis.fetch = async () => { throw aborted; };
    await assert.rejects(api('/auth/me', { signal: controller.signal }), error => error === aborted);
  });
  await t.test('invalid and missing JSON envelopes are rejected clearly', async () => {
    for (const body of ['<html>Unavailable</html>', 'null', '{}']) {
      globalThis.fetch = async () => new Response(body, { status: 200 });
      await assert.rejects(api('/auth/me'), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RESPONSE');
    }
  });
});
