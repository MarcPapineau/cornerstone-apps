import { FlaskConical, Users, ExternalLink } from 'lucide-react';
import { StatusChip } from '../ui/StatusChip.jsx';

/**
 * BasisBlock — the shared two-source attribution panel: "what the studies show ⊕ what the
 * community does". Renders a `presentation.composeBasis`-shaped object (the protocol generator)
 * AND the nutrition engine's `composeNutrientBasis` output — they are intentionally the SAME
 * shape, so one component serves both surfaces (consolidation, not duplication).
 *
 * Role shaping is already baked in by the SERVER: the CLIENT payload omits the full citation
 * list and the administration / naturopathic `pattern`, so we render purely by key-presence —
 * we NEVER reconstruct what the server withheld. This is the anti-"overly cautious" layer:
 * useful, attributed, never a fabricated number.
 */

// Tones span both vocabularies: peptide tiers (TRIALS/PRECLINICAL/COMMUNITY) and
// nutrition tiers (ESTABLISHED/SUPPORTIVE/EMERGING). EMERGING reads as caution in both.
const TIER_TONE = {
  TRIALS: 'success', ESTABLISHED: 'success',
  PRECLINICAL: 'accent', SUPPORTIVE: 'accent',
  COMMUNITY: 'neutral', EMERGING: 'warning', UNKNOWN: 'neutral',
};

export function BasisBlock({ basis }) {
  if (!basis) return null;
  const { studies, community } = basis;
  if (!studies && !community) return null;
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border-soft bg-card px-3 py-2.5">
      {basis.headline && <p className="text-2xs italic leading-relaxed text-faint">{basis.headline}</p>}

      {studies && (
        <div>
          <div className="flex flex-wrap items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
            <FlaskConical className="h-3.5 w-3.5" /> What the studies show
            <StatusChip tone={TIER_TONE[basis.tier] || 'neutral'} label={basis.label} />
          </div>
          {studies.finding && <p className="mt-1 text-xs leading-relaxed text-soft">{studies.finding}</p>}
          {studies.mechanism && <p className="mt-1 text-2xs leading-relaxed text-faint">{studies.mechanism}</p>}
          <p className="mt-1 font-data text-2xs text-faint">
            {studies.citationCount} citation{studies.citationCount === 1 ? '' : 's'}
            {studies.hasClinicalTrial ? ' · human trial cited' : ''}
          </p>
          {Array.isArray(studies.citations) && studies.citations.length > 0 && (
            <details className="group mt-1">
              <summary className="cursor-pointer list-none text-2xs font-medium text-primary hover:underline">
                View {studies.citations.length} citation{studies.citations.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-1 space-y-1">
                {studies.citations.map((c, i) => (
                  <li key={i} className="text-2xs leading-relaxed text-soft">
                    {c.url
                      ? <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-primary hover:underline">
                          <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" /><span>{c.title}</span>
                        </a>
                      : <span>{c.title}</span>}
                    {c.source && <span className="text-faint"> — {c.source}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {community && (
        <div className={studies ? 'border-t border-border-soft pt-2' : ''}>
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
            <Users className="h-3.5 w-3.5" /> What the community does
          </div>
          {(community.usedFor || []).length > 0 && (
            <p className="mt-1 text-2xs text-soft"><span className="text-faint">Used for: </span>{community.usedFor.join(' · ')}</p>
          )}
          {(community.reportedBenefits || []).length > 0 && (
            <>
              <ul className="mt-1 space-y-0.5 text-xs text-soft">
                {community.reportedBenefits.map((b, i) => <li key={i} className="flex gap-1.5"><span className="text-faint">·</span>{b}</li>)}
              </ul>
              {community.benefitsLabel && <p className="mt-1 text-2xs italic text-faint">{community.benefitsLabel}</p>}
            </>
          )}
          {community.evidenceNote && <p className="mt-1 text-2xs text-faint">{community.evidenceNote}</p>}
          {community.pattern && (
            <p className="mt-1.5 rounded border border-border-soft bg-muted/40 px-2 py-1 text-2xs text-soft">
              <span className="font-semibold uppercase tracking-wide text-faint">Community pattern: </span>{community.pattern}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default BasisBlock;
