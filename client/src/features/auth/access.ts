import type { PublicUser } from '../../../../shared/contracts';

export interface NavigationItem { to: string; label: string }
export const homeForUser = (user: Pick<PublicUser, 'role'>) => user.role === 'CUSTOMER' ? '/portal/subscriptions' : '/';

export function navigationForUser(user: Pick<PublicUser, 'role'>): NavigationItem[] {
  if (user.role === 'CUSTOMER') return [
    { to: '/portal/subscriptions', label: 'My subscriptions' },
    { to: '/portal/invoices', label: 'My invoices' },
  ];
  return [
    { to: '/', label: 'Overview' },
    { to: '/catalog', label: 'Catalog & plans' },
    { to: '/subscriptions', label: 'Subscriptions' },
    { to: '/billing', label: 'Invoices & payments' },
    ...(user.role === 'ADMIN' ? [{ to: '/staff', label: 'Team access' }] : []),
  ];
}

// Preserve an intended module URL after login without accepting external redirects
// or sending a newly signed-in customer to an internal staff workspace.
export function postLoginPath(user: Pick<PublicUser, 'role'>, requested: unknown): string {
  const home = homeForUser(user);
  if (typeof requested !== 'string' || !requested.startsWith('/') || requested.startsWith('//')
    || /[\\\u0000-\u001f]/.test(requested)) return home;
  const url = new URL(requested, 'http://brightloop.local');
  const matches = (prefix: string) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
  const allowed = user.role === 'CUSTOMER'
    ? matches('/portal/subscriptions') || matches('/portal/invoices')
    : url.pathname === '/' || ['/catalog', '/subscriptions', '/billing'].some(matches)
      || (user.role === 'ADMIN' && matches('/staff'));
  return allowed ? `${url.pathname}${url.search}${url.hash}` : home;
}
