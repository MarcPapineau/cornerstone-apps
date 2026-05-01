# Habakkuk Rubric — perf

> Anti-Drift + WKU loaded at runtime into your system prompt. Not repeated.

## What "perf" means in this CRG codebase

These are small-scale Marc-internal apps. There are no million-user
workloads. "Performance" in this rubric means:

- App load time on Marc's laptop / iPad — keep under 3s perceived.
- Anthropic API token efficiency (CRG pays per token, and Marc has
  expressed pain about runaway costs).
- Background n8n / Netlify scheduled functions wasting cycles or
  re-firing (Gate F territory — flag if you spot it).
- Memory leaks in long-lived browser tabs (POS sessions stay open all
  day).
- N+1 patterns in Netlify functions calling Anthropic in a loop.

Out of scope: enterprise-scale benchmarks, SQL query plans on a
non-existent database server, micro-optimization of pure JS arithmetic.

## Severity calibration

- **Blocker**: the change introduces an N+1 or unbounded loop that will
  hit Anthropic for every iteration; the change ships an MB-scale binary
  asset into the browser bundle that wasn't there before; an interval/
  setTimeout chain that will never clear.
- **Major**: a loop that calls a Netlify function per element; large
  synchronous JSON.parse blocking the main thread; unbounded localStorage
  growth (POS keeps everything in localStorage today); duplicate
  network requests that could be coalesced.
- **Minor**: a sort inside a render loop; unnecessary re-renders; missing
  pagination on a Netlify list endpoint that probably won't grow but
  could.
- **Nit**: micro-perf of style; "use map instead of forEach"; tree-
  shake-friendly import suggestions.

## Hot patterns to scan in this PR

1. Anthropic SDK calls inside loops — every model.messages.create()
   inside a `for` / `forEach` / `.map()` is a flag.
2. `await` inside `.forEach()` (silently sequential, often unintended).
3. New large dependencies added to package.json — flag any single-package
   add that's not justified by the diff (`pdfjs-dist`, `@playwright/test`
   are usually fine; flag random utility libs like lodash if a couple of
   helpers would do).
4. New polling / scheduled jobs / setInterval — Gate F prevents zombie
   runs; flag any unbounded interval without a clear off-switch.
5. Image / asset references that point at uncompressed files (>500KB).
6. Client-side filtering of large JSON files (`local-db-v1.json` is a
   pattern to watch — it's already big).

## What NOT to flag

- "Switch to a real database" — out of scope; localStorage is the
  CRG-internal pattern.
- "Add CDN" — Netlify already does it.
- Generic "rewrite in TypeScript" advice.
- Theoretical perf advice with no benchmark context.

## Confidence anchors

- Direct evidence (loop + LLM call visible together) → 0.9+
- Pattern visible but caller frequency unknown → 0.7-0.85
- Vibe-based "this might be slow" → < 0.7 (will drop at Verify)
