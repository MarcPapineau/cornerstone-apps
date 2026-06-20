import { Link } from 'react-router-dom';
import {
  Building2, Users, UserCircle2, Stethoscope, FileText, Pill, UtensilsCrossed,
  ClipboardCheck, CircleDollarSign, ArrowRight, Activity, CreditCard, ShieldCheck, BadgeCheck,
  Network, Send, Handshake, Construction,
} from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { fmtInt } from '../lib/utils.js';
import { Card, CardContent } from '../components/ui/Card.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';
import { SectionHeader } from '../components/ui/SectionHeader.jsx';
import { DashboardHero, MetricRail, CommandTile, StatusRibbon, SegmentBar, MiniBar, KpiSparkCard } from '../components/dashboard/composers.jsx';
import { statusTone } from '../components/ui/StatusChip.jsx';
import UtilizationDonut from '../components/charts/UtilizationDonut.jsx';

// Honest delta from a real ≥2-point monthly series: most recent month-over-month change.
// Returns null (→ no delta pill) when there is no real series. Never invents a trend.
function seriesDelta(series, { pts = false } = {}) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const d = series[series.length - 1] - series[series.length - 2];
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  return { delta: `${sign}${Math.abs(d)}${pts ? ' pts' : ''}`, up: d >= 0 };
}

const ACCESS_TONE = { ACTIVE: 'success', SUSPENDED: 'danger', INVITED: 'accent', PENDING_REVIEW: 'warning' };
const money = (n) => `$${fmtInt(n || 0)}`;

const OPERATE = [
  { to: '/admin/practitioners', label: 'Practitioners / Providers', icon: Stethoscope },
  { to: '/admin/direct-clients', label: 'Direct Clients', icon: UserCircle2 },
  { to: '/admin/plans', label: 'Subscription Plans', icon: CreditCard },
  { to: '/admin/system', label: 'System Health & Research', icon: ShieldCheck },
];

/** AdminOverview — the platform OPERATOR command center (custom Vitalis composition). */
export default function AdminOverview() {
  const ov = useFetch(() => api.adminOverview(), []);
  if (ov.loading) return <Loading label="Loading platform overview…" />;
  if (ov.error) return <ErrorState error={ov.error} />;

  const c = ov.data?.counts || {};
  const fees = ov.data?.fees || {};
  const byStatus = ov.data?.draftsByStatus || {};
  const perPrac = ov.data?.perPractitioner || [];
  const referrals = ov.data?.referrals || null;
  const demo = ov.data?.demo;
  // Real platform-wide monthly sparkline series (server-derived; ≥2-point array or null → omit).
  const activity = ov.data?.activity || {};

  const pulse = [
    { label: 'Clients', value: fmtInt(c.clients), sub: `${fmtInt(c.directClients)} direct · ${fmtInt(c.providerClients)} provider` },
    { label: 'Practitioners', value: fmtInt(c.practitioners), sub: 'tenant providers' },
    { label: 'Protocols generated', value: fmtInt(c.protocolsGenerated), sub: `${fmtInt(c.approvedResources)} approved` },
    { label: 'Revenue / mo', value: money(fees.total), sub: 'demo — no processor', tone: 'gold' },
  ];
  const generation = [
    { label: 'Peptide protocols', value: fmtInt(c.peptideProtocols) },
    { label: 'Supplement plans', value: fmtInt(c.supplementPlans) },
    { label: 'Meal plans', value: fmtInt(c.mealPlans) },
    { label: 'Monthly usage', value: fmtInt(c.monthlyProtocolUsage), sub: 'credits used' },
  ];

  // --- Command-center KPI strip (5-up) — REAL counts + real-or-omitted sparklines ----------
  // Values are server counts; sparklines are the server's real platform-wide monthly series (or
  // null → value + delta only). The silo donut below mirrors the same counts. Nothing fabricated.
  const adherenceNow = Array.isArray(activity.avgAdherence) && activity.avgAdherence.length
    ? activity.avgAdherence[activity.avgAdherence.length - 1] : null;
  const labsNow = Array.isArray(activity.labsCompleted) && activity.labsCompleted.length
    ? activity.labsCompleted[activity.labsCompleted.length - 1] : null;
  const kpis = [
    { label: 'Protocols generated', value: fmtInt(c.protocolsGenerated), spark: activity.protocolsGenerated, tone: 'cobalt', ...(seriesDelta(activity.protocolsGenerated) || {}) },
    { label: 'Approved resources', value: fmtInt(c.approvedResources), spark: activity.approvedProtocols, tone: 'good', ...(seriesDelta(activity.approvedProtocols) || {}) },
    { label: 'Labs on file', value: labsNow == null ? '—' : fmtInt(labsNow), spark: activity.labsCompleted, tone: 'cobalt', ...(seriesDelta(activity.labsCompleted) || {}) },
    { label: 'Avg adherence', value: adherenceNow == null ? '—' : `${adherenceNow}%`, spark: activity.avgAdherence, tone: 'good', ...(seriesDelta(activity.avgAdherence, { pts: true }) || {}) },
    { label: 'Drafts awaiting', value: fmtInt(c.draftsAwaiting), tone: 'cobalt' },
  ];

  // Silo mix for the utilization donut (the same three real generation counts, never one $total).
  const siloMix = [
    { name: 'Peptide protocols', value: c.peptideProtocols || 0 },
    { name: 'Supplement plans', value: c.supplementPlans || 0 },
    { name: 'Meal plans', value: c.mealPlans || 0 },
  ];
  const siloTotal = siloMix.reduce((s, d) => s + d.value, 0);

  // Revenue split — three real components the server already computes (never one $total).
  const revenueSegments = [
    { label: 'MRR', value: fees.mrr || 0, tone: 'gold' },
    { label: 'Overage', value: fees.overageRevenue || 0, tone: 'teal' },
    { label: 'Add-ons', value: fees.addOnRevenue || 0, tone: 'success' },
  ];
  // Draft pipeline — same draftsByStatus map, as a proportional stacked bar (rows kept below).
  const statusEntries = Object.entries(byStatus);
  const pipelineSegments = statusEntries.map(([status, n]) => ({ label: status.replace(/_/g, ' '), value: n, tone: statusTone(status) }));

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="Platform pulse" title="Vitalis Platform" icon={Building2}
        subtitle="Vitalis hosts the platform; practitioners are tenants and clients belong to them. Every figure is derived server-side from single-sourced ownership."
        ribbons={<>
          <StatusRibbon tone="teal" icon={Building2}>Vitalis Admin</StatusRibbon>
          {demo?.clientCount != null && <Badge tone="warning">{fmtInt(demo.clientCount)} demo clients</Badge>}
        </>}
      />

      <MetricRail items={pulse} />

      {/* Command-center KPI strip — real counts; sparklines are real monthly series or omitted */}
      <section className="space-y-3">
        <SectionHeader eyebrow="At a glance" title="Platform signals" sub="Each value is derived server-side from single-sourced ownership. Trendlines show real monthly activity where there is enough history — otherwise the figure stands alone (never an invented trend)." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {kpis.map((k) => <KpiSparkCard key={k.label} {...k} />)}
        </div>
      </section>

      {/* Revenue split — the $total broken into its three real components */}
      <section className="space-y-3">
        <SectionHeader eyebrow="Revenue" title="Demo revenue split" sub="Demo figures — no payment processor wired." />
        <Card><CardContent className="space-y-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground"><Activity className="h-4 w-4 text-gold" /> {money(fees.total)} / mo</span>
            <Badge tone="warning">demo — no processor</Badge>
          </div>
          <SegmentBar segments={revenueSegments} emptyLabel="No demo revenue yet." formatValue={money} />
        </CardContent></Card>
      </section>

      {/* Needs attention */}
      <section className="space-y-3">
        <SectionHeader eyebrow="Needs attention" title="Operator actions" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CommandTile icon={ClipboardCheck} label="Drafts awaiting review" value={fmtInt(c.draftsAwaiting)} sub="across all providers" accent={!!c.draftsAwaiting} />
          <CommandTile icon={CircleDollarSign} label="Add-on requests unpaid" value={fmtInt(c.unpaidAddOnRequests)} sub={`${fmtInt(c.paidAddOnRequests)} paid`} accent={!!c.unpaidAddOnRequests} />
          <CommandTile icon={BadgeCheck} label="Approved add-ons" value={fmtInt(c.approvedAddOns)} sub="client-visible" />
        </div>
      </section>

      {/* Generation volume — metric rail + a proportional silo-mix donut (same real counts) */}
      <section className="space-y-3">
        <SectionHeader
          eyebrow="Document generation" title="Volume by silo"
          actions={<Link to="/referrals" className="text-xs font-semibold text-primary hover:underline">Open ecosystem map →</Link>}
        />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2"><MetricRail items={generation} /></div>
          <Card><CardContent className="space-y-2 pt-4">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-gold"><Activity className="h-3.5 w-3.5" /> Silo mix</span>
              <span className="font-data text-2xs text-faint">{fmtInt(siloTotal)} total</span>
            </div>
            <UtilizationDonut data={siloMix} total={siloTotal} unit="docs" emptyLabel="No documents generated yet." />
          </CardContent></Card>
        </div>
      </section>

      {/* Referral activity (SCAFFOLD) — cross-discipline network roster + demo handshake records */}
      {referrals && (
        <section className="space-y-3">
          <SectionHeader
            eyebrow="Referrals"
            title="Cross-discipline referral network"
            sub="Partner roster + demo handshake records. Suggestion surface only — sending a referral, the recipient handshake, and any fee are not wired."
            actions={<Link to="/referrals" className="text-xs font-semibold text-primary hover:underline">Open network →</Link>}
          />
          <Card><CardContent className="space-y-4 pt-4">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground"><Network className="h-4 w-4 text-gold" /> {fmtInt(referrals.networkSize)} partners · {fmtInt(referrals.services)} services</span>
              <Badge tone="warning"><Construction className="mr-1 h-3 w-3" /> scaffold — no transport / fee</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <CommandTile icon={Stethoscope} label="Accepting referrals" value={fmtInt(referrals.acceptingReferrals)} sub={`${fmtInt(referrals.networkSize)} in roster`} />
              <CommandTile icon={Send} label="Demo records" value={fmtInt(referrals.records)} sub={`${fmtInt(referrals.pending)} pending`} />
              <CommandTile icon={BadgeCheck} label="Accepted" value={fmtInt(referrals.accepted)} sub={`${fmtInt(referrals.declined)} declined`} accent={!!referrals.accepted} />
              <CommandTile icon={Handshake} label="Handshakes" value={fmtInt(referrals.handshakes)} sub="mutually confirmed" />
            </div>
            <SegmentBar
              segments={[
                { label: 'Accepted', value: referrals.accepted, tone: 'success' },
                { label: 'Pending', value: referrals.pending, tone: 'warning' },
                { label: 'Declined', value: referrals.declined, tone: 'danger' },
              ]}
              emptyLabel="No referral records yet."
              formatValue={fmtInt}
            />
          </CardContent></Card>
        </section>
      )}

      {/* Providers + drafts-by-status + operate */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <SectionHeader eyebrow="Tenants" title="Practitioners" actions={<Link to="/admin/practitioners" className="text-xs font-semibold text-primary hover:underline">Manage →</Link>} />
          <Card><CardContent className="px-0 pb-1">
            {perPrac.length === 0 ? <EmptyState title="No practitioners" icon={Stethoscope} /> : (
              <Table>
                <THead><TR className="hover:bg-transparent"><TH className="pl-5">Practitioner</TH><TH>Access</TH><TH>Plan</TH><TH>Clients</TH><TH>Modules (supp / meal)</TH><TH className="pr-5">Approval (approved / generated)</TH></TR></THead>
                <TBody>
                  {perPrac.map((p) => (
                    <TR key={p.id}>
                      <TD className="pl-5"><Link to={`/admin/practitioners/${p.id}`} className="font-medium text-foreground hover:text-primary hover:underline">{p.name}</Link>{p.practitionerType === 'OWNER' && <Badge tone="accent" className="ml-1.5">Owner</Badge>}</TD>
                      <TD><StatusChip tone={ACCESS_TONE[p.accessStatus] || 'neutral'} label={p.accessStatus} /></TD>
                      <TD className="font-data text-2xs uppercase text-soft">{p.planLevel}</TD>
                      <TD className="font-data text-sm">{fmtInt(p.clientCount)}</TD>
                      <TD className="font-data text-2xs text-soft"><span className="inline-flex items-center gap-1"><Pill className="h-3 w-3 text-gold" />{fmtInt(p.supplementPlans)}</span><span className="mx-1 text-faint">/</span><span className="inline-flex items-center gap-1"><UtensilsCrossed className="h-3 w-3 text-primary" />{fmtInt(p.mealPlans)}</span></TD>
                      <TD className="pr-5">
                        <div className="flex items-center gap-2.5">
                          <MiniBar value={p.approvedCount} max={p.generatedCount} tone="success" width={56} />
                          <span className="font-data text-2xs text-soft"><span className="text-success">{fmtInt(p.approvedCount)}</span> / {fmtInt(p.generatedCount)}{p.pendingReviews ? <span className="text-warning"> · {fmtInt(p.pendingReviews)} pending</span> : null}</span>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent></Card>
        </section>

        <div className="space-y-6">
          <section className="space-y-3">
            <SectionHeader eyebrow="Pipeline" title="Drafts by status" sub="Only APPROVED_RESOURCE is client-visible." />
            <Card><CardContent className="space-y-3 pt-4">
              {statusEntries.length === 0 ? <EmptyState title="No drafts" icon={FileText} /> : (
                <>
                  <SegmentBar segments={pipelineSegments} legend={false} emptyLabel="No drafts yet." formatValue={fmtInt} />
                  <div className="space-y-2.5 border-t border-border-soft pt-3">
                    {statusEntries.map(([status, n]) => (
                      <div key={status} className="flex items-center justify-between gap-2"><StatusChip status={status} /><span className="font-data text-sm text-foreground">{fmtInt(n)}</span></div>
                    ))}
                  </div>
                </>
              )}
            </CardContent></Card>
          </section>

          <section className="space-y-3">
            <SectionHeader eyebrow="Manage" title="Operate" />
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
              {OPERATE.map((l, i) => (
                <Link key={l.to} to={l.to} className={`flex items-center justify-between gap-2 px-4 py-3 text-sm text-foreground transition hover:bg-muted/40 ${i > 0 ? 'border-t border-border-soft' : ''}`}>
                  <span className="flex items-center gap-2"><l.icon className="h-4 w-4 text-gold" /> {l.label}</span>
                  <ArrowRight className="h-4 w-4 text-faint" />
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
