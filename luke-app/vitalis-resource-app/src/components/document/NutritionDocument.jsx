import {
  VitalisDocumentShell, DocStatusBanner, DocCover, DocSection, DocStatBand,
  DocCardGrid, DocCompoundCard, DocClinicalTable, DocPanel, DocDef, DocCallout, DocNumberedList,
} from './VitalisDocumentShell.jsx';
import {
  EvidenceTierLegend, CitationList, PractitionerReviewBlock, DocumentFooter,
} from './DocumentParts.jsx';

/**
 * NutritionDocument — the Vitalis dossier for the Nutrition vertical (the naturopath request slip).
 *
 * A thin composition of the shared VitalisDocumentShell primitives, mirroring
 * PeptideProtocolDocument's structure (Cover → S01 Findings & Why → S02 Discussion Plan →
 * S03 Reference → S04 Supportive Lifestyle → S05 Provider Review → aggregator → review → footer).
 * It does NOT import the peptide schedule grid. Renders ONLY what the server adapter
 * (toNutritionDocProps) provides — absent sections are omitted, never faked.
 *
 *   props.doc — the object returned by GET /api/documents/nutrition/:id (operator or client).
 */

const fmtVal = (c) => [c.value, c.unit].filter((x) => x != null && x !== '').join(' ');
const fmtRange = (c) => (c.refLow != null || c.refHigh != null) ? `ref ${c.refLow ?? '—'}–${c.refHigh ?? '—'}` : null;

export default function NutritionDocument({ doc }) {
  if (!doc) return null;
  const s = doc.sections || {};
  const operator = doc.mode === 'operator';
  const findings = (s.findings && s.findings.items) || [];
  const discussion = (s.discussionPlan && s.discussionPlan.items) || [];
  const reference = (s.reference && s.reference.items) || [];
  const providerReview = (s.providerReview && s.providerReview.items) || [];
  const lifestyle = s.supportiveLifestyle;

  return (
    <VitalisDocumentShell>
      <DocStatusBanner status={doc.status} />

      <DocCover
        eyebrow={doc.docClass}
        title={doc.title}
        thesis={doc.thesis}
        meta={(doc.cover && doc.cover.meta) || []}
        review={doc.cover && doc.cover.review}
      />

      {/* SECTION 01 — Findings & Why (one card per out-of-range nutrient; FORM, not dose) */}
      <DocSection runhead="SECTION 01 · FINDINGS & WHY" eyebrow="Section 01" title={<>Findings <em>& Why</em></>} intro={s.findings && s.findings.intro}>
        <DocStatBand stats={doc.stats || []} />
        {findings.length > 0 ? (
          <DocCardGrid>
            {findings.map((c, i) => (
              <DocCompoundCard key={i} name={c.name} descriptor={c.descriptor} role={c.role} roleTone={c.roleTone}>
                <span className="vd-card__dose">{fmtVal(c)}{fmtRange(c) ? ` · ${fmtRange(c)}` : ''}</span>
                {c.headline && <span> {c.headline} </span>}
                {c.foodFirst && c.foodFirst.length > 0 && <span>Food-first: {c.foodFirst.slice(0, 3).join(', ')}. </span>}
              </DocCompoundCard>
            ))}
          </DocCardGrid>
        ) : <p className="vd-footnote">{(s.findings && s.findings.emptyState) || 'No out-of-range nutrients found.'}</p>}
      </DocSection>

      {/* SECTION 02 — Discussion Plan (flat table; NO week-band grid) */}
      <DocSection runhead="SECTION 02 · DISCUSSION PLAN" eyebrow="Section 02" title={<>Discussion <em>Plan</em></>} intro={s.discussionPlan && s.discussionPlan.intro}>
        {discussion.length > 0 ? (
          <DocClinicalTable
            head={[{ label: 'Nutrient' }, { label: 'Form (context only)' }, { label: 'Ask your naturopath' }]}
            rows={discussion.map((d) => [{ block: d.nutrient }, d.form || '—', d.ask || '—'])}
          />
        ) : <p className="vd-footnote">{(s.discussionPlan && s.discussionPlan.emptyState) || 'No discussion items.'}</p>}
      </DocSection>

      {/* SECTION 03 — Reference (per-nutrient basis tier + food-first + operator citations) */}
      <DocSection runhead="SECTION 03 · REFERENCE" eyebrow="Section 03" title={<>Nutrient <em>Reference</em></>} intro={s.reference && s.reference.intro}>
        <EvidenceTierLegend legend={(s.reference && s.reference.tierLegend) || (doc.evidence && doc.evidence.tierLegend)} />
        {reference.map((c, i) => (
          <DocPanel key={i} name={c.name} descriptor={c.descriptor} cadence={c.tier}>
            {c.tierLabel && <DocDef label="Evidence basis">{c.tierLabel}</DocDef>}
            {c.foodFirst && c.foodFirst.length > 0 && <DocDef label="Food-first">{c.foodFirst.join(' · ')}</DocDef>}
            {c.ask && <DocDef label="Ask">{c.ask}</DocDef>}
            {operator && c.finding && <DocDef label="Finding">{c.finding}</DocDef>}
            {operator && c.citations && c.citations.length > 0 && (
              <DocDef label="Citations"><CitationList citations={c.citations} /></DocDef>
            )}
            {c.peptideContext && c.peptideContext.length > 0 && (
              <DocDef label="Protocol monitoring">
                {c.peptideContext.map((p, j) => (
                  <span key={j} style={{ display: 'block' }}>{(p.compounds || []).join(', ')} — {p.cadence}</span>
                ))}
              </DocDef>
            )}
          </DocPanel>
        ))}
      </DocSection>

      {/* SECTION 04 — Supportive Lifestyle */}
      {lifestyle && lifestyle.items && lifestyle.items.length > 0 && (
        <DocSection runhead="SECTION 04 · SUPPORTIVE LIFESTYLE" eyebrow="Section 04" title={<>Supportive <em>Lifestyle</em></>} intro={lifestyle.framing}>
          <DocNumberedList items={lifestyle.items} />
          {lifestyle.weeklyTracking && lifestyle.weeklyTracking.length > 0 && (
            <DocCallout title="What to track weekly:">{lifestyle.weeklyTracking.join(' · ')}</DocCallout>
          )}
        </DocSection>
      )}

      {/* SECTION 05 — Provider Review (electrolytes = coral 'provider review only') */}
      <DocSection runhead="SECTION 05 · PROVIDER REVIEW" eyebrow="Section 05" title={<>Provider <em>Review</em></>} intro={s.providerReview && s.providerReview.intro}>
        {providerReview.length > 0 ? (
          <DocCallout tone="coral" title="Provider review only — never an over-the-counter suggestion:">
            <DocClinicalTable
              head={[{ label: 'Marker' }, { label: 'Value' }, { label: 'Why review' }]}
              rows={providerReview.map((p) => [
                { block: p.marker, sub: p.nutrient || undefined },
                [fmtVal(p), fmtRange(p)].filter(Boolean).join(' · ') || '—',
                p.reason || '—',
              ])}
            />
          </DocCallout>
        ) : <p className="vd-footnote">No provider-review-only values flagged.</p>}
      </DocSection>

      {/* Research-aggregator callout */}
      {doc.aggregatorNote && <DocCallout title="Vitalis is a research aggregator.">{doc.aggregatorNote}</DocCallout>}

      <PractitionerReviewBlock provider={doc.provider} note={null} />
      <DocumentFooter disclaimer={doc.disclaimer} evidenceStatus={null} />
    </VitalisDocumentShell>
  );
}
