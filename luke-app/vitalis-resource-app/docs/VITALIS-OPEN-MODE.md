# Vitalis TEST / OPEN MODE (`VITALIS_OPEN_MODE`)

> **Open mode is for testing only. Production MUST run with it OFF.**

A single environment flag, **`VITALIS_OPEN_MODE`** (default **OFF**), lets the team and the dev
team exercise the generators wide-open — without the entitlement, acknowledgment, and silo
*friction* that real practitioners hit. It removes **friction**, it does **not** open the
**security model**: the approval → client-visibility boundary, the no-draft-leak projections, the
surfaced compliance flags, and the medical-language gate all stay fully enforced regardless of the
flag.

The flag is read **at request time** (`process.env.VITALIS_OPEN_MODE === '1'`), never baked in at
build time. Flip it by restarting the server with the env set — no rebuild, no redeploy of the SPA.

---

## How it works

- **Server** reads the flag via `lib/open-mode.js → isOpenMode()` (`process.env.VITALIS_OPEN_MODE === '1'`).
  Every gate that consumes it calls `isOpenMode()` at the call site, so the value is live per-request.
- **Client** learns the state from a tiny runtime endpoint: `GET /api/config → { openMode: boolean }`.
  The SPA fetches it once on load (`api.config()` → `roleContext`), so a server started with the flag
  set surfaces open-mode UI with no client rebuild. A failed/absent fetch leaves `openMode = false`.
- **`@vitalis/protocol-core` stays pure.** No gate module knows about the flag — the bypasses live at
  the **server call sites** (`server.js`) and the **UI layer** (`src/nav.js` + `Sidebar.jsx`). The gate
  *logic* in `gates.js`/`accounts.js` is untouched.

---

## What OPEN MODE OPENS (friction removed)

| # | Friction | OFF (production) | ON (`VITALIS_OPEN_MODE=1`) |
|---|----------|------------------|-----------------------------|
| 1 | **Nav discoverability** | Practice nav is the 5-item practice rail; the generators live inside a client dossier. | A **"Generate (Test Mode)"** nav group is appended for **PRACTITIONER + ADMIN** linking `/generate` (ProtocolChat — protocol from text), `/package` (ClientPackage — One-Click Package), and the silo generators (`/practice/clients`, `/practice/add-ons`). Never shown to a CLIENT. |
| 2 | **Entitlement (the $25 block)** | Active-protocol cap → 409; included-credit overage → 402 ("$25 overage"). | Generation / package / add-on persistence is **never entitlement-blocked** — treated as unlimited / auto-override. The `genEvent` audit row is still written, tagged `openModeOverride: true` / `OPEN_MODE_OVERRIDE` (honest trail, never faked as a real "PAID"). |
| 3 | **Ack / attestation prompts** | One-time jurisdiction notice + software-license-ack + practitioner-attestation must be signed (428 / 422 otherwise). | Those **prompts are auto-satisfied** so a tester can generate and then **APPROVE** without an unsigned-ack block. The APPROVE **transition itself still runs** and flips status correctly — only the prompt friction is removed. Audit rows are tagged `openModeOverride`. |
| 4 | **Silo / module gating** | Per-silo locks apply. | Every silo is generable (no silo lock). |

Entry points opened in nav: `/generate`, `/package`, and the silo launchers under `/practice/clients`
(peptide + bloodwork requisition, reached inside a client dossier) and `/practice/add-ons`
(supplement + meal plans).

---

## What OPEN MODE KEEPS LOCKED (the product + the safety line)

Open mode **never** touches these — they hold identically whether the flag is on or off:

- **Approval → client-visibility boundary.** A CLIENT only ever receives `status === 'APPROVED_RESOURCE'`.
  The document `approvalGuard` still returns **403** for any un-approved draft.
- **No-draft-leak projections.** `clientResourceProjection` / `clientProtocolProjection` are whitelist-only;
  operator fields (raw rationale, warnings, blockedReasons, unknowns, compliance reasons, review comments)
  are physically stripped from every client response.
- **Compliance flags still surface.** `BLOCKED` / `NEEDS_REVIEW` stay flagged — open mode does **not**
  auto-clear them to `ALLOWED`.
- **Language gate + dosing attribution framing.** Banned medical-claim language is still rejected; dosing
  stays attribution-framed ("literature reports …"), never an instruction.
- **`selfIntakeApprovalGate`.** A CLIENT / self-intake actor **still cannot approve** a clinical resource.

> A tester approving a draft and then seeing it client-side is **correct**. A draft visible client-side
> **without** approval is a **failure** — even in open mode.

---

## How to ENABLE (testing)

Start the server with the flag set:

```bash
VITALIS_OPEN_MODE=1 node server.js
```

For the full dev stack (API + Vite SPA), set it on the API process:

```bash
VITALIS_OPEN_MODE=1 PORT=3100 node server.js   # in one terminal
npm run dev                                     # Vite SPA in another (proxies /api → :3100)
```

Confirm it is on: `curl http://localhost:3100/api/config` → `{"ok":true,"openMode":true}`.
The SPA picks it up on load; the "Generate (Test Mode)" group appears in the practitioner / admin rail.

## How to DISABLE (go-live)

Unset the variable (or set it to anything other than `1`) and restart:

```bash
unset VITALIS_OPEN_MODE && node server.js
# or explicitly:
VITALIS_OPEN_MODE=0 node server.js
```

Confirm it is off: `curl .../api/config` → `{"ok":true,"openMode":false}`. Only the exact string `1`
enables open mode; absent / `0` / any other value is OFF. **Production must run with the flag OFF.**

---

## Tests

The acceptance suite (`npm test`) runs with the flag **OFF** by default, so it asserts production
gating (entitlement cap, $25 overage, ack prompts) exactly as before. Three additional checks
(`OM1`–`OM3`) toggle `process.env.VITALIS_OPEN_MODE` in-process (and restore it), drive the real
Express server over HTTP, and **snapshot/restore `data/store.json` byte-for-byte** so the runtime
store is left untouched:

- **OM1** — flag defaults OFF; `/api/config` reflects the env at request time (runtime-toggleable, not build-baked).
- **OM2** — flag ON: a generation that *would* be `$25`-overage-blocked (402) persists instead, tagged `OPEN_MODE_OVERRIDE`.
- **OM3** — flag ON: a non-approved draft is **still 403** to a CLIENT, the client projection **still strips**
  operator fields, and the APPROVE transition still works — proving open mode did **not** open the security model.
