# CLAUDE-SURFACES.md — which Claude can touch your machine
Last updated: August 31, 2026

Written after an hour was lost to "Claude says it can't use the terminal."
Nothing was broken. Two different Claudes were being asked the same question.

---

## The one rule

**A Claude Code session in the cloud has a terminal. It is not your terminal.**

Cloud sessions run in an isolated Anthropic-managed VM that clones this repo
from GitHub. Anthropic's docs are explicit: "each cloud session is separated
from your machine." There is no route from that VM to `/Users/marcpapineau`,
no route to your `.openclaw` worktrees, no route to anything running on
localhost. That is the product's security boundary, not a bug and not a
misconfiguration — so there is no setting that "fixes" it.

Verified on a live cloud session, 2026-08-31:

```
hostname                    -> vm            (not Marc's Mac)
uname                       -> Linux 6.18.44-fc-v22 x86_64
ls /Users/marcpapineau      -> No such file or directory
```

That session's Bash tool worked perfectly. It just worked *there*.

---

## The surfaces

| Surface | Terminal on your Mac? | Use it for |
| :--- | :--- | :--- |
| Claude Code CLI in your own terminal | **Yes** | Anything local: worktrees, dashboards on localhost, `builder-control` gates, n8n, Make callbacks |
| Claude Code on the web / mobile (`claude.ai/code`) | **No** — cloud VM | Repo work that starts and ends in GitHub |
| Claude desktop/chat with connectors | **No** | Gmail, Drive, Notion, Slack, Make |

The AEGIS worktree at `~/.openclaw/worktrees/` is local-only. A cloud session
can never see it. Ask a cloud session about it and it will correctly tell you
it has no access.

---

## Stop copy-pasting — pick one

### 1. `/teleport` — pull the cloud session down to your Mac
The fix when a cloud session has done good thinking and now needs to run
commands locally. Inside the cloud session:

```
/teleport
```

It replies with the exact command. Run it from a checkout of this repo:

```bash
claude --teleport <session-id>
```

The **full conversation history** lands in your local terminal, on the
session's branch, with real access to your machine. Nothing is retyped.

Requirements: clean working tree (it will offer to stash), a checkout of the
same repo, the branch pushed, and the same claude.ai account. `--teleport` is
not `--resume`; `--resume` only reopens local history.

### 2. `/remote-control` — drive your Mac session from the web or phone
The reverse direction, and the one already running in the AEGIS terminal
(`/rc active` in the status bar). Start it in the **local** session:

```
/remote-control
```

Then steer that session from claude.ai or the mobile app. Commands execute on
your Mac, because the session lives on your Mac. **Talk to that session in the
session list — not to a new cloud session.** Opening a fresh cloud task and
asking it to reach your Mac is the mistake this document exists to prevent.

### 3. `--cloud` — push work up instead
Local terminal, sending a task to a cloud VM:

```bash
claude --cloud "Execute the migration plan in docs/migration-plan.md"
```

It clones the **GitHub remote at your current branch, not your local
checkout** — so push first, or local commits will not be there.

---

## Picking the right surface, first time

Ask one question: **does the work need to touch a file, port, or process that
only exists on the Mac?**

- **Yes** — local CLI, or `/teleport` an existing cloud session down.
  Examples: the AEGIS worktree, the dashboard on `127.0.0.1:8791`,
  `builder-control` git hooks (they only fire where they are installed —
  `hooks/install.sh`), anything reading `builder-control/.receipts/`.
- **No** — a cloud session is fine and often better, because it can commit,
  push, and open the PR itself with no copy-paste at all. That is the
  underrated part: for pure repo work the cloud session removes the terminal
  from the loop entirely.

---

## Related

- Cloud session behaviour: https://code.claude.com/docs/en/claude-code-on-the-web
- Remote Control: https://code.claude.com/docs/en/remote-control
- `builder-control/CONTROL-CONTRACT.md` — why local hook state is machine-local
  and is deliberately not shared through git (see `.gitignore`, Layer 3/4)
