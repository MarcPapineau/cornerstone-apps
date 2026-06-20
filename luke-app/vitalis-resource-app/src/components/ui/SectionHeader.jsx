import { cn } from '../../lib/utils.js';

/**
 * SectionHeader — editorial section heading in the Vitalis identity: gold eyebrow, charcoal title,
 * a gold hairline rule, and an optional right-aligned action slot. Gives pages real hierarchy.
 */
export function SectionHeader({ eyebrow, title, sub, actions, className }) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-gold/30 pb-2', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="text-2xs font-semibold uppercase tracking-[0.14em] text-gold">{eyebrow}</div>}
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-soft">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export default SectionHeader;
