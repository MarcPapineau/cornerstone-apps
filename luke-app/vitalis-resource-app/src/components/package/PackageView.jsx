import {
  Package, ScrollText, TestTubes, Salad, Stethoscope, ShieldCheck, BadgeCheck,
  FileText, FlaskConical, Hourglass, Info, Beaker, ClipboardList,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card.jsx';
import { Badge } from '../ui/Badge.jsx';
import { StatusChip } from '../ui/StatusChip.jsx';
import { EmptyState } from '../ui/States.jsx';
import { LEVEL_TONE } from '../protocol/ProtocolViews.jsx';
import { DoseBlock } from '../protocol/DoseBlock.jsx';
import { SlipView } from '../nutrition/SlipView.jsx';

/**
 * PackageView — the read-only, presentational renderer for a Client Package (the one-click
 * bundle: Protocol · Bloodwork · Nutrition). ONE component, shared by the practitioner page
 * (which wraps it with generate / save / approve controls) and the client portal (read-only),
 * so the two surfaces can never drift apart.
 *
 * It renders ONLY what the server composed (composeClientPackage). Role shaping is already
 * baked in server-side — for a CLIENT the protocol facet has titration/taper/schedule + the
 * clinical rationale stripped — so we render purely by key-presence and never reconstruct what
 * was withheld. Reuses the canonical DoseBlock + SlipView so dosing and the naturopath slip
 * look identical to the standalone surfaces. Nothing here mints clinical content.
 */

const FACET_META = {
  protocol: { icon: ScrollText, label: 'Protocol' },
  bloodwork: { icon: TestTubes, label: 'Bloodwork' },
  nutrition: { icon: Salad, label: 'Nutrition' },
};

// ── Package header: banner + identity + "what's inside" strip ───────────────────────────────
function PackageHeader({ pkg }) {
  const approved = pkg.clientVisible;
  const bannerTone = approved
    ? 'border-success/25 bg-success-soft text-success'
    : 'border-warning/25 bg-warning-soft text-warning';
  const order = pkg.facetOrder || ['protocol', 'bloodwork', 'nutrition'];
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4.5 w-4.5 text-primary" /> {pkg.title || 'Client care package'}
            </CardTitle>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-faint">
              {pkg.forClient && <span>For <span className="font-medium text-soft">{pkg.forClient}</span></span>}
              {pkg.goal && <><span aria-hidden>·</span><span>Goal: {pkg.goal}</span></>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge tone="neutral" className="uppercase tracking-wide">{pkg.role || 'PRACTITIONER'}</Badge>
            <StatusChip status={pkg.status} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-wide ${bannerTone}`}>
          {approved ? <BadgeCheck className="h-4 w-4 shrink-0" /> : <FileText className="h-4 w-4 shrink-0" />} {pkg.banner}
        </div>
        {pkg.intro && <p className="text-2xs leading-relaxed text-faint">{pkg.intro}</p>}

        {/* "What's inside" — three facets at a glance (operator cognition) */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {order.map((key) => {
            const meta = FACET_META[key] || { icon: Info, label: key };
            const facet = pkg.facets?.[key];
            const Icon = meta.icon;
            return (
              <div key={key} className="flex items-center justify-between gap-2 rounded-md border border-border-soft px-3 py-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-soft">
                  <Icon className="h-3.5 w-3.5 text-faint" /> {meta.label}
                </span>
                {facet && <StatusChip status={facet.status} />}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── A faint section sub-heading used inside facet cards ─────────────────────────────────────
function SubHead({ icon: Icon, children, right }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
        {Icon && <Icon className="h-3.5 w-3.5" />} {children}
      </div>
      {right}
    </div>
  );
}

// ── Facet 1: PROTOCOL ───────────────────────────────────────────────────────────────────────
function ProtocolFacet({ facet }) {
  if (!facet) return null;
  const items = facet.items || [];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5"><ScrollText className="h-4 w-4 text-primary" /> Protocol</CardTitle>
          <StatusChip status={facet.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {facet.goal && <p className="text-2xs text-faint">Goal: <span className="text-soft">{facet.goal}</span></p>}

        {items.length === 0 ? (
          <EmptyState title="No items in this protocol" hint="The protocol spine has no catalog items." icon={ScrollText} />
        ) : (
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={(it.productName || '') + i} className="rounded-md border border-border-soft p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{it.productName}</div>
                    <div className="font-data text-2xs text-faint">
                      {it.route || <span className="text-danger">UNKNOWN route</span>} · {it.form || 'UNKNOWN form'}
                    </div>
                  </div>
                  {it.evidenceLevel === 'UNKNOWN'
                    ? <span className="text-2xs text-faint">Evidence: unrated</span>
                    : it.evidenceLevel
                      ? <StatusChip tone={LEVEL_TONE[it.evidenceLevel] || 'neutral'} label={it.evidenceLevel} />
                      : <span className="text-2xs text-faint">evidence —</span>}
                </div>
                <DoseBlock dosing={it.dosing} />
              </li>
            ))}
          </ul>
        )}

        {facet.monitoring && (
          <div>
            <SubHead icon={FlaskConical}>Monitoring / lab schedule</SubHead>
            <p className="mt-1 text-xs leading-relaxed text-soft">{facet.monitoring}</p>
          </div>
        )}

        {/* Operator-only: the clinical rationale is stripped server-side for the client. */}
        {facet.rationale && (
          <div className="rounded-md border border-border-soft bg-muted/40 px-3 py-2">
            <SubHead icon={Info}>Clinical rationale — practitioner only</SubHead>
            <p className="mt-1 text-xs leading-relaxed text-soft">{facet.rationale}</p>
          </div>
        )}

        {facet.practitionerNote && (
          <div className="rounded-md border border-primary/15 bg-accent-soft px-3 py-2.5">
            <SubHead icon={Stethoscope}>Practitioner note</SubHead>
            <p className="mt-1 text-xs leading-relaxed text-soft">{facet.practitionerNote}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Facet 2: BLOODWORK ──────────────────────────────────────────────────────────────────────
function BloodworkFacet({ facet }) {
  if (!facet) return null;
  const baseline = facet.baseline || {};
  const safety = facet.safetyMonitoring || {};
  const suggested = facet.suggested || [];
  const provider = facet.provider || {};
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5"><TestTubes className="h-4 w-4 text-primary" /> Bloodwork to order</CardTitle>
          <StatusChip tone="accent" label="To order" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {facet.requisitionNote && (
          <p className="rounded-md border border-primary/15 bg-accent-soft px-3 py-2 text-xs leading-relaxed text-soft">
            {facet.requisitionNote}
          </p>
        )}

        {/* Baseline — Dr. Lun's enumerated panel */}
        <div className="space-y-2">
          <SubHead icon={Beaker} right={<StatusChip status={baseline.status} />}>
            Baseline panel
          </SubHead>
          <p className="text-2xs text-faint">
            {baseline.label}
            {baseline.markerCount != null && <> · <span className="font-data text-soft">{baseline.markerCount} markers</span></>}
            {baseline.fasting && <> · <Badge tone="neutral">fasting</Badge></>}
          </p>
          <div className="space-y-1.5">
            {(baseline.sections || []).map((sec, i) => (
              <div key={(sec.section || '') + i} className="rounded-md border border-border-soft px-3 py-2">
                <div className="text-2xs font-semibold uppercase tracking-wide text-faint">{sec.section}</div>
                <div className="mt-0.5 font-data text-2xs leading-relaxed text-soft">{(sec.markers || []).join(' · ')}</div>
              </div>
            ))}
          </div>
          {baseline.source && <p className="text-2xs italic text-faint">Source: {baseline.source}</p>}
        </div>

        {/* Product-driven safety monitoring — sourced from PEPTIDE_ADDITIONS, never invented */}
        <div className="space-y-2 border-t border-border-soft pt-3">
          <SubHead icon={ShieldCheck} right={<StatusChip status={safety.status} />}>
            Safety monitoring (compound-specific)
          </SubHead>
          {safety.status === 'SOURCED' ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {(safety.markers || []).map((m) => <Badge key={m} tone="neutral" className="font-data">{m}</Badge>)}
              </div>
              <div className="space-y-1">
                {(safety.detail || []).map((d, i) => (
                  <p key={i} className="text-2xs text-soft">
                    <span className="font-data text-faint">{d.matchedOn}</span> → {(d.markers || []).join(' · ')}
                    <span className="text-faint"> — {d.cadence}</span>
                  </p>
                ))}
              </div>
              {(safety.basedOn || []).length > 0 && (
                <p className="text-2xs text-faint">Driven by: {safety.basedOn.join(' · ')}</p>
              )}
            </>
          ) : (
            <p className="text-2xs text-faint">
              No monitored compounds in this package — nothing is added beyond the baseline panel. Shown honestly, not padded.
            </p>
          )}
        </div>

        {/* Whatever the protocol itself already flagged */}
        {suggested.length > 0 && (
          <div className="space-y-1.5 border-t border-border-soft pt-3">
            <SubHead icon={ClipboardList}>Also flagged by the protocol</SubHead>
            <div className="flex flex-wrap items-center gap-1.5">
              {suggested.map((l) => <Badge key={l} tone="neutral" className="font-data">{l}</Badge>)}
            </div>
          </div>
        )}

        {/* Bring it to Dr. Vincent Lun */}
        {provider.name && (
          <div className="rounded-md border border-primary/15 bg-accent-soft px-3 py-2.5">
            <SubHead icon={Stethoscope}>Bring this request to</SubHead>
            <p className="mt-1 text-sm font-semibold text-foreground">{provider.name}</p>
            {provider.role && <p className="text-2xs text-soft">{provider.role}</p>}
            {provider.contact && <p className="font-data text-2xs text-faint">{provider.contact}</p>}
          </div>
        )}

        {facet.disclaimer && <p className="text-2xs leading-relaxed text-faint">{facet.disclaimer}</p>}
      </CardContent>
    </Card>
  );
}

// ── Facet 3: NUTRITION ──────────────────────────────────────────────────────────────────────
function NutritionFacet({ facet }) {
  if (!facet) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5"><Salad className="h-4 w-4 text-primary" /> Nutrition</CardTitle>
          <StatusChip status={facet.status} />
        </div>
      </CardHeader>
      <CardContent>
        {facet.slip ? (
          <SlipView slip={facet.slip} embedded />
        ) : (
          // Honest PENDING_LABS — nutrition guidance is lab-driven; we never fabricate it.
          <div className="space-y-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-soft">
              <Hourglass className="h-4 w-4 text-faint" /> {facet.title || 'Nutrition — pending lab results'}
            </div>
            {facet.reason && <p className="text-2xs leading-relaxed text-faint">{facet.reason}</p>}
            {facet.unlocksWith && (
              <p className="text-2xs text-faint">
                <span className="font-semibold uppercase tracking-wide">Unlocks with: </span>{facet.unlocksWith}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PackageView({ pkg }) {
  if (!pkg) return null;
  const f = pkg.facets || {};
  return (
    <div className="space-y-4">
      <PackageHeader pkg={pkg} />
      <ProtocolFacet facet={f.protocol} />
      <BloodworkFacet facet={f.bloodwork} />
      <NutritionFacet facet={f.nutrition} />
      {(pkg.disclaimers || []).length > 0 && (
        <div className="space-y-1 px-1">
          {pkg.disclaimers.map((d, i) => <p key={i} className="text-2xs leading-relaxed text-faint">{d}</p>)}
        </div>
      )}
    </div>
  );
}

export default PackageView;
