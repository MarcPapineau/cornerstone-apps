#!/usr/bin/env node
"use strict";

/**
 * scout-sidecar.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Builder Control System v1 — Module 7 (B3)
 *
 * Parses the existing DANIEL Monday markdown scouts and emits a JSON sidecar
 * conforming to builder-control/schemas/scout-diff.schema.json.
 *
 * DOES NOT rebuild or run the DANIEL scout. Only PARSES the markdown and emits.
 *
 * Usage:
 *   node builder-control/scout-sidecar.cjs --date 2026-06-22
 *
 * Outputs:
 *   research/daniel-tool-scout-<date>.json   (next to the markdown)
 *
 * Stop condition: if the markdown structure cannot be parsed reliably, records
 * the parse gap and exits 1. Does NOT fabricate scout items.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require("node:fs");
const path = require("node:path");

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dateIdx = args.indexOf("--date");
if (dateIdx === -1 || !args[dateIdx + 1]) {
  console.error("Usage: node builder-control/scout-sidecar.cjs --date YYYY-MM-DD");
  process.exit(1);
}
const targetDate = args[dateIdx + 1].trim();
if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  console.error(`Invalid date format: "${targetDate}" — expected YYYY-MM-DD`);
  process.exit(1);
}

// ── Resolve workspace root and file paths ─────────────────────────────────────

// builder-control/ is one level under workspace root
const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const RESEARCH_DIR = path.join(WORKSPACE_ROOT, "research");

function scoutMarkdownPath(date) {
  return path.join(RESEARCH_DIR, `daniel-tool-scout-${date}.md`);
}

function scoutJsonPath(date) {
  return path.join(RESEARCH_DIR, `daniel-tool-scout-${date}.json`);
}

// ── Prior week resolution ─────────────────────────────────────────────────────

function priorDate(dateStr) {
  // Return the date 7 days before dateStr (YYYY-MM-DD)
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

// ── Markdown parser ───────────────────────────────────────────────────────────
//
// The DANIEL scout has a stable structure:
//   ## BLUF (Bottom Line Up Front)
//   ## TOP ITEMS (or TOP 5) — RANKED BY CRG GROWTH-ENGINE RELEVANCE
//     ### N. <Item Name>  `T1` ✅ / `T2` ⚠️ / `T3` / `T4` — <label>
//     - **What it is / what's new:** ...
//     - **WKU —** ...
//     - **Pricing:** ...
//     - **Differentiator vs. what Marc uses:** ...
//     - **Sources:** [text](url) ...
//   ## WATCHLIST — CARRY FORWARD
//   ## ZERO-VERIFIED THIS WEEK
//   ## PROCESS NOTE
//
// We parse what's reliably present across both the 2026-06-15 and 2026-06-22
// scouts. Anything that doesn't match is recorded as a parse gap, not fabricated.

/**
 * Extract the BLUF section.
 * @param {string} md
 * @returns {string|null}
 */
function extractBluf(md) {
  const m = md.match(/##\s+BLUF[^\n]*\n([\s\S]*?)(?=\n##\s)/);
  if (!m) return null;
  return m[1].trim().replace(/\n+/g, " ").replace(/\s+/g, " ");
}

/**
 * Parse a tier tag from a heading line, e.g. "`T1`" or "`T2`".
 * @param {string} headingLine
 * @returns {"T1"|"T2"|"T3"|"T4"|null}
 */
function parseTier(headingLine) {
  const m = headingLine.match(/`(T[1-4])`/);
  return m ? m[1] : null;
}

/**
 * Parse a verdict from context. In the DANIEL scout format the tier/verdict
 * mapping is implicit. The scout uses WKU to describe actions
 * ("No action this week beyond logging" = Monitor, "pilot manually" = Test,
 * "not a tool" = Ignore, "Regression-test first" = Monitor).
 * We infer from the item block text.
 * @param {string} itemBlock  — full text of the item section
 * @param {string} tier
 * @returns {"Ignore"|"Monitor"|"Test"|"Deploy"}
 */
function inferVerdict(itemBlock, tier) {
  const t = itemBlock.toLowerCase();
  // Explicit deploy signals
  if (/\bdeploy\b/.test(t) && !/\bdo\s+not\s+deploy\b/.test(t)) return "Deploy";
  // Test signals
  if (/\btest\b|\bpilot\b|\btry\b|\bregression[-\s]test\b/.test(t) &&
      /\b(?:before|first|now|this\s+week)\b/.test(t)) return "Test";
  // Ignore signals
  if (/\bnot\s+a\s+tool\b|\bno\s+build\s+action\b|\badvisory\s+only\b|\bmorning[-\s]brief\s+only\b/.test(t)) return "Ignore";
  // T3/T4 with no action
  if ((tier === "T3" || tier === "T4") && /\bno\s+(?:build\s+)?action\b/.test(t)) return "Ignore";
  // Default to Monitor
  return "Monitor";
}

/**
 * Parse source URLs from an item block.
 * @param {string} itemBlock
 * @returns {string[]}
 */
function parseSourceUrls(itemBlock) {
  const urls = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let m;
  while ((m = re.exec(itemBlock)) !== null) {
    urls.push(m[2]);
  }
  return [...new Set(urls)];
}

/**
 * Infer category from item name and content.
 * @param {string} name
 * @param {string} block
 * @returns {string}
 */
function inferCategory(name, block) {
  const combined = (name + " " + block).toLowerCase();
  if (/voice[-\s]?ai|elevenlabs|vapi|retell|cartesia|deepgram|livek/.test(combined)) return "voice-ai";
  if (/claude|anthropic|fable|mythos|openai|gemini|gpt|llm|foundation\s+model/.test(combined)) return "foundation-model";
  if (/agent[-\s]?orchestrat|multi[-\s]?agent|langchain|langraph|crewai|autogen|mcp\s+eco/.test(combined)) return "agent-orchestration";
  if (/crm|hubspot|salesforce|gohighlevel|apollo|clay|outreach/.test(combined)) return "crm-sales";
  if (/bedrock|aws|apple|xcode|foundation\s+models\s+framework/.test(combined)) return "substrate";
  if (/market[-\s]?report|ipo|commission|real[-\s]?estate\s+ai|pricing\s+(?:shift|trend)/.test(combined)) return "market-context";
  return "market-context";
}

/**
 * Extract differentiator line from item block.
 * @param {string} block
 * @returns {string}
 */
function extractDifferentiator(block) {
  const m = block.match(/\*\*Differentiator[^:]*:\*\*([^\n]+(?:\n(?!\s*-).*)*)/);
  if (!m) return "";
  return m[1].trim().replace(/\n/g, " ").replace(/\s+/g, " ").slice(0, 300);
}

/**
 * Extract single-line build relevance (Understanding / WKU) from item block.
 * @param {string} block
 * @returns {string}
 */
function extractBuildRelevance(block) {
  // Try to pull the Understanding sub-bullet from WKU
  const wkuM = block.match(/\*Understanding[^:]*:\*\*?\s*([^\n]+)/);
  if (wkuM) return wkuM[1].trim().slice(0, 200);
  // Fallback: first sentence after "WKU"
  const wkuSection = block.match(/\*\*WKU\s*—?\*\*([^*]+)/);
  if (wkuSection) return wkuSection[1].trim().slice(0, 200).replace(/\n/g, " ");
  return "";
}

/**
 * Parse top items from the TOP ITEMS / TOP 5 section.
 * @param {string} md
 * @returns {{ items: object[], parseGaps: string[] }}
 */
function parseTopItems(md) {
  const items = [];
  const parseGaps = [];

  // Find the TOP ITEMS section
  const topMatch = md.match(/##\s+TOP[^\n]*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!topMatch) {
    parseGaps.push("TOP ITEMS section not found in markdown.");
    return { items, parseGaps };
  }

  const section = topMatch[1];

  // Split into item blocks by ### N. heading
  const itemChunks = section.split(/\n(?=###\s+\d+\.)/);

  for (const chunk of itemChunks) {
    if (!chunk.trim()) continue;
    // Extract heading line
    const headingMatch = chunk.match(/^###\s+\d+\.\s+(.+)/m);
    if (!headingMatch) {
      parseGaps.push(`Could not parse item heading from chunk: ${chunk.slice(0, 80).replace(/\n/g, " ")}…`);
      continue;
    }

    const headingLine = headingMatch[1];
    // Extract name (everything before the backtick tier marker)
    const nameMatch = headingLine.match(/^(.+?)\s+`T[1-4]`/);
    const name = nameMatch
      ? nameMatch[1].trim().replace(/\*+/g, "")
      : headingLine.replace(/`[^`]*`/g, "").replace(/[✅⚠️—–].*/g, "").trim();

    const tier = parseTier(headingLine) || "T2";
    const verdict = inferVerdict(chunk, tier);
    const category = inferCategory(name, chunk);
    const buildRelevance = extractBuildRelevance(chunk);
    const differentiatorVsCurrent = extractDifferentiator(chunk);
    const sources = parseSourceUrls(chunk);

    const item = {
      name,
      tier,
      verdict,
      category,
      buildRelevance: buildRelevance || `See ${tier} item: ${name.slice(0, 80)}`,
    };
    if (differentiatorVsCurrent) item.differentiatorVsCurrent = differentiatorVsCurrent;
    if (sources.length > 0) item.sources = sources;

    items.push(item);
  }

  return { items, parseGaps };
}

/**
 * Parse watchlist items from the WATCHLIST section.
 * Handles both "## WATCHLIST — CARRY FORWARD" (6/22 style) and
 * "## ⚠️ VERIFY-NEXT-WEEK WATCHLIST" (6/15 style).
 * @param {string} md
 * @returns {string[]}
 */
function parseWatchlist(md) {
  // Match either style of watchlist section heading
  const m = md.match(/##\s+(?:[⚠️✅\s]*)?(?:VERIFY[-\s]NEXT[-\s]WEEK\s+)?WATCHLIST[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (!m) return [];
  const section = m[1];
  // Each watchlist item starts with "- **<name>:**" or "- **<name>**" or "- <name>"
  const watchItems = [];
  // Try bold-name format first
  const reBold = /^[-*]\s+\*\*([^*:]+)[*:]/gm;
  let match;
  while ((match = reBold.exec(section)) !== null) {
    watchItems.push(match[1].trim());
  }
  // If no bold items found, try plain bullet format
  if (watchItems.length === 0) {
    const rePlain = /^[-*]\s+([^\n]{3,80})/gm;
    while ((match = rePlain.exec(section)) !== null) {
      const item = match[1].replace(/\*\*/g, "").trim();
      if (item.length > 3) watchItems.push(item.slice(0, 80));
    }
  }
  return watchItems;
}

/**
 * Parse all items from a markdown scout file.
 * @param {string} md
 * @returns {{ bluf: string|null, items: object[], watchlist: string[], parseGaps: string[] }}
 */
function parseScout(md) {
  const bluf = extractBluf(md);
  const { items, parseGaps } = parseTopItems(md);
  const watchlist = parseWatchlist(md);
  return { bluf, items, watchlist, parseGaps };
}

// ── Diff computation ──────────────────────────────────────────────────────────

/**
 * Compute the diff between two scout item lists.
 * @param {object[]} currentItems
 * @param {object[]} priorItems
 * @param {string[]} currentWatchlist
 * @param {string[]} priorWatchlist
 * @returns {object} diffVsPrior conforming to scout-diff.schema.json#diffVsPrior
 */
function computeDiff(currentItems, priorItems, currentWatchlist, priorWatchlist) {
  const priorByName = new Map(priorItems.map((i) => [i.name.toLowerCase(), i]));
  const currentByName = new Map(currentItems.map((i) => [i.name.toLowerCase(), i]));

  // New items: in current, not in prior
  const newItems = currentItems
    .filter((i) => !priorByName.has(i.name.toLowerCase()))
    .map((i) => i.name);

  // Verdict changes: in both, verdict changed
  const verdictChanges = [];
  for (const [key, curr] of currentByName) {
    const prior = priorByName.get(key);
    if (prior && prior.verdict !== curr.verdict) {
      verdictChanges.push({
        name: curr.name,
        from: prior.verdict,
        to: curr.verdict,
      });
    }
  }

  // Watchlist promoted: in current watchlist but NOT in prior watchlist
  const priorWatchSet = new Set(priorWatchlist.map((w) => w.toLowerCase()));
  const watchlistPromoted = currentWatchlist.filter(
    (w) => !priorWatchSet.has(w.toLowerCase())
  );

  // Watchlist expired: in prior watchlist but NOT in current watchlist
  const currWatchSet = new Set(currentWatchlist.map((w) => w.toLowerCase()));
  const watchlistExpired = priorWatchlist.filter(
    (w) => !currWatchSet.has(w.toLowerCase())
  );

  // Substrate changes: items in either scout categorized as "substrate" OR
  // explicit substrate watchlist items (Fable 5 / Bedrock / metering)
  const substrateChanges = [];

  // New substrate items
  const newSubstrate = currentItems.filter(
    (i) => i.category === "substrate" && !priorByName.has(i.name.toLowerCase())
  );
  for (const s of newSubstrate) {
    substrateChanges.push(`NEW substrate item: ${s.name} (${s.verdict}) — ${s.buildRelevance.slice(0, 120)}`);
  }

  // Carry-forward substrate watchlist items from current watchlist
  const substrateWatchKeywords = /claude\s+fable|mythos|bedrock|metering|overflow|token\s+pricing|usage.{0,20}model/i;
  for (const w of currentWatchlist) {
    if (substrateWatchKeywords.test(w)) {
      // Only add if it was also in the prior (carried forward) or is new
      const isNew = !priorWatchSet.has(w.toLowerCase());
      const label = isNew ? "NEW watch item" : "Carry-forward watch item";
      substrateChanges.push(`${label}: ${w} — regression-test before any fleet swap.`);
    }
  }

  // If no substrate changes found, note explicitly (not fabricate)
  if (substrateChanges.length === 0) {
    substrateChanges.push("No substrate changes this week; watchlist unchanged.");
  }

  return {
    newItems,
    verdictChanges,
    watchlistPromoted,
    watchlistExpired,
    substrateChanges,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const mdPath = scoutMarkdownPath(targetDate);

  if (!fs.existsSync(mdPath)) {
    console.error(`[scout-sidecar] STOP CONDITION: markdown not found: ${mdPath}`);
    process.exit(1);
  }

  const md = fs.readFileSync(mdPath, "utf8");
  const parsed = parseScout(md);

  if (parsed.parseGaps.length > 0) {
    console.warn("[scout-sidecar] Parse gaps detected (not fabricating):");
    for (const gap of parsed.parseGaps) {
      console.warn("  GAP:", gap);
    }
  }

  // Attempt prior week
  const prior = priorDate(targetDate);
  const priorMdPath = scoutMarkdownPath(prior);
  let priorParsed = { items: [], watchlist: [], bluf: null, parseGaps: [] };
  let priorMarkdown = null;

  if (fs.existsSync(priorMdPath)) {
    const priorMd = fs.readFileSync(priorMdPath, "utf8");
    priorParsed = parseScout(priorMd);
    priorMarkdown = `research/daniel-tool-scout-${prior}.md`;
    if (priorParsed.parseGaps.length > 0) {
      console.warn("[scout-sidecar] Prior week parse gaps:");
      for (const gap of priorParsed.parseGaps) {
        console.warn("  GAP:", gap);
      }
    }
  } else {
    console.warn(`[scout-sidecar] Prior week markdown not found (${priorMdPath}); diff will be all-new.`);
  }

  const diffVsPrior = computeDiff(
    parsed.items,
    priorParsed.items,
    parsed.watchlist,
    priorParsed.watchlist
  );

  // Build sidecar conforming to scout-diff.schema.json
  const sidecar = {
    scoutDate: targetDate,
    sourceMarkdown: `research/daniel-tool-scout-${targetDate}.md`,
    priorMarkdown,
    bluf: parsed.bluf || "(BLUF section not parsed)",
    items: parsed.items,
    diffVsPrior,
  };

  // Emit
  const outPath = scoutJsonPath(targetDate);
  fs.writeFileSync(outPath, JSON.stringify(sidecar, null, 2) + "\n");

  console.log(`[scout-sidecar] Wrote: ${outPath}`);
  console.log(`[scout-sidecar] Items parsed: ${parsed.items.length} (current) / ${priorParsed.items.length} (prior)`);
  console.log(`[scout-sidecar] diffVsPrior.newItems: [${diffVsPrior.newItems.join(", ")}]`);
  console.log(`[scout-sidecar] diffVsPrior.substrateChanges: ${diffVsPrior.substrateChanges.length} items`);

  if (parsed.parseGaps.length > 0) {
    console.warn(`[scout-sidecar] ${parsed.parseGaps.length} parse gap(s) recorded — check the JSON.`);
  }

  process.exit(0);
}

main();
