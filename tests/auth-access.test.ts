import test from 'node:test';
import assert from 'node:assert/strict';
import { homeForUser, navigationForUser, postLoginPath } from '../client/src/features/auth/access.js';

test('role-aware destinations preserve only allowed internal module URLs', () => {
  assert.equal(homeForUser({ role: 'CUSTOMER' }), '/portal/subscriptions');
  for (const role of ['ADMIN', 'STAFF'] as const) {
    assert.equal(homeForUser({ role }), '/');
    assert.equal(postLoginPath({ role }, '/subscriptions?search=acme#details'), '/subscriptions?search=acme#details');
    assert.equal(postLoginPath({ role }, '/portal/invoices'), '/');
  }
  assert.equal(postLoginPath({ role: 'ADMIN' }, '/staff'), '/staff');
  assert.equal(postLoginPath({ role: 'STAFF' }, '/staff'), '/');
  assert.equal(postLoginPath({ role: 'CUSTOMER' }, '/billing'), '/portal/subscriptions');
  assert.equal(postLoginPath({ role: 'CUSTOMER' }, '/portal/invoices/invoice-id?print=1'), '/portal/invoices/invoice-id?print=1');
  for (const requested of ['https://evil.example', '//evil.example', '/\\evil.example', '/catalogue', '/account/login', '/billing\n', null, { pathname: '/staff' }]) {
    assert.equal(postLoginPath({ role: 'CUSTOMER' }, requested), '/portal/subscriptions');
    assert.equal(postLoginPath({ role: 'STAFF' }, requested), '/');
  }
});

test('customers see only portal links and staff never see team administration', () => {
  assert.deepEqual(navigationForUser({ role: 'CUSTOMER' }).map(link => link.to), ['/portal/subscriptions', '/portal/invoices']);
  assert.equal(navigationForUser({ role: 'STAFF' }).some(link => link.to === '/staff'), false);
  assert.equal(navigationForUser({ role: 'ADMIN' }).some(link => link.to === '/staff'), true);
});
