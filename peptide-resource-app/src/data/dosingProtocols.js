// ============================================================
// DOSING PROTOCOLS — Added April 2026
// Conservative / Moderate / Aggressive tiers + solvent data
// ============================================================

const D = 'This reflects dosing ranges observed in published research and community protocols. This is NOT medical advice or a dosing suggestion. Consult a licensed physician.';

export const DOSING_PROTOCOLS = {
  bpc157: {
    dosingProtocol: {
      conservative: { dose: '250mcg', frequency: 'Once daily', weeklyTotal: '1,750mcg' },
      moderate:     { dose: '500mcg', frequency: 'Once daily (or split 250mcg AM/PM)', weeklyTotal: '3,500mcg' },
      aggressive:   { dose: '750mcg', frequency: 'Split AM/PM doses', weeklyTotal: '5,250mcg' },
      timing: 'Morning fasted, or near time of training. Inject near injury site for targeted local effect; abdomen for systemic.',
      injectionSite: 'SubQ near injury site (local) or SubQ abdomen (systemic)',
      disclaimer: D,
    },
  },
  reta: {
    dosingProtocol: {
      conservative: { dose: '0.5mg', frequency: 'Once weekly', weeklyTotal: '0.5mg' },
      moderate:     { dose: '2mg', frequency: 'Once weekly (titrated over 4–6 weeks)', weeklyTotal: '2mg' },
      aggressive:   { dose: '4mg', frequency: 'Once weekly (titrate slowly — do not jump doses)', weeklyTotal: '4mg' },
      timing: 'Same day each week. Evening injection before sleep reduces nausea during titration. Titrate slowly: 0.5 → 1 → 2 → 4mg over 8–12 weeks.',
      injectionSite: 'SubQ abdomen, thigh, or upper arm — rotate sites each injection',
      disclaimer: D,
    },
  },
  tb500: {
    dosingProtocol: {
      conservative: { dose: '2mg', frequency: 'Twice weekly (loading 4–6 wks), once weekly (maintenance)', weeklyTotal: '4mg loading / 2mg maintenance' },
      moderate:     { dose: '2.5mg', frequency: 'Twice weekly (loading), once weekly (maintenance)', weeklyTotal: '5mg loading / 2.5mg maintenance' },
      aggressive:   { dose: '2.5mg', frequency: 'Three times weekly (loading phase only)', weeklyTotal: '7.5mg' },
      timing: 'Any time of day. Consistent schedule — same days each week. Do not skip the loading phase; it significantly impacts results.',
      injectionSite: 'SubQ abdomen or deltoid — systemic distribution regardless of site',
      disclaimer: D,
    },
  },
  nad: {
    dosingProtocol: {
      conservative: { dose: '50–100mg', frequency: 'Three times weekly (beginner adaptation)', weeklyTotal: '150–300mg' },
      moderate:     { dose: '250mg', frequency: '3–5x weekly', weeklyTotal: '750–1,250mg' },
      aggressive:   { dose: '500mg', frequency: '5x weekly', weeklyTotal: '2,500mg' },
      timing: 'Morning or early afternoon only — NAD+ is energizing and disrupts sleep if taken late. Inject VERY slowly over 3–5 full minutes. Start at 25–50mg for sessions 1–3, then build up. Flushing is expected and normal.',
      injectionSite: 'SubQ abdomen — inject extremely slowly to minimize flushing and nausea',
      disclaimer: D,
    },
  },
  ipamorelin: {
    dosingProtocol: {
      conservative: { dose: '100mcg', frequency: 'Once daily (pre-bed, fasted)', weeklyTotal: '700mcg' },
      moderate:     { dose: '200mcg', frequency: 'Twice daily (pre-bed + morning fasted)', weeklyTotal: '2,800mcg' },
      aggressive:   { dose: '300mcg', frequency: 'Three times daily (pre-bed, morning, post-workout — all fasted)', weeklyTotal: '6,300mcg' },
      timing: 'Pre-bed is primary (amplifies overnight GH pulse). Morning fasted. Post-workout fasted. Minimum 2 hours after last meal; wait 30 min before next meal after injection.',
      injectionSite: 'SubQ abdomen — fasted state only for maximum GH response',
      disclaimer: D,
    },
  },
  cjc: {
    dosingProtocol: {
      conservative: { dose: '200mcg', frequency: 'Once weekly', weeklyTotal: '200mcg' },
      moderate:     { dose: '500mcg', frequency: 'Once weekly', weeklyTotal: '500mcg' },
      aggressive:   { dose: '1mg', frequency: 'Once weekly', weeklyTotal: '1mg' },
      timing: 'Before bed, fasted (3+ hours after last meal). 8-day half-life — doses accumulate week over week. Start at 100–200mcg and titrate slowly. Do not miss a dose once in a cycle.',
      injectionSite: 'SubQ abdomen — rotate sites',
      disclaimer: D,
    },
  },
  ghkcu: {
    dosingProtocol: {
      conservative: { dose: '500mcg', frequency: 'Three times weekly', weeklyTotal: '1,500mcg' },
      moderate:     { dose: '1mg', frequency: 'Daily', weeklyTotal: '7mg' },
      aggressive:   { dose: '2mg', frequency: 'Daily', weeklyTotal: '14mg' },
      timing: 'Morning or evening — any time. Inject VERY slowly (30–60 seconds) to minimize copper-related burning. Can be combined with topical GHK-Cu for skin applications.',
      injectionSite: 'SubQ near target tissue (scalp for hair, face for skin) or SubQ abdomen (systemic)',
      disclaimer: D,
    },
  },
  sermorelin: {
    dosingProtocol: {
      conservative: { dose: '100–200mcg', frequency: 'Once daily before bed', weeklyTotal: '700–1,400mcg' },
      moderate:     { dose: '300mcg', frequency: 'Once daily before bed', weeklyTotal: '2,100mcg' },
      aggressive:   { dose: '500mcg', frequency: 'Once daily before bed', weeklyTotal: '3,500mcg' },
      timing: 'Before bed ONLY — 30–60 min after last meal. Amplifies natural overnight GH secretion. Fasted state maximizes pituitary response. Drowsiness within 30–60 min is expected.',
      injectionSite: 'SubQ abdomen',
      disclaimer: D,
    },
  },
  aod9604: {
    dosingProtocol: {
      conservative: { dose: '300mcg', frequency: 'Once daily (morning fasted)', weeklyTotal: '2,100mcg' },
      moderate:     { dose: '500mcg', frequency: 'Once daily (morning fasted)', weeklyTotal: '3,500mcg' },
      aggressive:   { dose: '600mcg', frequency: 'Once daily (morning fasted)', weeklyTotal: '4,200mcg' },
      timing: 'Morning fasted — minimum 2 hours before first meal. Fat oxidation signal is maximized in a low-insulin, fasted state. Wait 30–45 min before eating post-injection.',
      injectionSite: 'SubQ abdomen — sterile water or saline ONLY (see BAC water warning)',
      disclaimer: D,
    },
  },
  ta1: {
    dosingProtocol: {
      conservative: { dose: '1mg', frequency: 'Twice weekly', weeklyTotal: '2mg' },
      moderate:     { dose: '1.5mg', frequency: 'Twice weekly (loading 6–8 wks), then 1–2x/week (maintenance)', weeklyTotal: '3mg loading / 1.5–3mg maintenance' },
      aggressive:   { dose: '1.5mg', frequency: 'Three times weekly (loading phase)', weeklyTotal: '4.5mg' },
      timing: 'Any time of day. Loading phase 2–3x/week for 6–8 weeks, then reduce to maintenance. Commonly used as 2x/week for 4–6 months in chronic immune protocols.',
      injectionSite: 'SubQ abdomen or deltoid',
      disclaimer: D,
    },
  },
  kpv: {
    dosingProtocol: {
      conservative: { dose: '100mcg', frequency: 'Once daily', weeklyTotal: '700mcg' },
      moderate:     { dose: '250mcg', frequency: 'Twice daily', weeklyTotal: '3,500mcg' },
      aggressive:   { dose: '500mcg', frequency: 'Twice daily', weeklyTotal: '7,000mcg' },
      timing: 'Before meals for gut-specific effects (30 min pre-meal). Any time for systemic anti-inflammatory use. Can be taken orally (dissolved in water) for gut-localized effects.',
      injectionSite: 'SubQ abdomen (systemic) or oral route (gut-specific — dissolve in water)',
      disclaimer: D,
    },
  },
  semax: {
    dosingProtocol: {
      conservative: { dose: '100mcg', frequency: 'Once daily intranasal (morning)', weeklyTotal: '700mcg' },
      moderate:     { dose: '300mcg', frequency: 'Twice daily intranasal (morning + midday)', weeklyTotal: '4,200mcg' },
      aggressive:   { dose: '600mcg', frequency: 'Twice daily intranasal', weeklyTotal: '8,400mcg' },
      timing: 'Morning (primary dose) and midday (second dose if 2x/day). Avoid afternoon/evening — stimulating. Cycle 2 weeks on, 1 week off to maintain receptor sensitivity.',
      injectionSite: 'Intranasal — 2 drops per nostril (preferred for CNS effects). SubQ injection for systemic use.',
      disclaimer: D,
    },
  },
  selank: {
    dosingProtocol: {
      conservative: { dose: '250mcg', frequency: 'Once daily', weeklyTotal: '1,750mcg' },
      moderate:     { dose: '250mcg', frequency: 'Twice daily (morning + afternoon)', weeklyTotal: '3,500mcg' },
      aggressive:   { dose: '500mcg', frequency: 'Twice daily', weeklyTotal: '7,000mcg' },
      timing: 'Morning and/or afternoon. Avoid late evening if using SubQ — may cause initial mild drowsiness. Intranasal onset faster (20–30 min). Cycle 2–4 weeks on, 1–2 weeks off.',
      injectionSite: 'Intranasal (preferred for anxiolytic effect) or SubQ abdomen',
      disclaimer: D,
    },
  },
  tesamorelin: {
    dosingProtocol: {
      conservative: { dose: '1mg', frequency: 'Once daily before bed', weeklyTotal: '7mg' },
      moderate:     { dose: '2mg', frequency: 'Once daily before bed (FDA-approved dose)', weeklyTotal: '14mg' },
      aggressive:   { dose: '2mg', frequency: 'Once daily — maximum (do not exceed FDA label)', weeklyTotal: '14mg' },
      timing: 'Before bed, fasted (3+ hours after last meal). Consistent daily injection at same time. Rotate injection sites daily to reduce lipohypertrophy. Minimum 12-week protocol to assess visceral fat response.',
      injectionSite: 'SubQ abdomen — rotate sites (left/right upper/lower quadrants)',
      disclaimer: D,
    },
  },
  slupppp332: {
    dosingProtocol: {
      conservative: { dose: '10mg', frequency: 'Once daily (oral)', weeklyTotal: '70mg' },
      moderate:     { dose: '15mg', frequency: 'Once daily (oral)', weeklyTotal: '105mg' },
      aggressive:   { dose: '20mg', frequency: 'Once daily (oral)', weeklyTotal: '140mg' },
      timing: 'Morning — exercise-mimetic activation is most relevant during waking active hours. With or without food. Human data limited; cycle 4–8 weeks with equal time off.',
      injectionSite: 'Oral capsule — no injection required',
      disclaimer: D,
    },
  },
  amino1mq: {
    dosingProtocol: {
      conservative: { dose: '50mg', frequency: 'Once daily (oral)', weeklyTotal: '350mg' },
      moderate:     { dose: '50mg', frequency: 'Twice daily (oral, with food)', weeklyTotal: '700mg' },
      aggressive:   { dose: '100mg', frequency: 'Twice daily (oral, with food)', weeklyTotal: '1,400mg' },
      timing: 'With food to reduce GI discomfort. Stack with NAD+ for synergistic adipocyte NAD+ pathway restoration. Cycle 8–16 weeks on, 4–8 weeks off.',
      injectionSite: 'Oral capsule — no injection required',
      disclaimer: D,
    },
  },
  epithalon: {
    dosingProtocol: {
      conservative: { dose: '5mg/day × 10 days', frequency: 'Once daily during cycle (1–2 cycles/year)', weeklyTotal: '35mg during cycle' },
      moderate:     { dose: '5–10mg/day × 14 days', frequency: 'Once daily during cycle', weeklyTotal: '35–70mg during cycle' },
      aggressive:   { dose: '10mg/day × 20 days', frequency: 'Once daily during cycle (up to 2 cycles/year)', weeklyTotal: '70mg during cycle' },
      timing: 'Any time of day — evening preferred by some for sleep/melatonin benefits. Complete the full cycle without interruption. Allow 6+ months between cycles. Commonly combined with Thymalin in same cycle.',
      injectionSite: 'SubQ abdomen — rotate sites daily during the cycle',
      disclaimer: D,
    },
  },
  motsc: {
    dosingProtocol: {
      conservative: { dose: '2.5mg', frequency: 'Twice weekly', weeklyTotal: '5mg' },
      moderate:     { dose: '5mg', frequency: 'Three times weekly', weeklyTotal: '15mg' },
      aggressive:   { dose: '5mg', frequency: 'Five times weekly (weekdays)', weeklyTotal: '25mg' },
      timing: 'Morning — aligns with mitochondrial metabolic activation and exercise-mimetic mechanism. Pre-workout timing synergistic. Stack with NAD+ and SS-31 for comprehensive mitochondrial longevity protocol.',
      injectionSite: 'SubQ abdomen',
      disclaimer: D,
    },
  },
  hexarelin: {
    dosingProtocol: {
      conservative: { dose: '100mcg', frequency: 'Once daily (fasted)', weeklyTotal: '700mcg' },
      moderate:     { dose: '100mcg', frequency: 'Twice daily (fasted, pre-workout + pre-bed)', weeklyTotal: '1,400mcg' },
      aggressive:   { dose: '200mcg', frequency: 'Twice daily (fasted) — 4–6 week cycles only', weeklyTotal: '2,800mcg' },
      timing: 'Fasted — 2+ hours after last meal. Wait 30–45 min before eating post-injection. Pre-workout or pre-bed. 4–8 week cycles maximum due to receptor desensitization; equal time off between cycles.',
      injectionSite: 'SubQ abdomen — fasted state essential',
      disclaimer: D,
    },
  },
  dihexa: {
    dosingProtocol: {
      conservative: { dose: '5mg oral / 1mg SubQ', frequency: 'Three times weekly', weeklyTotal: '15mg oral / 3mg SubQ' },
      moderate:     { dose: '10mg oral / 2mg SubQ', frequency: 'Daily', weeklyTotal: '70mg oral / 14mg SubQ' },
      aggressive:   { dose: '30mg oral / 3mg SubQ', frequency: 'Daily — 4–8 week cycles with significant rest', weeklyTotal: '210mg oral / 21mg SubQ' },
      timing: 'Morning. NOTE: Primary efficacy study retracted 2025 — evidence is limited and contested. Start at absolute minimum. Avoid if any cancer history (MET pathway activation). Cycle with significant breaks.',
      injectionSite: 'Oral (dissolved in minimal sterile water) or SubQ abdomen (very small volumes)',
      disclaimer: D,
    },
  },
  ss31: {
    dosingProtocol: {
      conservative: { dose: '5mg', frequency: 'Once daily', weeklyTotal: '35mg' },
      moderate:     { dose: '10mg', frequency: 'Once daily', weeklyTotal: '70mg' },
      aggressive:   { dose: '10mg', frequency: 'Twice daily', weeklyTotal: '140mg' },
      timing: 'Morning preferred — aligns with peak mitochondrial energy demands. With or without food. Stack with MOTS-c and NAD+ for comprehensive mitochondrial longevity protocol.',
      injectionSite: 'SubQ abdomen',
      disclaimer: D,
    },
  },
  dsip: {
    dosingProtocol: {
      conservative: { dose: '100mcg', frequency: 'Three times weekly (pre-bed)', weeklyTotal: '300mcg' },
      moderate:     { dose: '200mcg', frequency: 'Four to five times weekly (pre-bed)', weeklyTotal: '800–1,000mcg' },
      aggressive:   { dose: '300mcg', frequency: 'Five times weekly (pre-bed)', weeklyTotal: '1,500mcg' },
      timing: '20–30 minutes before bedtime only. Not a sedative — works on sleep architecture, not sedation. Pairs well with Pinealon (pineal bioregulation) and Selank (anxiety reduction) for comprehensive sleep optimization.',
      injectionSite: 'SubQ abdomen — inject 20–30 min before sleep',
      disclaimer: D,
    },
  },
  p21: {
    dosingProtocol: {
      conservative: { dose: '5mg', frequency: 'Once daily (oral or SubQ)', weeklyTotal: '35mg' },
      moderate:     { dose: '10mg', frequency: 'Once daily', weeklyTotal: '70mg' },
      aggressive:   { dose: '15mg', frequency: 'Once daily', weeklyTotal: '105mg' },
      timing: 'Morning. Run 30–60 day cycles. Evidence is early-stage (LOW confidence — limited human data). Start at 5mg and assess cognitive response carefully before increasing dose.',
      injectionSite: 'SubQ abdomen or oral (dissolve in sterile water)',
      disclaimer: D,
    },
  },
  pinealon: {
    dosingProtocol: {
      conservative: { dose: '5mg/day × 10 days', frequency: 'Once daily (evening, 1–2 cycles/year)', weeklyTotal: '35mg during cycle' },
      moderate:     { dose: '5–10mg/day × 20 days', frequency: 'Once daily (evening)', weeklyTotal: '35–70mg during cycle' },
      aggressive:   { dose: '10mg/day × 30 days', frequency: 'Once daily (evening, up to 2 cycles/year)', weeklyTotal: '70mg during cycle' },
      timing: 'Evening preferred — pineal gland activation is highest at night. Pairs with DSIP (sleep architecture) and Epithalon (longevity). Run complete cycle without skipping doses.',
      injectionSite: 'SubQ abdomen — rotate sites during cycle',
      disclaimer: D,
    },
  },
  pt141: {
    dosingProtocol: {
      conservative: { dose: '0.5mg', frequency: 'As needed — max once per 24 hours', weeklyTotal: 'Variable (as-needed use)' },
      moderate:     { dose: '1mg', frequency: 'As needed — max once per 24 hours', weeklyTotal: 'Variable (as-needed use)' },
      aggressive:   { dose: '2mg', frequency: 'As needed — not for daily use', weeklyTotal: 'Variable (as-needed use)' },
      timing: '45–60 minutes before desired effect. Take with a small amount of food at 1mg+ to reduce nausea. Effects last 6–12 hours. This is an as-needed compound, not a daily protocol.',
      injectionSite: 'SubQ abdomen — start at 0.5mg to establish nausea tolerance',
      disclaimer: D,
    },
  },
  melanotan2: {
    dosingProtocol: {
      conservative: { dose: '0.25mg/day (loading 4 wks)', frequency: 'Daily during loading; EOD maintenance', weeklyTotal: '1.75mg loading / 0.875mg maintenance' },
      moderate:     { dose: '0.5mg/day (loading 4 wks)', frequency: 'Daily during loading; 3x/week maintenance', weeklyTotal: '3.5mg loading / 1.5mg maintenance' },
      aggressive:   { dose: '1mg/day (max 4 wks)', frequency: 'Daily loading; 3x/week maintenance', weeklyTotal: '7mg loading / 3mg maintenance' },
      timing: 'Evening during loading phase — inject before sleep to reduce nausea and flushing discomfort. UV exposure (even brief sunlight) dramatically accelerates tanning response. Monitor all moles monthly.',
      injectionSite: 'SubQ abdomen — start at 0.25mg for first 5+ doses',
      disclaimer: D,
    },
  },
  kisspeptin: {
    dosingProtocol: {
      conservative: { dose: '50mcg', frequency: 'Twice weekly — NEVER consecutive days', weeklyTotal: '100mcg' },
      moderate:     { dose: '100mcg', frequency: 'Twice weekly — NEVER consecutive days', weeklyTotal: '200mcg' },
      aggressive:   { dose: '100mcg', frequency: 'Three times weekly (M/W/F pattern)', weeklyTotal: '300mcg' },
      timing: 'CRITICAL: Never inject on consecutive days. Continuous daily kisspeptin suppresses the HPG axis (the opposite of the goal). Always allow 48-hour minimum between doses. Rest days are not optional — they are essential.',
      injectionSite: 'SubQ abdomen — pulsatile schedule required',
      disclaimer: D,
    },
  },
  ll37: {
    dosingProtocol: {
      conservative: { dose: '100mcg', frequency: 'Three times weekly', weeklyTotal: '300mcg' },
      moderate:     { dose: '250mcg', frequency: 'Three to four times weekly', weeklyTotal: '750–1,000mcg' },
      aggressive:   { dose: '500mcg', frequency: 'Five times weekly', weeklyTotal: '2,500mcg' },
      timing: 'Any time of day. Consistent timing preferred. Can be stacked with Thymosin Alpha-1 for comprehensive innate + adaptive immune support.',
      injectionSite: 'SubQ abdomen or SubQ near target tissue (wound healing protocols)',
      disclaimer: D,
    },
  },
  igf1lr3: {
    dosingProtocol: {
      conservative: { dose: '20mcg', frequency: 'Once daily, 5x/week (post-workout or AM fasted)', weeklyTotal: '100mcg' },
      moderate:     { dose: '30mcg', frequency: 'Once daily, 5x/week', weeklyTotal: '150mcg' },
      aggressive:   { dose: '50mcg', frequency: 'Once daily, 5x/week — 4–6 week cycles maximum', weeklyTotal: '250mcg' },
      timing: 'Post-workout (most common). Or upon waking fasted. Have carbohydrates ready — hypoglycemia risk. 4–6 week cycles maximum due to IGF-1R desensitization. Use within 14 days of reconstitution.',
      injectionSite: 'SubQ abdomen (systemic) or IM into target muscle (site-specific anabolic effect)',
      disclaimer: D,
    },
  },
  hghfrag: {
    dosingProtocol: {
      conservative: { dose: '250mcg', frequency: 'Once daily (morning fasted)', weeklyTotal: '1,750mcg' },
      moderate:     { dose: '500mcg', frequency: 'Once daily (morning fasted)', weeklyTotal: '3,500mcg' },
      aggressive:   { dose: '500mcg', frequency: 'Twice daily (AM fasted + pre-workout fasted)', weeklyTotal: '7,000mcg' },
      timing: 'Morning fasted is primary (maximum lipolytic effect in low-insulin state). If 2x/day: second dose pre-workout, fasted. Wait 30–45 min before eating after each injection.',
      injectionSite: 'SubQ abdomen — sterile water or saline ONLY (see BAC water warning)',
      disclaimer: D,
    },
  },
  cardiogen: {
    dosingProtocol: {
      conservative: { dose: '5mg/day × 10 days', frequency: 'Once daily (10-day cycle, 1x/year)', weeklyTotal: '35mg during cycle' },
      moderate:     { dose: '5–10mg/day × 20 days', frequency: 'Once daily (20-day cycle)', weeklyTotal: '35–70mg during cycle' },
      aggressive:   { dose: '10mg/day × 30 days', frequency: 'Once daily (30-day cycle, 1–2x/year)', weeklyTotal: '70mg during cycle' },
      timing: 'Morning. Best combined with Epithalon (longevity) and Thymalin (immune) in the same seasonal cycle. The Khavinson Institute spring/fall protocol is the most studied combination.',
      injectionSite: 'SubQ abdomen',
      disclaimer: D,
    },
  },
  ghrp6: {
    dosingProtocol: {
      conservative: { dose: '100mcg', frequency: 'Twice daily (fasted)', weeklyTotal: '1,400mcg' },
      moderate:     { dose: '200mcg', frequency: 'Twice daily (fasted)', weeklyTotal: '2,800mcg' },
      aggressive:   { dose: '300mcg', frequency: 'Three times daily (fasted)', weeklyTotal: '6,300mcg' },
      timing: 'Fasted state — 1.5–2 hours after last meal. Wait 30–45 min before eating post-injection. Significant hunger spike is hallmark — plan meals accordingly. Stack with CJC-1295 (DAC or no-DAC) for synergistic GH amplification.',
      injectionSite: 'SubQ abdomen — fasted state essential for GH response',
      disclaimer: D,
    },
  },
  cjcnodac: {
    dosingProtocol: {
      conservative: { dose: '100mcg', frequency: 'Twice daily (always paired with GHRP)', weeklyTotal: '1,400mcg' },
      moderate:     { dose: '100mcg', frequency: 'Three times daily (paired with GHRP each dose)', weeklyTotal: '2,100mcg' },
      aggressive:   { dose: '200mcg', frequency: 'Three times daily (paired with GHRP each dose)', weeklyTotal: '4,200mcg' },
      timing: 'Always inject simultaneously with a GHRP (Ipamorelin, GHRP-6, or Hexarelin) — in the same syringe or back-to-back within 5 min. Pre-bed and pre-workout are primary windows. All injections must be fasted.',
      injectionSite: 'SubQ abdomen — can be drawn into same syringe as GHRP',
      disclaimer: D,
    },
  },
  humanin: {
    dosingProtocol: {
      conservative: { dose: '2mg', frequency: 'Twice weekly', weeklyTotal: '4mg' },
      moderate:     { dose: '2mg', frequency: 'Four times weekly', weeklyTotal: '8mg' },
      aggressive:   { dose: '4mg', frequency: 'Five times weekly', weeklyTotal: '20mg' },
      timing: 'Any time of day. Morning preferred by most protocols. Stack with MOTS-c and NAD+ for comprehensive mitochondria-derived peptide longevity protocol.',
      injectionSite: 'SubQ abdomen',
      disclaimer: D,
    },
  },
  follistatin344: {
    dosingProtocol: {
      conservative: { dose: '25mcg/day × 10 days', frequency: 'Once daily IM during cycle', weeklyTotal: '175mcg during cycle' },
      moderate:     { dose: '50mcg/day × 20 days', frequency: 'Once daily IM during cycle', weeklyTotal: '350mcg during cycle' },
      aggressive:   { dose: '100mcg/day × 30 days', frequency: 'Once daily IM — maximum studied duration', weeklyTotal: '700mcg during cycle' },
      timing: 'Post-workout for target muscle effect. Inject IM into target muscle. Cardiovascular monitoring recommended — myostatin inhibition affects all muscle tissue including cardiac. Tendon strength may lag muscle growth.',
      injectionSite: 'IM into target muscle (localized hyperplasia) — NOT SubQ for site-specific effect',
      disclaimer: D,
    },
  },
  glutathione: {
    dosingProtocol: {
      conservative: { dose: '200mg', frequency: 'Twice weekly', weeklyTotal: '400mg' },
      moderate:     { dose: '400mg', frequency: 'Three times weekly', weeklyTotal: '1,200mg' },
      aggressive:   { dose: '600mg', frequency: 'Five times weekly', weeklyTotal: '3,000mg' },
      timing: 'Any time of day. Use reconstituted solution within 24–48 hours (oxidizes rapidly). Do not combine in same syringe as NAD+. For IV push: dilute in 20–50mL normal saline, push slowly over 5–10 min.',
      injectionSite: 'SubQ abdomen (research use) or IV push diluted in normal saline',
      disclaimer: D,
    },
  },
  thymalin: {
    dosingProtocol: {
      conservative: { dose: '5mg/day × 10 days', frequency: 'Once daily (10-day cycle, 1x/year)', weeklyTotal: '35mg during cycle' },
      moderate:     { dose: '10mg/day × 10 days', frequency: 'Once daily (10-day cycle, 1–2x/year)', weeklyTotal: '70mg during cycle' },
      aggressive:   { dose: '10mg/day × 20 days', frequency: 'Once daily (20-day cycle, up to 2x/year)', weeklyTotal: '70mg during cycle' },
      timing: 'Morning. Classic Khavinson protocol: run Thymalin + Epithalon simultaneously in spring and fall for comprehensive immune + longevity bioregulation. 10-day injection courses are the standard.',
      injectionSite: 'SubQ abdomen',
      disclaimer: D,
    },
  },
  thymogen: {
    dosingProtocol: {
      conservative: { dose: '0.5mg/day × 10 days', frequency: 'Once daily (10-day cycle)', weeklyTotal: '3.5mg during cycle' },
      moderate:     { dose: '1mg/day × 10 days', frequency: 'Once daily (10-day cycle)', weeklyTotal: '7mg during cycle' },
      aggressive:   { dose: '1mg/day × 14 days', frequency: 'Once daily (14-day cycle, up to 2x/year)', weeklyTotal: '7mg during cycle' },
      timing: 'Morning injection or intranasal spray (2–3 sprays per nostril). Both routes are validated in published research. Intranasal is preferred for convenience during cycle.',
      injectionSite: 'SubQ abdomen or intranasal (2–3 sprays per nostril per dose)',
      disclaimer: D,
    },
  },
  vip: {
    dosingProtocol: {
      conservative: { dose: '50mcg', frequency: 'Once daily intranasal', weeklyTotal: '350mcg' },
      moderate:     { dose: '100mcg', frequency: 'Once daily intranasal', weeklyTotal: '700mcg' },
      aggressive:   { dose: '200mcg', frequency: 'Twice daily intranasal', weeklyTotal: '2,800mcg' },
      timing: 'Morning (primary dose). Take seated or lying down — vasodilation may cause blood pressure drop. CIRS protocols require physician supervision and nagalase/VIP lab monitoring. Onset 30 min; duration 2–4 hours.',
      injectionSite: 'Intranasal via nasal atomizer (primary — CNS effect) or SubQ abdomen (systemic)',
      disclaimer: D,
    },
  },
  bronchogen: {
    dosingProtocol: {
      conservative: { dose: '5mg/day × 10 days', frequency: 'Once daily (10-day cycle, 1x/year)', weeklyTotal: '35mg during cycle' },
      moderate:     { dose: '5–10mg/day × 20 days', frequency: 'Once daily (20-day cycle)', weeklyTotal: '35–70mg during cycle' },
      aggressive:   { dose: '10mg/day × 30 days', frequency: 'Once daily (30-day cycle, 1–2x/year)', weeklyTotal: '70mg during cycle' },
      timing: 'Morning. Best for post-respiratory illness recovery. Can be combined with Thymalin (immune) and Epithalon (longevity) in the same seasonal cycle protocol.',
      injectionSite: 'SubQ abdomen',
      disclaimer: D,
    },
  },
  adipotide: {
    dosingProtocol: {
      conservative: { dose: '0.1mg/kg/day (research)', frequency: 'Once daily — physician protocol only', weeklyTotal: 'Protocol-specific' },
      moderate:     { dose: '0.5mg/kg/day (primate study dose)', frequency: 'Once daily', weeklyTotal: 'Protocol-specific' },
      aggressive:   { dose: 'Not recommended — nephrotoxicity risk', frequency: 'N/A', weeklyTotal: 'N/A' },
      timing: 'No established human protocol. Animal studies: daily SubQ for 28 days. CAUTION: renal toxicity in primate studies. Monitor kidney function. Physician oversight required.',
      injectionSite: 'SubQ abdomen — physician-supervised protocols only',
      disclaimer: D,
    },
  },
  cagrilintide: {
    dosingProtocol: {
      conservative: { dose: '0.3mg', frequency: 'Once weekly (starting dose)', weeklyTotal: '0.3mg' },
      moderate:     { dose: '1.2mg', frequency: 'Once weekly (after titration)', weeklyTotal: '1.2mg' },
      aggressive:   { dose: '2.4mg', frequency: 'Once weekly (maintenance)', weeklyTotal: '2.4mg' },
      timing: 'Same day each week. Titrate slowly over 12-16 weeks. Evening reduces nausea. Complementary to GLP-1 compounds via amylin pathway.',
      injectionSite: 'SubQ abdomen, thigh, or upper arm — rotate sites',
      disclaimer: D,
    },
  },
  hcg: {
    dosingProtocol: {
      conservative: { dose: '250 IU', frequency: 'Every 3 days (TRT maintenance)', weeklyTotal: '~583 IU' },
      moderate:     { dose: '500 IU', frequency: 'Every 2-3 days', weeklyTotal: '~1,167-1,750 IU' },
      aggressive:   { dose: '1,000 IU', frequency: 'Three times weekly (post-cycle only, 3-6 weeks)', weeklyTotal: '3,000 IU' },
      timing: 'Any time. Consistent schedule. For TRT: prevents testicular atrophy. Post-cycle: start after compounds cleared. Monitor estrogen.',
      injectionSite: 'SubQ abdomen — rotate sites',
      disclaimer: D,
    },
  },
  igf1des: {
    dosingProtocol: {
      conservative: { dose: '50mcg', frequency: 'Once daily post-workout (5x/week)', weeklyTotal: '250mcg' },
      moderate:     { dose: '100mcg', frequency: 'Once daily post-workout (5x/week)', weeklyTotal: '500mcg' },
      aggressive:   { dose: '150mcg', frequency: 'Twice daily — 4-6 week cycles only', weeklyTotal: '1,050mcg' },
      timing: 'Immediately post-workout into worked muscle. IM injection required for site-specific hyperplasia. Have carbohydrates ready. 4-6 week cycles maximum.',
      injectionSite: 'IM into target muscle — intramuscular injection required',
      disclaimer: D,
    },
  },
  pnc27: {
    dosingProtocol: {
      conservative: { dose: 'Research protocol only', frequency: 'Per physician protocol', weeklyTotal: 'Not established' },
      moderate:     { dose: 'Research protocol only', frequency: 'Per physician protocol', weeklyTotal: 'Not established' },
      aggressive:   { dose: 'Not recommended without oncology oversight', frequency: 'N/A', weeklyTotal: 'N/A' },
      timing: 'No established human dosing. In vitro and animal data only. Oncology oversight required.',
      injectionSite: 'Research protocol only — SubQ or IV per physician instructions',
      disclaimer: D,
    },
  },
  gcmaf: {
    dosingProtocol: {
      conservative: { dose: '25ng', frequency: 'Once weekly', weeklyTotal: '25ng' },
      moderate:     { dose: '100ng', frequency: 'Once weekly', weeklyTotal: '100ng' },
      aggressive:   { dose: '100ng', frequency: 'Twice weekly (physician-supervised)', weeklyTotal: '200ng' },
      timing: 'Once weekly same day. Monitor nagalase levels. Quality highly source-dependent. Flu-like immune activation expected first 2-4 weeks.',
      injectionSite: 'SubQ abdomen — physician-supervised strongly recommended',
      disclaimer: D,
    },
  },
  teriparatide: {
    dosingProtocol: {
      conservative: { dose: '20mcg/day (FDA label dose)', frequency: 'Once daily', weeklyTotal: '140mcg' },
      moderate:     { dose: '20mcg/day', frequency: 'Once daily (standard dose)', weeklyTotal: '140mcg' },
      aggressive:   { dose: 'Do not exceed 20mcg/day — black box osteosarcoma warning', frequency: 'N/A', weeklyTotal: 'N/A' },
      timing: 'Any time of day — sit or lie down 15-30 min post-injection. Lifetime maximum: 24 months. Transition to bisphosphonates after completion.',
      injectionSite: 'SubQ thigh or lower abdomen — rotate sites',
      disclaimer: D,
    },
  },
  prostamax: {
    dosingProtocol: {
      conservative: { dose: '5mg/day x 10 days', frequency: 'Once daily (10-day cycle, 1x/year)', weeklyTotal: '35mg during cycle' },
      moderate:     { dose: '5-10mg/day x 20 days', frequency: 'Once daily (20-day cycle)', weeklyTotal: '35-70mg during cycle' },
      aggressive:   { dose: '10mg/day x 30 days', frequency: 'Once daily (30-day cycle, 1-2x/year)', weeklyTotal: '70mg during cycle' },
      timing: 'Morning. Combine with Epithalon and Thymalin in Khavinson seasonal bioregulator protocol. Continue PSA monitoring.',
      injectionSite: 'SubQ abdomen',
      disclaimer: D,
    },
  },
  melittin: {
    dosingProtocol: {
      conservative: { dose: '0.1mcg/kg (anaphylaxis test dose)', frequency: 'Physician-supervised only', weeklyTotal: 'Protocol-specific' },
      moderate:     { dose: 'Per apitherapy protocol only', frequency: 'Per physician protocol', weeklyTotal: 'Not established' },
      aggressive:   { dose: 'NOT RECOMMENDED without allergy testing and physician oversight', frequency: 'N/A', weeklyTotal: 'N/A' },
      timing: 'ANAPHYLAXIS RISK: bee venom allergy test required before any use. Physician oversight mandatory. Significant burning expected.',
      injectionSite: 'SubQ abdomen — physician-supervised with emergency preparedness only',
      disclaimer: D,
    },
  },
};

export const RECON_SOLVENT_DATA = {
  bpc157:        { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Stable in BAC water. Compatible with benzyl alcohol preservative.', canUseBacWater: true, bacWaterWarning: null },
  reta:          { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Compatible with BAC water. Refrigerate immediately after reconstitution.', canUseBacWater: true, bacWaterWarning: null },
  tb500:         { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Stable in BAC water. Thymosin Beta-4 is compatible with benzyl alcohol.', canUseBacWater: true, bacWaterWarning: null },
  nad:           { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'BAC water acceptable. Use within 14 days — NAD+ is more fragile than peptides.', canUseBacWater: true, bacWaterWarning: null },
  ipamorelin:    { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Stable 28 days refrigerated.', canUseBacWater: true, bacWaterWarning: null },
  cjc:           { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. CJC-1295 DAC is stable in BAC water.', canUseBacWater: true, bacWaterWarning: null },
  ghkcu:         { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'BAC water compatible. Blue/green colour from copper complex is normal.', canUseBacWater: true, bacWaterWarning: null },
  sermorelin:    { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Stable 28 days refrigerated.', canUseBacWater: true, bacWaterWarning: null },
  aod9604:       { solvent: 'Sterile Water or Normal Saline (0.9% NaCl)', solventNote: 'AOD-9604 should NOT be reconstituted with bacteriostatic water. The benzyl alcohol preservative in BAC water degrades the AOD-9604 peptide, reducing potency. Use sterile water for injections (SWFI) or normal saline only. Use within 5-7 days if using sterile water.', canUseBacWater: false, bacWaterWarning: 'Do NOT use Bacteriostatic Water for AOD-9604. The benzyl alcohol in BAC water degrades this peptide. Use sterile water for injection (SWFI) or 0.9% normal saline. Use within 5-7 days.' },
  ta1:           { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Stable 28 days refrigerated.', canUseBacWater: true, bacWaterWarning: null },
  kpv:           { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Very stable tripeptide. BAC water standard. Excellent stability.', canUseBacWater: true, bacWaterWarning: null },
  semax:         { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'BAC water acceptable. Semax degrades faster — use within 21 days.', canUseBacWater: true, bacWaterWarning: null },
  selank:        { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Use within 21 days.', canUseBacWater: true, bacWaterWarning: null },
  tesamorelin:   { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Clinical Egrifta uses sterile water with mannitol buffer — BAC water acceptable for research.', canUseBacWater: true, bacWaterWarning: null },
  slupppp332:    { solvent: 'N/A — Oral Capsule', solventNote: 'Oral compound — no reconstitution required.', canUseBacWater: null, bacWaterWarning: null },
  amino1mq:      { solvent: 'N/A — Oral Capsule', solventNote: 'Oral compound — no reconstitution required.', canUseBacWater: null, bacWaterWarning: null },
  epithalon:     { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'BAC water standard. Particularly light-sensitive — store in dark.', canUseBacWater: true, bacWaterWarning: null },
  motsc:         { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'BAC water acceptable. Handle gently — MOTS-c is fragile. No vigorous agitation.', canUseBacWater: true, bacWaterWarning: null },
  hexarelin:     { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Stable 28 days refrigerated.', canUseBacWater: true, bacWaterWarning: null },
  dihexa:        { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'BAC water for injectable. For oral: dissolve in minimal sterile water. Start at lowest dose.', canUseBacWater: true, bacWaterWarning: null },
  ss31:          { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Protect from light.', canUseBacWater: true, bacWaterWarning: null },
  dsip:          { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Stable 28 days refrigerated.', canUseBacWater: true, bacWaterWarning: null },
  p21:           { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'BAC water acceptable. Can also be taken orally in sterile water.', canUseBacWater: true, bacWaterWarning: null },
  pinealon:      { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Khavinson bioregulator — standard stability.', canUseBacWater: true, bacWaterWarning: null },
  pt141:         { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Stable 28 days refrigerated.', canUseBacWater: true, bacWaterWarning: null },
  melanotan2:    { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Protect from light — melanocortin peptides are light-sensitive.', canUseBacWater: true, bacWaterWarning: null },
  kisspeptin:    { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Stable 28 days refrigerated.', canUseBacWater: true, bacWaterWarning: null },
  ll37:          { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'BAC water acceptable. Handle with care — LL-37 is degradation-sensitive.', canUseBacWater: true, bacWaterWarning: null },
  igf1lr3:       { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'BAC water standard. Use within 14 days — degrades faster than most peptides.', canUseBacWater: true, bacWaterWarning: null },
  hghfrag:       { solvent: 'Sterile Water or Normal Saline (0.9% NaCl)', solventNote: 'HGH Fragment 176-191 should NOT use BAC water. Like AOD-9604, benzyl alcohol degrades this fragment. Use sterile water for injection or normal saline. Use within 5-7 days.', canUseBacWater: false, bacWaterWarning: 'Do NOT use Bacteriostatic Water for HGH Fragment 176-191. Benzyl alcohol in BAC water degrades this HGH fragment. Use sterile water (SWFI) or 0.9% normal saline. Use within 5-7 days.' },
  cardiogen:     { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Khavinson bioregulator — standard handling.', canUseBacWater: true, bacWaterWarning: null },

  ghrp6:         { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Stable 28 days refrigerated.', canUseBacWater: true, bacWaterWarning: null },
  cjcnodac:      { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Can be drawn into same syringe as GHRP.', canUseBacWater: true, bacWaterWarning: null },
  humanin:       { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Handle gently — mitochondria-derived peptides are sensitive.', canUseBacWater: true, bacWaterWarning: null },
  follistatin344: { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'BAC water standard. Highly sensitive protein — use within 14 days. Never shake.', canUseBacWater: true, bacWaterWarning: null },
  glutathione:   { solvent: 'Bacteriostatic Water (BAC Water) — use within 24-48hrs', solventNote: 'Glutathione oxidizes rapidly once reconstituted. Use within 24-48 hours. Protect completely from light. IV: dilute in normal saline.', canUseBacWater: true, bacWaterWarning: null },
  thymalin:      { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Khavinson polypeptide — standard handling.', canUseBacWater: true, bacWaterWarning: null },
  thymogen:      { solvent: 'Bacteriostatic Water (BAC Water) or Sterile Saline (intranasal)', solventNote: 'BAC water for SubQ. Sterile saline preferred for intranasal formulation.', canUseBacWater: true, bacWaterWarning: null },
  vip:           { solvent: 'Bacteriostatic Water (BAC Water) — dilute for intranasal', solventNote: 'BAC water for initial reconstitution. For intranasal: further dilute 1:10 in sterile saline for nasal atomizer.', canUseBacWater: true, bacWaterWarning: null },
  bronchogen:    { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Khavinson bioregulator — standard handling.', canUseBacWater: true, bacWaterWarning: null },
  adipotide:     { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'BAC water acceptable. Extremely experimental — physician supervision required.', canUseBacWater: true, bacWaterWarning: null },
  cagrilintide:  { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Stable 28 days refrigerated.', canUseBacWater: true, bacWaterWarning: null },
  hcg:           { solvent: 'Bacteriostatic Water (BAC Water) or Provided Diluent', solventNote: 'Use BAC water or sterile diluent provided with clinical HCG kits. Extremely sensitive to heat.', canUseBacWater: true, bacWaterWarning: null },
  igf1des:       { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'BAC water standard. Use within 14 days. Do not refreeze after reconstitution.', canUseBacWater: true, bacWaterWarning: null },
  pnc27:         { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'BAC water acceptable for research reconstitution. Highly experimental.', canUseBacWater: true, bacWaterWarning: null },
  gcmaf:         { solvent: 'Special preparation — cold chain required', solventNote: 'GcMAF requires specific reconstitution per supplier instructions. Keep at 2-8°C. Do NOT freeze. Quality varies enormously by source.', canUseBacWater: false, bacWaterWarning: 'GcMAF requires specific preparation per supplier protocol. Do NOT use BAC water — requires precise pH-controlled preparation. Follow supplier instructions exactly. Verify cold chain integrity.' },
  teriparatide:  { solvent: 'Sterile Water for Injection (SWFI) or Provided Clinical Diluent', solventNote: 'Teriparatide is sensitive to benzyl alcohol. Clinical Forteo uses pre-filled pen with proprietary diluent. Research vial: use SWFI only. Refrigerate at 2-8°C.', canUseBacWater: false, bacWaterWarning: 'Teriparatide (PTH 1-34) is sensitive to benzyl alcohol. Do NOT use BAC water. Use sterile water for injection (SWFI) or the proprietary clinical diluent (Forteo pen). Use within 28 days.' },
  prostamax:     { solvent: 'Bacteriostatic Water (BAC Water)', solventNote: 'Standard BAC water. Khavinson bioregulator — standard handling.', canUseBacWater: true, bacWaterWarning: null },
  melittin:      { solvent: 'Bacteriostatic Water (BAC Water) — physician protocol only', solventNote: 'BAC water acceptable for research stock. ANAPHYLAXIS RISK — allergy test required. Physician supervision mandatory.', canUseBacWater: true, bacWaterWarning: null },
};
