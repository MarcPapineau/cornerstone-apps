import { useState } from 'react';
import { FileText, Search, Plus, X, ShieldAlert, HelpCircle, AlertTriangle, BadgeCheck, FlaskConical } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { fmtDate } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { ClientPicker } from '../components/ClientPicker.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { FormField, Input, Textarea } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

const noop = () => Promise.resolve(null);
const LEVEL_TONE = { HIGH: 'success', MODERATE: 'accent', LOW: 'warning', EMERGING: 'warning', PRECLINICAL: 'warning', UNKNOWN: 'neutral' };
const COMP_TONE = { ALLOWED_RESOURCE: 'success', NEEDS_REVIEW: 'warning', BLOCKED: 'danger', UNKNOWN: 'neutral' };

function bannerFor(d) {
  if (!d) return null;
  if (d.statusBanner) return d.statusBanner;
  if (d.blocked || d.status === 'BLOCKED') return 'BLOCKED — gate failure (see reasons)';
  if (d.reviewedBy) return 'REVIEWED — RESOURCE ONLY';
  return 'DRAFT — RESOURCE ONLY · NOT REVIEWED · NOT MEDICAL ADVICE';
}

function CatalogSearch({ onAdd }) {
  const [q, setQ] = useState('');
  const { data, loading } = useFetch(() => (q.trim() ? api.catalog(q.trim()) : noop()), [q]);
  const products = (data?.products || []).slice(0, 8);
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the source-of-truth catalog…" className="pl-9" />
      </div>
      {q.trim() && (
        <div className="mt-2 rounded-md border border-border-soft">
          {loading ? (
            <div className="p-3"><Loading /></div>
          ) : products.length === 0 ? (
            <p className="p-3 text-xs text-faint">No catalog matches. Off-catalog items cannot be drafted.</p>
          ) : (
            <ul className="max-h-56 divide-y divide-border-soft overflow-y-auto scrollbar-thin">
              {products.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-foreground">{p.displayName || p.name}</div>
                    <div className="font-data text-2xs text-faint">{p.route || 'UNKNOWN route'} · {p.category || '—'}</div>
                  </div>
                  <Button size="sm" variant="subtle" onClick={() => onAdd(p)}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function DraftView({ draft, onReview, reviewing }) {
  const banner = bannerFor(draft);
  const blocked = draft.blocked || draft.status === 'BLOCKED';
  const reviewed = !!draft.reviewedBy;
  const bannerTone = blocked
    ? 'border-danger/30 bg-danger-soft text-danger'
    : reviewed
      ? 'border-success/25 bg-success-soft text-success'
      : 'border-warning/25 bg-warning-soft text-warning';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle>Protocol draft</CardTitle>
            <span className="font-data text-2xs text-faint">{draft.id}</span>
            {draft._demo && <Badge tone="warning">demo</Badge>}
          </div>
          <StatusChip status={draft.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-wide ${bannerTone}`}>
          {blocked ? <ShieldAlert className="h-4 w-4" /> : <FileText className="h-4 w-4" />} {banner}
        </div>

        {(draft.items || []).length > 0 && (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Product</TH><TH>Route</TH><TH>Evidence</TH><TH>Compliance</TH>
              </TR>
            </THead>
            <TBody>
              {draft.items.map((it, i) => (
                <TR key={it.productId || i} className="hover:bg-transparent">
                  <TD>
                    <div className="font-medium text-foreground">{it.productName}</div>
                    <div className="text-2xs text-faint">{it.form || 'UNKNOWN form'}</div>
                  </TD>
                  <TD className="text-xs">{it.route || <span className="text-danger">UNKNOWN</span>}</TD>
                  <TD>
                    {it.evidenceLevel ? (
                      <span className="inline-flex items-center gap-1.5">
                        <StatusChip tone={LEVEL_TONE[it.evidenceLevel] || 'neutral'} label={it.evidenceLevel} />
                        {it.citationCount != null && <span className="font-data text-2xs text-faint">{it.citationCount} cites</span>}
                      </span>
                    ) : (
                      <span className="text-2xs text-faint">—</span>
                    )}
                  </TD>
                  <TD>
                    {it.compliance?.status ? <StatusChip tone={COMP_TONE[it.compliance.status] || 'neutral'} label={it.compliance.status} /> : <span className="text-2xs text-faint">—</span>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {draft.compliance && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-2xs font-semibold uppercase tracking-wide text-faint">Overall compliance</span>
            <StatusChip tone={COMP_TONE[draft.compliance.status] || 'neutral'} label={`${draft.compliance.jurisdiction} · ${draft.compliance.status}`} />
            {draft.compliance.reason && <span className="text-soft">{draft.compliance.reason}</span>}
          </div>
        )}

        {draft.rationale && (
          <div>
            <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Rationale (resource summary)</div>
            <p className="text-xs text-soft">{draft.rationale}</p>
          </div>
        )}
        {draft.monitoring && (
          <div>
            <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Monitoring</div>
            <p className="text-xs text-soft">{draft.monitoring}</p>
          </div>
        )}

        {(draft.blockedReasons || []).length > 0 && (
          <div className="rounded-md border border-danger/20 bg-danger-soft p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-danger"><ShieldAlert className="h-3.5 w-3.5" /> Blocked reasons</div>
            <ul className="space-y-0.5 text-xs text-danger">{draft.blockedReasons.map((r, i) => <li key={i}>· {r}</li>)}</ul>
          </div>
        )}
        {(draft.warnings || []).length > 0 && (
          <div className="rounded-md border border-warning/25 bg-warning-soft p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-warning"><AlertTriangle className="h-3.5 w-3.5" /> Warnings</div>
            <ul className="space-y-0.5 text-xs text-warning">{draft.warnings.map((r, i) => <li key={i}>· {r}</li>)}</ul>
          </div>
        )}
        {(draft.unknowns || []).length > 0 && (
          <div className="rounded-md border border-border-soft bg-muted/40 p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint"><HelpCircle className="h-3.5 w-3.5" /> Unknowns</div>
            <ul className="space-y-0.5 text-xs text-soft">{draft.unknowns.map((r, i) => <li key={i}>· {r}</li>)}</ul>
          </div>
        )}
        {(draft.labsSuggested || []).length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-faint"><FlaskConical className="h-3.5 w-3.5" /> Labs suggested</span>
            {draft.labsSuggested.map((l) => <Badge key={l} tone="neutral" className="font-data">{l}</Badge>)}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border-soft pt-3">
          <div className="text-2xs text-faint">
            {reviewed ? (
              <span className="inline-flex items-center gap-1 text-success"><BadgeCheck className="h-3.5 w-3.5" /> Reviewed by {draft.reviewedBy} · {fmtDate(draft.reviewedAt)}</span>
            ) : (
              'Not yet reviewed. Resource-only either way — this app never produces a prescription.'
            )}
          </div>
          {!reviewed && !blocked && (
            <Button size="sm" onClick={onReview} disabled={reviewing}>
              {reviewing ? 'Recording…' : 'Record provider review (Dr. Vincent Lun)'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Draft() {
  const [clientId, setClientId] = useState('');
  const [items, setItems] = useState([]); // {productId, name, route}
  const [rationale, setRationale] = useState('');
  const [monitoring, setMonitoring] = useState('');
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [reviewing, setReviewing] = useState(false);

  const draftsQ = useFetch(() => (clientId ? api.drafts(clientId) : noop()), [clientId]);
  const savedDrafts = draftsQ.data?.drafts || [];

  function addItem(p) {
    setItems((xs) => (xs.some((x) => x.productId === p.id) ? xs : [...xs, { productId: p.id, name: p.displayName || p.name, route: p.route }]));
  }
  const removeItem = (id) => setItems((xs) => xs.filter((x) => x.productId !== id));

  async function assemble() {
    if (!clientId || items.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.draftProtocol({
        clientId,
        itemRefs: items.map((x) => ({ productId: x.productId })),
        jurisdiction: 'CA',
        rationale,
        monitoring,
        persist: true,
      });
      setActive(res.draft);
      draftsQ.reload();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function loadDraft(id) {
    const res = await api.draft(id);
    setActive(res.draft);
  }

  async function review() {
    if (!active) return;
    setReviewing(true);
    try {
      const res = await api.reviewDraft(active.id, 'Dr. Vincent Lun');
      setActive(res.draft);
      draftsQ.reload();
    } finally {
      setReviewing(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Draft Builder"
        description="Assemble a protocol through every gate — catalog membership, route/form, research, and compliance. Output stays DRAFT / resource-only, and resource-only even after a provider review."
        actions={<StatusChip tone="accent" label="DRAFT / Resource-Only" />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Build a draft</CardTitle>
            <CardDescription>Pick a client, add source-of-truth items, then assemble. Off-catalog or unsourced items are blocked by the gate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-xs">
              <ClientPicker value={clientId} onChange={setClientId} autoSelectFirst />
            </div>

            <CatalogSearch onAdd={addItem} />

            {items.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {items.map((x) => (
                  <span key={x.productId} className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-accent-soft px-2.5 py-1 text-2xs font-medium text-primary">
                    {x.name}
                    <button type="button" onClick={() => removeItem(x.productId)} aria-label={`Remove ${x.name}`} className="text-primary/60 hover:text-primary">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <FormField label="Rationale" hint="Resource summary only — the language gate blocks medical-claim terms.">
              <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Resource summary of the literature most often referenced. Decisions remain the client's and their provider's." />
            </FormField>
            <FormField label="Monitoring">
              <Textarea value={monitoring} onChange={(e) => setMonitoring(e.target.value)} placeholder="Suggested baseline + follow-up labs and cadence." />
            </FormField>

            {err && <ErrorState error={err} />}
            <div className="flex justify-end">
              <Button onClick={assemble} disabled={busy || !clientId || items.length === 0}>
                {busy ? 'Assembling…' : 'Assemble draft'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Saved drafts</CardTitle>
            <CardDescription>Drafts persisted for this client.</CardDescription>
          </CardHeader>
          <CardContent>
            {!clientId ? (
              <EmptyState title="No client" hint="Select a client to see saved drafts." icon={FileText} />
            ) : draftsQ.loading ? (
              <Loading />
            ) : savedDrafts.length === 0 ? (
              <EmptyState title="No saved drafts" hint="Assemble a draft to persist it." icon={FileText} />
            ) : (
              <ul className="space-y-1.5">
                {savedDrafts.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => loadDraft(d.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${active?.id === d.id ? 'bg-accent-soft' : 'hover:bg-muted'}`}
                    >
                      <span className="min-w-0">
                        <span className="block font-data text-2xs text-foreground">{d.id}</span>
                        <span className="block text-2xs text-faint">{(d.items || []).length} items · {fmtDate(d.createdAt)}</span>
                      </span>
                      <StatusChip status={d.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5">
        {active ? (
          <DraftView draft={active} onReview={review} reviewing={reviewing} />
        ) : (
          <Card>
            <CardContent className="py-10">
              <EmptyState title="No draft loaded" hint="Assemble a new draft or open a saved one to view its gated output." icon={FileText} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
