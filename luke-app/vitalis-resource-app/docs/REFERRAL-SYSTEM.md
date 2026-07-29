# Inter-Industry Referral System — Data Model + Flow (SCAFFOLD)

**Status:** architecture + light, honest scaffold. The roster and demo referral records are
real, queryable data. The *transport* — sending a referral, the recipient accept/decline
handshake, and any future referral / platform fee — is **NOT wired**. This is a referral
**suggestion** surface, not a payment or booking marketplace.

**Hard framing (inherited, do not weaken):**
- Every referral is a **CATEGORY SUGGESTION** surfaced to the operator — never a diagnosis,
  never an auto-booking, never a fee execution.
- The naturopath is **Dr. Vincent Lun** on all output — never "Dr. Vinny".
- Nothing fabricates a credential or a clinical claim. Demo roster entries are flagged
  `_demo: true`. No money moves anywhere in this code.
- Client visibility (if/when any of this surfaces to a client) stays behind the ONE boundary:
  `status === 'APPROVED_RESOURCE'`. Referrals are an **operator/practitioner** surface today.

---

## 1. Why this exists

Marc's network spans disciplines: a peptide-protocol client frequently needs a service the
current practitioner can't provide — a functional-medicine MD to order/interpret advanced
bloodwork, a physiotherapist for rehab, a registered dietitian for deficiency follow-up. The
referral system captures that **location-aware cross-discipline network** so the operator can,
from a client's dossier, find the right partner by **service + location** and (eventually) hand
off the client with the relevant document attached.

This is the **reuse** of an existing capability, not a new engine: a referral SUGGESTION engine
already exists (`gates.referralGate` + `data/providers.js`) and produces `ProviderReferral`
*category* suggestions from observed signals. The network layer adds **who** can receive the
referral and **where** they are — it does not replace the gate.

---

## 2. Data model

### 2.1 Practitioner (network roster member)

Lives in `packages/protocol-core/data/referral-network.js` → `REFERRAL_NETWORK[]`. Each member:

| Field | Meaning | Maps to / source |
|---|---|---|
| `id` | stable handle | reuses `dr_vincent_lun` for the anchor naturopath |
| `name` | display name | **Dr. Vincent Lun** for the anchor (never "Vinny") |
| `occupation` | human role label | e.g. "Physician — Functional Medicine" |
| `practitionerType` | short code | `ND` / `MD` / `PT` / `RD` |
| `credentials[]` | letters / certs | e.g. `['MD', 'CCFP']` |
| `qualifications` | free-text summary | demo profiles say "Demo profile…" |
| `contact` | phone | tel: link in UI |
| `location` | `{ city, region, country }` | the location filter axis |
| `businessAddress` | display address | demo addresses flagged "(demo)" |
| `servicesOffered[]` | service keys | the **service filter** axis; vocabulary = `REFERRAL_SERVICES` |
| `serviceRadiusKm` | coverage radius | displayed; not yet used for distance math |
| `acceptingReferrals` | availability | `false` members are excluded from the filter by default |
| `_demo` | demo flag | `true` for illustrative profiles |

The anchor member (`dr_vincent_lun`) is the **same identity** `gates.referralGate` already routes
categories to — it is read from `providers.js`, never re-typed.

### 2.2 Customer (client)

Reuses the existing `Client` model (`demo-clients.js`). The referral flow reads:

| Concept in Marc's spec | Where it lives today |
|---|---|
| `homeAddress` / location | **not on the Client model yet** — the network filter takes an explicit `region`/`location` param. When a client gains a `location`, `/api/referrals/network?clientId=` can default the location hint from it (the endpoint already accepts `clientId` for this). |
| `servicesInterested[]` | derived today from `client.goals` + flagged labs via `referralGate` (observed signals → categories → services). A future explicit field would live on `Client`. |
| `consentFlags` | **not modeled yet** — a referral that actually transports PHI would gate on a client consent flag here before any document is sent. Documented as the required pre-condition; not implemented (no transport exists). |

### 2.3 Service taxonomy

`REFERRAL_SERVICES[]` — the cross-discipline needs (`naturopathic_review`, `functional_medicine`,
`hormone_panel`, `bloodwork_interpretation`, `nutrition_dietetics`, `physiotherapy`, `gut_health`).
Each carries `mapsToCategory` linking it to the existing `REFERRAL_CATEGORIES.trigger` vocabulary
where one exists (so the gate's category logic and the network filter speak the same language).
`physiotherapy` maps to `null` — it's a goal-driven service, not a lab-flag category.

### 2.4 ProviderReferral record (with status lifecycle)

`DEMO_REFERRALS[]` — illustrative records, `ProviderReferral`-compatible plus a lifecycle:

| Field | Meaning |
|---|---|
| `status` | `PENDING` → `ACCEPTED` / `DECLINED` |
| `handshake` | `true` only when ACCEPTED (mutual confirmation) |
| `feeStatus` | **always `NONE`** in this scaffold — the documented future hook, never executed |
| `direction` | `SENT` (from this practitioner's POV) |
| `from/toPractitionerId` | roster ids |
| `clientId` | the client being referred |
| `service` / `trigger` | the need (+ the gate category, if any) |
| `documentRef` | `{ silo, kind }` — the doc that would ride along (scaffold; not transported) |
| `reason`, `disclaimer`, timestamps | audit + framing |

---

## 3. Referral flow

```
Client needs a service the current practitioner can't provide
    │  (observed via referralGate categories, OR an explicit practitioner choice)
    ▼
Service + Location filter  ──►  GET /api/referrals/network?service=&region=&location=&clientId=
    │     (referral-network.filterNetwork — suggestion-only; excludes not-accepting members)
    ▼
Operator selects a recipient from the matching roster        [UI: NetworkMatchCard]
    ▼
Send referral + requisition/document   ── SCAFFOLD (not wired) ──┐
    ▼                                                            │  documentRef points at the
Recipient accepts / declines           ── SCAFFOLD ──            │  doc that WOULD be attached
    ▼                                                            │  (peptide / nutrition silo),
On accept → 'handshake' recorded       ── SCAFFOLD ──            │  gated by client consentFlags
    ▼                                                            │  before any PHI moves.
Future: referral / platform fee hook   ── feeStatus: 'NONE' ─────┘  (documented, never executed)
```

**Status read:** `GET /api/referrals/status?clientId=` → the `DEMO_REFERRALS` for that client,
each decorated with the resolved recipient name + service label. Read-only.

---

## 4. Where each piece lives in the existing system

| Piece | Location | Reuse note |
|---|---|---|
| Category → suggestion engine | `gates.referralGate` | **reused as-is** — the network layer never forks it |
| Anchor provider identity | `data/providers.js` (`dr_vincent_lun`) | imported, not re-typed |
| Network roster + filter | `data/referral-network.js` | **new, additive** — does not mutate `providers.js` |
| Service↔category vocabulary | `REFERRAL_SERVICES` | mirrors `REFERRAL_CATEGORIES.trigger` |
| Demo referral records | `data/referral-network.js` (`DEMO_REFERRALS`) | `_demo: true`, `feeStatus: 'NONE'` |
| Data barrel wiring | `data/index.js` → `referralNetwork` | so the server reads it via the existing barrel |
| Read endpoints | `server.js` `/api/referrals/network`, `/api/referrals/status` | thin; delegate to the pure filter/list |
| Client API | `src/lib/api.js` → `referralNetwork`, `referralStatus` | marshals JSON only |
| UI | `src/pages/Referrals.jsx` | extends the existing page; scaffold parts labeled |
| Nav (practitioner) | `src/nav.js` PRACTICE_GROUP → `/referrals` | route already mounted in `App.jsx` |

---

## 5. What is deliberately NOT built (and why)

- **No send/transport.** Sending a referral + document would move PHI; that requires a client
  `consentFlags` gate and a real channel. Documented as the pre-condition; not implemented.
- **No accept/decline transport.** The recipient handshake needs a second-party surface and
  auth. The demo records show the *shape*; the lifecycle is illustrative.
- **No fee.** `feeStatus` is always `NONE`. A referral/platform fee is a future hook, never a
  computation in this code. This is **not** a payment marketplace.
- **No distance math.** `serviceRadiusKm` is displayed; the filter matches on `region`/`location`
  substrings, not geocoded distance. Honest scope: filter, not a maps integration.

Operational simplicity doctrine: capture the architecture, ship the read/filter that is real and
honest, label every unwired edge as scaffold, and let real usage decide what to wire next.
