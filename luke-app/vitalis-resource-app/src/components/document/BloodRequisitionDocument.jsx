import {
  VitalisDocumentShell, DocStatusBanner, DocCover, DocSection, DocStatBand,
  DocCardGrid, DocCompoundCard, DocClinicalTable, DocPanel, DocDef, DocCallout,
} from './VitalisDocumentShell.jsx';
import { PractitionerReviewBlock, DocumentFooter } from './DocumentParts.jsx';

/**
 * BloodRequisitionDocument — the Vitalis dossier for the Blood-Requisition vertical.
 *
 * A thin composition of the shared VitalisDocumentShell primitives, mirroring
 * PeptideProtocolDocument's structure. It does NOT import the peptide schedule grid. Renders
 * ONLY what the server adapter (toBloodRequisitionDocProps) provides: the BASELINE panel as
 * category-grouped marker cards, PEPTIDE_ADDITIONS cadence (sourced, never invented), and any
 * NEEDS_SOURCE panel surfaced honestly (never populated with invented markers). Dr. Vincent Lun
 * is the referral.
 *
 *   props.doc — the object returned by GET /api/documents/blood_req/:id (operator or client).
 */
export default function BloodRequisitionDocument({ doc }) {
  if (!doc) return null;
  const s = doc.sections || {};
  const baseline = s.baseline || { sections: [] };
  const safety = s.safetyMonitoring || { detail: [], markers: [] };
  const needsSource = (s.needsSource && s.needsSource.items) || [];
  const suggested = (s.suggested && s.suggested.items) || [];
  const predictable = s.predictableMovement;

  return (
    <VitalisDocumentShell>
      <DocStatusBanner status={doc.status} draftLabel="To order · review with your practitioner before any labs are drawn" />

      <DocCover
        eyebrow={doc.docClass}
        title={doc.title}
        thesis={doc.thesis}
        meta={(doc.cover && doc.cover.meta) || []}
        review={doc.cover && doc.cover.review}
      />

      {/* SECTION 01 — Baseline panel (category-grouped MARKER cards) */}
      <DocSection
        runhead="SECTION 01 · BASELINE PANEL"
        eyebrow="Section 01"
        title={<>Baseline <em>Panel</em></>}
        intro={baseline.intro}
      >
        <DocStatBand stats={doc.stats || []} />
        {baseline.fasting && <DocCallout title="Fasting required.">12-hour fast before draw. {baseline.source}</DocCallout>}
        <DocCardGrid>
          {(baseline.sections || []).map((sec, i) => (
            <DocCompoundCard key={i} name={sec.section} role={`${(sec.markers || []).length} marker(s)`} roleTone="foundation">
              {(sec.markers || []).join(' · ')}
            </DocCompoundCard>
          ))}
        </DocCardGrid>
      </DocSection>

      {/* SECTION 02 — Protocol-driven additions (PEPTIDE_ADDITIONS cadence; sourced) */}
      <DocSection
        runhead="SECTION 02 · PROTOCOL ADDITIONS"
        eyebrow="Section 02"
        title={<>Protocol <em>Additions</em></>}
        intro={s.safetyMonitoring && s.safetyMonitoring.intro}
      >
        {safety.detail && safety.detail.length > 0 ? (
          <DocClinicalTable
            head={[{ label: 'Markers' }, { label: 'Cadence' }, { label: 'Triggered by' }]}
            rows={safety.detail.map((d) => [{ block: (d.markers || []).join(', ') }, d.cadence || '—', d.matchedOn || '—'])}
          />
        ) : (
          <p className="vd-footnote">No monitored compound on the current protocol — no product-driven additions (shown honestly, not padded).</p>
        )}
      </DocSection>

      {/* NEEDS_SOURCE panels — surfaced honestly, never invented markers */}
      {needsSource.length > 0 && (
        <DocSection runhead="NEEDS SOURCE" eyebrow="Honest gaps" title={<>Not <em>Enumerated</em></>} intro={s.needsSource && s.needsSource.intro}>
          {needsSource.map((p, i) => (
            <DocPanel key={i} name={p.label} cadence="NEEDS_SOURCE">
              <DocDef label="Status">{p.status}</DocDef>
              <DocDef label="Why">{p.needs}</DocDef>
              <DocDef label="Markers">None — never invented.</DocDef>
            </DocPanel>
          ))}
        </DocSection>
      )}

      {/* What moves predictably (from lab-scenarios; geometric movement, not a treatment claim) */}
      {predictable && predictable.markers && predictable.markers.length > 0 && (
        <DocSection runhead="WHAT MOVES PREDICTABLY" eyebrow="Reference" title={<>What Moves <em>Predictably</em></>} intro={predictable.note}>
          <DocClinicalTable
            head={[{ label: 'Marker' }, { label: 'Baseline' }, { label: 'Follow-up' }, { label: 'Direction' }]}
            rows={predictable.markers.map((m) => [
              { block: m.marker },
              m.baseline != null ? `${m.baseline}${m.unit ? ' ' + m.unit : ''}` : '—',
              m.followUp != null ? `${m.followUp}${m.unit ? ' ' + m.unit : ''}` : '—',
              m.direction === 'INTO_RANGE' ? 'Into range' : 'Changed',
            ])}
          />
        </DocSection>
      )}

      {/* Protocol-flagged suggestions */}
      {suggested.length > 0 && (
        <DocCallout title="Also flagged by the protocol:">{suggested.join(' · ')}</DocCallout>
      )}

      {/* Research-aggregator callout */}
      {doc.aggregatorNote && <DocCallout title="Vitalis is a research aggregator.">{doc.aggregatorNote}</DocCallout>}

      <PractitionerReviewBlock provider={doc.provider} note={null} />
      <DocumentFooter disclaimer={doc.disclaimer} evidenceStatus={null} />
    </VitalisDocumentShell>
  );
}
