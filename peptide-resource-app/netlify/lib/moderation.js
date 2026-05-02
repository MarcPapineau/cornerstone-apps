/**
 * Shared moderation module — used by BOTH:
 *   - netlify/functions/vitalis-chat.js          (sync router)
 *   - netlify/functions/vitalis-chat-background.js (Anthropic-calling background fn)
 *
 * Both code paths MUST run moderation as the first step of their handler.
 * This is defense-in-depth: even if the sync router is bypassed (e.g.,
 * direct invocation of the background function via leaked URL), the
 * background function refuses dangerous prompts before they reach Claude.
 *
 * Trigger categories (severity 'block' = synchronous refusal, no Claude call):
 *   - minors:              under-18 references in any common form
 *   - self-harm:           suicide / self-injury / "want to die" phrasings
 *   - illegal-substances:  recreational/illicit drugs Vitalis will not discuss
 *
 * Adding a trigger:
 *   1. Append to MODERATION_TRIGGERS with { id, severity, pattern, response }.
 *   2. Add at least one positive + one false-positive test in tests/moderation.test.js.
 *   3. Both functions auto-pick up changes — no per-function edit needed.
 */

// Trigger set: expanded 2026-05-01 to close gaps flagged in Bug #2.
//
// minors — adds:
//   - hyphenated forms ("12-year-old", "5-yr-old")
//   - word-form ages ("twelve year old", "thirteen yr old")
// self-harm — adds:
//   - "want to die" / "wanna die"
//   - "don't want to be here" / "do not want to be here"
//   - "end it all"
// illegal-substances — adds: MDMA / ecstasy, LSD / acid, mushrooms / psilocybin,
//   GHB, kratom (already had ketamine).
const MODERATION_TRIGGERS = [
  {
    id: 'minors',
    severity: 'block',
    pattern: new RegExp(
      [
        // possessive minor references: "my kid", "the daughter", etc.
        '\\b(my|the|a)\\s+(kid|child|daughter|son|teen|teenager|minor)\\b',
        // numeric "under 18" / "below 17" / "under-13"
        '\\b(under|below)\\s*-?\\s*(13|14|15|16|17|18)\\b',
        // numeric ages 1–17 ONLY, with various unit forms:
        //   "12 yo", "12yo", "12 y/o", "12-year-old", "12 year old", "15-yr-old"
        // Ages 18+ are NOT flagged here — those are adults.
        '\\b(1[0-7]|[1-9])\\s*-?\\s*(yo\\b|y\\/o|year[\\s-]*old|yr[\\s-]*old|years[\\s-]*old)',
        // "for my 14 yo" / "for my 14-year-old" — same age bound (1–17)
        '\\bfor my\\s+(1[0-7]|[1-9])\\s*-?\\s*(yo|year[\\s-]*old|y\\/o|yr[\\s-]*old)',
        // word-form ages 10–17: "twelve year old", "thirteen-yr-old", etc.
        '\\b(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)\\s*-?\\s*(year[\\s-]*old|yr[\\s-]*old|years[\\s-]*old|yo\\b|y\\/o)',
      ].join('|'),
      'i'
    ),
    response:
      'Peptide protocols are for adults 18+ only. If you are asking on behalf of a minor, please consult a pediatric endocrinologist — we cannot produce guidance here.',
  },
  {
    id: 'self-harm',
    severity: 'block',
    pattern:
      /\b(kill myself|killing myself|kill ?my ?self|suicide|suicidal|end(ing)? my life|end(ing|ed)?\s+it\s+all|self[-\s]?harm|harm myself|hurt myself|cut myself|wan(na|t to) die|don'?t want to (be here|live)|do not want to (be here|live)|no reason to (live|be alive)|better off dead)\b/i,
    response:
      "If you're in crisis, please contact the Suicide and Crisis Lifeline (988 in the US, or your local equivalent). We're not equipped to help here, but real support is available right now.",
  },
  {
    id: 'illegal-substances',
    severity: 'block',
    // Note: deliberately NOT matching plain "coke" or "crack" alone — too
    // many soda / colloquial false positives (Coke Zero, "crack open a beer").
    // We match the formal/clinical names + drug-specific slang only.
    pattern:
      /\b(cocaine|heroin|meth(?!yl)|methamphetamine|fentanyl|crack cocaine|ketamine|mdma|ecstasy pills?|molly\s+pills?|lsd|acid trip|psilocybin|magic mushrooms|shrooms|ghb|kratom|dmt|pcp|angel dust|bath salts|2c-b|2cb)\b/i,
    response:
      'Vitalis only discusses research peptides and FDA-regulated compounds. For substance-use questions, please consult a licensed clinician.',
  },
];

/**
 * Check a user message against the moderation trigger set.
 * @param {string} text - user-supplied message body
 * @returns {{flagged: boolean, trigger?: {id, severity, response}}}
 */
function moderateMessage(text) {
  if (!text || typeof text !== 'string') return { flagged: false };
  for (const t of MODERATION_TRIGGERS) {
    if (t.pattern.test(text)) {
      return {
        flagged: true,
        trigger: { id: t.id, severity: t.severity, response: t.response },
      };
    }
  }
  return { flagged: false };
}

module.exports = {
  MODERATION_TRIGGERS,
  moderateMessage,
};
