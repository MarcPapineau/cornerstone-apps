import { Link } from 'react-router-dom';
import {
  Users, ClipboardCheck, Pill, FileText, UserPlus, Mail, UserCog, Stethoscope,
  FlaskConical, CalendarClock, BadgeCheck, CheckCircle2, ArrowRight, Wand2,
  CircleDollarSign, Layers, Network, Send, Handshake, ScrollText, UtensilsCrossed, Construction,
} from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole } from '../lib/roleContext.jsx';
import { fmtInt, fmtDate } from '../lib/utils.js';
import { Card, CardContent } from '../components/ui/Card.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';
import { SectionHeader } from '../components/ui/SectionHeader.jsx';
import { DashboardHero, ActionCommandBar, CommandTile, MetricRail, StatusRibbon, GoalProgressPanel, SegmentBar, KpiSparkCard } from '../components/dashboard/composers.jsx';
import UtilizationDonut from '../components/charts/UtilizationDonut.jsx';

// Honest delta from a real ≥2-point monthly series: the most recent month-over-month change.
// Returns null (→ no delta pill) when there is no real series. Never invents a trend.
function seriesDelta(series, { suffix = '', pts = false } = {}) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const d = series[series.length - 1] - series[series.length - 2];
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  return { delta: `${sign}${Math.abs(d)}${pts ? ' pts' : ''}${suffix}`, up: d >= 0 };
}

const ask = (id, fn) => (id ? fn() : Promise.resolve(null));

// Referral lifecycle → StatusChip tone (honest, no fake-green). Mirrors Referrals.jsx.
const REFERRAL_TONE = { PENDING: 'warning', ACCEPTED: 'success', DECLINED: 'danger' };

/** PracticeHome — the practitioner COMMAND CENTER (custom Vitalis composition). */
export default function PracticeHome() {
  const { practitionerId } = useRole();
  const anQ = useFetch(() => ask(practitionerId, () => api.practitionerAnalytics(practitionerId)), [practitionerId]);
  const rosterQ = useFetch(() => ask(practitionerId, () => api.practitionerClients(practitionerId)), [practitionerId]);
  const reviewsQ = useFetch(() => ask(practitionerId, () => api.practitionerReviews(practitionerId)), [practitionerId]);

  if (!practitionerId) {
    return <Card><CardContent className="py-12"><EmptyState title="No practitioner selected" hint="Pick a practitioner in the “View as” switcher." icon={UserCog} /></CardContent></Card>;
  }
  if (anQ.loading) return <Loading label="Loading practice…" />;
  if (anQ.error) return <ErrorState error={anQ.error} />;

  const p = anQ.data?.practitioner || {};
  const s = anQ.data?.stats || {};
  const recent = anQ.data?.recentDrafts || [];
  const clients = rosterQ.data?.clients || [];
  const queue = reviewsQ.data?.reviews || [];
  const moduleUsage = anQ.data?.moduleUsage || [];
  const referrals = anQ.data?.referrals || null;
  // Real monthly sparkline series (server-derived from this practice's own timestamped records).
  // Each is a ≥2-point array or null; a null series ships its KPI card as value + delta only.
  const activity = anQ.data?.activity || {};

  const actions = [
    { to: '/practice/clients', label: 'Open a client', icon: Wand2, primary: true },
    { to: '/practice/invitations', label: 'Invite client', icon: Mail },
    { to: '/practice/clients', label: 'Add client', icon: UserPlus },
    { to: '/practice/add-ons', label: 'Add-on requests', icon: Pill },
  ];

  const metrics = [
    { label: 'Clients', value: fmtInt(s.clientCount), sub: `${fmtInt(s.activeClients)} active` },
    { label: 'Protocols generated', value: fmtInt(s.protocolsGenerated), sub: `${fmtInt(s.approvedProtocols)} approved` },
    { label: 'Supplement / Meal', value: `${fmtInt(s.supplementPlans)} / ${fmtInt(s.mealPlans)}`, sub: 'plans' },
    { label: 'Avg approval', value: s.avgTurnaroundHours == null ? '—' : `${fmtInt(s.avgTurnaroundHours)}h`, sub: 'draft → approved' },
  ];

  // --- Command-center KPI strip (5-up) — REAL values + real-or-omitted sparklines ----------
  // Every value is a server stat; every sparkline is the server's real monthly series (or null →
  // the card shows value + delta only). The donut total below mirrors moduleUsage. Nothing faked.
  const adherenceNow = Array.isArray(activity.avgAdherence) && activity.avgAdherence.length
    ? activity.avgAdherence[activity.avgAdherence.length - 1] : null;
  const labsNow = Array.isArray(activity.labsCompleted) && activity.labsCompleted.length
    ? activity.labsCompleted[activity.labsCompleted.length - 1] : null;
  const kpis = [
    { label: 'Protocols generated', value: fmtInt(s.protocolsGenerated), spark: activity.protocolsGenerated, tone: 'cobalt', to: '/practice/reviews', ...(seriesDelta(activity.protocolsGenerated) || {}) },
    { label: 'Approved protocols', value: fmtInt(s.approvedProtocols), spark: activity.approvedProtocols, tone: 'good', ...(seriesDelta(activity.approvedProtocols) || {}) },
    { label: 'Labs on file', value: labsNow == null ? fmtInt(s.clientCount - s.clientsMissingLabs) : fmtInt(labsNow), spark: activity.labsCompleted, tone: 'cobalt', to: '/practice/clients', ...(seriesDelta(activity.labsCompleted) || {}) },
    { label: 'Avg adherence', value: adherenceNow == null ? '—' : `${adherenceNow}%`, spark: activity.avgAdherence, tone: 'good', ...(seriesDelta(activity.avgAdherence, { pts: true }) || {}) },
    { label: 'Pending review', value: fmtInt(s.pendingReviews), tone: 'cobalt', to: '/practice/reviews' },
  ];

  // --- Practice health (rings + revenue + pipeline) -- all from stats already returned ---
  const revenue = s.revenue || {};
  // Approval rate = approved / generated; active% = active / total clients. Honest null when no denominator.
  const healthRings = [
    { name: 'Approval rate', value: s.approvedProtocols, max: s.protocolsGenerated || 0, tone: 'success', label: s.protocolsGenerated ? `${Math.round((s.approvedProtocols / s.protocolsGenerated) * 100)}%` : '—', sublabel: `${fmtInt(s.approvedProtocols)}/${fmtInt(s.protocolsGenerated)}` },
    { name: 'Active clients', value: s.activeClients, max: s.clientCount || 0, tone: 'teal', label: s.clientCount ? `${Math.round((s.activeClients / s.clientCount) * 100)}%` : '—', sublabel: `${fmtInt(s.activeClients)}/${fmtInt(s.clientCount)}` },
  ];
  // Review pipeline: pending vs approved vs other (generated − pending − approved), proportional.
  const otherDrafts = Math.max(0, (s.protocolsGenerated || 0) - (s.pendingReviews || 0) - (s.approvedProtocols || 0));
  const pipelineSegments = [
    { label: 'Awaiting review', value: s.pendingReviews || 0, tone: 'warning' },
    { label: 'Approved', value: s.approvedProtocols || 0, tone: 'success' },
    { label: 'Other', value: otherDrafts, tone: 'neutral' },
  ];
  const money = (n) => `$${fmtInt(n || 0)}`;

  // --- Module / silo usage (server-derived counts) → one proportional bar + a rail ---
  const SILO_TONE = { peptide: 'teal', supplement: 'gold', meal: 'success', blood_req: 'warning' };
  const moduleSegments = moduleUsage.map((m) => ({ label: m.label, value: m.count || 0, tone: SILO_TONE[m.silo] || 'neutral' }));
  const moduleTotal = moduleSegments.reduce((sum, m) => sum + m.value, 0);

  // --- Generate / request by silo — the affordance that otherwise only lives inside a dossier.
  // Each launcher routes to the right generation surface (?clientId is chosen inside that surface).
  const siloLaunchers = [
    { silo: 'peptide', label: 'Peptide protocol', icon: ScrollText, to: '/practice/clients' },
    { silo: 'supplement', label: 'Supplement plan', icon: Pill, to: '/practice/add-ons' },
    { silo: 'meal', label: 'Meal / nutrition plan', icon: UtensilsCrossed, to: '/practice/add-ons' },
    { silo: 'blood_req', label: 'Bloodwork requisition', icon: FlaskConical, to: '/practice/clients' },
  ];

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="Practice command" title={p.name || 'Practice'} icon={Stethoscope}
        subtitle={[p.credentials, p.discipline].filter(Boolean).join(' · ') || 'Generate protocols, labs, and supplement / meal plans from a client’s dossier.'}
        ribbons={<>
          <StatusRibbon tone="success" icon={BadgeCheck}>Approval gate ON</StatusRibbon>
          {p._demo && <Badge tone="warning">demo</Badge>}
        </>}
      />

      <ActionCommandBar actions={actions} />

      {/* Command-center KPI strip — real values; sparklines are real monthly series or omitted */}
      <section className="space-y-3">
        <SectionHeader eyebrow="At a glance" title="Practice signals" sub="Each value is server-derived from your own records. Trendlines show real monthly activity where there is enough history — otherwise the figure stands alone (never an invented trend)." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {kpis.map((k) => <KpiSparkCard key={k.label} {...k} />)}
        </div>
      </section>

      {/* Needs you */}
      <section className="space-y-3">
        <SectionHeader eyebrow="Needs you" title="What needs attention" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CommandTile icon={ClipboardCheck} label="Drafts awaiting review" value={fmtInt(s.pendingReviews)} sub="before any client sees them" to="/practice/reviews" accent={!!s.pendingReviews} />
          <CommandTile icon={FlaskConical} label="Clients missing bloodwork" value={fmtInt(s.clientsMissingLabs)} sub="no labs on file" to="/practice/clients" accent={!!s.clientsMissingLabs} />
          <CommandTile icon={CalendarClock} label="Check-ins due (14d)" value={fmtInt(s.clientsDueCheckIn)} sub="on active protocols" to="/practice/clients" accent={!!s.clientsDueCheckIn} />
        </div>
      </section>

      <MetricRail items={metrics} />

      {/* Practice health — rings + demo revenue + review pipeline (all server-computed stats) */}
      <section className="space-y-3">
        <SectionHeader eyebrow="Practice health" title="Conversion, revenue & pipeline" sub="Derived from your own server-side stats — no estimates." />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <GoalProgressPanel
            title="Conversion"
            rings={healthRings}
            footer="Approval rate = approved ÷ generated. Active = clients on a live approved protocol."
          />
          <div className="space-y-3 lg:col-span-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <CommandTile icon={CircleDollarSign} label="MRR" value={money(revenue.mrr)} sub="demo — no processor" accent />
              <CommandTile icon={Pill} label="Add-on revenue" value={money(revenue.addOnRevenue)} sub="paid add-ons (demo)" />
              <CommandTile icon={Layers} label="Total / mo" value={money(revenue.total)} sub="demo — no processor" />
            </div>
            <Card>
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xs font-semibold uppercase tracking-[0.14em] text-gold">Review pipeline</span>
                  <Link to="/practice/reviews" className="text-2xs font-semibold text-primary hover:underline">Open queue →</Link>
                </div>
                <SegmentBar segments={pipelineSegments} emptyLabel="No protocols generated yet." formatValue={fmtInt} />
                <p className="text-2xs leading-relaxed text-faint">Only <span className="font-medium text-success">Approved</span> protocols are ever visible to a client.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Module / silo usage + generate-by-silo launcher */}
      <section className="space-y-3">
        <SectionHeader eyebrow="Modules" title="Silo usage & quick generate" sub="Per-silo counts are derived from your own documents — meal plans are the nutrition silo; requisitions count your clients' bloodwork documents." />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardContent className="space-y-3 pt-4">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-gold"><Layers className="h-3.5 w-3.5" /> Generated by silo</span>
                <span className="font-data text-2xs text-faint">{fmtInt(moduleTotal)} total</span>
              </div>
              {/* Donut — proportional silo mix; honest empty state when nothing is generated yet. */}
              <UtilizationDonut data={moduleUsage.map((m) => ({ name: m.label, value: m.count || 0 }))} total={moduleTotal} unit="docs" emptyLabel="No documents generated yet." className="border-b border-border-soft pb-3" />
              <SegmentBar segments={moduleSegments} emptyLabel="No documents generated yet." formatValue={fmtInt} />
              <div className="grid grid-cols-2 gap-2 border-t border-border-soft pt-3 sm:grid-cols-4">
                {moduleUsage.map((m) => (
                  <div key={m.silo} className="rounded-lg border border-border-soft bg-muted/30 px-3 py-2">
                    <div className="font-data text-lg font-semibold text-foreground">{fmtInt(m.count)}</div>
                    <div className="text-2xs text-faint">{m.label}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2 pt-4">
              <span className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-gold"><Wand2 className="h-3.5 w-3.5" /> Generate / request</span>
              <p className="text-2xs leading-relaxed text-faint">Open the surface for a silo, then pick the client. Generation is always gated — nothing reaches a client until you approve it.</p>
              <div className="overflow-hidden rounded-xl border border-border-soft">
                {siloLaunchers.map((l, i) => (
                  <Link key={l.silo} to={l.to} className={`flex items-center justify-between gap-2 px-3 py-2.5 text-sm text-foreground transition hover:bg-muted/40 ${i > 0 ? 'border-t border-border-soft' : ''}`}>
                    <span className="flex items-center gap-2"><l.icon className="h-4 w-4 text-gold" /> {l.label}</span>
                    <ArrowRight className="h-4 w-4 text-faint" />
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Referral activity (SCAFFOLD) — aggregate of this practice's clients' referral records */}
      {referrals && (
        <section className="space-y-3">
          <SectionHeader
            eyebrow="Referrals"
            title="Referral activity"
            sub="Cross-discipline referrals sent for your clients. Suggestion + handshake records only — no booking, no fee transport."
            actions={<Link to="/referrals" className="text-xs font-semibold text-primary hover:underline">Open network →</Link>}
          />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:col-span-1">
              <CommandTile icon={Send} label="Sent" value={fmtInt(referrals.sent)} sub={`${fmtInt(referrals.total)} on record`} />
              <CommandTile icon={BadgeCheck} label="Accepted" value={fmtInt(referrals.accepted)} sub={`${fmtInt(referrals.pending)} pending`} accent={!!referrals.accepted} />
              <CommandTile icon={Handshake} label="Handshakes" value={fmtInt(referrals.handshakes)} sub="mutually confirmed" />
              <CommandTile icon={Construction} label="Declined" value={fmtInt(referrals.declined)} sub="not accepted" />
            </div>
            <Card className="lg:col-span-2">
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-gold"><Network className="h-3.5 w-3.5" /> Recent referrals</span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-warning/40 bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"><Construction className="h-3 w-3" /> Scaffold</span>
                </div>
                {(referrals.recent || []).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border-soft px-3 py-4 text-center text-2xs text-faint">No referrals on record for your clients yet.</div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border-soft">
                    {referrals.recent.map((r, i) => (
                      <Link key={r.id} to={`/referrals?clientId=${encodeURIComponent(r.clientId)}`} className={`flex items-center justify-between gap-3 px-3 py-2.5 transition hover:bg-muted/40 ${i > 0 ? 'border-t border-border-soft' : ''}`}>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-foreground">{r.serviceLabel}</span>
                          <span className="block truncate text-2xs text-faint">→ {r.toName} · {fmtDate(r.createdAt)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <StatusChip tone={REFERRAL_TONE[r.status] || 'neutral'} label={r.status} />
                          {r.handshake && <Handshake className="h-3.5 w-3.5 text-success" />}
                          <ArrowRight className="h-4 w-4 text-faint" />
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* Review queue + roster */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <SectionHeader eyebrow="Review" title="Today’s review queue" actions={<Link to="/practice/reviews" className="text-xs font-semibold text-primary hover:underline">Open queue →</Link>} />
          {queue.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-success/25 bg-success-soft px-4 py-3.5 text-sm font-medium text-success"><CheckCircle2 className="h-4 w-4" /> Queue clear — nothing awaiting review.</div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
              {queue.slice(0, 7).map((d, i) => (
                <Link key={d.id} to={d.clientId ? `/practice/clients/${d.clientId}` : '/practice/reviews'} className={`flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-muted/40 ${i > 0 ? 'border-t border-border-soft' : ''}`}>
                  <span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{d.clientName || d.forClient || d.clientId}</span><span className="block text-2xs text-faint">{(d.items || []).length} items · {fmtDate(d.createdAt)}</span></span>
                  <span className="flex items-center gap-2"><StatusChip status={d.status} /><ArrowRight className="h-4 w-4 text-faint" /></span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <SectionHeader eyebrow="Roster" title="My clients" actions={<Link to="/practice/clients" className="text-xs font-semibold text-primary hover:underline">All →</Link>} />
          {clients.length === 0 ? <EmptyState title="No clients yet" hint="Add or invite a client." icon={Users} /> : (
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
              {clients.slice(0, 7).map((c, i) => (
                <Link key={c.id} to={`/practice/clients/${c.id}`} className={`flex items-center justify-between gap-2 px-4 py-3 transition hover:bg-muted/40 ${i > 0 ? 'border-t border-border-soft' : ''}`}>
                  <span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{c.name}</span><span className="block text-2xs text-faint">{(c.goals || []).slice(0, 2).join(', ') || 'no goals'}</span></span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-faint" />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Recent documents */}
      <section className="space-y-3">
        <SectionHeader eyebrow="Activity" title="Recently generated documents" />
        {recent.length === 0 ? <EmptyState title="No documents yet" hint="Generated protocols appear here." icon={FileText} /> : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
            {recent.map((d, i) => (
              <Link key={d.id} to={d.clientId ? `/practice/clients/${d.clientId}` : '/practice/reviews'} className={`flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-muted/40 ${i > 0 ? 'border-t border-border-soft' : ''}`}>
                <span className="flex min-w-0 items-center gap-2.5"><FileText className="h-4 w-4 shrink-0 text-gold" /><span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{d.title || 'Peptide protocol'}</span><span className="block text-2xs text-faint">{d.items} items · {fmtDate(d.createdAt)}</span></span></span>
                <StatusChip status={d.status} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
