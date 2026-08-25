#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CANON = path.join(__dirname, 'TOOL-CAPABILITY-CANON.json');
const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_BLOCK = 3;
const DATA_RANK = { PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3 };

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--task') out.task = argv[++i];
    else if (a === '--canon') out.canon = argv[++i];
    else if (a === '--data-class') out.dataClass = argv[++i];
    else if (a === '--allow-metered') out.allowMetered = true;
    else if (a === '--approved-by') out.approvedBy = argv[++i];
    else if (a === '--cap-usd') out.capUsd = argv[++i];
    else if (a === '--role') out.role = argv[++i];
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--wants-delegation') out.wantsDelegation = true;
    else if (a === '--json') out.json = true;
    else if (a === '--validate') out.validate = true;
    else if (a === '--list') out.list = true;
    else out.unknown = a;
  }
  return out;
}

function readCanon(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validate(canon) {
  const errors = [];
  if (!canon || typeof canon !== 'object') return ['canon must be an object'];
  if (!Array.isArray(canon.taskTypes) || canon.taskTypes.length === 0) errors.push('taskTypes must be non-empty');
  if (!Array.isArray(canon.tools) || canon.tools.length === 0) errors.push('tools must be non-empty');
  if (canon.defaultMeteredBudgetUsd !== 0) errors.push('defaultMeteredBudgetUsd must remain 0; metered spend requires explicit authorization');

  const taskIds = new Set();
  const toolIds = new Set();
  for (const task of canon.taskTypes || []) {
    if (!task.taskId) errors.push('task missing taskId');
    else if (taskIds.has(task.taskId)) errors.push(`duplicate taskId: ${task.taskId}`);
    else taskIds.add(task.taskId);
    if (!Array.isArray(task.preferredToolIds) || task.preferredToolIds.length === 0) errors.push(`${task.taskId || '(unknown task)'} has no preferredToolIds`);
  }
  for (const tool of canon.tools || []) {
    if (!tool.toolId) errors.push('tool missing toolId');
    else if (toolIds.has(tool.toolId)) errors.push(`duplicate toolId: ${tool.toolId}`);
    else toolIds.add(tool.toolId);
    if (!tool.availabilityEvidence || !tool.availabilityEvidence.result) errors.push(`${tool.toolId || '(unknown tool)'} has no availability evidence`);
    for (const taskId of tool.taskIds || []) if (!taskIds.has(taskId)) errors.push(`${tool.toolId} references unknown taskId ${taskId}`);
  }
  for (const task of canon.taskTypes || []) {
    for (const toolId of task.preferredToolIds || []) if (!toolIds.has(toolId)) errors.push(`${task.taskId} prefers unknown tool ${toolId}`);
  }
  return errors;
}


// ── policy-based routing (MODEL-ROUTING-POLICY.json) ────────────────────────
const POLICY_PATH = require('path').join(__dirname, 'MODEL-ROUTING-POLICY.json');

function loadPolicy() {
  const fs = require('fs');
  if (!fs.existsSync(POLICY_PATH)) {
    const e = new Error('MODEL-ROUTING-POLICY.json is missing. Refusing to route: an absent policy is not a permissive policy.');
    e.refused = true; throw e;
  }
  return JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
}

// Metered execution needs a named human and a cap inside the hard ceiling.
// Each condition exists because of a specific way spending goes wrong:
// no name = nobody accountable; no cap = unbounded; cap above ceiling = the
// ceiling was decorative.
function meteredAuthorization(opts) {
  let policy;
  try { policy = loadPolicy(); }
  catch (e) { return { ok: false, reason: 'model routing policy unreadable — metered execution refused' }; }
  const b = policy.budgets || {};
  if (!opts.allowMetered) return { ok: false, reason: 'metered execution has no explicit budget authorization' };
  if (!opts.approvedBy || String(opts.approvedBy).trim() === '') {
    return { ok: false, reason: 'metered execution requires --approved-by <named human>; an AI may not authorize spending on the owner\'s behalf' };
  }
  const cap = Number(opts.capUsd);
  if (!Number.isFinite(cap) || cap <= 0) {
    return { ok: false, reason: 'metered execution requires --cap-usd <number>; authorization without a cap is unbounded' };
  }
  // GROK G9 FINDING #5: this read `Number.isFinite(ceiling) && cap > ceiling`,
  // so a missing, null, or misspelled hardCeilingUsd made isFinite false and NO
  // refusal happened — any finite cap passed. An absent policy FILE refused
  // loudly while an absent ceiling FIELD failed open, which is the worse of the
  // two because nothing looks wrong. A ceiling that disappears when malformed
  // is not a ceiling.
  if (!Object.prototype.hasOwnProperty.call(b, 'hardCeilingUsd')) {
    return { ok: false, reason: 'the routing policy declares no budgets.hardCeilingUsd; refusing metered execution rather than spending against an undefined ceiling' };
  }
  const ceiling = Number(b.hardCeilingUsd);
  if (!Number.isFinite(ceiling) || ceiling <= 0) {
    return { ok: false, reason: `budgets.hardCeilingUsd is ${JSON.stringify(b.hardCeilingUsd)}, which is not a positive number; the ceiling cannot be enforced so metered execution is refused` };
  }
  if (cap > ceiling) {
    return { ok: false, reason: `--cap-usd ${cap} exceeds the policy hard ceiling of ${ceiling}` };
  }
  return { ok: true, approvedBy: String(opts.approvedBy), capUsd: cap };
}

// Role routing: who performs a role, with the separation rules enforced.
function routeRole(roleId, opts = {}) {
  const policy = loadPolicy();
  const role = (policy.roles || {})[roleId];
  if (!role) return { ok: false, code: 'UNKNOWN_ROLE', reason: `${roleId} is not a role in the routing policy.` };

  const chosen = opts.model || role.default;

  // A reviewer that is also the author is not a reviewer.
  for (const other of role.mustDifferFrom || []) {
    const otherRole = (policy.roles || {})[other];
    const otherModel = (opts.assigned && opts.assigned[other]) || (otherRole && otherRole.default);
    if (otherModel && otherModel === chosen) {
      return {
        ok: false, code: 'SELF_REVIEW_REFUSED',
        reason: `${roleId} would be performed by "${chosen}", which is already performing "${other}". A model may not review its own work.`,
      };
    }
  }

  // Recursive delegation is off unless the role explicitly opts in.
  const recursion = role.recursiveDelegation === true;
  if (opts.wantsDelegation && !recursion) {
    return {
      ok: false, code: 'RECURSIVE_DELEGATION_REFUSED',
      reason: `${roleId} requested sub-agent delegation, which is disabled by default. One bounded budget must not become an unbounded tree.`,
    };
  }

  const model = (policy.models || {})[chosen];
  if (!model) return { ok: false, code: 'UNKNOWN_MODEL', reason: `${chosen} is not declared in the routing policy.` };

  // Data sensitivity vetoes first, before capability or cost are considered.
  // `||` would turn an explicitly-passed empty string into the INTERNAL
  // default, which hides a caller bug. Only an ABSENT class defaults; a supplied
  // one is taken literally and must be recognised.
  const dataClass = (opts.dataClass === undefined || opts.dataClass === null) ? 'INTERNAL' : opts.dataClass;
  const rank = (policy.dataClasses || {});
  // PROVEN DEFECT (2026-08-25): an unrecognised class produced `undefined` for
  // its rank, the comparison below was skipped, and the route was ALLOWED.
  // "CONFIDENTIAL", "typo-class" and "" all sailed through — a misspelling
  // silently disabled the first veto in the policy. An unknown sensitivity is
  // the one case that must never be treated as low sensitivity.
  if (!Object.prototype.hasOwnProperty.call(rank, dataClass)) {
    return {
      ok: false, code: 'DATA_CLASS_UNKNOWN',
      reason: `"${dataClass}" is not a declared data class (known: ${Object.keys(rank).join(', ')}). ` +
        'Refusing rather than guessing: an unrecognised sensitivity label cannot be assumed harmless.',
    };
  }
  const want = rank[dataClass] && rank[dataClass].rank;
  const max = rank[model.maxDataClass] && rank[model.maxDataClass].rank;
  if (typeof want !== 'number' || typeof max !== 'number') {
    return {
      ok: false, code: 'DATA_CLASS_UNRANKED',
      reason: `data class "${dataClass}" or model ceiling "${model.maxDataClass}" has no numeric rank; the sensitivity veto cannot be evaluated, so it fails closed.`,
    };
  }
  if (want > max) {
    return {
      ok: false, code: 'DATA_CLASS_REFUSED',
      reason: `${dataClass} data may not be sent to ${chosen} (max ${model.maxDataClass}). Data sensitivity vetoes before capability or cost.`,
    };
  }

  if (model.execution === 'METERED') {
    const m = meteredAuthorization(opts);
    if (!m.ok) return { ok: false, code: 'METERED_UNAUTHORIZED', reason: m.reason };
  }

  return {
    ok: true, roleId, model: chosen, label: model.label,
    execution: model.execution, dataClass,
    bounds: role.bounds || null,
    recursiveDelegation: recursion,
    advisoryOnly: role.advisoryOnly === true,
    mayApproveOwnWork: role.mayApproveOwnWork === true,
  };
}

function route(canon, opts) {
  const task = canon.taskTypes.find((t) => t.taskId === opts.task);
  if (!task) return { ok: false, code: 'UNKNOWN_TASK', reason: `Task ${opts.task} is not in the Tool Capability Canon.` };
  // GROK G11 FINDING #4: routeRole() was fixed to treat an explicit empty class
  // as unknown; route() kept `||`, so dataClass:'' still became INTERNAL and
  // routed. This is the THIRD time a repair landed on one of two call paths —
  // the pattern is fixing what the failing test exercised rather than what the
  // defect described. Both paths now share one resolution rule.
  const dataClass = (opts.dataClass === undefined || opts.dataClass === null) ? 'INTERNAL' : opts.dataClass;
  if (!(dataClass in DATA_RANK)) return { ok: false, code: 'INVALID_DATA_CLASS', reason: `Unknown data class ${dataClass}.` };

  const byId = new Map(canon.tools.map((t) => [t.toolId, t]));
  const considered = [];
  for (const toolId of task.preferredToolIds) {
    const tool = byId.get(toolId);
    if (!tool) continue;
    const reasons = [];
    if (!tool.enabled || tool.availability === 'DISABLED') reasons.push('disabled');
    if (tool.availability !== 'AVAILABLE') reasons.push(`availability=${tool.availability}`);
    // GROK G9 FINDING #4: the D4 repair was applied to routeRole() only. This
    // second call path kept the original `undefined > undefined` comparison,
    // which is false, so an unrecognised class sailed through. Fixing one of
    // two entry points and reporting the defect closed is exactly the shape of
    // failure this system exists to catch — so both paths now share the check.
    const wantRank = DATA_RANK[dataClass];
    const maxRank = DATA_RANK[tool.maxDataClassification];
    if (typeof wantRank !== 'number') {
      reasons.push(`data class "${dataClass}" is not recognised (known: ${Object.keys(DATA_RANK).join(', ')}) — refusing rather than assuming it is harmless`);
    } else if (typeof maxRank !== 'number') {
      reasons.push(`tool ceiling "${tool.maxDataClassification}" is not a recognised data class; the sensitivity veto cannot be evaluated`);
    } else if (wantRank > maxRank) {
      reasons.push(`data class ${dataClass} exceeds ${tool.maxDataClassification}`);
    }
    // CONFIRMED FINDING #5: a bare --allow-metered boolean used to authorize
    // spending. Money now requires a name attached to the decision and a
    // number attached to the spend, both bounded by the policy ceiling.
    if (tool.costClass === 'METERED') {
      const m = meteredAuthorization(opts);
      if (!m.ok) reasons.push(m.reason);
    }
    considered.push({ toolId, eligible: reasons.length === 0, reasons });
    if (reasons.length === 0) {
      return {
        ok: true,
        taskId: task.taskId,
        toolId: tool.toolId,
        label: tool.label,
        executionMode: tool.executionModes[0],
        costClass: tool.costClass,
        dataClass,
        verification: tool.verification,
        requiredInputs: task.requiredInputs || [],
        requiredOutputs: task.requiredOutputs || [],
        considered,
      };
    }
  }
  return {
    ok: false,
    code: 'SPECIALIST_REQUIRED',
    reason: `No verified, enabled specialist can execute ${task.taskId}. Generalist fallback is ${task.generalistFallback}.`,
    taskId: task.taskId,
    considered,
  };
}

function main() {
  const opts = parse(process.argv.slice(2));
  if (opts.unknown) {
    console.error(`Unknown argument: ${opts.unknown}`);
    return EXIT_USAGE;
  }
  const canonPath = path.resolve(ROOT, opts.canon || path.relative(ROOT, DEFAULT_CANON));
  let canon;
  try { canon = readCanon(canonPath); }
  catch (e) { console.error(`Cannot read canon ${canonPath}: ${e.message}`); return EXIT_USAGE; }
  const errors = validate(canon);
  if (errors.length) {
    console.error('TOOL CANON INVALID');
    for (const error of errors) console.error(`- ${error}`);
    return EXIT_USAGE;
  }
  if (opts.validate) {
    console.log(`TOOL CANON VALID — ${canon.taskTypes.length} task type(s), ${canon.tools.length} tool profile(s), default metered budget $${canon.defaultMeteredBudgetUsd}`);
    return EXIT_OK;
  }
  if (opts.list) {
    for (const task of canon.taskTypes) console.log(`${task.taskId}: ${task.preferredToolIds.join(', ')}; fallback=${task.generalistFallback}`);
    return EXIT_OK;
  }
  if (!opts.task) {
    console.error('Usage: tool-router.cjs --task <taskId> [--data-class INTERNAL] [--allow-metered] [--json]');
    return EXIT_USAGE;
  }
  const result = route(canon, opts);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) {
    console.log(`ROUTE: ${result.toolId} (${result.executionMode}; ${result.costClass})`);
    console.log(`TASK: ${result.taskId}`);
    console.log(`DATA: ${result.dataClass}`);
  } else {
    console.log(`ROUTE: BLOCKED — ${result.code}`);
    console.log(result.reason);
    for (const item of result.considered || []) console.log(`- ${item.toolId}: ${item.reasons.join('; ') || 'eligible'}`);
  }
  return result.ok ? EXIT_OK : EXIT_BLOCK;
}

module.exports = { routeRole, meteredAuthorization, loadPolicy, route, DATA_RANK };

if (require.main === module) process.exit(main());

