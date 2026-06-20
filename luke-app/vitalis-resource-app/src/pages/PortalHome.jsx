import {
  ScrollText, Salad, Pill, UtensilsCrossed, FlaskConical, TestTubes, UserCog,
  CalendarClock, AlertCircle, ClipboardList, Hourglass, BadgeCheck, LineChart, FolderOpen,
} from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole } from '../lib/roleContext.jsx';
import { fmtDate } from '../lib/utils.js';
import { Card, CardContent } from '../components/ui/Card.jsx';
import { EmptyState } from '../components/ui/States.jsx';
import { SectionHeader } from '../components/ui/SectionHeader.jsx';
import TrendChart from '../components/charts/TrendChart.jsx';
import {
  DashboardHero, MetricRail, DocumentPreviewPanel, ServiceSiloPanel, NextActionList, StatusRibbon, GoalProgressPanel,
} from '../components/dashboard/composers.jsx';

const ask = (id, fn) => (id ? fn() : Promise.resolve(null));
const delta = (v, unit) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}${unit}`);
const refOf = (id) => 'VR-' + String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();

function addOnState(requests, approved, type) {
  const appr = (approved || []).find((a) => (a.plan?.addOnType || a.addOnType || a.requestType) === type);
  const req = (requests || []).find((r) => r.requestType === type);
  if (appr || (req && req.status === 'APPROVED_RESOURCE')) return { status: 'Active', tone: 'success', summary: 'Approved plan available in your portal.' };
  if (req) return { status: 'In review', tone: 'warning', summary: 'Your request is with your practitioner.' };
  return { status: 'Available', tone: 'ink', summary: 'Request a personalized plan.' };
}

/** PortalHome — the client DASHBOARD (custom Vitalis composition; approved data only, no drafts). */
export default function PortalHome() {
  const { clientId } = useRole();
  const clientQ = useFetch(() => ask(clientId, () => api.client(clientId)), [clientId]);
  const protoQ = useFetch(() => ask(clientId, () => api.clientProtocols(clientId)), [clientId]);
  const addQ = useFetch(() => ask(clientId, () => api.clientAddOns(clientId)), [clientId]);
  const reqQ = useFetch(() => ask(clientId, () => api.clientProtocolRequests(clientId)), [clientId]);
  const entQ = useFetch(() => ask(clientId, () => api.clientEntitlements(clientId)), [clientId]);
  const outQ = useFetch(() => ask(clientId, () => api.outcomes(clientId)), [clientId]);
  const scoreQ = useFetch(() => ask(clientId, () => api.scorecard(clientId)), [clientId]);
  const labsQ = useFetch(() => ask(clientId, () => api.labResults(clientId)), [clientId]);
  const docsQ = useFetch(() => ask(clientId, () => api.clientDocuments(clientId)), [clientId]);

  if (!clientId) {
    return <Card><CardContent className="py-12"><EmptyState title="No client selected" hint="Pick a client in the “View as” switcher to open their dashboard." icon={UserCog} /></CardContent></Card>;
  }

  const client = clientQ.data?.client || clientQ.data || {};
  const current = protoQ.data?.current?.[0] || null;
  const addReqs = addQ.data?.requests || [];
  const addApproved = addQ.data?.approved || [];
  const sup = addOnState(addReqs, addApproved, 'SUPPLEMENT_PLAN');
  const meal = addOnState(addReqs, addApproved, 'MEAL_PLAN');
  const protoReqs = reqQ.data?.requests || [];
  const usage = entQ.data?.usage || {};
  const outcomes = (outQ.data?.outcomes || []).slice().sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  const sc = scoreQ.data?.scorecard || {};
  const deltas = sc.deltas || {};
  const labs = labsQ.data?.results || [];
  const documents = docsQ.data?.documents || [];
  const needsBloodwork = labs.length === 0 && (current?.labsSuggested || []).length > 0;
  const pendingCount = protoReqs.filter((r) => !/approv/i.test(r.statusLabel || r.status || '')).length + addReqs.filter((r) => r.status !== 'APPROVED_RESOURCE').length;

  const actions = [];
  if (needsBloodwork) actions.push({ icon: FlaskConical, text: 'Order your baseline bloodwork to unlock lab-based guidance.', to: '/portal/package', cta: 'Lab Requests' });
  if (current?.nextCheckIn) actions.push({ icon: CalendarClock, text: `Next check-in — ${fmtDate(current.nextCheckIn)}.`, to: '/portal/progress', cta: 'Log progress' });
  if (pendingCount > 0) actions.push({ icon: AlertCircle, text: `${pendingCount} request${pendingCount > 1 ? 's' : ''} awaiting practitioner review.`, to: '/portal/add-ons', cta: 'View status' });
  if (outcomes.length === 0) actions.push({ icon: ClipboardList, text: 'Record your first progress entry to start tracking trends.', to: '/portal/progress', cta: 'Add entry' });

  const trend = outcomes.map((o) => ({ label: (o.recordedAt || '').slice(5, 10), Weight: o.weightKg ?? null, 'Lean mass': o.leanMassKg ?? null, 'Body fat %': o.bodyFatPct ?? null }));

  const metrics = [
    { label: 'Active plan', value: current ? 'Peptide protocol' : 'None', sub: current ? (current.title || current.goal || '').slice(0, 26) : 'request one', to: '/portal/protocols' },
    { label: 'Next lab / check-in', value: current?.nextCheckIn ? fmtDate(current.nextCheckIn) : (needsBloodwork ? 'Order labs' : '—'), sub: needsBloodwork ? 'baseline due' : 'on schedule', to: '/portal/labs' },
    { label: 'Adherence', value: sc.adherenceAvg != null ? `${sc.adherenceAvg}%` : '—', ring: sc.adherenceAvg ?? null, ringMax: 100, tone: 'gold', sub: 'protocol avg' },
    { label: 'Pending', value: pendingCount, sub: 'in review', to: '/portal/add-ons' },
  ];

  const silos = [
    { icon: ScrollText, title: 'Peptide Protocol', to: '/portal/protocols', summary: current ? `${current.title || current.goal} · ${(current.items || []).length} compounds` : 'No active protocol — request one.', status: current ? 'Active' : (protoReqs.length ? 'Requested' : 'None'), tone: current ? 'success' : (protoReqs.length ? 'warning' : 'ink') },
    { icon: Salad, title: 'Nutrition Plan', to: '/portal/nutrition', summary: 'Deficiency-driven guidance from your bloodwork.', status: 'Lab-based', tone: 'teal' },
    { icon: Pill, title: 'Supplement Plan', to: '/portal/add-ons?silo=supplement', summary: sup.summary, status: sup.status, tone: sup.tone, fee: 'paid' },
    { icon: UtensilsCrossed, title: 'Meal Plan', to: '/portal/add-ons?silo=meal', summary: meal.summary, status: meal.status, tone: meal.tone, fee: 'paid' },
    { icon: FlaskConical, title: 'Lab Requests', to: '/portal/package', summary: needsBloodwork ? 'Baseline + protocol markers to order.' : 'Bloodwork requisition.', status: needsBloodwork ? 'To order' : 'Ready', tone: needsBloodwork ? 'warning' : 'ink', fee: 'no fee' },
    { icon: TestTubes, title: 'Bloodwork & Results', to: '/portal/labs', summary: labs.length ? `${labs.length} panel(s) on file.` : 'Results appear once recorded.', status: labs.length ? `${labs.length} panel(s)` : 'None', tone: labs.length ? 'success' : 'ink' },
    { icon: LineChart, title: 'Progress & Goals', to: '/portal/progress', summary: outcomes.length ? `${outcomes.length} progress entr${outcomes.length === 1 ? 'y' : 'ies'} logged.` : 'Log your first entry to track trends.', status: outcomes.length ? `${outcomes.length} logged` : 'Start logging', tone: outcomes.length ? 'success' : 'ink' },
    { icon: FolderOpen, title: 'Documents', to: '/portal/documents', summary: documents.length ? `${documents.length} document(s) on file.` : 'Keep your records together.', status: documents.length ? `${documents.length} on file` : 'None', tone: documents.length ? 'success' : 'ink' },
  ];

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="My Vitalis Health"
        title={client.name ? `Welcome, ${(client.name || '').replace(/^Demo\s*[—-]\s*/, '').trim().split(' ')[0]}` : 'Your health overview'}
        subtitle="What you’re on, what’s next, and how you’re progressing — practitioner-approved resources only."
        ribbons={<>
          {current ? <StatusRibbon tone="success" icon={BadgeCheck}>Protocol active</StatusRibbon> : <StatusRibbon tone="ink">No active protocol</StatusRibbon>}
          {usage.cap != null && <StatusRibbon tone="teal">Plan {usage.used}/{usage.cap}</StatusRibbon>}
        </>}
      />

      <MetricRail items={metrics} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: active protocol + silos + trend */}
        <div className="space-y-6 lg:col-span-2">
          <section className="space-y-3">
            <SectionHeader eyebrow="What I’m on" title="Active protocol" actions={<a href="/portal/protocols" className="text-xs font-semibold text-primary hover:underline">Open dossier →</a>} />
            {current ? (
              <DocumentPreviewPanel
                title={current.title || current.goal || 'Peptide protocol'} refId={refOf(current.id)} status="Approved" statusTone="success" to="/portal/protocols"
                meta={[{ label: 'Goal', value: current.goal || '—' }, { label: 'Compounds', value: (current.items || []).length }, { label: 'Next check-in', value: current.nextCheckIn ? fmtDate(current.nextCheckIn) : '—' }]}
              />
            ) : (
              <Card><CardContent className="py-8"><EmptyState title="No active protocol yet" hint="Your practitioner builds and approves your protocol — request one from Peptide Protocols." icon={ScrollText} /></CardContent></Card>
            )}
          </section>

          <section className="space-y-3">
            <SectionHeader eyebrow="My services" title="Every Vitalis service" />
            <ServiceSiloPanel silos={silos} />
          </section>

          <section className="space-y-3">
            <SectionHeader eyebrow="How I’m progressing" title="Body composition trend" actions={<a href="/portal/progress" className="text-xs font-semibold text-primary hover:underline">Full progress →</a>} />
            <Card><CardContent className="pt-4"><TrendChart data={trend} series={[{ key: 'Weight' }, { key: 'Lean mass' }, { key: 'Body fat %' }]} height={220} legend /></CardContent></Card>
          </section>
        </div>

        {/* Right: progress score + next actions */}
        <div className="space-y-6">
          <GoalProgressPanel
            title="Progress score"
            rings={[
              { name: 'Adherence', value: sc.adherenceAvg ?? null, max: 100, tone: 'gold', sublabel: 'protocol avg' },
              { name: 'Body-fat trend', value: deltas.bodyFatPct != null ? Math.max(0, Math.min(100, (-deltas.bodyFatPct / 3) * 100)) : null, max: 100, tone: 'success', label: delta(deltas.bodyFatPct, '%'), sublabel: 'from baseline' },
              { name: 'Lean mass', value: deltas.leanMassKg != null ? Math.max(0, Math.min(100, ((deltas.leanMassKg + 1) / 3) * 100)) : null, max: 100, tone: 'teal', label: delta(deltas.leanMassKg, 'kg'), sublabel: 'from baseline' },
              { name: 'Weight', value: outcomes.length ? 100 : null, max: 100, tone: 'gold', label: delta(deltas.weightKg, 'kg'), sublabel: 'from baseline' },
            ]}
            footer={sc.adherenceAvg != null
              ? 'Tracking heuristics from your baseline entry — never a clinical judgement.'
              : 'Logs unlock your score. Record a progress entry to start filling these rings.'}
          />

          <section className="space-y-3">
            <SectionHeader eyebrow="What’s next" title="Next actions" />
            <NextActionList actions={actions} emptyLabel="You’re all caught up — nothing needs your attention." />
          </section>

          {(protoReqs.length > 0 || addReqs.length > 0) && (
            <section className="space-y-3">
              <SectionHeader eyebrow="Tracking" title="Requests & status" actions={<a href="/portal/add-ons" className="text-xs font-semibold text-primary hover:underline">All →</a>} />
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
                {[...protoReqs.map((r) => ({ label: r.goal || 'Protocol request', status: r.statusLabel || r.status })), ...addReqs.map((r) => ({ label: `${r.requestType === 'MEAL_PLAN' ? 'Meal' : 'Supplement'} plan`, status: r.status === 'APPROVED_RESOURCE' ? 'Approved' : 'In review' }))].slice(0, 5).map((r, i) => (
                  <div key={i} className={`flex items-center justify-between gap-2 px-4 py-2.5 text-sm ${i > 0 ? 'border-t border-border-soft' : ''}`}>
                    <span className="min-w-0 truncate text-foreground"><Hourglass className="mr-1.5 inline h-3.5 w-3.5 text-faint" />{r.label}</span>
                    <StatusRibbon tone={/approv/i.test(r.status) ? 'success' : 'warning'}>{r.status}</StatusRibbon>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      <p className="border-t border-border-soft pt-4 text-2xs leading-relaxed text-faint">Everything shown is practitioner-reviewed and educational — not a prescription. Drafts in progress are never shown here.</p>
    </div>
  );
}
