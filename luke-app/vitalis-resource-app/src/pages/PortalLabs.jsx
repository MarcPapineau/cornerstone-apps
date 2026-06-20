import { Link } from 'react-router-dom';
import { TestTubes, AlertTriangle, FlaskConical, UserCog, CheckCircle2, CalendarClock, LineChart as LineIcon, FileText, ArrowRight } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole } from '../lib/roleContext.jsx';
import { fmtDate } from '../lib/utils.js';
import { Card, CardContent } from '../components/ui/Card.jsx';
import { SectionHeader } from '../components/ui/SectionHeader.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';
import ProgressRing from '../components/charts/ProgressRing.jsx';
import TrendChart from '../components/charts/TrendChart.jsx';
import { DashboardHero, MetricRail, StatusRibbon } from '../components/dashboard/composers.jsx';

const isOut = (flag) => typeof flag === 'string' && flag.startsWith('OUT_OF_RANGE');

/**
 * PortalLabs — the client's lab-results surface. Reuses the canonical dashboard primitives:
 * a DashboardHero masthead, a summary MetricRail (panels on file / values to review / latest
 * draw + a "% markers in range" ring), and an optional per-marker TrendChart when a marker
 * recurs across draws. All flags come from the server's labResultFlagGate projection — the
 * browser never decides in/out of range. Out-of-range values carry a "review with your provider"
 * note; Vitalis does not diagnose.
 */
export default function PortalLabs() {
  const { clientId } = useRole();
  const labsQ = useFetch(() => (clientId ? api.labResults(clientId) : Promise.resolve(null)), [clientId]);
  const protoQ = useFetch(() => (clientId ? api.clientProtocols(clientId) : Promise.resolve(null)), [clientId]);

  if (!clientId) {
    return (
      <div className="space-y-6">
        <DashboardHero eyebrow="My Vitalis Health" title="My Labs" icon={TestTubes} subtitle="Your lab results." />
        <Card><CardContent className="py-10"><EmptyState title="No client selected" hint="Pick a client in the “View as” switcher." icon={UserCog} /></CardContent></Card>
      </div>
    );
  }
  if (labsQ.loading) return <Loading label="Loading your labs…" />;
  if (labsQ.error) return <ErrorState error={labsQ.error} />;
  const labs = labsQ.data?.results || [];
  // The bloodwork requisition is keyed by the client's APPROVED protocol draftId. clientProtocols
  // is already approval-gated (un-approved drafts are dropped server-side), so this id only ever
  // resolves an approved protocol — safe to open with ?role=CLIENT.
  const reqProtocolId = protoQ.data?.current?.[0]?.id || protoQ.data?.past?.[0]?.id || null;

  // Server-projected flags only. Count rangeable markers (those with a reference range) and how
  // many fall inside it, across every panel on file — never re-derived in the browser.
  let rangeable = 0;
  let inRange = 0;
  let flaggedTotal = 0;
  for (const r of labs) {
    for (const v of r.values || []) {
      if (v.flag === 'IN_RANGE' || isOut(v.flag)) rangeable += 1;
      if (v.flag === 'IN_RANGE') inRange += 1;
      if (isOut(v.flag)) flaggedTotal += 1;
    }
  }
  const inRangePct = rangeable ? Math.round((inRange / rangeable) * 100) : null;
  const sorted = labs.slice().sort((a, b) => new Date(b.drawnAt || 0) - new Date(a.drawnAt || 0));
  const latestDraw = sorted[0]?.drawnAt;

  // Optional marker trend: pick the marker present in the MOST draws (≥2). Build a chronological
  // value series from the server's recorded numbers — purely a visualization of recorded data.
  const byMarker = {};
  for (const r of labs) {
    for (const v of r.values || []) {
      if (v.value == null) continue;
      (byMarker[v.marker] ||= []).push({ drawnAt: r.drawnAt, value: Number(v.value), unit: v.unit });
    }
  }
  let trendMarker = null;
  let trendUnit = '';
  let trendSeries = [];
  for (const [marker, pts] of Object.entries(byMarker)) {
    if (pts.length >= 2 && pts.length > trendSeries.length) {
      trendMarker = marker;
      trendUnit = pts[0].unit || '';
      trendSeries = pts.slice().sort((a, b) => new Date(a.drawnAt) - new Date(b.drawnAt)).map((p) => ({ label: (p.drawnAt || '').slice(0, 10).slice(5), value: p.value }));
    }
  }

  const metrics = [
    { label: 'Panels on file', value: labs.length, sub: labs.length === 1 ? 'draw' : 'draws' },
    { label: 'Values to review', value: flaggedTotal, sub: flaggedTotal ? 'with your provider' : 'none flagged', tone: flaggedTotal ? 'warning' : 'success' },
    { label: 'Markers in range', value: inRangePct != null ? `${inRangePct}%` : '—', ring: inRangePct, ringMax: 100, tone: flaggedTotal ? 'warning' : 'success', sub: `${inRange}/${rangeable} markers` },
    { label: 'Latest draw', value: latestDraw ? fmtDate(latestDraw) : '—', sub: latestDraw ? 'most recent' : 'no draws yet' },
  ];

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="My Vitalis Health" title="My Labs" icon={TestTubes}
        subtitle="Your lab results. Out-of-range values show a “review with your provider” note — Vitalis does not diagnose."
        ribbons={labs.length === 0
          ? <StatusRibbon tone="ink">No labs yet</StatusRibbon>
          : flaggedTotal
            ? <StatusRibbon tone="warning" icon={AlertTriangle}>{flaggedTotal} to review</StatusRibbon>
            : <StatusRibbon tone="success" icon={CheckCircle2}>All in range</StatusRibbon>}
      />

      {reqProtocolId && (
        <Link
          to={`/document/blood_req/${encodeURIComponent(reqProtocolId)}?role=CLIENT`}
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-card transition hover:border-gold/40 hover:bg-muted/40"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-gold"><FlaskConical className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">View bloodwork requisition</span>
            <span className="block truncate text-2xs text-soft">The panels to ask your provider for — your approved baseline plus protocol markers. An educational resource, not a prescription.</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">Open <ArrowRight className="h-3.5 w-3.5" /></span>
        </Link>
      )}

      {labs.length === 0 ? (
        <Card><CardContent className="py-12"><EmptyState title="No labs on file" hint="Once your practitioner records lab results, they appear here." icon={FlaskConical} /></CardContent></Card>
      ) : (
        <>
          <MetricRail items={metrics} />

          {trendMarker && (
            <div className="space-y-3">
              <SectionHeader eyebrow="Across draws" title={`${trendMarker} trend`} sub="Recorded values over time — a visualization of your draws, not a diagnosis." actions={<span className="inline-flex items-center gap-1 text-2xs text-faint"><LineIcon className="h-3.5 w-3.5" /> {trendSeries.length} draws</span>} />
              <Card><CardContent className="pt-4"><TrendChart data={trendSeries} series={[{ key: 'value', label: `${trendMarker}${trendUnit ? ` (${trendUnit})` : ''}` }]} height={200} legend /></CardContent></Card>
            </div>
          )}

          <div className="space-y-3">
            <SectionHeader eyebrow="Results" title="Panels on file" actions={<span className="inline-flex items-center gap-1 text-2xs text-faint"><CalendarClock className="h-3.5 w-3.5" /> {labs.length} on file</span>} />
            <div className="space-y-4">
              {sorted.map((r) => (
                <Card key={r.id}>
                  <CardContent className="pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">Drawn {fmtDate(r.drawnAt)}</span>
                      {r.hasFlags ? <StatusChip status="flagged" label={`${r.flags.length} to review`} /> : <StatusChip status="normal" label="all in range" />}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(r.values || []).map((v, i) => {
                        const out = isOut(v.flag);
                        return (
                          <span key={i} className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-2xs ${out ? 'border-danger/30 bg-danger-soft text-danger' : 'border-border-soft text-soft'}`}>
                            <span className="font-medium">{v.marker}</span>
                            <span className="font-data">{v.value ?? '—'}{v.unit ? ` ${v.unit}` : ''}</span>
                            {(v.refLow != null || v.refHigh != null) && <span className="text-faint">({v.refLow ?? '–'}–{v.refHigh ?? '–'})</span>}
                          </span>
                        );
                      })}
                    </div>
                    {r.hasFlags && <p className="mt-2.5 inline-flex items-center gap-1 text-2xs font-medium text-danger"><AlertTriangle className="h-3.5 w-3.5" /> Some values are outside the reference range. Review these with your provider — this is not a diagnosis.</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
