import { Pill, UtensilsCrossed, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '../ui/Card.jsx';
import { StatusChip } from '../ui/StatusChip.jsx';

/**
 * AddOnView — the ONE shared, presentational renderer for a paid add-on (supplement / meal
 * plan). The practitioner's review preview AND the client's approved view both render through
 * this component, so the two can never drift. Pure presentational: it renders ONLY the keys
 * the server returns — operator-only context (rationale, compatibilityNotes) is simply absent
 * from a client projection, so this component shows it by key-presence and never reconstructs
 * a withheld field. Mints no clinical content. Not a prescription.
 */
const TYPE_META = {
  SUPPLEMENT_PLAN: { label: 'Supplement plan', icon: Pill },
  MEAL_PLAN: { label: 'Meal / diet plan', icon: UtensilsCrossed },
};

export function AddOnView({ addon }) {
  if (!addon) return null;
  const meta = TYPE_META[addon.addOnType] || { label: 'Add-on', icon: Pill };
  const Icon = meta.icon;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-md bg-accent-soft text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-foreground">{addon.title}</div>
                <div className="text-2xs uppercase tracking-wide text-faint">
                  {meta.label}{addon.tier ? ` · ${addon.tier}` : ''}
                </div>
              </div>
            </div>
            <StatusChip status={addon.status} />
          </div>
          {addon.banner && <p className="mt-3 text-xs text-soft">{addon.banner}</p>}
        </CardContent>
      </Card>

      {(addon.sections || []).map((s) => (
        <Card key={s.key}>
          <CardContent className="py-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">{s.title}</div>
              <StatusChip status={s.status} />
            </div>
            {s.items && s.items.length > 0 ? (
              <ul className="space-y-1.5">
                {s.items.map((it, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-soft">
                    {it.nutrient && <span className="font-medium text-foreground">{it.nutrient}</span>}
                    {it.marker && <span className="font-medium text-foreground">{it.marker}</span>}
                    {it.field && <span className="font-medium text-foreground">{it.field}:</span>}
                    {it.value != null && it.value !== '' && <span>{it.value}</span>}
                    {it.ask && <span className="text-soft">— {it.ask}</span>}
                    {it.tier && <StatusChip status={it.tier} className="ml-0.5" />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-faint">{s.note || 'Nothing to show yet.'}</p>
            )}
            {s.items && s.items.length > 0 && s.note && <p className="mt-2 text-2xs text-faint">{s.note}</p>}
          </CardContent>
        </Card>
      ))}

      {/* Operator-only context — rendered by KEY-PRESENCE (absent on a client projection). */}
      {addon.compatibilityNotes && (
        <Card>
          <CardContent className="flex items-start gap-2 py-3 text-xs text-soft">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span><span className="font-medium text-foreground">Protocol compatibility:</span> {addon.compatibilityNotes}</span>
          </CardContent>
        </Card>
      )}
      {addon.disclaimer && <p className="text-2xs leading-relaxed text-faint">{addon.disclaimer}</p>}
    </div>
  );
}

export default AddOnView;
