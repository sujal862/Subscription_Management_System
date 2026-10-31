import { Navigate, Route, Routes, Link } from 'react-router-dom';
import { AuthPage } from './features/auth/AuthPage';
import { ProtectedRoute, PublicAccountRoute } from './features/auth/ProtectedRoute';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { StaffPage } from './features/staff/StaffPage';
import { CatalogPage } from './features/catalog/CatalogPage';
import { SubscriptionsPage } from './features/subscriptions/SubscriptionsPage';
import { CustomerSubscriptionsPage } from './features/subscriptions/CustomerSubscriptionsPage';
import { BillingPage } from './features/billing/BillingPage';
import { CustomerInvoicesPage } from './features/billing/CustomerInvoicesPage';
import { Layout } from './components/Layout';
import './features/auth/auth.css';

export function App() {
  return <Routes>
    <Route element={<PublicAccountRoute />}>
      <Route path="account" element={<Navigate to="/account/login" replace />} />
      <Route path="account/login" element={<AuthPage key="login" mode="login" />} />
      <Route path="account/signup" element={<AuthPage key="signup" mode="signup" />} />
      <Route path="account/*" element={<main className="auth-status"><h1>Page not available</h1><Link to="/account/login">Back to sign in</Link></main>} />
    </Route>
    <Route element={<ProtectedRoute />}><Route element={<Layout />}>
      <Route element={<ProtectedRoute roles={['ADMIN', 'STAFF']} />}>
        <Route index element={<DashboardPage />} />
        <Route path="catalog/*" element={<CatalogPage />} />
        <Route path="subscriptions/*" element={<SubscriptionsPage />} />
        <Route path="billing/*" element={<BillingPage />} />
      </Route>
      <Route element={<ProtectedRoute roles={['ADMIN']} />}><Route path="staff" element={<StaffPage />} /></Route>
      <Route element={<ProtectedRoute roles={['CUSTOMER']} />}>
        <Route path="portal/subscriptions/*" element={<CustomerSubscriptionsPage />} />
        <Route path="portal/invoices/*" element={<CustomerInvoicesPage />} />
      </Route>
      <Route path="*" element={<div className="panel"><h1>Page not found</h1><Link to="/">Return to your workspace</Link></div>} />
    </Route></Route>
  </Routes>;
}
