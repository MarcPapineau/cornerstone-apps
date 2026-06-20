/**
 * OrderOpsOverview (/admin/orders) — the at-a-glance operator command center: KPI cards, recent
 * orders, low-stock summary, supplier-balance + referral-liability summaries. Read-only; every
 * figure is server-derived from /api/ops/dashboard (admin-gated). No hero page — dense + scannable.
 */
import { Link } from 'react-router-dom';
import { ReceiptText, PackageCheck, Truck, WalletCards, TrendingUp, AlertTriangle, DollarSign } from 'lucide-react';
import { useFetch } from '../../lib/useApi.js';
import api from '../../lib/api.js';
import { fmtInt } from '../../lib/utils.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card.jsx';
import { StatCard } from '../../components/ui/StatCard.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/ui/States.jsx';
import { money, pct, opsStatusTone } from './opsShared.jsx';

export default function OrderOpsOverview() {
  const { data, loading, error } = useFetch(() => api.opsDashboard(), []);
  if (loading) return <Loading label="Loading order operations…" />;
  if (error) return <ErrorState error={error} />;

  const d = data || {};
  const recent = d.recentOrders || [];
  const inv = d.inventory || {};
  const lowStock = inv.lowStockList || [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <StatCard label="MTD sales" value={money(d.mtdSales)} sub={`Cost ${money(d.mtdCost)}`} icon={TrendingUp} />
        <StatCard label="YTD sales" value={money(d.ytdSales)} sub={`Cost ${money(d.ytdCost)}`} />
        <StatCard label="MTD profit" value={money(d.mtdProfit)} sub={pct(d.mtdMargin)} tone="success" />
        <StatCard label="YTD profit" value={money(d.ytdProfit)} sub={pct(d.ytdMargin)} tone="success" />
        <StatCard label="Unpaid" value={money(d.receivables && d.receivables.unpaidValue)} sub={`${fmtInt(d.receivables && d.receivables.unpaidCount)} orders`} tone="warning" />
        <StatCard label="Partial" value={money(d.receivables && d.receivables.partialValue)} sub={`${fmtInt(d.receivables && d.receivables.partialCount)} orders`} tone="warning" />
        <StatCard label="Inventory @ cost" value={money(inv.valueAtCost != null ? inv.valueAtCost : inv.value)} sub={`${fmtInt(inv.unitsOnHand != null ? inv.unitsOnHand : inv.units)} units on hand`} icon={PackageCheck} />
        <StatCard label="Credits" value={money(d.referralLiability)} sub="referral liability" icon={WalletCards} />
      </div>

      {/* Inventory valuation — active stock (onHand > 0) at canonical catalog MSRP/cost (simulation). */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
          <PackageCheck className="h-3.5 w-3.5" /> Inventory valuation
          <span className="font-normal normal-case text-faint">· active stock at catalog MSRP/cost · projected if sold at MSRP</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Units on hand" value={fmtInt(inv.unitsOnHand)} icon={PackageCheck} />
          <StatCard label="Value @ cost" value={money(inv.valueAtCost)} sub="what it cost" />
          <StatCard label="Value @ MSRP" value={money(inv.valueAtMsrp)} sub="if sold at list" tone="gold" icon={DollarSign} />
          <StatCard label="Projected profit" value={money(inv.projectedGrossProfit)} sub="MSRP − cost" tone="success" />
          <StatCard label="Projected margin" value={pct(inv.projectedMarginPct)} tone="success" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-1.5"><ReceiptText className="h-4 w-4 text-primary" /> Recent orders</CardTitle>
              <Link to="/admin/orders/list" className="text-xs font-semibold text-primary hover:underline">All orders →</Link>
            </div>
            <CardDescription>Newest first.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-1">
            <Table>
              <THead><TR><TH className="pl-5">Invoice</TH><TH>Customer</TH><TH>Total</TH><TH>Balance</TH><TH className="pr-5">Status</TH></TR></THead>
              <TBody>
                {recent.map((o) => (
                  <TR key={o.id}>
                    <TD className="pl-5 font-data text-foreground">{o.invoiceNumber}</TD>
                    <TD>{o.customerName}</TD>
                    <TD>{money(o.total)}</TD>
                    <TD>{money(o.balanceDue)}</TD>
                    <TD className="pr-5"><Badge tone={opsStatusTone(o.paymentStatus)}>{o.paymentStatus}</Badge></TD>
                  </TR>
                ))}
                {!recent.length && <TR><TD colSpan={5}><EmptyState title="No orders yet" hint="Create one from the New Order tab." icon={ReceiptText} /></TD></TR>}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-warning" /> Low stock</CardTitle>
              <CardDescription>{fmtInt((d.inventory && d.inventory.lowStockCount) || 0)} item(s) at or below threshold.</CardDescription>
            </CardHeader>
            <CardContent>
              {lowStock.length ? (
                <ul className="space-y-1.5">
                  {lowStock.slice(0, 8).map((iv) => (
                    <li key={iv.productId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-foreground">{iv.name}</span>
                      <Badge tone="warning">{fmtInt(iv.onHand)} on hand</Badge>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="Stock levels healthy" icon={PackageCheck} />}
              <Link to="/admin/orders/inventory" className="mt-3 inline-block text-xs font-semibold text-primary hover:underline">Manage inventory →</Link>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <Card><CardContent className="pt-4">
              <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint"><Truck className="h-3.5 w-3.5" /> Supplier balances</div>
              <div className="mt-1 font-data text-xl font-semibold text-foreground">{money(d.supplierBalances)}</div>
              <Link to="/admin/orders/suppliers" className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">Suppliers →</Link>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint"><WalletCards className="h-3.5 w-3.5" /> Referral liability</div>
              <div className="mt-1 font-data text-xl font-semibold text-foreground">{money(d.referralLiability)}</div>
              <Link to="/admin/orders/referrals" className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">Referral credits →</Link>
            </CardContent></Card>
          </div>
        </div>
      </div>
    </div>
  );
}
