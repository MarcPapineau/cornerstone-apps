# Habakkuk Rubric — ux-a11y

> Anti-Drift + WKU loaded at runtime into your system prompt. Not repeated.

## What "ux-a11y" means in this CRG codebase

CRG apps are used by Marc, Ade, and a small number of internal operators
on iPads, MacBooks, and occasionally a phone. Accessibility is for these
real users — not WCAG audit theatre. Look for:

- Hit-target sizes too small for thumb use (POS lives on Ade's iPad).
- Modal centering / off-screen rendering issues (Marc has hit this
  twice on POS — see the most recent commit).
- Color contrast on the Garvis design tokens — the dark-on-tan palette
  has been a recurring trip hazard.
- Print-style outputs (POS prints invoices/protocols) — wrapped lines,
  cut text, missing fields.
- Tab order / keyboard nav for fields Marc actually uses.
- Empty-state copy that disappears on edge cases (loading shimmer never
  resolves, etc).

Out of scope: full WCAG 2.1 AA conformance audits; aria-label on every
icon in the universe; theming for users CRG doesn't have.

## Severity calibration

- **Blocker**: a primary action is unreachable on iPad-Safari; modal
  renders off-screen; data loss on tap-outside; print output truncates
  a price or dose.
- **Major**: a critical hit target < 32px on touch; failing color
  contrast on a CTA Marc uses daily; a form that silently swallows
  invalid input.
- **Minor**: missing aria-label on an icon button; placeholder text
  used in place of a label; redundant focus rings.
- **Nit**: copy tone, button casing, marginal kerning.

## Hot patterns to scan in this PR

1. `position: fixed`, `position: absolute`, `transform: translate(-50%, -50%)`
   on modals — Marc reported off-screen rendering on POS New Client.
   Flag any modal centering pattern that doesn't account for viewport
   height.
2. Inline `onClick` wrappers that swallow errors without showing them
   to the user.
3. `display: none` toggles vs unmount — flag if focus ends up trapped
   in a hidden subtree.
4. Garvis design tokens — flag any hex value that bypasses the token
   system (Marc just sweeped these in commit 815d857).
5. Dose math display strings — Marc cares about exact mg/wk presentation
   (paired-pen math is touchy). Flag any rounding that drops a decimal
   in a UI label.
6. Print-only CSS rules — `@media print` blocks; flag if a price or
   dose field has no print-visible style.

## What NOT to flag

- Generic "consider adding a skip-to-content link" — there are no
  public users.
- "Your color palette doesn't pass AAA on every paragraph" — AA is
  the bar, and only on text Marc reads.
- Internationalization gaps — single-locale app.
- "Add a screen-reader-only legend to every chart" — not required for
  Marc's use.

## Confidence anchors

- Reproducible with a numeric example (e.g. "30px hit target violates
  iOS 44pt min on iPad") → 0.9+
- Pattern that breaks on most viewports but not all → 0.7-0.85
- Aesthetic preference dressed as a11y → < 0.7
