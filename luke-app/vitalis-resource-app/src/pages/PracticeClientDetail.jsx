import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, FileText, TestTubes, LineChart, FlaskConical, AlertTriangle, Layers, History,
  ScrollText, UserRound, Package, Pill, FilePlus2, Plus, Gauge, ExternalLink, Network,
  Salad, UtensilsCrossed,
} from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole } from '../lib/roleContext.jsx';
import { cn, fmtDate } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { DraftCard } from '../components/DraftCard.jsx';
import { CurrentProtocolCard, PastProtocolCard } from '../components/protocol/ProtocolViews.jsx';
import { AddOnRequestCard } from '../components/addon/AddOnRequestCard.jsx';
import { PackageView } from '../components/package/PackageView.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Label, Select } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

/**
 * PracticeClientDetail — THE client dossier. Every piece of a client's work lives here, in
 * one practitioner/client silo, loaded from a single scoped read
 * (api.clientDossier → /api/practitioner/:id/clients/:clientId/dossier, ownership-enforced).
 * Tabs: Overview · Care Package · Protocols · Labs · Documents · Add-ons · Progress. The
 * approval boundary is untouched — `protocols` is the approved current/past projection (what
 * the client sees), drafts/add-on drafts stay practitioner-only until approved. Global tools
 * are reached here as per-client ACTIONS (generate package / add lab / create add-on), never
 * as a flat global nav dump. Nothing here is a prescription.
 */

const ADDON_TIERS = {
  SUPPLEMENT_PLAN: [{ key: 'BASIC', label: 'Basic' }, { key: 'COMPREHENSIVE', label: 'Comprehensive' }],
  MEAL_PLAN: [{ key: 'BASIC', label: 'Basic weekly' }, { key: 'DETAILED', label: 'Detailed + recipes' }, { key: 'MONTHLY_PREP', label: 'Monthly meal-prep' }, { key: 'PERFORMANCE', label: 'Performance' }],
};

function Detail({ label, value }) {
  return (
    <div>
      <div className="text-2xs font-semibold uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-0.5 font-data text-sm text-foreground">{value ?? '—'}</div>
    </div>
  );
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border-soft">
      {tabs.map((t) => {
        const Icon = t.icon;
        const on = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            aria-pressed={on}
            className={cn('relative shrink-0 whitespace-nowrap px-3 py-2 text-xs font-medium transition-colors', on ? 'text-primary' : 'text-soft hover:text-foreground')}
          >
            <span className="flex items-center gap-1.5">
              {Icon && <Icon className="h-3.5 w-3.5" />}{t.label}
              {t.count != null && t.count > 0 && <span className="rounded-full bg-neutral-soft px-1.5 text-2xs text-soft">{t.count}</span>}
            </span>
            {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        );
      })}
    </div>
  );
}

// --- Overview / intake ------------------------------------------------------
function OverviewTab({ client: c, entitlement, counts, clientId }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Intake profile</CardTitle><CardDescription>Recorded by the practice — the client sees this in their portal.</CardDescription></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Detail label="Sex" value={c.sex} />
            <Detail label="Age" value={c.age != null ? `${c.age}y` : null} />
            <Detail label="Weight" value={c.weightKg != null ? `${c.weightKg} kg` : null} />
            <Detail label="Body Fat" value={c.bodyFatPct != null ? `${c.bodyFatPct}%` : null} />
            <Detail label="Lean Mass" value={c.leanMassKg != null ? `${c.leanMassKg} kg` : null} />
          </div>
          {(c.goals || []).length > 0 && (
            <div className="mt-4"><div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">Goals</div>
              <div className="flex flex-wrap gap-1.5">{c.goals.map((g) => <Badge key={g} tone="accent">{g}</Badge>)}</div></div>
          )}
          {(c.contraindications || []).length > 0 && (
            <div className="mt-3"><div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">Contraindications</div>
              <div className="flex flex-wrap gap-1.5">{c.contraindications.map((g) => <Badge key={g} tone="danger">{g}</Badge>)}</div></div>
          )}
          {c.notes && <p className="mt-3 text-xs text-soft">{c.notes}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-1.5"><Gauge className="h-4 w-4 text-faint" /> Plan &amp; entitlement</CardTitle><CardDescription>Educational-resource allowance — not a clinical limit.</CardDescription></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail label="Plan" value={entitlement?.planKey ? entitlement.planKey.toUpperCase() : 'FREE'} />
            <Detail label="Active protocols" value={`${counts.currentProtocols} / ${entitlement?.activeProtocolCap == null ? '∞' : entitlement.activeProtocolCap}`} />
            <Detail label="Approved add-ons" value={counts.addOnApproved} />
            <Detail label="Labs on file" value={counts.labs} />
          </div>
        </CardContent>
      </Card>

      {/* Cross-discipline referral network — a per-client ACTION (not a global nav item).
          Opens the referral surface pre-scoped to this client: gate-driven suggestions +
          a service/location-filtered partner roster. Suggestion-only; no booking, no fee. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><Network className="h-4 w-4 text-faint" /> Referral network</CardTitle>
          <CardDescription>If this client needs a service outside your scope, find a partner practitioner by service + location. Suggestions only — never a diagnosis, no booking, no fee.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-soft">Referral category suggestions are surfaced from this client’s flagged labs and stated goals, alongside a filtered cross-discipline roster.</p>
            <Link to={`/referrals?clientId=${encodeURIComponent(clientId)}`}>
              <Button size="sm" variant="outline"><Network className="h-3.5 w-3.5" /> Open referrals</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Care package -----------------------------------------------------------
function PackageTab({ clientId }) {
  const pkgQ = useFetch(() => api.clientPackage(clientId), [clientId]);
  const pkg = pkgQ.data?.package || null;
  const noProtocol = pkgQ.data?.status === 'NO_PROTOCOL' || !pkg;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-soft">The one-click bundle — protocol + bloodwork + nutrition — the client opens once you approve it.</p>
        <Link to={`/package?clientId=${encodeURIComponent(clientId)}`}>
          <Button size="sm"><Plus className="h-4 w-4" /> Generate / update</Button>
        </Link>
      </div>
      {pkgQ.loading ? <Loading /> : pkgQ.error ? <ErrorState error={pkgQ.error} /> : noProtocol ? (
        <Card><CardContent className="py-10"><EmptyState title="No care package yet" hint="Generate a protocol & package for this client — it appears here (and in their portal) once approved." icon={Package} /></CardContent></Card>
      ) : (
        <PackageView pkg={pkg} />
      )}
    </div>
  );
}

// --- Protocols (drafts + current/past) --------------------------------------
function ProtocolsTab({ clientId, reviewDrafts, protocols, reviewer, onReload }) {
  const { current, past } = protocols;
  return (
    <div className="space-y-8">
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-faint" /><h2 className="text-sm font-semibold tracking-tight text-foreground">Drafts awaiting review</h2></div>
          <Link to={`/package?clientId=${encodeURIComponent(clientId)}`}><Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5" /> Build protocol</Button></Link>
        </div>
        <p className="mb-3 text-xs text-faint">Practitioner-only — invisible to the client until you approve them. Approved protocols move to Current &amp; past below.</p>
        {reviewDrafts.length === 0 ? (
          <Card><CardContent className="py-8"><EmptyState title="No drafts awaiting review" hint="Nothing pending. Build a protocol & package above." icon={FileText} /></CardContent></Card>
        ) : (
          <div className="space-y-4">{reviewDrafts.map((d) => <DraftCard key={d.id} draft={d} reviewer={reviewer} onReviewed={onReload} />)}</div>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center gap-2"><Layers className="h-4 w-4 text-faint" /><h2 className="text-sm font-semibold tracking-tight text-foreground">Current &amp; past protocols</h2></div>
        <p className="mb-3 text-xs text-faint">Approved protocols only — exactly what the client sees in their portal. Resources for review, not prescriptions.</p>
        {current.length === 0 && past.length === 0 ? (
          <Card><CardContent className="py-8"><EmptyState title="No approved protocols yet" hint="Approve a draft above and it appears here as the client’s current or past protocol." icon={ScrollText} /></CardContent></Card>
        ) : (
          <div className="space-y-6">
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint"><ScrollText className="h-3.5 w-3.5" /> Current{current.length ? ` · ${current.length}` : ''}</div>
              {current.length === 0 ? <p className="text-xs text-faint">No active protocol.</p> : <div className="space-y-5">{current.map((p) => <CurrentProtocolCard key={p.id} p={p} />)}</div>}
            </div>
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint"><History className="h-3.5 w-3.5" /> Past{past.length ? ` · ${past.length}` : ''}</div>
              {past.length === 0 ? <p className="text-xs text-faint">No past protocols.</p> : <div className="space-y-5">{past.map((p) => <PastProtocolCard key={p.id} p={p} />)}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Labs -------------------------------------------------------------------
function LabsTab({ clientId, labs }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-soft">Abnormal values surface a “review with provider” note — never a diagnosis.</p>
        <Link to={`/labs/results?clientId=${encodeURIComponent(clientId)}`}><Button size="sm"><Plus className="h-4 w-4" /> Add lab result</Button></Link>
      </div>
      {labs.length === 0 ? (
        <Card><CardContent className="py-10"><EmptyState title="No labs on file" hint="Add a lab result for this client — it appears here with any out-of-range flags." icon={FlaskConical} /></CardContent></Card>
      ) : (
        <ul className="space-y-3">
          {labs.map((r) => (
            <li key={r.id} className="rounded-md border border-border-soft p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-soft">{fmtDate(r.drawnAt)}</span>
                {r.hasFlags ? <StatusChip status="flagged" label={`${r.flags.length} flagged`} /> : <StatusChip status="normal" label="in range" />}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(r.values || []).map((v, i) => (
                  <span key={i} className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs', v.flag && v.flag.startsWith('OUT_OF_RANGE') ? 'border-danger/30 bg-danger-soft text-danger' : 'border-border-soft text-soft')}>
                    <span className="font-medium">{v.marker}</span>
                    <span className="font-data">{v.value ?? '—'}{v.unit ? ` ${v.unit}` : ''}</span>
                  </span>
                ))}
              </div>
              {r.hasFlags && <p className="mt-2 inline-flex items-center gap-1 text-2xs text-danger"><AlertTriangle className="h-3 w-3" /> Review with provider — not a diagnosis.</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// One practitioner deep-link into a generated dossier vertical. PRACTITIONER role → the
// operator view (full dosing / titration / citations); the server still gates everything.
function DossierLink({ silo, id, icon: Icon, title, sub }) {
  return (
    <Link
      to={`/document/${silo}/${encodeURIComponent(id)}?role=PRACTITIONER`}
      className="flex items-center gap-3 rounded-lg border border-border-soft bg-card px-3 py-2.5 transition hover:border-gold/40 hover:bg-muted/40"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-gold"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {sub && <span className="block truncate text-2xs text-soft">{sub}</span>}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">Open <ExternalLink className="h-3.5 w-3.5" /></span>
    </Link>
  );
}

// --- Documents --------------------------------------------------------------
function DocumentsTab({ clientId, documents, drafts, protocols, addOns }) {
  // Generated-dossier deep-links (PRACTITIONER view). The protocol-keyed verticals (peptide +
  // its bloodwork requisition) use a protocol draft id — prefer the current approved protocol,
  // then the most recent past, then any draft on file (the practitioner can preview a draft).
  const protocolId = protocols.current?.[0]?.id || protocols.past?.[0]?.id || (drafts[0] && drafts[0].id) || null;
  // Add-on verticals use the add-on DRAFT id; only link a draft that actually has a generated
  // plan (the document endpoint 422s on a plan-less draft).
  const addOnDrafts = (addOns.requests || []).map((r) => r.draft).filter((d) => d && d.plan);
  const supplementDraft = addOnDrafts.find((d) => d.addOnType === 'SUPPLEMENT_PLAN') || null;
  const mealDraft = addOnDrafts.find((d) => d.addOnType === 'MEAL_PLAN') || null;
  const hasAny = protocolId || supplementDraft || mealDraft;

  return (
    <div className="space-y-4">
      <p className="text-xs text-soft">Documents the client uploaded or you recorded. Local-first metadata — never an approval of care.</p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><FileText className="h-4 w-4 text-faint" /> Generated dossier documents</CardTitle>
          <CardDescription>Open any vertical as the practitioner view — full operator detail. Drafts render too; the client only ever sees an approved dossier.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!hasAny ? (
            <EmptyState title="No generated dossiers yet" hint="Build a protocol or an add-on plan for this client and its dossier verticals appear here." icon={FileText} />
          ) : (
            <>
              {protocolId && <DossierLink silo="peptide" id={protocolId} icon={ScrollText} title="Peptide protocol" sub="The full protocol dossier — schedule, dosing, citations." />}
              {protocolId && <DossierLink silo="blood_req" id={protocolId} icon={FlaskConical} title="Bloodwork requisition" sub="Baseline panel + protocol-driven marker cadence." />}
              {supplementDraft && <DossierLink silo="supplement" id={supplementDraft.id} icon={Pill} title="Supplement plan" sub={supplementDraft.title || 'Add-on supplement dossier.'} />}
              <DossierLink silo="nutrition" id={clientId} icon={Salad} title="Nutrition request slip" sub="Lab-driven naturopath request — Dr. Vincent Lun. Practitioner-only." />
              {mealDraft && <DossierLink silo="meal" id={mealDraft.id} icon={UtensilsCrossed} title="Meal plan" sub={mealDraft.title || 'Add-on meal-plan dossier.'} />}
            </>
          )}
        </CardContent>
      </Card>

      {documents.length === 0 ? (
        <Card><CardContent className="py-10"><EmptyState title="No documents on file" hint="Labs, intake forms, or imaging the client brings in appear here." icon={FilePlus2} /></CardContent></Card>
      ) : (
        <ul className="divide-y divide-border-soft rounded-md border border-border-soft">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{d.label || d.fileName || 'Document'}</span>
                <span className="block text-2xs text-faint">{d.kind || 'OTHER'} · {d.uploadedBy || 'CLIENT'} · {fmtDate(d.createdAt)}</span>
              </span>
              <StatusChip status={d.status || 'received'} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Add-ons ----------------------------------------------------------------
function AddOnsTab({ clientId, addOns, onReload }) {
  const [type, setType] = useState('SUPPLEMENT_PLAN');
  const [tier, setTier] = useState('BASIC');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const requests = addOns.requests || [];

  async function create() {
    setBusy(true); setErr(null);
    try {
      await api.requestAddOn(clientId, { requestType: type, tier, intake: {}, role: 'PRACTITIONER' });
      onReload();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-1.5"><Plus className="h-4 w-4 text-primary" /> New add-on for this client</CardTitle><CardDescription>Create a supplement or meal-plan request on the client’s behalf, then confirm the fee and generate.</CardDescription></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[10rem] flex-1">
              <Label>Type</Label>
              <Select value={type} onChange={(e) => { setType(e.target.value); setTier(ADDON_TIERS[e.target.value][0].key); }}>
                <option value="SUPPLEMENT_PLAN">Supplement plan</option>
                <option value="MEAL_PLAN">Meal / diet plan</option>
              </Select>
            </div>
            <div className="min-w-[10rem] flex-1">
              <Label>Depth</Label>
              <Select value={tier} onChange={(e) => setTier(e.target.value)}>
                {ADDON_TIERS[type].map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </Select>
            </div>
            <Button onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create request'}</Button>
          </div>
          {err && <div className="mt-2"><ErrorState error={err} /></div>}
        </CardContent>
      </Card>

      {requests.length === 0 ? (
        <Card><CardContent className="py-10"><EmptyState title="No add-ons yet" hint="Supplement and meal-plan requests for this client appear here." icon={Pill} /></CardContent></Card>
      ) : (
        <div className="space-y-4">{requests.map((r) => <AddOnRequestCard key={r.id} request={r} onChanged={onReload} />)}</div>
      )}
    </div>
  );
}

// --- Progress ---------------------------------------------------------------
function ProgressTab({ outcomes }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-1.5"><LineChart className="h-4 w-4 text-faint" /> Progress</CardTitle><CardDescription>Self-reported outcome metrics over time.</CardDescription></CardHeader>
      <CardContent>
        {outcomes.length === 0 ? (
          <EmptyState title="No progress recorded" hint="Weight, body-fat, lean-mass and adherence entries appear here." icon={LineChart} />
        ) : (
          <ul className="divide-y divide-border-soft">
            {outcomes.slice(0, 12).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                <span className="text-faint">{fmtDate(o.recordedAt)}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-data text-soft">
                  {o.weightKg != null && <span>{o.weightKg}kg</span>}
                  {o.bodyFatPct != null && <span>{o.bodyFatPct}% bf</span>}
                  {o.leanMassKg != null && <span>{o.leanMassKg}kg lean</span>}
                  {o.adherencePct != null && <span className="text-primary">{o.adherencePct}% adh</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function PracticeClientDetail() {
  const { id } = useParams();
  const { practitionerId } = useRole();
  const [tab, setTab] = useState('overview');
  const q = useFetch(() => (practitionerId ? api.clientDossier(practitionerId, id) : Promise.resolve(null)), [practitionerId, id]);

  if (!practitionerId) {
    return (
      <>
        <PageHeader title="Client dossier" description="Open a client from your practice." />
        <Card><CardContent className="py-10"><EmptyState title="No practitioner selected" hint="Pick a practitioner in the “View as” switcher." icon={UserRound} /></CardContent></Card>
      </>
    );
  }
  if (q.loading) return <Loading label="Loading client dossier…" />;
  if (q.error) return <ErrorState error={q.error} />;

  const d = q.data || {};
  const c = d.client || {};
  const counts = d.counts || {};
  const reload = () => q.reload();

  const tabs = [
    { key: 'overview', label: 'Overview', icon: UserRound },
    { key: 'package', label: 'Care Package', icon: Package },
    { key: 'protocols', label: 'Protocols', icon: ScrollText, count: counts.reviewDrafts + counts.currentProtocols + counts.pastProtocols },
    { key: 'labs', label: 'Labs', icon: TestTubes, count: counts.labs },
    { key: 'documents', label: 'Documents', icon: FilePlus2, count: counts.documents },
    { key: 'addons', label: 'Add-ons', icon: Pill, count: counts.addOnRequests },
    { key: 'progress', label: 'Progress', icon: LineChart, count: counts.outcomes },
  ];

  return (
    <>
      <Link to="/practice/clients" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-faint hover:text-primary"><ArrowLeft className="h-3.5 w-3.5" /> My Clients</Link>
      <PageHeader
        title={c.name || 'Client'}
        description="The client dossier — everything in one place. Nothing here is client-visible until you approve it."
        actions={c._demo && <Badge tone="warning">demo</Badge>}
      />

      <TabBar tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && <OverviewTab client={c} entitlement={d.entitlement} counts={counts} clientId={id} />}
      {tab === 'package' && <PackageTab clientId={id} />}
      {tab === 'protocols' && <ProtocolsTab clientId={id} reviewDrafts={d.reviewDrafts || []} protocols={d.protocols || { current: [], past: [] }} reviewer={null} onReload={reload} />}
      {tab === 'labs' && <LabsTab clientId={id} labs={d.labs || []} />}
      {tab === 'documents' && <DocumentsTab clientId={id} documents={d.documents || []} drafts={d.drafts || []} protocols={d.protocols || { current: [], past: [] }} addOns={d.addOns || { requests: [] }} />}
      {tab === 'addons' && <AddOnsTab clientId={id} addOns={d.addOns || { requests: [] }} onReload={reload} />}
      {tab === 'progress' && <ProgressTab outcomes={d.outcomes || []} />}
    </>
  );
}
