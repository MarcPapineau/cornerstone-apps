import { useState } from 'react';
import { Boxes, Search, Syringe, Wind, HelpCircle, Lock, CheckCircle2, XCircle } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { fmtInt } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { Input } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

// Display-only route classifier — mirrors the server's ROUTE_CLASS for badge tone.
// The server gate stays authoritative; this only colours the row.
function routeMeta(route) {
  const r = String(route || '').toLowerCase();
  if (!route) return { cls: 'UNKNOWN', tone: 'danger', icon: HelpCircle };
  if (r.includes('subq') || r.includes('inject')) return { cls: 'INJECTED', tone: 'accent', icon: Syringe };
  if (r.includes('nasal') || r.includes('spray')) return { cls: 'INTRANASAL', tone: 'neutral', icon: Wind };
  if (r.includes('oral') || r.includes('tab') || r.includes('capsule')) return { cls: 'ORAL', tone: 'warning', icon: Boxes };
  return { cls: 'OTHER', tone: 'neutral', icon: Boxes };
}

function Detail({ id }) {
  const { data, loading, error } = useFetch(() => api.catalogItem(id), [id]);
  if (loading) return <Loading label="Loading gate…" />;
  if (error) return <ErrorState error={error} />;
  const p = data?.product;
  const gate = data?.routeFormGate;
  if (!p) return null;
  const rm = routeMeta(p.route);
  const RIcon = rm.icon;
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{p.displayName || p.name}</h3>
          {p.availability && <Badge tone={p.availability === 'AVAILABLE' ? 'success' : 'neutral'}>{p.availability}</Badge>}
        </div>
        <p className="mt-0.5 font-data text-2xs text-faint">{p.sku || p.id}</p>
      </div>

      <div className="rounded-md border border-border-soft bg-muted/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-2xs font-semibold uppercase tracking-wide text-faint">Route / form gate</span>
          {gate?.ok ? (
            <StatusChip tone="success" label="Draftable" />
          ) : (
            <StatusChip tone="danger" label="Blocked" />
          )}
        </div>
        <dl className="space-y-1.5 text-xs">
          <div className="flex items-start justify-between gap-3">
            <dt className="text-soft">Route</dt>
            <dd className="flex items-center gap-1.5 text-right font-medium text-foreground">
              <RIcon className="h-3.5 w-3.5 text-faint" />
              {p.route || 'UNKNOWN'} <span className="text-faint">({rm.cls})</span>
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-soft">Form</dt>
            <dd className="text-right font-medium text-foreground">{p.form || 'UNKNOWN'}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-soft">Strength</dt>
            <dd className="text-right font-data text-foreground">{p.strengthLabel || (p.strengthMg != null ? `${p.strengthMg}mg` : '—')}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-soft">Category</dt>
            <dd className="text-right text-foreground">{p.category || '—'}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-soft">Supplier</dt>
            <dd className="text-right text-foreground">{p.supplier || '—'}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-soft">Evidence id</dt>
            <dd className="text-right font-data text-foreground">{p.evidenceCompoundId || '—'}</dd>
          </div>
        </dl>
        {p.routeBasis && <p className="mt-2 text-2xs text-faint">Route basis: {p.routeBasis}</p>}
        {!gate?.ok && (gate?.reasons || []).length > 0 && (
          <ul className="mt-2 space-y-1">
            {gate.reasons.map((r) => (
              <li key={r} className="flex items-start gap-1.5 text-2xs text-danger">
                <XCircle className="mt-0.5 h-3 w-3 shrink-0" /> {r}
              </li>
            ))}
          </ul>
        )}
        {gate?.ok && (
          <p className="mt-2 flex items-center gap-1.5 text-2xs text-success">
            <CheckCircle2 className="h-3 w-3" /> Route and form are both known — route copied verbatim into any draft (never remapped).
          </p>
        )}
      </div>
    </div>
  );
}

export default function Catalog() {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const { data, loading, error } = useFetch(() => api.catalog(q), [q]);

  const products = data?.products || [];

  return (
    <>
      <PageHeader
        title="Source Catalog"
        description="The locked source-of-truth product list. Route and form are fixed per product — SubQ, oral and intranasal are never blurred or substituted. Off-catalog items are blocked at draft time."
        actions={<StatusChip tone="success" label="Catalog Locked" />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the catalog…" className="pl-9" />
        </div>
        <Badge tone="neutral">{fmtInt(data?.count ?? products.length)} products</Badge>
        <div className="ml-auto flex items-center gap-1.5 text-2xs text-faint">
          <Lock className="h-3 w-3" /> Source-of-truth — read only
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="px-0 py-1">
            {loading ? (
              <Loading label="Loading catalog…" />
            ) : error ? (
              <div className="px-5 py-4"><ErrorState error={error} /></div>
            ) : products.length === 0 ? (
              <EmptyState title="No products match" hint="Try a different search term." icon={Search} />
            ) : (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH className="pl-5">Product</TH>
                    <TH>Route</TH>
                    <TH>Form</TH>
                    <TH className="pr-5">Evidence</TH>
                  </TR>
                </THead>
                <TBody>
                  {products.map((p) => {
                    const rm = routeMeta(p.route);
                    const RIcon = rm.icon;
                    const active = selected === p.id;
                    return (
                      <TR
                        key={p.id}
                        className={active ? 'cursor-pointer bg-accent-soft/60' : 'cursor-pointer'}
                        onClick={() => setSelected(p.id)}
                      >
                        <TD className="pl-5">
                          <div className="font-medium text-foreground">{p.displayName || p.name}</div>
                          <div className="font-data text-2xs text-faint">{p.category || '—'}</div>
                        </TD>
                        <TD>
                          <StatusChip tone={rm.tone} label={rm.cls} />
                        </TD>
                        <TD className="max-w-[14rem] truncate text-xs" title={p.form || 'UNKNOWN'}>
                          {p.form || <span className="text-danger">UNKNOWN</span>}
                        </TD>
                        <TD className="pr-5">
                          {p.evidenceCompoundId ? (
                            <span className="font-data text-2xs text-soft">{p.evidenceCompoundId}</span>
                          ) : (
                            <span className="text-2xs text-faint">—</span>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:sticky lg:top-20 lg:self-start">
          <CardHeader>
            <CardTitle>Product detail</CardTitle>
            <CardDescription>Select a product to run its route / form gate.</CardDescription>
          </CardHeader>
          <CardContent>
            {selected ? (
              <Detail id={selected} />
            ) : (
              <EmptyState title="Nothing selected" hint="Click a product row to inspect its locked route and form." icon={Boxes} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
