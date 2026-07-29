import { cn } from '../../lib/utils.js';

/**
 * StatusChip — the always-visible gate signal. Maps a gate status string to a
 * restrained semantic tone + dot. Honest by design: UNKNOWN / RESERVED never
 * masquerade as a pass.
 */
const MAP = {
  // pass / live
  pass: 'success', ok: 'success', live: 'success', verified: 'success', normal: 'success',
  active: 'success', sourced: 'success', clear: 'success',
  // approved / client-visible resource (the only state a client may see)
  approved: 'success', approved_resource: 'success',
  // caution / needs attention
  flag: 'warning', flagged: 'warning', caution: 'warning', review: 'warning',
  needs_source: 'warning', pending: 'warning', draft: 'warning', stub: 'warning',
  // add-on / meal + supplement plan lifecycle states
  pending_labs: 'warning', estimated: 'warning', no_compliant_option: 'warning',
  recorded: 'neutral', provided: 'success', none: 'neutral',
  // evidence tiers (supplement plan)
  established: 'success', supportive: 'accent', emerging: 'warning',
  // review lifecycle (practitioner-only states)
  in_review: 'warning', reviewed: 'accent', changes_requested: 'warning',
  // block / fail / abnormal
  block: 'danger', blocked: 'danger', fail: 'danger', failed: 'danger',
  abnormal: 'danger', out_of_range: 'danger', error: 'danger',
  // unknown / reserved / neutral
  unknown: 'neutral', reserved: 'neutral', planned: 'neutral', na: 'neutral', off: 'neutral',
};

const DOT = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-faint',
  accent: 'bg-primary',
};

const BG = {
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/20',
  neutral: 'bg-neutral-soft text-soft border-border-soft',
  accent: 'bg-accent-soft text-primary border-primary/20',
};

export function statusTone(status) {
  if (!status) return 'neutral';
  return MAP[String(status).toLowerCase().replace(/[\s-]+/g, '_')] || 'neutral';
}

export function StatusChip({ status, label, tone: toneProp, className, dashed = false }) {
  const tone = toneProp || statusTone(status);
  const text = label != null ? label : String(status || 'UNKNOWN').replace(/_/g, ' ');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium uppercase tracking-wide leading-none',
        BG[tone],
        dashed && 'border-dashed',
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', DOT[tone])} />
      {text}
    </span>
  );
}
