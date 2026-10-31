import { Route, Routes, Link } from 'react-router-dom';
import { AuthPage } from './features/auth/AuthPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { StaffPage } from './features/staff/StaffPage';
import { CatalogPage } from './features/catalog/CatalogPage';
import { SubscriptionsPage } from './features/subscriptions/SubscriptionsPage';
import { CustomerSubscriptionsPage } from './features/subscriptions/CustomerSubscriptionsPage';
import { BillingPage } from './features/billing/BillingPage';
import { CustomerInvoicesPage } from './features/billing/CustomerInvoicesPage';
import { Layout } from './components/Layout';
// Member 1 adds session context, protected routes and role-aware navigation.
// These pages currently contain no private or business data.
export function App() {
  return <Routes><Route element={<Layout />}>
    <Route index element={<DashboardPage />} />
    <Route path="account/*" element={<AuthPage />} />
    <Route path="catalog/*" element={<CatalogPage />} />
    <Route path="subscriptions/*" element={<SubscriptionsPage />} />
    <Route path="billing/*" element={<BillingPage />} />
    <Route path="staff" element={<StaffPage />} />
    <Route path="portal/subscriptions/*" element={<CustomerSubscriptionsPage />} />
    <Route path="portal/invoices/*" element={<CustomerInvoicesPage />} />
    <Route path="*" element={<div className="panel"><h1>Page not found</h1><Link to="/">Return to setup overview</Link></div>} />
  </Route></Routes>;
}
