/**
 * OrderOpsOrderDetail (/admin/orders/:id) — inspect + drive one order. Shows summary stats, line
 * items, notes, lifecycle controls (Draft/Sent/Paid/Void), payment, and the invoice handoff. Line
 * items are editable ONLY while the invoice is DRAFT (server-enforced); SENT/PAID/VOID render
 * read-only. invoiceStatus is the workflow axis; paymentStatus is derived from amount paid. The
 * exact simulation banner comes from OrderOpsLayout (this page renders inside its <Outlet/>).
 */
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ReceiptText, StickyNote } from 'lucide-react';
import api from '../../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Input, Textarea } from '../../components/ui/Field.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { StatCard } from '../../components/ui/StatCard.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/ui/States.jsx';
import { money, pct, opsStatusTone, InvoiceHandoff } from './opsShared.jsx';

const LIFECYCLE = [
  { s: 'DRAFT', label: 'Mark Draft' }, { s: 'SENT', label: 'Mark Sent' },
  { s: 'PAID', label: 'Mark Paid' }, { s: 'VOID', label: 'Void' },
];

export default function OrderOpsOrderDetail() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [invoice, setInvoice] = useState(null);
  const [lines, setLines] = useState([]);
  const [notes, setNotes] = useState('');
  const [amountPaid, setAmountPaid] = useState('');

  function hydrate(o) {
    setOrder(o);
    setLines((o.items || []).map((it) => ({ ...it })));
    setNotes(o.notes || '');
    setAmountPaid(String(o.amountPaid || ''));
  }
  async function load() {
    setError(null);
    try { const res = await api.opsOrder(id); hydrate(res.order); }
    catch (e) { setError(e); }
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(payload, msg) {
    setBusy(true);
    try { const res = await api.opsUpdateOrder(id, payload); hydrate(res.order); setMessage(msg); }
    catch (e) { setMessage(e.message || 'Update failed.'); } finally { setBusy(false); }
  }

  const updateLine = (i, p) => setLines((cur) => cur.map((l, x) => (x === i ? { ...l, ...p } : l)));
  const removeLine = (i) => setLines((cur) => cur.filter((_, x) => x !== i));
  function applyLines() {
    if (!lines.length) { setMessage('Keep at least one line item.'); return; }
    patch({ items: lines.map((l) => ({ productId: l.productId, qty: Number(l.qty), price: Number(l.price), cost: Number(l.cost) })) }, 'Line items updated.');
  }
  function applyPayment() {
    const amt = Number(amountPaid);
    if (amountPaid === '' || Number.isNaN(amt) || amt < 0) { setMessage('Enter a valid amount (0 or more).'); return; }
    patch({ amountPaid: amt }, 'Payment updated.');
  }
  async function openInvoice() {
    setBusy(true);
    try { const inv = await api.opsInvoice(id); setInvoice(inv.invoice); }
    catch (e) { setMessage(e.message || 'Could not load invoice.'); } finally { setBusy(false); }
  }

  if (order == null && !error) return <Loading label="Loading order…" />;
  if (error) return <ErrorState error={error} />;

  const isDraft = order.invoiceStatus === 'DRAFT';
  const previewSubtotal = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.price || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/admin/orders/list" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> Orders</Link>
        {message && <span className="rounded-md border border-success/20 bg-success-soft px-3 py-1 text-2xs text-success">{message}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-data text-lg font-semibold text-foreground">{order.invoiceNumber}</h2>
        <Badge tone={opsStatusTone(order.invoiceStatus)}>{order.invoiceStatus}</Badge>
        <Badge tone={opsStatusTone(order.paymentStatus)}>{order.paymentStatus}</Badge>
        <span className="text-sm text-soft">·</span>
        <Link to={`/admin/orders/customers/${encodeURIComponent(order.customerId)}`} className="text-sm font-medium text-primary hover:underline">{order.customerName}</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total" value={money(order.total)} />
        <StatCard label="Paid" value={money(order.amountPaid)} />
        <StatCard label="Balance" value={money(order.balanceDue)} tone={order.balanceDue > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Profit" value={money(order.grossProfit)} tone="success" />
        <StatCard label="Margin" value={pct(order.marginPct)} />
      </div>

      <Card>
        <CardHeader><CardTitle>Lifecycle</CardTitle><CardDescription>Workflow status (independent of payment). Items can be edited only while DRAFT.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {LIFECYCLE.map(({ s, label }) => (
            <Button key={s} size="sm" variant={order.invoiceStatus === s ? 'subtle' : 'outline'} disabled={busy || order.invoiceStatus === s} onClick={() => patch({ invoiceStatus: s }, `Marked ${s}.`)}>{label}</Button>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Line items</CardTitle>
            <CardDescription>{isDraft ? 'Editable while DRAFT. Adjust qty/price/cost, then apply.' : 'Read-only — return to DRAFT to edit.'}</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-1">
            <Table>
              <THead><TR><TH className="pl-5">Item</TH><TH>Qty</TH><TH>Price</TH><TH>Cost</TH><TH className="text-right">Line total</TH>{isDraft && <TH className="pr-5" />}</TR></THead>
              <TBody>
                {(isDraft ? lines : order.items || []).map((l, i) => (
                  <TR key={`${l.productId}-${i}`}>
                    <TD className="pl-5 text-foreground">{l.name}</TD>
                    {isDraft ? (
                      <>
                        <TD><Input type="number" min="1" value={l.qty} onChange={(e) => updateLine(i, { qty: e.target.value })} className="w-16" /></TD>
                        <TD><Input type="number" value={l.price} onChange={(e) => updateLine(i, { price: e.target.value })} className="w-24" /></TD>
                        <TD><Input type="number" value={l.cost} onChange={(e) => updateLine(i, { cost: e.target.value })} className="w-24" /></TD>
                        <TD className="text-right font-data">{money((l.price - l.cost) * l.qty)}</TD>
                        <TD className="pr-5 text-right"><Button variant="ghost" size="sm" onClick={() => removeLine(i)} disabled={busy}>Remove</Button></TD>
                      </>
                    ) : (
                      <>
                        <TD className="font-data">{l.qty}</TD>
                        <TD className="font-data">{money(l.price)}</TD>
                        <TD className="font-data">{money(l.cost)}</TD>
                        <TD className="text-right font-data">{money(l.lineTotal)}</TD>
                      </>
                    )}
                  </TR>
                ))}
                {!(order.items || []).length && <TR><TD colSpan={isDraft ? 6 : 5}><EmptyState title="No line items" icon={ReceiptText} /></TD></TR>}
              </TBody>
            </Table>
            {isDraft && (
              <div className="flex items-center justify-between gap-2 px-5 pt-3">
                <span className="text-2xs text-faint">Preview subtotal {money(previewSubtotal)} · server recalculates totals + inventory on apply</span>
                <Button size="sm" onClick={applyLines} disabled={busy || !lines.length}>Apply line changes</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Payment</CardTitle><CardDescription>Amount paid drives the payment status + balance.</CardDescription></CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-2xs font-medium text-soft">
                  <span>Amount paid</span>
                  <Input type="number" min="0" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} className="w-36" />
                </label>
                <Button size="sm" onClick={applyPayment} disabled={busy}>Apply</Button>
                <span className="text-2xs text-faint">Balance {money(order.balanceDue)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5"><StickyNote className="h-4 w-4 text-primary" /> Notes</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal note (operator-only)…" />
              <Button size="sm" variant="outline" onClick={() => patch({ notes }, 'Notes saved.')} disabled={busy}>Save notes</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>Invoice handoff</CardTitle>
                <Button size="sm" variant="outline" onClick={openInvoice} disabled={busy}>Load invoice</Button>
              </div>
              <CardDescription>No live send — copy / print / SMS draft / Telegram share.</CardDescription>
            </CardHeader>
            <CardContent><InvoiceHandoff invoice={invoice} onMessage={setMessage} /></CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
