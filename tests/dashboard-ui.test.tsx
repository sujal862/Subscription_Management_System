import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';

test('dashboard UI loading, error recovery, filters and overdue pagination', async t => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173/' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ React, window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    MutationObserver: dom.window.MutationObserver, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window) })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  register('./helpers/css-loader.mjs', import.meta.url);
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  let offline = true;
  let release: (() => void) | undefined;
  let gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), 'http://localhost:5173'); requests.push(url);
    await gate;
    if (offline) throw new TypeError('Network unavailable');
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const empty = url.searchParams.get('status') === 'PAID';
    const page = Number(url.searchParams.get('page') ?? 1);
    const data = url.pathname.endsWith('/summary') ? {
      activeSubscriptions: 3, invoicedRevenueMinor: empty ? 0 : 27000, collectedMinor: empty ? 0 : 13620,
      outstandingMinor: empty ? 0 : 18240, overdueMinor: empty ? 0 : 7620, overdueInvoices: empty ? 0 : 11,
      invoiceCount: empty ? 0 : 15, currency: 'INR', asOf: '2026-10-31T12:00:00Z',
    } : { page, pageSize: 10, total: empty ? 0 : 11, items: empty ? [] : [{ id: String(page), number: `INV-PAGE-${page}`,
      customerName: 'Example buyer', dueDate: '2026-10-10T00:00:00Z', totalMinor: 10620, paidMinor: 3000, outstandingMinor: 7620 }] };
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const ui = await import('@testing-library/react');
  const { MemoryRouter } = await import('react-router-dom');
  const { DashboardPage } = await import('../client/src/features/dashboard/DashboardPage.js');
  t.after(() => {
    ui.cleanup(); globalThis.fetch = originalFetch; dom.window.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  });
  ui.render(<MemoryRouter><DashboardPage /></MemoryRouter>);
  assert.match(ui.screen.getByRole('status').textContent ?? '', /Loading dashboard/);
  await ui.act(async () => { release!(); });
  assert.ok(await ui.screen.findByRole('alert'));
  offline = false; gate = Promise.resolve();
  ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Try again' }));
  assert.ok(await ui.screen.findByText('INV-PAGE-1'));
  assert.equal(ui.screen.getByText('Invoiced revenue').nextElementSibling?.textContent, '₹270.00');
  assert.equal(ui.screen.getByText('Outstanding').nextElementSibling?.textContent, '₹182.40');
  ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Next' }));
  assert.ok(await ui.screen.findByText('INV-PAGE-2'));
  assert.ok(ui.screen.getByRole('button', { name: 'Next' }).matches(':disabled'));
  const fill = (label: string, value: string) => ui.fireEvent.change(ui.screen.getByLabelText(label), { target: { value } });
  fill('Issued from', '2026-11-01'); fill('Issued to', '2026-10-01');
  ui.fireEvent.submit(ui.screen.getByRole('button', { name: 'Apply filters' }).closest('form')!);
  assert.match(ui.screen.getByRole('alert').textContent ?? '', /From date/);
  fill('Issued from', '2026-10-01'); fill('Issued to', '2026-10-31'); fill('Invoice status', 'PAID');
  ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Apply filters' }));
  await ui.screen.findByText(/No confirmed or paid invoices match/);
  assert.ok(ui.screen.getByText('No overdue invoices match these filters.'));
  assert.equal(ui.screen.getByText('Active subscriptions').nextElementSibling?.textContent, '3');
  const request = requests.filter(url => url.pathname.endsWith('/overdue')).at(-1)!;
  assert.equal(request.searchParams.get('from'), '2026-10-01'); assert.equal(request.searchParams.get('to'), '2026-10-31');
  assert.equal(request.searchParams.get('status'), 'PAID'); assert.equal(request.searchParams.get('page'), '1');
  ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Clear filters' }));
  await ui.screen.findByText('INV-PAGE-1');
  assert.equal((ui.screen.getByLabelText('Issued from') as HTMLInputElement).value, '');
});
