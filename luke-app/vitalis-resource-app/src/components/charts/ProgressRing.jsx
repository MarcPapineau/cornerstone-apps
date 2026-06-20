/**
 * ProgressRing — a clean SVG goal ring in the Vitalis palette (no chart library needed). Shows a
 * percentage toward a goal/target with a center label; honest when value is null.
 */
// Tones read from the app theme vars (cobalt + cool steel + cooled semantics) so rings
// follow any future re-skin. `gold`/`teal` keys are kept (call-sites use them) but now
// resolve to cobalt / cool-steel on the platinum palette — no warm islands.
const TONE = {
  gold: 'hsl(var(--chart-1))', teal: 'hsl(var(--chart-2))',
  success: 'hsl(var(--success))', warning: 'hsl(var(--warning))', danger: 'hsl(var(--danger))',
};

export function ProgressRing({ value = null, max = 100, size = 88, stroke = 9, label, sublabel, tone = 'gold' }) {
  const has = value != null && !Number.isNaN(Number(value)) && max > 0;
  const pct = has ? Math.max(0, Math.min(1, Number(value) / max)) : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = TONE[tone] || TONE.gold;
  return (
    <div style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--ring-track))" strokeWidth={stroke} />
        {has && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        )}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <span className="font-data text-base font-semibold text-foreground">{label != null ? label : (has ? `${Math.round(pct * 100)}%` : '—')}</span>
        {sublabel && <span className="px-1 text-2xs leading-tight text-faint">{sublabel}</span>}
      </div>
    </div>
  );
}

export default ProgressRing;
