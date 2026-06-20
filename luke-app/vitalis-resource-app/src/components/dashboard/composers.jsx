import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line } from 'recharts';
import { cn } from '../../lib/utils.js';
import ProgressRing from '../charts/ProgressRing.jsx';

/**
 * composers.jsx — the CUSTOM Vitalis layout primitives (not generic cards). Editorial mastheads,
 * metric rails, status ribbons, command tiles, service-silo + goal panels, action command bars,
 * document-preview + timeline rails. These compose the dashboards into a clinical-dossier OS.
 */

// --- Status ribbon (left-accent bar, not a pill) ----------------------------
const RIBBON = {
  gold: 'border-l-gold bg-gold-soft text-primary',
  teal: 'border-l-primary bg-accent-soft text-primary',
  success: 'border-l-success bg-success-soft text-success',
  warning: 'border-l-warning bg-warning-soft text-[hsl(32_60%_30%)]',
  danger: 'border-l-danger bg-danger-soft text-danger',
  ink: 'border-l-ink bg-panel text-foreground',
};
export function StatusRibbon({ tone = 'ink', icon: Icon, children }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-r-md border-l-[3px] px-2.5 py-1 text-2xs font-semibold uppercase tracking-wide', RIBBON[tone] || RIBBON.ink)}>
      {Icon && <Icon className="h-3.5 w-3.5" />}{children}
    </span>
  );
}

// --- Dashboard hero (editorial masthead) ------------------------------------
export function DashboardHero({ eyebrow, title, subtitle, icon: Icon, ribbons, children }) {
  return (
    <header className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-panel via-card to-card px-6 py-5 shadow-card">
      <span className="absolute inset-y-0 left-0 w-1 bg-gold" aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <div className="font-label text-2xs font-semibold uppercase tracking-[0.18em] text-gold">{eyebrow}</div>}
          <h1 className="mt-1 flex items-center gap-2 font-serif text-[2rem] font-semibold leading-tight tracking-tight text-foreground">
            {Icon && <Icon className="h-6 w-6 shrink-0 text-primary" />}{title}
          </h1>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-soft">{subtitle}</p>}
        </div>
        {ribbons && <div className="flex flex-wrap items-center justify-end gap-2">{ribbons}</div>}
      </div>
      {children}
    </header>
  );
}

// --- Metric rail (ONE divided container, not separate cards) ----------------
export function MetricRail({ items = [], className }) {
  return (
    <div className={cn('grid grid-cols-2 divide-x divide-y divide-border-soft overflow-hidden rounded-xl border border-border bg-card shadow-card sm:grid-cols-4 sm:divide-y-0', className)}>
      {items.map((m, i) => {
        const inner = (
          <div className="flex items-center gap-3 px-5 py-4">
            {m.ring != null && <ProgressRing value={m.ring} max={m.ringMax || 100} size={44} stroke={5} tone={m.tone || 'gold'} label={m.ringLabel} />}
            <div className="min-w-0">
              <div className="text-2xs font-semibold uppercase tracking-wide text-faint">{m.label}</div>
              <div className="mt-0.5 font-data text-xl font-semibold tracking-tight text-foreground">{m.value}</div>
              {m.sub && <div className="truncate text-2xs text-faint">{m.sub}</div>}
            </div>
          </div>
        );
        return m.to ? <Link key={i} to={m.to} className="transition hover:bg-muted/40">{inner}</Link> : <div key={i}>{inner}</div>;
      })}
    </div>
  );
}

// --- KPI spark card (value + delta pill + optional REAL sparkline) ----------
// Promoted from the Phase-0 proof; inline hex swapped for app theme tokens so it follows any
// re-skin. HONESTY: the sparkline renders ONLY when `spark` is a real ≥2-point series (the
// server omits single-point/absent series — see /analytics weeklyActivity). With no series the
// card ships value + delta only; with no delta the pill is dropped too. Never pads a fake trend.
const SPARK_TONE = { cobalt: 'hsl(var(--chart-1))', good: 'hsl(var(--chart-3))', steel: 'hsl(var(--chart-2))' };
export function KpiSparkCard({ label, value, delta = null, up = true, spark = null, tone = 'cobalt', to }) {
  const series = Array.isArray(spark) && spark.length >= 2 ? spark.map((v, i) => ({ i, v })) : null;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  const stroke = SPARK_TONE[tone] || SPARK_TONE.cobalt;
  const inner = (
    <div className={cn('flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-card transition', to && 'hover:border-gold/40 hover:shadow-card-hover')}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-faint">{label}</span>
        {delta != null && (
          <span className={cn('inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-2xs font-semibold', up ? 'bg-success-soft text-success' : 'bg-accent-soft text-primary')}>
            <Arrow className="h-3 w-3" />{delta}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="font-data text-[1.625rem] font-bold leading-none tracking-tight text-foreground">{value}</span>
        {series && (
          <div style={{ width: 84, height: 30 }} aria-hidden>
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
                <Line type="monotone" dataKey="v" stroke={stroke} strokeWidth={1.75} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block h-full">{inner}</Link> : inner;
}

// --- Command tile (a single strong status-band tile) ------------------------
export function CommandTile({ icon: Icon, label, value, sub, to, tone = 'ink', accent = false }) {
  const inner = (
    <div className={cn('flex h-full items-center gap-3 rounded-xl border px-5 py-4 shadow-card transition', accent ? 'border-gold/40 bg-gradient-to-br from-gold-soft to-card' : 'border-border bg-card', to && 'hover:shadow-card-hover hover:border-gold/40')}>
      {Icon && <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', accent ? 'bg-gold/15 text-gold' : 'bg-accent-soft text-primary')}><Icon className="h-5 w-5" /></span>}
      <div className="min-w-0">
        <div className="text-2xs font-semibold uppercase tracking-wide text-faint">{label}</div>
        <div className="mt-0.5 truncate font-data text-lg font-semibold text-foreground">{value}</div>
        {sub && <div className="truncate text-2xs text-faint">{sub}</div>}
      </div>
      {to && <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-faint" />}
    </div>
  );
  return to ? <Link to={to} className="block h-full">{inner}</Link> : inner;
}

// --- Action command bar -----------------------------------------------------
export function ActionCommandBar({ actions = [] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a, i) => (
        <Link key={i} to={a.to} className={cn('group inline-flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-semibold shadow-card transition hover:shadow-card-hover',
          a.primary ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90' : 'border-border bg-card text-foreground hover:border-gold/40')}>
          {a.icon && <a.icon className={cn('h-4 w-4', a.primary ? '' : 'text-gold')} />}{a.label}
        </Link>
      ))}
    </div>
  );
}

// --- Service silo panel (a rail of silos with status ribbons) ---------------
export function ServiceSiloPanel({ silos = [] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      {silos.map((s, i) => {
        const inner = (
          <div className={cn('flex items-center gap-3 px-4 py-3.5 transition hover:bg-muted/40', i > 0 && 'border-t border-border-soft')}>
            {s.icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-gold"><s.icon className="h-4 w-4" /></span>}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="text-sm font-semibold text-foreground">{s.title}</span>{s.fee && <span className="text-2xs text-faint">· {s.fee}</span>}</div>
              <div className="truncate text-2xs text-soft">{s.summary}</div>
            </div>
            {s.status && <StatusRibbon tone={s.tone}>{s.status}</StatusRibbon>}
            <ArrowRight className="h-4 w-4 shrink-0 text-faint" />
          </div>
        );
        return s.to ? <Link key={i} to={s.to} className="block">{inner}</Link> : <div key={i}>{inner}</div>;
      })}
    </div>
  );
}

// --- Goal progress panel (ring grid) ----------------------------------------
export function GoalProgressPanel({ rings = [], title = 'Goal progress', footer }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 text-2xs font-semibold uppercase tracking-[0.14em] text-gold">{title}</div>
      <div className="grid grid-cols-2 gap-4">
        {rings.map((r, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <ProgressRing value={r.value} max={r.max || 100} tone={r.tone || 'gold'} size={78} label={r.label} sublabel={r.sublabel} />
            <span className="text-2xs font-medium text-soft">{r.name}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-4 border-t border-border-soft pt-3 text-2xs text-faint">{footer}</div>}
    </div>
  );
}

// --- Segment bar (horizontal stacked proportional bar) ----------------------
// Renders segments = [{ label, value, tone, hint? }] as one stacked bar with a
// legend. Honest empty state when every value is 0 (never a fake full bar).
const SEG_FILL = {
  gold: 'bg-gold', teal: 'bg-primary', success: 'bg-success',
  warning: 'bg-warning', danger: 'bg-danger', neutral: 'bg-faint', accent: 'bg-primary',
};
const SEG_DOT = SEG_FILL;
export function SegmentBar({ segments = [], emptyLabel = 'No data yet.', legend = true, formatValue }) {
  const items = segments.filter((s) => s && Number(s.value) > 0);
  const total = items.reduce((sum, s) => sum + Number(s.value || 0), 0);
  const fmt = formatValue || ((n) => n);
  if (total <= 0) {
    return <div className="flex h-2.5 items-center justify-center rounded-full border border-dashed border-border-soft text-2xs text-faint" style={{ minHeight: '0.625rem' }} title={emptyLabel} />;
  }
  return (
    <div className="space-y-2.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={segments.map((s) => `${s.label}: ${fmt(s.value)}`).join(', ')}>
        {items.map((s, i) => (
          <div key={i} className={cn('h-full first:rounded-l-full last:rounded-r-full', SEG_FILL[s.tone] || SEG_FILL.neutral)} style={{ width: `${(Number(s.value) / total) * 100}%` }} title={`${s.label}: ${fmt(s.value)}`} />
        ))}
      </div>
      {legend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {segments.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-2xs text-soft">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', SEG_DOT[s.tone] || SEG_DOT.neutral)} />
              <span className="font-medium text-foreground">{fmt(s.value)}</span>
              <span className="text-faint">{s.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Mini bar (a single inline proportional fill, for table rows) -----------
// value/max → a thin fill; honest empty rail when value is 0. Used for per-row
// approval ratios. No text — pair it with the numbers already in the row.
export function MiniBar({ value = 0, max = 0, tone = 'success', width = 64 }) {
  const has = Number(max) > 0;
  const pct = has ? Math.max(0, Math.min(1, Number(value) / Number(max))) : 0;
  return (
    <span className="inline-flex items-center" style={{ width }} title={has ? `${value} / ${max}` : 'no data'}>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {has && pct > 0 && <span className={cn('block h-full rounded-full', SEG_FILL[tone] || SEG_FILL.success)} style={{ width: `${pct * 100}%` }} />}
      </span>
    </span>
  );
}

// --- Next-action checklist --------------------------------------------------
export function NextActionList({ actions = [], emptyLabel = 'You’re all caught up.' }) {
  if (!actions.length) {
    return <div className="flex items-center gap-2 rounded-xl border border-success/25 bg-success-soft px-4 py-3.5 text-sm font-medium text-success"><CheckCircle2 className="h-4 w-4" /> {emptyLabel}</div>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      {actions.map((a, i) => (
        <Link key={i} to={a.to} className={cn('group flex items-center gap-3 px-4 py-3 transition hover:bg-muted/40', i > 0 && 'border-t border-border-soft')}>
          {a.icon && <a.icon className="h-4 w-4 shrink-0 text-gold" />}
          <span className="flex-1 text-sm text-foreground">{a.text}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">{a.cta} <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
        </Link>
      ))}
    </div>
  );
}

// --- Document preview panel (mini-dossier card) -----------------------------
export function DocumentPreviewPanel({ eyebrow = 'Vitalis Research', title, refId, meta = [], status, statusTone = 'success', to, action = 'Open dossier' }) {
  const inner = (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card transition hover:shadow-card-hover">
      <div className="border-b border-border-soft bg-gradient-to-br from-panel to-card px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-[var(--vd-serif,'Cormorant_Garamond',Georgia,serif)] text-base font-semibold tracking-tight text-foreground">{eyebrow}</div>
            <div className="mt-0.5 text-sm font-semibold text-foreground">{title}</div>
          </div>
          {status && <StatusRibbon tone={statusTone}>{status}</StatusRibbon>}
        </div>
        {refId && <div className="mt-1 text-2xs font-semibold uppercase tracking-wide text-gold">Ref {refId}</div>}
      </div>
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-2xs text-faint">{meta.map((m, i) => <span key={i}><span className="font-medium text-soft">{m.label}:</span> {m.value}</span>)}</div>
        {to && <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">{action} <ArrowRight className="h-3.5 w-3.5" /></span>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

// --- Timeline rail (horizontal phases / steps) ------------------------------
export function TimelineRail({ steps = [] }) {
  if (!steps.length) return null;
  return (
    <div className="flex items-stretch gap-0 overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-card scrollbar-thin">
      {steps.map((s, i) => (
        <div key={i} className="relative flex min-w-[7.5rem] flex-1 flex-col items-center px-3 py-3 text-center">
          {i > 0 && <span className="absolute left-0 top-[1.35rem] h-px w-1/2 -translate-x-1/2 bg-border-soft" aria-hidden />}
          {i < steps.length - 1 && <span className="absolute right-0 top-[1.35rem] h-px w-1/2 translate-x-1/2 bg-border-soft" aria-hidden />}
          <span className={cn('relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 text-2xs font-semibold',
            s.state === 'done' ? 'border-success bg-success text-white' : s.state === 'active' ? 'border-gold bg-gold text-white' : 'border-border bg-card text-faint')}>{i + 1}</span>
          <span className="mt-1.5 text-2xs font-semibold text-foreground">{s.label}</span>
          {s.sub && <span className="text-2xs text-faint">{s.sub}</span>}
        </div>
      ))}
    </div>
  );
}
