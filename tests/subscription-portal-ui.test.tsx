import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';
import { testServer } from './helpers/test-server.js';
import { createLifecycleFixture } from './fixtures/subscriptions.js';

test('customer subscription UI uses owned APIs and handles actions, filters and network errors', async t => {
  const { db, base } = await testServer(t);
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173/portal/subscriptions' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ React, window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window) })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  register('./helpers/css-loader.mjs', import.meta.url);
  const originalFetch = globalThis.fetch;
  const { hashPassword } = await import('../server/src/lib/password.js');
  const password = randomBytes(18).toString('hex') + '!Aa';
  const buyer = await db.customer.create({ data: { name: 'Portal Buyer', email: 'portal-buyer@example.test' } });
  const email = 'portal-login@example.test';
  await db.user.create({ data: { name: buyer.name, email, passwordHash: await hashPassword(password), role: 'CUSTOMER', customerId: buyer.id } });
  const login = await originalFetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const now = new Date(); const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const later = (days: number) => new Date(day.getTime() + days * 86400000);
  const fixture = await createLifecycleFixture(db, { startDate: later(-1), expiryDate: later(20), nextBillingDate: later(1) });
  const restricted = await createLifecycleFixture(db, { startDate: later(-1), expiryDate: later(20), nextBillingDate: later(1), allowPause: false, allowEarlyClose: false, allowRenew: false });
  for (const item of [fixture, restricted]) await db.subscription.update({ where: { id: item.subscription.id }, data: { customerId: buyer.id } });
  const other = await createLifecycleFixture(db);
  let offline = false; const paths: string[] = [];
  globalThis.fetch = async (input, options) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url; paths.push(path);
    if (offline) throw new TypeError('Offline test');
    const headers = new Headers(options?.headers); headers.set('Cookie', cookie); headers.set('Origin', 'http://localhost:5173');
    return originalFetch(`${base}${path.replace(/^\/api/, '')}`, { ...options, headers });
  };
  const ui = await import('@testing-library/react');
  const { CustomerSubscriptionsPage } = await import('../client/src/features/subscriptions/CustomerSubscriptionsPage.js');
  t.after(() => {
    ui.cleanup(); globalThis.fetch = originalFetch; dom.window.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  });
  ui.render(<CustomerSubscriptionsPage />);
  const details = () => ui.within(ui.screen.getByRole('region', { name: 'Your subscription details' }));
  async function view(number: string) {
    const button = await ui.screen.findByRole('button', { name: `View ${number}` }); ui.fireEvent.click(button);
    await ui.waitFor(() => assert.equal(details().getByRole('heading', { name: number }).textContent, number));
  }
  const click = (name: string) => ui.fireEvent.click(details().getByRole('button', { name }));
  await t.test('cards and details show only owned subscriptions and no staff controls', async () => {
    assert.ok(ui.screen.getByRole('status', { name: 'Loading your subscriptions' }));
    await view(fixture.subscription.number);
    assert.equal(ui.screen.queryByText(other.subscription.number), null);
    assert.equal(details().queryByRole('button', { name: 'Confirm quotation' }), null);
    assert.equal(details().queryByRole('button', { name: 'Activate subscription' }), null);
    assert.equal(details().queryByText('Billing anchor day'), null);
    assert.equal(details().queryByRole('link', { name: 'Open billing' }), null);
    assert.ok(details().getByText('₹236.00', { selector: 'strong' }));
  });
  await t.test('plan-forbidden actions are disabled or absent', async () => {
    await view(restricted.subscription.number);
    assert.ok(details().getByRole('button', { name: 'Pause' }).matches(':disabled'));
    assert.ok(details().getByRole('button', { name: 'Close subscription' }).matches(':disabled'));
    assert.equal(details().queryByRole('button', { name: 'Renew subscription' }), null);
  });
  await t.test('customer pause, resume, support error and closure use real portal APIs', async () => {
    await view(fixture.subscription.number); click('Pause');
    await ui.waitFor(() => assert.ok(details().getByText('PAUSED', { selector: 'dd' })));
    click('Resume'); await ui.waitFor(() => assert.ok(details().getByText('ACTIVE', { selector: 'dd' })));
    click('Close subscription'); click('Confirm closure');
    const alert = await details().findByRole('alert'); assert.match(alert.textContent ?? '', /contact support/);
    const { runBillingCycle } = await import('../server/src/modules/billing/recurring.js');
    await runBillingCycle({ subscriptionId: fixture.subscription.id });
    click('Confirm closure'); await ui.waitFor(() => assert.ok(details().getByText('CLOSED', { selector: 'dd' })));
    assert.ok(paths.every(path => path.startsWith('/api/portal/subscriptions')));
  });
  await t.test('customer renewal opens its separate draft without commercial approval controls', async () => {
    click('Renew subscription');
    ui.fireEvent.change(details().getByLabelText('New start date'), { target: { value: later(20).toISOString().slice(0, 10) } });
    ui.fireEvent.change(details().getByLabelText('New expiry date'), { target: { value: later(40).toISOString().slice(0, 10) } });
    click('Create renewal draft'); await ui.waitFor(() => assert.ok(details().getByText('DRAFT', { selector: 'dd' })));
    assert.ok(details().getByRole('heading', { level: 2 }).textContent !== fixture.subscription.number);
    assert.equal(details().queryByRole('button', { name: 'Confirm quotation' }), null);
  });
  await t.test('search/status filters show empty results without cross-customer data', async () => {
    ui.fireEvent.change(ui.screen.getByLabelText('Search your subscriptions'), { target: { value: other.subscription.number } });
    await ui.screen.findByRole('heading', { name: 'No subscriptions found' });
    ui.fireEvent.change(ui.screen.getByLabelText('Search your subscriptions'), { target: { value: '' } });
    ui.fireEvent.change(ui.screen.getByLabelText('Subscription status'), { target: { value: 'CLOSED' } });
    await ui.screen.findByRole('button', { name: `View ${fixture.subscription.number}` });
    assert.equal(ui.screen.queryByRole('button', { name: `View ${restricted.subscription.number}` }), null);
  });
  await t.test('network failures show retry and recover without fake successful data', async () => {
    offline = true; ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Refresh subscriptions' }));
    const retry = await ui.screen.findByRole('button', { name: 'Retry subscriptions' });
    assert.ok(ui.screen.getAllByRole('alert').some(item => /Cannot reach Brightloop/.test(item.textContent ?? '')));
    offline = false; ui.fireEvent.click(retry);
    await ui.screen.findByRole('button', { name: `View ${fixture.subscription.number}` });
  });
});
