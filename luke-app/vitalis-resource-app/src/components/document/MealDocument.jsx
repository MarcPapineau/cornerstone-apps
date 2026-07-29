import {
  VitalisDocumentShell, DocStatusBanner, DocCover, DocSection, DocStatBand,
  DocClinicalTable, DocPanel, DocDef, DocCallout, DocNumberedList,
} from './VitalisDocumentShell.jsx';
import { PractitionerReviewBlock, DocumentFooter } from './DocumentParts.jsx';

/**
 * MealDocument — the Vitalis dossier for the Meal / Diet vertical (the meal-plan draft).
 *
 * A thin composition of the shared VitalisDocumentShell primitives, mirroring
 * PeptideProtocolDocument's structure. It does NOT import the peptide schedule grid — the
 * 7-day plan is a flat DocClinicalTable (per-meal + dayTotals). Renders ONLY what the server
 * adapter (toMealDocProps) provides. macroTarget is PROVIDED/ESTIMATED/UNKNOWN (never guessed);
 * macros are CURATED_ESTIMATE / SOURCE_PENDING; hard allergen / dislike exclusion is preserved.
 *
 *   props.doc — the object returned by GET /api/documents/meal/:id (operator or client).
 */

const MACRO_TONE = { PROVIDED: 'slate', ESTIMATED: 'coral', UNKNOWN: 'coral' };
const macroCell = (v, unit) => (v == null ? 'UNKNOWN' : `${v}${unit}`);

export default function MealDocument({ doc }) {
  if (!doc) return null;
  const s = doc.sections || {};
  const mt = s.macroTarget || { status: 'UNKNOWN' };
  const weekly = s.weeklyPlan || { days: [] };
  const days = weekly.days || [];
  const grocery = (s.groceryList && s.groceryList.items) || [];
  const subs = (s.substitutions && s.substitutions.items) || [];
  const prep = (s.prepNotes && s.prepNotes.items) || [];
  const excluded = s.excluded || { allergies: [], dislikes: [] };

  // Build the 7-day table: a row per meal-slot, plus a bold day-total row after each day.
  const slots = days[0] ? days[0].meals.map((m) => m.slot) : [];
  const rows = [];
  days.forEach((d) => {
    d.meals.forEach((m, mi) => {
      rows.push([
        mi === 0 ? { block: `Day ${d.day}`, sub: m.slot } : { block: '', sub: m.slot },
        m.name || (m.status === 'NO_COMPLIANT_OPTION' ? { muted: m.note || 'Practitioner to add' } : '—'),
        m.kcal != null ? `${m.kcal} kcal` : '—',
        m.proteinG != null ? `${m.proteinG}g P` : '—',
      ]);
    });
    if (d.dayTotals) {
      rows.push([
        { block: '', sub: 'Day total' },
        { muted: weekly.intro ? 'curated estimate' : '—' },
        d.dayTotals.kcal != null ? `${d.dayTotals.kcal} kcal` : '—',
        d.dayTotals.proteinG != null ? `${d.dayTotals.proteinG}g P` : '—',
      ]);
    }
  });

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

      {/* SECTION 01 — Daily macro target (PROVIDED / ESTIMATED / UNKNOWN) */}
      <DocSection runhead="SECTION 01 · MACRO TARGET" eyebrow="Section 01" title={<>Daily Macro <em>Target</em></>} intro={mt.basis}>
        <DocStatBand stats={doc.stats || []} />
        <DocCallout tone={MACRO_TONE[mt.status] || 'plain'} title={`Target status: ${mt.status}.`}>
          <span style={{ display: 'block', marginTop: 4 }}>
            <span className="vd-strong">Calories — </span>{mt.kcal == null ? 'UNKNOWN (practitioner to set)' : `${mt.kcal} kcal${mt.status === 'ESTIMATED' ? ' (estimated)' : ''}`} ·{' '}
            <span className="vd-strong">Protein — </span>{macroCell(mt.proteinG, ' g')} ·{' '}
            <span className="vd-strong">Carbs — </span>{macroCell(mt.carbG, ' g')} ·{' '}
            <span className="vd-strong">Fat — </span>{macroCell(mt.fatG, ' g')}
          </span>
          {mt.providerReviewRequired && <span style={{ display: 'block', marginTop: 6 }} className="vd-em">Estimate — confirm with your practitioner.</span>}
        </DocCallout>
      </DocSection>

      {/* SECTION 02 — 7-day plan (flat table; CURATED_ESTIMATE / SOURCE_PENDING) */}
      <DocSection runhead="SECTION 02 · WEEKLY PLAN" eyebrow="Section 02" title={<>Weekly <em>Plan</em></>} intro={weekly.intro}>
        {rows.length > 0 ? (
          <DocClinicalTable
            head={[{ label: 'Day', sub: slots.length ? slots.join(' / ') : undefined }, { label: 'Meal' }, { label: 'Calories' }, { label: 'Protein' }]}
            rows={rows}
          />
        ) : <p className="vd-footnote">No meals planned.</p>}
        {weekly.monthlyNote && <DocCallout title="Monthly plan.">{weekly.monthlyNote}</DocCallout>}
        {(doc.sourceNotes || []).length > 0 && (
          <p className="vd-footnote" style={{ marginTop: 10 }}>{doc.sourceNotes.join(' · ')}</p>
        )}
      </DocSection>

      {/* SECTION 03 — Grocery list */}
      {grocery.length > 0 && (
        <DocSection runhead="SECTION 03 · GROCERY LIST" eyebrow="Section 03" title={<>Grocery <em>List</em></>} intro={s.groceryList && s.groceryList.intro}>
          <DocClinicalTable
            head={[{ label: 'Item' }, { label: 'Used in' }]}
            rows={grocery.map((g) => [{ block: g.item }, `${g.mealsUsing} meal(s)`])}
          />
        </DocSection>
      )}

      {/* SECTION 04 — Substitutions (hard-exclusion alternatives) */}
      {subs.length > 0 && (
        <DocSection runhead="SECTION 04 · SUBSTITUTIONS" eyebrow="Section 04" title={<>Sub<em>stitutions</em></>} intro={s.substitutions && s.substitutions.intro}>
          <DocClinicalTable
            head={[{ label: 'Excluded' }, { label: 'Reason' }, { label: 'Alternatives' }]}
            rows={subs.map((x) => [{ block: x.excluded }, x.reason || '—', (x.alternatives || []).join(', ') || '—'])}
          />
        </DocSection>
      )}

      {/* Hard exclusion — preserved + surfaced (allergies can never appear in any meal above) */}
      {(excluded.allergies.length > 0 || excluded.dislikes.length > 0) && (
        <DocCallout tone="coral" title="Hard exclusions — removed from every meal above:">
          {[...excluded.allergies.map((a) => `${a} (allergy)`), ...excluded.dislikes.map((d) => `${d} (disliked)`)].join(' · ')}
        </DocCallout>
      )}

      {/* Prep notes */}
      {prep.length > 0 && (
        <DocSection runhead="PREP NOTES" eyebrow="Prep notes" title={<>Prep <em>Notes</em></>}>
          <DocNumberedList items={prep} />
        </DocSection>
      )}

      <PractitionerReviewBlock provider={doc.provider} note={null} />
      <DocumentFooter disclaimer={doc.disclaimer} evidenceStatus={null} />
    </VitalisDocumentShell>
  );
}
