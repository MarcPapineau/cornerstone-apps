'use strict';
/**
 * document-model.js — the vertical-document ADAPTERS + Research Source Doctrine labeling.
 *
 * REUSE > REBUILD. This module adds ZERO clinical logic. It maps the REAL output of the
 * existing engines (generator / supplements / nutrition / meals / packages) onto the shared
 * "Vitalis Research" dossier schema the React document shell renders. It is CommonJS + pure so
 * the acceptance harness can test it directly (no React), and the server runs it so the browser
 * stays thin (server-authoritative).
 *
 * Research Source Doctrine (labeling only — never fabricates a source):
 *   • Evidence LANES — PRIMARY_EVIDENCE (journal/DOI), DISCOVERY_INDEX (PubMed/CT.gov/Scholar as
 *     a finder, not the authority), PRACTITIONER_COMMENTARY (labeled), COMPLIANCE (gov pages —
 *     kept OUT of the scientific-evidence lane).
 *   • Evidence TIERS — T1 human RCT/controlled · T2 human observational/open-label · T3
 *     practitioner consensus (labeled) · T4 animal/in-vitro/mechanistic.
 *   • Evidence STATUS (shown honestly per document) — SOURCE_FOUND · REVIEWED · SOURCE_PENDING ·
 *     UNKNOWN · PRACTITIONER_INTERPRETATION · PRECLINICAL_ONLY.
 * A government page is NEVER the scientific authority; citations carry the underlying journal.
 *
 * NOT medical advice. NOT a prescription.
 */
const providersCfg = require('./data/providers');
const dosingLib = require('./data/dosing');
const docStandard = require('./data/protocol-document-standard');

const DR_LUN = (providersCfg.PROVIDERS || []).find((p) => p.id === 'dr_vincent_lun')
  || { name: 'Dr. Vincent Lun', role: 'Naturopathic Doctor', contact: null };

const LANES = {
  PRIMARY: 'PRIMARY_EVIDENCE',
  INDEX: 'DISCOVERY_INDEX',
  COMMENTARY: 'PRACTITIONER_COMMENTARY',
  COMPLIANCE: 'COMPLIANCE',
};
const EVIDENCE_TIERS = ['T1', 'T2', 'T3', 'T4'];
const EVIDENCE_STATUSES = ['SOURCE_FOUND', 'REVIEWED', 'SOURCE_PENDING', 'UNKNOWN', 'PRACTITIONER_INTERPRETATION', 'PRECLINICAL_ONLY'];
const TIER_LEGEND = [
  { tier: 'T1', label: 'Human clinical trial — randomized or controlled' },
  { tier: 'T2', label: 'Human observational / open-label / case series' },
  { tier: 'T3', label: 'Practitioner consensus / expert protocol pattern (labeled)' },
  { tier: 'T4', label: 'Animal / in-vitro / mechanistic (preclinical)' },
];

const lc = (s) => String(s || '').toLowerCase();
const arr = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));

// Index/finder hosts — surfaced as "via", never cited as the authority (doctrine).
const INDEX_HOSTS = ['pubmed', 'ncbi.nlm.nih', 'clinicaltrials.gov', 'scholar.google', 'semanticscholar', 'europepmc', 'crossref', 'doi.org'];
// Government / regulatory hosts — kept in the COMPLIANCE lane, NOT scientific evidence.
const GOV_HOSTS = ['fda.gov', 'who.int', 'cdc.gov', 'ods.od.nih.gov', 'canada.ca', 'ema.europa'];

function isPreclinical(c) {
  const t = lc(c.title) + ' ' + lc(c.source);
  return /\b(mouse|mice|rat|rodent|animal|in vitro|in-vitro|preclinical|cell line|hamster)\b/.test(t);
}
function tierForCitation(c) {
  const t = lc(c.title) + ' ' + lc(c.source) + ' ' + lc(c.type);
  if (isPreclinical(c)) return 'T4';
  if (/\b(meta-analysis|systematic review|randomized|randomised|controlled trial|\brct\b|phase 2|phase 3|phase ii|phase iii|clinicaltrial)\b/.test(t)) return 'T1';
  if (/\b(observational|cohort|case series|open-label|open label|pilot|registry|real-world)\b/.test(t)) return 'T2';
  return 'T2'; // a journal human paper with no explicit design keyword — conservative human-observational
}
function laneForCitation(c) {
  const host = lc(c.url);
  const gov = GOV_HOSTS.some((h) => host.includes(h)) && !host.includes('pubmed');
  if (gov) return { lane: LANES.COMPLIANCE, via: null };
  const via = INDEX_HOSTS.find((h) => host.includes(h)) || null;
  // Has a journal/source name → the underlying source is PRIMARY; the index is only the finder.
  if (c.source) return { lane: LANES.PRIMARY, via: via ? c.type || via : null };
  return { lane: LANES.INDEX, via: via ? c.type || via : null };
}
function labelCitations(citations) {
  return arr(citations).map((c) => ({
    title: c.title, source: c.source, url: c.url, type: c.type,
    tier: tierForCitation(c), ...laneForCitation(c),
  }));
}

// Honest per-compound evidence status from real engine fields (never strengthens the claim).
function evidenceStatusForItem(item, reviewed) {
  const studies = (item.basis && item.basis.studies) || {};
  const cites = labelCitations(studies.citations);
  const level = String(item.evidenceLevel || 'UNKNOWN').toUpperCase();
  const trial = !!item.hasClinicalTrial;
  if (!cites.length && level === 'UNKNOWN') return 'UNKNOWN';
  if (!cites.length) return 'SOURCE_PENDING';
  if (cites.length && cites.every((c) => c.tier === 'T4')) return 'PRECLINICAL_ONLY';
  if (reviewed && (trial || level === 'HIGH' || level === 'MODERATE')) return 'REVIEWED';
  if (trial || level === 'HIGH' || level === 'MODERATE') return 'SOURCE_FOUND';
  return 'PRACTITIONER_INTERPRETATION';
}

const DURATION_NOTE = (weeks) => (weeks ? `${weeks} weeks (research cycle reference)` : null);
const refId = (draft) => 'VR-' + String(draft.id || 'DRAFT').replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase();

const PEPTIDE_DISCLAIMER =
  'Strictly for research and educational purposes. This document is a research guide intended for review and ' +
  `authorization by ${DR_LUN.name} (or another licensed medical professional). It is not medical advice, a ` +
  'prescription, a diagnosis, or a doctor–patient relationship. The compounds described are not FDA-approved for ' +
  'the indications discussed except where explicitly noted; sourcing must be from a reputable, verified supplier. ' +
  'The recipient is responsible for confirming clinical appropriateness and executing any protocol under qualified oversight.';
const REVIEW_BODY =
  'This document is a research and educational protocol intended for review and authorization by a licensed medical ' +
  'professional. Baseline bloodwork is recommended before initiation. The recipient is responsible for confirming ' +
  'clinical appropriateness and for executing the protocol under qualified oversight.';

const ROLE_BY_INDEX = (i) => (i === 0 ? { role: 'ANCHOR', tone: 'anchor' } : { role: 'SUPPORT', tone: 'support' });

/**
 * toPeptideDocProps(draft, { role, client, referenceId }) → dossier props for the Peptide vertical.
 * Maps the REAL generator draft (items[].dosing/basis/evidence, monitoring, labsSuggested, compliance)
 * onto the shared dossier schema. Operator sees everything; CLIENT view drops internal-only fields
 * (dosing.basis framing, blockedReasons, compliance.reason, study citations stay but rationale is hidden).
 */
function toPeptideDocProps(draft, opts = {}) {
  if (!draft) return null;
  const isClient = String(opts.role || '').toUpperCase() === 'CLIENT';
  const client = opts.client || null;
  const status = draft.status || 'DRAFT';
  const reviewed = status === 'APPROVED_RESOURCE' || !!draft.reviewedBy;
  const items = arr(draft.items);

  const compounds = items.map((it, i) => {
    const d = it.dosing || {};
    // DOSING SOURCE-OF-TRUTH (no adapter drift, per vitalis-research-doctrine): read the SELECTED schedule
    // STRAIGHT from the canonical engine (blendScheduleFor / selectedScheduleFor). This adapter only RESHAPES
    // for display — it never infers, generates, softens, overwrites, or "completes" dosing.
    const _blendId = (dosingLib.blendIdForItem && dosingLib.blendIdForItem(it)) || it.evidenceCompoundId;
    const _isBlend = !!(_blendId && dosingLib.BLEND_SCHEDULES && dosingLib.BLEND_SCHEDULES[String(_blendId).toLowerCase()]);
    const sched = _blendId
      ? (_isBlend
          ? (dosingLib.blendScheduleFor ? dosingLib.blendScheduleFor(_blendId) : null)
          : (dosingLib.selectedScheduleFor ? dosingLib.selectedScheduleFor(_blendId) : null))
      : null;
    const entry = (!_isBlend && _blendId && dosingLib.dosingFor) ? dosingLib.dosingFor(_blendId) : null;
    const dSelection = d.selectionStatus || (sched && sched.scheduleStatus) || 'NEEDS_SOURCE';
    const dNeedsSource = dSelection === 'NEEDS_SOURCE';
    const dSourceBasis = d.sourceBasis || d.sourceType || (sched && sched.sourceBasis) || null;
    const dConfidence = d.confidence || (sched && sched.confidence) || null;
    const dSourceNote = d.sourceNote || (sched && sched.sourceNote) || null;
    // explicit dose amount + citations from the CURATED source (display-derived, never synthesized dosing)
    const dDoseAmount = d.doseAmount
      || (sched && sched.scheduleStatus === 'SELECTED' ? (sched.selectedDose || sched.fullDose || null) : null)
      || (dosingLib.formatDoseAmount ? dosingLib.formatDoseAmount(entry && entry.perDose) : null);
    const dDoseAmountLine = d.doseAmountLine || dDoseAmount || dosingLib.NEEDS_DOSE_LINE;
    const dCitations = (d.citations && d.citations.length) ? d.citations
      : (entry && dosingLib.dosingCitations ? dosingLib.dosingCitations(_blendId) : []);
    const basis = it.basis || {};
    const studies = basis.studies || {};
    const role = ROLE_BY_INDEX(i);
    const evStatus = evidenceStatusForItem(it, reviewed);
    const out = {
      name: it.productName,
      descriptor: (basis.label && basis.tier) ? `${(it.evidenceCompoundId || '').toUpperCase()}` : (it.form || null),
      role: `${role.role} · ${DURATION_NOTE(d.cycleWeeks) || 'cycle per practitioner'}`,
      roleTone: role.tone,
      route: it.route || null,
      form: it.form || null,
      evidenceLevel: it.evidenceLevel || 'UNKNOWN',
      evidenceTier: basis.tier || null,           // engine's own tier (TRIALS/OBSERVATIONAL/…)
      evidenceStatus: evStatus,
      headline: basis.headline || null,
      mechanism: studies.mechanism || null,
      finding: studies.finding || null,
      citationCount: it.citationCount != null ? it.citationCount : (studies.citations || []).length,
      citations: labelCitations(studies.citations),
      community: basis.community ? {
        usedFor: basis.community.usedFor || [],
        reportedBenefits: basis.community.reportedBenefits || [],
        benefitsLabel: basis.community.benefitsLabel || null,
      } : null,
      dosing: {
        // Missing dosing renders the exact honest line; otherwise the canonical SELECTED-dose headline.
        label: dNeedsSource ? dosingLib.NEEDS_SOURCE_LINE : (d.sourceLine || (sched && sched.selectedDose) || d.label || null),
        sourceType: dSourceBasis,
        sourceBasis: dSourceBasis,
        confidence: dConfidence,
        sourceNote: dSourceNote,
        needsSource: dNeedsSource,
        selectionStatus: dSelection,             // SELECTED / NEEDS_PRACTITIONER_SELECTION / NEEDS_SOURCE
        isBlend: _isBlend,
        components: (sched && sched.components && sched.components.length) ? sched.components : null,
        componentsHeader: (sched && sched.componentsHeader) || null, // KLOW: 4 parts in the column header only
        fullDose: (sched && sched.fullDose) || null,
        doseTranslation: (sched && sched.doseTranslation) || null,
        // Curated Section-02 week/phase bands (old standard). null ⇒ renderer uses the named-phase fallback.
        // Operator always; CLIENT only once APPROVED (the schedule is the useful payload of an approved doc).
        scheduleGrid: (isClient && !reviewed) ? null : ((sched && sched.scheduleGrid) || null),
        referenceRange: (sched && sched.referenceRange) || null,    // broad range → Section 03
        doseAmount: dDoseAmount,                 // explicit "2–4 mg" / "KLOW 10 IU" | null
        doseAmountLine: dDoseAmountLine,          // amount OR 'NEEDS_SOURCE — no verified dosing amount loaded.'
        noDoseAmount: !dDoseAmount,
        citations: (dCitations || []).slice(0, 3),
        selectedDose: (sched && sched.selectedDose) || null,
        selectedFrequency: (sched && sched.selectedFrequency) || (entry && entry.frequency) || null,
        selectedTiming: (sched && sched.selectedTiming) || (entry && entry.schedule) || null,
        frequency: (sched && sched.selectedFrequency) || (entry && entry.frequency) || null,
        schedule: (sched && sched.selectedTiming) || (entry && entry.schedule) || null,
        cycleWeeks: (entry && entry.cycleWeeks) || null,
        cycleLength: (sched && sched.cycleLength) || null,
        scenario: (sched && sched.scenario) || null,
        ratioNote: (sched && sched.ratioNote) || null,
        // Schedule mechanics: operator always; CLIENT only once APPROVED (an approved client doc is useful).
        titration: (isClient && !reviewed) ? null : ((entry && entry.titration) || null),
        taper: (isClient && !reviewed) ? null : ((entry && entry.taper) || null),
        ceiling: (isClient && !reviewed) ? null : ((sched && sched.ceiling) || (entry && entry.ceiling) || null),
        maintenance: (isClient && !reviewed) ? null : ((sched && sched.maintenance) || null),
        onboarding: (isClient && !reviewed) ? null : ((sched && sched.onboarding) || null),
        offboarding: (isClient && !reviewed) ? null : ((sched && sched.offboarding) || null),
        monitoring: (isClient && !reviewed) ? null : ((sched && sched.monitoring) || null),
        status: (entry && entry.status) || (_isBlend ? 'CURATED' : null),
      },
      contraindicationFlags: arr(it.contraindicationFlags),
      // compliance reason is operator-only and lives in the COMPLIANCE lane, never the evidence lane.
      compliance: (!isClient && it.compliance) ? it.compliance : (it.compliance ? { status: it.compliance.status } : null),
      cautions: isClient ? [] : arr(d.cautions),
    };
    return out;
  });

  const oldStandardDoc = {
    ...draft,
    items: compounds.map((compound) => ({
      ...compound,
      scheduleStatus: compound.dosing && compound.dosing.selectionStatus,
      cycleWeeks: compound.dosing && compound.dosing.cycleWeeks,
      selectedDose: compound.dosing && compound.dosing.selectedDose,
      fullDose: compound.dosing && compound.dosing.fullDose,
      scheduleGrid: compound.dosing && compound.dosing.scheduleGrid,
      selectedFrequency: compound.dosing && compound.dosing.selectedFrequency,
      selectedTiming: compound.dosing && compound.dosing.selectedTiming,
    })),
  };
  const oldStats = docStandard.oldStandardStats(oldStandardDoc);
  const timingRationales = docStandard.timingRationalesFor(compounds);
  const supplySummary = docStandard.supplySummaryFor(compounds);
  const supportiveLifestyle = docStandard.supportiveLifestyleFor({
    ...draft,
    items: compounds,
    title: draft.title,
    goal: draft.goal || draft.goalText,
  });
  const monitoringFramework = docStandard.monitoringFrameworkFor({
    ...draft,
    items: compounds,
    title: draft.title,
    goal: draft.goal || draft.goalText,
  });
  const standardContraindications = docStandard.protocolContraindicationsFor({
    ...draft,
    items: compounds,
    title: draft.title,
    goal: draft.goal || draft.goalText,
  });
  const standardDisclaimer = docStandard.protocolDisclaimer();

  // Stat band — old-standard readiness stats first; derived honestly from real document data.
  const tierMix = {};
  compounds.forEach((c) => { tierMix[c.evidenceLevel] = (tierMix[c.evidenceLevel] || 0) + 1; });
  const stats = [
    { value: compounds.length, label: 'Compounds' },
    { value: oldStats.longestCycleWeeks || '—', label: 'Weeks total', tone: 'slate' },
    { value: oldStats.selectedScheduleItems || '—', label: 'Schedules selected', tone: oldStats.selectedScheduleItems ? 'slate' : 'coral' },
    { value: arr(draft.labsSuggested).length || '—', label: 'Labs flagged', tone: 'coral' },
  ];

  // Cover metadata.
  const meta = [
    { label: 'Prepared for', value: (client && client.name) || draft.forClient || '—' },
    { label: 'Protocol', value: draft.title || draft.goal || 'Peptide protocol' },
    { label: 'Goal', value: draft.goal || '—' },
    { label: 'Compounds', value: compounds.map((c) => c.name).join(' · ') || '—' },
    { label: 'Referral physician', value: DR_LUN.contact ? `${DR_LUN.name} · ${DR_LUN.contact}` : DR_LUN.name },
    { label: 'Source', value: 'Vitalis Research' },
    { label: 'Reference', value: opts.referenceId || refId(draft) },
  ];

  // Overall honest evidence status for the document.
  const statuses = compounds.map((c) => c.evidenceStatus);
  const overallEvidenceStatus = statuses.includes('SOURCE_FOUND') || statuses.includes('REVIEWED')
    ? (reviewed ? 'REVIEWED' : 'SOURCE_FOUND')
    : (statuses.includes('PRACTITIONER_INTERPRETATION') ? 'PRACTITIONER_INTERPRETATION'
      : (statuses.includes('PRECLINICAL_ONLY') ? 'PRECLINICAL_ONLY' : (statuses[0] || 'UNKNOWN')));

  return {
    kind: 'PEPTIDE',
    mode: isClient ? 'client' : 'operator',
    status,
    docClass: 'Peptide Protocol · Research Document',
    title: draft.title || (draft.goal ? `${draft.goal} — peptide protocol` : 'Peptide Protocol'),
    thesis: draft.rationale || null,
    cover: { meta, review: { title: 'For physician review — guide only.', body: REVIEW_BODY } },
    stats,
    sections: {
      stackWhy: {
        compounds,
        intro: draft.rationale || null,
        sequencingNote: supportiveLifestyle && supportiveLifestyle.sequencingNote,
      },
      schedule: {
        compounds,
        timingRationales,
        supplySummary,
      },                         // SelectedScheduleTable consumes real dosing fields
      compoundReference: { compounds, tierLegend: TIER_LEGEND },
      supportiveLifestyle: arr(draft.supportiveLifestyle).length
        ? { title: 'Supportive Lifestyle', framing: null, items: arr(draft.supportiveLifestyle), weeklyTracking: [] }
        : supportiveLifestyle,
      monitoring: {
        title: monitoringFramework.title,
        framing: monitoringFramework.framing,
        text: draft.monitoring || null,
        responsePatterns: monitoringFramework.responsePatterns || [],
        tiers: monitoringFramework.tiers || {},
        checkpoints: monitoringFramework.checkpoints || [],
        warnings: isClient ? [] : arr(draft.warnings),
        labs: arr(draft.labsSuggested),
        unknowns: isClient ? [] : arr(draft.unknowns),
        adaptationSignals: arr(draft.adaptationSignals),       // practitioner-authored; [] → omitted
      },
    },
    oldStandard: {
      sections: docStandard.OLD_STANDARD_SECTIONS,
      sourceAnchors: docStandard.SOURCE_ANCHORS,
      readiness: oldStats,
    },
    contraindications: [...new Set([
      ...compounds.flatMap((c) => c.contraindicationFlags),
      ...arr(standardContraindications.items),
    ])],
    contraindicationFrame: standardContraindications,
    compliance: isClient ? null : (arr(draft.blockedReasons).length ? { blocked: true, reasons: draft.blockedReasons } : null),
    evidence: { tierLegend: TIER_LEGEND, overallStatus: overallEvidenceStatus, lanes: LANES },
    practitionerNote: draft.practitionerNote || null,
    disclaimer: (standardDisclaimer && standardDisclaimer.body) || PEPTIDE_DISCLAIMER,
    provider: { name: DR_LUN.name, role: DR_LUN.role || null, contact: DR_LUN.contact || null },
  };
}

module.exports = {
  LANES, EVIDENCE_TIERS, EVIDENCE_STATUSES, TIER_LEGEND,
  tierForCitation, laneForCitation, labelCitations, evidenceStatusForItem,
  toPeptideDocProps,
};
