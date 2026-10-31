import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
// Scaffold status only. Member 1 implements the actual business dashboard later.
export function DashboardPage() {
  const [status, setStatus] = useState('Checking API and database…');
  useEffect(() => {
    let active = true;
    api<{ status: string; database: string }>('/health').then(result => { if (active) setStatus(`API ${result.status} · Database ${result.database}`); })
      .catch(error => { if (active) setStatus(`Connection failed: ${errorMessage(error)}`); });
    return () => { active = false; };
  }, []);
  return <section><span className="eyebrow">TEAM STARTER</span><h1>Brightloop workspace</h1><p className="muted">Shared project foundation. Business features are not implemented yet.</p><p className="notice" role="status">{status}</p><div className="module-grid">{[
    ['1', 'Foundation & access', '/account', 'Authentication, permissions, staff and reporting.'],
    ['2', 'Catalog & plans', '/catalog', 'Products, variants, plans, taxes and discounts.'],
    ['3', 'Subscriptions', '/subscriptions', 'Customers, quotation templates and lifecycle.'],
    ['4', 'Billing & payments', '/billing', 'Recurring invoices, payments and invoice portal.'],
  ].map(([number, title, href, description]) => <Link className="panel module-card" to={href} key={number}><span className="eyebrow">MEMBER {number}</span><h2>{title}</h2><p className="muted">{description}</p><span>Open module →</span></Link>)}</div></section>;
}
