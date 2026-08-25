# AEGIS Dashboard — Hosting

A local, authenticated, read-only host for the AEGIS projection. It is a process
you start and stop. It does not deploy, publish, tunnel, or register anything.

## Run it

```bash
node builder-control/aegis-state.cjs --out builder-control/dashboard/state.js
node builder-control/hosting/server.cjs
```

The first command regenerates the projection; the second serves it on
`http://127.0.0.1:8791` and prints a one-run token. Open the printed URL.

To use a stable token instead:

```bash
AEGIS_DASHBOARD_TOKEN="$(openssl rand -base64 32)" node builder-control/hosting/server.cjs
```

A supplied token is deliberately **never echoed** — this banner routinely lands
in a log file or CI artifact, and echoing it would put a live credential at rest
in all of them. A generated token is printed once and dies with the process.

## What it serves — and nothing else

`/` · `/index.html` · `/state.js`

That is the complete allow-list. It is an allow-list rather than a filter
because a filter is a list of the leaks somebody thought of. The repository,
the ledger, task packets, review records, and raw reviewer transcripts are
unreachable **by construction**. A second, independent refusal (`NEVER_SERVE`)
blocks those path classes again in case the allow-list is ever widened by
accident.

Authentication does not widen this. An authenticated request for
`/ledger.json` still gets `403`.

## Refusals

| configuration | result |
|---|---|
| loopback, no token supplied | allowed — a token is generated |
| `--host 0.0.0.0` | `NON_LOOPBACK_REFUSED` |
| `--host 0.0.0.0 --allow-non-loopback` | `EXPOSURE_UNACKNOWLEDGED` |
| `--host 0.0.0.0` + both flags, no token | `TOKEN_REQUIRED` |
| any token under 24 characters | `WEAK_TOKEN` |

Two separate flags are required to leave loopback because a temporary open port
is rarely temporary. There is **no anonymous mode**, including on loopback —
any local process, browser tab, or package postinstall script can reach
127.0.0.1, so loopback is not a boundary.

## Headers

`no-store` · `nosniff` · `X-Frame-Options: DENY` · CSP with
`default-src 'none'` and `frame-ancestors 'none'`. The page is self-contained,
so nothing external needs to load.

## What this is not

- **Not a deployment.** Nothing is published or exposed to the internet.
- **Not durable.** Kill the process and it is gone.
- **Not a workflow authority.** It serves a projection. Every value on the page
  cites the artifact it came from, and absent data renders `UNAVAILABLE`,
  `STALE`, or `UNVERIFIED` rather than a plausible number.

## Before exposing this to anyone else

The projection contains internal engineering process state — which reviewers
ran, what blocked, which connectors are degraded. That is a map of where the
soft spots are. It is not catastrophic if leaked and it does not belong on the
open internet either. If it needs to reach another machine, prefer an SSH
tunnel over binding a public interface:

```bash
ssh -N -L 8791:127.0.0.1:8791 <this-host>
```

That keeps the bind on loopback and puts the transport security somewhere that
already has it.
