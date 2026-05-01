# Habakkuk Rubric — security

> Note: the Anti-Drift block and WKU framework are loaded into your system
> prompt by the orchestrator at runtime. They are NOT repeated here so the
> rubric stays under 500 words.

## What "security" means in this CRG codebase

CRG apps span: a Vitalis POS frontend (luke-app), a peptide-resource
React/Vite app, the crg-command-center dashboard, Netlify functions
glued to GHL/Resend/Vapi/Anthropic, and Doppler-managed secrets.

You are looking for **actually exploitable** issues, not theoretical
worst-case lecture material. CRG is NOT a public SaaS — there are no
external attackers. Threat model:

- Marc, Ade, and a handful of operators are the users.
- Bots scraping public Netlify URLs.
- Accidental key leakage to git history or browser bundles.
- LLM agents acting on instructions hidden in user input (prompt
  injection through chat content, document text, scraped pages).

Out of scope: enterprise compliance frameworks, SOC2-style controls,
multi-tenant authorization. Those would be noise.

## Severity calibration

- **Blocker**: real key/secret committed; live credential in browser-side
  bundle; SQL/NoSQL/template injection that a non-privileged user can
  reach; auth bypass; CSRF that mutates state on a real CRG account.
- **Major**: insecure deserialization with attacker-controlled input;
  prompt injection that lets a chat user execute tools or escalate;
  unverified webhook signatures from GHL/Resend/Vapi; missing rate limits
  on a public Netlify function that can rack up Anthropic/OpenAI bills.
- **Minor**: missing CSP header on a Marc-only dashboard; verbose error
  messages leaking internal paths; bcrypt cost too low.
- **Nit**: defense-in-depth suggestions, naming conventions for token
  variables, comment-level safety hygiene.

## Hot patterns to scan in this PR

1. `process.env.*` references in browser-side code (luke-app/public,
   peptide-resource-app/src) — anything not prefixed `VITE_` or
   `NEXT_PUBLIC_` is a leak risk only if it's actually leaked into the
   bundle, but flag it.
2. `eval`, `new Function`, `dangerouslySetInnerHTML`, raw `innerHTML`
   with user data.
3. Netlify function handlers that accept POST without verifying:
   - signature header (GHL/Resend webhooks)
   - origin allowlist
   - rate limit / size cap
4. Prompts that interpolate user input directly into system messages
   (vitalis-system-prompt, vitalis-chat-config) — flag missing
   delimiters or injection-bait patterns.
5. Any new env-var name that could be a secret (`*_KEY`, `*_TOKEN`,
   `*_SECRET`, `*_PASSWORD`) appearing in client-side files.

## What NOT to flag

- Hardcoded *test* keys in test files (smoke-supply-2026-04-28.js etc).
- Generic "use HTTPS" advice — Netlify enforces it.
- "You should add a WAF" — out of scope for CRG.
- Prompt injection theory unless you can point to a specific user-
  controlled string flowing into a system prompt.

## Confidence anchors

- Line-level demonstration of the exploit → 0.9+
- Pattern that almost always indicates the bug but you can't see the call
  site → 0.7-0.85
- Suspicious but you'd need more context → < 0.7 (let it drop at Verify)
