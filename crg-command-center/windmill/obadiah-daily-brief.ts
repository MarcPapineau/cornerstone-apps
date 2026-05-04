// =============================================================================
// OBADIAH the Prophet — Daily Crypto Intelligence Brief (Windmill TS)
// =============================================================================
//
// Schedule: 55 10 * * * (10:55 UTC = 5:55am ET / EDT)
// Windmill path: u/admin/obadiah_daily_brief
//
// V1 Architecture: Windmill fetches ALL data. OBADIAH receives snapshot in
// user message and does pure reasoning. No agent-side tool calls in V1.
//
// Anti-drift rules:
// 1. EVIDENCE-OR-INCOMPLETE — logs HTTP status + job IDs at every step.
// 2. NO HARDCODED SECRETS — all keys from Windmill variables (Doppler mirror).
// 3. FAIL-TOLERANT — single source failure logs + continues. Promise.all all fetches.
// 4. DEFENSIVE AGENT_ID — falls back to Messages API if OBADIAH_AGENT_ID missing.
// 5. DRY-RUN — skips git push and Telegram send; logs brief text instead.
//
// Schedule note (DST): 10:55 UTC = 5:55am ET in EDT (Apr–Nov).
//                      In EST (Nov–Mar) this fires at 5:55am EST = same local time.
//                      Adjust to 11:55 UTC if clocks fall back and time must stay 5:55am.
//
// =============================================================================

import * as wmill from "windmill-client";
import { readFileSync, writeFileSync, existsSync } from "fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MainArgs {
  dry_run?: boolean;
}

interface DataFreshness {
  coingecko: string | null;
  coinglass: string | null;
  coin_metrics: string | null;
  defillama: string | null;
  fear_greed: string | null;
  coindesk_rss: string | null;
}

interface FetchResult<T> {
  source: string;
  ok: boolean;
  data?: T;
  error?: string;
  fetched_at: string;
}

interface ObadiahSnapshot {
  generated_at: string;
  top_markets: unknown;
  ohlcv_7d: Record<string, unknown>;
  defi_tvl: unknown;
  defi_fees: unknown;
  coin_metrics: unknown;
  fear_greed_today: unknown;
  fear_greed_yesterday: unknown;
  coinglass_funding: unknown;
  coinglass_oi: unknown;
  news_headlines: NewsItem[];
  upcoming_events: EventItem[];
  data_freshness: DataFreshness;
  fetch_errors: string[];
}

interface NewsItem {
  headline: string;
  source: string;
  url: string;
  published_at: string;
}

interface EventItem {
  name: string;
  date: string;
  category: string;
  impact: string;
  description: string;
  affected_assets: string[];
}

interface ObadiahOutput {
  schema: string;
  generated_at: string;
  market_regime: string;
  regime_confidence: number;
  regime_commentary: string;
  fear_greed: {
    value: number;
    classification: string;
    trend_24h: string;
  };
  top_assets: unknown[];
  recommendations: unknown[];
  news: unknown[];
  events: unknown[];
  data_freshness: DataFreshness;
}

interface MainResult {
  ok: boolean;
  mode?: "production_disabled" | "live";
  date: string;
  obadiah_path: string;
  json_written: boolean;
  history_written: boolean;
  git_committed: boolean;
  telegram_sent: boolean;
  dry_run: boolean;
  production_enabled?: boolean;
  dry_run_log?: string[];
  error?: string;
  telegram_brief_preview?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

async function fetchWithTimeout<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 30_000,
): Promise<FetchResult<T>> {
  const source = url.replace(/\?.*$/, "").split("/").slice(0, 5).join("/");
  const fetched_at = now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { source, ok: false, fetched_at, error: `HTTP ${res.status} ${res.statusText}` };
    }
    const data = await res.json() as T;
    return { source, ok: true, data, fetched_at };
  } catch (e) {
    return { source, ok: false, fetched_at, error: String(e).slice(0, 200) };
  }
}

// Parse RSS XML for CoinDesk headlines (no external XML parser — use regex on well-known format)
function parseCoinDeskRSS(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 15) {
    const block = match[1];
    const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) ??
      /<title>(.*?)<\/title>/.exec(block))?.[1]?.trim() ?? "";
    const link = (/<link>(.*?)<\/link>/.exec(block))?.[1]?.trim() ??
      (/<guid>(.*?)<\/guid>/.exec(block))?.[1]?.trim() ?? "";
    const pubDate = (/<pubDate>(.*?)<\/pubDate>/.exec(block))?.[1]?.trim() ?? "";
    if (title) {
      items.push({
        headline: title,
        source: "CoinDesk",
        url: link,
        published_at: pubDate ? new Date(pubDate).toISOString() : now(),
      });
    }
  }
  return items;
}

// Filter events to next 30 days
function filterUpcomingEvents(events: EventItem[]): EventItem[] {
  const today = new Date();
  const cutoff = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  return events.filter((e) => {
    const d = new Date(e.date);
    return d >= today && d <= cutoff;
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(args: MainArgs = {}): Promise<MainResult> {
  const dry_run = args.dry_run ?? false;
  const runDate = new Date().toISOString().split("T")[0];
  const generatedAt = now();

  // -------------------------------------------------------------------------
  // 0. PRODUCTION GATE — belt-and-suspenders guard (independent of --dry-run)
  //
  //    Set Windmill variable u/admin/OBADIAH_PRODUCTION_ENABLED = "true"
  //    ONLY after Gate G + orchestrator greenlight + merge to main.
  //    Default: "false" (safe). Bun bundle cache cannot bypass this — the
  //    value is read from Windmill variables at runtime, not compile time.
  // -------------------------------------------------------------------------
  let PRODUCTION_ENABLED = false;
  try {
    const prodFlag = await wmill.getVariable("u/admin/OBADIAH_PRODUCTION_ENABLED");
    PRODUCTION_ENABLED = prodFlag?.trim() === "true";
  } catch {
    // Variable not set → default safe (false)
    console.log("[OBADIAH] OBADIAH_PRODUCTION_ENABLED variable not found — defaulting to production_disabled mode");
  }

  console.log(`[OBADIAH] Starting daily brief — ${generatedAt} — dry_run=${dry_run} — production_enabled=${PRODUCTION_ENABLED}`);

  // -------------------------------------------------------------------------
  // 1. Pull secrets from Windmill variables (Doppler mirrors)
  // -------------------------------------------------------------------------
  const ANTHROPIC_API_KEY = await wmill.getVariable("u/admin/ANTHROPIC_API_KEY");
  const COINGLASS_API_KEY = await wmill.getVariable("u/admin/COINGLASS_API_KEY");
  const TELEGRAM_BOT_TOKEN = await wmill.getVariable("u/admin/TELEGRAM_BOT_TOKEN");

  // OBADIAH_AGENT_ID — optional. Builder 1 creates agent + saves to Doppler.
  // Falls back to Messages API if missing.
  let OBADIAH_AGENT_ID: string | null = null;
  try {
    OBADIAH_AGENT_ID = await wmill.getVariable("u/admin/OBADIAH_AGENT_ID");
    if (!OBADIAH_AGENT_ID || OBADIAH_AGENT_ID.trim() === "") OBADIAH_AGENT_ID = null;
  } catch {
    console.log("[OBADIAH] OBADIAH_AGENT_ID not found — using Messages API fallback");
  }

  // Telegram chat ID — prefer OBADIAH_TELEGRAM_CHAT_ID, fall back to MARC_TELEGRAM_CHAT_ID
  let TELEGRAM_CHAT_ID: string | null = null;
  try {
    TELEGRAM_CHAT_ID = await wmill.getVariable("u/admin/OBADIAH_TELEGRAM_CHAT_ID");
  } catch {
    try {
      TELEGRAM_CHAT_ID = await wmill.getVariable("u/admin/MARC_TELEGRAM_CHAT_ID");
      console.log("[OBADIAH] Using MARC_TELEGRAM_CHAT_ID as fallback for Telegram delivery");
    } catch {
      console.log("[OBADIAH] No Telegram chat ID found — will log brief, skip send");
    }
  }

  const fetchErrors: string[] = [];
  const freshness: DataFreshness = {
    coingecko: null,
    coinglass: null,
    coin_metrics: null,
    defillama: null,
    fear_greed: null,
    coindesk_rss: null,
  };

  // -------------------------------------------------------------------------
  // 2. Fetch all data sources in parallel (Promise.all, tolerate failures)
  // -------------------------------------------------------------------------
  console.log("[OBADIAH] Fetching all data sources in parallel...");

  const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
  const COIN_METRICS_BASE = "https://community-api.coinmetrics.io/v4";
  const COINGLASS_BASE = "https://open-api.coinglass.com/public/v2";
  const DEFILLAMA_BASE = "https://api.llama.fi";

  const [
    marketsResult,
    ohlcvBtcResult,
    ohlcvEthResult,
    ohlcvSolResult,
    defiTvlResult,
    defiFeesResult,
    coinMetricsResult,
    fearGreedResult,
    coinglassFundingResult,
    coinglassOIResult,
  ] = await Promise.all([
    // CoinGecko — top 10 by market cap (prices, 24h change, volume, market cap)
    fetchWithTimeout<unknown>(
      `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h,7d`,
    ),

    // CoinGecko — BTC 7-day OHLCV
    fetchWithTimeout<unknown>(
      `${COINGECKO_BASE}/coins/bitcoin/ohlc?vs_currency=usd&days=7`,
    ),

    // CoinGecko — ETH 7-day OHLCV
    fetchWithTimeout<unknown>(
      `${COINGECKO_BASE}/coins/ethereum/ohlc?vs_currency=usd&days=7`,
    ),

    // CoinGecko — SOL 7-day OHLCV
    fetchWithTimeout<unknown>(
      `${COINGECKO_BASE}/coins/solana/ohlc?vs_currency=usd&days=7`,
    ),

    // DefiLlama — top 100 protocols TVL
    fetchWithTimeout<unknown>(`${DEFILLAMA_BASE}/protocols`),

    // DefiLlama — protocol fees overview
    fetchWithTimeout<unknown>(`${DEFILLAMA_BASE}/overview/fees`),

    // Coin Metrics Community — BTC + ETH on-chain metrics (MVRV-Z primitives)
    fetchWithTimeout<unknown>(
      `${COIN_METRICS_BASE}/timeseries/asset-metrics?assets=btc,eth&metrics=CapMrktCurUSD,CapRealUSD,SplyAct1yr&frequency=1d&page_size=2`,
    ),

    // Alternative.me Fear & Greed — today + yesterday
    fetchWithTimeout<unknown>("https://api.alternative.me/fng/?limit=2"),

    // Coinglass — funding rates BTC + ETH
    fetchWithTimeout<unknown>(
      `${COINGLASS_BASE}/funding_usd_history?symbol=BTC&interval=8h`,
      { headers: { "coinglassSecret": COINGLASS_API_KEY } },
    ),

    // Coinglass — open interest BTC
    fetchWithTimeout<unknown>(
      `${COINGLASS_BASE}/open_interest?symbol=BTC`,
      { headers: { "coinglassSecret": COINGLASS_API_KEY } },
    ),
  ]);

  // Log fetch results and populate freshness
  const results = [
    { name: "CoinGecko markets", r: marketsResult },
    { name: "CoinGecko OHLCV BTC", r: ohlcvBtcResult },
    { name: "CoinGecko OHLCV ETH", r: ohlcvEthResult },
    { name: "CoinGecko OHLCV SOL", r: ohlcvSolResult },
    { name: "DefiLlama TVL", r: defiTvlResult },
    { name: "DefiLlama Fees", r: defiFeesResult },
    { name: "Coin Metrics", r: coinMetricsResult },
    { name: "Fear & Greed", r: fearGreedResult },
    { name: "Coinglass Funding", r: coinglassFundingResult },
    { name: "Coinglass OI", r: coinglassOIResult },
  ];

  for (const { name, r } of results) {
    if (r.ok) {
      console.log(`[FETCH] OK: ${name} at ${r.fetched_at}`);
    } else {
      console.log(`[FETCH] FAIL: ${name} — ${r.error}`);
      fetchErrors.push(`${name}: ${r.error}`);
    }
  }

  // Set freshness timestamps
  if (marketsResult.ok) freshness.coingecko = marketsResult.fetched_at;
  if (coinglassFundingResult.ok || coinglassOIResult.ok) freshness.coinglass = now();
  if (coinMetricsResult.ok) freshness.coin_metrics = coinMetricsResult.fetched_at;
  if (defiTvlResult.ok || defiFeesResult.ok) freshness.defillama = now();
  if (fearGreedResult.ok) freshness.fear_greed = fearGreedResult.fetched_at;

  // -------------------------------------------------------------------------
  // 3. Fetch CoinDesk RSS (separate — returns text/xml not JSON)
  // -------------------------------------------------------------------------
  let newsItems: NewsItem[] = [];
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30_000);
    const rssRes = await fetch(
      "https://www.coindesk.com/arc/outboundfeeds/rss/",
      { signal: controller.signal },
    );
    if (rssRes.ok) {
      const xml = await rssRes.text();
      newsItems = parseCoinDeskRSS(xml);
      freshness.coindesk_rss = now();
      console.log(`[FETCH] OK: CoinDesk RSS — ${newsItems.length} items`);
    } else {
      fetchErrors.push(`CoinDesk RSS: HTTP ${rssRes.status}`);
      console.log(`[FETCH] FAIL: CoinDesk RSS — HTTP ${rssRes.status}`);
    }
  } catch (e) {
    fetchErrors.push(`CoinDesk RSS: ${String(e).slice(0, 100)}`);
    console.log(`[FETCH] FAIL: CoinDesk RSS — ${String(e).slice(0, 100)}`);
  }

  // -------------------------------------------------------------------------
  // 4. Read crypto-events.json (seeded by Builder 4)
  // -------------------------------------------------------------------------
  let upcomingEvents: EventItem[] = [];
  // Events file path — Windmill worker mounts the workspace if configured,
  // otherwise falls back gracefully with empty events list
  const eventsPath = process.env.CRG_EVENTS_PATH ||
    "/Users/marcpapineau/.openclaw/workspace/crg-command-center/data/crypto-events.json";
  try {
    if (existsSync(eventsPath)) {
      const eventsRaw = readFileSync(eventsPath, "utf8");
      const allEvents = JSON.parse(eventsRaw) as EventItem[];
      upcomingEvents = filterUpcomingEvents(allEvents);
      console.log(`[EVENTS] Loaded ${allEvents.length} events → ${upcomingEvents.length} in next 30 days`);
    } else {
      console.log(`[EVENTS] crypto-events.json not found at ${eventsPath} — continuing with empty events`);
    }
  } catch (e) {
    console.log(`[EVENTS] Could not read crypto-events.json: ${String(e).slice(0, 100)} — continuing with empty events`);
    fetchErrors.push(`crypto-events.json: ${String(e).slice(0, 100)}`);
  }

  // -------------------------------------------------------------------------
  // 5. Build snapshot JSON for OBADIAH
  // -------------------------------------------------------------------------
  // Trim large arrays to keep snapshot under ~200KB for the Anthropic API call
  const defiTvlTrimmed = defiTvlResult.ok && Array.isArray(defiTvlResult.data)
    ? (defiTvlResult.data as Record<string, unknown>[]).slice(0, 15).map((p) => ({
        name: p.name, symbol: p.symbol, tvl: p.tvl, chainTvls: undefined,
        change_1h: p.change_1h, change_1d: p.change_1d, change_7d: p.change_7d,
        mcap: p.mcap, category: p.category,
      }))
    : null;

  // DefiLlama fees overview — keep only the top 20 protocols by revenue
  const defiFeesRaw = defiFeesResult.data as { protocols?: Record<string, unknown>[] } | null;
  const defiFeeTrimmed = defiFeesRaw?.protocols
    ? defiFeesRaw.protocols.slice(0, 20).map((p) => ({
        name: p.name, total24h: p.total24h, total7d: p.total7d, totalAllTime: p.totalAllTime,
      }))
    : null;

  // Coinglass — trim funding data to first 20 entries
  const cgFundingRaw = coinglassFundingResult.data as { data?: unknown[] } | null;
  const cgFundingTrimmed = cgFundingRaw?.data ? cgFundingRaw.data.slice(0, 20) : coinglassFundingResult.data;

  const snapshot: ObadiahSnapshot = {
    generated_at: generatedAt,
    top_markets: marketsResult.data ?? null,
    ohlcv_7d: {
      BTC: ohlcvBtcResult.data ?? null,
      ETH: ohlcvEthResult.data ?? null,
      SOL: ohlcvSolResult.data ?? null,
    },
    defi_tvl: defiTvlTrimmed,
    defi_fees: defiFeeTrimmed,
    coin_metrics: coinMetricsResult.data ?? null,
    fear_greed_today: fearGreedResult.ok
      ? (fearGreedResult.data as { data?: unknown[] })?.data?.[0] ?? null
      : null,
    fear_greed_yesterday: fearGreedResult.ok
      ? (fearGreedResult.data as { data?: unknown[] })?.data?.[1] ?? null
      : null,
    coinglass_funding: cgFundingTrimmed,
    coinglass_oi: coinglassOIResult.data ?? null,
    news_headlines: newsItems,
    upcoming_events: upcomingEvents,
    data_freshness: freshness,
    fetch_errors: fetchErrors,
  };

  const snapshotStr = JSON.stringify(snapshot);
  console.log(`[OBADIAH] Snapshot built — ${fetchErrors.length} fetch errors, ${newsItems.length} news items, ${upcomingEvents.length} events, ~${Math.round(snapshotStr.length / 1024)}KB`);

  // -------------------------------------------------------------------------
  // 6. Call OBADIAH — Managed Agents API if AGENT_ID exists, else Messages API
  // -------------------------------------------------------------------------
  const snapshotJson = JSON.stringify(snapshot, null, 2);
  // Hard cap: if snapshot is still >300KB, truncate with a warning (Anthropic 200K context)
  const snapshotForPrompt = snapshotJson.length > 300_000
    ? snapshotJson.slice(0, 300_000) + "\n... [TRUNCATED — snapshot too large]"
    : snapshotJson;
  const userMessage = `You are receiving the daily market data snapshot for ${runDate}. Analyze it and return ONLY a valid JSON object matching the obadiah-output@1.0 schema exactly. Do not include any text before or after the JSON object.\n\nMARKET DATA SNAPSHOT:\n${snapshotForPrompt}`;

  let obadiahOutput: ObadiahOutput | null = null;
  let obadiahPath: string;

  const anthropicHeaders = {
    "Content-Type": "application/json",
    "x-api-key": ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "prompt-caching-2024-07-31",
  };

  if (OBADIAH_AGENT_ID) {
    // Managed Agents API path
    obadiahPath = `Managed Agents API (agent_id=${OBADIAH_AGENT_ID})`;
    console.log(`[OBADIAH] Using Managed Agents API — agent_id: ${OBADIAH_AGENT_ID}`);
    try {
      const sessionRes = await fetch(
        "https://api.anthropic.com/v1/agents/sessions",
        {
          method: "POST",
          headers: anthropicHeaders,
          body: JSON.stringify({
            agent_id: OBADIAH_AGENT_ID,
            initial_message: userMessage,
            max_tokens: 8000,
          }),
        },
      );
      const sessionBody = await sessionRes.json();
      if (!sessionRes.ok) {
        throw new Error(`Managed Agents session create failed: ${sessionRes.status} ${JSON.stringify(sessionBody)}`);
      }
      // Extract content from session response
      const content = sessionBody?.output?.content?.[0]?.text ??
        sessionBody?.messages?.[sessionBody.messages?.length - 1]?.content?.[0]?.text ??
        null;
      if (content) {
        obadiahOutput = parseObadiahResponse(content, runDate, freshness);
      } else {
        throw new Error(`No content in Managed Agents response: ${JSON.stringify(sessionBody).slice(0, 300)}`);
      }
    } catch (e) {
      console.log(`[OBADIAH] Managed Agents failed: ${e} — falling back to Messages API`);
      obadiahPath += " → fallback to Messages API";
      OBADIAH_AGENT_ID = null; // triggers fallback below
    }
  }

  if (!OBADIAH_AGENT_ID) {
    // Messages API fallback — read system prompt from file if available
    obadiahPath = obadiahPath?.includes("fallback") ? obadiahPath : "Messages API (fallback — no OBADIAH_AGENT_ID)";
    console.log(`[OBADIAH] Using Messages API fallback`);

    let systemPrompt: string;
    try {
      const systemPromptPath = process.env.CRG_SYSTEM_PROMPT_PATH ||
        "/Users/marcpapineau/.openclaw/workspace/crg-command-center/agents/obadiah/system-prompt.md";
      if (!existsSync(systemPromptPath)) throw new Error("system-prompt.md not found");
      systemPrompt = readFileSync(systemPromptPath, "utf8");
    } catch {
      // Embedded fallback system prompt if file not yet created by Builder 1
      systemPrompt = `You are OBADIAH the Prophet — CRG's internal crypto market intelligence agent for Marc Papineau.

By the Wisdom of Proverbs 24:3-4: By wisdom a house is built, and through understanding it is established; through knowledge its rooms are filled.

Your task is to analyze the daily market data snapshot provided and return a comprehensive intelligence brief in JSON format.

ANTI-DRIFT RULES (7):
1. RETURN ONLY valid JSON — no markdown, no preamble, no explanation outside the JSON.
2. Match the obadiah-output@1.0 schema exactly — every required field must be present.
3. Tag every non-trivial claim with knowledge tier (T1=canonical data, T2=practitioner inference, T3=edge case, T4=synthesis).
4. Apply conviction scoring per the weighted factor model (on-chain 35%, technical 20%, sentiment 15%, fundamentals 15%, macro 10%, catalysts 5%).
5. Cap conviction at 3 if any data source is >48h stale, or if regime=chop.
6. Never invent data not present in the snapshot — flag missing data in commentary.
7. EVIDENCE-OR-INCOMPLETE — all claims must be traceable to snapshot fields.

OUTPUT SCHEMA (obadiah-output@1.0):
{
  "schema": "obadiah-output@1.0",
  "generated_at": "<ISO timestamp>",
  "market_regime": "bull|chop|bear",
  "regime_confidence": 0.0-1.0,
  "regime_commentary": "2-3 sentence plain-English read",
  "fear_greed": { "value": 0-100, "classification": "extreme_fear|fear|neutral|greed|extreme_greed", "trend_24h": "rising|stable|falling" },
  "top_assets": [{ "symbol": "", "name": "", "price_usd": 0, "change_24h_pct": 0, "change_7d_pct": 0, "volume_24h_usd": 0, "market_cap_usd": 0, "ohlcv_7d": [] }],
  "recommendations": [{ "asset": "", "direction": "long|short|neutral", "time_horizon": "1w|1m|1q", "conviction": 1-5, "factor_scores": { "onchain": 0, "technical": 0, "sentiment": 0, "fundamentals": 0, "macro": 0, "catalysts": 0 }, "weighted_score": 0.0, "catalyst": "", "why_now": "", "invalidation": "", "sources": [] }],
  "news": [{ "headline": "", "source": "", "url": "", "published_at": "", "impact": "high|medium|low", "affected_assets": [], "summary": "" }],
  "events": [{ "name": "", "date": "", "category": "regulatory|macro|protocol|unlock|etf", "impact": "high|medium|low", "description": "", "affected_assets": [] }],
  "data_freshness": {}
}`;
    }

    const messagesPayload = {
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" }, // prompt caching
        },
      ],
      messages: [
        { role: "user", content: userMessage },
      ],
    };

    let content: string | null = null;
    let parseOk = false;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const msgRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: anthropicHeaders,
          body: JSON.stringify(attempt === 1
            ? messagesPayload
            : {
              ...messagesPayload,
              messages: [
                { role: "user", content: userMessage },
                { role: "assistant", content: content ?? "" },
                {
                  role: "user",
                  content:
                    "Your previous response was invalid JSON or missing required fields. Return ONLY a valid JSON object matching the obadiah-output@1.0 schema exactly. No text before or after the JSON.",
                },
              ],
            }),
        });
        const msgBody = await msgRes.json();
        if (!msgRes.ok) {
          throw new Error(`Messages API error: ${msgRes.status} ${JSON.stringify(msgBody).slice(0, 200)}`);
        }
        content = msgBody?.content?.[0]?.text ?? null;
        if (!content) throw new Error("Empty content in Messages API response");

        obadiahOutput = parseObadiahResponse(content, runDate, freshness);
        parseOk = true;
        console.log(`[OBADIAH] Messages API attempt ${attempt} — JSON parsed OK`);
        break;
      } catch (e) {
        console.log(`[OBADIAH] Messages API attempt ${attempt} failed: ${e}`);
        if (attempt === 2) {
          return {
            ok: false,
            date: runDate,
            obadiah_path: obadiahPath,
            json_written: false,
            history_written: false,
            git_committed: false,
            telegram_sent: false,
            dry_run,
            error: `OBADIAH call failed after 2 attempts: ${e}`,
          };
        }
      }
    }

    if (!parseOk || !obadiahOutput) {
      return {
        ok: false,
        date: runDate,
        obadiah_path: obadiahPath,
        json_written: false,
        history_written: false,
        git_committed: false,
        telegram_sent: false,
        dry_run,
        error: "OBADIAH output parse failed after retry",
      };
    }
  }

  console.log(`[OBADIAH] Output schema: ${obadiahOutput!.schema}, regime: ${obadiahOutput!.market_regime}, confidence: ${obadiahOutput!.regime_confidence}`);

  // -------------------------------------------------------------------------
  // PRODUCTION GATE CHECK — independent of --dry-run (belt + suspenders)
  //
  //    When OBADIAH_PRODUCTION_ENABLED !== "true", we skip ALL side effects:
  //    - No fetch to api.telegram.org (zero Telegram sends)
  //    - No GitHub commit API calls (no crypto-latest.json / crypto-history.json writes)
  //    We log a preview so the orchestrator can verify the brief looks correct
  //    before flipping the flag.
  // -------------------------------------------------------------------------
  if (!PRODUCTION_ENABLED) {
    const briefPreview = JSON.stringify(obadiahOutput).slice(0, 200);
    const skippedFiles = ["data/crypto-latest.json", "data/crypto-history.json"];
    const dryRunLog = [
      `[OBADIAH] PRODUCTION DISABLED — would have sent: ${briefPreview}`,
      `[OBADIAH] PRODUCTION DISABLED — would have committed: ${skippedFiles.join(", ")}`,
      `[OBADIAH] PRODUCTION DISABLED — Telegram send: SKIPPED (not calling api.telegram.org)`,
      `[OBADIAH] Set Windmill variable u/admin/OBADIAH_PRODUCTION_ENABLED = "true" to enable live mode`,
    ];
    for (const line of dryRunLog) {
      console.log(line);
    }
    return {
      ok: true,
      mode: "production_disabled",
      date: runDate,
      obadiah_path: obadiahPath!,
      json_written: false,
      history_written: false,
      git_committed: false,
      telegram_sent: false,
      dry_run,
      production_enabled: false,
      dry_run_log: dryRunLog,
      telegram_brief_preview: briefPreview,
    };
  }

  // -------------------------------------------------------------------------
  // 7. Write outputs via GitHub API (Windmill worker is a Docker container;
  //    no access to host filesystem. GitHub API writes directly to the repo,
  //    triggering Netlify auto-deploy. This is the canonical V1 approach.)
  // -------------------------------------------------------------------------
  let jsonWritten = false;
  let historyWritten = false;
  let gitCommitted = false;

  const GITHUB_TOKEN = await wmill.getVariable("u/admin/GITHUB_TOKEN").catch(() => null);
  const GITHUB_OWNER = "MarcPapineau";
  const GITHUB_REPO = "cornerstone-apps";
  const GITHUB_BRANCH = "main";
  const GITHUB_HEADERS = {
    "Authorization": `Bearer ${GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Helper: get current file SHA (needed for updates)
  async function getFileSHA(path: string): Promise<string | null> {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`,
      { headers: GITHUB_HEADERS },
    );
    if (!res.ok) return null;
    const d = await res.json() as { sha?: string };
    return d.sha ?? null;
  }

  // Helper: write file to GitHub
  async function writeFileToGitHub(
    path: string,
    content: string,
    commitMessage: string,
  ): Promise<boolean> {
    const sha = await getFileSHA(path);
    const encoded = Buffer.from(content, "utf8").toString("base64");
    const body: Record<string, unknown> = {
      message: commitMessage,
      content: encoded,
      branch: GITHUB_BRANCH,
    };
    if (sha) body.sha = sha;

    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
      {
        method: "PUT",
        headers: GITHUB_HEADERS,
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.log(`[GITHUB] Write failed for ${path}: ${res.status} ${JSON.stringify(err).slice(0, 200)}`);
      return false;
    }
    const d = await res.json() as { commit?: { sha?: string } };
    console.log(`[GITHUB] Wrote ${path} — commit: ${d.commit?.sha?.slice(0, 8)}`);
    return true;
  }

  if (dry_run || !GITHUB_TOKEN) {
    if (dry_run) {
      console.log(`[GITHUB] dry_run=true — skipping GitHub file writes`);
    } else {
      console.log(`[GITHUB] No GITHUB_TOKEN — skipping file writes`);
    }
  } else {
    // Write crypto-latest.json
    const latestContent = JSON.stringify(obadiahOutput, null, 2);
    jsonWritten = await writeFileToGitHub(
      "data/crypto-latest.json",
      latestContent,
      `data: OBADIAH brief ${runDate}\n\nCo-Authored-By: OBADIAH-V1 <obadiah@crg-internal>`,
    );

    // Read + update crypto-history.json (rolling 90 entries)
    try {
      const historyPath = "data/crypto-history.json";
      const historySHA = await getFileSHA(historyPath);

      let history: ObadiahOutput[] = [];
      if (historySHA) {
        const histRes = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${historyPath}?ref=${GITHUB_BRANCH}`,
          { headers: GITHUB_HEADERS },
        );
        if (histRes.ok) {
          const histData = await histRes.json() as { content?: string };
          if (histData.content) {
            const decoded = Buffer.from(histData.content.replace(/\n/g, ""), "base64").toString("utf8");
            history = JSON.parse(decoded) as ObadiahOutput[];
            if (!Array.isArray(history)) history = [];
          }
        }
      }

      history.unshift(obadiahOutput!);
      history = history.slice(0, 90);

      historyWritten = await writeFileToGitHub(
        historyPath,
        JSON.stringify(history, null, 2),
        `data: OBADIAH history update ${runDate}`,
      );
      console.log(`[GITHUB] History: ${history.length} entries`);
    } catch (e) {
      console.log(`[GITHUB] History write error: ${e}`);
    }

    gitCommitted = jsonWritten;
  }

  // -------------------------------------------------------------------------
  // 9. Generate Telegram brief via second OBADIAH call
  // -------------------------------------------------------------------------
  const telegramPrompt = `Format the following OBADIAH daily brief JSON as a Telegram message using the exact template format below. Use Markdown formatting (Telegram MarkdownV1). Return ONLY the message text, no JSON, no preamble.

TEMPLATE:
*OBADIAH the Prophet — Daily Brief*
${runDate} · HH:MM ET

REGIME: <market_regime uppercase> · F&G: <fear_greed.value> (<fear_greed.classification>, <trend arrow ↑/→/↓>) · BTC dom <btc_dominance_pct if available>%

> <regime_commentary — 1-2 sentences>

TOP CONVICTIONS
<numbered list of top 3-5 recommendations: N. <asset> <direction arrow ▲/▼/→> <direction> <time_horizon> · ★<conviction stars> · <catalyst short>>

NEWS (impact-tagged)
<bullet list: • [HIGH/MED/LOW] <headline short> — <source>>

NEXT CATALYSTS
<emoji ⏰ list: ⏰ <event name> — <date> (<days away>d)>

[View full dashboard →](https://crg-command.netlify.app/crypto.html)

DATA:
${JSON.stringify(obadiahOutput, null, 2)}`;

  let telegramBriefText = "";
  try {
    const briefHeaders = {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    };
    const briefRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: briefHeaders,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [{ role: "user", content: telegramPrompt }],
      }),
    });
    const briefBody = await briefRes.json();
    if (briefRes.ok) {
      telegramBriefText = briefBody?.content?.[0]?.text ?? "";
      console.log(`[TELEGRAM] Brief generated — ${telegramBriefText.length} chars`);
    } else {
      console.log(`[TELEGRAM] Brief generation failed: ${briefRes.status} ${JSON.stringify(briefBody).slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`[TELEGRAM] Brief generation exception: ${e}`);
  }

  // -------------------------------------------------------------------------
  // 10. Send Telegram message (skip in dry_run or if no chat ID)
  // -------------------------------------------------------------------------
  let telegramSent = false;

  if (dry_run) {
    console.log(`[TELEGRAM] dry_run=true — logging brief only:`);
    console.log(`\n${"=".repeat(60)}\n${telegramBriefText}\n${"=".repeat(60)}\n`);
  } else if (!TELEGRAM_CHAT_ID) {
    console.log(`[TELEGRAM] No chat ID — logging brief:`);
    console.log(`\n${"=".repeat(60)}\n${telegramBriefText}\n${"=".repeat(60)}\n`);
  } else if (telegramBriefText) {
    try {
      const tgRes = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: telegramBriefText,
            parse_mode: "Markdown",
            disable_web_page_preview: true,
          }),
        },
      );
      const tgBody = await tgRes.json();
      if (tgRes.ok) {
        telegramSent = true;
        console.log(`[TELEGRAM] Sent — message_id: ${tgBody?.result?.message_id}`);
      } else {
        console.log(`[TELEGRAM] Send failed: ${tgRes.status} ${JSON.stringify(tgBody).slice(0, 200)}`);
        // Retry with plain text if Markdown parsing failed
        if (tgRes.status === 400 && JSON.stringify(tgBody).includes("parse")) {
          const retryRes = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: telegramBriefText,
                disable_web_page_preview: true,
              }),
            },
          );
          if (retryRes.ok) {
            telegramSent = true;
            console.log(`[TELEGRAM] Sent (plain text fallback)`);
          }
        }
      }
    } catch (e) {
      console.log(`[TELEGRAM] Send exception: ${e}`);
    }
  }

  // -------------------------------------------------------------------------
  // 11. Final result
  // -------------------------------------------------------------------------
  const result: MainResult = {
    ok: true,
    mode: "live",
    date: runDate,
    obadiah_path: obadiahPath,
    json_written: jsonWritten,
    history_written: historyWritten,
    git_committed: gitCommitted,
    telegram_sent: telegramSent,
    dry_run,
    production_enabled: true,
    telegram_brief_preview: telegramBriefText.slice(0, 500),
  };

  console.log(`[OBADIAH] Complete — ${JSON.stringify(result)}`);
  return result;
}

// ---------------------------------------------------------------------------
// Parse OBADIAH response — extract JSON from text, validate required fields
// ---------------------------------------------------------------------------
function parseObadiahResponse(text: string, runDate: string, freshness: DataFreshness): ObadiahOutput {
  // Strip markdown code fences if present
  let clean = text.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }

  // Find first { and last } to extract JSON
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`No JSON object found in response. Preview: ${clean.slice(0, 200)}`);
  }

  const jsonStr = clean.slice(start, end + 1);
  let parsed: ObadiahOutput;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`JSON.parse failed: ${e}. Preview: ${jsonStr.slice(0, 300)}`);
  }

  // Validate required fields per spec Section 5
  const required = ["schema", "generated_at", "market_regime", "regime_confidence", "regime_commentary", "fear_greed", "top_assets", "recommendations", "news", "events"];
  const missing = required.filter((f) => !(f in parsed));
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }

  // Ensure data_freshness is populated
  if (!parsed.data_freshness) parsed.data_freshness = freshness;

  // Ensure generated_at is set
  if (!parsed.generated_at) parsed.generated_at = new Date().toISOString();

  return parsed;
}
