/**
 * OrderOpsInventory (/admin/orders/inventory) — on-hand levels, low-stock flags, cost value, a
 * manual adjust control (add / set / subtract), and the movement log (sales + restocks).
 */
import { useEffect, useMemo, useState } from 'react';
import { PackageCheck } from 'lucide-react';
import api from '../../lib/api.js';
import { fmtInt } from '../../lib/utils.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table.jsx';
import { StatCard } from '../../components/ui/StatCard.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/ui/States.jsx';
import { money, pct, today } from './opsShared.jsx';

export default function OrderOpsInventory() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [productId, setProductId] = useState('');
  const [mode, setMode] = useState('add');
  const [qty, setQty] = useState('');

  async function load() {
    setError(null);
    try {
      const res = await api.opsInventory();
      setData(res);
      if (!productId && res.items && res.items[0]) setProductId(res.items[0].productId);
    } catch (e) { setError(e); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const items = (data && data.items) || [];
  const movements = (data && data.movements) || [];
  // /api/ops/inventory returns EVERY catalog product (0 on-hand for un-stocked ones). The on-hand
  // table + summary count only STOCKED products, so "low" means actually-low and the figures match
  // the Overview (otherwise 100+ never-stocked catalog rows would read as false "low" + a huge
  // table). The adjust dropdown below still lists ALL products, so any item can be stocked.
  const stocked = useMemo(() => items.filter((i) => (i.onHand || 0) > 0), [items]);
  const totalValue = useMemo(() => stocked.reduce((s, i) => s + (i.valueAtCost != null ? i.valueAtCost : (i.onHand || 0) * (i.cost || 0)), 0), [stocked]);
  const totalUnits = useMemo(() => stocked.reduce((s, i) => s + (i.onHand || 0), 0), [stocked]);
  const lowCount = useMemo(() => stocked.filter((i) => i.lowStock).length, [stocked]);
  // Valuation totals — active stock only; per-item valueAt* comes from the server (canonical catalog MSRP/cost).
  const valueAtMsrp = useMemo(() => stocked.reduce((s, i) => s + (i.valueAtMsrp != null ? i.valueAtMsrp : (i.onHand || 0) * (i.msrp || 0)), 0), [stocked]);
  const projectedProfit = valueAtMsrp - totalValue;
  const projectedMargin = valueAtMsrp > 0 ? (projectedProfit / valueAtMsrp) * 100 : 0;

  async function adjust() {
    if (!productId || !qty) return;
    setBusy(true);
    try {
      await api.opsInventoryAdjust({ productId, mode, qty: Number(qty), reason: `Manual ${mode} on ${today()}` });
      setQty(''); await load(); setMessage('Inventory updated.');
    } catch (e) { setMessage(e.message || 'Adjustment failed.'); } finally { setBusy(false); }
  }

  if (data == null && !error) return <Loading label="Loading inventory…" />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className="space-y-4">
      {message && <div className="rounded-md border border-success/20 bg-success-soft px-3 py-1.5 text-sm text-success">{message}</div>}

      {/* Valuation — active stock (onHand > 0) at canonical catalog MSRP/cost; projected if sold at MSRP. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Units on hand" value={fmtInt(totalUnits)} icon={PackageCheck} />
        <StatCard label="Value @ cost" value={money(totalValue)} sub="what it cost" />
        <StatCard label="Value @ MSRP" value={money(valueAtMsrp)} sub="if sold at list" tone="gold" />
        <StatCard label="Projected profit" value={money(projectedProfit)} sub="MSRP − cost" tone="success" />
        <StatCard label="Projected margin" value={pct(projectedMargin)} tone="success" />
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-1.5"><PackageCheck className="h-4 w-4 text-primary" /> Adjust stock</CardTitle><CardDescription>Manual intake/restock; orders auto-decrement on sale. Value {money(totalValue)} · {fmtInt(totalUnits)} units · {fmtInt(lowCount)} low.</CardDescription></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px_140px_auto] md:items-end">
            <FormField label="Product">
              <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
                {items.map((i) => <option key={i.productId} value={i.productId}>{i.name}</option>)}
              </Select>
            </FormField>
            <FormField label="Mode">
              <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="add">Add</option><option value="set">Set</option><option value="subtract">Subtract</option>
              </Select>
            </FormField>
            <FormField label="Qty"><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" /></FormField>
            <Button onClick={adjust} disabled={busy || !qty}>Apply</Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>On hand</CardTitle><CardDescription>Stocked products only; valued at canonical catalog MSRP/cost.</CardDescription></CardHeader>
          <CardContent className="px-0 pb-1">
            <div className="overflow-x-auto">
              <Table>
                <THead><TR>
                  <TH className="pl-5">Product</TH><TH>On hand</TH><TH>Cost</TH><TH>MSRP</TH>
                  <TH>Value @ cost</TH><TH>Value @ MSRP</TH><TH>Proj. profit</TH><TH>Margin</TH><TH className="pr-5">Status</TH>
                </TR></THead>
                <TBody>
                  {stocked.map((i) => (
                    <TR key={i.productId}>
                      <TD className="pl-5 text-foreground">{i.name}</TD>
                      <TD className="font-data text-foreground">{fmtInt(i.onHand)}</TD>
                      <TD className="font-data">{money(i.cost)}</TD>
                      <TD className="font-data">{money(i.msrp)}</TD>
                      <TD className="font-data">{money(i.valueAtCost != null ? i.valueAtCost : (i.onHand || 0) * (i.cost || 0))}</TD>
                      <TD className="font-data">{money(i.valueAtMsrp != null ? i.valueAtMsrp : (i.onHand || 0) * (i.msrp || 0))}</TD>
                      <TD className="font-data text-success">{money(i.projectedGrossProfit)}</TD>
                      <TD className="font-data">{pct(i.projectedMarginPct)}</TD>
                      <TD className="pr-5"><Badge tone={i.lowStock ? 'warning' : 'success'}>{i.lowStock ? 'LOW' : 'OK'}</Badge></TD>
                    </TR>
                  ))}
                  {!stocked.length && <TR><TD colSpan={9}><EmptyState title="No stock on hand yet" hint="Use Adjust stock to add inventory." icon={PackageCheck} /></TD></TR>}
                </TBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Movement log</CardTitle><CardDescription>Sales (−) and restocks (+), newest first.</CardDescription></CardHeader>
          <CardContent className="px-0 pb-1">
            <Table>
              <THead><TR><TH className="pl-5">Date</TH><TH>Type</TH><TH>Qty</TH><TH className="pr-5">Reason</TH></TR></THead>
              <TBody>
                {[...movements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20).map((m) => (
                  <TR key={m.id}>
                    <TD className="pl-5 text-2xs text-soft">{String(m.createdAt || '').slice(0, 10)}</TD>
                    <TD><Badge tone={m.type === 'RESTOCK' ? 'success' : 'neutral'}>{m.type}</Badge></TD>
                    <TD className={`font-data ${m.qty < 0 ? 'text-danger' : 'text-success'}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</TD>
                    <TD className="pr-5 text-2xs text-soft">{m.reason}</TD>
                  </TR>
                ))}
                {!movements.length && <TR><TD colSpan={4}><EmptyState title="No movements yet" icon={PackageCheck} /></TD></TR>}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
