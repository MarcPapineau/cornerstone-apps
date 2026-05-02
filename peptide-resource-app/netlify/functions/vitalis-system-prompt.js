// netlify/functions/vitalis-system-prompt.js
// ---------------------------------------------------------------------------
// Server-side system prompt builder for /find-protocol.
//
// Why this lives server-side (not client, not env var):
//   - Client-controlled prompts let anyone repurpose our Anthropic key as a
//     general-purpose LLM (cost leak + reputational risk). Fixed in BUG #1.
//   - Storing the prompt as code (not an env var) keeps prompt evolution under
//     git history per CRG doctrine: "GitHub is the version-control source of
//     truth" (rule_github_version_control_source_of_truth.md).
//
// What the client may pass (ONLY):
//   - query (string)        — the user's situation/symptom description
//   - catalog (array)       — compact compound reference: [{ id, name, tagline, benefits }]
//
// The prompt template is FIXED here. The client CANNOT inject prompt text.
// ---------------------------------------------------------------------------

/**
 * Validate and sanitize a single catalog entry.
 * Strips unknown fields and coerces types so a malicious client can't smuggle
 * prompt content via, e.g., a benefits array containing 1000 lines of text.
 */
function sanitizeCatalogEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id      = typeof entry.id      === 'string' ? entry.id.slice(0, 64)      : '';
  const name    = typeof entry.name    === 'string' ? entry.name.slice(0, 120)   : '';
  const tagline = typeof entry.tagline === 'string' ? entry.tagline.slice(0, 240) : '';
  const benefits = Array.isArray(entry.benefits)
    ? entry.benefits.filter(b => typeof b === 'string').slice(0, 6).map(b => b.slice(0, 80))
    : [];
  if (!id || !name) return null;
  return { id, name, tagline, benefits };
}

/**
 * Build the system prompt server-side from a fixed template.
 * @param {Array<{id:string,name:string,tagline:string,benefits:string[]}>} catalog
 * @returns {string} system prompt
 */
function buildFindProtocolSystemPrompt(catalog) {
  const safeCatalog = Array.isArray(catalog)
    ? catalog.map(sanitizeCatalogEntry).filter(Boolean).slice(0, 60) // hard cap
    : [];

  const compoundContext = safeCatalog
    .map(c => `${c.name} (${c.id}): ${c.tagline}. Benefits: ${c.benefits.join(', ')}.`)
    .join('\n');

  return `You are a research assistant for a peptide education platform. Match someone's health goals or symptoms to the most relevant research peptides from this specific catalogue. You are NOT a doctor. All responses are framed as research information only — never as medical advice.

Available compounds:
${compoundContext}

RULES:
- Recommend 3-5 compounds maximum. Most relevant first.
- Each rationale: 2-3 sentences referencing the mechanism or published research, specific to this person's situation.
- Include a stackNote if 2+ compounds work well together.
- Be specific and concrete — name the mechanism, reference a study if relevant.
- priority values: "Primary" | "Supporting" | "Optional"
- Respond ONLY with valid JSON in this exact format:
{
  "intro": "1-2 sentence research summary",
  "compounds": [
    { "id": "compound_id", "name": "Compound Name", "priority": "Primary", "why": "2-3 sentence rationale", "tags": ["tag1","tag2"] }
  ],
  "stackNote": "how these work together, or empty string",
  "disclaimer": "For research purposes only. Not medical advice. Consult a qualified healthcare professional."
}`;
}

module.exports = { buildFindProtocolSystemPrompt, sanitizeCatalogEntry };
