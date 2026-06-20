# My Vitalis Health — Enterprise Protocol Standardization & Retention Intelligence

*Proposal layer · Date 2026-06-03 · Folds into the master My Vitalis Health proposal.*

> **The spine:** *"Vitalis does not replace a practitioner's judgment. It standardizes the workflow around that judgment."*

Positioning guardrail (carried on every Vitalis surface): Vitalis is a **research facilitator and workflow layer**, not a prescriber, diagnostician, or source of clinical truth. Clients research what is out there; Vitalis organizes relevant study / community / practitioner-reference patterns around their goals, labs, allergies, preferences, and **provider review**. Nothing here is medical advice, diagnosis, treatment, or prescription.

---

## 1. The strategic shift — from document generator to clinic operating system

Today My Vitalis generates gated, research-attributed resource documents (peptide / nutrition / supplement / meal) that a practitioner reviews and approves before a client ever sees them. That is the *atom*. The **enterprise opportunity is the molecule**: a clinic, distributor, or practitioner group brings its own protocols and decision rules, and Vitalis turns them into a **repeatable client journey** — the same quality of intake → review → document → approval → follow-up → tracking for every client, every provider, every time.

That is the real reason an organization licenses this rather than building internally:

- **Fewer inconsistent provider decisions** — the clinic's rules are encoded once, applied uniformly.
- **Faster onboarding** — intake and first-resource generation are templated, not bespoke.
- **Repeatable service delivery** — new staff inherit the clinic's standard, not tribal knowledge.
- **Easier training** — the workflow *is* the SOP.
- **Better engagement + retention** — follow-up is scheduled by rule, not by memory.
- **More reorders / repeat business** — refill and reactivation timing is systematized.
- **Clearer revenue analytics** — every request, approval, conversion, and reorder is observable.

> *"Clinics can bring their own protocols and decision rules; Vitalis turns them into repeatable client journeys."*

---

## 2. Why this is credible *now* (not vaporware)

The enterprise layer is a **generalization of architecture that already runs**, which is what makes the pitch defensible:

| Enterprise concept | Already-built primitive it extends |
|---|---|
| Clinic Rules Engine | The **server-authoritative gate chain** (catalog → research → compliance → draft → review) that already runs on every generation. The clinic just supplies the *parameters*. |
| Approval gates | The **`APPROVED_RESOURCE` flow** — drafts are practitioner-only and physically projected out of client responses; the document endpoint 403s a client on any non-approved draft. |
| Source typing / honesty | The **Phase-2 dosing contract** — `sourceType` (STUDY_REPORTED / COMMUNITY_REFERENCE / PRACTITIONER_REVIEW / NEEDS_SOURCE) + `confidence` (HIGH / MODERATE / LOW / NEEDS_REVIEW) + real citations. The clinic inherits honest labeling for free. |
| Module on/off per clinic | **Phase-E practitioner module controls** (peptide / nutrition / supplement / meal / labs / bloodwork / referrals) — a clinic that only does bloodwork + supplements simply disables the rest. |
| Evidence backbone | The **Vitalis Source Doctrine** — peer-reviewed primary literature is the authority; government/regulatory is compliance-only; WHO/NIH excluded app-facing. A clinic cannot accidentally publish a claim stronger than its cited source. |
| Provider review identity | **Dr. Vincent Lun** review model + per-tenant provider-review routing. |

The enterprise build is therefore **configuration + analytics on top of a working gated pipeline**, not a rewrite. That sequencing is the de-risked path.

---

## 3. Enterprise Customization Module — the "Clinic Rules Engine"

A clinic/distributor/practitioner group defines its operating standard once; Vitalis enforces it on every client. Six rule domains, each mapped to where it plugs into the existing engine.

### 3.1 Lab decision rules
Per-marker thresholds and the actions they trigger.
- Marker thresholds (e.g., the clinic's own fasting-insulin / ApoB / Vit-D cutoffs).
- Review flags — which out-of-range markers raise a **"review with provider"** flag (never a diagnosis).
- When to surface a peptide / supplement / nutrition **research suggestion** from labs + stated goal.
- *Plugs into:* the lab/bloodwork facet + the generation trigger. A clinic with conservative thresholds simply ships different numbers; the honesty framing and approval gate are unchanged.

### 3.2 Protocol templates
The clinic's own approved starting points.
- Clinic-approved peptide stacks, nutrition frameworks, supplement protocols, meal-plan templates.
- Dosing / titration / offboarding rules **where legally appropriate**, source-typed and confidence-tagged. Where a clinic has no defensible reference, the template carries `NEEDS_SOURCE` rather than inventing one.
- *Plugs into:* the catalog + dosing reference as a **tenant overlay** — the clinic's preferred items rank first; disallowed items are filtered before generation.

### 3.3 Approval gates
The clinic's review policy, encoded.
- Who must review (provider role, named provider, or any qualified reviewer).
- When approval is required (always / above a risk tier / for controlled classes only).
- What the client may see vs what stays practitioner-only (the existing two-tier projection, now clinic-tunable).
- *Plugs into:* the `DRAFT → review → APPROVED_RESOURCE` lifecycle. The hard rule — **no client draft leaks** — is non-negotiable and not clinic-configurable.

### 3.4 Product preferences
Routing and availability.
- Preferred suppliers; allowed / disallowed products.
- Affiliate / referral partner routing (store-code / affiliate placeholder today, live later).
- Product availability **by jurisdiction** (extends the existing compliance lane — default CA, US/state config-based).
- *Plugs into:* the catalog gate + compliance gate as a tenant filter.

### 3.5 Follow-up rules
The retention engine's inputs.
- Next lab date; next check-in; refill / reorder timing.
- Progress-log reminders; inactive-client reactivation windows.
- *Plugs into:* a per-client schedule derived from the clinic's rules → feeds §4 analytics and §6 automation.

### 3.6 Pricing rules
Monetization, per tenant.
- Per protocol / per plan / subscription tier / included credits / add-on fees / enterprise-license pricing.
- *Plugs into:* the existing entitlement + credit + overage scaffolding (cap + monthly credits → overage fee; `paymentStatus` only until a processor is wired). Billing/usage tracks **only enabled modules** (§ Phase-E).

> *"This is how a clinic turns one-off recommendations into a measurable, scalable service line."*

---

## 4. Retention & Reorder Intelligence (analytics module — roadmap)

A clinic operations dashboard that answers the questions an operator actually asks. Tracked over time:

**Engagement & retention** — repeat customers · reorders · refill timing · retention rate · churn-risk score · protocol-completion rate · progress-log adherence · lab-follow-up completion · client engagement score.

**Conversion & uptake** — add-on conversion · meal-plan uptake · supplement-plan uptake · most-requested protocol types.

**Operations** — practitioner approval turnaround · most successful client journeys · what is working / not working.

**Revenue** — revenue per client · per practitioner · by module.

This lets clinics and distributors answer:
- Which protocols are driving **repeat business**?
- Which clients are **due for follow-up**?
- Which clients are **disengaging** (churn risk)?
- Which providers **approve fastest**?
- Which plans produce the **best adherence**?
- Which services **convert into paid add-ons**?
- Which products lead to **reorders**?
- **Where are clients dropping off**?

Every metric above has a source event in the gated pipeline (request → draft → approval → view → reorder → log), so the analytics are **derived from real workflow events, never fabricated** — consistent with the Drift = Cancer / truthful-operational-intelligence doctrine (UNKNOWN over fake-green).

---

## 5. Database / CRM integration roadmap

The intelligence compounds once connected to live systems. Sequenced future integrations:

1. **Customer database** — durable client records beyond the demo store.
2. **Supplier / order database** — product availability + order state for reorder workflows.
3. **Stripe billing** — turn the existing `paymentStatus` scaffolding into real charges (per-protocol, subscription, enterprise license).
4. **CRM / GoHighLevel** — sync clients, stages, and engagement into the clinic's existing CRM.
5. **Email / SMS follow-up** — execute the §3.5 follow-up rules.
6. **Lab result upload / parser** — ingest real labs into the bloodwork facet (the demo lab-scenario format is the contract).
7. **Provider calendar** — booking against real availability.
8. **Affiliate / referral tracking** — activate the §3.4 routing placeholders.
9. **Analytics dashboard** — the §4 module on live data.

Each integration is **additive to the gated core** — none weakens the approval gate or the source doctrine.

---

## 6. Call-bot / ISA automation (future)

Once follow-up rules + a database are connected, automated agents close the retention loop:

- Call / message clients **due for follow-up**.
- **Book check-ins** with providers; schedule nutritionist / practitioner consults.
- Remind clients to **upload labs** and to **reorder**.
- **Reactivate dormant** clients on the clinic's reactivation window.
- **Route high-priority** clients to human staff.

These agents act on the clinic's rules and the analytics signals — they *operationalize* retention, they do not make clinical decisions. (Consistent with the governance doctrine: automation runs the workflow around provider judgment, it does not replace it.)

---

## 7. Business value — what it becomes

My Vitalis is **not just a document generator.** With this layer it becomes:

- a **client engagement engine**
- a **retention dashboard**
- a **reorder-intelligence system**
- a **clinic operations layer**
- a **protocol-standardization system**
- a **monetization engine**
- a **provider / client portal**
- a **future CRM-automation backbone**

> *"The platform helps operators see what clients request, what providers approve, what converts, what gets reordered, and where follow-up is needed."*

---

## 8. Pitch language (drop-in)

- *"Vitalis does not replace a practitioner's judgment. It standardizes the workflow around that judgment."*
- *"Clinics can bring their own protocols and decision rules; Vitalis turns them into repeatable client journeys."*
- *"The platform helps operators see what clients request, what providers approve, what converts, what gets reordered, and where follow-up is needed."*
- *"This is how a clinic turns one-off recommendations into a measurable, scalable service line."*

---

## 9. Roadmap positioning

**Current build round** (in flight):
- Portal polish
- Lab-driven recommendations (peptide / nutrition / supplement / meal)
- Peptide / nutrition / supplement / meal documents
- Module controls (per-practitioner ON/OFF)
- Approval gates (DRAFT → review → APPROVED_RESOURCE)

**Next major feature** (this proposal):
- Enterprise protocol / rules engine (the Clinic Rules Engine)
- Retention / reorder analytics
- CRM / database integration
- Follow-up / call-bot / ISA workflows

---

## 10. Guardrails (non-negotiable, carried into enterprise)

- **Research facilitator, not clinician.** Educational / resource-only language everywhere; no diagnosis, treatment, or prescription.
- **Server-authoritative gates.** Clinics tune parameters; they cannot bypass the gate chain or weaken the approval requirement.
- **No client draft leaks.** Only `APPROVED_RESOURCE` reaches a client — not clinic-configurable.
- **Honest evidence.** Source-typed + confidence-tagged; `NEEDS_SOURCE` is shown, never hidden; never a claim stronger than its citation; WHO/NIH excluded as evidence authorities.
- **Real analytics only.** Metrics derive from actual workflow events; UNKNOWN over fabricated.
- **Provider on the paper.** Dr. Vincent Lun (full formal name) on review correspondence; jurisdiction acknowledgment retained.

---

*This layer extends — never weakens — the gated, research-attributed core already built. It is configuration, analytics, and automation on top of a working pipeline, which is exactly why it is the right next bet after the current round.*
