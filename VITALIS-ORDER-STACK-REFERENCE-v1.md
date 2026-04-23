# Vitalis Order + Stack UX Reference — v1

**Source:** luke-peptide-app archive (retired 2026-04-21, SHA: 3a10dc3)  
**Extracted from:** `/tmp/luke-peptide-app-restore/...luke-peptide-app/index.html` (666 lines, all-in-one HTML/JS)  
**Purpose:** Reference spec for Vitalis consumer app (peptide-resource-app) build-out.  
**Date authored:** 2026-04-22

---

## Overview

The archived luke-peptide-app was a single-file, pure-frontend POS. No server. No API calls. Everything ran in the browser against `localStorage`. This made it extremely fast and reliable in-person — Marc could use it on his phone with no internet. The successor (`luke-app/`) is architecturally superior (Express + local JSON DB + PDF) but lost these UX patterns during the migration.

Key insight from Marc: "The most important part was the functions from the order screens and the stacks. We spent a ton of time on that and I wanted you to use that as a reference point for the Vitalis build out."

---

## Order Flow — Step by Step

### Step 1: Tab navigation (line 86–92)

Six tabs: Dashboard → Products → New Order → Protocol → History → Clients.

`gt(id, btn)` function (line 267) handles all tab switches. It:
1. Strips `.active` from all tabs and `.on` from all screens
2. Adds `.active` to clicked tab, `.on` to target screen
3. Dispatches to the correct render function: `renderOrderProducts()`, `renderHistory()`, `renderClients()`, `renderDashboard()`

**Vitalis implication:** The consumer app should use the same simple `showPage()` dispatch pattern (already in `luke-app/public/js/app.js` line 94) — no router needed.

### Step 2: New Order screen structure (line 164–213)

Two-panel layout:
- **Left panel:** Client Info (name, phone, notes). `autofillClient()` (line 634) fires on keyup: if the typed name matches a known client in `CLIENTS{}`, it auto-fills phone.
- **Right panel:** Order Summary live-updating: total qty, MSRP subtotal, discount applied, your cost, "Client pays" total, tier label.

Product selector below the two panels: one flat list grouped by category (`bundle` → `peptide` → `burn` → `nootropic`), each row has `+/−` qty buttons.

**Critical:** The product list shows every in-stock product. No search box in the archive. The current `luke-app` added the search/filter pattern (line 175–220 of app.js) — that is an improvement to keep.

### Step 3: Qty adjustment — `adjQty(pid, delta)` (line 401)

```javascript
// archive index.html:401
function adjQty(pid, delta){
  if(!currentOrder[pid]) currentOrder[pid]=0;
  currentOrder[pid] = Math.max(0, currentOrder[pid]+delta);
  var el = document.getElementById('oq-'+pid);
  if(el) el.textContent = currentOrder[pid];
  if(currentOrder[pid]===0) delete currentOrder[pid];
  updateOrderSummary();
  renderOrderItems();
}
```

`currentOrder` is a flat object `{ productId: qty }`. This is simpler than `luke-app`'s `orderLines[]` array. The archive approach has one advantage: deduplication is automatic. The `luke-app` approach has the advantage of per-line discount controls. Keep `luke-app`'s array model but mirror the instant-update pattern.

### Step 4: Order summary — `updateOrderSummary()` (line 411)

Auto-tier discount logic (archive line 420):
```javascript
var discPct = totalQty>=10 ? 0.20 : totalQty>=5 ? 0.10 : 0;
```

Discount tiers:
- 1–4 units: MSRP (no discount)
- 5–9 units: 10% off, label "Good Client"
- 10+ units: 20% off, label "Best Price"

This was surfaced via `ord-tier-label` element. The `luke-app` version (app.js line 382–390) auto-sets the discount dropdown — same logic, better UI.

### Step 5: Save order — `saveOrder()` (line 456)

Archive flow:
1. Validate client name (required) and non-empty cart
2. Build `orderItems[]` array from `currentOrder`
3. Compute total with discount
4. `ORDERS.unshift(order)` → `localStorage.setItem('luke_orders', ...)`
5. Auto-upsert client record in `CLIENTS{}`
6. Call `genProtocol()` and auto-navigate to Protocol tab

**Key UX win:** Save → Protocol in one click. No separate step. The `luke-app` version (app.js line 707) is more capable (Airtable + email backend) but broke this auto-navigate-to-protocol pattern. Restore it.

### Step 6: Order items panel (line 432)

Live list below product selector showing currently selected items with `+/−` controls and running line total. This is the "shopping cart receipt" — updates on every `adjQty` call. `luke-app` has this as `renderOrderLines()` (app.js line 363) — same pattern, kept.

---

## Protocol Generator — `genProtocol()` (archive line 526)

### How it worked

1. Get `Object.keys(currentOrder)` — which products are in cart
2. Look up each product name in `PROTOCOLS{}` object (archive lines 489–517) — 20+ protocols hardcoded with: schedule, cycle, injection site, research notes
3. **Stack detection:** check `STACKS{}` object (archive lines 519–524) — if all compounds in a stack key are present in the order, prepend the stack protocol block
4. Build HTML output, inject into `#protocol-output`
5. Auto-navigate to Protocol tab

### PROTOCOLS{} object (archive line 489)

20+ compounds covered: BPC-157, TB-500, CJC-1295 DAC, Ipamorelin, Semaglutide, Retatrutide, NAD+, Sermorelin, GHRP-6, GHRP-2, Epitalon, Thymosin Alpha-1, PT-141, Melanotan-2, Semax, Selank, GHK-Cu, MOD GRF 1-29, Hexarelin, Kisspeptin-10, AOD-9604, HGH Fragment, Tesamorelin, Thymalin, KLOW Bundle.

Each entry has four fields:
- `schedule`: exact dosing frequency + amount
- `cycle`: on/off timing
- `site`: injection site + solvent
- `notes`: conservative/moderate/aggressive tiers, timing nuance, weekly total, stacking notes

Example (archive line 491):
```
'TB-500': {
  schedule: '2–2.5mg SubQ, twice weekly (loading 4–6 wks), then once weekly (maintenance)',
  cycle: '6–12 weeks',
  site: 'SubQ abdomen or deltoid. Solvent: BAC Water.',
  notes: 'Conservative: 2mg 2x/wk | Moderate: 2.5mg 2x/wk | ...'
}
```

**AOD-9604 / HGH Fragment solvent warning (archive lines 510–511):** Both have a BAC water warning — benzyl alcohol degrades these peptides. Use sterile water. This critical safety note must be preserved in any consumer-facing build.

### STACKS{} detection (archive lines 519–524)

Four pre-defined stacks in the archive:
1. `BPC-157+TB-500` → "Ultimate Healing Stack"
2. `CJC-1295 DAC+Ipamorelin` → "GH Optimization Stack"
3. `Semax+Selank` → "Cognitive Enhancement Stack"
4. `Semaglutide+NAD+` → "Metabolic Optimization Stack"

Detection logic: `stackProducts = key.split('+')` → all must be present in `selectedNames[]` (substring match).

The `luke-app`'s `stack-data-inline.js` (32KB) is a massive evolution of this — 10 goal categories, each with basic/intermediate/advanced tiers, compound lists, dosing at low/mid/high, scheduling notes, and add-ons. This is the Vitalis consumer stack data.

---

## Stack Builder Flow

The archive didn't have a dedicated "stack builder" screen. Stacks were auto-detected from order contents and displayed in the Protocol tab. The `luke-app` added a proper Stack Library page via `loadStackLibrary()`.

### Archive Quick-Stack Pattern (implicit)

Marc's "quick stacks" in the archive were order shortcuts — Marc would manually add the right products for each stack. The archive's `renderOrderProducts()` (line 364) grouped products by category with bundle pinned first. This visual grouping made it easy to one-click assemble a stack.

### luke-app Stack Data (stack-data-inline.js)

The `INLINE_STACKS` array has 10 goals:
1. Fat Loss (Wolverine-adjacent: KLOW + Retatrutide + CJC/Ipa)
2. Anti-Aging / Longevity
3. Athletic Performance
4. Injury & Recovery (KLOW as foundation for all 3 tiers)
5. Bodybuilding
6. Metabolic Health / Pre-Diabetes
7. Mental Performance / Cognitive
8. Immune Defense & Inflammation
9. Libido & Hormonal Health
10. ADD / Focus & Attention

Each has: `basic`, `intermediate`, `advanced` tiers. Each tier has: `compounds[]`, `klowRecommended` flag, `cycleWeeks`, `dosing{low/mid/high}`, optional `schedulingNotes[]`, optional `addOns[]`.

**The "always recommend stacks never singles" doctrine** maps to: every goal's basic tier includes KLOW when injury/recovery relevant; intermediate+ always has KLOW. This is the core stacking doctrine Marc locked.

### INLINE_SCHEDULING object (stack-data-inline.js line 2)

Compound-level scheduling conflict rules:
- SS-31 must precede MOTS-C by 30–60 min
- MOTS-C and SLU-PP-332 alternate days
- Tesamorelin and CJC-1295 DAC cannot be same day
- Ipamorelin: fasted, stack with CJC-1295

---

## Quick Stacks — The Six Named Stacks (from Marc's stacking doctrine)

These are the six "quick stacks" referenced in Marc's stacking doctrine (not hardcoded as named objects in the archive, but reconstructable from INLINE_STACKS + PROTOCOLS):

1. **Wolverine** — BPC-157 + TB-500 (Ultimate Healing). Archive: `STACKS['BPC-157+TB-500']`. Inline: `injury-recovery` basic tier.
2. **Hollywood** — CJC-1295 DAC + Ipamorelin (GH). Archive: `STACKS['CJC-1295 DAC+Ipamorelin']`. Inline: `athletics` basic tier.
3. **Longevity** — NAD+ + CJC/Ipa + Epitalon + Thymosin Alpha-1. Inline: `anti-aging` intermediate tier.
4. **Libido** — PT-141 + Kisspeptin + CJC/Ipa. Inline: `libido-hormonal` intermediate tier.
5. **Goddess** — GHK-Cu + LL-37 (Skin & Hair). Inline: `stack-data-inline.js` → `local-db.json` `stack-skin-hair-006`.
6. **Metabolic** — Retatrutide + MOTS-C + SLU-PP-332. Inline: `fat-loss` advanced tier / `metabolic-health`.

**All six have catalog-matched products in `catalog-data.json`** — the vials and pens are there.

---

## Data Model

### Archive (localStorage)

```javascript
// Keys:
localStorage.getItem('luke_products')  // Array of product objects
localStorage.getItem('luke_orders')    // Array of order objects  
localStorage.getItem('luke_clients')   // Object keyed by client name

// Product shape (archive line 287):
{
  id: 1, name: 'BPC-157', dose: '5mg', price: 65, cost: 28,
  cat: 'peptide', instock: true, notes: 'Healing peptide.'
}

// KLOW bundle extension (archive line 311):
{ ..., klow: true, klowContents: 'BPC-157 10mg · TB-500 10mg · KPV 10mg · GHK-Cu 50mg' }

// Order shape (archive line 474):
{
  id: Date.now(), client: 'Name', phone: '', notes: '',
  date: new Date().toLocaleDateString(),
  items: [{ id, name, dose, qty, price, subtotal }],
  msrp, discount, total
}

// Client shape (archive line 477):
{ name, phone, orders: 0, spent: 0, lastOrder: '' }
```

### luke-app (local-db.json + API)

Products come from `catalog-data.json` (the actual Airtable export, 60+ products). The `local-db.json` `products[]` array is currently empty — populated by running `server.js` which reads from localDb.js.

Product shape in catalog:
```javascript
{
  id: 'recNdXT2Py2hPGQkX', sku: 'KLOW-FD',
  displayName: 'KLOW — Quad Repair Blend (Freeze-Dried)',
  msrp: 2050, cost: 900, margin: 56,
  isBox10: false, discountAllowed: true, maxDiscountPct: 15
}
```

---

## Key UX Wins Not to Lose

1. **Auto-tier discount label** (archive line 428–429): The "✅ Best Price — 20% discount" / "🟡 Good Client — 10% discount" label under the total is powerful social proof language in a POS setting. Keep it.

2. **Save → auto-Protocol → auto-navigate** (archive line 483–485): One click does everything. Don't make Marc click "Generate Protocol" as a separate step.

3. **Stack detection from cart** (archive line 540–543): Detecting stacks from order contents and surfacing stack protocols first is the killer feature. The current `luke-app` has a separate protocol generator (AI-powered via Luke) but lost this instant stack-from-cart pattern.

4. **Per-compound solvent warnings** (archive line 510–511): AOD-9604 and HGH Fragment 176-191 cannot use BAC water. This safety note was in the archive's PROTOCOLS{} and must be in any consumer-facing build.

5. **KLOW pinned first in every list** (archive line 367, luke-app line 184): Bundle/KLOW always sorts to top. Hard rule.

6. **Client autofill from order screen** (archive line 634): Existing clients auto-fill phone on name match. Small but eliminates re-entry friction.

7. **Supply timeline / Gantt panel** (luke-app app.js line 461–523): This is NEW in luke-app (not in archive). Bottleneck visualization (which compound runs out first) + monthly cost per compound. Do not lose this — it's the best addition since the archive.

8. **Dose-tier selector per line** (luke-app app.js line 415): Low/Medium/High dose selector per order line, affecting supply calculation. Archive had no per-product dosing UI — this is an improvement.

9. **Product search with KLOW-first scoring** (luke-app app.js line 182–189): Fuzzy search with KLOW always floated to top. Archive had no search.

10. **Smart Order mode with auto-fill qty** (luke-app modules/smart-order.js): Given a cycle duration, calculates vials needed per compound. Archive had no automation here — Marc had to manually set qty for each protocol.

---

## Gaps in Current luke-app vs Archive

| Feature | Archive | luke-app | Gap |
|---|---|---|---|
| Works offline (no server) | Yes | No | API calls fail silently, empty product list |
| Stack detection from cart | Yes (4 stacks) | No | Lost completely |
| Save → auto-protocol → auto-navigate | Yes | No | Manual step added |
| Auto-tier discount label with emoji | Yes | Partial | Label exists, emoji/wording weaker |
| 20+ compound protocol texts | Yes (hardcoded) | Via Luke AI only | Offline not available |
| Client autofill on name type | Yes | No | Removed |
| Product data seeded / available | Yes (DEFAULT_PRODUCTS) | No (empty products[]) | local-db.json products=[] |

The root cause of all current failures: `local-db.json` products array is empty (confirmed at `luke-app/data/local-db.json:2`). Every `/api/products` call returns `[]`. Fix this first.
