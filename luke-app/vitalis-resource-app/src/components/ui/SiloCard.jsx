import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { StatusChip } from './StatusChip.jsx';

/**
 * SiloCard — a service/product silo tile for the client portal (Peptide / Nutrition / Supplement /
 * Meal / Lab Requests). Shows the silo icon + title, a status chip, current-state summary, an
 * optional fee label, and a link into the silo. Honest empty/scaffolded state where there is no
 * current document yet.
 */
export function SiloCard({ icon: Icon, title, to, status, statusTone = 'neutral', summary, fee, action = 'Open', empty, children, className }) {
  const body = (
    <div className={cn('flex h-full flex-col rounded-lg border border-border bg-card p-4 shadow-card transition hover:border-gold/40 hover:shadow-card-hover', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon && <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-gold"><Icon className="h-4 w-4" /></span>}
          <div className="text-sm font-semibold text-foreground">{title}</div>
        </div>
        {status && <StatusChip tone={statusTone} label={status} />}
      </div>
      <div className="mt-2 flex-1 text-xs leading-relaxed text-soft">
        {summary || (empty ? <span className="text-faint">{empty}</span> : null)}
        {children}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border-soft pt-2.5">
        {fee ? <span className="text-2xs font-medium text-faint">{fee}</span> : <span />}
        {to && <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">{action} <ArrowRight className="h-3.5 w-3.5" /></span>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

export default SiloCard;
