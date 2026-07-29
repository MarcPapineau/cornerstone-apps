/**
 * OrderOpsNewOrder (/admin/orders/new) — build an order: pick/create a customer, search the
 * canonical catalog, add line items with live subtotal/cost/profit/margin, set payment + optional
 * referral credit, then create the order and hand off the invoice (copy / print / SMS-draft /
 * Telegram-share — never a live send). All pricing is catalog-driven; there is no discount logic.
 */
import { useEffect, useMemo, useState } from 'react';
import { ShoppingCart, ReceiptText } from 'lucide-react';
import api from '../../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';
import { StatCard } from '../../components/ui/StatCard.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/ui/States.jsx';
import { money, pct, InvoiceHandoff } from './opsShared.jsx';

export default function OrderOpsNewOrder() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '' });
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [filter, setFilter] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [lines, setLines] = useState([]);
  const [paymentStatus, setPaymentStatus] = useState('UNPAID');
  const [amountPaid, setAmountPaid] = useState('');
  const [referralCustomerId, setReferralCustomerId] = useState('');
  const [referralAmount, setReferralAmount] = useState('');
  const [invoice, setInvoice] = useState(null);

  async function load() {
    setError(null); setLoading(true);
    try {
      const [catalog, customers] = await Promise.all([api.opsCatalog(), api.opsCustomers()]);
      setData({ catalog, customers });
      if (!selectedCustomerId && customers.customers && customers.customers[0]) setSelectedCustomerId(customers.customers[0].id);
      if (!selectedProductId && catalog.products && catalog.products[0]) setSelectedProductId(catalog.products[0].id);
    } catch (e) { setError(e); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const products = (data && data.catalog && data.catalog.products) || [];
  const customers = (data && data.customers && data.customers.customers) || [];
  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const visibleProducts = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return products.filter((p) => !q || [p.name, p.sku, p.supplier, p.category].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 80);
  }, [products, filter]);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.price || 0), 0);
    const cost = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.cost || 0), 0);
    const profit = subtotal - cost;
    return { subtotal, cost, profit, margin: subtotal > 0 ? (profit / subtotal) * 100 : 0 };
  }, [lines]);

  function addLine(productId = selectedProductId) {
    const p = productById[productId];
    if (!p) return;
    setLines((cur) => [...cur, { productId: p.id, name: p.name, qty: 1, price: p.price || p.msrp || 0, cost: p.cost || 0 }]);
  }
  const updateLine = (i, patch) => setLines((cur) => cur.map((l, x) => (x === i ? { ...l, ...patch } : l)));
  const removeLine = (i) => setLines((cur) => cur.filter((_, x) => x !== i));

  async function createCustomer() {
    if (!customerForm.name.trim()) return;
    setBusy(true);
    try {
      const res = await api.opsCreateCustomer(customerForm);
      setSelectedCustomerId(res.customer.id);
      setCustomerForm({ name: '', phone: '', email: '' });
      await load();
      setMessage('Customer saved.');
    } catch (e) { setMessage(e.message || 'Could not save customer.'); } finally { setBusy(false); }
  }

  async function createOrder() {
    if (!selectedCustomerId || !lines.length) return;
    setBusy(true); setInvoice(null);
    try {
      const res = await api.opsCreateOrder({
        customerId: selectedCustomerId,
        items: lines.map((l) => ({ productId: l.productId, qty: Number(l.qty), price: Number(l.price), cost: Number(l.cost) })),
        paymentStatus,
        amountPaid: Number(amountPaid || 0),
        referralCreditForCustomerId: referralCustomerId || null,
        referralCreditAmount: Number(referralAmount || 0),
      });
      const inv = await api.opsInvoice(res.order.id);
      setInvoice(inv.invoice);
      setLines([]); setAmountPaid(''); setReferralAmount('');
      await load();
      setMessage(`Order ${res.order.invoiceNumber} created.`);
    } catch (e) { setMessage(e.message || 'Could not create order.'); } finally { setBusy(false); }
  }

  if (loading) return <Loading label="Loading catalog + customers…" />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className="space-y-4">
      {message && <div className="rounded-md border border-success/20 bg-success-soft px-3 py-2 text-sm text-success">{message}</div>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><ShoppingCart className="h-4 w-4 text-primary" /> New order</CardTitle>
            <CardDescription>Catalog-connected pricing. Live cost, profit, and margin before you submit.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <FormField label="Existing customer">
                <Select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)}>
                  <option value="">Choose customer</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </FormField>
              <FormField label="New customer name">
                <Input value={customerForm.name} onChange={(e) => setCustomerForm((s) => ({ ...s, name: e.target.value }))} placeholder="Name" />
              </FormField>
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <FormField label="Phone">
                  <Input value={customerForm.phone} onChange={(e) => setCustomerForm((s) => ({ ...s, phone: e.target.value }))} placeholder="+1…" />
                </FormField>
                <Button variant="outline" onClick={createCustomer} disabled={busy || !customerForm.name}>Save</Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <FormField label="Find product">
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search catalog, SKU, supplier" />
              </FormField>
              <FormField label="Add product">
                <Select value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)}>
                  {visibleProducts.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.price)} · {p.onHand} on hand</option>)}
                </Select>
              </FormField>
              <Button onClick={() => addLine()} disabled={!selectedProductId}>Add item</Button>
            </div>

            <Table>
              <THead><TR><TH>Item</TH><TH>Qty</TH><TH>Price</TH><TH>Cost</TH><TH className="text-right">Profit</TH><TH /></TR></THead>
              <TBody>
                {lines.map((line, i) => (
                  <TR key={`${line.productId}-${i}`}>
                    <TD className="font-medium text-foreground">{line.name}</TD>
                    <TD><Input type="number" min="1" value={line.qty} onChange={(e) => updateLine(i, { qty: e.target.value })} className="w-20" /></TD>
                    <TD><Input type="number" value={line.price} onChange={(e) => updateLine(i, { price: e.target.value })} className="w-28" /></TD>
                    <TD><Input type="number" value={line.cost} onChange={(e) => updateLine(i, { cost: e.target.value })} className="w-28" /></TD>
                    <TD className="text-right font-data text-foreground">{money((line.price - line.cost) * line.qty)}</TD>
                    <TD><Button variant="ghost" size="sm" onClick={() => removeLine(i)}>Remove</Button></TD>
                  </TR>
                ))}
                {!lines.length && <TR><TD colSpan={6}><EmptyState title="No order lines yet" hint="Add a product above." icon={ReceiptText} /></TD></TR>}
              </TBody>
            </Table>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Subtotal" value={money(totals.subtotal)} />
              <StatCard label="Cost" value={money(totals.cost)} />
              <StatCard label="Profit" value={money(totals.profit)} tone="success" />
              <StatCard label="Margin" value={pct(totals.margin)} />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormField label="Payment status">
                <Select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
                  <option>UNPAID</option><option>PARTIAL</option><option>PAID</option>
                </Select>
              </FormField>
              <FormField label="Amount paid">
                <Input type="number" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder="0" />
              </FormField>
              <FormField label="Credit referral to" hint="Earns the referrer account credit — no %, profit, or cost shown.">
                <Select value={referralCustomerId} onChange={(e) => setReferralCustomerId(e.target.value)}>
                  <option value="">No referral credit</option>
                  {customers.filter((c) => c.id !== selectedCustomerId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </FormField>
              <FormField label="Referral amount">
                <Input type="number" value={referralAmount} onChange={(e) => setReferralAmount(e.target.value)} placeholder="0" />
              </FormField>
            </div>

            <Button className="w-full" onClick={createOrder} disabled={busy || !selectedCustomerId || !lines.length}>
              <ReceiptText className="h-4 w-4" /> Create order + invoice
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoice handoff</CardTitle>
            <CardDescription>No live send. Copy, print, SMS draft, or Telegram share draft.</CardDescription>
          </CardHeader>
          <CardContent>
            <InvoiceHandoff invoice={invoice} onMessage={setMessage} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
