import { cn } from '../../lib/utils.js';
import {
  DocCover, DocSection, DocStatBand, DocCardGrid, DocCompoundCard, DocClinicalTable,
  DocPanel, DocDef, EvidenceBadge, DocCallout, DocNumberedList, DocDisclaimer,
  DocSignalGrid, DocSignal,
} from './VitalisDocumentShell.jsx';

/**
 * DocumentParts — the named dossier components the build calls for, composed from the vdoc
 * primitives so every vertical reads as one branded system. Presentational only; they render
 * the adapter's already-gated data (toPeptideDocProps etc.). No clinical logic, no fabrication.
 */

// Re-export the shell primitives under the requested document-vocabulary names.
export { DocCover as DocumentCover, DocSection as DocumentSection, DocClinicalTable as ClinicalTable } from './VitalisDocumentShell.jsx';

// --- Evidence status chip (Research Source Doctrine) ------------------------
const STATUS_STYLE = {
  SOURCE_FOUND: { bg: '#e9efe6', fg: '#41633a', label: 'Source found' },
  REVIEWED: { bg: '#dfeadb', fg: '#33502d', label: 'Reviewed' },
  SOURCE_PENDING: { bg: '#f6ecd9', fg: '#8a6a38', label: 'Source pending' },
  UNKNOWN: { bg: '#eceae6', fg: '#8d847b', label: 'Unknown' },
  PRACTITIONER_INTERPRETATION: { bg: '#e3e9ea', fg: '#4a5b62', label: 'Practitioner interpretation' },
  PRECLINICAL_ONLY: { bg: '#f3ece9', fg: '#9a6b5e', label: 'Preclinical only' },
};
export function EvidenceStatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.UNKNOWN;
  return (
    <span style={{
      display: 'inline-block', padding: '1px 8px', borderRadius: 3, fontSize: 9.5, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.08em', background: s.bg, color: s.fg,
    }}>{s.label}</span>
  );
}

// --- Evidence tier legend (T1–T4) ------------------------------------------
export function EvidenceTierLegend({ legend = [] }) {
  if (!legend.length) return null;
  return (
    <DocCallout title="Evidence tiering used throughout.">
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 4 }}>
        {legend.map((t) => (
          <span key={t.tier} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
            <EvidenceBadge tier={t.tier} /> <span style={{ fontSize: 11.5 }}>{t.label}</span>
          </span>
        ))}
      </span>
    </DocCallout>
  );
}

// --- Citation list (PRIMARY journal cited; index shown only as "via") -------
export function CitationList({ citations = [] }) {
  if (!citations.length) {
    return <span className="vd-em" style={{ color: 'var(--vd-muted)' }}>No sourced citations yet — evidence pending.</span>;
  }
  return (
    <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
      {citations.map((c, i) => (
        <li key={i} style={{ marginTop: 6, display: 'flex', gap: 7, alignItems: 'baseline' }}>
          <EvidenceBadge tier={c.tier} />
          <span style={{ fontSize: 11.5, lineHeight: 1.45 }}>
            {c.url ? <a href={c.url} target="_blank" rel="noreferrer" style={{ color: 'var(--vd-ink)', textDecoration: 'underline' }}>{c.title}</a> : c.title}
            {c.source && <span className="vd-em" style={{ color: 'var(--vd-muted)' }}> — {c.source}</span>}
            {c.via && <span style={{ color: 'var(--vd-faint)', fontSize: 10 }}> · via {c.via}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// --- Dosing source/confidence chip (Phase-2 honest provenance) -------------
const SOURCE_LABEL = {
  STUDY_REPORTED: 'Study-reported',
  COMMUNITY_REFERENCE: 'Community reference',
  PRACTITIONER_REVIEW: 'Practitioner review',
  NEEDS_SOURCE: 'Needs source',
};
function DosingSourceChip({ sourceType, confidence }) {
  if (!sourceType) return <span className="vd-table__muted">—</span>;
  const gap = sourceType === 'NEEDS_SOURCE';
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, fontSize: 10.5, lineHeight: 1.3 }}>
      <span style={{ fontWeight: 600, color: gap ? '#a8432a' : 'var(--vd-ink)' }}>{SOURCE_LABEL[sourceType] || sourceType}</span>
      {confidence && <span style={{ color: 'var(--vd-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{String(confidence).replace(/_/g, ' ')}</span>}
    </span>
  );
}

// --- Selection status (SELECTED / NEEDS_PRACTITIONER_SELECTION / NEEDS_SOURCE) ----
const SELECTION = {
  SELECTED: { label: 'Selected schedule', fg: '#2f6b4f', bg: '#e7f1ea' },
  NEEDS_PRACTITIONER_SELECTION: { label: 'Needs practitioner selection', fg: '#8a6d1f', bg: '#f5ecd6' },
  NEEDS_SOURCE: { label: 'Needs source', fg: '#a8432a', bg: '#f6e3dd' },
};
function SelectionChip({ status }) {
  const s = SELECTION[status] || SELECTION.NEEDS_PRACTITIONER_SELECTION;
  return <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: s.fg, background: s.bg, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>{s.label}</span>;
}
const BASIS_LABEL = { STUDY_REPORTED: 'Study-reported', COMMUNITY_REFERENCE: 'Community reference', PRACTITIONER_REVIEW: 'Practitioner review', NEEDS_PRACTITIONER_SELECTION: 'Needs practitioner selection', NEEDS_SOURCE: 'Needs source' };
const basisText = (d) => (BASIS_LABEL[d.sourceBasis || d.sourceType] || d.sourceBasis || d.sourceType || '—') + (d.confidence ? ` · ${String(d.confidence).replace(/_/g, ' ')} confidence` : '');

// --- Section 02: the SELECTED protocol schedule — the OLD Vitalis TIME-PHASED grid ----------
// BLOCK (week-range + phase) | <compound> | … | PHASE MILESTONE. Rows = the protocol's week/phase
// bands; cells = that band's EXACT dose for that compound (off-state where its cycle has ended). The
// band timeline is the UNION of the curated `scheduleGrid`s the canonical engine surfaces — a pure
// reshape, no synthesis, no invented weeks. A compound with NO curated grid renders in a separate
// NAMED-PHASE table, explicitly marked as named phases (never fabricated week bands).
const statusOf = (d) => d.selectionStatus || (d.noDoseAmount ? 'NEEDS_PRACTITIONER_SELECTION' : 'SELECTED');
const cleanName = (n) => String(n || '').split(' — ')[0].split(/\s\d/)[0].trim() || String(n || '').trim();
const compactTiming = (value) => {
  const t = String(value || '').trim();
  if (!t) return '';
  if (/friday/i.test(t)) return 'Friday AM';
  if (/tuesday/i.test(t)) return 'Tuesday AM';
  if (/nightly|before sleep|pre-sleep/i.test(t)) return 'Nightly';
  if (/evening/i.test(t)) return 'Daily evening';
  if (/daily/i.test(t)) return 'Daily';
  if (/weekly/i.test(t)) return 'Weekly';
  return t.split(/[.;,]/)[0].trim();
};

// A dose string is an "off / cycle-ended" state when the engine marks it 'off' (or omits it).
const isOffDose = (dose) => !dose || /^off$/i.test(String(dose).trim());

// Build one shared band timeline across the gridded compounds.
//  • boundaries = sorted unique week-starts from every band of every grid (segment edges)
//  • for each segment [start, nextStart): each compound emits the band covering `start` (else off)
//  • phase + milestone come from the ANCHOR — the first gridded compound active (non-off) in the segment
function buildBandTimeline(gridded) {
  const bandStart = (b) => (b.weeks && b.weeks[0]) || 1;
  const bandEnd = (b) => ((b.weeks && b.weeks[1]) != null ? b.weeks[1] : bandStart(b));
  // Segment edges = every distinct band start. (A band start is also where some prior band ends.)
  const bounds = new Set();
  let maxEnd = 1;
  gridded.forEach((c) => (c.grid || []).forEach((b) => { bounds.add(bandStart(b)); maxEnd = Math.max(maxEnd, bandEnd(b)); }));
  const starts = [...bounds].sort((a, b) => a - b);
  const bandCovering = (grid, wk) => (grid || []).slice().reverse().find((b) => wk >= bandStart(b) && wk <= bandEnd(b)) || null;

  // Each compound's last covered week — to tell "cycle finished" (— cycle done —) from "not yet / gap" (—).
  const lastWk = gridded.map((c) => Math.max(...(c.grid || []).map(bandEnd)));

  return starts.map((wk, idx) => {
    const bands = gridded.map((c) => bandCovering(c.grid, wk));
    // Per-compound display cell: state on|off|done|pre + the dose/delivery (for 'on').
    const cells = bands.map((b, i) => {
      if (b && !isOffDose(b.dose)) return { state: 'on', dose: b.dose, delivery: b.delivery };
      if (b) return { state: 'off' };                       // a band exists but its dose is 'off'
      if (wk > lastWk[i]) return { state: 'done' };          // past the compound's last band
      return { state: 'pre' };                               // before the compound's first band
    });
    // Segment span: from this start up to (the next start − 1), or the furthest band end for the tail.
    const nextStart = starts[idx + 1];
    const isTail = nextStart == null;
    const segEnd = isTail ? maxEnd : nextStart - 1;
    // Anchor: the first compound supplying a real (non-off) band in this segment → drives phase + milestone.
    // Fall back to any covering band (an off/tail band still carries a useful authored block label).
    const anchorIdx = bands.findIndex((b) => b && !isOffDose(b.dose) && (b.block || b.phase));
    const anchorCell = anchorIdx >= 0 ? bands[anchorIdx] : bands.find(Boolean);
    // BLOCK label: use the anchor's authored string ONLY when its band exactly equals this segment span
    // (keeps a clean single-grid protocol showing the exact authored "Wk 1–4"); else synthesize the span.
    const anchorStartsHere = anchorCell && bandStart(anchorCell) === wk;
    const anchorExact = anchorStartsHere && anchorCell.block && bandEnd(anchorCell) === segEnd;
    // The tail segment is open-ended only when the covering tail band is itself open (authored "Wk N+").
    const openTail = isTail && anchorCell && /\+/.test(String(anchorCell.block || ''));
    const block = anchorExact
      ? anchorCell.block
      : (openTail ? `Wk ${wk}+` : (segEnd > wk ? `Wk ${wk}–${segEnd}` : `Wk ${wk}`));
    return {
      week: wk,
      block,
      phase: (anchorCell && anchorCell.phase) || null,
      // Show the milestone only on the segment where the anchor band BEGINS — no duplicate text on a split row.
      milestone: (anchorStartsHere && anchorCell && anchorCell.milestone) || null,
      cells,
    };
  });
}

// Column header shared by both tables: compact old-protocol style (compound + timing).
// Exact amounts live in the schedule cells, not in a giant header block.
function ScheduleColHead({ c }) {
  const d = c.dosing || {};
  const timing = compactTiming(d.selectedTiming || d.timing || d.schedule || d.selectedFrequency || d.frequency);
  return (
    <th className="vd-sched__chead">
      <div className="vd-sched__cname">{cleanName(c.name)}</div>
      {d.isBlend && <div className="vd-sched__blendtag">co-lyophilized blend</div>}
      {timing && <div className="vd-sched__freq">{timing}</div>}
    </th>
  );
}

// TABLE A — the time-phased week/phase grid (old Vitalis standard).
function WeekBandGrid({ gridded }) {
  const rows = buildBandTimeline(gridded);
  if (!rows.length) return null;
  return (
    <div className="vd-sched-wrap">
      <table className="vd-sched vd-sched--weekly">
        <thead>
          <tr>
            <th className="vd-sched__phasehead">Block</th>
            {gridded.map((c, i) => <ScheduleColHead key={i} c={c.compound} />)}
            <th className="vd-sched__milestonehead">Phase milestone</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              <td className="vd-sched__phase">
                <span className="vd-sched__wkblock">{row.block}</span>
                {row.phase && <span className="vd-sched__phaselabel">{row.phase}</span>}
              </td>
              {row.cells.map((cell, ci) => {
                if (cell.state !== 'on') {
                  const txt = cell.state === 'done' || cell.state === 'off' ? '— cycle done —' : '—';
                  return <td key={ci} className="vd-sched__cell vd-sched__cell--off">{txt}</td>;
                }
                return (
                  <td key={ci} className="vd-sched__cell vd-sched__cell--on">
                    <span className="vd-sched__dosecell">{cell.dose}</span>
                    {cell.delivery && <span className="vd-sched__delivery">{cell.delivery}</span>}
                  </td>
                );
              })}
              <td className="vd-sched__milestone">{row.milestone || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Named lifecycle phases — the honest fallback for compounds WITHOUT a curated week-band grid.
const PHASE_ROWS = [
  { key: 'onboarding', label: 'Onboarding / acclimation' },
  { key: 'maintenance', label: 'Maintenance / build' },
  { key: 'offboarding', label: 'Offboarding / reassess' },
  { key: 'cycle', label: 'Cycle / review' },
  { key: 'monitoring', label: 'Monitoring' },
];
function phaseCellValue(d, key) {
  if (key === 'onboarding') {
    return d.onboarding
      ? (<span>{d.onboarding}{d.ceiling ? <em style={{ display: 'block', color: 'var(--vd-muted)', fontSize: 10.5, marginTop: 2 }}>Ceiling: {d.ceiling}</em> : null}</span>)
      : '—';
  }
  if (key === 'maintenance') return d.maintenance || '—';
  if (key === 'offboarding') return d.offboarding || d.taper || 'Stop / reassess with practitioner';
  if (key === 'cycle') return d.cycleLength || (d.cycleWeeks ? `${d.cycleWeeks} wks` : 'Reassess after labs');
  if (key === 'monitoring') return d.monitoring || '—';
  return '—';
}

// TABLE B — named-phase grid (no curated week bands; explicitly labeled as named phases).
function NamedPhaseGrid({ named }) {
  if (!named.length) return null;
  return (
    <div style={{ marginTop: named.length ? 14 : 0 }}>
      <p className="vd-footnote vd-sched__namedcaption">
        Named lifecycle phases (no week-by-week band curated for {named.length === 1 ? 'this compound' : 'these compounds'}) —
        run alongside the schedule above; the practitioner sets the calendar placement.
      </p>
      <div className="vd-sched-wrap">
        <table className="vd-sched">
          <thead>
            <tr>
              <th className="vd-sched__phasehead">Phase</th>
              {named.map((c, i) => <ScheduleColHead key={i} c={c.compound} />)}
            </tr>
          </thead>
          <tbody>
            {PHASE_ROWS.map((row) => (
              <tr key={row.key}>
                <td className="vd-sched__phase"><span className="vd-sched__phaselabel">{row.label}</span></td>
                {named.map((c, i) => {
                  const d = c.compound.dosing || {};
                  if (statusOf(d) !== 'SELECTED') {
                    return (
                      <td key={i} className="vd-sched__cell vd-sched__cell--gap">
                        {row.key === 'onboarding'
                          ? (statusOf(d) === 'NEEDS_SOURCE' ? 'No verified dosing source loaded.' : 'Practitioner selects the schedule.')
                          : '—'}
                      </td>
                    );
                  }
                  return <td key={i} className="vd-sched__cell">{phaseCellValue(d, row.key)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SelectedScheduleTable({ compounds = [] }) {
  const list = compounds || [];
  if (!list.length) return null;
  // Split by whether the canonical engine gave us a curated week-band grid for this compound.
  const gridded = [];
  const named = [];
  list.forEach((c) => {
    const grid = c.dosing && c.dosing.scheduleGrid;
    if (Array.isArray(grid) && grid.length) gridded.push({ compound: c, grid });
    else named.push({ compound: c });
  });

  return (
    <div>
      {gridded.length > 0 ? <WeekBandGrid gridded={gridded} /> : null}
      {named.length > 0 ? <NamedPhaseGrid named={named} /> : null}
      <p className="vd-footnote" style={{ marginTop: 8 }}>
        Reviewed and adjusted by the practitioner / client before use. Broader reference ranges + evidence tiers are in Section 03.
      </p>
    </div>
  );
}
// keep the prior import name working
export const DosingScheduleTable = SelectedScheduleTable;

// --- Monitoring panel -------------------------------------------------------
export function MonitoringPanel({ monitoring }) {
  if (!monitoring) return null;
  const {
    text,
    framing,
    responsePatterns = [],
    tiers = {},
    checkpoints = [],
    labs = [],
    warnings = [],
    unknowns = [],
    safetyMarkers = [],
    adaptationSignals = [],
  } = monitoring;
  const expected = tiers.expected || [];
  const drift = tiers.meaningfulDrift || [];
  const stopNow = tiers.stopNow || [];
  return (
    <div>
      {framing && <p className="vd-p vd-p--lead">{framing}</p>}
      {text && <p className="vd-p vd-p--lead">{text}</p>}
      {responsePatterns.length > 0 && (
        <DocPanel name="Three distinct response patterns">
          {responsePatterns.map((row, i) => (
            <DocDef key={`${row.label || 'pattern'}-${i}`} label={row.label}>{row.body}</DocDef>
          ))}
        </DocPanel>
      )}
      {labs.length > 0 && (
        <p className="vd-p" style={{ fontSize: 12.5 }}>
          <span className="vd-strong">Bloodwork / lab checkpoints — </span>
          {labs.join(' · ')}
        </p>
      )}
      {safetyMarkers.length > 0 && (
        <p className="vd-p" style={{ fontSize: 12.5 }}><span className="vd-strong">Monitoring markers — </span>{safetyMarkers.join(' · ')}</p>
      )}
      {(expected.length > 0 || drift.length > 0 || stopNow.length > 0) && (
        <>
          <h3 className="vd-subhead" style={{ marginTop: 20 }}>Adaptation signals by tier</h3>
          <DocSignalGrid>
            {expected.map((signal, i) => (
              <DocSignal key={`expected-${i}`} tier="observe" eyebrow="Expected adaptation · observe" title={signal.title}>
                {signal.body}
              </DocSignal>
            ))}
            {drift.map((signal, i) => (
              <DocSignal key={`drift-${i}`} tier="drift" eyebrow="Meaningful drift · check in" title={signal.title}>
                {signal.body}
              </DocSignal>
            ))}
            {stopNow.map((signal, i) => (
              <DocSignal key={`stop-${i}`} tier="stop" eyebrow="Stop now · physician same day" title={signal.title}>
                {signal.body}
              </DocSignal>
            ))}
          </DocSignalGrid>
        </>
      )}
      {warnings.length > 0 && <DocCallout tone="coral" title="Watch for:">{warnings.join(' · ')}</DocCallout>}
      {unknowns.length > 0 && <DocCallout title="Honest gaps (UNKNOWN):">{unknowns.join(' · ')}</DocCallout>}
      {adaptationSignals.length > 0 && <DocCallout title="Practitioner-authored adaptation notes:">{adaptationSignals.join(' · ')}</DocCallout>}
      {checkpoints.length > 0 && (
        <>
          <h3 className="vd-subhead" style={{ marginTop: 22 }}>Re-evaluation checkpoints</h3>
          <ul className="vd-checkpoints">
            {checkpoints.map((point, i) => (
              <li key={`${point.label || 'checkpoint'}-${i}`}>
                <span className="vd-strong">{point.label}</span> — {point.body}
              </li>
            ))}
          </ul>
        </>
      )}
      {adaptationSignals.length === 0 && expected.length === 0 && drift.length === 0 && stopNow.length === 0 && (
        <p className="vd-footnote">Adaptation-signal tiers (expected / meaningful drift / stop-now) are practitioner-authored — not yet added to this protocol.</p>
      )}
    </div>
  );
}

// --- Practitioner / physician review block ---------------------------------
export function PractitionerReviewBlock({ provider, note }) {
  return (
    <DocCallout title="Physician / practitioner review.">
      This document is intended for review and authorization by{' '}
      <span className="vd-strong">{(provider && provider.name) || 'a licensed medical professional'}</span>
      {provider && provider.contact ? ` · ${provider.contact}` : ''}. Baseline bloodwork is recommended before initiation.
      {note ? <span style={{ display: 'block', marginTop: 8 }}><span className="vd-strong">Practitioner note — </span>{note}</span> : null}
    </DocCallout>
  );
}

// --- Footer (disclaimer + honest evidence status) --------------------------
export function DocumentFooter({ disclaimer, evidenceStatus }) {
  return (
    <>
      {evidenceStatus && (
        <p className="vd-footnote" style={{ marginTop: 22 }}>
          Document evidence status: <EvidenceStatusBadge status={evidenceStatus} />. Claims are not presented stronger than the cited source allows.
        </p>
      )}
      <DocDisclaimer title="Strictly for research and educational purposes.">{disclaimer}</DocDisclaimer>
    </>
  );
}

export { DocCardGrid, DocCompoundCard, DocStatBand, DocPanel, DocDef, DocCallout, DocNumberedList };
