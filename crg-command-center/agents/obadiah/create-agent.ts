/**
 * OBADIAH the Prophet — Agent Creation Script
 *
 * ONE-TIME SETUP — run once, save the agent_id to Doppler.
 * Do NOT run this in the Windmill hot path. Sessions reference the stored agent ID.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=$(doppler secrets get ANTHROPIC_API_KEY -p crg-site -c prd --plain)
 *   npx ts-node agents/obadiah/create-agent.ts
 *
 * On success, saves OBADIAH_AGENT_ID to Doppler (crg-site / prd).
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const AGENT_NAME = "OBADIAH the Prophet";
const MODEL = "claude-sonnet-4-6";
const SYSTEM_PROMPT_PATH = path.join(__dirname, "system-prompt.md");

async function createObadiahAgent(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not set. Run: export ANTHROPIC_API_KEY=$(doppler secrets get ANTHROPIC_API_KEY -p crg-site -c prd --plain)"
    );
  }

  const client = new Anthropic({ apiKey });

  // Read the canonical system prompt
  if (!fs.existsSync(SYSTEM_PROMPT_PATH)) {
    throw new Error(`System prompt not found at: ${SYSTEM_PROMPT_PATH}`);
  }
  const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, "utf-8");

  console.log(`Creating agent: ${AGENT_NAME}`);
  console.log(`Model: ${MODEL}`);
  console.log(`System prompt length: ${systemPrompt.length} chars`);

  // Attempt Managed Agents API first
  let agentId: string;
  let path_used: "managed_agents" | "messages_api_fallback";

  try {
    // Try Managed Agents beta
    const agent = await (client.beta as any).agents.create({
      name: AGENT_NAME,
      model: MODEL,
      description:
        "Daily crypto market intelligence synthesizer. Receives pre-fetched data snapshots from Windmill and returns structured JSON briefs for Marc Papineau / CRG internal use.",
      system: systemPrompt,
      // V1: pure reasoning — no tools. V2 will add interactive tool use.
      tools: [],
      metadata: {
        owner: "marc@cornerstoneregroup.ca",
        silo: "cross-cutting",
        doctrine: "doctrine_crg_internal_focus",
        version: "v1.0.0",
        runtime_host: "windmill",
      },
    });

    agentId = agent.id;
    path_used = "managed_agents";

    console.log(`\n✓ Managed Agents agent created`);
    console.log(`  agent_id: ${agentId}`);
    console.log(`  version:  ${agent.version}`);
    console.log(`  model:    ${agent.model}`);
  } catch (err: any) {
    // Fallback: Managed Agents not accessible on this account
    const errMsg = err?.message ?? String(err);
    console.warn(
      `\nManaged Agents API not accessible: ${errMsg}`
    );
    console.log(
      "Falling back to Messages API pattern (V1 functional, no persistent agent_id)."
    );

    // Generate a synthetic ID to mark the fallback state in Doppler
    agentId = `FALLBACK_MESSAGES_API_${Date.now()}`;
    path_used = "messages_api_fallback";

    console.log(`  fallback_id: ${agentId}`);
    console.log(
      "  See agents/obadiah/README.md → Fallback Path for how to use OBADIAH without Managed Agents."
    );
  }

  // Save agent_id to Doppler
  try {
    console.log(`\nSaving OBADIAH_AGENT_ID to Doppler (crg-site / prd)...`);
    execSync(
      `doppler secrets set OBADIAH_AGENT_ID="${agentId}" -p crg-site -c prd --silent --no-interactive`,
      { stdio: "pipe" }
    );
    console.log(`✓ OBADIAH_AGENT_ID saved to Doppler`);
  } catch (dopplerErr: any) {
    console.error(
      `Failed to save to Doppler: ${dopplerErr?.message}. Set manually:`
    );
    console.error(
      `  doppler secrets set OBADIAH_AGENT_ID="${agentId}" -p crg-site -c prd`
    );
  }

  // Print summary
  console.log("\n=== OBADIAH Agent Creation Summary ===");
  console.log(`Path used:    ${path_used}`);
  console.log(`Agent ID:     ${agentId}`);
  console.log(`Model:        ${MODEL}`);
  console.log(
    `Next step:    Run 'npx ts-node agents/obadiah/test-fire.ts' to validate`
  );

  if (path_used === "messages_api_fallback") {
    console.log(
      "\nFALLBACK NOTE: Windmill orchestrator should use Messages API pattern."
    );
    console.log(
      "See agents/obadiah/README.md → Fallback Path for implementation details."
    );
  }
}

// Entry point
createObadiahAgent().catch((err) => {
  console.error("Agent creation failed:", err);
  process.exit(1);
});
