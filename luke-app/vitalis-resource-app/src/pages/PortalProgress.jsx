import { LineChart as LineIcon, UserCog, Activity, TrendingDown, Dumbbell, Target, ClipboardList } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole } from '../lib/roleContext.jsx';
import { fmtDate } from '../lib/utils.js';
import { Card, CardContent } from '../components/ui/Card.jsx';
import { StatCard } from '../components/ui/StatCard.jsx';
import { SectionHeader } from '../components/ui/SectionHeader.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';
import TrendChart from '../components/charts/TrendChart.jsx';
import { DashboardHero, GoalProgressPanel, StatusRibbon } from '../components/dashboard/composers.jsx';

const fmtDelta = (v, unit) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}${unit}`);
const deltaTone = (v, goodWhenNegative) => (v == null ? 'flat' : (v < 0) === !!goodWhenNegative ? 'up' : 'down');

/**
 * PortalProgress — the client's body-composition + adherence trend surface. Reuses the canonical
 * dashboard primitives (DashboardHero, StatCard rail, GoalProgressPanel rings, TrendChart) instead
 * of hand-rolled Recharts/Delta blocks. Everything is a tracking heuristic, never a clinical
 * judgement; rings encode honest progress-from-baseline, not a fabricated clinical target. Below
 * two datapoints the page still shows goal rings + a populated layout — never a blank box.
 */
export default function PortalProgress() {
  const { clientId } = useRole();
  const outQ = useFetch(() => (clientId ? api.outcomes(clientId) : Promise.resolve(null)), [clientId]);
  const scoreQ = useFetch(() => (clientId ? api.scorecard(clientId) : Promise.resolve(null)), [clientId]);

  if (!clientId) {
    return (
      <div className="space-y-6">
        <DashboardHero eyebrow="My Vitalis Health" title="My Progress" icon={Activity} subtitle="Your tracked metrics." />
        <Card><CardContent className="py-10"><EmptyState title="No client selected" hint="Pick a client in the “View as” switcher." icon={UserCog} /></CardContent></Card>
      </div>
    );
  }
  if (outQ.loading) return <Loading label="Loading your progress…" />;
  if (outQ.error) return <ErrorState error={outQ.error} />;

  const outcomes = (outQ.data?.outcomes || []).slice().sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  const series = outcomes.map((o) => ({ label: (o.recordedAt || '').slice(5, 10), Weight: o.weightKg ?? null, 'Lean mass': o.leanMassKg ?? null, 'Body fat %': o.bodyFatPct ?? null }));
  const sc = scoreQ.data?.scorecard;
  const deltas = sc?.deltas || {};
  const hasLogs = outcomes.length > 0;

  // Honest progress rings. Adherence is a true 0–100% average. Body-fat / lean rings encode
  // *progress from baseline* on a small fixed heuristic scale (never a clinical target): each ring
  // fills toward a modest reference move and shows the real measured delta as its label. When a
  // metric is unmeasured the ring is honestly empty (—).
  const fatProgress = deltas.bodyFatPct != null ? Math.max(0, Math.min(100, (-deltas.bodyFatPct / 3) * 100)) : null; // 3% fat drop = full ring
  const leanProgress = deltas.leanMassKg != null ? Math.max(0, Math.min(100, ((deltas.leanMassKg + 1) / 3) * 100)) : null; // hold (−1) → +2kg span
  const rings = [
    { name: 'Adherence', value: sc?.adherenceAvg ?? null, max: 100, tone: 'gold', sublabel: 'protocol avg' },
    { name: 'Body-fat trend', value: fatProgress, max: 100, tone: 'success', label: fmtDelta(deltas.bodyFatPct, '%'), sublabel: 'from baseline' },
    { name: 'Lean mass', value: leanProgress, max: 100, tone: 'teal', label: fmtDelta(deltas.leanMassKg, 'kg'), sublabel: 'from baseline' },
    { name: 'Datapoints', value: outcomes.length ? 100 : null, max: 100, tone: 'gold', label: String(outcomes.length), sublabel: 'logged' },
  ];

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="My Vitalis Health" title="My Progress" icon={Activity}
        subtitle="Weight, body composition and adherence you’ve recorded. These are tracking heuristics, never a clinical judgement."
        ribbons={hasLogs
          ? <StatusRibbon tone="teal" icon={ClipboardList}>{outcomes.length} entries</StatusRibbon>
          : <StatusRibbon tone="ink">No entries yet</StatusRibbon>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Weight Δ" value={fmtDelta(deltas.weightKg, 'kg')} sub="vs baseline" icon={TrendingDown} tone="primary" deltaTone={deltaTone(deltas.weightKg, true)} />
        <StatCard label="Body fat Δ" value={fmtDelta(deltas.bodyFatPct, '%')} sub="vs baseline" icon={TrendingDown} tone="success" deltaTone={deltaTone(deltas.bodyFatPct, true)} />
        <StatCard label="Lean mass Δ" value={fmtDelta(deltas.leanMassKg, 'kg')} sub="vs baseline" icon={Dumbbell} tone="primary" deltaTone={deltaTone(deltas.leanMassKg, false)} />
        <StatCard label="Adherence" value={sc?.adherenceAvg != null ? `${sc.adherenceAvg}%` : '—'} sub="protocol avg" icon={Target} tone="gold" accent />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <SectionHeader eyebrow="How I’m progressing" title="Body composition trend" sub="Your recorded outcome metrics over time." />
          <Card>
            <CardContent className="pt-4">
              {series.length < 2 ? (
                <EmptyState title="One entry so far" hint="Your goal rings are tracking from baseline. Log a second entry to chart a trend line." icon={LineIcon} />
              ) : (
                <TrendChart data={series} series={[{ key: 'Weight' }, { key: 'Lean mass' }, { key: 'Body fat %' }]} height={260} legend />
              )}
            </CardContent>
          </Card>

          {hasLogs && (
            <>
              <SectionHeader eyebrow="History" title="Log" sub="Most recent entries first." />
              <Card>
                <CardContent>
                  <ul className="divide-y divide-border-soft">
                    {outcomes.slice().reverse().slice(0, 10).map((o) => (
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
                </CardContent>
              </Card>
            </>
          )}
        </div>

        <div className="space-y-3">
          <SectionHeader eyebrow="At a glance" title="Goal progress" />
          <GoalProgressPanel
            title="Tracking rings"
            rings={rings}
            footer={hasLogs
              ? 'Rings track progress from your baseline entry — a heuristic, not a clinical target. Discuss any change with your provider.'
              : 'Record your first entry to start filling these rings. Nothing here is a clinical judgement.'}
          />
          {!hasLogs && (
            <Card><CardContent className="py-6"><EmptyState title="No entries yet" hint="Once your practitioner records outcomes, your trend and rings populate here." icon={ClipboardList} /></CardContent></Card>
          )}
        </div>
      </div>
    </div>
  );
}
