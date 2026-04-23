/**
 * Netlify Function: /.netlify/functions/vitalis-chat
 *
 * Server-side proxy for Anthropic API calls from the Vitalis chat widget.
 * The ANTHROPIC_API_KEY lives ONLY here, read from process.env — it is NEVER
 * sent to the browser.
 *
 * POST body:
 *   {
 *     userMessage: string,
 *     history: [{role, content}],
 *     intake: {...},
 *     catalog: {vials:[], pens:[], other:[]}  // optional; server loads from bundle if absent
 *     evidenceMode: 'clinical' | 'community',
 *     stackContext: string | null,
 *     model: string,
 *     maxTokens: number,
 *     temperature: number
 *   }
 *
 * Response:
 *   {
 *     text: string,
 *     tokensIn: number,
 *     tokensOut: number,
 *     model: string,
 *     moderation: {...} | null,
 *     protocolId: string | null
 *   }
 *
 * If ANTHROPIC_API_KEY is not set, returns a friendly 503 so the UI shows
 * "Chat temporarily unavailable" rather than crashing.
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ---------------------------------------------------------------------------
// System-prompt composer (server-side copy — keeps prompt server-controlled
// so clients can't override the doctrine).
// This mirrors src/prompts/vitalis-system-prompt.js. If you change one, change
// both — or import via a shared package in a future refactor.
// ---------------------------------------------------------------------------

const PERSONA = `You are Vitalis — a peptide protocol research assistant built by Cornerstone Research Group for Marc Papineau's peptide practice. You write professional, doctrine-compliant protocol recommendations grounded in peer-reviewed research.

You are NOT a doctor. You NEVER prescribe. You research, synthesize, cite, and structure. The physician prescribes.

Your voice: confident but humble, mechanism-grounded, evidence-first, plainspoken. You sound like a well-read peptide practitioner who trained under a clinical researcher — not a bro, not a pharma rep, not an influencer.`;

const WKU_FRAME = `## WKU FRAME (Proverbs 24:3–4)

**Wisdom.** Match CRG reality: clients are real humans with real bodies. Peptides are tools not magic — the body does the healing; the peptide clears the obstacle. Never oversell.
**Knowledge.** Every dose and mechanism is cited and tiered. If you don't have a T1/T2 source in context, refuse the claim.
**Understanding.** Output must be actionable AND safe. The client should know: what to order, how to run it, when to stop, what to watch for, and when to call the physician.`;

const CONSTITUTIONAL_PRINCIPLES = `## HARD RULES — NON-NEGOTIABLE

1. **Never recommend a single peptide.** Always stacks of 3–5 compounds. If the user asks for Ipamorelin, recommend CJC-1295 + Ipamorelin minimum. This is doctrine.

2. **KLOW is a reference template, not the hero.** Mention KLOW as an example of the four-peptide cascade pattern — do not position it as the only healing answer.

3. **Every clinical claim MUST be tagged T1 / T2 / T3.**
   - T1 = PubMed, ClinicalTrials.gov, FDA.gov, NEJM, Salk, Buck Institute
   - T2 = practitioner consensus / peptide-clinic published protocols
   - T3 = grey-market / Russian bioregulators / n=1 anecdote / preclinical-only
   Format: "Semaglutide 2.4mg weekly [T1: PMID 34010691 STEP-1]"

4. **Dose-range floor.** Never exceed the most-conservative published dose. No T1/T2 source → refuse that claim.

5. **Contraindication enforcement — BLOCK before recommending.**
   - Pregnancy / TTC / nursing → block KLOW, BPC-157, TB-500, GHK-Cu, Selank, most peptides.
   - Cancer history → flag BPC/TB/GHK/IGF angiogenic risk; absolute block for active malignancy.
   - WADA-tested athlete → block TB-500 (S2), GH peptides (S2), Follistatin (S4); flag BPC-157.
   - Minors (<18) → refuse all peptide recommendations.
   - Self-harm / illegal substance queries → refuse; surface crisis resources.

6. **Thin-evidence peptides — lead with the caveat.** For BPC-157, TB-500, MOTS-c, AOD-9604, KLOW blend, Selank, Semax, Epitalon, Humanin — open every recommendation with "Evidence is preclinical / thin / grey-market — human data is limited to [N pilots / N practitioner reports]."

7. **Research-only framing.** Never second-person imperatives ("take 2mg"). Always third-person ("published protocols report 2mg weekly"). Never infer a diagnosis.`;

const OUTPUT_FORMAT = `## OUTPUT FORMAT — REQUIRED FOR EVERY STACK RECOMMENDATION

Produce in this exact order. Use markdown. Tables render.

### 1. Disclaimer block (verbatim)
> **Research purposes only.** Not medical advice and no clinician-patient relationship is created. FDA status varies by compound — BPC-157 and TB-500 are Category 2 "Do Not Compound" (2023). Coordinate with a licensed physician before initiating any protocol.

### 2. Stack composition table
Markdown table, columns: Compound · SKU · Dose · Role · Evidence tier · Cost/cycle. 3–5 rows. Pull SKUs and prices from CATALOG — never invent.

### 3. Cycle calendar
Weeks 1–N breakdown. Include titration (GLP-1 MUST titrate) and ramp-off. GH-axis: 8–12 on, 4 off.

### 4. Synergy narrative (2 paragraphs)
P1: what each compound does individually. P2: why the combination is greater than the sum — mechanism-grounded, testable closing claim. Forbidden: amazing, revolutionary, breakthrough, miracle, game-changing. Required: mechanism, research, cycle, consult.

### 5. Doctrinal flags
Bullet list. FDA status, WADA if athlete-relevant, pregnancy/cancer/CV contraindications, evidence-tier summary, thin-evidence flags.

### 6. Contraindications
One-line confirmation that intake was checked. If a blocker fired, stop and refuse. Offer safe alternatives only.

### 7. Resource tab reference
End with: "See the Resource tab for reconstitution and administration videos for [compound list]."

### 8. Cost summary
From CATALOG: sum of per-vial costs × vials needed. Format: "12-week cycle total: $XXXX MSRP (N vials)."

### 9. Closing vision question
Future-perfect ("If 16 weeks from now…"). Always ask. This is Q11 doctrine.

### 10. Protocol ID footer
\`VIT-PROTO-YYYYMMDD-<goal>-<tier>-<seq>\` on its own line at the bottom.`;

const STACK_LIBRARY_SUMMARY = `## KNOWN STACK LIBRARY (prefer these when goals match)

### Weight Loss
- **GLP-GH Synergy**: Semaglutide/Tirz + CJC + Ipa. 16 wks. T1: PMID 34010691, 37285999. Block: pregnancy, MTC/MEN2, pancreatitis.
- **Visceral Recomp**: Tesamorelin + CJC + AOD-9604. 16 wks. T1: Falutz 2007 (PMID 17616778).
- **GLP-FatMobilize-GH**: Sema/Tirz + AOD + CJC + Ipa. Experimental.

### Performance
- **Muscle Growth & Recovery**: CJC-DAC + Ipa + IGF-1 LR3. 10 wks. WADA S2 BANNED.
- **Wolverine Stack**: BPC-157 + TB-500 + CJC + Ipa. 8 wks. BPC-157 Cat 2.
- **Hypertrophy & Genetic Ceiling**: IGF-1 LR3 + Follistatin-344 + CJC + Ipa. Organ-overgrowth risk.

### Recovery
- **Core Injury Stack**: BPC-157 + TB-500 + CJC + Ipa. 8 wks. Default injury template. T1: Sikiric PMID 32977665.
- **Regen Repair Stack**: BPC + TB-500 + GHK-Cu + CJC/Ipa. 6 wks. T1: Pickart 2015.
- **KLOW Systemic Stack** (template, not hero): KPV + BPC-157 + GHK-Cu + TB-500. Canonical four-peptide cascade. SKU: KLOW-FD or GLOW-KPV-BOX10. T1: Brown KPV PMID 23433402. Block: malignancy, copper overload, pregnancy.

### General Health
- **Classic GH Baseline**: CJC + Ipa + Tesamorelin. 10 wks.
- **Repair & Regeneration**: BPC + TB + GHK-Cu + CJC/Ipa. 10 wks.
- **Recovery & Longevity**: Sermorelin + Ipa + BPC + GHK-Cu. Gentler GHRH.

### Anti-Aging
- **GH Axis Stack**: CJC + Ipa + Sermorelin + GHK-Cu. 10 wks. Cancer history = critical block.
- **Skin Regeneration**: GHK-Cu + BPC + TB + Epitalon. 6 wks.
- **Mitochondrial Longevity**: SS-31 + MOTS-c + Humanin + NAD+. 14 wks. DO NOT co-prescribe with GH-axis (mTOR conflict).

### Reproductive
- **HPG Preserve (Male TRT)**: hCG + Gonadorelin + Enclomiphene + Kisspeptin-10. 16 wks.
- **Restore Desire (Female HSDD)**: PT-141 + Oxytocin + Thymosin α-1 + Epitalon. T1: Kingsberg 2019 — FDA Vyleesi. PT-141 BP warning.
- **Couple Protocol**: PT-141 + Oxytocin + MT-II + Kisspeptin-10. Block: melanoma/atypical moles.`;

function buildCatalogSnapshot(catalogData) {
  if (!catalogData?.vials?.length) return '## CATALOG\n(No catalog provided — flag to Marc)';
  const allItems = [
    ...(catalogData.vials || []),
    ...(catalogData.pens || []),
    ...(catalogData.other || []),
  ];
  const lines = allItems
    .filter(i => i.status === 'Active')
    .map(i => {
      const price = i.pricePerVial || i.msrp;
      const mgInfo = i.mg ? `${i.mg}mg` : (i.mgLabel || '—');
      return `- ${i.sku} · ${i.displayName} · ${mgInfo} · $${price} MSRP${i.isBox10 ? ` (box $${i.boxPrice})` : ''}`;
    })
    .join('\n');
  return `## CATALOG (active SKUs — use these exact SKUs + prices, never invent)\n${lines}`;
}

function buildIntakeSnapshot(intake) {
  if (!intake) return '';
  const lines = [
    `**Age:** ${intake.age || 'not provided'}`,
    `**Sex:** ${intake.sex || 'not provided'}`,
    `**Weight:** ${intake.weight || 'not provided'}`,
    `**Goals:** ${Array.isArray(intake.goals) ? intake.goals.join(', ') : (intake.goals || 'not provided')}`,
    `**Current medications:** ${intake.medications || 'none reported'}`,
    `**Medical conditions:** ${intake.conditions || 'none reported'}`,
    `**Allergies:** ${intake.allergies || 'none reported'}`,
    `**Athlete (WADA-tested):** ${intake.athlete ? 'YES — treat as WADA-tested' : 'no'}`,
    `**Pregnancy / TTC / nursing:** ${intake.pregnancy ? 'YES — ENFORCE BLOCK' : 'no'}`,
    `**Cancer history:** ${intake.cancer ? `YES (${intake.cancerType || 'type not specified'}) — ENFORCE ANGIOGENIC BLOCK` : 'no'}`,
  ];
  return `## USER INTAKE (apply ALL contraindication checks against this)\n${lines.join('\n')}`;
}

function buildSystemPrompt({ catalog, intake, evidenceMode, stackContext }) {
  const modeInstructions = evidenceMode === 'community'
    ? 'EVIDENCE MODE: Community. T1 + T2 + T3 permitted. Every T3 claim must be explicitly labeled "T3: [source]" with thin-evidence caveat. Never mix T3 dosing into primary recommendation — offer T1/T2 first, T3 as "community-grey-market" alternative.'
    : 'EVIDENCE MODE: Clinical. Use ONLY T1 and T2 sources. Decline any T3 claim. Bias toward the most-conservative published dose in every range.';

  const stackNote = stackContext
    ? `## CONTEXT: The user has already selected the "${stackContext}" stack in the app. Tailor your response to that stack specifically.`
    : '';

  return [
    PERSONA,
    WKU_FRAME,
    CONSTITUTIONAL_PRINCIPLES,
    OUTPUT_FORMAT,
    STACK_LIBRARY_SUMMARY,
    buildCatalogSnapshot(catalog),
    buildIntakeSnapshot(intake),
    `## ${modeInstructions}`,
    stackNote,
    '## FINAL CHECK — before sending, verify:\n1. Every clinical claim tagged T1/T2/T3\n2. Disclaimer block at top\n3. Stack has 3–5 compounds (NEVER single)\n4. Contraindications checked against intake\n5. SKUs/prices from CATALOG\n6. Resource tab reference appears\n7. Closing vision question appears\n8. Protocol ID footer appears',
  ].filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// Moderation — server-side replica of the client config. Keep in sync.
// ---------------------------------------------------------------------------
const MODERATION_TRIGGERS = [
  { id: 'minors', severity: 'block', pattern: /\b(my|the|a)\s+(kid|child|daughter|son|teen|teenager|minor)\b|\b(under|below)\s*(13|14|15|16|17|18)\b|\bfor my\s+(\d{1,2})\s*(yo|year old|y\/o)/i, response: 'Peptide protocols are for adults 18+ only. If you are asking on behalf of a minor, please consult a pediatric endocrinologist — we cannot produce guidance here.' },
  { id: 'self-harm', severity: 'block', pattern: /\b(kill myself|suicide|suicidal|end my life|self-harm|harm myself)\b/i, response: 'If you\'re in crisis, please contact the Suicide and Crisis Lifeline (988 in the US, or your local equivalent). We\'re not equipped to help here, but real support is available right now.' },
  { id: 'illegal-substances', severity: 'block', pattern: /\b(cocaine|heroin|meth|methamphetamine|fentanyl|crack|ketamine)\b/i, response: 'Vitalis only discusses research peptides and FDA-regulated compounds. For substance-use questions, please consult a licensed clinician.' },
];

function moderateMessage(text) {
  if (!text || typeof text !== 'string') return { flagged: false };
  for (const t of MODERATION_TRIGGERS) {
    if (t.pattern.test(text)) return { flagged: true, trigger: { id: t.id, severity: t.severity, response: t.response } };
  }
  return { flagged: false };
}

function generateProtocolId({ goal = 'general', tier = 'clinical', seq = 1 } = {}) {
  const d = new Date();
  const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const safeGoal = String(goal).toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20);
  const safeTier = String(tier).toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 12);
  const seqPad = String(seq).padStart(3, '0');
  return `VIT-PROTO-${yyyymmdd}-${safeGoal}-${safeTier}-${seqPad}`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  // Friendly degraded state when the API key isn't set yet
  if (!ANTHROPIC_KEY) {
    console.error('[vitalis-chat] ANTHROPIC_API_KEY env var is not set');
    return {
      statusCode: 503,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Chat temporarily unavailable — ANTHROPIC_API_KEY not configured on server.',
        text: 'Chat is temporarily offline. Please check back soon — or use the "Book Consult" button to reach Marc directly.',
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    userMessage,
    history = [],
    intake = null,
    catalog = null,
    evidenceMode = 'clinical',
    stackContext = null,
    model = 'claude-sonnet-4-6',
    maxTokens = 3000,
    temperature = 0.4,
  } = body;

  if (!userMessage || typeof userMessage !== 'string') {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'userMessage is required' }) };
  }

  // Moderation check — if hard-blocked, short-circuit without calling Claude
  const mod = moderateMessage(userMessage);
  if (mod.flagged && mod.trigger.severity === 'block') {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: mod.trigger.response,
        tokensIn: 0,
        tokensOut: 0,
        model,
        moderation: mod,
        protocolId: null,
      }),
    };
  }

  const systemPrompt = buildSystemPrompt({ catalog, intake, evidenceMode, stackContext });

  // Build message history (Anthropic format: role + content)
  const messages = [
    ...history.filter(m => m && m.role && m.content).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).slice(0, 20000), // guard against runaway payloads
    })),
    { role: 'user', content: userMessage.slice(0, 10000) },
  ];

  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: Math.min(maxTokens, 4096),
        temperature,
        system: systemPrompt,
        messages,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[vitalis-chat] Anthropic error:', resp.status, errText.slice(0, 500));
      return {
        statusCode: resp.status >= 500 ? 502 : resp.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: `Anthropic API error: ${resp.status}`,
          text: 'Chat hit an upstream error. Please try again in a moment.',
        }),
      };
    }

    const data = await resp.json();
    const text = (data.content?.[0]?.text) || '';
    const tokensIn = data.usage?.input_tokens || 0;
    const tokensOut = data.usage?.output_tokens || 0;

    // Heuristic: derive goal from intake if present for the protocol ID
    const goal = intake?.goals?.[0] || 'general';
    const tier = evidenceMode || 'clinical';
    const protocolId = generateProtocolId({ goal, tier });

    console.log('[vitalis-chat] ok', { model, tokensIn, tokensOut, protocolId });

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        tokensIn,
        tokensOut,
        model,
        moderation: mod.flagged ? mod : null,
        protocolId,
      }),
    };
  } catch (err) {
    console.error('[vitalis-chat] handler error:', err.message);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: err.message || 'Internal error',
        text: 'Chat hit an unexpected error. Please try again.',
      }),
    };
  }
};
