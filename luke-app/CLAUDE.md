# My Vitalis Health — app instructions

Deliberately short. Rules that can be checked by a machine live in
`vitalis-resource-app/scripts/gate.sh`, not in this file. If you want to add a
rule here, first ask whether it can be a check instead — a check cannot drift.

## Where the app actually is

The real application is **`vitalis-resource-app/`**. Work there.

`luke-app/server.js` is a 28-line compatibility shim that re-exports the real
server for old launch contracts. `luke-app/tests/vitalis.spec.js` and
`luke-app/playwright.config.js` are **legacy** — they target port 3000 while the
app serves 3100, and they are not tracked in git. Do not wire new work to them.

## Definition of done

```bash
bash vitalis-resource-app/scripts/gate.sh
```

Green gate **and** green CI. Not "the tests I ran passed", not a summary saying
it works. Those two signals, or it is not done.

The gate runs automatically after any edit under `vitalis-resource-app/` via the
PostToolUse hook in `.claude/settings.json`. You do not need to be asked to run
it, and you should not report work complete while it is red.

CI (`.github/workflows/vitalis-app.yml`) runs the same script on GitHub and is
the boundary that actually blocks. The local hook is convenience; CI is the gate.

## Adding checks

Add them to `scripts/gate.sh` so CI, the hook, and Marc all pick them up at once.
Never add a check to only one caller — that is how "passing" starts meaning two
different things.
