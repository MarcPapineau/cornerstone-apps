import { cn } from '../../lib/utils.js';

/**
 * StatCard — a premium metric tile (Vitalis token identity). label + big data value + optional
 * delta, sub, icon, and accent tone. Used across the client + practitioner dashboards.
 */
const ICON_TONE = {
  neutral: 'text-faint', primary: 'text-primary', gold: 'text-gold',
  success: 'text-success', warning: 'text-warning', danger: 'text-danger',
};
const DELTA_TONE = { up: 'text-success', down: 'text-danger', flat: 'text-faint' };

export function StatCard({ label, value, sub, delta, deltaTone = 'flat', icon: Icon, tone = 'neutral', accent = false, className }) {
  return (
    <div className={cn('rounded-lg border bg-card p-4 shadow-card', accent ? 'border-gold/40 bg-accent-soft/40' : 'border-border', className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-faint">{label}</span>
        {Icon && <Icon className={cn('h-4 w-4', ICON_TONE[tone] || 'text-faint')} />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-data text-2xl font-semibold tracking-tight text-foreground">{value}</span>
        {delta != null && delta !== '' && <span className={cn('text-xs font-medium', DELTA_TONE[deltaTone] || 'text-faint')}>{delta}</span>}
      </div>
      {sub && <div className="mt-0.5 text-2xs text-faint">{sub}</div>}
    </div>
  );
}

export default StatCard;
