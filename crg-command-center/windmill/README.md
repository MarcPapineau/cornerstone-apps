# Windmill — OBADIAH Orchestrator

## Script path
`u/admin/obadiah_daily_brief`

## Cron schedule
`55 10 * * *` (UTC) — fires at **10:55 UTC = 5:55am ET (EDT, Apr–Nov)**

DST note: In EST (Nov–Mar, clocks fall back), 10:55 UTC = 5:55am EST — same local time, no change needed.
If you ever want to lock to 6:05am ET year-round: change to `5 11 * * *` (Nov–Mar) and `5 10 * * *` (Apr–Oct).

## Manual trigger

Via Windmill UI:
1. Navigate to Scripts → `u/admin/obadiah_daily_brief`
2. Click "Run" → set `dry_run: true` for a safe test-fire (no git push, no Telegram send)
3. Set `dry_run: false` for a full live run

Via Windmill REST API:
```bash
WINDMILL_URL=$(doppler secrets get WINDMILL_BASE_URL -p crg-site -c prd --plain)
WINDMILL_TOKEN=$(doppler secrets get WINDMILL_TOKEN -p crg-site -c prd --plain)

curl -X POST "$WINDMILL_URL/api/w/admins/jobs/run/p/u/admin/obadiah_daily_brief" \
  -H "Authorization: Bearer $WINDMILL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```

## Required Windmill variables (set via UI → Variables)
All mirrored from Doppler `crg-site/prd`:

| Variable path | Doppler key | Notes |
|---|---|---|
| `u/admin/ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | Main Anthropic key |
| `u/admin/COINGLASS_API_KEY` | `COINGLASS_API_KEY` | Coinglass REST auth |
| `u/admin/TELEGRAM_BOT_TOKEN` | `TELEGRAM_BOT_TOKEN` | CRG Telegram bot |
| `u/admin/MARC_TELEGRAM_CHAT_ID` | `MARC_TELEGRAM_CHAT_ID` | Marc's personal chat |
| `u/admin/OBADIAH_AGENT_ID` | `OBADIAH_AGENT_ID` | Optional — Builder 1 sets after agent creation |
| `u/admin/OBADIAH_TELEGRAM_CHAT_ID` | `OBADIAH_TELEGRAM_CHAT_ID` | Optional override for chat ID |

## Agent path logic
- If `OBADIAH_AGENT_ID` is set → Managed Agents API (preferred — uses full OBADIAH persona)
- If missing or variable not found → Messages API fallback with embedded system prompt
- Messages API also used if Managed Agents call fails (catches + falls back automatically)

## Timeout / failure handling
- Each external fetch has a 30s timeout via AbortController
- Any single source failure is logged + skipped — script continues with partial data
- If OBADIAH output is invalid JSON, one automatic retry with explicit correction prompt
- If both attempts fail, job exits with `ok: false` + error message (Windmill marks job failed)
- Telegram: if Markdown parse fails, retries with plain text

## How to disable
In Windmill UI: Schedules → `u/admin/obadiah_daily_brief_schedule` → toggle to disabled.
Script itself: set `dry_run: true` in schedule args (still runs, no side effects).

## DST switching
Windmill cron is pure UTC — no automatic DST conversion. Current schedule `55 10 * * *`:
- EDT (Mar–Nov): 10:55 UTC = 5:55am ET ✓
- EST (Nov–Mar): 10:55 UTC = 5:55am ET ✓ (same — EST is UTC-5, EDT is UTC-4)

To shift to 6:55am ET: change to `55 11 * * *` (EDT) or `55 10 * * *` (EST).

## Data sources
| Source | Key needed | Endpoint |
|---|---|---|
| CoinGecko | None (free tier) | `/coins/markets`, `/coins/{id}/ohlc` |
| DefiLlama | None | `api.llama.fi/protocols`, `/overview/fees` |
| Coin Metrics | None | `community-api.coinmetrics.io/v4/timeseries/asset-metrics` |
| Alternative.me | None | `api.alternative.me/fng/` |
| Coinglass | `COINGLASS_API_KEY` | `/funding_usd_history`, `/open_interest` |
| CoinDesk RSS | None | `coindesk.com/arc/outboundfeeds/rss/` |
| Events | Local file | `data/crypto-events.json` (seeded by Builder 4) |

## Output files
- `data/crypto-latest.json` — overwritten each run (current snapshot)
- `data/crypto-history.json` — rolling array, newest-first, capped at 90 entries
- Both committed to `main` with message `data: OBADIAH brief YYYY-MM-DD`
- Netlify auto-deploys `main` → `crg-command.netlify.app/crypto.html` reads latest JSON

## Windmill deploy commands
```bash
# Deploy via REST API (no wmill CLI required)
WINDMILL_URL=$(doppler secrets get WINDMILL_BASE_URL -p crg-site -c prd --plain)
WINDMILL_TOKEN=$(doppler secrets get WINDMILL_TOKEN -p crg-site -c prd --plain)
SCRIPT_CONTENT=$(cat windmill/obadiah-daily-brief.ts)

# Create/update script
curl -X POST "$WINDMILL_URL/api/w/admins/scripts/create" \
  -H "Authorization: Bearer $WINDMILL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"path\": \"u/admin/obadiah_daily_brief\",
    \"language\": \"deno\",
    \"content\": $(jq -Rs . <<< \"$SCRIPT_CONTENT\"),
    \"description\": \"OBADIAH crypto intelligence — daily 5:55am ET brief\"
  }"

# Create schedule (cron 55 10 * * * UTC)
curl -X POST "$WINDMILL_URL/api/w/admins/schedules/create" \
  -H "Authorization: Bearer $WINDMILL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "path": "u/admin/obadiah_daily_brief_schedule",
    "schedule": "55 10 * * *",
    "timezone": "UTC",
    "script_path": "u/admin/obadiah_daily_brief",
    "is_flow": false,
    "enabled": true,
    "args": {}
  }'
```
