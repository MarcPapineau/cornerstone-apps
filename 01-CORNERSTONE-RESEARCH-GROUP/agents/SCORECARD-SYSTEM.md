# Agent Scorecard System + Judge Agent

**Owner:** Marc Papineau
**Maintainer:** Claude (in Code)
**Version:** v1.0 — spec only, not yet wired
**Date:** 2026-04-18 (night build)
**Standing rule (Marc):** *"autresearch built into the agents. how they improve. same for you and all other agents. We should be getting a score card on all our agents organized by team, role, performances, tested by an agent who does just that."*

---

## PURPOSE

Every CRG agent (voice, email, quality gate, content, build — including Claude in Code itself) gets a measured, role-specific scorecard. A dedicated **Judge agent** evaluates outputs against rubrics and updates scorecards. Scorecards drive the self-improvement loop (`SELF-IMPROVEMENT-LOOP.md`) and the `/command/` dashboard leaderboard.

**Quality bar (non-negotiable):**
> A score without a rubric reference + an evidence quote is meaningless. Every evaluation includes both.

---

## DIRECTORY LAYOUT

```
01-CORNERSTONE-RESEARCH-GROUP/agents/
├── SCORECARD-SYSTEM.md                  ← this file
├── SELF-IMPROVEMENT-LOOP.md             ← weekly self-improvement spec
├── scorecards/
│   ├── abigail.json
│   ├── benaiah.json
│   ├── krite.json
│   ├── apollos.json
│   ├── daniel.json
│   ├── riley.json
│   └── claude-code.json
├── rubrics/
│   ├── voice-concierge.json
│   ├── outbound-email.json
│   ├── quality-gate.json
│   ├── article-writer.json
│   └── claude-code.json
├── CRG-Judge/
│   └── SYSTEM-PROMPT.md                 ← Judge agent prompt
└── {agent-id}/
    └── proposals/
        └── YYYY-MM-DD.md                ← self-improvement proposals
```

---

## SCORECARD SCHEMA

File: `agents/scorecards/{agent-id}.json`

```json
{
  "agent_id": "abigail",
  "name": "Abigail",
  "team": "Voice",
  "role": "Voice concierge — first-touch intake calls, books Discovery Brief",
  "rubric_id": "voice-concierge",
  "current_grade": 0,
  "trend": "stable",
  "recent_evaluations": [
    {
      "date": "2026-04-18T23:00:00-04:00",
      "score": 0,
      "evaluator": "CRG-Judge",
      "rubric_id": "voice-concierge",
      "evidence_quote": "PLACEHOLDER — no calls evaluated yet",
      "subscores": {},
      "notes": "Initial scorecard — pending first call evaluation"
    }
  ],
  "proposals_pending": 0,
  "last_self_improvement_run": null,
  "deployment_history": [],
  "active_version": "v1.0",
  "owner": "marc@cornerstoneregroup.ca"
}
```

### Field definitions

| Field | Type | Notes |
|---|---|---|
| `agent_id` | string | kebab-case, unique. Matches directory name. |
| `name` | string | Display name |
| `team` | enum | `Voice` / `Email` / `Quality` / `Content` / `Build` |
| `role` | string | One-sentence role definition |
| `rubric_id` | string | References `rubrics/{rubric_id}.json` |
| `current_grade` | integer 0–100 | Most recent overall grade. 0 = no evaluation yet. |
| `trend` | enum | `improving` / `stable` / `declining` (computed from last 5 evals) |
| `recent_evaluations` | array | Keep last 20. Each: `{date, score, evaluator, rubric_id, evidence_quote, subscores, notes}` |
| `proposals_pending` | integer | Count of un-reviewed self-improvement proposals |
| `last_self_improvement_run` | ISO 8601 | Last time the weekly auto-research ran |
| `deployment_history` | array | `{date, version, change_summary, approved_by}` |
| `active_version` | string | Current deployed prompt/config version (semver) |
| `owner` | email | Human accountable for this agent |

---

## INITIAL SCORECARDS (this build)

Seven agents, all with placeholder grades pending first evaluation. Files written to `agents/scorecards/`:

1. **`abigail.json`** — Voice concierge (rubric: `voice-concierge`)
2. **`benaiah.json`** — Outbound email (rubric: `outbound-email`)
3. **`krite.json`** — Quality gate / judge of outbound (rubric: `quality-gate`)
4. **`apollos.json`** — Article writer (rubric: `article-writer`)
5. **`daniel.json`** — Research / market intel (rubric: `article-writer` — shared, with research-emphasis subscores)
6. **`riley.json`** — Voice (TBD specific role; placeholder rubric `voice-concierge`)
7. **`claude-code.json`** — Yes, Claude in Code itself. Rubric: `claude-code`

---

## RUBRIC SCHEMA

File: `agents/rubrics/{rubric_id}.json`

```json
{
  "rubric_id": "voice-concierge",
  "version": "v1.0",
  "applies_to_team": "Voice",
  "scoring_window": "per-call",
  "weights": {
    "warmth": 15,
    "accuracy": 20,
    "q11_asked": 15,
    "booking_success": 25,
    "reality_check_passed": 25
  },
  "criteria": {
    "warmth": {
      "weight": 15,
      "description": "Tone is peer-to-peer, not robotic or salesy. Acknowledges prospect's specific answers.",
      "scoring": {
        "90_100": "Genuinely warm, named-back details, prospect felt heard",
        "70_89": "Professional and pleasant, no obvious robot tells",
        "50_69": "Functional, slightly mechanical",
        "0_49": "Cold, scripted, or pushy"
      },
      "evidence_required": "Quote ≥ 1 line where Abigail acknowledges prospect by name + specific answer"
    },
    "...": "see rubric files for full definitions"
  }
}
```

---

## RUBRICS — written this build

### `voice-concierge.json` (Abigail, Riley, future voice agents)

| Criterion | Weight | Pass bar |
|---|---|---|
| `warmth` | 15 | Tone peer-to-peer, names back details |
| `accuracy` | 20 | Confirms intake answers without misrepresenting |
| `q11_asked` | 15 | Q11 vision question asked verbatim, prospect given ≥ 90 sec uninterrupted |
| `booking_success` | 25 | Discovery Brief slot booked OR clean handoff if declined/handoff |
| `reality_check_passed` | 25 | No hallucinated CRG capabilities; no pricing quoted; handoff keywords honored |

### `outbound-email.json` (Benaiah)

| Criterion | Weight | Pass bar |
|---|---|---|
| `research_first` | 25 | References ≥ 1 verified prospect-specific fact (recent achievement, public quote, named project) |
| `krite_pass` | 25 | KRITE voice_score ≥ 75 on first review |
| `response_rate_30d` | 25 | Reply rate ≥ 8% over rolling 30 days for that send cohort |
| `compliance` | 15 | CASL footer present, opt-out path live, sender identity clear |
| `voice_match` | 10 | Reads as Marc / Alex / Ade persona consistently |

### `quality-gate.json` (KRITE)

| Criterion | Weight | Pass bar |
|---|---|---|
| `precision` | 30 | When KRITE flags content as "needs revision," human reviewer agrees ≥ 90% of time (low false positive) |
| `recall` | 30 | When content is actually broken (caught later by Marc or prospect), KRITE caught it ≥ 90% of time (low false negative) |
| `false_positive_rate` | 20 | Flags rejected unjustifiably ≤ 10% |
| `turnaround_time` | 10 | Median review < 30 sec |
| `actionable_feedback` | 10 | Each flagged issue includes specific line + suggested fix |

### `article-writer.json` (Apollos, Daniel)

| Criterion | Weight | Pass bar |
|---|---|---|
| `sourcing` | 25 | Every claim attributable; ≥ 3 cited sources per article |
| `voice` | 20 | Matches Marc's brand voice (direct, builder mentality, faith-informed, Ottawa-local) |
| `structure` | 15 | Headers, scannable, ≥ 1 visual, CTA present |
| `novelty` | 25 | Insight not findable in top-10 Google results for that topic — original framing or data |
| `compliance` | 15 | Disclaimers present (financial / health), no medical/financial advice without qualifier |

### `claude-code.json` (Claude in Code — yes, me)

| Criterion | Weight | Pass bar |
|---|---|---|
| `task_completion` | 30 | Delivered what Marc asked for, end to end, verified working |
| `parallel_agent_usage` | 15 | Used parallel tool calls / agents when sub-tasks were independent (per standing rule) |
| `root_cause_fixes` | 25 | Fixed root causes per Quality Doctrine, not symptoms; no repeat patches |
| `no_overreach` | 15 | Didn't gold-plate, didn't add unrequested scope, didn't deploy without KRITE |
| `verification` | 15 | Verified end-to-end (URL 200, feature works, file written + readable) before claiming "done" |

---

## JUDGE AGENT — `CRG-Judge`

A dedicated LLM agent whose only job is to evaluate other agents' outputs against their rubrics and write back to scorecards.

**System prompt:** `agents/CRG-Judge/SYSTEM-PROMPT.md` (written this build)

**Inputs to a Judge evaluation:**
1. The agent's output (call transcript, sent email, published article, code change diff, etc.)
2. The rubric JSON for that agent's role
3. Ground truth where available (e.g., did the prospect book? did the email get a reply? did the bug get fixed without recurring?)
4. Optional: peer comparisons (last 5 outputs from same agent)

**Output of a Judge evaluation:**
A JSON object appended to `recent_evaluations` in the agent's scorecard:

```json
{
  "date": "2026-04-19T08:32:00-04:00",
  "score": 87,
  "evaluator": "CRG-Judge",
  "rubric_id": "voice-concierge",
  "evidence_quote": "Abigail: 'You're at 8500 — that's a different scale problem entirely.' (named-back the specific number from intake)",
  "subscores": {
    "warmth": 90,
    "accuracy": 95,
    "q11_asked": 100,
    "booking_success": 100,
    "reality_check_passed": 50
  },
  "notes": "Reality-check failed: Abigail quoted '24-hour Marc response' which isn't in her knowledge base. Flag for KRITE review of system prompt."
}
```

**Hard rules for Judge:**
- Never give a score without quoting evidence (≥ 1 verbatim line from the agent's output)
- Always reference the specific rubric criterion the score addresses
- If subscore < 70, must include actionable note for the agent's next self-improvement proposal
- If evidence is missing or ambiguous, score the criterion as `null` and flag for human review (don't fabricate a score)

---

## WIRE-UP PLAN (spec only — not implemented this build)

### Per-output (real-time) evaluation

| Agent | Trigger | Hook | Source data |
|---|---|---|---|
| **Abigail** | Post-call (Vapi `end-of-call-report` webhook) | Netlify function `judge-abigail-call.js` | Vapi transcript + Q11 capture + GHL booking outcome |
| **Benaiah** | Post-send (BENAIAH `benaiah-send.js` already returns KRITE result; chain Judge after) | Netlify function `judge-benaiah-send.js` | Email body + KRITE scores + 30-day reply tracking (delayed) |
| **KRITE** | Sampled — every 10th KRITE verdict, plus all rejections | Cron weekly | KRITE verdict + Marc's after-the-fact agreement |

### Sampled (weekly) evaluation

| Agent | Frequency | Sample size |
|---|---|---|
| **Apollos** | Weekly Monday 09:00 | All articles published in prior 7 days |
| **Daniel** | Weekly Monday 09:00 | All research digests in prior 7 days |
| **Riley** | Weekly | Same as Abigail when role-active |
| **Claude in Code** | Per-session (session-end retrospective) | Each session writes `recent_evaluations` entry — Marc can override |

### Storage & sync

- Scorecards live in git (`01-CORNERSTONE-RESEARCH-GROUP/agents/scorecards/*.json`)
- Judge writes via authenticated Netlify function `scorecard-update.js` (NOT YET BUILT)
- Function commits the JSON change to the repo (auto-PR or direct push to main)
- `/command/` PWA dashboard reads scorecards via the same function (read endpoint)

### Dashboard surface (`/command/`)

- **Leaderboard view:** all agents sorted by `current_grade`, color-coded by trend
- **Detail view (per agent):** rubric breakdown, last 20 evaluations, evidence quotes inline, proposals pending
- **Push notification:** any `current_grade` drop > 10 points week-over-week → notify Marc

---

## FAILURE MODES (and guardrails)

| Failure mode | Guardrail |
|---|---|
| Judge inflates scores (sycophant drift) | Audit: every quarter, Marc reviews 10 random Judge evaluations; if Marc disagrees > 30%, retrain Judge prompt |
| Judge uses different rubric than the agent's `rubric_id` | Schema validation: Judge output rejected if `rubric_id` mismatch |
| Scorecard becomes garbage from one bad eval | Keep last 20 in `recent_evaluations`; outlier detection (any score > 2 SD from rolling avg flagged) |
| Agent gaming the rubric (Goodhart's Law) | Rubric criteria phrased as outcomes (booked, replied, fixed) not vanity metrics; quarterly rubric review |
| No ground truth available (early-stage agent) | Judge flags `ground_truth: null` in eval; subscores requiring it return `null`, not a guess |

---

## CONNECTION TO `SELF-IMPROVEMENT-LOOP.md`

This scorecard system is the **measurement layer**. The self-improvement loop is the **action layer**:

1. Judge writes scorecards (this doc)
2. Weekly cron reads scorecard trend (next doc)
3. If trend declining or grade < threshold, auto-research agent proposes a prompt diff
4. KRITE validates the proposal
5. Marc one-click approves via dashboard
6. Change deployed; new scorecard cycle begins

See `SELF-IMPROVEMENT-LOOP.md` for full spec.

---

## OPEN QUESTIONS FOR MARC

1. **Initial grades:** all seeded at 0. Confirm OK to start measuring from first real evaluation rather than backfilling estimates.
2. **Riley's role:** scorecard placeholder exists but role is undefined. Define before first eval.
3. **Claude-in-Code self-eval:** OK with me writing my own scorecard at session-end? Or do you want a separate Judge instance for me?
4. **Dashboard build priority:** scorecards JSON exists this build; the `/command/` view is in queue item #7. OK to defer?
5. **Vapi `end-of-call-report` webhook:** confirm this is wired or needs build (likely needs build).

---

*v1.0 — Apr 18 2026 night · Spec only, no implementation · Awaiting Marc's morning ratification*
