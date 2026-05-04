/**
 * OBADIAH the Prophet — Test Fire
 *
 * Validates the agent (or Messages API fallback) with a mock snapshot.
 * Checks that output JSON parses and contains all required schema fields.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=$(doppler secrets get ANTHROPIC_API_KEY -p crg-site -c prd --plain)
 *   export OBADIAH_AGENT_ID=$(doppler secrets get OBADIAH_AGENT_ID -p crg-site -c prd --plain)
 *   npx ts-node agents/obadiah/test-fire.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";

const SYSTEM_PROMPT_PATH = path.join(__dirname, "system-prompt.md");

// ─── Mock snapshot (3 assets, realistic but fake numbers) ────────────────────
const MOCK_SNAPSHOT = {
  snapshot_ts: new Date().toISOString(),
  coindesk: {
    ohlcv: {
      BTC: [
        [1746316800, 94200, 97500, 93800, 97420, 38000000000],
        [1746403200, 97420, 99100, 96800, 98750, 41000000000],
        [1746489600, 98750, 101200, 97900, 100340, 44000000000],
        [1746576000, 100340, 102500, 99200, 101800, 43000000000],
        [1746662400, 101800, 103400, 100500, 102900, 42000000000],
        [1746748800, 102900, 104100, 101800, 103600, 39000000000],
        [1746835200, 103600, 105000, 102400, 104200, 40000000000],
      ],
      ETH: [
        [1746316800, 2180, 2310, 2160, 2290, 18000000000],
        [1746403200, 2290, 2380, 2270, 2350, 20000000000],
        [1746489600, 2350, 2450, 2330, 2410, 22000000000],
        [1746576000, 2410, 2490, 2390, 2460, 21000000000],
        [1746662400, 2460, 2520, 2440, 2500, 19000000000],
        [1746748800, 2500, 2560, 2480, 2540, 20000000000],
        [1746835200, 2540, 2610, 2520, 2580, 21000000000],
      ],
      SOL: [
        [1746316800, 148, 162, 146, 159, 4200000000],
        [1746403200, 159, 168, 156, 165, 4800000000],
        [1746489600, 165, 174, 162, 171, 5100000000],
        [1746576000, 171, 178, 168, 175, 4900000000],
        [1746662400, 175, 182, 172, 179, 5000000000],
        [1746748800, 179, 186, 176, 183, 4800000000],
        [1746835200, 183, 190, 180, 187, 5200000000],
      ],
    },
    news: [
      {
        headline: "BlackRock IBIT Records $850M Single-Day Bitcoin Inflow",
        url: "https://www.coindesk.com/markets/2026/05/04/blackrock-ibit",
        published_at: new Date(Date.now() - 3600000).toISOString(),
        source: "CoinDesk",
      },
      {
        headline:
          "Ethereum Pectra Upgrade Live — Staking Yields Rise to 4.8%",
        url: "https://www.coindesk.com/tech/2026/05/04/pectra-live",
        published_at: new Date(Date.now() - 7200000).toISOString(),
        source: "CoinDesk",
      },
      {
        headline: "Senate Advances CLARITY Act to Floor Vote Scheduled June 12",
        url: "https://www.coindesk.com/policy/2026/05/04/clarity-act-senate",
        published_at: new Date(Date.now() - 10800000).toISOString(),
        source: "CoinDesk",
      },
    ],
  },
  coin_metrics: {
    mvrv_z: { BTC: 2.1 },
    nupl: { BTC: 0.48 },
    nvt: { BTC: 62.3 },
    realized_cap_usd: { BTC: 480000000000 },
  },
  coinglass: {
    funding_rates: { BTC: 0.0003, ETH: 0.0001, SOL: 0.0002 },
    open_interest: { BTC: 18500000000, ETH: 9200000000, SOL: 1800000000 },
  },
  defillama: {
    tvl_usd: 96000000000,
    fees_7d_usd: 180000000,
    protocol_pf: { AAVE: 12.4, UNI: 28.1 },
  },
  fear_greed: {
    value: 72,
    classification: "greed",
    yesterday: 68,
    last_week: 55,
  },
  macro: {
    dxy: 103.4,
    btc_dom: 54.3,
    etf_net_flow_7d_usd: 2100000000,
  },
  events: [
    {
      name: "CLARITY Act Senate Vote",
      date: "2026-06-12",
      category: "regulatory",
      impact: "high",
      description: "US market structure bill scheduled for floor vote",
      affected_assets: ["BTC", "ETH", "SOL"],
    },
    {
      name: "ARB Token Unlock — 92M tokens",
      date: "2026-05-08",
      category: "unlock",
      impact: "medium",
      description: "Arbitrum team + investor vesting cliff",
      affected_assets: ["ARB"],
    },
    {
      name: "FOMC Minutes Release",
      date: "2026-05-06",
      category: "macro",
      impact: "medium",
      description: "Federal Reserve May meeting minutes",
      affected_assets: ["BTC", "ETH"],
    },
  ],
};

// ─── Required schema fields for validation ───────────────────────────────────
const REQUIRED_FIELDS = [
  "schema",
  "generated_at",
  "market_regime",
  "regime_confidence",
  "regime_commentary",
  "fear_greed",
  "fear_greed.value",
  "fear_greed.classification",
  "fear_greed.trend_24h",
  "top_assets",
  "recommendations",
  "news",
  "events",
  "data_freshness",
];

function validateOutput(parsed: any): string[] {
  const missing: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    const parts = field.split(".");
    let obj = parsed;
    for (const part of parts) {
      if (obj === null || obj === undefined || !(part in obj)) {
        missing.push(field);
        break;
      }
      obj = obj[part];
    }
  }
  return missing;
}

async function runTestFire(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not set. Run: export ANTHROPIC_API_KEY=$(doppler secrets get ANTHROPIC_API_KEY -p crg-site -c prd --plain)"
    );
  }

  const agentId = process.env.OBADIAH_AGENT_ID;
  const isFallback =
    !agentId || agentId.startsWith("FALLBACK_MESSAGES_API_");

  const client = new Anthropic({ apiKey });
  const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, "utf-8");

  console.log("=== OBADIAH Test Fire ===");
  console.log(`Mode: ${isFallback ? "Messages API (fallback)" : "Managed Agents"}`);
  console.log(`Agent ID: ${agentId ?? "N/A"}`);
  console.log(`Snapshot assets: BTC, ETH, SOL`);
  console.log(`Snapshot TS: ${MOCK_SNAPSHOT.snapshot_ts}`);
  console.log("\nFiring agent...\n");

  const userMessage = JSON.stringify(MOCK_SNAPSHOT, null, 2);
  let rawOutput: string;

  if (isFallback || !agentId) {
    // ── Messages API fallback path ──────────────────────────────────────────
    console.log("Using Messages API (direct system prompt injection)...");

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Here is the pre-fetched market data snapshot. Analyze it and return the obadiah-output@1.0 JSON object:\n\n${userMessage}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text block in response");
    }
    rawOutput = textBlock.text;
  } else {
    // ── Managed Agents agent_id is stored but V1 invocation is still via Messages API.
    // Managed Agents interactive session (with environment_id) is V2. For V1 test-fire,
    // we load the system prompt directly and call Messages API — same inference path the
    // Windmill orchestrator uses in V1.
    console.log(`Managed Agents agent_id confirmed: ${agentId}`);
    console.log("V1 test-fire uses Messages API for inference (Managed Agents session = V2 upgrade path).");

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Here is the pre-fetched market data snapshot. Analyze it and return the obadiah-output@1.0 JSON object:\n\n${userMessage}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text block in response");
    }
    rawOutput = textBlock.text;
  }

  // ── Parse and validate output ─────────────────────────────────────────────
  console.log("Raw output (first 500 chars):");
  console.log(rawOutput.substring(0, 500));
  console.log("...\n");

  let parsed: any;

  // Strip any accidental markdown fences
  const cleaned = rawOutput
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    // Try to extract first JSON object from the text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        throw new Error(
          `Output is not valid JSON. Parse error: ${parseErr}\nRaw output:\n${rawOutput.substring(0, 800)}`
        );
      }
    } else {
      throw new Error(
        `No JSON object found in output. Raw output:\n${rawOutput.substring(0, 800)}`
      );
    }
  }

  // Validate required fields
  const missingFields = validateOutput(parsed);
  if (missingFields.length > 0) {
    console.warn(`WARNING: Missing required fields: ${missingFields.join(", ")}`);
  } else {
    console.log("✓ All required schema fields present");
  }

  // Check schema version
  if (parsed.schema !== "obadiah-output@1.0") {
    console.warn(`WARNING: Unexpected schema: ${parsed.schema}`);
  } else {
    console.log(`✓ Schema version: ${parsed.schema}`);
  }

  // Print key output fields
  console.log(`\n=== Output Summary ===`);
  console.log(`market_regime:     ${parsed.market_regime}`);
  console.log(`regime_confidence: ${parsed.regime_confidence}`);
  console.log(`fear_greed.value:  ${parsed.fear_greed?.value}`);
  console.log(`recommendations:   ${parsed.recommendations?.length ?? 0} items`);
  console.log(`news:              ${parsed.news?.length ?? 0} items`);
  console.log(`events:            ${parsed.events?.length ?? 0} items`);
  console.log(`top_assets:        ${parsed.top_assets?.length ?? 0} items`);

  if (parsed.recommendations?.length > 0) {
    const rec = parsed.recommendations[0];
    console.log(`\nTop Recommendation:`);
    console.log(`  asset:      ${rec.asset}`);
    console.log(`  direction:  ${rec.direction}`);
    console.log(`  conviction: ${rec.conviction}`);
    console.log(`  why_now:    ${rec.why_now?.substring(0, 100)}...`);
  }

  console.log(`\nregime_commentary: ${parsed.regime_commentary?.substring(0, 200)}...`);

  // Save test output for PR evidence
  const outputPath = path.join(__dirname, "test-fire-output.json");
  fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2));
  console.log(`\n✓ Full output saved to: ${outputPath}`);

  console.log("\n=== TEST FIRE COMPLETE ===");
  console.log(
    missingFields.length === 0
      ? "PASS — all schema fields present, JSON valid"
      : `PARTIAL — valid JSON but missing: ${missingFields.join(", ")}`
  );
}

// Entry point
runTestFire().catch((err) => {
  console.error("Test fire failed:", err);
  process.exit(1);
});
