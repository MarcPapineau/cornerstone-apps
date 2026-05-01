# Habakkuk Rubric — api-contracts

> Anti-Drift + WKU loaded at runtime into your system prompt. Not repeated.

## What "api-contracts" means in this CRG codebase

The "APIs" here are mostly Netlify Functions that bridge the front-end
to Anthropic, GHL, Resend, and other CRG-internal services. Contracts
are loose (no OpenAPI spec) — flag changes that break the implicit
shape callers depend on.

Hot interfaces:
- `peptide-resource-app/netlify/functions/find-protocol.js`
- `peptide-resource-app/netlify/functions/vitalis-chat.js`
- `peptide-resource-app/netlify/functions/vitalis-chat-background.js`
- `luke-app/netlify/functions/submit-order.js` (deleted in this PR —
  flag if any caller still references it)
- Any Anthropic SDK call shape — system_prompt, tools, model id, max_tokens

## Severity calibration

- **Blocker**: deleting or renaming a function whose caller still
  invokes it; changing the response JSON shape in a way the caller
  parses; removing a required request field; switching model IDs to
  one that's deprecated or doesn't exist.
- **Major**: changing default values silently (e.g. max_tokens drops
  from 4096 to 1024, breaking long replies); adding a required field
  on the request side without migrating the caller; changing HTTP
  status semantics (200 → 204 etc).
- **Minor**: response field rename when both names are present
  during a migration; HTTP method change (POST → PUT) that the caller
  also updated; new optional response field.
- **Nit**: function naming style; arg order conventions.

## Hot patterns to scan in this PR

1. Anthropic model IDs — flag any string like
   `claude-3-5-sonnet-20240620` that's been retired. Per CRG doctrine:
   no Haiku, default Sonnet 4.6, Opus 4.7 for select agents.
2. Any function that's been deleted — search the rest of the diff for
   callers still referencing the old path.
3. JSON response shape changes — if you can see both the function and
   a consumer in the same PR, flag mismatches.
4. New required env vars on a function that callers won't have set
   locally / in Netlify — flag missing fallback or clear error.
5. Background functions (vitalis-chat-background) — flag if they're
   invoked synchronously from a place that expects a response.
6. CORS headers — Netlify functions sometimes need explicit
   Access-Control-Allow-Origin; flag if a new function is called from
   a different origin without it.

## What NOT to flag

- "Adopt OpenAPI / GraphQL" — out of scope.
- Versioning ceremony for internal-only functions.
- "Add request validation library" without a concrete failing input.
- Generic API design lectures.

## Confidence anchors

- Caller and callee both visible in diff with a shape mismatch → 0.95+
- Caller visible only via grep results referenced from plan → 0.8-0.9
- Suspected callers but no direct evidence → 0.7-0.8
- "Maybe someone calls this" → < 0.7 (drop at Verify)
