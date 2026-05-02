/**
 * Netlify Background Function: /.netlify/functions/vitalis-chat-background
 *
 * Receives the full chat payload from vitalis-chat.js (the sync router),
 * calls the Anthropic API (no time limit — background functions get 15 min),
 * and writes the result to Netlify Blobs keyed by runId.
 *
 * The `-background.js` suffix is what signals Netlify to treat this as a
 * Background Function with a 15-minute timeout instead of the 10-second
 * sync limit.
 *
 * POST body (from vitalis-chat.js sync router — NOT from the browser):
 *   {
 *     runId: string,
 *     userMessage: string,
 *     history: [{role, content}],
 *     intake: {...} | null,
 *     catalog: {...} | null,
 *     evidenceMode: 'clinical' | 'community',
 *     stackContext: string | null,
 *     model: string,
 *     maxTokens: number,
 *     temperature: number
 *   }
 *
 * On success, writes to Blob key: vitalis-chat-runs/<runId>
 *   { status: 'complete', result: { text, tokensIn, tokensOut, model, protocolId, moderation } }
 *
 * On failure, writes:
 *   { status: 'error', error: string }
 *
 * Blob retention: each entry is written with metadata.expiresAt = writtenAt + 1h.
 * Netlify Blobs does NOT auto-delete by metadata — a separate sweep job is
 * expected to enumerate the store and remove keys past expiresAt.
 *
 * Bug #1 fix (2026-05-01): this function now requires a valid x-internal-sig
 * HMAC header. The sync router signs every dispatch; direct/unauthorized
 * POSTs are refused with 401 before any Anthropic call.
 *
 * Bug #2 fix (2026-05-01): moderation is now executed here as the first
 * step of the handler, using the SAME shared rules as vitalis-chat.js. A
 * leaked URL alone cannot bypass minors / self-harm / illegal-substance
 * refusals.
 */

const { getStore } = require('@netlify/blobs');
const { moderateMessage } = require('../lib/moderation');
const { verify: verifyInternal, SIG_HEADER } = require('../lib/internal-sig');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// 1 hour Blob retention (Bug #3 fix).
const BLOB_TTL_MS = 60 * 60 * 1000;

// CORS — tightened to refuse direct browser calls. Background functions
// are server-to-server only; the sync router is the public entry point.
// We keep OPTIONS handling for symmetry/health checks but advertise no
// allowed origin and no allowed headers, so a browser preflight will fail.
const CORS = {
  'Access-Control-Allow-Origin': 'null',
  'Access-Control-Allow-Headers': '',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};

// ---------------------------------------------------------------------------
// System-prompt composers (server-controlled — clients cannot override)
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

function generateProtocolId({ goal = 'general', tier = 'clinical', seq = 1 } = {}) {
  const d = new Date();
  const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const safeGoal = String(goal).toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20);
  const safeTier = String(tier).toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 12);
  const seqPad = String(seq).padStart(3, '0');
  return `VIT-PROTO-${yyyymmdd}-${safeGoal}-${safeTier}-${seqPad}`;
}

// ---------------------------------------------------------------------------
// Blob helpers — explicit credentials for sites without auto-injected context
// ---------------------------------------------------------------------------

const BLOBS_SITE_ID  = process.env.NETLIFY_SITE_ID  || '8d46991f-47d3-4d57-a5f5-f27d07c4048e';
const BLOBS_TOKEN    = process.env.NETLIFY_TOKEN    || process.env.NETLIFY_AUTH_TOKEN;

function getBlobsStore() {
  if (BLOBS_TOKEN) {
    return getStore({ name: 'vitalis-chat-runs', siteID: BLOBS_SITE_ID, token: BLOBS_TOKEN });
  }
  return getStore('vitalis-chat-runs');
}

async function writeResult(runId, payload) {
  const store = getBlobsStore();
  const writtenAt = new Date();
  const expiresAt = new Date(writtenAt.getTime() + BLOB_TTL_MS);
  // Bug #3 fix: explicit expiresAt metadata. Netlify Blobs does not auto-
  // expire — the prior doc-comment ("auto-expire at 1 hour via metadata.ttl")
  // was theater. A separate sweep job (out of scope) will purge stale keys.
  await store.setJSON(
    runId,
    {
      ...payload,
      writtenAt: writtenAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
    { metadata: { expiresAt: expiresAt.toISOString(), ttlMs: BLOB_TTL_MS } }
  );
}

// ---------------------------------------------------------------------------
// Main handler — Background function
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

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    runId,
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

  if (!runId) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'runId is required' }) };
  }

  // -------------------------------------------------------------------------
  // Bug #1 fix — HMAC signature verification.
  // Background function is at a public URL. Without auth, anyone can POST
  // and burn Marc's ANTHROPIC_API_KEY. The sync router signs every internal
  // dispatch; we verify before doing anything expensive.
  // Fail closed: missing secret env var → 401, never silent pass-through.
  // -------------------------------------------------------------------------
  const internalSecret = process.env.INTERNAL_FN_SECRET;
  // Header names are lowercased by Netlify; check both forms defensively.
  const sigHeaderValue =
    (event.headers && (event.headers[SIG_HEADER] || event.headers[SIG_HEADER.toLowerCase()])) || '';
  const sigCheck = verifyInternal(internalSecret, sigHeaderValue, runId);
  if (!sigCheck.ok) {
    console.warn('[vitalis-chat-background] reject unauthenticated call', {
      runId,
      reason: sigCheck.reason,
      ip: event.headers?.['x-nf-client-connection-ip'] || event.headers?.['x-forwarded-for'] || 'unknown',
    });
    return {
      statusCode: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  if (!userMessage || typeof userMessage !== 'string') {
    await writeResult(runId, { status: 'error', error: 'userMessage is required' });
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'userMessage is required' }) };
  }

  // -------------------------------------------------------------------------
  // Bug #2 fix — moderation runs in BOTH paths (sync router + background).
  // Defense-in-depth: even if the sig check above is somehow bypassed in a
  // future regression, the same minors / self-harm / illegal-substance
  // refusals fire here too. No Anthropic call on a flagged prompt.
  // -------------------------------------------------------------------------
  const mod = moderateMessage(userMessage);
  if (mod.flagged && mod.trigger.severity === 'block') {
    console.log('[vitalis-chat-background] moderation block:', mod.trigger.id, { runId });
    await writeResult(runId, {
      status: 'complete',
      result: {
        text: mod.trigger.response,
        tokensIn: 0,
        tokensOut: 0,
        model,
        protocolId: null,
        moderation: mod,
      },
    });
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, status: 'moderation_block', trigger: mod.trigger.id }),
    };
  }

  if (!ANTHROPIC_KEY) {
    const errPayload = {
      status: 'error',
      error: 'ANTHROPIC_API_KEY not configured',
      text: 'Chat is temporarily offline. Please check back soon — or use the "Book Consult" button to reach Marc directly.',
    };
    await writeResult(runId, errPayload).catch(() => {});
    return {
      statusCode: 503,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(errPayload),
    };
  }

  const systemPrompt = buildSystemPrompt({ catalog, intake, evidenceMode, stackContext });

  const messages = [
    ...history
      .filter(m => m && m.role && m.content)
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content).slice(0, 20000),
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
      console.error('[vitalis-chat-background] Anthropic error:', resp.status, errText.slice(0, 500));
      await writeResult(runId, {
        status: 'error',
        error: `Anthropic API error: ${resp.status}`,
        text: 'Chat hit an upstream error. Please try again in a moment.',
      });
      return {
        statusCode: resp.status >= 500 ? 502 : resp.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Anthropic API error: ${resp.status}` }),
      };
    }

    const data = await resp.json();
    const text = (data.content?.[0]?.text) || '';
    const tokensIn = data.usage?.input_tokens || 0;
    const tokensOut = data.usage?.output_tokens || 0;

    const goal = intake?.goals?.[0] || 'general';
    const tier = evidenceMode || 'clinical';
    const protocolId = generateProtocolId({ goal, tier });

    console.log('[vitalis-chat-background] ok', { runId, model, tokensIn, tokensOut, protocolId });

    await writeResult(runId, {
      status: 'complete',
      result: {
        text,
        tokensIn,
        tokensOut,
        model,
        protocolId,
        moderation: null,
      },
    });

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, status: 'complete' }),
    };
  } catch (err) {
    console.error('[vitalis-chat-background] handler error:', err.message);
    await writeResult(runId, {
      status: 'error',
      error: err.message || 'Internal error',
      text: 'Chat hit an unexpected error. Please try again.',
    }).catch(() => {});
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Internal error' }),
    };
  }
};
