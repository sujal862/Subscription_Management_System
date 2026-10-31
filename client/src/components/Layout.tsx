import { NavLink, Outlet } from 'react-router-dom';
export function Layout() {
  return <div className="workspace"><aside className="sidebar"><NavLink className="brand" to="/">brightloop<span>●</span></NavLink><nav aria-label="Main navigation">{[['/', 'Setup overview'], ['/account', 'Account access'], ['/catalog', 'Catalog & plans'], ['/subscriptions', 'Subscriptions'], ['/billing', 'Invoices & payments'], ['/staff', 'Team access']].map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}</nav><small>Hackathon starter · Features pending</small></aside><main className="page-content"><Outlet /></main></div>;
}
