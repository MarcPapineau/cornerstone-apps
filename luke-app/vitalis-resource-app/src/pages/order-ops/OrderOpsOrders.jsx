/**
 * OrderOpsOrders (/admin/orders/list) — every order with payment status, balance, profit, margin,
 * quick payment actions, and an invoice re-open panel (copy / print / SMS-draft / Telegram-share —
 * never a live send). Paid/Unpaid are one-click; "Partial" opens a compact inline amount editor
 * (no window.prompt). The editor sits inside the card above the table so it stays mobile-safe.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ReceiptText, RefreshCw } from 'lucide-react';
import api from '../../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Field.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/ui/States.jsx';
import { money, pct, opsStatusTone, InvoiceHandoff } from './opsShared.jsx';

export default function OrderOpsOrders() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [invoice, setInvoice] = useState(null);
  const [openId, setOpenId] = useState('');

  // Inline "Partial" editor (replaces window.prompt): which order is being edited + the amount + error.
  const [partialFor, setPartialFor] = useState('');
  const [partialAmount, setPartialAmount] = useState('');
  const [fieldError, setFieldError] = useState('');

  async function load() {
    setError(null);
    try { const res = await api.opsOrders(); setOrders(res.orders || []); }
    catch (e) { setError(e); }
  }
  useEffect(() => { load(); }, []);

  async function updatePayment(order, amount) {
    setBusy(true);
    try { await api.opsUpdatePayment(order.id, { amountPaid: amount }); await load(); setMessage(`Updated ${order.invoiceNumber}.`); }
    catch (e) { setMessage(e.message || 'Update failed.'); } finally { setBusy(false); }
  }

  function openPartial(o) { setPartialFor(o.id); setPartialAmount(String(o.amountPaid || '')); setFieldError(''); }
  function cancelPartial() { setPartialFor(''); setPartialAmount(''); setFieldError(''); }
  async function applyPartial(o) {
    const amt = Number(partialAmount);
    if (partialAmount === '' || Number.isNaN(amt) || amt < 0) { setFieldError('Enter a valid amount (0 or more).'); return; }
    await updatePayment(o, amt);
    cancelPartial();
  }

  async function openInvoice(order) {
    setBusy(true); setInvoice(null); setOpenId(order.id);
    try { const inv = await api.opsInvoice(order.id); setInvoice(inv.invoice); }
    catch (e) { setMessage(e.message || 'Could not load invoice.'); } finally { setBusy(false); }
  }

  if (orders == null && !error) return <Loading label="Loading orders…" />;
  if (error) return <ErrorState error={error} />;

  const partialOrder = (orders || []).find((o) => o.id === partialFor) || null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        {message ? <div className="rounded-md border border-success/20 bg-success-soft px-3 py-1.5 text-sm text-success">{message}</div> : <span />}
        <Button variant="outline" size="sm" onClick={load} disabled={busy}><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Orders</CardTitle><CardDescription>Payment status, balance, margin, and quick collection actions.</CardDescription></CardHeader>
          <CardContent className="px-0 pb-1">
            {partialOrder && (
              <div className="mx-5 mb-3 rounded-md border border-border bg-muted/40 p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="grid gap-1 text-2xs font-medium text-soft">
                    <span>Amount paid · {partialOrder.invoiceNumber}</span>
                    <Input
                      type="number" min="0" step="0.01" value={partialAmount} autoFocus className="w-36"
                      onChange={(e) => { setPartialAmount(e.target.value); if (fieldError) setFieldError(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') applyPartial(partialOrder); if (e.key === 'Escape') cancelPartial(); }}
                    />
                  </label>
                  <Button size="sm" onClick={() => applyPartial(partialOrder)} disabled={busy}>Apply</Button>
                  <Button size="sm" variant="ghost" onClick={cancelPartial} disabled={busy}>Cancel</Button>
                  <span className="text-2xs text-faint">Total {money(partialOrder.total)} · status updates on apply</span>
                </div>
                {fieldError && <p className="mt-1.5 text-2xs text-danger">{fieldError}</p>}
              </div>
            )}
            <Table>
              <THead><TR><TH className="pl-5">Invoice</TH><TH>Customer</TH><TH>Total</TH><TH>Paid</TH><TH>Balance</TH><TH>Profit</TH><TH>Margin</TH><TH>Status</TH><TH className="pr-5" /></TR></THead>
              <TBody>
                {(orders || []).map((o) => (
                  <TR key={o.id} className={partialFor === o.id ? 'bg-muted/30' : undefined}>
                    <TD className="pl-5 font-data"><Link to={`/admin/orders/${encodeURIComponent(o.id)}`} className="text-primary hover:underline">{o.invoiceNumber}</Link></TD>
                    <TD>{o.customerName}</TD>
                    <TD>{money(o.total)}</TD>
                    <TD>{money(o.amountPaid)}</TD>
                    <TD>{money(o.balanceDue)}</TD>
                    <TD className="text-success">{money(o.grossProfit)}</TD>
                    <TD>{pct(o.marginPct)}</TD>
                    <TD><Badge tone={opsStatusTone(o.paymentStatus)}>{o.paymentStatus}</Badge></TD>
                    <TD className="space-x-1 whitespace-nowrap pr-5 text-right">
                      <Button variant="ghost" size="sm" onClick={() => updatePayment(o, o.total)} disabled={busy}>Paid</Button>
                      <Button variant="ghost" size="sm" onClick={() => updatePayment(o, 0)} disabled={busy}>Unpaid</Button>
                      <Button variant={partialFor === o.id ? 'subtle' : 'ghost'} size="sm" disabled={busy} onClick={() => (partialFor === o.id ? cancelPartial() : openPartial(o))}>Partial</Button>
                      <Button variant="outline" size="sm" onClick={() => openInvoice(o)} disabled={busy}>Invoice</Button>
                    </TD>
                  </TR>
                ))}
                {!(orders || []).length && <TR><TD colSpan={9}><EmptyState title="No orders yet" hint="Create one from the New Order tab." icon={ReceiptText} /></TD></TR>}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Invoice handoff</CardTitle><CardDescription>{openId ? 'Re-opened invoice — copy / draft only.' : 'Click “Invoice” on a row to re-open it.'}</CardDescription></CardHeader>
          <CardContent><InvoiceHandoff invoice={invoice} onMessage={setMessage} /></CardContent>
        </Card>
      </div>
    </div>
  );
}
