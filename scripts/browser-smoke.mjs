// Optional local browser check: npm install --prefix .local/browser-tools --no-save
// --package-lock=false playwright@1.56.1, then node --import tsx scripts/browser-smoke.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { chromium } from '../.local/browser-tools/node_modules/playwright/index.mjs';
import { testServer } from '../tests/helpers/test-server.ts';

test('headless Edge full business journey and desktop/mobile layouts', async t => {
  const { app, db, base } = await testServer(t);
  const origin = base.replace(/\/api$/, '');
  const { config } = await import('../server/src/lib/config.ts');
  config.allowedOrigins.push(origin); config.appUrl = origin;
  app.use(express.static(path.resolve('dist/client')));
  app.get('*', (_req, res) => res.sendFile(path.resolve('dist/client/index.html')));
  const { hashPassword } = await import('../server/src/lib/password.ts');
  const password = `Browser!${randomBytes(16).toString('hex')}`;
  await db.user.create({ data: { name: 'Browser review admin', email: 'browser-admin@example.test', role: 'ADMIN', passwordHash: await hashPassword(password) } });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const artifactDir = path.resolve('.local/final-verification'); mkdirSync(artifactDir, { recursive: true });
  let complete = false;
  t.after(async () => {
    if (!complete) {
      try { await page.screenshot({ path: path.join(artifactDir, 'failure.png'), fullPage: true });
        writeFileSync(path.join(artifactDir, 'failure.txt'), await page.locator('body').innerText()); } catch {}
    }
    await browser.close();
  });
  const errors = []; const timings = [];
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await adminContext.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`${origin}/account/login`);
  await page.getByLabel('Email address', { exact: true }).fill('browser-admin@example.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Brightloop workspace' }).waitFor();
  async function api(context, route, data, expected = 201) {
    const response = data === undefined ? await context.request.get(`${base}${route}`) : await context.request.post(`${base}${route}`, { data, headers: { Origin: origin } });
    const result = await response.json(); assert.equal(response.status(), expected, JSON.stringify(result)); return result.data;
  }
  const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const customer = await api(customerContext, '/auth/signup', { name: 'Browser buyer', email: 'browser-buyer@example.test', password });
  const product = await api(adminContext, '/catalog/products', { name: 'Browser workspace', salesPriceMinor: 12000 });
  const variant = await api(adminContext, `/catalog/products/${product.id}/variants`, { name: 'Plus', priceAdjustmentMinor: 500 });
  const tax = await api(adminContext, '/catalog/taxes', { name: 'GST 18%', rateBps: 1800 });
  const discount = await api(adminContext, '/catalog/discounts', { name: 'First invoice saving', kind: 'FIXED', scope: 'SUBSCRIPTION', value: 1000, startsAt: '2020-01-01', usageLimit: 1 });
  const plan = await api(adminContext, '/catalog/plans', { name: 'Monthly browser plan', productId: product.id, priceMinor: 10000, interval: 'MONTHLY', allowPause: true });
  const template = await api(adminContext, '/subscriptions/templates', { name: 'Browser quotation', planId: plan.id, paymentTermDays: 0,
    lines: [{ productId: product.id, variantId: variant.id, quantity: 2, taxRuleId: tax.id }] });
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const subscription = await api(adminContext, '/subscriptions', { templateId: template.id, customerId: customer.customerId, startDate: yesterday });
  await api(adminContext, `/subscriptions/${subscription.id}/transition`, { action: 'CONFIRMED' }, 200);
  await api(adminContext, `/subscriptions/${subscription.id}/transition`, { action: 'ACTIVE' }, 200);
  const bill = await api(adminContext, '/billing/run', { subscriptionId: subscription.id }, 200); assert.equal(bill.invoicesCreated, 1);
  assert.equal((await api(adminContext, '/billing/run', { subscriptionId: subscription.id }, 200)).invoicesCreated, 0);
  const list = await api(adminContext, '/billing/invoices', undefined, 200); const invoice = list.items[0];
  assert.equal(invoice.discountMinor, 1000); assert.equal(invoice.totalMinor, 23600);
  assert.equal((await db.discountRule.findUniqueOrThrow({ where: { id: discount.id } })).uses, 1);
  await page.goto(`${origin}/billing`);
  await page.getByRole('row').filter({ hasText: invoice.number }).getByRole('button', { name: 'View Details' }).click();
  await page.getByRole('button', { name: /Confirm Invoice/ }).click();
  await page.getByRole('button', { name: /Record Payment/ }).first().waitFor();
  await api(adminContext, `/billing/invoices/${invoice.id}/payments`, { method: 'BANK', amountMinor: 5000, note: 'Internal test note', reference: 'BROWSER-PARTIAL' });
  const summary = await api(adminContext, '/dashboard/summary', undefined, 200);
  assert.equal(summary.invoicedRevenueMinor, 20000); assert.equal(summary.collectedMinor, 5000);
  assert.equal(summary.outstandingMinor, 18600); assert.equal(summary.overdueMinor, 18600);
  const email = await api(adminContext, `/billing/invoices/${invoice.id}/send`, {}, 200); assert.equal(email.deliveryMode, 'file');
  const benchmarkBuyer = await db.customer.create({ data: { name: 'Performance fixture', email: 'browser-performance@example.test' } });
  for (let offset = 0; offset < 3000; offset += 500) {
    await db.subscription.createMany({ data: Array.from({ length: 500 }, (_, index) => ({
      number: `BROWSER-PERF-${offset + index}`, customerId: benchmarkBuyer.id, planId: plan.id,
      status: 'CLOSED', startDate: new Date('2026-01-01'), billingInterval: 'MONTHLY',
    })) });
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const route of ['/', '/catalog', '/subscriptions', '/billing', '/staff']) {
      const started = performance.now(); await page.goto(`${origin}${route}`); await page.locator('h1').first().waitFor(); await page.waitForLoadState('networkidle');
      timings.push({ route, width, readyMs: Math.round(performance.now() - started) });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Page overflow: ${route}, ${width}px`);
      await page.screenshot({ path: path.join(artifactDir, `${route === '/' ? 'dashboard' : route.slice(1)}-${width}.png`), fullPage: true });
    }
  }
  async function assertOpenedDetail(detail, number) {
    await detail.getByRole('heading', { name: new RegExp(number) }).waitFor();
    const position = await detail.evaluate(element => ({ top: element.getBoundingClientRect().top,
      viewport: innerHeight, focused: document.activeElement === element }));
    assert.ok(position.top >= 0 && position.top < position.viewport - 80, 'Opened details must enter the viewport without manual scrolling');
    assert.equal(position.focused, true, 'Opened details must receive keyboard focus');
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/subscriptions`);
    await page.getByLabel('Search subscriptions', { exact: true }).fill(subscription.number);
    const view = page.getByRole('row').filter({ hasText: subscription.number }).getByRole('button', { name: 'View', exact: true });
    await view.click();
    const detail = page.getByRole('region', { name: 'Subscription details', exact: true });
    await assertOpenedDetail(detail, subscription.number);
    await detail.getByRole('button', { name: 'Close details', exact: true }).click();
    assert.equal(await detail.count(), 0);
    // An API failure must also appear in the visible viewport instead of above the table.
    await page.route(`**/api/subscriptions/${subscription.id}`, route => route.abort());
    await view.click();
    const failure = page.getByRole('alert').filter({ hasText: 'Cannot reach Brightloop' });
    await failure.waitFor();
    assert.equal(await failure.evaluate(element => document.activeElement === element && element.getBoundingClientRect().top >= 0 && element.getBoundingClientRect().top < innerHeight), true);
    await page.unroute(`**/api/subscriptions/${subscription.id}`);
    await view.click(); await assertOpenedDetail(detail, subscription.number);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/billing`);
  await page.getByRole('row').filter({ hasText: invoice.number }).getByRole('button', { name: 'View Details' }).click();
  await page.locator('.printable-invoice-card').waitFor();
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.billing-stats-grid').isVisible(), false);
  assert.equal(await page.locator('.invoice-print-heading').isVisible(), true);
  assert.ok((await page.locator('.invoice-print-heading').innerText()).includes(invoice.number));
  assert.equal(await page.getByText('Internal test note', { exact: true }).isVisible(), false);
  await page.pdf({ path: path.join(artifactDir, 'invoice-print.pdf'), format: 'A4', printBackground: true });
  await page.screenshot({ path: path.join(artifactDir, 'invoice-print.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await api(adminContext, `/billing/invoices/${invoice.id}/payments`, { method: 'BANK', amountMinor: 18600, reference: 'BROWSER-FINAL' });
  const final = await api(adminContext, '/dashboard/summary', undefined, 200);
  assert.equal(final.collectedMinor, 23600); assert.equal(final.outstandingMinor, 0);
  const customerPage = await customerContext.newPage(); customerPage.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 390]) {
    await customerPage.setViewportSize({ width, height: 900 });
    await customerPage.goto(`${origin}/portal/subscriptions`);
    await customerPage.getByRole('button', { name: `View ${subscription.number}`, exact: true }).click();
    const detail = customerPage.getByRole('region', { name: 'Your subscription details', exact: true });
    await assertOpenedDetail(detail, subscription.number);
    await detail.getByRole('button', { name: 'Close subscription details', exact: true }).click();
    assert.equal(await detail.count(), 0);
    await customerPage.getByRole('button', { name: `View ${subscription.number}`, exact: true }).click();
    await assertOpenedDetail(detail, subscription.number);
  }
  await customerPage.setViewportSize({ width: 390, height: 844 });
  await customerPage.goto(`${origin}/portal/invoices`); await customerPage.getByRole('heading', { name: 'Your invoices', exact: true }).waitFor();
  await customerPage.getByText(invoice.number, { exact: true }).first().waitFor();
  await customerPage.screenshot({ path: path.join(artifactDir, 'customer-invoices-390.png'), fullPage: true });
  assert.equal((await customerContext.request.get(`${base}/billing/invoices`)).status(), 403);
  const outsiderContext = await browser.newContext();
  await api(outsiderContext, '/auth/signup', { name: 'Other buyer', email: 'other-browser@example.test', password });
  for (const route of [`/portal/invoices/${invoice.id}`, `/portal/invoices/${invoice.id}/print`, `/portal/subscriptions/${subscription.id}`]) {
    assert.equal((await outsiderContext.request.get(`${base}${route}`)).status(), 404);
  }
  await api(adminContext, '/staff', { name: 'Browser staff', email: 'browser-staff@example.test', password });
  const staffContext = await browser.newContext(); await api(staffContext, '/auth/login', { email: 'browser-staff@example.test', password }, 200);
  const staffPage = await staffContext.newPage(); staffPage.on('pageerror', error => errors.push(error.message));
  await staffPage.goto(`${origin}/catalog`); await staffPage.getByRole('heading', { name: /Product Catalog/ }).waitFor();
  assert.equal(await staffPage.getByRole('button', { name: /Add Product|Edit|Archive|Add Variant/ }).count(), 0);
  assert.equal((await staffContext.request.post(`${base}/catalog/products`, { data: { name: 'Forbidden', salesPriceMinor: 10 }, headers: { Origin: origin } })).status(), 403);
  assert.equal((await staffContext.request.get(`${base}/staff`)).status(), 403);
  await page.reload(); await page.getByRole('heading', { name: /Invoices & Billing/ }).waitFor();
  assert.deepEqual(errors, []);
  assert.ok(timings.every(result => result.readyMs < 2000), 'Representative page readiness should stay below two seconds on this local machine');
  writeFileSync(path.join(artifactDir, 'browser-result.json'), JSON.stringify({ browser: 'Headless Microsoft Edge', databaseSubscriptions: await db.subscription.count(), viewportChecks: timings,
    passed: ['real UI login/refresh', 'catalog/discount/tax/template APIs', 'billing duplicate prevention', 'UI invoice confirmation', 'partial/final payments',
      'dashboard accounting and overdue', 'private file email', 'print PDF', 'customer ownership', 'staff permissions', 'desktop/mobile document overflow',
      'admin/customer View buttons bring details into view and focus', 'admin detail failure visibility and recovery'], pageErrors: errors }, null, 2));
  t.diagnostic(`Headless Edge passed. ${timings.length} route/viewport checks; screenshots, print PDF and timings saved privately under .local/final-verification. No real SMTP delivery was attempted.`);
  complete = true;
});
