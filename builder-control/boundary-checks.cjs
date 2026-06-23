"use strict";

/**
 * boundary-checks.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Builder Control System v1 — Module 4 generalization (B3)
 *
 * Reusable PURE-function module. Every export returns:
 *   { violated: boolean, rule: "BC-...", reason: string }
 *
 * These are the GENERAL agent-boundary checks NOT covered by the existing scripts:
 *   - check-drift.cjs           → tier-matrix / SKU / string drift  (do not duplicate)
 *   - audit-protocol-content-contract.mjs → protocol content-contract (do not duplicate)
 *   - protocol-drafter-guard.js → STOP/DELEGATE/CANON interrupt patterns (do not duplicate)
 *   - brain.js validateBrain()  → brain structural integrity (do not duplicate)
 *
 * gate.cjs (B1) imports this module and decides process.exit.
 * This module NEVER calls process.exit or writes files.
 *
 * Source of truth:
 *   builder-control/CONTROL-CONTRACT.md §4, §6
 *   DIRECT-AGENT-BYPASS-CONTROL-2026-06-18.md (extra terms prior gates missed)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── RULE: BC-GOV-AUTHORITY-LEAK ──────────────────────────────────────────────
//
// Customer-facing text must NOT use North American government / regulatory
// agencies as a value-authority for Vitalis peptide claims.
//
// WHAT TO DETECT (from DIRECT-AGENT-BYPASS-CONTROL-2026-06-18.md — these are
// the EXTRA terms the prior gates missed):
//   ClinicalTrials.gov · NCT##### · U.S. regulator · 503A · 503B · approvalStatus
//   (the original gates already caught FDA / Health Canada phrases)
//
// WHAT TO ALLOW (MUST remain false — "mechanism studied in animals" is fine):
//   • Basic science / mechanism / discovery language without approval framing
//   • Internal brain source-key references (PMID:, DOI:, NCT: as data IDs)
//   • Evidence-boundary statements ("not approved for human use", "animal study")
//   • Text that cites an NCT number as a research citation, not as value-authority
//
// The heuristic: we fire on *authority assertions* — language that positions a
// government agency or regulatory designation as a quality/safety/approval stamp
// for the CUSTOMER's benefit. Plain science language ("a mechanism studied in
// animals") does not assert approval authority.

// Patterns that indicate gov-authority is being used as a VALUE stamp:
const GOV_AUTHORITY_PATTERNS = [
  // Original terms (kept here for completeness; prior gates may also catch these)
  /\bFDA[- ](?:approved|cleared|authorized|registered|regulated|recognized)\b/i,
  /\bFood\s+and\s+Drug\s+Administration[- ](?:approved|cleared|authorized)\b/i,
  /\bHealth\s+Canada[- ](?:approved|cleared|authorized|registered)\b/i,

  // Natural-language approval phrasing with interposed words — "the FDA has approved",
  // "Health Canada has cleared", "approved by the FDA". The 2026-06-22 Gate-G validation
  // found "The FDA has approved this peptide" slipped past the glued FDA-approved pattern
  // above because "has" sits between "FDA" and "approved".
  /\b(?:FDA|Food\s+and\s+Drug\s+Administration|Health\s+Canada)\s+(?:has\s+|have\s+|had\s+)?(?:approved|cleared|authorized|registered)\b/i,
  /\b(?:approved|cleared|authorized|registered)\s+by\s+(?:the\s+)?(?:FDA|Food\s+and\s+Drug\s+Administration|Health\s+Canada)\b/i,

  // Extra terms identified in the 2026-06-18 QA audit (DIRECT-AGENT-BYPASS):
  // The prior gates missed ClinicalTrials.gov and NCT##### entirely in customer copy.
  // Rule: ANY appearance of ClinicalTrials.gov or an NCT trial number in customer-facing
  // text is a leak — these are U.S. government trial registry references and must not
  // appear in customer-facing Vitalis/peptide copy. (Internal brain source keys use
  // the format "NCT:NCT01234567" inside JSON strings — those are suppressed by the
  // safe-pattern check above.)
  /ClinicalTrials\.gov/i,
  /\bNCT[0-9]{8}\b/i,

  // "U.S. regulator" as a positive quality stamp
  /\bU\.?S\.?\s+regulator(?:s|y)?\s+(?:approved?|cleared|recognize|endorse|confirm)/i,
  /(?:approved?|cleared|recognized|endorsed)\s+by\s+(?:the\s+)?U\.?S\.?\s+regulator/i,

  // 503A / 503B compounding designations used as quality claims in customer copy
  // ("503A-compliant" or "503B facility" used as a trust/safety stamp):
  /\b503[AB]\b.*\b(?:compliant|certified|approved|quality|grade|standard)\b/i,
  /\b(?:compliant|certified|approved|quality|grade|standard)\b.*\b503[AB]\b/i,

  // approvalStatus used as a value assertion (e.g. "approvalStatus: approved")
  // This catches the JSON/data-field leak DIRECT-AGENT-BYPASS flagged.
  /\bapprovalStatus\s*[:=]\s*["']?(?:approved|cleared|authorized)/i,
  // Also catches prose: "its approval status is approved"
  /\bapproval\s+status\s+(?:is|was|has\s+been)\s+(?:approved|cleared|authorized)\b/i,
];

// Negation / evidence-boundary phrasing that EXPLICITLY neutralizes an approval claim
// ("not FDA-approved", "FDA has not approved"). These are the ONLY prose patterns that
// exempt a matched leak — and only because they negate the SAME approval claim. A generic
// science word elsewhere in the text (e.g. "preclinical") must NOT excuse a co-located
// leak; that whole-function short-circuit was the 2026-06-22 Gate-G false-negative.
// Pure science language ("mechanism studied in animals", "preclinical") needs no exemption:
// it carries no gov-authority keyword, so it never matches a leak pattern to begin with.
const GOV_AUTHORITY_NEGATION_PATTERNS = [
  /\bnot\s+(?:FDA|Health\s+Canada|U\.?S\.?[\s-]+regulator[a-z]*)[- ](?:approved|cleared|authorized)\b/i,
  /\b(?:FDA|Health\s+Canada)\s+(?:has\s+not|have\s+not|hasn['']t|haven['']t)\s+(?:approved|cleared|authorized)\b/i,
];

// Internal brain source-key format ("NCT:NCT01234567", double-NCT, quoted in JSON) is a
// DATA id, not customer prose. It is stripped before the FINAL leak test so a raw brain
// record is not mistaken for customer-facing copy. A bare in-prose NCT number is still a leak.
const GOV_AUTHORITY_DATAKEY_PATTERN = /["']NCT:NCT[0-9]{8}["']/g;

/**
 * govLeak(text)
 *
 * Returns { violated: true, rule, reason } if the text uses FDA / Health Canada /
 * ClinicalTrials.gov / NCT##### / 503A / 503B / "U.S. regulator" / approvalStatus
 * as a value-authority in customer-facing copy.
 *
 * Returns { violated: false, ... } for legitimate evidence language like
 * "mechanism studied in animals" or bare NCT citations.
 *
 * Does NOT check for STOP/DELEGATE/CANON patterns (protocol-drafter-guard.js).
 * Does NOT check brain structural integrity (brain.js validateBrain).
 *
 * @param {string} text  — the candidate customer-facing text
 * @returns {{ violated: boolean, rule: string, reason: string }}
 */
function govLeak(text) {
  const RULE = "BC-GOV-AUTHORITY-LEAK";
  const t = String(text || "");

  // 1. Is any hard gov-authority leak pattern present at all? If none, it is safe —
  //    pure science language ("animal study", "preclinical") carries no leak keyword.
  const leakMatch = GOV_AUTHORITY_PATTERNS.find((p) => p.test(t));
  if (!leakMatch) {
    return {
      violated: false,
      rule: RULE,
      reason: "No government/regulatory authority pattern present.",
    };
  }

  // 2. A leak matched. The ONLY thing that exempts it is an explicit negation that
  //    neutralizes the SAME approval claim ("not FDA-approved"). A safe word elsewhere
  //    in the text does NOT excuse a co-located leak — that was the Gate-G short-circuit bug.
  const negationMatch = GOV_AUTHORITY_NEGATION_PATTERNS.find((p) => p.test(t));
  if (negationMatch) {
    return {
      violated: false,
      rule: RULE,
      reason: `Approval claim explicitly negated (matched /${negationMatch.source.slice(0, 50)}…/); evidence-boundary language, not a leak.`,
    };
  }

  // 3. If the only leak is the internal brain NCT data-key format, it is JSON data, not
  //    customer copy. Strip those and re-test; a real in-prose leak still trips the rule.
  const stripped = t.replace(GOV_AUTHORITY_DATAKEY_PATTERN, "");
  if (!GOV_AUTHORITY_PATTERNS.some((p) => p.test(stripped))) {
    return {
      violated: false,
      rule: RULE,
      reason: "Only internal brain NCT data-key(s) present; no customer-facing gov-authority leak.",
    };
  }

  // 4. Real customer-facing government-authority leak.
  return {
    violated: true,
    rule: RULE,
    reason:
      `Customer-facing text uses government/regulatory authority as a value stamp: matched /${leakMatch.source}/. ` +
      `Remove regulatory-agency value-authority language. Evidence language (animal studies, mechanism, ` +
      `preclinical) is allowed; approval / registry / trial-registry claims are not.`,
  };
}

// ── RULE: BC-INVENTED-AUTHORITY ──────────────────────────────────────────────
//
// An agent asserts a source-of-truth / dosing / evidence-tier it is not the
// canonical owner of per the registry's forbiddenTasks.
//
// The canonical owners per the control contract §6 and DIRECT-AGENT-BYPASS:
//   - Dosing / schedules / blends / evidence tiers → protocol-core (packages/protocol-core)
//   - Research Brain / scoring / discovery lineage → brain.js / scoring.js owners
//   - Customer-facing release / doctrine changes → KRITE + Marc
//   - Protocol completion claims → requires evidence: paths, cmds, verdicts, gaps
//
// This check flags text patterns where a non-canonical agent appears to ASSERT
// these authorities rather than deferring to them. The calling gate resolves the
// actual agentRecord from the registry; this function checks the text content
// against the forbidden-authority patterns AND the agentRecord.forbiddenTasks.

const INVENTED_AUTHORITY_TEXT_PATTERNS = [
  // Asserting dosing without attribution to canon
  /\b(?:the\s+correct|proper|right|recommended|optimal|standard)\s+dose\s+(?:is|for)\b/i,
  /\bI\s+(?:calculated|computed|determined|set|recommend(?:ed)?)\s+the\s+dose\b/i,
  // Asserting evidence tier without sourcing from brain
  /\bI\s+(?:classified|rated|scored|tiered)\s+this\s+(?:as|at)\s+(?:T[1-4]|tier)\b/i,
  /\bevidence\s+tier\s+(?:is|was)\s+(?:T[1-4])\b/i,
  // Asserting a parallel canon / scoring / brain
  /\bI\s+(?:built|created|made|generated|assembled)\s+(?:a|the|my)?(?:\s*own)?\s*(?:research\s+)?brain\b/i,
  /\bmy\s+(?:own|custom|parallel)\s+(?:scoring|dosing|brain|protocol|canon)\b/i,
  // Asserting protocol completion without evidence
  /\b(?:protocol\s+is|build\s+is)\s+(?:complete|done|finished|ready)\b(?![^.]*(?:file|path|command|test|audit|sha))/i,
  // Asserting source-of-truth ownership
  /\bI\s+(?:am|am\s+now)\s+the\s+source\s+of\s+truth\b/i,
  /\bthis\s+(?:file|document)\s+is\s+the\s+(?:canonical|source[-\s]of[-\s]truth)\b/i,
];

/**
 * inventedAuthority(text, agentRecord)
 *
 * Flags text that asserts source-of-truth / dosing / evidence-tier authority
 * that the agent is not the canonical owner of.
 *
 * @param {string} text        — candidate output text
 * @param {object} agentRecord — the agent's registry record (from agent-registry.json).
 *                               May be null/undefined for unregistered agents.
 * @returns {{ violated: boolean, rule: string, reason: string }}
 */
function inventedAuthority(text, agentRecord) {
  const RULE = "BC-INVENTED-AUTHORITY";
  const t = String(text || "");

  // If the agent's forbiddenTasks includes authority-related tasks, any match fires.
  const agent = agentRecord || {};
  const forbidden = Array.isArray(agent.forbiddenTasks) ? agent.forbiddenTasks : [];

  // Note: task strings may use underscores (e.g. "dosing_authority", "brain_ownership")
  // so we match the root keyword without requiring a trailing word boundary after it.
  const hasForbiddenAuthorityTask = forbidden.some((task) =>
    /(dosing|evidence[_-]?tier|source[_-]?of[_-]?truth|brain|scoring|protocol[_-]?content)/i.test(String(task))
  );

  for (const pattern of INVENTED_AUTHORITY_TEXT_PATTERNS) {
    if (pattern.test(t)) {
      // If the agent is not the canonical owner (has relevant forbidden tasks, or is unregistered),
      // the match is a violation.
      if (hasForbiddenAuthorityTask || !agent.agentId) {
        return {
          violated: true,
          rule: RULE,
          reason:
            `Agent "${agent.agentId || "UNREGISTERED"}" output asserts authority it does not own: ` +
            `matched /${pattern.source}/. ` +
            `Route dosing / evidence-tier / brain assertions to the canonical owner.`,
        };
      }
    }
  }

  return {
    violated: false,
    rule: RULE,
    reason: "No invented-authority assertion detected.",
  };
}

// ── RULE: BC-DOSING-OUT-OF-CANON ─────────────────────────────────────────────
//
// Dosing / schedule / blend not sourced from protocol-core canon.
//
// The existing check-drift.cjs already guards the TIER_MATRIX_SUMMARY text in
// the running app. This check guards GENERATED OUTPUT that contains dosing
// assertions not traceable to protocol-core paths. We detect this via text
// signals — if the text asserts specific doses/schedules without citing the
// canonical sources.
//
// NOTE: This check does NOT duplicate check-drift.cjs (which diffs the deployed
// tier-matrix string against its canonical definition). This check targets agent
// OUTPUT TEXT that invents dosing.

const DOSING_ASSERTION_PATTERNS = [
  // Specific numeric doses asserted without a canon citation
  /\b\d+\s*(?:mg|mcg|IU|units?)\s+(?:per|a|every|twice|three\s+times?)\s+(?:week|day|dose)\b/i,
  /\b(?:dose|dosage|dosing)\s+(?:of|is|was|at)\s+\d+/i,
  // Schedule assertions
  /\b(?:inject|take|administer)\s+(?:once|twice|three\s+times?)\s+(?:a|per)\s+week\b/i,
  // Blend / stack assertions
  /\bstack(?:ed|ing)?\s+with\b/i,
  /\bco[-\s]?(?:dose|admin(?:ister)?)\b/i,
];

// Patterns that indicate the text IS citing canon sources (OK):
const DOSING_CANON_CITATION_PATTERNS = [
  /protocol[-\s]core/i,
  /packages\/protocol[-\s]core/i,
  /dosing\.js/i,
  /canon(?:ical)?\s+(?:dose|dosing|schedule|source)/i,
  /per\s+(?:the\s+)?(?:canon|protocol-core|dosing\.js)/i,
  /sourced\s+from\s+(?:canon|protocol-core)/i,
];

/**
 * dosingOutOfCanon(text)
 *
 * Returns violated=true if the text asserts specific dosing/schedule/blend
 * language WITHOUT citing protocol-core canon as the source.
 *
 * This check is TEXT-LEVEL and heuristic. It is intentionally conservative:
 * it fires on unattributed dosing assertions. The gate may accept a suppression
 * via packet authorization for canon-write operations.
 *
 * Does NOT duplicate check-drift.cjs (which checks the deployed tier-matrix
 * string at build time, not agent output text).
 *
 * @param {string} text
 * @returns {{ violated: boolean, rule: string, reason: string }}
 */
function dosingOutOfCanon(text) {
  const RULE = "BC-DOSING-OUT-OF-CANON";
  const t = String(text || "");

  // If text cites canon, it is not out-of-canon
  const citesCannon = DOSING_CANON_CITATION_PATTERNS.some((p) => p.test(t));
  if (citesCannon) {
    return {
      violated: false,
      rule: RULE,
      reason: "Text cites protocol-core canon as source; dosing assertion is attributed.",
    };
  }

  for (const pattern of DOSING_ASSERTION_PATTERNS) {
    if (pattern.test(t)) {
      return {
        violated: true,
        rule: RULE,
        reason:
          `Text contains dosing/schedule/blend assertion not attributed to protocol-core canon: ` +
          `matched /${pattern.source}/. ` +
          `Source dosing from packages/protocol-core/data/dosing.js.`,
      };
    }
  }

  return {
    violated: false,
    rule: RULE,
    reason: "No unattributed dosing assertion detected.",
  };
}

// ── RULE: BC-PUBLIC-PUSH ──────────────────────────────────────────────────────
//
// Paths under public-repo directories (per control contract §5) must not be
// pushed without packet authorization.allowsPublicPush === true.
//
// Public-repo paths (from CONTROL-CONTRACT.md §5):
//   cornerstoneregroup-site/**  → pushes to github.com/MarcPapineau/cornerstoneregroup-site
//   peptide-resource-app/**     → cornerstone-apps remote
//   packages/**                 → cornerstone-apps remote

const PUBLIC_REPO_PATH_PATTERNS = [
  /(?:^|\/)cornerstoneregroup[-_]site\//i,
  /(?:^|\/)peptide[-_]resource[-_]app\//i,
  /(?:^|\/)packages\//i,
];

/**
 * publicPush(path)
 *
 * Returns violated=true if the path is under a public-repo directory as defined
 * in the control contract §5.
 *
 * The GATE (gate.cjs, B1) checks this against the packet's allowsPublicPush flag.
 * This function only reports whether the path IS a public-repo path.
 *
 * @param {string} path — the file path or git ref path being pushed/committed
 * @returns {{ violated: boolean, rule: string, reason: string }}
 */
function publicPush(path) {
  const RULE = "BC-PUBLIC-PUSH";
  const p = String(path || "");

  for (const pattern of PUBLIC_REPO_PATH_PATTERNS) {
    if (pattern.test(p)) {
      return {
        violated: true,
        rule: RULE,
        reason:
          `Path "${p}" is under a public-repo directory (matched ${pattern.source}). ` +
          `A git push touching this path requires a task packet with authorization.allowsPublicPush === true.`,
      };
    }
  }

  return {
    violated: false,
    rule: RULE,
    reason: `Path "${p}" is not under a protected public-repo directory.`,
  };
}

// ── RULE: BC-CUSTOMER-COPY-NO-KRITE ──────────────────────────────────────────
//
// A customer-facing protocol artifact must carry KRITE approval markers before
// release. The existing audit-protocol-content-contract.mjs --require-krite-approved
// is the CANONICAL release gate. This function is a LIGHTWEIGHT PRE-CHECK that
// the gate can call on the artifact TEXT before shelling the full audit script.
//
// Required KRITE markers (from CLAUDE.md / content-contract):
//   KRITE REQUIRED: YES
//   KRITE STATUS: APPROVED
//   USER APPROVAL STATUS: APPROVED  (or NOT REQUIRED)
//   CURRENT STATE: APPROVED  (or RELEASED)
//
// If ANY of these is missing or has the wrong value, violated=true.
// gate.cjs should ALSO shell audit-protocol-content-contract.mjs --require-krite-approved
// for the full check; this function adds a fast pre-check.

const KRITE_MARKER_CHECKS = [
  {
    pattern: /KRITE\s+REQUIRED\s*:\s*YES/i,
    description: "KRITE REQUIRED: YES marker",
  },
  {
    pattern: /KRITE\s+STATUS\s*:\s*APPROVED/i,
    description: "KRITE STATUS: APPROVED marker",
  },
  {
    pattern: /USER\s+APPROVAL\s+STATUS\s*:\s*(?:APPROVED|NOT\s+REQUIRED)/i,
    description: "USER APPROVAL STATUS: APPROVED or NOT REQUIRED marker",
  },
  {
    pattern: /CURRENT\s+STATE\s*:\s*(?:APPROVED|RELEASED)/i,
    description: "CURRENT STATE: APPROVED or RELEASED marker",
  },
];

/**
 * customerCopyNoKrite(artifactText, artifactPath)
 *
 * Returns violated=true if the artifact text is a customer-facing protocol
 * artifact (detected by path or content) but lacks KRITE approval markers.
 *
 * @param {string} artifactText  — full text of the artifact (HTML or markdown)
 * @param {string} artifactPath  — path to the artifact file (used for path check)
 * @returns {{ violated: boolean, rule: string, reason: string }}
 */
function customerCopyNoKrite(artifactText, artifactPath) {
  const RULE = "BC-CUSTOMER-COPY-NO-KRITE";
  const text = String(artifactText || "");
  const path = String(artifactPath || "");

  // Determine if this looks like a customer-facing protocol artifact:
  // By path: matches the protected-paths pattern from §5
  const isProtocolPath =
    /01[-_]CORNERSTONE[-_]RESEARCH[-_]GROUP.*protocol.*\.html$/i.test(path) ||
    /protocol[-_]guide.*\.html$/i.test(path) ||
    /protocol.*\.html$/i.test(path);

  // By content: has standard protocol content markers
  const hasProtocolContent =
    /PROTOCOL\s+GUIDE/i.test(text) ||
    /VITALIS\s+PROTOCOL/i.test(text) ||
    /KRITE\s+REQUIRED/i.test(text);

  if (!isProtocolPath && !hasProtocolContent) {
    return {
      violated: false,
      rule: RULE,
      reason: "Artifact does not appear to be a customer-facing protocol artifact; KRITE check skipped.",
    };
  }

  // Check each required KRITE marker
  const missing = KRITE_MARKER_CHECKS.filter((check) => !check.pattern.test(text));

  if (missing.length > 0) {
    const missingList = missing.map((m) => m.description).join("; ");
    return {
      violated: true,
      rule: RULE,
      reason:
        `Customer-facing protocol artifact at "${path}" is missing KRITE approval markers: ${missingList}. ` +
        `Run: node scripts/audit-protocol-content-contract.mjs --file <guide> --strict --require-krite-approved`,
    };
  }

  return {
    violated: false,
    rule: RULE,
    reason: "All KRITE approval markers present.",
  };
}

// ── EXPORTS ───────────────────────────────────────────────────────────────────

module.exports = {
  govLeak,
  inventedAuthority,
  dosingOutOfCanon,
  publicPush,
  customerCopyNoKrite,
  // Expose pattern lists for testing / documentation
  _GOV_AUTHORITY_PATTERNS: GOV_AUTHORITY_PATTERNS,
  _GOV_AUTHORITY_NEGATION_PATTERNS: GOV_AUTHORITY_NEGATION_PATTERNS,
  _GOV_AUTHORITY_DATAKEY_PATTERN: GOV_AUTHORITY_DATAKEY_PATTERN,
  _PUBLIC_REPO_PATH_PATTERNS: PUBLIC_REPO_PATH_PATTERNS,
};
