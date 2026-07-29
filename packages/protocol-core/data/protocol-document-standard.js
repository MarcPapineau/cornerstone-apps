/**
 * protocol-document-standard.js
 *
 * Read-only-derived old Vitalis protocol document blocks for protocol document
 * parity rebuilds. This module is a CONTENT / PRESENTATION helper only.
 *
 * Dosing, selected schedules, blends, week grids, and source confidence remain
 * owned by ./dosing.js. Callers should pass schedule-shaped items that were
 * resolved by the canonical dosing engine; this file never invents a dose,
 * titration, taper, KLOW component math, or evidence tier.
 */

const SOURCE_ANCHORS = [
  {
    file: '01-CORNERSTONE-RESEARCH-GROUP/eric-protocol/02-eric-protocol-guide.html',
    anchors: [
      'Section 01 · The Stack & Why',
      'Section 02 · The 16-Week Schedule',
      'Timing callouts: Why Friday / Tuesday / daily evening',
      'Pen supply summary',
      'Section 04 · Supportive Lifestyle',
      'Section 05 · Physiological Monitoring',
      'Contraindications + research / physician-review disclaimer',
    ],
  },
  {
    file: '01-CORNERSTONE-RESEARCH-GROUP/kristen-aitchison-full-stack-protocol/02-protocol-guide.html',
    anchors: [
      'The Stack at a Glance',
      'Section 02 · Daily & Weekly Timing Architecture',
      'Section 08 · Safety, Flags & Monitoring',
      'Pre-Protocol Contraindications',
      'Lab Monitoring Cadence',
      'Research / educational footer disclaimer',
    ],
  },
  {
    file: '01-CORNERSTONE-RESEARCH-GROUP/renee-protocol/01-renee-protocol-guide.html',
    anchors: [
      'Section 01 · The Compound & Why',
      'Section 02 · Schedule & Supply',
      'Weekly schedule',
      'Supply planning',
      'Section 04 · Supportive Lifestyle',
      'Section 05 · Physiological Monitoring',
      'Contraindications + research / physician-review disclaimer',
    ],
  },
  {
    file: 'packages/protocol-core/data/dosing.js',
    anchors: [
      'SCHEDULE_STATUSES',
      'selectedScheduleFor',
      'blendScheduleFor',
      'BLEND_SCHEDULES.klow selected schedule',
    ],
  },
];

const OLD_STANDARD_SECTIONS = [
  { id: 'cover', label: 'Cover', role: 'Prepared-for metadata, reference id, physician-review frame.' },
  { id: 'stack', label: 'Section 01 · Stack & Why', role: 'Selected stack logic and plain-language rationale.' },
  { id: 'schedule', label: 'Section 02 · Schedule & Supply', role: 'Selected schedule grid, timing callouts, and supply summary.' },
  { id: 'reference', label: 'Section 03 · Compound Reference', role: 'Compound context, route/form, mechanism, evidence caveats.' },
  { id: 'lifestyle', label: 'Section 04 · Supportive Lifestyle', role: 'Non-prescriptive lifestyle support matched to scenario.' },
  { id: 'monitoring', label: 'Section 05 · Physiological Monitoring', role: 'Expected adaptation, meaningful drift, red flags, checkpoints.' },
  { id: 'safety', label: 'Contraindications & Disclaimer', role: 'Physician-review, contraindication, and research-only framing.' },
];

const GENERIC_TIMING_RATIONALE =
  'Timing should preserve the selected schedule from the practitioner-reviewed protocol and make the cadence easy to follow. Keep the same day/time pattern, rotate sites when applicable, and use any timing changes as a practitioner review item.';

const RESEARCH_FRAME =
  'Research and educational guide only. Not medical advice, not a prescription, not a diagnosis, and not a doctor-patient relationship.';

function normalizeText(value) {
  return String(value || '').trim();
}

function lowerText(value) {
  return normalizeText(value).toLowerCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function itemLabel(item = {}) {
  return normalizeText(item.label || item.productName || item.name || item.compound || item.compoundId || 'Protocol item');
}

function itemSearchText(item = {}) {
  return lowerText([
    itemLabel(item),
    item.evidenceCompoundId,
    item.compoundId,
    item.compound,
    item.blendId,
    item.selectedTiming,
    item.selectedFrequency,
    item.route,
    item.form,
  ].filter(Boolean).join(' '));
}

function hasAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function scenarioTagsFor(doc = {}) {
  const haystack = lowerText([
    doc.title,
    doc.scenario,
    doc.goal,
    doc.goals,
    doc.focus,
    doc.rationale,
    doc.notes,
    ...asArray(doc.goals),
    ...asArray(doc.tags),
  ].filter(Boolean).join(' '));

  return {
    metabolic: hasAny(haystack, ['fat', 'weight', 'metabolic', 'glucose', 'insulin', 'body composition', 'appetite']),
    recovery: hasAny(haystack, ['recovery', 'repair', 'tendon', 'injury', 'joint', 'connective', 'inflammation']),
    sleep: hasAny(haystack, ['sleep', 'circadian', 'insomnia', 'recovery quality', 'stress']),
    mitochondrial: hasAny(haystack, ['mitochond', 'energy', 'longevity', 'mots', 'ss-31', 'ss31', 'cardiogen']),
  };
}

function oldStandardStats(doc = {}) {
  const items = asArray(doc.items);
  const scheduleItems = items.filter((item) => item && item.scheduleStatus === 'SELECTED');
  const needsPractitionerSelection = items.filter((item) => item && item.scheduleStatus === 'NEEDS_PRACTITIONER_SELECTION');
  const needsSource = items.filter((item) => item && item.scheduleStatus === 'NEEDS_SOURCE');
  const weekValues = items
    .map((item) => {
      if (!item) return null;
      const grid = Array.isArray(item.scheduleGrid) ? item.scheduleGrid : [];
      const activeEnds = grid
        .filter((band) => band && !/^off$/i.test(String(band.dose || '').trim()))
        .map((band) => Array.isArray(band.weeks) ? Number(band.weeks[1]) : null)
        .filter((value) => Number.isFinite(value) && value > 0);
      if (activeEnds.length) return Math.max(...activeEnds);
      return item.cycleWeeks || item.weeks || item.durationWeeks;
    })
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  return {
    sections: OLD_STANDARD_SECTIONS.length,
    items: items.length,
    selectedScheduleItems: scheduleItems.length,
    needsPractitionerSelection: needsPractitionerSelection.length,
    needsSource: needsSource.length,
    hasSelectedSchedule: scheduleItems.length > 0,
    longestCycleWeeks: weekValues.length ? Math.max(...weekValues) : null,
    requiredBlocks: OLD_STANDARD_SECTIONS.map((section) => section.id),
    dosingAuthority: 'packages/protocol-core/data/dosing.js',
    note: 'Stats are document-readiness counters only; they do not create or validate dosing.',
  };
}

function timingRationaleForItem(item = {}) {
  const text = itemSearchText(item);
  const label = itemLabel(item);
  const selectedTiming = normalizeText(item.selectedTiming || item.timing || item.schedule);
  const selectedFrequency = normalizeText(item.selectedFrequency || item.frequency);

  let rationale = GENERIC_TIMING_RATIONALE;

  if (hasAny(text, ['reta', 'retatrutide', 'glp-1', 'gip'])) {
    rationale = 'Old Vitalis metabolic protocols separated the weekly GLP-1 / GIP-class anchor from the rest of the stack so early appetite, GI, hydration, and energy signals are easier to observe and review.';
  } else if (hasAny(text, ['mots', 'mots-c', 'ss-31', 'ss31', 'elamipretide', 'cardiogen', 'mitochond'])) {
    rationale = 'Old Vitalis mitochondrial protocols kept these items on a consistent cadence and separated anchors where useful, so energy, sleep, and adaptation signals could be tracked without confusing the weekly rhythm.';
  } else if (hasAny(text, ['klow', 'bpc', 'tb-500', 'tb500', 'kpv', 'ghk', 'tendon', 'repair'])) {
    rationale = 'Old Vitalis repair protocols emphasized a simple repeatable cadence, injection-site rotation, and a clear review window because connective-tissue response is tracked over weeks, not single days.';
  } else if (hasAny(text, ['dsip', 'selank', 'epitalon', 'sleep', 'circadian'])) {
    rationale = 'Old Vitalis sleep and circadian protocols grouped bedtime-oriented items around the evening routine while keeping sleep quality, next-day energy, and timing sensitivity visible for review.';
  } else if (hasAny(text, ['hgh', 'aod', 'cjc', 'ipamorelin', 'tesamorelin', 'sermorelin'])) {
    rationale = 'Old Vitalis growth-axis protocols treated fasted windows and routine consistency as operational details to be reviewed with the practitioner, not as stand-alone medical instructions.';
  }

  return {
    label,
    selectedTiming: selectedTiming || null,
    selectedFrequency: selectedFrequency || null,
    rationale,
    source: 'old Vitalis timing-callout pattern',
  };
}

function timingRationalesFor(items = []) {
  const rows = asArray(items).map(timingRationaleForItem);
  return rows.length ? rows : [{
    label: 'Protocol timing',
    selectedTiming: null,
    selectedFrequency: null,
    rationale: GENERIC_TIMING_RATIONALE,
    source: 'old Vitalis timing-callout pattern',
  }];
}

function supplySummaryFor(items = []) {
  const rows = asArray(items).map((item) => {
    const label = itemLabel(item);
    return {
      label,
      form: normalizeText(item.form || item.format || item.presentation) || null,
      route: normalizeText(item.route) || null,
      selectedSchedule: normalizeText(item.selectedDose || item.fullDose || item.selectedFrequency || item.selectedTiming) || null,
      supply: normalizeText(item.supply || item.supplySummary || item.vialCoverage || item.penCoverage || item.coverage) || null,
      notes: normalizeText(item.supplyNote || item.sourceNote || item.note) || null,
      source: 'caller-provided item data; no supply math computed here',
    };
  });

  return {
    title: 'Supply Summary',
    framing: 'Supply planning should mirror the selected protocol schedule and product format supplied by the canonical data layer. This helper does not calculate dose, vial count, pen count, or week coverage.',
    rows,
    emptyState: rows.length ? null : 'No protocol items supplied. Render the old-standard supply block only after selected items are available.',
  };
}

function supportiveLifestyleFor(doc = {}) {
  const tags = scenarioTagsFor(doc);
  const foundations = [
    'Keep the lifestyle layer supportive and observational: sleep, hydration, protein adequacy, movement tolerance, and weekly symptom notes.',
    'Use the practitioner-reviewed protocol as the source of truth; lifestyle notes should not modify dosing or cadence.',
    'Track simple weekly markers so the practitioner can compare trend, tolerability, and adherence at review points.',
  ];

  const focus = [];
  if (tags.metabolic) {
    focus.push('For metabolic / fat-loss scenarios: emphasize protein adequacy, resistance training, walking or Zone 2 activity, hydration, fiber, and lower-fat meals around any practitioner-selected appetite/GI-sensitive anchor.');
  }
  if (tags.recovery) {
    focus.push('For recovery / tissue scenarios: emphasize graded loading, temporary reduction of aggravating activity, sleep, hydration, and clinician-guided rehab or imaging when symptoms fail to improve.');
  }
  if (tags.sleep) {
    focus.push('For sleep / stress scenarios: emphasize a consistent bedtime window, dark-room sleep hygiene, stimulant timing, alcohol reduction, and next-day energy tracking.');
  }
  if (tags.mitochondrial) {
    focus.push('For mitochondrial / energy scenarios: emphasize consistent aerobic stimulus, resistance training, sleep depth, hydration, and energy trend tracking rather than single-day interpretation.');
  }

  return {
    title: 'Supportive Lifestyle',
    framing: 'Old Vitalis protocols used lifestyle as a support layer, not as a substitute for medical review or a dosing instruction.',
    items: foundations.concat(focus.length ? focus : ['Use the generic old-standard support layer when the scenario is unclear: sleep, hydration, protein adequacy, gentle activity, and weekly notes for practitioner review.']),
    weeklyTracking: [
      'Body weight or relevant symptom score, same day/time where applicable.',
      'Energy, sleep quality, appetite/GI status, pain or recovery status, and adherence notes.',
      'Any change that persists beyond the early adaptation window should be brought to the practitioner review checkpoint.',
    ],
  };
}

function monitoringFrameworkFor(doc = {}) {
  const tags = scenarioTagsFor(doc);
  const expected = [
    { title: 'Mild injection-site response', body: 'Small redness, faint bruising, or temporary warmth can be observed and documented. Rotate sites and flag persistent patterns for review.' },
    { title: 'Early adaptation signal', body: 'Mild first-window changes in energy, appetite, GI status, sleep, or local symptoms should be tracked as trends, not interpreted from a single day.' },
  ];
  const amber = [
    { title: 'Persistent drift', body: 'Symptoms or metrics that persist past the expected adaptation window should be brought to the practitioner at the next checkpoint.' },
    { title: 'Unexpected worsening', body: 'A meaningful worsening of the target symptom, sleep, mood, HR/BP trend, or GI tolerance should trigger a pause-and-review discussion.' },
  ];
  const red = [
    { title: 'Severe allergic or infection-pattern reaction', body: 'Hives, facial/lip/tongue swelling, breathing difficulty, fever, spreading redness, drainage, or significant injection-site pain requires immediate discontinuation and same-day medical evaluation.' },
    { title: 'Severe systemic symptoms', body: 'Chest pain, severe abdominal pain, severe headache, visual change, neurologic symptoms, or inability to keep fluids down should be treated as urgent and reviewed the same day.' },
  ];

  if (tags.metabolic) {
    expected.push({ title: 'Metabolic adaptation tracking', body: 'Track appetite, hydration, bowel pattern, energy, resting HR/BP trend, and low-food-intake signals for practitioner review.' });
    amber.push({ title: 'Sustained HR/BP or GI drift', body: 'Sustained HR/BP change or GI symptoms that do not improve should be reviewed before any schedule change.' });
  }
  if (tags.recovery) {
    expected.push({ title: 'Repair-response tracking', body: 'Track pain, function, loading tolerance, local irritation, and whether symptoms are improving, stable, or worsening.' });
    amber.push({ title: 'No meaningful improvement by midpoint', body: 'If symptoms do not meaningfully improve by the midpoint review, consider practitioner reassessment, rehab review, or imaging as appropriate.' });
    red.push({ title: 'Acute injury pattern', body: 'A sudden pop, sharp tear, deformity, or inability to bear weight is an urgent clinical event and not a protocol-adjustment issue.' });
  }
  if (tags.sleep) {
    expected.push({ title: 'Sleep architecture notes', body: 'Track sleep quality, sleep onset, night waking, and next-day energy so timing sensitivity can be reviewed.' });
    amber.push({ title: 'Persistent mood or sleep change', body: 'New persistent low mood, sleep disruption, or next-day impairment should be brought to the practitioner review.' });
  }

  return {
    title: 'Physiological Monitoring',
    framing: 'Old Vitalis monitoring distinguishes expected adaptation, meaningful drift, and stop-now red flags. It is an observation framework, not diagnosis.',
    responsePatterns: [
      { label: 'Amplify-existing', body: 'A protocol may surface a pre-existing borderline issue. Track it and bring it to the practitioner review point.' },
      { label: 'Reveal-unrecognized', body: 'A new signal may indicate something previously unrecognized. Pause for workup when clinically appropriate.' },
      { label: 'Dose-too-aggressive / timing-sensitive', body: 'A protocol-paced response may require practitioner-guided timing or schedule review.' },
    ],
    tiers: {
      expected,
      meaningfulDrift: amber,
      stopNow: red,
    },
    checkpoints: [
      { label: 'Week 2', body: 'Technique, tolerance, and early adaptation review.' },
      { label: 'Week 4', body: 'First meaningful adherence and symptom trend checkpoint.' },
      { label: 'Midpoint', body: 'Review labs or objective markers where the practitioner requested them.' },
      { label: 'End of cycle', body: 'Review outcome, safety, and whether to pause, extend, or redesign under practitioner oversight.' },
    ],
  };
}

function protocolContraindicationsFor(doc = {}) {
  const tags = scenarioTagsFor(doc);
  const items = [
    'Pregnancy or lactation.',
    'Active malignancy or recent cancer treatment unless cleared by the treating clinician.',
    'Severe liver or kidney disease.',
    'Known allergy or sensitivity to any protocol component, excipient, or injection material.',
    'Any uncontrolled or unexplained symptoms that have not been reviewed by a qualified clinician.',
  ];

  if (tags.metabolic) {
    items.push('History of pancreatitis, gallbladder disease, severe gastroparesis, medullary thyroid carcinoma, MEN2, or diabetes medication changes should be reviewed before any GLP-1 / GIP-class resource is considered.');
  }
  if (tags.recovery) {
    items.push('Known copper sensitivity, Wilson disease, active infection, suspected acute tendon rupture, or unworked-up structural injury should be reviewed before any repair-focused resource is considered.');
  }
  if (tags.sleep) {
    items.push('Existing sedative, psychiatric, neurologic, or sleep-medication concerns should be coordinated with the prescribing clinician.');
  }
  if (tags.mitochondrial) {
    items.push('Known cardiac rhythm issues, unexplained chest symptoms, or complex mitochondrial / metabolic disease should be reviewed by the supervising clinician.');
  }

  return {
    title: 'Contraindications — Review Before Use',
    framing: 'Conservative old-standard screen. This list is not exhaustive and does not clear anyone for use.',
    items,
    action: 'If any item applies, stop the protocol workflow and route to practitioner review before release.',
  };
}

function protocolDisclaimer() {
  return {
    title: 'Strictly for Research and Educational Purposes',
    body: RESEARCH_FRAME + ' The protocol document is intended for review and authorization by a licensed medical professional or other qualified practitioner. Peptide compounds may be unapproved for the indications discussed and must be sourced only through reputable channels verified for identity and purity where legally permitted. The recipient and supervising practitioner are responsible for confirming clinical appropriateness, jurisdictional status, material integrity, and qualified oversight. Vitalis Research assumes no liability for outcomes arising from use outside properly supervised clinical contexts.',
  };
}

module.exports = {
  SOURCE_ANCHORS,
  OLD_STANDARD_SECTIONS,
  oldStandardStats,
  timingRationalesFor,
  supplySummaryFor,
  supportiveLifestyleFor,
  monitoringFrameworkFor,
  protocolContraindicationsFor,
  protocolDisclaimer,
};
