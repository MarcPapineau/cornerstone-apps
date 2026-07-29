import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { cn } from '../../lib/utils.js';

/**
 * UtilizationDonut — a Vitalis-palette donut for per-silo / per-segment utilization. Promoted
 * from the Phase-0 proof; the proof's clipped legend is FIXED here (the legend column wraps and
 * widens, never truncates a silo label). Colors read from the app's --chart-* tokens (+ cobalt
 * tints) so the chart follows any re-skin. HONEST empty state when the total is 0 — never a fake
 * full ring.
 *
 *   data = [{ name, value }]   (value is a real server-derived count; 0-total → empty state)
 *   total (optional)           — override the centre figure; defaults to the sum of values
 *   unit  (optional)           — centre caption under the total (e.g. "docs")
 *
 * Palette is cobalt → cobalt-tints → cool-steel (the data-viz family), distinct from the dossier.
 */
const PALETTE = [
  'hsl(var(--chart-1))',   // cobalt — primary series
  'hsl(217 60% 52%)',      // cobalt tint 1
  'hsl(216 48% 64%)',      // cobalt tint 2
  'hsl(215 38% 74%)',      // cobalt tint 3 (pale)
  'hsl(var(--chart-2))',   // cool steel-slate
  'hsl(var(--chart-3))',   // cooled green (overflow)
];

export function UtilizationDonut({ data = [], total, unit = '', emptyLabel = 'No documents generated yet.', className }) {
  const items = (data || []).filter((d) => d && Number(d.value) >= 0);
  const sum = items.reduce((s, d) => s + Number(d.value || 0), 0);
  const centre = total != null ? total : sum;

  if (sum <= 0) {
    return (
      <div className={cn('flex items-center gap-4', className)}>
        <div className="flex h-[132px] w-[132px] shrink-0 items-center justify-center rounded-full border border-dashed border-border-soft text-2xs text-faint">
          <span className="px-3 text-center leading-tight">{emptyLabel}</span>
        </div>
        <ul className="min-w-0 flex-1 space-y-1.5">
          {items.length === 0 ? (
            <li className="text-2xs text-faint">Nothing to chart yet.</li>
          ) : items.map((d, i) => (
            <li key={d.name || i} className="flex items-center gap-2 text-2xs">
              <span className="h-2 w-2 shrink-0 rounded-full bg-muted" />
              <span className="min-w-0 break-words text-soft">{d.name}</span>
              <span className="ml-auto font-data font-semibold text-faint">0</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <div className="relative h-[132px] w-[132px] shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={items} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={62} paddingAngle={1.5} strokeWidth={0} isAnimationActive={false}>
              {items.map((d, i) => <Cell key={d.name || i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid hsl(var(--border-soft))', color: 'hsl(var(--foreground))' }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-data text-lg font-bold text-foreground">{centre}</span>
          {unit && <span className="text-[0.5625rem] uppercase tracking-wide text-faint">{unit}</span>}
        </div>
      </div>
      {/* Non-truncating legend — the column wraps long silo labels instead of clipping them. */}
      <ul className="min-w-0 flex-1 space-y-1.5">
        {items.map((d, i) => (
          <li key={d.name || i} className="flex items-start gap-2 text-2xs">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="min-w-0 flex-1 break-words leading-snug text-foreground">{d.name}</span>
            <span className="ml-auto shrink-0 font-data font-semibold text-faint">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default UtilizationDonut;
