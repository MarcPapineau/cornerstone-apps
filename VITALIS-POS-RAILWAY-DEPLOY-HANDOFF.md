# Vitalis POS — Railway Deploy Handoff

**Date:** 2026-04-22  
**Branch:** `restore/vitalis-pos-option-b`  
**App:** mybioyouth-pos.netlify.app (Netlify static) → Express backend on Railway  
**Server entry:** `luke-app/server.js`  
**Node version required:** ≥18.0.0

---

## What Railway Does

Railway runs `node server.js` — the Express app that provides:

- `GET /api/products` — product catalog from `local-db.json`
- `GET /api/clients`, `POST /api/clients` — client management
- `POST /api/orders` — save order to `local-db.json`
- `GET /api/stats` — dashboard stats
- `POST /api/generate-protocol` — AI protocol generation (via Luke / OpenClaw)
- `POST /api/pdf/order`, `POST /api/pdf/protocol-pack` — PDF generation
- `POST /api/submit-order` — proxy to Windmill

All API calls from the Netlify frontend currently fail silently because the Express server is not deployed. Netlify only has one function: `submit-order`.

---

## Audit: server.js Railway-readiness

`railway.toml` (luke-app/railway.toml):
```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "node server.js"
healthcheckPath = "/api/products"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

**Status: Ready to deploy as-is.** Railway will install npm deps (`express`, `node-fetch`, `pdfkit`) via nixpacks. The `local-db.json` persistence will be ephemeral on Railway's ephemeral filesystem — see note below.

**Persistence note:** Railway does not have a persistent disk by default. Every deploy wipes `local-db.json`. For production use, Marc should either:
- Add a Railway Volume (paid plan, mount at `/app/data`)
- Or run the server locally (it already works on `localhost:3000`) and only use Railway for PDF generation + protocol AI

For the current use case (POS on Marc's phone), running locally or on a dedicated machine is simpler. Railway is the correct path if Marc wants it accessible from any device.

---

## Hardcoded Secrets Found in Server.js — MUST Move to Railway Env Vars

**These are currently hardcoded as fallback defaults (||) in server.js. They are exposed in the repo. Move all of them to Railway env vars BEFORE any public/shared deploy.**

| Secret | Location in server.js | Purpose | Railway Env Var Name |
|---|---|---|---|
| `e83c5d2f9f4b84ab5098f97dec40d958099622fbb4e3f9257f818f5f1c22ee3a` | line 28 | Luke / OpenClaw API bearer | `LUKE_BEARER` |
| `BnrlvHahVtlJrGFFA7UVrhmbwP2r1pUJ` | line 253 | Windmill service token | `WINDMILL_TOKEN` |
| `re_5kSu3TLG_FxxLKtLxQG81Mo91MpveCn1s` | line 3843 | Resend API key | `RESEND_KEY` |

Same token (`BnrlvHahVtlJrGFFA7UVrhmbwP2r1pUJ`) is also hardcoded in `netlify/functions/submit-order.js` line 14.

**Action required from Marc:** Rotate all three keys via Doppler / Levite agent before this branch is merged or pushed.

---

## The Exact 3 Things Marc Personally Does for Railway Deploy

### Step 1 — Create Railway Project from GitHub

1. Go to railway.app → New Project → Deploy from GitHub repo
2. Select the `luke-app` workspace repo
3. Set **root directory** to `luke-app/` (the Express app is here, not the repo root)
4. Railway auto-detects nixpacks + Node. It will run `npm install` then `node server.js`.

### Step 2 — Set Environment Variables in Railway Dashboard

In the Railway service → Variables tab, add these (all required):

| Variable | Value | Notes |
|---|---|---|
| `LUKE_BEARER` | (rotate — see above) | OpenClaw API token |
| `WINDMILL_TOKEN` | (rotate — see above) | Windmill service token |
| `RESEND_KEY` | (rotate — see above) | Resend email API key |
| `LUKE_URL` | `https://your-openclaw-instance.com/v1/chat/completions` | Only needed for protocol AI |
| `LUKE_MODEL` | `openclaw` | Default is already `openclaw` |
| `PORT` | (leave blank) | Railway sets this automatically |

Optional but recommended:
| `NODE_ENV` | `production` | Enables production optimizations |

### Step 3 — Point Netlify `/api/*` to Railway URL

1. After Railway deploys, copy the Railway service URL (e.g. `https://luke-app-production.up.railway.app`)
2. Edit `luke-app/netlify.toml` — add these redirects ABOVE the catch-all:

```toml
# Railway backend — handles all /api/* except submit-order (Netlify function)
[[redirects]]
  from = "/api/products"
  to = "https://YOUR-RAILWAY-URL.up.railway.app/api/products"
  status = 200
  force = true

[[redirects]]
  from = "/api/clients"
  to = "https://YOUR-RAILWAY-URL.up.railway.app/api/clients"
  status = 200
  force = true

[[redirects]]
  from = "/api/clients/*"
  to = "https://YOUR-RAILWAY-URL.up.railway.app/api/clients/:splat"
  status = 200
  force = true

[[redirects]]
  from = "/api/orders"
  to = "https://YOUR-RAILWAY-URL.up.railway.app/api/orders"
  status = 200
  force = true

[[redirects]]
  from = "/api/orders/*"
  to = "https://YOUR-RAILWAY-URL.up.railway.app/api/orders/:splat"
  status = 200
  force = true

[[redirects]]
  from = "/api/stats"
  to = "https://YOUR-RAILWAY-URL.up.railway.app/api/stats"
  status = 200
  force = true

[[redirects]]
  from = "/api/generate-protocol"
  to = "https://YOUR-RAILWAY-URL.up.railway.app/api/generate-protocol"
  status = 200
  force = true

[[redirects]]
  from = "/api/pdf/*"
  to = "https://YOUR-RAILWAY-URL.up.railway.app/api/pdf/:splat"
  status = 200
  force = true
```

3. Push `netlify.toml` changes → Netlify auto-redeploys
4. Open mybioyouth-pos.netlify.app — product catalog should now load

---

## Product Database Seeded

Before deploying Railway, copy the seeded DB to make it the live DB:

```bash
cp luke-app/data/local-db-v1.json luke-app/data/local-db.json
```

This loads 119 products (50 vials + 58 pens + 11 other) into the local JSON database. Commit `local-db.json` to the repo before Railway deploys — Railway reads it at startup.

**Note:** If Railway has an ephemeral filesystem, the products persist only until the next deploy. For a permanent solution: Railway Volume (see Persistence note above).

---

## Verify Deploy is Working

Health check: `GET https://YOUR-RAILWAY-URL.up.railway.app/api/products`

Should return JSON:
```json
{ "products": [...119 products...] }
```

If the frontend loads at mybioyouth-pos.netlify.app and the product dropdown populates — deploy is complete.
