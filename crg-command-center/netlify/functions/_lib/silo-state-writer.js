/**
 * silo-state-writer.js — helper to recompute silo-state.json fields at runtime.
 *
 * The committed silo-state.json holds the canonical 3-silo definition (display
 * names, agent roster, app URLs, doctrine pointers). Some fields, however,
 * become stale quickly:
 *   - objectives_met → derived from merged PRs in the last N days
 *   - objectives_pending → derived from open PRs / TODO comments / WIP labels
 *   - last_run timestamps (handled at endpoint time via Langfuse)
 *
 * For the liveness sprint we keep the file static and do enrichment in the
 * endpoints. This helper exists as the SEAM — when we want to add a daily
 * job that rewrites silo-state.json into Netlify Blobs, this is the entry
 * point.
 *
 * Right now it just exposes:
 *   - recomputeRoutineCounts(state) — counts scheduled vs on-demand agents
 *     per silo so the dashboard can render numeric badges without scanning
 *     the agent list client-side.
 *
 * Future hooks: PR-derived objectives, Langfuse-derived freshness,
 * Anthropic Managed Agents version drift.
 */

function recomputeRoutineCounts(state) {
  const out = { ...state };
  const agents = Array.isArray(state.agents) ? state.agents : [];
  const silos = Array.isArray(state.silos) ? state.silos : [];

  out.silos = silos.map((silo) => {
    const ours = agents.filter((a) => a.silo === silo.id);
    return {
      ...silo,
      agent_counts: {
        total: ours.length,
        scheduled: ours.filter((a) => a.schedule).length,
        on_demand: ours.filter((a) => !a.schedule).length,
        managed: ours.filter((a) => a.managed_agent_pr).length,
      },
    };
  });

  return out;
}

module.exports = { recomputeRoutineCounts };
