# Vitalis Health Co. — App Brand Guidelines

Brand system for the **app shell + dashboards** of `my-vitalis-health`
(React + Vite + Tailwind SPA). Bright platinum field, restrained cobalt accent,
graphite ink. Premium, clean, operational — **not** dark-blue corporate.

> The protocol **dossier** is a deliberately separate warm "document world"
> (charcoal · antique-gold · cream/parchment). It is **off-limits** to this brand
> system and fully insulated — see the last section.

---

## 1. Canonical colors (4 anchors)

| Token | Name | HEX | HSL (`H S% L%`) | Role |
|---|---|---|---|---|
| `--primary` / `--accent` / `--ring` / `--gold` | **Vitalis Cobalt** | `#033594` | `219 96% 30%` | The logo ink. Interactive (buttons, active nav, focus) + the brand accent. The restrained **~15%**. |
| `--border` family | **Silver Steel** | `#AEB5BF` | `215 12% 72%` | Cool neutral for dividers / secondary chrome. Anchors the platinum surfaces & borders (≈214–220°, low sat). |
| `--card` | **Pure White** | `#FFFFFF` | `0 0% 100%` | Cards / negative space. The **~30%**. |
| `--foreground` / `--ink` | **Deep Graphite** | `#1E2430` | `220 23% 15%` | Body text. The **~5%**. |

> **Cobalt hex is measured, not printed.** The brand guidelines deck did **not**
> print a labeled cobalt hex; `#033594` was **pixel-measured from the supplied
> logo artwork**, which Marc directed as the brand source — so `#033594` is
> authoritative here. A near-identical `#003DA5` may appear on the deck — **open
> confirm for Marc**, but the app is built to `#033594`.

### Guardrail ratio — **~50% platinum/silver · 30% white · 15% cobalt · 5% graphite**

Cobalt is an **accent, never a background**. The dominant field is bright cool
platinum; cards are near-white; cobalt appears only on interactive/brand
elements; graphite is ink + the occasional anchor.

### Surface & semantic tokens (in `src/index.css :root`)

| Token | HSL | Note |
|---|---|---|
| `--background` | `214 24% 96%` | Bright cool-platinum app field (the dominant surface) |
| `--card` | `210 30% 99.5%` | Near-pure-white panel |
| `--panel` | `214 26% 94%` | Light platinum tinted section |
| `--muted` | `214 22% 92%` | Table/header wash |
| `--border` | `214 15% 78%` | Silver-steel line |
| `--border-soft` | `214 19% 87%` | Hairline |
| `--accent-soft` / `--gold-soft` | `217 60% 93%` | Pale cobalt wash (active nav, soft chips) |
| `--success` | `158 42% 32%` | Cooled clinical green |
| `--warning` | `32 60% 42%` | Cooled amber |
| `--danger` | `4 62% 47%` | Cooled red |
| `--neutral` | `218 12% 44%` | Cool graphite-steel |

Semantic success/amber/danger keep their meaning; hue/sat is cooled so they
harmonize on platinum.

> **Token format:** values are the bare `H S% L%` triple (no `hsl(...)` wrapper,
> no commas). Tailwind wraps them as `hsl(var(--x) / <alpha>)`.

---

## 2. Typography

| Family | Role |
|---|---|
| **Cormorant Garamond** (`font-serif`) | Display serif — logo wordmark + big editorial dashboard headlines (`DashboardHero` masthead). |
| **Montserrat** (`font-display` / `font-label`) | Geometric sans — section labels / eyebrows / subheads. |
| **Inter** (`font-sans`) | Body / UI. Default. |
| **JetBrains Mono** (`font-data` / `font-mono`) | Numerals / data points (clinical instrument feel). |

- Loaded via the Google Fonts `@import` on **`src/index.css` line 1** (alongside
  Inter + JetBrains Mono).
- Stacks defined in `tailwind.config.cjs → fontFamily`
  (`serif`, `display`, `label`).
- **Apply tastefully.** Cormorant on the brand wordmark + masthead headline only.
  Montserrat on eyebrows / section labels. **Never** serif-ify body text.

---

## 3. Logo

**Use the SUPPLIED artwork only.** Do **not** redraw, stylize, simplify,
recolor, add glow, or invent a variant. Trim / crop / scale of the supplied
artwork is allowed; anything else is not.

Source artwork (cobalt stacked lockup on transparent, 1024²):
`Desktop/Vitalis/Vitalis Dashboard/Brand guidelines/4D5A795D-96E9-47BB-AC5C-A8B713835E57.png`
— a cobalt "V" mark (twin fronds + dot-head figure + DNA helix in the negative
space) above serif "VITALIS / HEALTH CO."

App assets (in `src/assets/`, exported from that artwork only):

| Asset | What | Where |
|---|---|---|
| `vitalis-logo.png` | Trimmed full lockup (transparent bg) | General brand use |
| `vitalis-mark.png` | The V-mark alone, squared (transparent bg) | Sidebar chip |
| `favicon.png` (also `public/favicon.png`) | 64px V-mark | Browser tab |

- Sidebar mark sits on a **white chip**, never a cobalt square (a cobalt mark on
  cobalt would be invisible). The "Vitalis" wordmark beside it is set in Cormorant.
- Regenerate assets with `scripts/_make_logo_assets.py <source.png> src/assets`
  (content-aware trim + V-mark crop via PIL). Re-copy `favicon.png` to `public/`.

---

## 4. Where brand lives in code

| Concern | File |
|---|---|
| Color tokens (the whole re-skin) | `src/index.css` → `:root` |
| Token → Tailwind utility wiring + fonts + shadows | `tailwind.config.cjs` |
| Logo (sidebar) | `src/components/Sidebar.jsx` |
| Favicon + font preconnect + title | `index.html` |
| Chart / ring / series colors (theme vars) | `--chart-1..3`, `--chart-grid`, `--chart-axis`, `--ring-track` in `:root`, consumed by `src/components/charts/ProgressRing.jsx`, `src/components/charts/TrendChart.jsx`, and the inline trend charts in `src/pages/Dashboard.jsx` + `src/pages/Outcomes.jsx` |
| Dashboard masthead typography | `src/components/dashboard/composers.jsx` (`DashboardHero`) |

**Chart vars** (`--chart-*`, `--ring-track`) are deliberately **distinct** from
the dossier's `--vd-*` vars: cobalt (`--chart-1`) + cool steel (`--chart-2`) +
cooled green (`--chart-3`) on a platinum grid. Recolor here, never restructure a
chart or its honest empty state.

Most of the app re-skins from the `:root` token edit alone — components consume
tokens via Tailwind utilities (`bg-card`, `text-foreground`, `bg-primary`,
`text-gold`, `border-border`, …). The lockstep chart/ring edits exist only
because those few files baked literal colors that bypassed the tokens.

---

## 5. The protocol dossier is a separate "document world" — OFF-LIMITS

The protocol **dossier** (`src/components/document/**`, incl. `vdoc.css`,
`PeptideProtocolDocument.jsx`, `VitalisDocumentShell.jsx`) is intentionally a
**warm** editorial clinical identity — **charcoal + antique-gold + cream/
parchment** — extracted 1:1 from the canonical PDF. It is **not** part of this
cobalt/platinum app brand.

It is **insulated**: every `.vd-*` class gets its color from `--vd-*` variables
scoped under `.vdoc` in `vdoc.css`, and references **zero** app tokens. It also
has its **own** Cormorant `@import`. A correct app-token re-skin **cannot change
one pixel of it**.

**Do not** recolor, "reconcile," or cobalt-ify the dossier. The four protocol
visual baselines (`protocol-cover/-fullpage/-s02-schedule/-s05-signals.png`)
must stay byte-identical across any app re-skin — if they move, accidental
coupling was introduced and must be reverted, not re-baselined.
