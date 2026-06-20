/**
 * OrderOpsLayout — the Order Ops shell: the exact simulation banner + an internal tab bar over the
 * seven sub-screens, with the active screen rendered through <Outlet />. Mounted at /admin/orders
 * (admin/internal only; the API is hard-gated server-side). The banner sits above the outlet so it
 * is visible on EVERY sub-screen without repeating it in each page.
 */
import { NavLink, Outlet } from 'react-router-dom';
import {
  ShoppingCart, LayoutDashboard, FilePlus2, ReceiptText, Users, PackageCheck, Truck, WalletCards,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { OPS_BANNER } from './opsShared.jsx';

const TABS = [
  { to: '/admin/orders', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/orders/new', label: 'New Order', icon: FilePlus2 },
  { to: '/admin/orders/list', label: 'Orders', icon: ReceiptText },
  { to: '/admin/orders/customers', label: 'Customers', icon: Users },
  { to: '/admin/orders/inventory', label: 'Inventory', icon: PackageCheck },
  { to: '/admin/orders/suppliers', label: 'Suppliers', icon: Truck },
  { to: '/admin/orders/referrals', label: 'Referral Credits', icon: WalletCards },
];

export default function OrderOpsLayout() {
  return (
    <div className="space-y-5">
      {/* Exact simulation banner — visible on EVERY Order Ops sub-screen. */}
      <div className="rounded-lg border border-warning/25 bg-warning-soft px-4 py-2.5 text-sm font-semibold text-warning">
        {OPS_BANNER}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">Vitalis Order Ops</h1>
            <p className="text-xs text-faint">Internal operator surface — orders, invoices, inventory, suppliers, referral credits.</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-neutral-soft px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-soft">
          Admin · internal only
        </span>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-border-soft">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => cn(
              'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-soft hover:border-border hover:text-foreground',
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
