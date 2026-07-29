import {
  VitalisDocumentShell, DocStatusBanner, DocCover, DocSection, DocStatBand,
  DocCardGrid, DocCompoundCard, DocPanel, DocDef, DocCallout, DocNumberedList,
} from './VitalisDocumentShell.jsx';
import {
  EvidenceTierLegend, SelectedScheduleTable, MonitoringPanel, PractitionerReviewBlock,
  DocumentFooter, EvidenceStatusBadge, CitationList,
} from './DocumentParts.jsx';

/**
 * PeptideProtocolDocument — the flagship Vitalis dossier for the Peptide vertical.
 *
 * Renders the server-built adapter props (toPeptideDocProps) into the canonical PDF section
 * spine (Cover → Stack & Why → Schedule → Compound Reference → Supportive Lifestyle →
 * Physiological Monitoring → contraindications → review → footer). It renders ONLY what the
 * adapter provides — practitioner-authored sections that are absent are omitted, never faked.
 *
 *   props.doc — the object returned by GET /api/documents/peptide/:id (operator or client).
 */

// Gold-italic emphasis on the trailing phrase (after " — " / " & "), mirroring the PDF titles.
function Title({ text }) {
  if (!text) return 'Peptide Protocol';
  const m = text.match(/^(.*?)(\s[—–-]\s|\s&\s)(.+)$/);
  if (!m) return text;
  return <>{m[1]}{m[2]}<em>{m[3]}</em></>;
}

function cardDoseLine(c) {
  const d = c && c.dosing;
  if (!d) return null;
  return d.selectedDose || d.doseAmountLine || d.label || null;
}

function TimingRationales({ items = [] }) {
  if (!items.length) return null;
  return (
    <div className="vd-callout-stack">
      {items.map((item, i) => (
        <DocCallout key={`${item.label || 'timing'}-${i}`}>
          <span className="vd-strong">
            Why {item.selectedTiming || item.selectedFrequency || item.label}.
          </span>{' '}
          {item.rationale}
        </DocCallout>
      ))}
    </div>
  );
}

function SupplySummary({ summary }) {
  if (!summary || (!summary.rows?.length && !summary.emptyState)) return null;
  return (
    <div className="vd-supply">
      <h3 className="vd-subhead">{summary.title || 'Supply Summary'}</h3>
      {summary.framing && <p className="vd-p">{summary.framing}</p>}
      {summary.rows?.length > 0 ? (
        <div className="vd-supply__rows">
          {summary.rows.map((row, i) => (
            <div className="vd-supply__row" key={`${row.label || 'supply'}-${i}`}>
              <div>
                <div className="vd-strong">{row.label}</div>
                <div className="vd-footnote" style={{ marginTop: 2 }}>
                  {[row.route, row.form].filter(Boolean).join(' · ') || 'Format reviewed by practitioner'}
                </div>
              </div>
              <div>
                {row.selectedSchedule && <div>{row.selectedSchedule}</div>}
                {row.supply && <div>{row.supply}</div>}
                {row.notes && <div className="vd-footnote" style={{ marginTop: 2 }}>{row.notes}</div>}
              </div>
            </div>
          ))}
        </div>
      ) : <p className="vd-footnote">{summary.emptyState}</p>}
    </div>
  );
}

function SupportiveLifestyleSection({ lifestyle }) {
  if (!lifestyle) return null;
  const items = Array.isArray(lifestyle) ? lifestyle : lifestyle.items;
  if (!items || items.length === 0) return null;
  return (
    <DocSection
      runhead="SECTION 04 · SUPPORTIVE LIFESTYLE"
      eyebrow="Section 04"
      title={<>Supportive <em>Lifestyle</em></>}
      intro={Array.isArray(lifestyle) ? null : lifestyle.framing}
    >
      <DocNumberedList items={items} />
      {!Array.isArray(lifestyle) && lifestyle.weeklyTracking?.length > 0 && (
        <DocCallout title="What to track weekly:">
          {lifestyle.weeklyTracking.join(' · ')}
        </DocCallout>
      )}
    </DocSection>
  );
}

export default function PeptideProtocolDocument({ doc }) {
  if (!doc) return null;
  const s = doc.sections || {};
  const compounds = (s.stackWhy && s.stackWhy.compounds) || [];
  const operator = doc.mode === 'operator';

  return (
    <VitalisDocumentShell>
      <DocStatusBanner status={doc.status} />

      <DocCover
        eyebrow={doc.docClass}
        title={<Title text={doc.title} />}
        thesis={doc.thesis}
        meta={(doc.cover && doc.cover.meta) || []}
        review={doc.cover && doc.cover.review}
      />

      {/* SECTION 01 — Stack & Why */}
      <DocSection runhead="SECTION 01 · THE STACK & WHY" eyebrow="Section 01" title={<>The Stack <em>& Why</em></>} intro={s.stackWhy && s.stackWhy.intro}>
        <DocStatBand stats={doc.stats || []} />
        <DocCardGrid>
          {compounds.map((c, i) => (
            <DocCompoundCard key={i} name={c.name} descriptor={c.descriptor} role={c.role} roleTone={c.roleTone}>
              {c.headline && <span>{c.headline} </span>}
              {c.community && c.community.reportedBenefits && c.community.reportedBenefits.length > 0 && (
                <span>{c.community.reportedBenefits.slice(0, 2).join('; ')}. </span>
              )}
              {cardDoseLine(c) && <span className="vd-card__dose">{cardDoseLine(c)}</span>}
            </DocCompoundCard>
          ))}
        </DocCardGrid>
      </DocSection>

      {/* SECTION 02 — Selected Protocol Schedule */}
      <DocSection runhead="SECTION 02 · SELECTED PROTOCOL SCHEDULE" eyebrow="Section 02" title={<>Selected Protocol <em>Schedule</em></>} intro="This protocol reflects published study patterns, practitioner / community reference patterns, and research-use observations applied to this client’s stated goals. It is educational research information and must be reviewed by the practitioner / client before use.">
        <SelectedScheduleTable compounds={(s.schedule && s.schedule.compounds) || compounds} />
        <TimingRationales items={(s.schedule && s.schedule.timingRationales) || []} />
        <SupplySummary summary={s.schedule && s.schedule.supplySummary} />
      </DocSection>

      {/* SECTION 03 — Compound / Blend Reference */}
      <DocSection runhead="SECTION 03 · COMPOUND / BLEND REFERENCE" eyebrow="Section 03" title={<>Compound / Blend <em>Reference</em></>} intro="The broader study / community reference ranges behind the selected schedule — including uncertainty, evidence tier, and blend-component context.">
        <EvidenceTierLegend legend={(s.compoundReference && s.compoundReference.tierLegend) || (doc.evidence && doc.evidence.tierLegend)} />
        {((s.compoundReference && s.compoundReference.compounds) || compounds).map((c, i) => (
          <DocPanel key={i} name={c.name} cadence={c.dosing && c.dosing.frequency}>
            {c.form && <DocDef label="Form">{c.form}</DocDef>}
            {c.route && <DocDef label="Route">{c.route}</DocDef>}
            {c.dosing && c.dosing.isBlend && c.dosing.doseTranslation && c.dosing.doseTranslation.weeklyExposure && (
              <DocDef label="10 IU weekly translation">
                {c.dosing.doseTranslation.weeklyExposure}
                {c.dosing.doseTranslation.warning && <div style={{ marginTop: 4 }}>{c.dosing.doseTranslation.warning}</div>}
              </DocDef>
            )}
            {c.dosing && (c.dosing.referenceRange || c.dosing.doseAmountLine) && (
              <DocDef label="Reference range">
                <span style={{ color: c.dosing.noDoseAmount && !c.dosing.referenceRange ? '#a8432a' : 'var(--vd-ink)' }}>{c.dosing.referenceRange || c.dosing.doseAmountLine}</span>
              </DocDef>
            )}
            {c.dosing && c.dosing.sourceType && (
              <DocDef label="Dosing source">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="vd-strong" style={{ color: c.dosing.needsSource ? '#a8432a' : 'var(--vd-ink)' }}>
                    {({ STUDY_REPORTED: 'Study-reported', COMMUNITY_REFERENCE: 'Community reference', PRACTITIONER_REVIEW: 'Practitioner review', NEEDS_SOURCE: 'Needs source' })[c.dosing.sourceType] || c.dosing.sourceType}
                  </span>
                  {c.dosing.confidence && <span className="vd-em" style={{ color: 'var(--vd-muted)' }}>· {String(c.dosing.confidence).replace(/_/g, ' ')} confidence</span>}
                </span>
                {c.dosing.sourceNote && <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--vd-muted)' }}>{c.dosing.sourceNote}</div>}
              </DocDef>
            )}
            {c.mechanism && <DocDef label="Mechanism">{c.mechanism}</DocDef>}
            <DocDef label="Evidence">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <EvidenceStatusBadge status={c.evidenceStatus} />
                <span className="vd-em" style={{ color: 'var(--vd-muted)' }}>{c.evidenceLevel} corpus tier · {c.citationCount || 0} citation(s)</span>
              </span>
              {c.finding && <div style={{ marginTop: 6 }}>{c.finding}</div>}
              <CitationList citations={c.citations} />
            </DocDef>
            {operator && c.cautions && c.cautions.length > 0 && <DocDef label="Adaptation / cautions">{c.cautions.join(' · ')}</DocDef>}
            {c.contraindicationFlags && c.contraindicationFlags.length > 0 && <DocDef label="Flags">{c.contraindicationFlags.join(' · ')}</DocDef>}
            {operator && c.compliance && c.compliance.reason && <DocDef label="Compliance">{c.compliance.status} — {c.compliance.reason}</DocDef>}
          </DocPanel>
        ))}
      </DocSection>

      {/* SECTION 04 — Supportive Lifestyle */}
      <SupportiveLifestyleSection lifestyle={s.supportiveLifestyle} />

      {/* SECTION 05 — Physiological Monitoring */}
      <DocSection runhead="SECTION 05 · PHYSIOLOGICAL MONITORING" eyebrow="Section 05" title={<>Physiological <em>Monitoring</em></>} intro="Observation, not alarm — what an adaptation signal looks like and where the line is for a check-in.">
        <MonitoringPanel monitoring={s.monitoring} />
      </DocSection>

      {/* Contraindications */}
      {doc.contraindications && doc.contraindications.length > 0 && (
        <DocCallout tone="coral" title={(doc.contraindicationFrame && doc.contraindicationFrame.title) || 'Contraindications — review with your practitioner if any apply:'}>
          {doc.contraindicationFrame && doc.contraindicationFrame.framing ? <span>{doc.contraindicationFrame.framing} </span> : null}
          {doc.contraindications.join(' · ')}
          {doc.contraindicationFrame && doc.contraindicationFrame.action ? <span style={{ display: 'block', marginTop: 8 }}><span className="vd-strong">Action — </span>{doc.contraindicationFrame.action}</span> : null}
        </DocCallout>
      )}

      {/* Operator-only: blocked-gate reasons (never client-visible) */}
      {operator && doc.compliance && doc.compliance.blocked && (
        <DocCallout tone="coral" title="Blocked by gate (operator-only):">{(doc.compliance.reasons || []).join(' · ')}</DocCallout>
      )}

      <PractitionerReviewBlock provider={doc.provider} note={doc.practitionerNote} />
      <DocumentFooter disclaimer={doc.disclaimer} evidenceStatus={doc.evidence && doc.evidence.overallStatus} />
    </VitalisDocumentShell>
  );
}
