import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';
import { testServer } from './helpers/test-server.js';
import { outboxMessages, resetLink } from './helpers/outbox.js';

test('authentication UI integrates with the real session API', async t => {
  const { db, base } = await testServer(t);
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173/' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    // The Node loader may use classic JSX for dynamically imported components;
    // Vite uses the automatic JSX runtime for the actual application build.
    React,
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    MutationObserver: dom.window.MutationObserver, Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  register('./helpers/css-loader.mjs', import.meta.url);
  const originalFetch = globalThis.fetch;
  let cookie = '';
  let offline = false;
  let failedLogin = false;
  const requests: string[] = [];
  globalThis.fetch = async (input, options) => {
    const requestPath = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    requests.push(requestPath);
    if (offline || (failedLogin && requestPath === '/api/auth/login')) throw new TypeError('Offline test');
    const headers = new Headers(options?.headers);
    if (cookie) headers.set('Cookie', cookie);
    headers.set('Origin', 'http://localhost:5173');
    const response = await originalFetch(`${base}${requestPath.replace(/^\/api/, '')}`, { ...options, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie !== null) cookie = setCookie.split(';')[0];
    return response;
  };
  // Import after installing the DOM so React's event system sees a browser-like environment.
  const ui = await import('@testing-library/react');
  const { MemoryRouter, useLocation } = await import('react-router-dom');
  const { AuthProvider } = await import('../client/src/features/auth/AuthContext.js');
  const { App } = await import('../client/src/App.js');
  const { hashPassword } = await import('../server/src/lib/password.js');
  t.after(() => {
    ui.cleanup(); globalThis.fetch = originalFetch; dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const password = 'HourTwo!2026';
  const Location = () => { const location = useLocation(); return <span data-testid="route" data-has-fragment={!!location.hash}>{location.pathname}{location.search}</span>; };
  const mount = (path: string) => {
    ui.cleanup();
    return ui.render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /><Location /></AuthProvider></MemoryRouter>);
  };
  const route = () => ui.screen.getByTestId('route').textContent;
  const waitRoute = (path: string) => ui.waitFor(() => assert.equal(route(), path), { timeout: 8000 });
  const fill = (label: string, value: string) => ui.fireEvent.change(ui.screen.getByLabelText(label, { exact: true }), { target: { value } });
  async function login(email: string, intended = '/account/login') {
    mount(intended);
    await ui.screen.findByRole('heading', { name: 'Welcome back.' }, { timeout: 8000 });
    fill('Email address', email); fill('Password', password);
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Sign in' }));
  }

  await t.test('anonymous private links wait for session check before redirecting to login', async () => {
    mount('/subscriptions?search=acme');
    assert.ok(ui.screen.getByRole('status').textContent?.includes('Checking your session'));
    assert.equal(ui.screen.queryByRole('heading', { name: 'Subscription Management' }), null);
    await waitRoute('/account/login');
    await ui.screen.findByRole('heading', { name: 'Welcome back.' });
  });

  await t.test('bad credentials show a useful error without leaving the form', async () => {
    fill('Email address', 'missing@example.test'); fill('Password', password);
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Sign in' }));
    assert.ok(ui.screen.getByRole('button', { name: 'Signing in…' }).matches(':disabled'));
    await ui.screen.findByRole('alert', {}, { timeout: 8000 });
    assert.match(ui.screen.getByRole('alert').textContent ?? '', /Email or password is incorrect/);
    assert.equal(route(), '/account/login');
    assert.equal(ui.screen.getByRole('button', { name: 'Sign in' }).matches(':disabled'), false);
  });

  await t.test('signup validates locally then creates a real customer and opens the portal', async () => {
    ui.fireEvent.click(ui.screen.getByRole('link', { name: 'Create an account' }));
    await waitRoute('/account/signup');
    fill('Full name', 'UI Customer'); fill('Email address', 'ui-customer@example.test'); fill('Password', 'Abcdefg!');
    const count = requests.filter(path => path === '/api/auth/signup').length;
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Create account' }));
    assert.ok(ui.screen.getByText('Password must contain at least 9 characters'));
    assert.equal(requests.filter(path => path === '/api/auth/signup').length, count);
    fill('Password', password);
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Show password' }));
    assert.equal((ui.screen.getByLabelText('Password', { exact: true }) as HTMLInputElement).type, 'text');
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Create account' }));
    await waitRoute('/portal/subscriptions');
    await ui.screen.findByRole('heading', { name: 'Your subscriptions' });
    assert.equal((await db.user.findUniqueOrThrow({ where: { email: 'ui-customer@example.test' } })).role, 'CUSTOMER');
    assert.ok(cookie.startsWith('brightloop_session='));
  });

  await t.test('a page reload restores the saved cookie session without flashing private staff content', async () => {
    mount('/portal/invoices');
    assert.equal(ui.screen.queryByRole('heading', { name: 'Welcome back.' }), null);
    await ui.screen.findByRole('heading', { name: 'Your invoices' }, { timeout: 8000 });
    assert.equal(route(), '/portal/invoices');
  });

  await t.test('customer navigation and direct internal URLs cannot reveal staff features', async () => {
    for (const path of ['/catalog', '/subscriptions', '/billing', '/staff']) {
      mount(path); await waitRoute('/portal/subscriptions');
      assert.equal(ui.screen.queryByRole('heading', { name: 'Subscription Management' }), null);
      const nav = ui.screen.getByRole('navigation', { name: 'Customer portal navigation' });
      assert.deepEqual(ui.within(nav).getAllByRole('link').map(link => link.getAttribute('href')), ['/portal/subscriptions', '/portal/invoices']);
    }
  });

  await t.test('logout revokes the real session and returns to login', async () => {
    const previousCookie = cookie;
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Sign out' }));
    await waitRoute('/account/login');
    const response = await originalFetch(`${base}/auth/me`, { headers: { Cookie: previousCookie } });
    assert.equal(response.status, 401);
    mount('/portal/invoices'); await waitRoute('/account/login');
  });

  await t.test('staff login restores an allowed intended route and excludes administration', async () => {
    await db.user.create({ data: { name: 'UI Staff', email: 'ui-staff@example.test', role: 'STAFF', passwordHash: await hashPassword(password) } });
    cookie = '';
    await login('ui-staff@example.test', '/subscriptions?search=acme');
    await waitRoute('/subscriptions?search=acme');
    await ui.screen.findByRole('heading', { name: 'Subscription Management' });
    assert.equal(ui.screen.queryByRole('link', { name: 'Team access' }), null);
    mount('/staff'); await waitRoute('/');
  });

  await t.test('admin login opens the workspace and retains existing module links', async () => {
    await db.user.create({ data: { name: 'UI Admin', email: 'ui-admin@example.test', role: 'ADMIN', passwordHash: await hashPassword(password) } });
    cookie = '';
    await login('ui-admin@example.test');
    await waitRoute('/');
    const nav = ui.screen.getByRole('navigation', { name: 'Workspace navigation' });
    assert.deepEqual(ui.within(nav).getAllByRole('link').map(link => link.getAttribute('href')), ['/', '/catalog', '/subscriptions', '/billing', '/staff']);
    ui.fireEvent.click(ui.within(nav).getByRole('link', { name: 'Team access' }));
    await waitRoute('/staff');
    assert.ok(ui.screen.getByRole('heading', { name: 'Team access' }));
  });

  await t.test('session-check failures show retry instead of protected data', async () => {
    offline = true; mount('/');
    await ui.screen.findByRole('heading', { name: 'Unable to open your workspace.' });
    assert.equal(ui.screen.queryByRole('navigation'), null);
    offline = false; ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Try again' }));
    await ui.screen.findByRole('navigation', { name: 'Workspace navigation' }, { timeout: 8000 });
  });

  await t.test('expired sessions from a protected API return to login with an explanation', async () => {
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'ui-admin@example.test' } });
    await db.session.deleteMany({ where: { userId: admin.id } });
    ui.fireEvent.click(ui.screen.getByRole('link', { name: 'Subscriptions' }));
    await waitRoute('/account/login');
    assert.ok(ui.screen.getByText('Your session has expired. Please sign in again.'));
    assert.equal(ui.screen.queryByRole('navigation'), null);
  });

  await t.test('login network errors keep the form usable', async () => {
    fill('Email address', 'ui-admin@example.test'); fill('Password', password);
    failedLogin = true;
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Sign in' }));
    await ui.screen.findByRole('alert');
    assert.match(ui.screen.getByRole('alert').textContent ?? '', /Cannot reach Brightloop/);
    assert.equal(ui.screen.getByRole('button', { name: 'Sign in' }).matches(':disabled'), false);
    failedLogin = false;
  });

  await t.test('admin staff screen creates an account, clears its password and handles duplicate email', async () => {
    cookie = ''; await login('ui-admin@example.test'); await waitRoute('/');
    ui.fireEvent.click(ui.screen.getByRole('link', { name: 'Team access' })); await waitRoute('/staff');
    await ui.screen.findByRole('heading', { name: 'Add a staff member' });
    fill('Full name', 'New UI Staff'); fill('Staff email address', 'new-ui-staff@example.test'); fill('Initial password', password);
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Create staff account' }));
    await ui.screen.findByText(/Staff account created\./, {}, { timeout: 8000 });
    assert.equal((ui.screen.getByLabelText('Initial password') as HTMLInputElement).value, '');
    await ui.screen.findByRole('cell', { name: 'new-ui-staff@example.test' }, { timeout: 8000 });
    assert.equal((await db.user.findUniqueOrThrow({ where: { email: 'new-ui-staff@example.test' } })).role, 'STAFF');
    fill('Full name', 'Duplicate'); fill('Staff email address', 'new-ui-staff@example.test'); fill('Initial password', password);
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Create staff account' }));
    await ui.screen.findByRole('alert', {}, { timeout: 8000 });
    assert.match(ui.screen.getByRole('alert').textContent ?? '', /already exists/);
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Sign out' })); await waitRoute('/account/login');
  });

  await t.test('forgot password UI sends an offline email without exposing its token', async () => {
    ui.fireEvent.click(ui.screen.getByRole('link', { name: 'Forgot password?' })); await waitRoute('/account/forgot-password');
    fill('Registered email address', 'ui-customer@example.test');
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Send reset link' }));
    await ui.screen.findByText(/If an active account exists/, {}, { timeout: 8000 });
    const { waitForPasswordResetDeliveries } = await import('../server/src/modules/auth/password-reset.js');
    await waitForPasswordResetDeliveries();
    assert.equal(outboxMessages().length, 1);
    assert.ok(!ui.screen.getByRole('main').textContent?.includes('#token='));
  });

  await t.test('reset UI removes the URL token, checks confirmation and requires sign-in after success', async () => {
    const link = resetLink(outboxMessages()[0].body);
    mount(`${link.pathname}${link.hash}`);
    await ui.screen.findByRole('heading', { name: 'Choose a new password.' });
    await ui.waitFor(() => assert.equal(ui.screen.getByTestId('route').getAttribute('data-has-fragment'), 'false'));
    fill('New password', 'UpdatedPass!2026'); fill('Confirm new password', 'MismatchPass!2026');
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Update password' }));
    await ui.screen.findByText('Passwords do not match');
    fill('Confirm new password', 'UpdatedPass!2026');
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Update password' }));
    await ui.screen.findByRole('heading', { name: 'Password updated.' }, { timeout: 8000 });
    ui.fireEvent.click(ui.screen.getByRole('link', { name: 'Back to sign in' })); await waitRoute('/account/login');
    fill('Email address', 'ui-customer@example.test'); fill('Password', 'UpdatedPass!2026');
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Sign in' })); await waitRoute('/portal/subscriptions');
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Sign out' })); await waitRoute('/account/login');
    mount(`${link.pathname}${link.hash}`);
    fill('New password', 'UpdatedAgain!2026'); fill('Confirm new password', 'UpdatedAgain!2026');
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Update password' }));
    await ui.screen.findByRole('link', { name: 'Request a new reset link' }, { timeout: 8000 });
    mount('/account/reset-password');
    assert.ok(ui.screen.getByRole('link', { name: 'Request a new reset link' }));
    assert.equal(ui.screen.queryByLabelText('New password'), null);
  });
});
