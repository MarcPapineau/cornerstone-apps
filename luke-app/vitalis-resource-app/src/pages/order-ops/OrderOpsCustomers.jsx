/**
 * OrderOpsCustomers (/admin/orders/customers) — the customer book: spend, order count, credit
 * balance; select a customer to see their order history (derived from /api/ops/orders). Read-only.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, ReceiptText } from 'lucide-react';
import api from '../../lib/api.js';
import { fmtInt } from '../../lib/utils.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/ui/States.jsx';
import { cn } from '../../lib/utils.js';
import { money, opsStatusTone } from './opsShared.jsx';

export default function OrderOpsCustomers() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([api.opsCustomers(), api.opsOrders()])
      .then(([c, o]) => { if (alive) setData({ customers: c.customers || [], orders: o.orders || [] }); })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, []);

  const customers = (data && data.customers) || [];
  const orders = (data && data.orders) || [];
  const selectedOrders = useMemo(
    () => orders.filter((o) => o.customerId === selectedId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [orders, selectedId],
  );
  const selected = customers.find((c) => c.id === selectedId) || null;

  if (data == null && !error) return <Loading label="Loading customers…" />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-1.5"><Users className="h-4 w-4 text-primary" /> Customers</CardTitle><CardDescription>Select a row to see order history.</CardDescription></CardHeader>
        <CardContent className="px-0 pb-1">
          <Table>
            <THead><TR><TH className="pl-5">Name</TH><TH>Contact</TH><TH>Orders</TH><TH>Spend</TH><TH className="pr-5">Credit</TH></TR></THead>
            <TBody>
              {customers.map((c) => (
                <TR key={c.id} onClick={() => setSelectedId(c.id)} className={cn('cursor-pointer', selectedId === c.id && 'bg-muted/50')}>
                  <TD className="pl-5 font-medium"><Link to={`/admin/orders/customers/${encodeURIComponent(c.id)}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{c.name}</Link>{c._demo && <Badge tone="warning" className="ml-1.5">demo</Badge>}</TD>
                  <TD className="text-2xs text-soft">{c.phone || c.email || '—'}</TD>
                  <TD className="font-data">{fmtInt(c.orderCount)}</TD>
                  <TD className="font-data">{money(c.totalSpend)}</TD>
                  <TD className="pr-5 font-data">{money(c.creditBalance)}</TD>
                </TR>
              ))}
              {!customers.length && <TR><TD colSpan={5}><EmptyState title="No customers yet" hint="Add one from the New Order tab." icon={Users} /></TD></TR>}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{selected ? `${selected.name} — order history` : 'Order history'}</CardTitle>
          <CardDescription>{selected ? `${fmtInt(selectedOrders.length)} order(s)` : 'Select a customer to view their orders.'}</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-1">
          {!selected ? <EmptyState title="No customer selected" icon={Users} /> : (
            <Table>
              <THead><TR><TH className="pl-5">Invoice</TH><TH>Date</TH><TH>Total</TH><TH>Balance</TH><TH className="pr-5">Status</TH></TR></THead>
              <TBody>
                {selectedOrders.map((o) => (
                  <TR key={o.id}>
                    <TD className="pl-5 font-data text-foreground">{o.invoiceNumber}</TD>
                    <TD className="text-2xs text-soft">{String(o.createdAt || '').slice(0, 10)}</TD>
                    <TD>{money(o.total)}</TD>
                    <TD>{money(o.balanceDue)}</TD>
                    <TD className="pr-5"><Badge tone={opsStatusTone(o.paymentStatus)}>{o.paymentStatus}</Badge></TD>
                  </TR>
                ))}
                {!selectedOrders.length && <TR><TD colSpan={5}><EmptyState title="No orders for this customer" icon={ReceiptText} /></TD></TR>}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
