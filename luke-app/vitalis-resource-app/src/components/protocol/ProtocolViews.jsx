import {
  ScrollText, ShieldCheck, BadgeCheck, FlaskConical, Stethoscope, MessageSquareText,
  History, ClipboardCheck, CalendarClock,
  FileText, Eye, TestTubes, Activity, CheckCircle2, PauseCircle, RefreshCw,
  ArrowRight, ArrowDownRight, ArrowUpRight,
} from 'lucide-react';
import { fmtDate, cn } from '../../lib/utils.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card.jsx';
import { Badge } from '../ui/Badge.jsx';
import { StatusChip } from '../ui/StatusChip.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../ui/Table.jsx';
import { EmptyState } from '../ui/States.jsx';
import { ProtocolItems } from './ProtocolDocumentView.jsx';

/**
 * ProtocolViews — the shared, presentational "approved protocol" components.
 *
 * Both the CLIENT portal (PortalProtocols) and the PRACTITIONER client-detail page
 * render the same approved-protocol objects, so the cards live here ONCE. Every object
 * passed in is the client-safe projection (clientProtocolProjection) — these components
 * never see a draft, never see practitioner internals, and never frame a protocol as a
 * prescription. Keeping them in one module means the client and practitioner views can
 * never visually drift apart.
 */

export const LEVEL_TONE = { HIGH: 'success', MODERATE: 'accent', LOW: 'warning', EMERGING: 'warning', PRECLINICAL: 'warning', UNKNOWN: 'neutral' };

// Lifecycle → restrained tone + plain-language label. COMPLETED is intentionally
// neutral (not a "pass" green) — a finished resource isn't a clinical verdict.
export const LIFECYCLE = {
  ACTIVE: { tone: 'success', label: 'Active' },
  PENDING: { tone: 'warning', label: 'Pending start' },
  PAUSED: { tone: 'warning', label: 'Paused' },
  COMPLETED: { tone: 'neutral', label: 'Completed' },
};

// Timeline event kind → icon + fallback label. The server only ever emits these
// eight client-safe kinds (projectTimelineEvent coerces anything else to CHANGED).
export const TIMELINE_META = {
  GENERATED: { icon: FileText, label: 'Protocol resource generated' },
  REVIEWED: { icon: ShieldCheck, label: 'Reviewed and approved by your practitioner' },
  CLIENT_VIEWED: { icon: Eye, label: 'You opened this protocol' },
  LABS_UPLOADED: { icon: TestTubes, label: 'Labs uploaded' },
  CHECK_IN: { icon: Activity, label: 'Progress check-in' },
  COMPLETED: { icon: CheckCircle2, label: 'Protocol completed' },
  PAUSED: { icon: PauseCircle, label: 'Protocol paused' },
  CHANGED: { icon: RefreshCw, label: 'Protocol changed' },
};

function ApprovedBanner({ text, compact }) {
  return (
    <div className={cn(
      'flex items-center gap-2 rounded-md border border-success/25 bg-success-soft font-semibold text-success',
      compact ? 'px-3 py-1.5 text-2xs' : 'px-3 py-2 text-xs',
    )}>
      <BadgeCheck className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> {text}
    </div>
  );
}

// A labelled display cell. `accent` gives a single restrained tint — used for the
// "next check-in" so the one actionable date stands out without decoration.
function InfoCell({ label, value, mono, accent }) {
  return (
    <div className={cn(
      'rounded-md border px-3 py-2',
      accent ? 'border-primary/20 bg-accent-soft' : 'border-border-soft',
    )}>
      <div className="text-2xs font-semibold uppercase tracking-wide text-faint">{label}</div>
      <div className={cn('mt-0.5 text-xs text-foreground', mono && 'font-data')}>{value || '—'}</div>
    </div>
  );
}

// Practitioner-authored note the client is allowed to see.
function PractitionerNote({ note }) {
  if (!note) return null;
  return (
    <div className="rounded-md border border-primary/15 bg-accent-soft px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-primary">
        <Stethoscope className="h-3.5 w-3.5" /> Practitioner note
      </div>
      <p className="text-xs leading-relaxed text-soft">{note}</p>
    </div>
  );
}

// The client's own reflection on a protocol. Visually distinct from the practitioner
// note (neutral, not accent) so authorship is never ambiguous.
function ClientNote({ note }) {
  if (!note) return null;
  return (
    <div className="rounded-md border border-border-soft bg-neutral-soft px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
        <MessageSquareText className="h-3.5 w-3.5" /> Client note
      </div>
      <p className="text-xs leading-relaxed text-soft">{note}</p>
    </div>
  );
}

function ItemsTable({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent"><TH>Item</TH><TH>Route</TH><TH>Form</TH><TH>Evidence</TH></TR>
      </THead>
      <TBody>
        {items.map((it, i) => (
          <TR key={i} className="hover:bg-transparent">
            <TD className="font-medium text-foreground">{it.productName}</TD>
            <TD className="text-xs">{it.route || '—'}</TD>
            <TD className="text-xs">{it.form || '—'}</TD>
            <TD>{it.evidenceLevel === 'UNKNOWN' ? <span className="text-2xs text-faint">Evidence: unrated</span> : it.evidenceLevel ? <StatusChip tone={LEVEL_TONE[it.evidenceLevel] || 'neutral'} label={it.evidenceLevel} /> : <span className="text-2xs text-faint">—</span>}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

// Factual measured change. Direction arrow is deliberately MUTED (text-faint) — we
// never colour a from→to as good/bad; that would imply a clinical judgement.
function ChangeRow({ label, from, to, unit, direction }) {
  const Arrow = direction === 'down' ? ArrowDownRight : direction === 'up' ? ArrowUpRight : ArrowRight;
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border-soft px-3 py-2">
      <span className="text-xs text-soft">{label}</span>
      <span className="flex items-center gap-1.5 font-data text-xs text-foreground">
        <span className="text-faint">{from}{unit}</span>
        <Arrow className="h-3.5 w-3.5 text-faint" />
        <span>{to}{unit}</span>
      </span>
    </div>
  );
}

function MonitoringBlock({ monitoring, labsSuggested }) {
  if (!monitoring && (!labsSuggested || labsSuggested.length === 0)) return null;
  return (
    <div className="space-y-2">
      {monitoring && (
        <div>
          <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Monitoring / lab schedule</div>
          <p className="text-xs text-soft">{monitoring}</p>
        </div>
      )}
      {labsSuggested && labsSuggested.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-faint"><FlaskConical className="h-3.5 w-3.5" /> Labs suggested</span>
          {labsSuggested.map((l) => <Badge key={l} tone="neutral" className="font-data">{l}</Badge>)}
        </div>
      )}
    </div>
  );
}

export function CurrentProtocolCard({ p }) {
  const lc = LIFECYCLE[p.lifecycle] || LIFECYCLE.ACTIVE;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5"><ScrollText className="h-4 w-4 text-primary" /> {p.title}</CardTitle>
          <StatusChip tone={lc.tone} label={lc.label} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ApprovedBanner text={p.banner} />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoCell label="Goal" value={p.goal} />
          <InfoCell label="Current phase" value={p.phase?.label} />
          <InfoCell label="Started" value={fmtDate(p.startDate)} mono />
          <InfoCell label="Next lab / check-in" value={p.nextCheckIn ? fmtDate(p.nextCheckIn) : null} mono accent={!!p.nextCheckIn} />
        </div>

        <div>
          <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Selected resources</div>
          <ProtocolItems items={p.items} mode="client" />
        </div>

        <MonitoringBlock monitoring={p.monitoring} labsSuggested={p.labsSuggested} />

        <PractitionerNote note={p.practitionerNote} />

        {(p.adherence || p.progressSummary) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {p.adherence && (
              <div className="rounded-md border border-border-soft px-3 py-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-faint">Adherence</span>
                  {p.adherence.pct != null && <span className="font-data text-lg font-semibold text-primary">{p.adherence.pct}%</span>}
                </div>
                {p.adherence.summary && <p className="mt-1 text-xs text-soft">{p.adherence.summary}</p>}
              </div>
            )}
            {p.progressSummary && (
              <div className="rounded-md border border-border-soft px-3 py-2.5">
                <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Progress summary</div>
                <p className="mt-1 text-xs text-soft">{p.progressSummary}</p>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft pt-3 text-2xs text-faint">
          <span>Approved by {p.approvedBy || 'your practitioner'} · {fmtDate(p.approvedAt)}</span>
        </div>
        {p.disclaimer && <p className="text-2xs leading-relaxed text-faint">{p.disclaimer}</p>}
      </CardContent>
    </Card>
  );
}

export function PastProtocolCard({ p }) {
  const adherencePct = p.outcome?.adherencePct ?? p.adherence?.pct ?? null;
  const labChanges = p.outcome?.labChanges || [];
  const bodyComp = p.outcome?.bodyComp || [];
  const hasChanges = labChanges.length > 0 || bodyComp.length > 0;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5"><History className="h-4 w-4 text-primary" /> {p.title}</CardTitle>
          <StatusChip tone="neutral" label="Completed" />
        </div>
        <CardDescription className="flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" /> {fmtDate(p.startDate)} – {fmtDate(p.endDate)}{p.goal ? ` · ${p.goal}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ApprovedBanner text={p.banner} compact />

        {p.outcome?.summary && (
          <div>
            <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Outcome summary</div>
            <p className="text-xs leading-relaxed text-soft">{p.outcome.summary}</p>
          </div>
        )}

        {adherencePct != null && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-soft">
            <ClipboardCheck className="h-3.5 w-3.5 text-faint" />
            <span>Adherence <span className="font-data font-semibold text-foreground">{adherencePct}%</span></span>
            {p.adherence?.summary && <span className="text-faint">· {p.adherence.summary}</span>}
          </div>
        )}

        {hasChanges && (
          <div>
            <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">Relevant lab / body-composition changes</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {labChanges.map((c, i) => <ChangeRow key={`l${i}`} label={c.marker} from={c.from} to={c.to} unit={c.unit} direction={c.direction} />)}
              {bodyComp.map((c, i) => <ChangeRow key={`b${i}`} label={c.label} from={c.from} to={c.to} unit={c.unit} direction={c.direction} />)}
            </div>
            <p className="mt-1.5 text-2xs text-faint">Factual measured changes recorded during the cycle — shown for reference, not as a clinical judgement.</p>
          </div>
        )}

        <div>
          <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Resources used</div>
          <ProtocolItems items={p.items} mode="client" />
        </div>

        <ClientNote note={p.clientNote} />
        <PractitionerNote note={p.practitionerNote} />

        {p.informedNext && (
          <div className="flex items-start gap-2 rounded-md border border-border-soft bg-neutral-soft px-3 py-2 text-xs text-soft">
            <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
            <span>Informed your next protocol{p.informedNext.note ? ` — ${p.informedNext.note}` : ''}</span>
          </div>
        )}

        {p.disclaimer && <p className="text-2xs leading-relaxed text-faint">{p.disclaimer}</p>}
      </CardContent>
    </Card>
  );
}

export function ProtocolTimeline({ events }) {
  if (!events || events.length === 0) {
    return <EmptyState title="No timeline yet" hint="Timeline events appear as your protocols are generated, approved, viewed and checked in." icon={CalendarClock} />;
  }
  return (
    <ol className="space-y-0">
      {events.map((ev, i) => {
        const meta = TIMELINE_META[ev.kind] || TIMELINE_META.CHANGED;
        const Icon = meta.icon;
        const isLast = i === events.length - 1;
        return (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-soft">
                <Icon className="h-3.5 w-3.5" />
              </span>
              {!isLast && <span className="w-px flex-1 bg-border-soft" />}
            </div>
            <div className="pb-5">
              <div className="text-xs font-medium text-foreground">{ev.label || meta.label}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-faint">
                <span className="font-data">{fmtDate(ev.at)}</span>
                {ev.protocolTitle && <><span aria-hidden>·</span><span>{ev.protocolTitle}</span></>}
                {ev.by && <><span aria-hidden>·</span><span>{ev.by}</span></>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
