import {
  ScrollText, BadgeCheck, FileText, FlaskConical, Stethoscope, ShieldAlert, AlertTriangle, HelpCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Badge } from '../ui/Badge.jsx';
import { StatusChip } from '../ui/StatusChip.jsx';

/**
 * ProtocolDocumentView — the ONE premium "Vitalis protocol document" renderer, used for both
 * the practitioner/operator view (full dosing, titration, taper, timing, rationale, flags) and
 * the client approved-resource view (practitioner-reviewed dosing/schedule, no internal rationale
 * or gate notes). It renders what the server provided, by KEY-PRESENCE + `mode`, so the operator
 * and client views can never drift and a client can never be handed an operator-only field.
 *
 *   mode='operator' — pass a raw draft. Shows everything the practitioner may see.
 *   mode='client'   — pass a clientProtocolProjection. Internal fields are absent server-side AND
 *                     gated here (defense-in-depth). Dosing is the practitioner-reviewed schedule.
 *
 * Educational / research resource only — never a prescription.
 */

const LEVEL_TONE = { HIGH: 'success', MODERATE: 'accent', LOW: 'warning', EMERGING: 'warning', PRECLINICAL: 'warning', UNKNOWN: 'neutral' };

function DoseCell({ label, value }) {
  if (!value) return null;
  return (
    <div className="rounded border border-border-soft bg-card px-2 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-0.5 text-2xs leading-snug text-foreground">{value}</div>
    </div>
  );
}

// The shared protocol-items renderer (premium panels with the full dosing block). Exported so
// the approved-protocol cards and the draft card both render items identically.
export function ProtocolItems({ items, mode = 'client' }) {
  const operator = mode === 'operator';
  if (!items || items.length === 0) return <p className="text-xs text-faint">No resources listed.</p>;
  return (
    <div className="space-y-2.5">
      {items.map((it, i) => {
        const d = it.dosing;
        return (
          <div key={it.productId || i} className="rounded-lg border border-border-soft bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{it.productName}</span>
                {it.route && <Badge tone="outline">{it.route}</Badge>}
                {it.form && <span className="text-2xs text-faint">{it.form}</span>}
              </div>
              {it.evidenceLevel && <StatusChip tone={LEVEL_TONE[it.evidenceLevel] || 'neutral'} label={`Evidence · ${it.evidenceLevel}`} />}
            </div>

            {d && (
              <div className="mt-2 rounded-md border border-primary/15 bg-accent-soft/50 p-2.5">
                {d.label && <div className="text-xs font-medium text-foreground">{d.label}</div>}
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  <DoseCell label="Schedule" value={d.schedule} />
                  <DoseCell label="Titration / phase" value={d.titration} />
                  <DoseCell label="Taper" value={d.taper} />
                  <DoseCell label="Timing" value={d.timing} />
                </div>
                {operator && d.basis && <p className="mt-1.5 text-2xs text-soft"><span className="font-medium text-foreground">Basis:</span> {d.basis}</p>}
                {d.note && <p className="mt-1.5 text-2xs text-faint">{d.note}</p>}
              </div>
            )}

            {operator && (it.contraindicationFlags || []).length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-2xs font-semibold uppercase tracking-wide text-danger">Contraindication flags</span>
                {it.contraindicationFlags.map((f, j) => <Badge key={j} tone="danger">{f}</Badge>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">{title}</div>
      {children}
    </div>
  );
}

function Callout({ tone, title, items, icon: Icon }) {
  const cls = { warning: 'border-warning/25 bg-warning-soft text-warning', danger: 'border-danger/20 bg-danger-soft text-danger', neutral: 'border-border-soft bg-muted/40 text-soft' }[tone];
  return (
    <div className={cn('rounded-md border p-2.5', cls)}>
      <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide">{Icon && <Icon className="h-3.5 w-3.5" />} {title}</div>
      <ul className="space-y-0.5 text-xs">{items.map((r, i) => <li key={i}>· {r}</li>)}</ul>
    </div>
  );
}

export function ProtocolDocumentView({ protocol, mode = 'client', client = null }) {
  if (!protocol) return null;
  const operator = mode === 'operator';
  const p = protocol;
  const approved = p.status === 'APPROVED_RESOURCE';
  const ctxName = (client && client.name) || p.forClient;
  const ctxGoals = (client && client.goals) || [];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-gradient-to-br from-accent-soft/70 to-card px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-primary"><ScrollText className="h-3.5 w-3.5" /> Vitalis protocol resource</div>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-foreground">{p.title || 'Protocol resource'}</h3>
            {p.goal && <p className="mt-0.5 text-xs text-soft">Goal — {p.goal}</p>}
            {ctxName && <p className="mt-1 text-2xs text-faint">For {ctxName}{ctxGoals.length ? ` · ${ctxGoals.slice(0, 3).join(', ')}` : ''}</p>}
          </div>
          <StatusChip status={p.status} />
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-wide', approved ? 'border-success/25 bg-success-soft text-success' : 'border-warning/25 bg-warning-soft text-warning')}>
          {approved ? <BadgeCheck className="h-4 w-4" /> : <FileText className="h-4 w-4" />} {p.statusBanner || p.banner || (approved ? 'APPROVED RESOURCE — reviewed by your practitioner · educational, not a prescription' : 'DRAFT — practitioner-only · not yet client-visible')}
        </div>

        <Section title="Protocol & dosing schedule"><ProtocolItems items={p.items} mode={mode} /></Section>

        {(p.monitoring || (p.labsSuggested || []).length > 0) && (
          <Section title="Monitoring & lab schedule">
            {p.monitoring && <p className="text-xs text-soft">{p.monitoring}</p>}
            {(p.labsSuggested || []).length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-faint"><FlaskConical className="h-3.5 w-3.5" /> Labs suggested</span>
                {p.labsSuggested.map((l) => <Badge key={l} tone="neutral" className="font-data">{l}</Badge>)}
              </div>
            )}
          </Section>
        )}

        {operator && p.rationale && <Section title="Rationale (resource summary)"><p className="text-xs leading-relaxed text-soft">{p.rationale}</p></Section>}
        {operator && (p.warnings || []).length > 0 && <Callout tone="warning" title="Warnings" items={p.warnings} icon={AlertTriangle} />}
        {operator && (p.unknowns || []).length > 0 && <Callout tone="neutral" title="Unknowns (honest gaps)" items={p.unknowns} icon={HelpCircle} />}
        {operator && (p.blockedReasons || []).length > 0 && <Callout tone="danger" title="Blocked reasons" items={p.blockedReasons} icon={ShieldAlert} />}

        {p.practitionerNote && (
          <div className="rounded-md border border-primary/15 bg-accent-soft px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-primary"><Stethoscope className="h-3.5 w-3.5" /> Practitioner note</div>
            <p className="text-xs leading-relaxed text-soft">{p.practitionerNote}</p>
          </div>
        )}

        <p className="border-t border-border-soft pt-3 text-2xs leading-relaxed text-faint">
          {p.disclaimer || 'Educational / research resource only — practitioner-reviewed. Not medical advice, not a diagnosis, not a prescription.'}
        </p>
      </div>
    </div>
  );
}

export default ProtocolDocumentView;
