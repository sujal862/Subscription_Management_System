import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { testServer } from './helpers/test-server.js';
import { createLifecycleFixture } from './fixtures/subscriptions.js';
import type { Detail } from '../client/src/features/subscriptions/types.js';

test('lifecycle UI performs real authenticated transitions and renewal', async t => {
  const { db, base } = await testServer(t);
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173/subscriptions' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ React, window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window) })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const originalFetch = globalThis.fetch;
  const { hashPassword } = await import('../server/src/lib/password.js');
  const password = randomBytes(18).toString('hex') + '!Aa'; const email = 'lifecycle-ui@example.test';
  await db.user.create({ data: { name: 'UI Staff', email, passwordHash: await hashPassword(password), role: 'STAFF' } });
  const login = await originalFetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')!.split(';')[0];
  globalThis.fetch = async (input, options) => {
    const requestPath = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const headers = new Headers(options?.headers); headers.set('Cookie', cookie); headers.set('Origin', 'http://localhost:5173');
    return originalFetch(`${base}${requestPath.replace(/^\/api/, '')}`, { ...options, headers });
  };
  const ui = await import('@testing-library/react');
  const { LifecycleActions } = await import('../client/src/features/subscriptions/LifecycleActions.js');
  t.after(() => {
    ui.cleanup(); globalThis.fetch = originalFetch; dom.window.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  });
  const now = new Date(); const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const later = (days: number) => new Date(day.getTime() + days * 86400000);
  const fixture = await createLifecycleFixture(db, { status: 'QUOTATION', interval: 'DAILY', startDate: later(-1), expiryDate: later(20), quotationValidUntil: later(5) });
  const response = await originalFetch(`${base}/subscriptions/${fixture.subscription.id}`, { headers: { Cookie: cookie } });
  const initial = (await response.json()).data as Detail;
  let lastSaved: Detail = initial;
  function Harness() {
    const [detail, setDetail] = React.useState(initial);
    return <LifecycleActions detail={detail} onSaved={value => { lastSaved = value; setDetail(value); }} />;
  }
  ui.render(<Harness />);
  const click = (name: string) => ui.fireEvent.click(ui.screen.getByRole('button', { name }));
  const status = (value: string) => ui.waitFor(() => assert.ok(ui.screen.getByText(value, { selector: 'dd', exact: true })));
  await t.test('confirm and activate buttons persist server-validated state', async () => {
    click('Confirm quotation'); await status('CONFIRMED'); click('Activate subscription'); await status('ACTIVE');
    assert.equal(lastSaved.billingAnchorDay, later(-1).getUTCDate()); assert.equal(await db.invoice.count(), 0);
  });
  const { runBillingCycle } = await import('../server/src/modules/billing/recurring.js');
  await t.test('pending billing error is visible; pause succeeds after billing catches up', async () => {
    click('Pause'); const alert = await ui.screen.findByRole('alert'); assert.match(alert.textContent ?? '', /Run billing/);
    await runBillingCycle({ subscriptionId: fixture.subscription.id });
    click('Pause'); await status('PAUSED'); assert.ok(ui.screen.getByText(/Billing is stopped/));
    click('Resume'); await status('ACTIVE'); assert.equal(lastSaved.nextBillingDate, day.toISOString());
  });
  await t.test('closure asks for confirmation and retains old invoices', async () => {
    await runBillingCycle({ subscriptionId: fixture.subscription.id });
    const count = await db.invoice.count({ where: { subscriptionId: fixture.subscription.id } });
    click('Close subscription'); assert.ok(ui.screen.getByText(/Future billing will stop/)); click('Cancel');
    assert.equal(ui.screen.queryByRole('button', { name: 'Confirm closure' }), null);
    click('Close subscription'); click('Confirm closure'); await status('CLOSED');
    assert.equal(await db.invoice.count({ where: { subscriptionId: fixture.subscription.id } }), count);
  });
  await t.test('renewal form creates and opens a separately linked draft', async () => {
    click('Renew subscription');
    ui.fireEvent.change(ui.screen.getByLabelText('New start date'), { target: { value: later(20).toISOString().slice(0, 10) } });
    ui.fireEvent.change(ui.screen.getByLabelText('New expiry date'), { target: { value: later(40).toISOString().slice(0, 10) } });
    click('Create renewal draft'); await status('DRAFT'); assert.notEqual(lastSaved.id, fixture.subscription.id);
    assert.match(lastSaved.lines[0].description, /Renewal of/); assert.equal(lastSaved.nextBillingDate, null);
  });
});
