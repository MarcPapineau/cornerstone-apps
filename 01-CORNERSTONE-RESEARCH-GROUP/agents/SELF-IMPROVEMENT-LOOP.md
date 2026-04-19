# Auto-Research / Self-Improvement Loop

**Owner:** Marc Papineau
**Maintainer:** Claude (in Code)
**Version:** v1.0 — spec only
**Date:** 2026-04-18 (night build)
**Companion docs:** `SCORECARD-SYSTEM.md`, `AGENT-EVOLUTION-GOVERNANCE-SYSTEM.md`

---

## PURPOSE

Every agent gets weekly auto-research + self-improvement cycle. The loop generates **proposals**, never deploys autonomously. Marc one-click approves. KRITE validates before approval is offered.

**Standing rule (Marc):** Agents observe + recommend. They do NOT modify production behavior without governance approval. (See `AGENT-EVOLUTION-GOVERNANCE-SYSTEM.md`.)

---

## THE WEEKLY CYCLE (per agent)

```
Monday 06:00 ET — for each active agent:

1. Pull scorecard trend
   ↳ Read agents/scorecards/{agent-id}.json
   ↳ Compute: 7-day delta, 30-day delta, lowest-scoring criterion

2. Web research recent best-practices
   ↳ WebSearch query templated by role
     (e.g., "voice AI concierge booking conversion best practices 2026")
   ↳ Return top 5 results with publication dates < 90 days

3. Propose prompt diff
   ↳ Compare lowest-scoring criterion's evidence vs. researched best practice
   ↳ Generate diff against current prompt
   ↳ Write to agents/{agent-id}/proposals/YYYY-MM-DD.md

4. KRITE validates
   ↳ POST proposal to KRITE webhook
   ↳ KRITE returns: APPROVED / NEEDS REVISION / REJECTED

5. Notify Marc via /command/ dashboard + push notification
   ↳ One-click APPROVE → applies via Vapi/GHL/git API
   ↳ One-click REJECT → archives proposal with reason
   ↳ EDIT → opens proposal in editor, Marc tunes, then APPROVE
```

---

## PROPOSAL FILE SCHEMA

File: `agents/{agent-id}/proposals/YYYY-MM-DD.md`

```markdown
---
proposal_id: abigail-2026-04-21-001
agent_id: abigail
agent_name: Abigail
role: Voice concierge
date_proposed: 2026-04-21T06:14:00-04:00
proposed_by: auto-research-loop
trigger_reason: warmth subscore declined 88 → 71 over 7 days
scorecard_snapshot:
  current_grade: 79
  trend: declining
  lowest_subscore: warmth (71)
  evidence_lowest: "Abigail: 'Got it. Next question.' — no acknowledgment of prospect's named anecdote"
research_sources:
  - url: https://example.com/voice-ai-warmth-2026
    published: 2026-03-15
    relevance: "Top-quartile voice agents echo prospect's last 3 words before transitioning"
  - url: https://example.com/conversational-ai-callbacks
    published: 2026-04-02
    relevance: "Echo-and-reflect technique increased perceived warmth by 31% in A/B test"
expected_impact:
  metric: warmth subscore
  baseline: 71
  target: 85+
  confidence: 70%
test_plan: "Deploy to next 10 calls. Re-evaluate warmth subscore. Success: avg ≥ 85. Failure: < 78 OR booking_success drops."
failure_plan: "Revert to v1.0 prompt; flag for human review."
krite_status: PENDING
marc_status: PENDING
---

## Current prompt (relevant section)

```
You are Abigail, the voice concierge for Cornerstone Research Group...
[lines 14-25 of CALL-SCRIPT-v1.md system prompt]
```

## Proposed change

```diff
- Format: brief acknowledgment → one probe → listen → brief reflection → next.
+ Format: echo-and-reflect (repeat their last specific detail in your own words)
+         → one probe → listen → brief reflection that names ONE thing they said
+         → next.
+
+ Example: prospect says "we lost three renewals last quarter."
+ Abigail: "Three renewals last quarter — that's the kind of leak that
+ compounds. Was the issue catching them in time, or capacity to follow up?"
```

## Why this should work

[Synthesis: research finding + scorecard evidence + theoretical mechanism]

## Risks & mitigations

- **Risk:** Echo could feel patronizing if overdone. **Mitigation:** Limit to one echo per probe.
- **Risk:** Adds 2-3 sec per turn. **Mitigation:** Within 6-min target call duration.

## Verification

After deployment:
- [ ] Next 10 calls: warmth subscore averaged
- [ ] booking_success holds at baseline ≥ 60%
- [ ] No prospect comments "felt scripted" in transcripts
```

---

## KRITE VALIDATION RUBRIC FOR PROPOSALS

KRITE evaluates each proposal against this rubric BEFORE Marc sees it:

| Criterion | Weight | Pass bar |
|---|---|---|
| `evidence_quality` | 25 | Cited research is recent (< 90 days), credible source, on-topic |
| `diff_minimalism` | 20 | Smallest viable change. No scope creep. |
| `regression_risk` | 25 | Failure plan exists, baseline metric documented, rollback path clear |
| `goodhart_check` | 15 | Optimizes for outcome (booking, reply, fix), not vanity metric |
| `voice_consistency` | 15 | Doesn't break agent's established voice / brand |

**KRITE verdicts:**
- `APPROVED` — all criteria ≥ 70. Surface to Marc with one-click APPROVE button.
- `NEEDS REVISION` — any criterion 50–69. Auto-research loop revises and resubmits.
- `REJECTED` — any criterion < 50. Archive with reason. Flag for human review.

---

## DEPLOYMENT FLOW (after Marc approves)

| Agent | Deployment mechanism |
|---|---|
| **Abigail** | Vapi PATCH `/assistant/{id}` with new system prompt |
| **Benaiah** | Update `benaiah-send.js` system prompt constant; commit + Netlify auto-deploy |
| **KRITE** | Update `krite-review.js` prompt; commit + auto-deploy |
| **Apollos** | Update Apollos workflow node in n8n via API |
| **Daniel** | Update Daniel workflow node in n8n via API |
| **Riley** | Vapi PATCH (when role active) |
| **Claude in Code** | Update relevant memory file (e.g., `MEMORY.md` rule addendum) — surfaces in next session boot |

Every deployment also writes to scorecard's `deployment_history`:
```json
{
  "date": "2026-04-21T08:14:00-04:00",
  "version": "v1.1.0",
  "change_summary": "Added echo-and-reflect to probe format",
  "approved_by": "marc",
  "krite_verdict": "APPROVED",
  "rollback_ref": "git commit abc123 (pre-deploy)"
}
```

---

## SCHEDULING

| Agent | Cron | Tooling |
|---|---|---|
| Abigail | Mon 06:00 ET | GHL workflow (cron trigger → webhook → auto-research function) |
| Benaiah | Mon 06:15 ET | Same |
| KRITE | Mon 06:30 ET | Same |
| Apollos | Mon 06:45 ET | Same |
| Daniel | Mon 07:00 ET | Same |
| Riley | Mon 07:15 ET | Same (when active) |
| Claude in Code | Session-end + weekly Mon 07:30 | Self-write to memory + scheduled task |

Stagger by 15 min to avoid concurrent web research throttling.

---

## FAILURE MODES & GUARDRAILS

| Failure mode | Guardrail |
|---|---|
| **Prompt regression** — proposal makes things worse | Failure plan mandatory; rollback if test window shows decline; auto-revert after 14 days if no improvement |
| **Infinite loop** — Judge keeps flagging same low score, auto-research keeps proposing same diff | Cooldown: same criterion can't trigger > 1 proposal per 14 days |
| **Scope creep** — proposal expands agent role | KRITE `diff_minimalism` check rejects proposals adding new responsibilities |
| **Sycophant drift** — auto-research proposes only flattering changes | Quarterly: Marc reviews 5 random proposals; if all "low-impact safe tweaks," prompt the loop to be more ambitious |
| **Goodhart's Law** — agent learns to game subscore (e.g., asks Q11 verbatim but rushes) | Rubric criteria check outcomes (was vision captured?), not procedure |
| **Stale research** — auto-research re-cites same source repeatedly | Dedup: `research_sources` URLs already cited in last 90 days are excluded |
| **KRITE conflict of interest** when KRITE proposes its own changes | Self-improvement proposals for KRITE are validated by Marc directly, not KRITE |
| **Marc bottleneck** — too many proposals stacked unread | Hard cap: max 3 pending proposals per agent; older proposals auto-archive after 30 days unread |
| **Web research returns garbage** — proposals based on SEO spam | Source allowlist: research returns only domains in approved list (anthropic.com, hbr.org, mckinsey.com, vendor blogs of tools we use, peer-reviewed) |
| **Agent prompt drifts via accumulated tweaks** | Quarterly: rebaseline. Marc reviews full prompt against original spec. Archive accumulated changes as v2.x; revert if drift unjustified. |

---

## DASHBOARD SURFACE (`/command/`)

**Self-Improvement panel:**

```
┌─────────────────────────────────────────────────────────────┐
│  PENDING PROPOSALS (3)                                       │
├─────────────────────────────────────────────────────────────┤
│  ▶ Abigail · 2026-04-21 · warmth +14 expected · KRITE ✓     │
│    [APPROVE] [EDIT] [REJECT]                                │
├─────────────────────────────────────────────────────────────┤
│  ▶ Apollos · 2026-04-20 · CTR +8 expected · KRITE ✓         │
│    [APPROVE] [EDIT] [REJECT]                                │
├─────────────────────────────────────────────────────────────┤
│  ▶ Benaiah · 2026-04-19 · reply rate +12 expected · KRITE ⚠ │
│    NEEDS REVISION — revising automatically                  │
└─────────────────────────────────────────────────────────────┘
```

Push notification when ≥ 1 proposal lands in `KRITE: APPROVED, MARC: PENDING`.

---

## CONNECTION TO GOVERNANCE

This loop is the implementation of `AGENT-EVOLUTION-GOVERNANCE-SYSTEM.md` Steps 1–5:

| Governance step | This loop |
|---|---|
| 1. Observe | Scorecards continuously updated by Judge (no approval needed) |
| 2. Evaluate | Weekly cron computes trend (no approval needed) |
| 3. Recommend | Auto-research generates proposal (no approval needed for proposal itself) |
| 4. Approve | KRITE pre-validates → Marc one-click approves on `/command/` |
| 5. Update | Deployment via API; scorecard logs `deployment_history`; rollback ready |

Escalation thresholds (from governance doc):
- Impact < 5%: Marc approves directly (default for prompt tweaks)
- Impact 5–20%: Marc + flag for follow-up review in 14 days
- Impact > 20%: Marc + structured A/B over 30 days before full deployment

---

## OPEN QUESTIONS FOR MARC

1. **Web search budget:** auto-research uses WebSearch; cost per agent per week ~$0.50. OK to proceed?
2. **Source allowlist:** want me to draft the initial allowlist or do you have one?
3. **Approval channel:** dashboard (PWA) is the canonical surface. OK to also notify via Telegram for off-hours visibility?
4. **Rebaseline cadence:** quarterly proposed. Tighter (monthly) for agents in active iteration like Abigail?
5. **KRITE judging KRITE:** confirm Marc reviews KRITE self-improvements directly. Should we build a separate "Meta-KRITE" agent or stay with Marc-as-final?

---

*v1.0 — Apr 18 2026 night · Spec only · Awaiting Marc's morning ratification*
