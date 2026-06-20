import {
  Stethoscope, Apple, Syringe, Printer, ShieldCheck, ClipboardList, Lock, X,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card.jsx';
import { Button } from '../ui/Button.jsx';
import { Badge } from '../ui/Badge.jsx';
import { StatusChip } from '../ui/StatusChip.jsx';
import { BasisBlock } from '../protocol/BasisBlock.jsx';

/**
 * SlipView — the canonical "Naturopath Request Slip" renderer. ONE component, used by the
 * standalone Nutrition page AND the Client Package nutrition facet, so the two surfaces can
 * never drift apart (consolidation, not duplication).
 *
 * Role shaping is already baked in by the SERVER (analyzeLabForNutrients): the CLIENT payload
 * omits the citation list + naturopathic pattern. We render purely by key-presence — never
 * reconstructing what was withheld. Every slip is DRAFT / resource-only: out-of-range is framed
 * as "discuss," electrolytes route to provider review with no supplement suggested, and every
 * nutrient is attributed. Not a prescription, not a diagnosis.
 *
 *   embedded=false (default) → full Card with Print + optional Close chrome (Nutrition page).
 *   embedded=true            → bare content, no Card/print/close (nested in a Package facet).
 */

const FLAG_TONE = { IN_RANGE: 'success', OUT_OF_RANGE_LOW: 'danger', OUT_OF_RANGE_HIGH: 'danger', NO_RANGE: 'neutral' };
const SIGNAL_LABEL = { LOW: 'Below range', HIGH: 'Above range' };
const fmtRange = (lo, hi) => `${lo ?? '–'}–${hi ?? '–'}`;

// ── One nutrient recommendation (the "discuss with your naturopath" card) ─────────────────
function RecommendationCard({ rec }) {
  return (
    <li className="rounded-md border border-border-soft p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{rec.nutrient}</div>
          <div className="font-data text-2xs text-faint">
            from <span className="text-soft">{rec.marker}</span>
            {(rec.alsoFromMarkers || []).length > 0 && <span> &amp; {rec.alsoFromMarkers.join(', ')}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <StatusChip tone={FLAG_TONE[rec.flag] || 'neutral'} label={SIGNAL_LABEL[rec.signal] || String(rec.flag).replace(/_/g, ' ')} />
          <span className="font-data text-2xs text-faint">
            {rec.value}{rec.unit ? ` ${rec.unit}` : ''} <span className="text-faint/70">({fmtRange(rec.refLow, rec.refHigh)})</span>
          </span>
        </div>
      </div>

      {rec.suggestedForm && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-2xs text-soft">
          <Apple className="h-3.5 w-3.5 text-faint" />
          <span className="text-faint">Form often discussed:</span> {rec.suggestedForm}
        </p>
      )}

      {(rec.foodFirst || []).length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-2xs font-semibold uppercase tracking-wide text-faint">Food-first</span>
          {rec.foodFirst.map((f) => <Badge key={f} tone="neutral">{f}</Badge>)}
        </div>
      )}

      <BasisBlock basis={rec.basis} />

      {rec.ask && (
        <p className="mt-2 rounded-md border border-primary/15 bg-accent-soft px-3 py-2 text-xs leading-relaxed text-soft">
          <span className="font-medium text-primary">Ask: </span>{rec.ask}
        </p>
      )}

      {(rec.peptideContext || []).length > 0 && (
        <div className="mt-2 space-y-1 rounded-md border border-border-soft bg-muted/40 px-3 py-2">
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
            <Syringe className="h-3.5 w-3.5" /> Also relevant to your peptide monitoring
          </div>
          {rec.peptideContext.map((p, i) => (
            <p key={i} className="text-2xs text-soft">
              {(p.compounds || []).join(' · ')} <span className="text-faint">— monitor {p.cadence}</span>
              {p.relevantToProducts && <Badge tone="accent" className="ml-1.5">on your protocol</Badge>}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}

// ── A provider-review-only item (electrolyte / unmapped out-of-range — never a supplement) ──
function ProviderReviewCard({ item }) {
  return (
    <li className="rounded-md border border-warning/25 bg-warning-soft/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">{item.nutrient || item.marker}</div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <StatusChip tone={FLAG_TONE[item.flag] || 'warning'} label={String(item.flag).replace(/_/g, ' ')} />
          <span className="font-data text-2xs text-faint">
            {item.value}{item.unit ? ` ${item.unit}` : ''} <span className="text-faint/70">({fmtRange(item.refLow, item.refHigh)})</span>
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-soft">{item.reason}</p>
      {item.ask && (
        <p className="mt-2 rounded-md border border-border-soft bg-card px-3 py-2 text-xs leading-relaxed text-soft">
          <span className="font-medium text-warning">Ask: </span>{item.ask}
        </p>
      )}
      <p className="mt-1.5 inline-flex items-center gap-1.5 text-2xs font-medium text-warning">
        <Lock className="h-3.5 w-3.5" /> No supplement suggested — {item.action}
      </p>
    </li>
  );
}

// ── The slip body (shared between the standalone Card and the embedded facet) ───────────────
function SlipBody({ slip }) {
  const s = slip.summary || {};
  const recs = slip.recommendations || [];
  const review = slip.providerReview || [];
  return (
    <div className="space-y-4">
      {/* Banner — DRAFT / resource-only, never a prescription or diagnosis */}
      <div className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning-soft px-3 py-2 text-xs font-semibold uppercase tracking-wide text-warning">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> {slip.banner}
      </div>

      {/* Summary stat strip */}
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusChip tone="neutral" label={`${s.reviewed ?? 0} reviewed`} />
        <StatusChip tone="success" label={`${s.inRange ?? 0} in range`} />
        <StatusChip tone="warning" label={`${s.flagged ?? 0} flagged`} />
        <StatusChip tone="accent" label={`${s.nutrientSuggestions ?? 0} to discuss`} />
        {(s.providerOnly ?? 0) > 0 && <StatusChip tone="danger" label={`${s.providerOnly} provider-only`} />}
      </div>

      {slip.intro && <p className="text-xs leading-relaxed text-soft">{slip.intro}</p>}

      {/* Nutrient suggestions */}
      {recs.length > 0 ? (
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
            <ClipboardList className="h-3.5 w-3.5" /> To discuss &amp; ask Dr. Vincent Lun about
          </div>
          <ul className="space-y-2">
            {recs.map((rec, i) => <RecommendationCard key={(rec.nutrient || '') + i} rec={rec} />)}
          </ul>
        </div>
      ) : (
        <div className="rounded-md border border-success/20 bg-success-soft px-3 py-2 text-xs text-success">
          No below-range nutrient markers to flag. Anything out of range is routed to provider review below.
        </div>
      )}

      {/* Provider-review-only items */}
      {review.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
            <Stethoscope className="h-3.5 w-3.5" /> Provider review — not for self-supplementation
          </div>
          <ul className="space-y-2">
            {review.map((item, i) => <ProviderReviewCard key={(item.marker || '') + i} item={item} />)}
          </ul>
        </div>
      )}

      {/* Referral — Dr. Vincent Lun */}
      {slip.referral?.provider && (
        <div className="rounded-md border border-primary/15 bg-accent-soft px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-primary">
            <Stethoscope className="h-3.5 w-3.5" /> Bring this to
          </div>
          <p className="mt-1 text-sm font-semibold text-foreground">{slip.referral.provider.name}</p>
          <p className="text-2xs text-soft">{slip.referral.provider.role}</p>
          {slip.referral.provider.contact && <p className="font-data text-2xs text-faint">{slip.referral.provider.contact}</p>}
          <p className="mt-1.5 text-2xs italic text-faint">{slip.referral.disclaimer}</p>
        </div>
      )}

      {slip.aggregatorNote && <p className="text-2xs leading-relaxed text-faint">{slip.aggregatorNote}</p>}

      {(slip.disclaimers || []).length > 0 && (
        <div className="border-t border-border-soft pt-2">
          {slip.disclaimers.map((d, i) => <p key={i} className="text-2xs leading-relaxed text-faint">{d}</p>)}
        </div>
      )}
    </div>
  );
}

export function SlipView({ slip, onClose, embedded = false }) {
  if (!slip) return null;
  if (embedded) {
    return <SlipBody slip={slip} />;
  }
  return (
    <Card className="print-slip">
      <CardHeader className="border-b border-border-soft">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>{slip.title}</CardTitle>
            {slip.forClient && <CardDescription>Prepared from the lab values for {slip.forClient}.</CardDescription>}
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="no-print" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Print slip
            </Button>
            {onClose && (
              <Button size="icon" variant="ghost" className="no-print" aria-label="Dismiss" onClick={onClose}>
                <X className="h-4 w-4 text-faint" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <SlipBody slip={slip} />
      </CardContent>
    </Card>
  );
}

export default SlipView;
