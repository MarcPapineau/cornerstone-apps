<!--
  This template is the human-readable face of the Engineering OS gate.
  CI checks the machine-readable half; this half is what a person reads in six
  months when something breaks and they need to know what was actually verified.
  Doctrine: builder-control/AI-ENGINEERING-OS.md
-->

## What and why

<!-- One paragraph. What changes, and what problem it solves. -->

## Lane

<!--
  Paste the output of:
    node builder-control/engineering-os.cjs --classify --changed <path> [...]
  Do not hand-assign the lane — the classifier decides, and it fails toward FULL.
-->

- [ ] **LIGHT** — deterministic checks only
- [ ] **FULL** — independent review required
- [ ] **FULL + HIGH-RISK** — independent review + adversarial red team required

```
<paste --classify output here>
```

## Requirement and spec pin

**Requirement:**

**Approved source of intent:**
<!--
  A path, or an external source pinned as <uri>@<version>. If the intent came
  from a live page that is not pinned, write it as "UNVERIFIED: <source>" and
  say so plainly. An unpinned source is allowed; claiming spec-governance
  without one is not.
-->

## Baseline

<!--
  Recorded BEFORE the change, so pre-existing failures are not attributed to it.
-->

| | status |
|---|---|
| branch / base commit | |
| build | |
| typecheck | |
| lint | |
| unit tests | |
| known pre-existing failures | |

## Evidence

<!--
  Commands you actually ran, with exit codes. Anything not run says UNVERIFIED,
  never PASS.
-->

```
$ <command>
exit <n>
<output tail>
```

## Review records

<!--
  Each required reviewer needs a record conforming to
  builder-control/schemas/engineering-review.schema.json, bound to THIS diff's
  hash (node builder-control/engineering-os.cjs --diff-hash).
  A verdict on an earlier diff does not transfer.
-->

| reviewer | disposition | bound diff | record |
|---|---|---|---|
| codex (required on FULL) | | | |
| grok (required on HIGH-RISK) | | | |
| copilot (advisory — can block, cannot approve) | | | |

Gate output:

```
$ node builder-control/engineering-os.cjs --gate-done --packet <p> --diff-sha <sha> --changed <paths> --review <records>
```

## Impact

- **Architecture:**
- **Database:**
- **API contract:**
- **Security:**
- **UI/UX:**

## Unverified

<!--
  Everything nobody actually checked. This section being empty is a strong
  claim — make sure it is true.
-->

## Known risks and rollback

- **Risks:**
- **Rollback commit:**

---

### Checklist

- [ ] Lane assigned by the classifier, not by hand
- [ ] Source of intent pinned, or explicitly marked UNVERIFIED
- [ ] Baseline recorded before the change
- [ ] Tests added or updated for the requirement (not for the implementation)
- [ ] Every required reviewer has a record bound to this diff
- [ ] No unresolved CRITICAL or HIGH findings
- [ ] Nothing claimed as PASS that was not actually run
- [ ] No failing test deleted, skipped, or loosened to obtain green
