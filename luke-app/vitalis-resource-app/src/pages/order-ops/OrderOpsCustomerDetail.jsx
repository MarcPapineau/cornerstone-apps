/**
 * OrderOpsCustomerDetail (/admin/orders/customers/:id) — one customer's profile, order history, and
 * referral account + ledger, from /api/ops/customers/:id (admin-gated). Read-only. The exact
 * simulation banner comes from OrderOpsLayout (this renders inside its <Outlet/>).
 */
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Users, ReceiptText, WalletCards } from 'lucide-react';
import api from '../../lib/api.js';
import { fmtInt } from '../../lib/utils.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card.jsx';
import { StatCard } from '../../components/ui/StatCard.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/ui/States.jsx';
import { money, opsStatusTone } from './opsShared.jsx';

export default function OrderOpsCustomerDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    api.opsCustomer(id)
      .then((res) => { if (alive) setData(res); })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [id]);

  if (data == null && !error) return <Loading label="Loading customer…" />;
  if (error) return <ErrorState error={error} />;

  const { customer, orders = [], referralAccount = null, ledger = [] } = data;

  return (
    <div className="space-y-4">
      <Link to="/admin/orders/customers" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> Customers</Link>

      <div className="flex flex-wrap items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">{customer.name}</h2>
        {customer._demo && <Badge tone="warning">demo</Badge>}
        <span className="text-2xs text-soft">{customer.phone || customer.email || '—'}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Orders" value={fmtInt(customer.orderCount)} />
        <StatCard label="Total spend" value={money(customer.totalSpend)} />
        <StatCard label="Account credit" value={money(referralAccount ? referralAccount.creditBalance : customer.creditBalance)} tone="gold" icon={WalletCards} />
        <StatCard label="Credit earned" value={money(referralAccount ? referralAccount.totalEarned : 0)} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-1.5"><ReceiptText className="h-4 w-4 text-primary" /> Order history</CardTitle><CardDescription>{fmtInt(orders.length)} order(s), newest first.</CardDescription></CardHeader>
          <CardContent className="px-0 pb-1">
            <Table>
              <THead><TR><TH className="pl-5">Invoice</TH><TH>Date</TH><TH>Total</TH><TH>Balance</TH><TH className="pr-5">Status</TH></TR></THead>
              <TBody>
                {orders.map((o) => (
                  <TR key={o.id}>
                    <TD className="pl-5 font-data"><Link to={`/admin/orders/${encodeURIComponent(o.id)}`} className="text-primary hover:underline">{o.invoiceNumber}</Link></TD>
                    <TD className="text-2xs text-soft">{String(o.createdAt || '').slice(0, 10)}</TD>
                    <TD>{money(o.total)}</TD>
                    <TD>{money(o.balanceDue)}</TD>
                    <TD className="pr-5"><Badge tone={opsStatusTone(o.paymentStatus)}>{o.paymentStatus}</Badge></TD>
                  </TR>
                ))}
                {!orders.length && <TR><TD colSpan={5}><EmptyState title="No orders for this customer" icon={ReceiptText} /></TD></TR>}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-1.5"><WalletCards className="h-4 w-4 text-primary" /> Referral ledger</CardTitle><CardDescription>Account credit only — no %, profit, or cost.</CardDescription></CardHeader>
          <CardContent className="px-0 pb-1">
            {!referralAccount ? <EmptyState title="No referral account" hint="This customer has no referral credit account." icon={WalletCards} /> : (
              <Table>
                <THead><TR><TH className="pl-5">Date</TH><TH>Type</TH><TH className="pr-5">Amount</TH></TR></THead>
                <TBody>
                  {ledger.map((l) => (
                    <TR key={l.id}>
                      <TD className="pl-5 text-2xs text-soft">{String(l.createdAt || '').slice(0, 10)}</TD>
                      <TD><Badge tone={l.type === 'CREDIT' ? 'success' : 'warning'}>{l.type}</Badge></TD>
                      <TD className="pr-5 font-data">{money(l.amount)}</TD>
                    </TR>
                  ))}
                  {!ledger.length && <TR><TD colSpan={3}><EmptyState title="No ledger entries" icon={WalletCards} /></TD></TR>}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
