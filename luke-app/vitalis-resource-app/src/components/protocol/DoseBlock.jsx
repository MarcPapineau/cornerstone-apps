import { ScrollText } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';

/**
 * DoseBlock — the attribution-framed, role-shaped dosing view. ONE canonical presentation,
 * shared by the chat generator (ProtocolChat) and the Client Package protocol facet so the
 * two surfaces can never visually drift apart.
 *
 * Role shaping is decided by the SERVER, not here: the CLIENT payload has titration / taper /
 * schedule stripped, so their absence is the signal for the softened (literature-range) view.
 * We NEVER reconstruct a schedule the server withheld — we render purely by key-presence.
 */
export function DoseBlock({ dosing }) {
  if (!dosing) return null;
  const isUnknown = dosing.status === 'UNKNOWN';
  const operatorView = 'titration' in dosing || 'taper' in dosing || 'schedule' in dosing;
  return (
    <div className="mt-2 rounded-md border border-border-soft bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
        <ScrollText className="h-3.5 w-3.5" /> Dosing — research-reported
        {isUnknown && <Badge tone="neutral">UNKNOWN</Badge>}
      </div>
      <p className="mt-1 font-data text-xs leading-relaxed text-soft">{dosing.label}</p>
      {operatorView && dosing.titration && (
        <p className="mt-1.5 text-2xs text-soft"><span className="text-faint">Titration: </span>{dosing.titration}</p>
      )}
      {operatorView && dosing.taper && (
        <p className="mt-1 rounded border border-warning/25 bg-warning-soft px-2 py-1 text-2xs text-warning"><span className="font-semibold uppercase tracking-wide">Taper: </span>{dosing.taper}</p>
      )}
      {operatorView && dosing.schedule && (
        <p className="mt-1 text-2xs text-soft"><span className="text-faint">Schedule: </span>{dosing.schedule}</p>
      )}
      {(dosing.cautions || []).length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-2xs text-soft">
          {dosing.cautions.map((c, i) => <li key={i}>· {c}</li>)}
        </ul>
      )}
      {operatorView && dosing.basis && <p className="mt-1.5 text-2xs text-faint">Basis: {dosing.basis}</p>}
    </div>
  );
}

export default DoseBlock;
