/**
 * OrderOpsSuppliers (/admin/orders/suppliers) — create a supplier order (Biogenix / JH Strong /
 * custom), track status + payment balance, and mark received (which restocks inventory).
 */
import { useEffect, useState } from 'react';
import { Truck } from 'lucide-react';
import api from '../../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/ui/States.jsx';
import { money, opsStatusTone } from './opsShared.jsx';

export default function OrderOpsSuppliers() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ supplier: 'Biogenix', productId: '', qty: '1', unitCost: '', amountPaid: '' });

  async function load() {
    setError(null);
    try {
      const [supplierOrders, catalog] = await Promise.all([api.opsSupplierOrders(), api.opsCatalog()]);
      setData({ supplierOrders: supplierOrders.supplierOrders || [], products: catalog.products || [] });
      if (!form.productId && catalog.products && catalog.products[0]) {
        setForm((s) => ({ ...s, productId: catalog.products[0].id, unitCost: String(catalog.products[0].cost || '') }));
      }
    } catch (e) { setError(e); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const supplierOrders = (data && data.supplierOrders) || [];
  const products = (data && data.products) || [];
  const productById = Object.fromEntries(products.map((p) => [p.id, p]));

  async function create() {
    if (!form.productId) return;
    setBusy(true);
    try {
      await api.opsCreateSupplierOrder({
        supplier: form.supplier,
        items: [{ productId: form.productId, qty: Number(form.qty || 1), unitCost: Number(form.unitCost || (productById[form.productId] || {}).cost || 0) }],
        amountPaid: Number(form.amountPaid || 0),
      });
      setForm((s) => ({ ...s, qty: '1', amountPaid: '' }));
      await load(); setMessage('Supplier order created.');
    } catch (e) { setMessage(e.message || 'Could not create supplier order.'); } finally { setBusy(false); }
  }

  async function markReceived(so) {
    setBusy(true);
    try { await api.opsUpdateSupplierOrder(so.id, { orderStatus: 'RECEIVED', restock: true }); await load(); setMessage('Marked received + restocked.'); }
    catch (e) { setMessage(e.message || 'Update failed.'); } finally { setBusy(false); }
  }

  if (data == null && !error) return <Loading label="Loading supplier orders…" />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className="space-y-4">
      {message && <div className="rounded-md border border-success/20 bg-success-soft px-3 py-1.5 text-sm text-success">{message}</div>}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-1.5"><Truck className="h-4 w-4 text-primary" /> New supplier order</CardTitle><CardDescription>Track Biogenix / JH Strong / custom costs, paid amounts, balances, and receiving.</CardDescription></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5 md:items-end">
            <FormField label="Supplier">
              <Select value={form.supplier} onChange={(e) => setForm((s) => ({ ...s, supplier: e.target.value }))}>
                <option>Biogenix</option><option>JH Strong</option><option>Other</option>
              </Select>
            </FormField>
            <FormField label="Product">
              <Select value={form.productId} onChange={(e) => { const p = productById[e.target.value]; setForm((s) => ({ ...s, productId: e.target.value, unitCost: String((p && p.cost) || '') })); }}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </FormField>
            <FormField label="Qty"><Input type="number" value={form.qty} onChange={(e) => setForm((s) => ({ ...s, qty: e.target.value }))} /></FormField>
            <FormField label="Unit cost"><Input type="number" value={form.unitCost} onChange={(e) => setForm((s) => ({ ...s, unitCost: e.target.value }))} /></FormField>
            <FormField label="Amount paid"><Input type="number" value={form.amountPaid} onChange={(e) => setForm((s) => ({ ...s, amountPaid: e.target.value }))} /></FormField>
          </div>
          <Button className="mt-3" onClick={create} disabled={busy || !form.productId}>Create supplier order</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Supplier orders</CardTitle><CardDescription>Mark received to restock inventory.</CardDescription></CardHeader>
        <CardContent className="px-0 pb-1">
          <Table>
            <THead><TR><TH className="pl-5">Supplier</TH><TH>Items</TH><TH>Total</TH><TH>Paid</TH><TH>Balance</TH><TH>Status</TH><TH className="pr-5" /></TR></THead>
            <TBody>
              {supplierOrders.map((s) => (
                <TR key={s.id}>
                  <TD className="pl-5 text-foreground">{s.supplier}</TD>
                  <TD className="text-2xs text-soft">{(s.items || []).length}</TD>
                  <TD>{money(s.totalCost)}</TD>
                  <TD>{money(s.amountPaid)}</TD>
                  <TD>{money(s.balanceDue)}</TD>
                  <TD><Badge tone={opsStatusTone(s.orderStatus)}>{s.orderStatus}</Badge></TD>
                  <TD className="pr-5 text-right">
                    {s.orderStatus !== 'RECEIVED' && <Button variant="ghost" size="sm" onClick={() => markReceived(s)} disabled={busy}>Mark received</Button>}
                  </TD>
                </TR>
              ))}
              {!supplierOrders.length && <TR><TD colSpan={7}><EmptyState title="No supplier orders yet" icon={Truck} /></TD></TR>}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
