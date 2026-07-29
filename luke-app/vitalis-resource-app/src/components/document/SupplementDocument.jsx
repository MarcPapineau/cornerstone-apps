import {
  VitalisDocumentShell, DocStatusBanner, DocCover, DocSection, DocStatBand,
  DocCardGrid, DocCompoundCard, DocClinicalTable, DocPanel, DocDef, DocCallout, DocNumberedList,
} from './VitalisDocumentShell.jsx';
import {
  EvidenceTierLegend, CitationList, PractitionerReviewBlock, DocumentFooter,
} from './DocumentParts.jsx';

/**
 * SupplementDocument — the Vitalis $25–$50 practitioner-ready RESEARCH mini-dossier for the
 * supplement vertical. A thin composition of the shared VitalisDocumentShell primitives (no edits
 * to vdoc.css / DocumentParts / the shell) that renders ONLY what the server adapter
 * (toSupplementDocProps) provides. It does NOT import the peptide schedule grid.
 *
 * RESEARCH/RESOURCE phrasing only — never "take X". A PENDING_LABS plan surfaces honestly; nutrient
 * targets name a FORM, never a dose; every honest NEEDS_SOURCE / UNKNOWN row stays visible.
 *
 *   props.doc — the object returned by GET /api/documents/supplement/:id (operator or client).
 */

// Status word → tone for the lab-findings + priority chips (presentational only).
const statusTone = (s) => (/low|high|needs review/i.test(String(s)) ? 'coral' : 'slate');
const TIER_REASON = {
  T1: 'Human RCT / meta-analysis', T2: 'Human observational',
  T3: 'Established nutrition reference (RDA · safety)', T4: 'Mechanistic rationale',
  T5: 'Practitioner / community reference', NEEDS_SOURCE: 'Source gap — verify before citing',
};

export default function SupplementDocument({ doc }) {
  if (!doc) return null;
  const s = doc.sections || {};
  const operator = doc.mode === 'operator';
  const targets = (s.nutrientTargets && s.nutrientTargets.items) || [];
  const foodFirst = (s.foodFirst && s.foodFirst.items) || [];
  const discussion = (s.discussionPlan && s.discussionPlan.items) || [];
  const providerReview = (s.providerReview && s.providerReview.items) || [];
  const lifestyle = s.supportiveLifestyle;
  const peptideNotes = s.peptideNotes;
  const snapshot = s.clientSnapshot || null;
  const labFindings = (s.labFindings && s.labFindings.items) || [];
  const priority = (s.priorityRanking && s.priorityRanking.items) || [];
  const monitoring = s.monitoring || null;
  const checklist = (s.practitionerReview && s.practitionerReview.items) || [];
  const evRef = doc.evidenceReference || null;
  const research = doc.researchBasis || null;
  const exec = doc.cover && doc.cover.execSummary;

  return (
    <VitalisDocumentShell>
      <DocStatusBanner status={doc.status} />

      {/* SECTION 01 — Cover / Exec Summary */}
      <DocCover
        eyebrow={doc.docClass}
        title={doc.title}
        thesis={doc.thesis}
        meta={(doc.cover && doc.cover.meta) || []}
        review={doc.cover && doc.cover.review}
      />

      {exec && (
        <DocPanel name="Executive summary" descriptor="why this plan exists">
          <DocDef label="Your goal">{exec.goal}</DocDef>
          <DocDef label="Why this was generated">{exec.whyGenerated}</DocDef>
          <DocDef label="Inputs used">{(exec.inputsUsed || []).join(' · ')}</DocDef>
          {exec.needsReview && exec.needsReview.length > 0 && (
            <DocDef label="What needs practitioner review">{exec.needsReview.join(' · ')}</DocDef>
          )}
          <DocDef label="Resource only">{exec.resourceDisclaimer}</DocDef>
        </DocPanel>
      )}

      {/* Honest PENDING_LABS state — no fabricated suggestions */}
      {doc.pending && (
        <DocCallout tone="coral" title="Pending labs — nothing to suggest honestly yet.">{doc.pendingReason}</DocCallout>
      )}

      {/* SECTION 02 — Client Snapshot */}
      {snapshot && (
        <DocSection runhead="SECTION 02 · CLIENT SNAPSHOT" eyebrow="Section 02" title={<>Client <em>Snapshot</em></>} intro="Goals, lifestyle context, current protocol, allergies/preferences, and active lab flags used to generate this plan.">
          <DocStatBand stats={doc.stats || []} />
          <DocPanel name={snapshot.name || 'Client'} descriptor="snapshot">
            <DocDef label="Goals">{(snapshot.goals || []).join(' · ') || '—'}</DocDef>
            <DocDef label="Current protocol">{(snapshot.currentProtocol || []).join(' · ') || 'None recorded'}</DocDef>
            <DocDef label="Allergies / preferences">{(snapshot.allergiesPreferences || []).join(' · ') || 'None reported'}</DocDef>
            <DocDef label="Baseline vs latest">{snapshot.baselineVsLatest}</DocDef>
            {snapshot.lifestyle && snapshot.lifestyle.captured ? (
              <DocDef label="Lifestyle">{(snapshot.lifestyle.items || []).map((i) => i.marker).join(' · ')}</DocDef>
            ) : (
              <DocDef label="Lifestyle">
                <span className="vd-em">{(snapshot.lifestyle && snapshot.lifestyle.note) || 'Lifestyle detail not yet captured — intake should ask:'}</span>
                {snapshot.lifestyle && snapshot.lifestyle.intakeQuestions && (
                  <ul className="vd-ol" style={{ marginTop: 6 }}>
                    {snapshot.lifestyle.intakeQuestions.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                )}
              </DocDef>
            )}
            {(snapshot.activeLabFlags || []).length > 0 && (
              <DocDef label="Active lab flags">
                {snapshot.activeLabFlags.map((f, i) => (
                  <span key={i} className="vd-strong" style={{ marginRight: 10 }}>{f.marker}: {f.status}{f.value != null ? ` (${f.value}${f.unit || ''})` : ''}</span>
                ))}
              </DocDef>
            )}
          </DocPanel>
        </DocSection>
      )}

      {/* SECTION 03 — Lab + Lifestyle Findings (real, from labs; baseline-vs-latest deltas) */}
      {(labFindings.length > 0 || (snapshot && snapshot.lifestyle && !snapshot.lifestyle.captured)) && (
        <DocSection runhead="SECTION 03 · LAB + LIFESTYLE FINDINGS" eyebrow="Section 03" title={<>Lab + Lifestyle <em>Findings</em></>} intro={s.labFindings && s.labFindings.intro}>
          {labFindings.length > 0 ? (
            <DocClinicalTable
              head={[{ label: 'Marker' }, { label: 'Status' }, { label: 'Baseline → latest' }, { label: 'Why it matters (research context)' }]}
              rows={labFindings.map((f) => [
                { block: f.marker, sub: f.source },
                f.status,
                f.trend ? `${f.trend.baseline}${f.trend.unit || ''} → ${f.trend.latest}${f.trend.unit || ''} · ${f.trend.word}` : '—',
                f.whyItMatters || '—',
              ])}
            />
          ) : <p className="vd-footnote">{(s.labFindings && s.labFindings.emptyState) || 'No recorded labs.'}</p>}
          {snapshot && snapshot.lifestyle && !snapshot.lifestyle.captured && (
            <DocCallout title="Lifestyle not yet captured.">
              {snapshot.lifestyle.note} {(snapshot.lifestyle.intakeQuestions || []).join(' · ')}
            </DocCallout>
          )}
        </DocSection>
      )}

      {/* SECTION 04 — Priority Ranking (deterministic from tier + flag) */}
      {priority.length > 0 && (
        <DocSection runhead="SECTION 04 · PRIORITY RANKING" eyebrow="Section 04" title={<>Priority <em>Ranking</em></>} intro={s.priorityRanking && s.priorityRanking.intro}>
          <DocClinicalTable
            head={[{ label: 'Priority' }, { label: 'Target' }, { label: 'Tier' }, { label: 'Why' }]}
            rows={priority.map((p) => [{ block: p.band }, p.nutrient, p.tier || '—', p.why || '—'])}
          />
        </DocSection>
      )}

      {/* SECTION 05 — Supplement Detail Cards (FORM, not dose) */}
      <DocSection runhead="SECTION 05 · SUPPLEMENT DETAIL" eyebrow="Section 05" title={<>Supplement <em>Detail</em></>} intro={s.nutrientTargets && s.nutrientTargets.intro}>
        {targets.length > 0 ? (
          <DocCardGrid>
            {targets.map((t, i) => (
              <DocCompoundCard key={i} name={t.nutrient} descriptor={t.descriptor} role={t.tierLabel || t.tier} roleTone="support">
                {/* Show the "Form:" line only when the form was NOT already shown beside the name
                    (t.descriptor) — so a distinct form appears exactly once, never duplicated. */}
                {t.suggestedForm && !t.descriptor && <span className="vd-card__dose">Form: {t.suggestedForm} · dose is your naturopath’s call</span>}
                {t.suggestedForm && t.descriptor && <span className="vd-card__dose">Dose is your naturopath’s call</span>}
                <span> Research and practitioner discussions commonly reference this form. Final dose, timing, suitability, and duration require practitioner review.</span>
              </DocCompoundCard>
            ))}
          </DocCardGrid>
        ) : <p className="vd-footnote">{(s.nutrientTargets && s.nutrientTargets.emptyState) || 'No nutrient targets.'}</p>}
      </DocSection>

      {/* SECTION 06 — Food-First Support */}
      {foodFirst.length > 0 && (
        <DocSection runhead="SECTION 06 · FOOD-FIRST" eyebrow="Section 06" title={<>Food-First <em>Support</em></>} intro={s.foodFirst && s.foodFirst.intro}>
          <DocClinicalTable
            head={[{ label: 'Nutrient' }, { label: 'Food-first sources' }]}
            rows={foodFirst.map((f) => [{ block: f.nutrient }, (f.options || []).join(', ') || '—'])}
          />
        </DocSection>
      )}

      {/* SECTION 07 — Timing / Tolerance / Practical Use + Discussion items */}
      <DocSection runhead="SECTION 07 · TIMING & PRACTICAL USE" eyebrow="Section 07" title={<>Timing & <em>Practical Use</em></>} intro="Common timing and tolerance context to raise with your naturopath. This is discussion context, not a prescription — final timing is set under practitioner guidance.">
        {discussion.length > 0 ? (
          <DocClinicalTable
            head={[{ label: 'Nutrient' }, { label: 'Form (context only)' }, { label: 'Discussion item / ask' }]}
            rows={discussion.map((d) => [{ block: d.nutrient }, d.form || '—', d.ask || '—'])}
          />
        ) : <p className="vd-footnote">No discussion items.</p>}
      </DocSection>

      {/* SECTION 08 — Monitoring + Next Labs */}
      {monitoring && (
        <DocSection runhead="SECTION 08 · MONITORING & NEXT LABS" eyebrow="Section 08" title={<>Monitoring & <em>Next Labs</em></>} intro={monitoring.intro}>
          <DocPanel name="What to track" descriptor="between visits">
            {monitoring.markers && monitoring.markers.length > 0 && <DocDef label="Monitoring markers">{monitoring.markers.join(' · ')}</DocDef>}
            {monitoring.recheckPanel && <DocDef label="Recheck panel">{monitoring.recheckPanel.label}{monitoring.recheckPanel.fasting ? ' · fasting' : ''}</DocDef>}
            <DocDef label="Review interval">{monitoring.reviewInterval}</DocDef>
            {monitoring.triggers && monitoring.triggers.length > 0 && <DocDef label="Follow-up triggers">{monitoring.triggers.join(' · ')}</DocDef>}
          </DocPanel>
          {monitoring.weeklyTracking && monitoring.weeklyTracking.length > 0 && (
            <>
              <h3 className="vd-subhead" style={{ marginTop: 16 }}>What to track weekly</h3>
              <DocNumberedList items={monitoring.weeklyTracking} />
            </>
          )}
        </DocSection>
      )}

      {/* SECTION 09 — Practitioner Review Checklist (operator only) */}
      {operator && checklist.length > 0 && (
        <DocSection runhead="SECTION 09 · PRACTITIONER REVIEW" eyebrow="Section 09" title={<>Practitioner <em>Review Checklist</em></>} intro={s.practitionerReview && s.practitionerReview.intro}>
          <DocPanel name="Before authorizing">
            {checklist.map((c, i) => <DocDef key={i} label={c.label}>{c.body}</DocDef>)}
          </DocPanel>
        </DocSection>
      )}

      {/* SECTION 10 — Evidence Reference (tier + plain-English reason + source category) */}
      {evRef && evRef.items && evRef.items.length > 0 && (
        <DocSection runhead="SECTION 10 · EVIDENCE REFERENCE" eyebrow="Section 10" title={<>Evidence <em>Reference</em></>} intro={evRef.intro}>
          <EvidenceTierLegend legend={evRef.tierLegend} />
          <DocClinicalTable
            head={[{ label: 'Applies to' }, { label: 'Tier' }, { label: 'Reason' }, { label: 'Source category' }, { label: 'Status' }]}
            rows={evRef.items.map((r) => [
              { block: r.appliesTo },
              r.evidenceTier,
              TIER_REASON[r.evidenceTier] || r.evidenceTier,
              String(r.sourceType || '').replace(/_/g, ' '),
              r.reviewStatus,
            ])}
          />
        </DocSection>
      )}

      {/* SECTION 11 — Research Basis & Source Transparency (REQUIRED) */}
      {research && (
        <DocSection runhead="SECTION 11 · RESEARCH BASIS" eyebrow="Section 11" title={<>Research Basis & <em>Source Transparency</em></>} intro={research.intro}>
          <EvidenceTierLegend legend={research.tierLegend} />
          <DocPanel name="How to read this" descriptor="source transparency">
            <DocDef label="Summary">{research.note}</DocDef>
            {research.counts && (
              <DocDef label="Source coverage">
                {research.counts.sourceBacked} source-backed · {research.counts.needsSource} source-gap (NEEDS_SOURCE) · {research.counts.total} claims total.
              </DocDef>
            )}
            {research.govUse && research.govUse.used && <DocDef label="Government / regulatory use">{research.govUse.purpose}</DocDef>}
          </DocPanel>

          {/* Per-claim provenance table — tiers + source categories for both views; operator sees citations. */}
          <h3 className="vd-subhead" style={{ marginTop: 18 }}>Per-claim provenance</h3>
          <DocClinicalTable
            head={operator
              ? [{ label: 'Applies to' }, { label: 'Tier' }, { label: 'Source category' }, { label: 'What it backs' }, { label: 'Citation / status' }]
              : [{ label: 'Applies to' }, { label: 'Tier' }, { label: 'Source category' }, { label: 'What it backs' }, { label: 'Status' }]}
            rows={(research.provenance || []).map((r) => [
              { block: r.appliesTo, sub: r.evidenceTier === 'NEEDS_SOURCE' ? 'source gap' : undefined },
              r.evidenceTier,
              String(r.sourceType || '').replace(/_/g, ' '),
              r.claimSupported || '—',
              operator
                ? (r.urlOrPmid
                  ? <a href={r.urlOrPmid} target="_blank" rel="noreferrer" style={{ color: 'var(--vd-ink)', textDecoration: 'underline' }}>{r.citation || r.urlOrPmid}</a>
                  : (r.citation || r.reviewStatus))
                : r.reviewStatus,
            ])}
          />

          {/* Research-gap list — the NEEDS_SOURCE claims to verify before citing (candidate sources only). */}
          {research.gapList && research.gapList.length > 0 && (
            <DocCallout tone="coral" title="Research-gap list — efficacy claims awaiting a verified primary source.">
              <ul className="vd-ol" style={{ marginTop: 6 }}>
                {research.gapList.map((g, i) => (
                  <li key={i}><span className="vd-strong">{g.appliesTo}</span> — {g.claim} <span className="vd-em">({g.reviewStatus}; {g.candidateAction})</span></li>
                ))}
              </ul>
            </DocCallout>
          )}
        </DocSection>
      )}

      {/* Provider review (electrolytes = coral; never an OTC suggestion) */}
      {providerReview.length > 0 && (
        <DocCallout tone="coral" title="Provider review only — never an over-the-counter suggestion:">
          <DocClinicalTable
            head={[{ label: 'Marker' }, { label: 'Why review' }]}
            rows={providerReview.map((p) => [{ block: p.marker, sub: p.nutrient || undefined }, p.reason || '—'])}
          />
        </DocCallout>
      )}

      {/* Protocol monitoring (sourced from PEPTIDE_ADDITIONS; honest empty) */}
      {peptideNotes && peptideNotes.onProtocol && (
        <DocCallout title="Protocol monitoring.">
          {peptideNotes.monitoringMarkers && peptideNotes.monitoringMarkers.length > 0
            ? <span><span className="vd-strong">Monitor — </span>{peptideNotes.monitoringMarkers.join(' · ')}. </span>
            : null}
          {peptideNotes.note}
        </DocCallout>
      )}

      {/* Supportive lifestyle */}
      {lifestyle && lifestyle.items && lifestyle.items.length > 0 && (
        <DocSection runhead="SUPPORTIVE LIFESTYLE" eyebrow="Supportive lifestyle" title={<>Supportive <em>Lifestyle</em></>} intro={lifestyle.framing}>
          <DocNumberedList items={lifestyle.items} />
        </DocSection>
      )}

      {/* Research-aggregator callout */}
      {doc.aggregatorNote && <DocCallout title="Vitalis is a research aggregator.">{doc.aggregatorNote}</DocCallout>}

      <PractitionerReviewBlock provider={doc.provider} note={null} />
      <DocumentFooter disclaimer={doc.disclaimer} evidenceStatus={null} />
    </VitalisDocumentShell>
  );
}
