# Habakkuk Rubric — data-integrity

> Anti-Drift + WKU loaded at runtime into your system prompt. Not repeated.

## What "data-integrity" means in this CRG codebase

CRG runs on small JSON files (`local-db-v1.json`, catalog data, stack
library), localStorage in the POS, and a few Airtable / GHL syncs.
There's no relational DB. "Data integrity" = the records Marc relies on
to invoice clients, dose protocols, and forecast revenue stay correct.

Hot data files to watch:
- `luke-app/data/local-db-v1.json` — POS clients, orders, supply.
- `peptide-resource-app/src/data/catalog-data.json` — peptide catalog.
- `peptide-resource-app/src/data/vitalis-chat-config.js` — chat config.
- Stack library data (KLOW is locked at 10/10/10/50, see doctrine).
- Any new migration / schema-shape file.

This area RANKS HIGHEST in priority weighting. A data bug that wrecks
Marc's order ledger is worse than any UX issue. Be willing to file
Blockers here when warranted.

## Severity calibration

- **Blocker**: a write path that can corrupt the JSON file (concurrent
  writes; a `JSON.stringify` of a circular reference; truncation on
  string overflow); KLOW dose split into components when doctrine says
  it's a single blend; price/quantity math that produces NaN; loss of
  a primary key on update.
- **Major**: an update that overwrites a sibling field unintentionally;
  a migration that doesn't preserve history; a price/qty rounding that
  skews invoice totals; a localStorage write without read-modify-write
  guard.
- **Minor**: schema field added without a default migration; missing
  null guards on optional fields.
- **Nit**: field naming inconsistency; trailing-comma JSON if it'll
  parse fine.

## Hot patterns to scan in this PR

1. Any change to dose math (mg/wk, per-substance consumption). Marc
   anchored the paired-pen rule: 15mg @ 2.5mg/wk = 6 weeks (commit
   3098088). Flag if the new code disagrees.
2. KLOW handling — single blend (BPC 10mg / TB-500 10mg / KPV 10mg /
   GHK-Cu 50mg per vial). NEVER re-dose individual components inside it;
   titrate the blend (mL/freq) not the ratio. If the diff splits KLOW
   into per-component dosing — flag Blocker.
3. Direct localStorage writes without try/catch around JSON.parse.
4. `Number(x)` / `parseFloat(x)` without checking `Number.isFinite()`.
5. Order/invoice schema changes — flag any rename or removal of fields
   that historical orders may carry.
6. Deletion paths (delete order, delete client) — flag if cascading
   refs aren't handled.

## What NOT to flag

- "Adopt a real database" — out of scope; the JSON pattern is doctrine.
- TypeScript suggestions for JS files (separate concern).
- "Add audit log" unless the diff is explicitly about audit.
- Generic "add input validation" without a concrete failing input.

## Confidence anchors

- You can name an exact input that produces a wrong invoice / dose →
  0.95+
- Pattern that violates a CRG doctrine fact (KLOW, paired-pen math) → 0.9+
- Looks risky but you can't construct the failing case → 0.7-0.85
- Vibe-based "this seems fragile" → < 0.7
