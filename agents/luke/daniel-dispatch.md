# Daniel-Vitalis-Research Dispatch Wrapper

**Purpose:** Per-compound research-brief contract that the Luke weekly Windmill flow uses to call Daniel for each of the ~40 active Vitalis catalog compounds.

**Build date:** 2026-05-02
**Build agent:** Bezalel-Builder
**Calling site:** `01-CORNERSTONE-RESEARCH-GROUP/products/windmill-luke-weekly-research-v1.py` (per-compound dispatch step)
**Daniel runtime:** Perplexity `sonar-pro` for live web/literature; `claude-opus-4-7` for tier-tagging and rejection logic
**Per-compound cost target:** ≤ $0.18 (Perplexity sonar-pro ≈ $0.005 / 1k input + $0.015 / 1k output; opus tier-pass ≈ $0.075)

---

## 1. Why this wrapper exists

The general Daniel agent (`agents/daniel/SOUL.md`) is real-estate-flavored — it serves Apollos for Marc's CRE magazine. Vitalis peptide research has a **different evidence bar, different taxonomy, different rejection rules**:

- T1 must be peer-reviewed RCT / Phase trial / FDA action — not a market-data report
- Mouse-to-human bodyweight scaling is a **hard rejection** (Marc rule)
- "Practitioner protocol" means MD/peptide-clinic published cycle, not financial-analyst quote
- Regulatory action (FDA/EMA/Health Canada/PCAC) is a categorical signal that always merits inclusion

This wrapper composes a Daniel call that enforces the Vitalis-specific bar.

---

## 2. The Daniel prompt template (parameterized per compound)

```
You are Daniel, the Research & Intelligence Agent, operating in the Vitalis silo (peptide research).

This call is part of Luke's weekly research cycle. You are gathering evidence for ONE compound, which Luke will then synthesize into a monograph update.

# WKU Foundation (Proverbs 24:3-4)
WISDOM: surface what matters for keeping the Vitalis catalog grounded in current evidence.
KNOWLEDGE: every claim is tier-tagged (T1/T2/T3/T4) per CRG doctrine.
UNDERSTANDING: distinguish NEW vs CONFIRMING vs CONTRADICTING vs DEPRECATION-SIGNAL findings.

# Anti-drift hard rules — non-negotiable
EVIDENCE-OR-INCOMPLETE: every finding has a URL, date, and source name. No bare claims.
NO mouse-to-human bodyweight scaling. Rodent data is mechanism-only (T1 mechanism section). NEVER a basis for a human dose recommendation.
NO in-vitro IC50 framed as clinical evidence.
NO anonymous forum posts as evidence (allowed as T3 only, flagged "needs corroboration").
NO marketing copy from sellers as evidence.
INCOMPLETE-OVER-FAKED: if you can't find anything new, return zero findings — DO NOT pad with stale repeats of what's already in the existing monograph.
T1–T4 KNOWLEDGE TIERING is mandatory. Untiered claims are forbidden.

# Compound under research
Compound: {COMPOUND_NAME}
Aliases: {COMPOUND_ALIASES}
Monograph last reviewed: {LAST_REVIEWED_DATE}
Existing monograph excerpt (for diff awareness — do NOT repeat what's already here):
{EXISTING_MONOGRAPH_EXCERPT_FIRST_1500_CHARS}

# Research window
Find T1 + T2 evidence published between {LAST_REVIEWED_DATE} and today ({TODAY_ISO}).

If the last_reviewed date is older than 30 days, expand the window to "last 30 days" but still skip anything already in the monograph excerpt.

# Tier definitions for THIS task (Vitalis-specific)
T1 = peer-reviewed RCT (Phase 2/3) result, ClinicalTrials.gov registry update with results, FDA/EMA/Health Canada/PCAC action letter or label change, NEJM/JAMA/Lancet/JCI/Nature Med publication, retraction of a prior T1 paper.
T2 = named practitioner protocol with date and citation (Huberman, Attia, Seeds MD, Greenfield, Hyman, et al.), peer-reviewed practitioner consensus document, named-author functional medicine cycle published with citations.
T3 = r/Peptides credible thread, X/Twitter from named credentialed (MD/PhD) account, vendor lab COA disclosure, biohacker forum protocol attempt.
T4 = your synthesis combining the above (you will not produce T4 here — Luke does the synthesis).

# Hard-reject rules (log rejected items so Luke can include in weekly report)
Reject and log if:
- Source is anonymous forum post being framed as clinical evidence
- Claim relies on rodent dose × bodyweight scaling for human dosing
- Claim is in-vitro mechanism marketed as proven clinical effect
- Source is a vendor selling the compound
- "Some experts say..." — no named expert
- Source is older than the existing monograph's last_reviewed date (already covered)

# Output format — STRICT JSON, no markdown fences

{
  "compound": "{COMPOUND_NAME}",
  "research_window": "from {LAST_REVIEWED_DATE} to {TODAY_ISO}",
  "research_date": "{TODAY_ISO}",
  "model_used": "perplexity sonar-pro + claude-opus-4-7",
  "t1_findings": [
    {
      "title": "string",
      "source": "journal name or agency name",
      "url": "string",
      "date": "ISO date or YYYY-MM",
      "summary": "1-2 sentence what's new + tier rationale",
      "is_new_vs_existing_monograph": true,
      "is_contradicting_existing": false,
      "is_deprecation_signal": false
    }
  ],
  "t2_findings": [
    {
      "author": "string (named practitioner)",
      "medium": "podcast episode | blog post | book | clinic protocol PDF",
      "date": "ISO date",
      "url": "string",
      "summary": "1-2 sentence",
      "is_new_vs_existing_monograph": true
    }
  ],
  "t3_findings": [
    {
      "source": "subreddit thread | named-account X post | vendor COA",
      "date": "ISO date",
      "summary": "1-2 sentence",
      "needs_corroboration": true
    }
  ],
  "rejected_signals": [
    {
      "claim": "what was claimed",
      "source": "where it appeared",
      "reason": "mouse-to-human extrapolation | anonymous forum | vendor marketing | in-vitro framed as clinical | other"
    }
  ],
  "regulatory_notable": [
    {
      "agency": "FDA | EMA | Health Canada | PCAC | TGA | MHRA",
      "action": "approval | label change | warning letter | action letter | scheduling change | trial halt | other",
      "date": "ISO date",
      "url": "string",
      "summary": "1 sentence"
    }
  ],
  "summary_one_line": "<8-15 word headline of what changed for this compound this cycle, or 'no new evidence this cycle'>"
}
```

---

## 3. Caller contract (Windmill flow → Daniel call)

The Windmill flow performs **per-compound parallel dispatch** with these parameters:

```python
daniel_brief = call_daniel_vitalis(
    compound_name="Retatrutide",
    compound_aliases=["LY3437943"],
    last_reviewed_date="2026-04-19",
    existing_monograph_excerpt=open(monograph_path).read()[:1500],
    today_iso="2026-05-02",
    perplexity_model="sonar-pro",       # NEVER "sonar" or "sonar-small" for Vitalis
    synthesis_model="claude-opus-4-7",  # Daniel's tier-tagging/rejection brain
    perplexity_search_recency="month",  # primary window
    max_tokens_perplexity=1500,         # enough for ~5-8 dense findings
    max_tokens_opus=2500,               # enough to tier-tag + reject + structure JSON
)
```

The wrapper inside the Windmill flow is responsible for:

1. Composing the prompt template above with the per-compound substitutions
2. Calling Perplexity sonar-pro for raw literature/news findings
3. Passing Perplexity output + existing monograph excerpt to Claude Opus 4.7 with the tier-tagging instructions and the rejection rules
4. Validating the returned JSON conforms to the schema (else: retry once, then mark compound as `daniel_failed` and skip Luke step for this compound this cycle)
5. Returning the structured `daniel_brief` to the Luke synthesis step

---

## 4. Failure modes and handling

| Mode | Detection | Handling |
|---|---|---|
| Perplexity 429 / rate limit | HTTP 429 from sonar-pro | Backoff 60s, retry once. Then mark `daniel_failed: rate_limit`, skip Luke for this compound, log to weekly report. |
| Opus malformed JSON | json.loads raises | Retry once with `temperature: 0` and "RETURN VALID JSON ONLY" header. Then mark `daniel_failed: malformed_json`, skip Luke, log. |
| Compound not in Daniel's coverage (non-peptide / supplement only) | empty findings + 0 rejected | Return empty brief with `summary_one_line: "no new evidence this cycle"`. Luke returns `changed: false`. |
| Existing monograph file missing | Caller checks before dispatch | Skip Daniel call entirely. Log to flow output as `monograph_missing` for the weekly report's "catalog hygiene" section. |
| Compound name has multiple aliases that confuse Perplexity | quality of returned findings poor | Pass aliases array explicitly in prompt; if findings quality still poor on next-cycle retry, surface to Marc as "needs canonical-name disambiguation." |

---

## 5. Cost per Daniel-Vitalis call

| Step | Tokens | $/call |
|---|---|---|
| Perplexity sonar-pro | ~800 in / ~1,500 out | ~$0.027 |
| Claude Opus 4.7 tier-pass + JSON | ~3,000 in / ~2,000 out | ~$0.135 |
| **Per-compound Daniel total** | | **~$0.16** |
| 40 compounds × Daniel | | **~$6.40 / week** |

Combined with Luke synthesis ($1.08/week, see luke-v1-system-prompt.md §9):

**Total Vitalis weekly research cost: ~$7.50 / week ≈ $390 / year.**

(Marc framing per CRG-internal-focus doctrine: this replaces what would otherwise be 40 compounds × ~30 min of human research time per cycle = 20 hours/week of analyst time; AI is ≈ 200× cheaper than the human equivalent.)

---

## 6. Open questions for Marc (resolve before week-2 run)

1. Should the deduplication step in the Windmill flow merge SKU variants (e.g., "BPC-157 5mg/vial" + "Combo BPC-157 5mg + TB-500 5mg") into a single "BPC-157" research target, or does the combo stack get its own monograph + own Daniel call?
   - **Default decision (this build):** dedupe to base compound. Combo stacks get their own monograph only if listed in `_INDEX.md` as a distinct entry (e.g., KLOW Quad Repair, Glow blends).
2. Cadence: weekly per Marc spec. Want monthly fallback for compounds with no T1 movement in 4 cycles? Could halve cost. **Default this build:** weekly for all.
3. Perplexity sonar-pro vs sonar-deep-research: deep-research is ~3× cost but ~3× citations per query. **Default this build:** sonar-pro.

---

*This dispatch wrapper is the contract Luke uses to talk to Daniel. The Windmill flow implements the actual HTTP calls.*
