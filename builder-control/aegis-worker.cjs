#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const CONTAINMENT = require('./sandbox-containment.cjs');
const PACKET_TOOLS = require('./packet-tools.cjs');
// The canonical policy-model -> canon-tool mapping is owned by the router. It is
// imported rather than restated so the failover path cannot drift into a second
// routing table.
const TOOL_ROUTER = require('./tool-router.cjs');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const PACKETS_DIR = path.join(HERE, 'packets');
const RUNTIME = path.join(HERE, 'aegis-run.cjs');
const MODEL_ROUTING_POLICY = path.join(HERE, 'MODEL-ROUTING-POLICY.json');
const TOOL_CAPABILITY_CANON = path.join(HERE, 'TOOL-CAPABILITY-CANON.json');
const TAIL_LINES = 24;
const HEARTBEAT_MS = 1000;
const TERMINATION_DEADLINE_MS = 2000;
const CHILD_CLOSE_GRACE_MS = 250;
const CONTROL_POLL_MS = 35;
// Leave ample time inside the synchronous control-plane response budget for
// the signed fail-closed evidence to be persisted and returned.
const CANCEL_CLOSE_GRACE_MS = 1000;
const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_TIMEOUT_SEC = 3600;
const DEFAULT_NO_PROGRESS_TIMEOUT_SEC = 300;
const CLAUDE_MODELS = new Set(['opus', 'sonnet', 'haiku']);
const GROK_MODELS = new Set(['grok-4.6', 'grok-4.5']);
const CLAUDE_VERSION = '2.1.245';
const CLAUDE_VERSIONS_DIR = path.join(os.homedir(), '.local', 'share', 'claude', 'versions');
const CLAUDE_EXECUTABLE = path.join(CLAUDE_VERSIONS_DIR, CLAUDE_VERSION);
const GROK_EXECUTABLE = path.join(os.homedir(), '.grok', 'bin', 'grok');
const GROK_PINNED_EXECUTABLE = path.join(os.homedir(), '.grok', 'downloads', 'grok-macos-aarch64');
const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials';
const CLAUDE_OAUTH_TOKEN_FILE_DESCRIPTOR = CONTAINMENT.CLAUDE_OAUTH_TOKEN_FD;
const CLAUDE_OAUTH_EXPIRY_SKEW_MS = 60 * 1000;
const CLAUDE_FILE_TOOLS = Object.freeze(['Read', 'Edit', 'Write', 'Glob', 'Grep']);
const CLAUDE_DISALLOWED_TOOLS = Object.freeze(['Bash']);
// `--print` with the default text format buffers the entire tool and thinking
// phase, so a builder that is genuinely working emits nothing on stdout until
// it writes a file or produces text. The no-progress watchdog only resets on
// stdout, stderr or an authorized-write digest change, so that silence reads
// as idle and the run is killed NO_PROGRESS_TIMEOUT. Realtime stream-json with
// partial messages turns each turn, tool call and delta into an stdout event,
// which is real execution activity rather than a heartbeat.
const CLAUDE_STREAM_PROGRESS_ARGV = Object.freeze([
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
]);
// Stream evidence stays bounded and carries no model content: only event
// shape, tool names and explicit error text ever reach the ledger.
const STREAM_EVIDENCE_BYTES = 24000;
const STREAM_ERROR_TEXT_BYTES = 400;
const STREAM_TEXT_LINE_BYTES = 1000;
// The bounded activity vocabulary the supervision surface is allowed to state.
// A tool name is a fixed protocol identifier the client emits, not model
// output, so mapping one to a category carries no prose, prompt, path, tool
// input or file content across the boundary. A tool this map does not name
// yields WORKING rather than travelling verbatim.
const CLAUDE_TOOL_ACTIVITY = Object.freeze({
  Read: 'READING', Glob: 'SEARCHING', Grep: 'SEARCHING',
  Edit: 'EDITING', Write: 'EDITING',
});
const PROGRESS_ACTIVITY_CODES = Object.freeze([
  'STARTING', 'READING', 'SEARCHING', 'EDITING', 'WORKING', 'RESPONDING', 'DIAGNOSING',
]);
const GROK_FILE_TOOLS = Object.freeze(['read_file', 'search_replace', 'grep', 'list_dir']);
const GROK_DISALLOWED_TOOLS = Object.freeze(['run_terminal_cmd', 'web_search', 'web_fetch', 'task']);
const GROK_MAX_TURNS = 32;
const GROK_HOME_PREFIX = '/private/tmp/aegis-grok-';
const HOST_OUTER_CONTAINMENT_BOUNDARY = 'AEGIS_TOP_LEVEL_HOST_CONTAINMENT_V1';
const CHECK_SNAPSHOT_POLICY = 'AEGIS_IMMUTABLE_CHECK_SNAPSHOT_V1';
const TRUSTED_PROCESS_INSPECTOR_ENV = 'AEGIS_TRUSTED_PROCESS_INSPECTOR';
const TRUSTED_PROCESS_INSPECTOR_SHA_ENV = 'AEGIS_TRUSTED_PROCESS_INSPECTOR_SHA256';
const FIXED_PATH = [
  '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  path.join(os.homedir(), '.local', 'bin'),
].join(path.delimiter);
const CLAUDE_SETTINGS = Object.freeze({
  permissions: {
    defaultMode: 'acceptEdits',
    deny: [
      'WebFetch', 'WebSearch',
      // The Claude process may load these two files as subscription runtime
      // configuration, but the model's Read tool must never receive them.
      'Read(~/.claude.json)', 'Read(~/.claude/settings.json)', 'Read(~/.claude/**)',
      'Read(~/.ssh/**)', 'Read(~/.aws/**)', 'Read(~/.config/gh/**)',
      'Read(~/.config/gcloud/**)', 'Read(~/.kube/**)', 'Read(~/.docker/**)',
      'Read(~/Library/Keychains/**)',
      'Bash(security *)', 'Bash(/usr/bin/security *)',
    ],
  },
  sandbox: {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    excludedCommands: [],
    allowUnsandboxedCommands: false,
    filesystem: {
      // This is an OS-enforced sandbox boundary for model-issued commands,
      // separate from the pinned Claude client's outer authentication helper.
      // It catches wrappers, scripts and variable-indirected `security` calls;
      // the textual Bash deny list above is only defense in depth.
      denyRead: [
        '~/.ssh', '~/.aws', '~/.config/gh', '~/.config/gcloud', '~/.kube', '~/.docker',
        '~/Library/Keychains',
      ],
    },
  },
});

function assertClaudeModelSandboxPolicy(settings = CLAUDE_SETTINGS,
  tools = CLAUDE_FILE_TOOLS, disallowed = CLAUDE_DISALLOWED_TOOLS) {
  const sandbox = settings && settings.sandbox;
  const deny = settings && settings.permissions && settings.permissions.deny;
  const denyRead = sandbox && sandbox.filesystem && sandbox.filesystem.denyRead;
  if (!sandbox || sandbox.enabled !== true || sandbox.failIfUnavailable !== true ||
      sandbox.allowUnsandboxedCommands !== false || !Array.isArray(denyRead) ||
      !denyRead.includes('~/Library/Keychains') || !Array.isArray(deny) ||
      !deny.includes('Bash(security *)') || !deny.includes('Bash(/usr/bin/security *)') ||
      !Array.isArray(tools) || tools.length !== CLAUDE_FILE_TOOLS.length ||
      tools.some((tool, index) => tool !== CLAUDE_FILE_TOOLS[index]) ||
      tools.includes('Bash') || !Array.isArray(disallowed) || !disallowed.includes('Bash')) {
    throw new Error('Claude model boundary does not enforce file-only tools and Keychain defense in depth');
  }
  return true;
}

function nowIso() { return new Date().toISOString(); }
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function launchDigest(launchSpec) {
  return sha256(JSON.stringify(normalizeLaunchSpec(launchSpec)));
}

function authorizedWriteDigest(values, root = null) {
  if (!Array.isArray(values)) throw new Error('authorized write paths must be an array');
  const snapshot = values.map((value) => {
    if (typeof value !== 'string') throw new Error('authorized write path must be a string');
    const target = path.isAbsolute(value) ? value : path.resolve(root || '', value);
    if (!path.isAbsolute(target)) throw new Error('authorized write path must resolve to an absolute path');
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) return { path: value, type: 'symlink', target: fs.readlinkSync(target) };
      if (stat.isFile()) return { path: value, type: 'file', sha256: sha256(fs.readFileSync(target)) };
      return { path: value, type: stat.isDirectory() ? 'directory' : 'other', size: stat.size };
    } catch (error) {
      if (error && error.code === 'ENOENT') return { path: value, type: 'missing' };
      throw error;
    }
  });
  return sha256(JSON.stringify(snapshot));
}

function controlMac(secret, value) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(value)).digest('hex');
}

function validControlMac(secret, value, mac) {
  if (typeof mac !== 'string' || !/^[0-9a-f]{64}$/.test(mac)) return false;
  const expected = Buffer.from(controlMac(secret, value), 'hex');
  const observed = Buffer.from(mac, 'hex');
  return observed.length === expected.length && crypto.timingSafeEqual(observed, expected);
}

function atomicPrivateJson(target, value) {
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function boundedTail(value) {
  return String(value || '')
    .replace(/(authorization:\s*bearer\s+)[^\s]+/ig, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s]+/ig, '$1[REDACTED]')
    // A credential is not always introduced by a label. A bare JWT carries its
    // own shape, so it is redacted on the same boundary as the labelled forms.
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g, '[REDACTED JWT]')
    .split('\n').slice(-TAIL_LINES).join('\n').slice(-12000);
}

/**
 * Reduce one Claude stream-json line to progress evidence.  The summary keeps
 * the event shape and the tool names the model invoked; assistant text,
 * thinking, tool inputs and tool results never survive this boundary, so the
 * dashboard sees that work is happening without seeing raw model output.
 * Explicit error text is retained, bounded, because failure classification
 * depends on it.
 */
function summarizeClaudeStreamLine(line) {
  const text = String(line === null || line === undefined ? '' : line).trim();
  if (!text) return null;
  // Non-JSON stdout is CLI output, not model output, and carries the
  // authentication failures the builder classifier reads.
  if (text[0] !== '{') return boundedTail(text).slice(-STREAM_TEXT_LINE_BYTES);
  let event = null;
  try { event = JSON.parse(text); } catch { event = null; }
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return `stream-line unparsed bytes=${Buffer.byteLength(text, 'utf8')}`;
  }
  const parts = [String(event.type || 'event')];
  if (typeof event.subtype === 'string') parts.push(event.subtype);
  if (event.event && typeof event.event === 'object' && !Array.isArray(event.event)) {
    if (typeof event.event.type === 'string') parts.push(event.event.type);
    const delta = event.event.delta;
    if (delta && typeof delta.type === 'string') parts.push(delta.type);
    const block = event.event.content_block;
    if (block && typeof block.type === 'string') parts.push(block.type);
    if (block && typeof block.name === 'string') parts.push(`tool=${block.name}`);
  }
  const content = event.message && Array.isArray(event.message.content) ? event.message.content : null;
  if (content) {
    const kinds = [...new Set(content.map((b) => (b && typeof b.type === 'string' ? b.type : 'unknown')))];
    if (kinds.length) parts.push(`blocks=${kinds.join('+')}`);
    const tools = [...new Set(content
      .filter((b) => b && b.type === 'tool_use' && typeof b.name === 'string')
      .map((b) => b.name))];
    if (tools.length) parts.push(`tools=${tools.join('+')}`);
  }
  const failed = event.is_error === true || event.type === 'error';
  const errorText = !failed ? null
    : typeof event.result === 'string' ? event.result
      : typeof event.error === 'string' ? event.error
        : event.error && typeof event.error.message === 'string' ? event.error.message : null;
  if (errorText) {
    parts.push(`error=${boundedTail(errorText).replace(/\s+/g, ' ').slice(0, STREAM_ERROR_TEXT_BYTES)}`);
  }
  return parts.join(' ');
}

/**
 * Reduce one Claude stream-json line to one bounded activity code.
 *
 * Only the protocol's own event shape and tool identifiers are read; assistant
 * text, thinking, tool inputs and tool results are never inspected, so the
 * result is always one of PROGRESS_ACTIVITY_CODES or null.  A line that names
 * no activity returns null, so the caller keeps the last activity it actually
 * observed instead of inventing a newer one for it.
 */
function claudeStreamActivity(line) {
  const text = String(line === null || line === undefined ? '' : line).trim();
  if (!text || text[0] !== '{') return null;
  let event;
  try { event = JSON.parse(text); } catch { return null; }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const stream = event.event && typeof event.event === 'object' && !Array.isArray(event.event)
    ? event.event : null;
  const blocks = [];
  if (stream && stream.content_block && typeof stream.content_block === 'object') {
    blocks.push(stream.content_block);
  }
  if (event.message && Array.isArray(event.message.content)) {
    for (const block of event.message.content) {
      if (block && typeof block === 'object') blocks.push(block);
    }
  }
  let responding = Boolean(stream && stream.delta && stream.delta.type === 'text_delta');
  for (const block of blocks) {
    if (block.type === 'tool_use') {
      return typeof block.name === 'string' &&
        Object.prototype.hasOwnProperty.call(CLAUDE_TOOL_ACTIVITY, block.name)
        ? CLAUDE_TOOL_ACTIVITY[block.name] : 'WORKING';
    }
    if (block.type === 'text') responding = true;
  }
  return responding ? 'RESPONDING' : null;
}

/**
 * Line-buffered accumulator over the child's stdout.  Repeated event shapes
 * collapse into a count so a high-rate partial-message stream cannot flood the
 * bounded evidence tail.
 */
function createClaudeStreamProgressDigest(limitBytes = STREAM_EVIDENCE_BYTES) {
  let pending = '';
  let digest = '';
  let current = null;
  let repeats = 0;
  let latestActivity = null;
  const render = () => (repeats > 1 ? `${current} x${repeats}` : current);
  const commit = () => {
    if (current === null) return;
    const line = render();
    digest = digest ? `${digest}\n${line}` : line;
    if (digest.length > limitBytes) digest = digest.slice(-limitBytes);
    current = null;
    repeats = 0;
  };
  const take = (line) => {
    const observed = claudeStreamActivity(line);
    if (observed !== null) latestActivity = observed;
    const summary = summarizeClaudeStreamLine(line);
    if (summary === null) return;
    if (summary === current) { repeats += 1; return; }
    commit();
    current = summary;
    repeats = 1;
  };
  const text = () => {
    const joined = current === null ? digest : (digest ? `${digest}\n${render()}` : render());
    return joined.length > limitBytes ? joined.slice(-limitBytes) : joined;
  };
  return Object.freeze({
    push(chunk) {
      pending += String(chunk);
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) take(line);
      return text();
    },
    end() {
      if (pending) { take(pending); pending = ''; }
      commit();
      return text();
    },
    text,
    // The last activity a structured event actually named, or null when none
    // has been observed yet. It is never inferred from byte counts or timing.
    activity() { return latestActivity; },
  });
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e && e.code === 'EPERM'; }
}

function processGroupAlive(processGroupId) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 1) return false;
  try { process.kill(-processGroupId, 0); return true; }
  catch (e) { return e && e.code === 'EPERM'; }
}

function trustedProcessInspector(source = process.env) {
  if (source.AEGIS_HOST_OUTER_CONTAINMENT !== HOST_OUTER_CONTAINMENT_BOUNDARY &&
      source.AEGIS_CHECK_SNAPSHOT_POLICY !== CHECK_SNAPSHOT_POLICY) return null;
  const candidate = source[TRUSTED_PROCESS_INSPECTOR_ENV];
  const expectedSha256 = source[TRUSTED_PROCESS_INSPECTOR_SHA_ENV];
  const home = source.HOME;
  const scratch = source.TMPDIR;
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) ||
      !/^[0-9a-f]{64}$/.test(expectedSha256 || '') ||
      typeof home !== 'string' || typeof scratch !== 'string') return null;
  const root = path.dirname(home);
  const normalizedScratch = scratch.endsWith(path.sep) ? scratch.slice(0, -1) : scratch;
  const bin = path.join(root, 'bin');
  if (home !== path.join(root, 'home') || normalizedScratch !== path.join(root, 'tmp') ||
      candidate !== path.join(bin, 'ps')) return null;
  try {
    for (const target of [root, bin]) {
      const stat = fs.lstatSync(target);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
          (stat.mode & 0o022) !== 0 || fs.realpathSync(target) !== target) return null;
    }
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
        (stat.mode & 0o077) !== 0 || (stat.mode & 0o100) === 0 ||
        fs.realpathSync(candidate) !== candidate) return null;
    const observedSha256 = crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex');
    if (observedSha256 !== expectedSha256) return null;
  } catch { return null; }
  // The coordinate is accepted only from the deny-default outer boundary.
  // A caller that merely copies its marker can still write this root and is
  // therefore refused instead of gaining an executable-selection primitive.
  const probe = path.join(root, `.aegis-inspector-boundary-probe-${process.pid}`);
  try { fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 }); }
  catch (error) { return ['EPERM', 'EACCES'].includes(error.code) ? candidate : null; }
  try { fs.unlinkSync(probe); } catch { /* fail closed below */ }
  return null;
}

function processInspectorExecutable(source = process.env) {
  return trustedProcessInspector(source) || (fs.existsSync('/bin/ps') ? '/bin/ps' : '/usr/bin/ps');
}

function processGroupMembers(processGroupId, timeoutMs = 250) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 1) return null;
  const observed = spawnSync(processInspectorExecutable(), ['-axo', 'pid=,pgid='], {
    encoding: 'utf8', timeout: timeoutMs, detached: true,
  });
  if (observed.status !== 0) return null;
  const members = [];
  for (const line of String(observed.stdout || '').split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match || Number(match[2]) !== processGroupId) continue;
    const pid = Number(match[1]);
    members.push(pid);
  }
  return members;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function invalidLaunch(message) {
  const e = new Error(message);
  e.code = 'INVALID-LAUNCH-SPEC';
  return e;
}

/**
 * The caller describes work, never a process.  The executable, flags, cwd,
 * stdio and environment policy are owned here so dashboard text cannot cross
 * a shell boundary.  In particular, prompt metacharacters remain one argv
 * value and are never interpreted by bash/zsh.
 */
function normalizeLaunchSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidLaunch('launchSpec must be an object');
  }
  const allowed = new Set(['provider', 'prompt', 'model']);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw invalidLaunch(`unknown launchSpec field(s): ${unknown.join(', ')}`);
  if (value.provider !== 'claude-subscription' && value.provider !== 'grok-subscription') {
    throw invalidLaunch('provider must be claude-subscription or grok-subscription');
  }
  if (typeof value.prompt !== 'string' || !value.prompt.trim()) {
    throw invalidLaunch('prompt must be a non-empty string');
  }
  if (value.prompt.includes('\0')) throw invalidLaunch('prompt may not contain NUL');
  if (Buffer.byteLength(value.prompt, 'utf8') > MAX_PROMPT_BYTES) {
    throw invalidLaunch(`prompt may not exceed ${MAX_PROMPT_BYTES} bytes`);
  }
  const models = value.provider === 'claude-subscription' ? CLAUDE_MODELS : GROK_MODELS;
  const model = value.model === undefined
    ? (value.provider === 'claude-subscription' ? 'opus' : 'grok-4.6') : value.model;
  if (typeof model !== 'string' || !models.has(model)) {
    throw invalidLaunch(`model must be one of ${[...models].join(', ')}`);
  }
  return Object.freeze({ provider: value.provider, prompt: value.prompt, model });
}

function normalizeTimeoutSec(value) {
  const timeoutSec = value === undefined ? 900 : Number(value);
  if (!Number.isInteger(timeoutSec) || timeoutSec < 1 || timeoutSec > MAX_TIMEOUT_SEC) {
    throw invalidLaunch(`timeoutSec must be an integer from 1 to ${MAX_TIMEOUT_SEC}`);
  }
  return timeoutSec;
}

function builderNoProgressTimeoutMs(timeoutMs, source = process.env) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw invalidLaunch('builder timeout must be a positive finite duration');
  }
  if (source.NODE_ENV === 'test' && source.FAKE_NO_PROGRESS_TIMEOUT_MS !== undefined) {
    const configured = Number(source.FAKE_NO_PROGRESS_TIMEOUT_MS);
    if (!Number.isInteger(configured) || configured < 25 || configured >= timeoutMs) {
      throw invalidLaunch('test no-progress timeout must be an integer from 25ms below the hard timeout');
    }
    return configured;
  }
  const defaultMs = DEFAULT_NO_PROGRESS_TIMEOUT_SEC * 1000;
  return timeoutMs > defaultMs ? defaultMs : null;
}

function resolveClaudeExecutable() {
  if (process.env.NODE_ENV === 'test' && process.env.AEGIS_TEST_CLAUDE_EXECUTABLE) {
    const candidate = path.resolve(process.env.AEGIS_TEST_CLAUDE_EXECUTABLE);
    const real = fs.realpathSync(candidate);
    if (!path.isAbsolute(real) || !fs.statSync(real).isFile()) throw invalidLaunch('test Claude executable must resolve to a file');
    fs.accessSync(real, fs.constants.X_OK);
    return real;
  }
  const real = fs.realpathSync(CLAUDE_EXECUTABLE);
  const versionsReal = fs.realpathSync(CLAUDE_VERSIONS_DIR);
  if (real !== path.join(versionsReal, CLAUDE_VERSION)) {
    throw invalidLaunch(`Claude executable must resolve to approved version ${CLAUDE_VERSION}`);
  }
  fs.accessSync(real, fs.constants.X_OK);
  return real;
}

function resolvePinnedGrokExecutable(pinnedPath) {
  if (typeof pinnedPath !== 'string' || !path.isAbsolute(pinnedPath)) {
    throw invalidLaunch('Grok pinned executable path must be absolute');
  }
  let pinnedStat;
  try { pinnedStat = fs.lstatSync(pinnedPath); }
  catch { throw invalidLaunch('Grok pinned executable is missing'); }
  if (pinnedStat.isSymbolicLink() || !pinnedStat.isFile()) {
    throw invalidLaunch('Grok pinned executable must be a regular file, not a symlink');
  }
  const real = fs.realpathSync(pinnedPath);
  if (real !== pinnedPath) {
    throw invalidLaunch('Grok pinned executable path must resolve to itself');
  }
  try { fs.accessSync(real, fs.constants.X_OK); }
  catch { throw invalidLaunch('Grok pinned executable is not executable'); }
  return real;
}

function resolveGrokExecutable() {
  if (process.env.NODE_ENV === 'test' && process.env.AEGIS_TEST_GROK_PINNED_EXECUTABLE) {
    return resolvePinnedGrokExecutable(path.resolve(process.env.AEGIS_TEST_GROK_PINNED_EXECUTABLE));
  }
  if (process.env.NODE_ENV === 'test' && process.env.AEGIS_TEST_GROK_EXECUTABLE) {
    const real = fs.realpathSync(path.resolve(process.env.AEGIS_TEST_GROK_EXECUTABLE));
    if (!path.isAbsolute(real) || !fs.statSync(real).isFile()) throw invalidLaunch('test Grok executable must resolve to a file');
    fs.accessSync(real, fs.constants.X_OK);
    return real;
  }
  // Launch the immutable managed artifact itself. The operator convenience
  // symlink is intentionally not consulted: moving it can never select a new
  // builder binary for a governed run.
  return resolvePinnedGrokExecutable(GROK_PINNED_EXECUTABLE);
}

// ── governed builder failover ───────────────────────────────────────────────
// One automatic handoff, and only from a proven pre-mutation failure. Each code
// below names a failure the ORIGINAL provider owns, so handing the identical
// objective to a different subscription builder is a route change rather than a
// retry. A failure whose cause is the work itself (a non-zero builder exit, a
// refused packet, a rejected write) is deliberately absent: retrying that
// somewhere else would launder a real result.
const FAILOVER_FAILURE_CODES = Object.freeze([
  'MODEL_AUTH_FAILURE', 'PROVIDER_OVERLOAD', 'BUILDER_TIMEOUT',
]);
const FAILOVER_FAILURE_SUMMARIES = Object.freeze({
  MODEL_AUTH_FAILURE: 'Claude subscription authentication failed before any authorized file change.',
  PROVIDER_OVERLOAD: 'Claude reported a provider overload before any authorized file change.',
  BUILDER_TIMEOUT: 'The Claude builder reached its bounded timeout.',
});

function failoverRefusal(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Classify a terminal builder outcome as a provider-owned failure.
 *
 * `observed` carries the supervisor's own bounded-timeout facts. A timeout is
 * never inferred from output text, and this function never decides whether a
 * handoff may happen — mutation, drain and route eligibility are the handoff
 * authority's job.
 */
function classifyBuilderFailure(provider, exit, stdout, stderr, observed = {}) {
  if (provider !== 'claude-subscription' || exit === 0) return null;
  const output = `${stdout || ''}\n${stderr || ''}`;
  const classified = (code, retrySafe) => Object.freeze({
    code, provider, summary: FAILOVER_FAILURE_SUMMARIES[code], retrySafe, failoverEligible: true,
  });
  // The subscription freshness check can fail before a model process exists,
  // so there is no terminal CLI output to parse. Accept only its exact local
  // error code together with positive no-child evidence; generic bootstrap
  // errors remain work-owned failures and never enter provider failover.
  if (observed.bootstrapFailure === true && observed.childLaunchObserved === false &&
      observed.bootstrapErrorCode === 'CLAUDE_SUBSCRIPTION_REAUTH_REQUIRED') {
    return classified('MODEL_AUTH_FAILURE', true);
  }
  if (/(401[^\n]*(?:oauth|token)|oauth access token has expired|failed to authenticate)/i.test(output)) {
    return classified('MODEL_AUTH_FAILURE', true);
  }
  // Bounded to overload-shaped text. A bare "529" appearing in a pid, byte
  // count or file name must not be read as provider capacity loss.
  if (/(overloaded_error|\boverloaded\b|api error:\s*529\b|\b529\b[^\n]{0,80}(?:overload|capacity|unavailable))/i
    .test(output)) {
    return classified('PROVIDER_OVERLOAD', true);
  }
  if (observed.timedOut === true &&
      (observed.timeoutReason === 'NO_PROGRESS_TIMEOUT' || observed.timeoutReason === 'WALL_CLOCK_TIMEOUT')) {
    // retrySafe stays false: a timeout is only safe to hand on once the
    // original group is PROVEN drained, and that proof is applied downstream.
    return classified('BUILDER_TIMEOUT', false);
  }
  return null;
}

function loadModelRoutingPolicy() {
  const parsed = JSON.parse(fs.readFileSync(MODEL_ROUTING_POLICY, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidLaunch('model-routing policy root must be an object');
  }
  return parsed;
}

function loadToolCapabilityCanon() {
  const parsed = JSON.parse(fs.readFileSync(TOOL_CAPABILITY_CANON, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.tools)) {
    throw invalidLaunch('tool capability canon must declare a tools array');
  }
  return parsed;
}

function policyDataClassRank(policy, name) {
  const declared = policy && policy.dataClasses && policy.dataClasses[name];
  return declared && Number.isInteger(declared.rank) ? declared.rank : null;
}

/**
 * Identify the next eligible canonical subscription builder for an unchanged
 * objective.
 *
 * Two authorities are consulted, each for exactly what it declares it owns, so
 * no third table is introduced:
 *   MODEL-ROUTING-POLICY.json   who may hold this role, and in what order
 *   TOOL-CAPABILITY-CANON.json  whether that tool is available right now, and
 *                               the data ceiling its evidence supports
 * The canon's own note is explicit that availability lives only there; the
 * policy's is explicit that a route is an assignment. Reading availability from
 * the policy, or fallback order from the canon, would put the same fact in two
 * files and eventually trust the wrong one.
 *
 * This returns a CANDIDATE. It authorizes nothing on its own.
 */
function selectFailoverBuilder(launchSpec, failure, run, policy = loadModelRoutingPolicy(),
  canon = loadToolCapabilityCanon()) {
  const current = normalizeLaunchSpec(launchSpec);
  if (!failure || !FAILOVER_FAILURE_CODES.includes(failure.code) ||
      failure.provider !== current.provider || failure.failoverEligible !== true) return null;
  if (!run || typeof run.objective !== 'string' || !run.objective.trim()) {
    throw invalidLaunch('provider failover requires the canonical run objective');
  }
  const order = policy.fallbacks && policy.fallbacks.orchestrator;
  if (!Array.isArray(order) || order.length < 2) {
    throw invalidLaunch('canonical policy declares no orchestrator provider failover');
  }
  const currentModel = Object.entries(policy.models || {}).find(([, declaration]) =>
    declaration && declaration.workerRoute && declaration.workerRoute.provider === current.provider);
  if (!currentModel || !order.includes(currentModel[0])) {
    throw invalidLaunch('current builder route is absent from canonical failover policy');
  }
  const unavailableProviders = new Set([current.provider]);
  let selected = null;
  let selectedPolicyModel = null;
  for (const policyModel of order.slice(order.indexOf(currentModel[0]) + 1)) {
    const declaration = policy.models && policy.models[policyModel];
    if (!declaration || declaration.execution !== 'SUBSCRIPTION' || !declaration.workerRoute ||
        unavailableProviders.has(declaration.workerRoute.provider)) continue;
    try {
      selected = normalizeLaunchSpec({
        provider: declaration.workerRoute.provider,
        model: declaration.workerRoute.model,
        prompt: current.prompt,
      });
      selectedPolicyModel = policyModel;
      break;
    } catch { /* an unsupported policy route is ineligible */ }
  }
  if (!selected) {
    throw failoverRefusal('FALLBACK_ROUTES_EXHAUSTED',
      'canonical builder failover routes are exhausted');
  }
  const declaration = policy.models[selectedPolicyModel];
  const canonToolId = TOOL_ROUTER.POLICY_MODEL_TO_CANON_TOOL[selectedPolicyModel];
  const tool = canonToolId && Array.isArray(canon.tools)
    ? canon.tools.find((entry) => entry && entry.toolId === canonToolId) : null;
  if (!tool) {
    throw failoverRefusal('CANON_TOOL_UNAVAILABLE',
      `${selectedPolicyModel} has no Tool Capability Canon availability record`);
  }
  if (tool.enabled !== true || tool.availability !== 'AVAILABLE' || !tool.availabilityEvidence ||
      !Number.isFinite(Date.parse(tool.availabilityEvidence.observedAt || '')) ||
      typeof tool.availabilityEvidence.result !== 'string' || !tool.availabilityEvidence.result.trim()) {
    throw failoverRefusal('CANON_TOOL_UNAVAILABLE',
      `${canonToolId} is not canonically available with dated positive evidence`);
  }
  // The two authorities must agree on the ceiling. Disagreement is not resolved
  // in favour of the higher one; it fails closed.
  if (declaration.maxDataClass !== tool.maxDataClassification) {
    throw failoverRefusal('DATA_CLASS_AUTHORITY_MISMATCH',
      `${selectedPolicyModel} policy ceiling ${JSON.stringify(declaration.maxDataClass)} conflicts with ` +
      `${canonToolId} canonical ceiling ${JSON.stringify(tool.maxDataClassification)}`);
  }
  const dataClass = run.dataClass === undefined || run.dataClass === null ? 'INTERNAL' : run.dataClass;
  const wantRank = policyDataClassRank(policy, dataClass);
  const ceilingRank = policyDataClassRank(policy, declaration.maxDataClass);
  if (wantRank === null || ceilingRank === null) {
    throw failoverRefusal('DATA_CLASS_UNRANKED',
      `data class ${JSON.stringify(dataClass)} or ceiling ${JSON.stringify(declaration.maxDataClass)} ` +
      'has no canonical rank, so the sensitivity veto cannot be evaluated');
  }
  if (wantRank > ceilingRank) {
    throw failoverRefusal('DATA_CLASS_REFUSED',
      `${dataClass} run data may not be handed to ${selectedPolicyModel} ` +
      `(ceiling ${declaration.maxDataClass}). Data sensitivity vetoes before availability.`);
  }
  if (declaration.approvalAuthority !== 'NONE') {
    throw failoverRefusal('BUILDER_APPROVAL_AUTHORITY_REFUSED',
      `${selectedPolicyModel} must declare approvalAuthority NONE to receive a governed handoff`);
  }
  const selectedFamily = declaration.providerFamily || selectedPolicyModel;
  const reviewers = Object.entries(policy.roles || {})
    .filter(([roleId, role]) => roleId.endsWith('review') && role && role.mayApproveOwnWork === false)
    .map(([roleId, role]) => ({
      roleId,
      model: role.default,
      providerFamily: (((policy.models || {})[role.default] || {}).providerFamily || role.default),
    }));
  const independentReviewers = reviewers.filter((reviewer) => reviewer.providerFamily !== selectedFamily);
  if (independentReviewers.length === 0) {
    throw failoverRefusal('REVIEWER_INDEPENDENCE_CONFLICT',
      `${selectedPolicyModel} has no reviewer from a different provider family, so its own work ` +
      'could not be independently reviewed');
  }
  const objectiveSha256 = sha256(run.objective);
  const promptSha256 = sha256(current.prompt);
  return Object.freeze({
    launchSpec: selected,
    policyModel: selectedPolicyModel,
    selectionReason: `${failure.code}: ${currentModel[0]} is unavailable for the unchanged objective; ` +
      `${selectedPolicyModel} is the next eligible canonical subscription builder`,
    handoff: Object.freeze({
      state: 'ELIGIBLE',
      executable: false,
      reason: 'A canonical replacement builder is identified. The bounded handoff gate has not authorized execution yet.',
      fromProvider: current.provider,
      toProvider: selected.provider,
      fromPolicyModel: currentModel[0],
      toPolicyModel: selectedPolicyModel,
      failureCode: failure.code,
      sameProviderRetryAllowed: false,
      unchangedObjective: true,
      objectiveSha256,
      promptSha256,
      dataClass,
      canonToolId,
      builderMayApproveOwnWork: false,
      independentReviewers: Object.freeze(independentReviewers),
      excludedSelfReviewModels: Object.freeze(reviewers
        .filter((reviewer) => reviewer.providerFamily === selectedFamily)
        .map((reviewer) => reviewer.model)),
    }),
  });
}

/**
 * The original builder's process group drained, proven rather than assumed.
 * Both the timeout path (terminateOwnedChild) and the natural-close path
 * (observeOwnedGroupDrain) produce this shape, and an unverifiable membership
 * snapshot yields null members, which is refused rather than treated as empty.
 */
function processGroupDrainVerified(evidence) {
  const originalAbsent = Boolean(evidence) && (evidence.childCloseObserved === true ||
    (evidence.noChildLaunchObserved === true && evidence.childCloseObserved === false));
  return originalAbsent && evidence.processGroupDrained === true &&
    Array.isArray(evidence.remainingProcessGroupMembers) &&
    evidence.remainingProcessGroupMembers.length === 0 &&
    (evidence.noChildLaunchObserved === true || evidence.terminated === true);
}

function observeOwnedGroupDrain(childIdentity, childCloseObserved) {
  const members = processGroupMembers(process.pid, 250);
  const remaining = Array.isArray(members) ? members.filter((pid) => pid !== process.pid) : null;
  const drained = remaining !== null && remaining.length === 0;
  return {
    processGroupId: process.pid,
    childCloseObserved: Boolean(childCloseObserved),
    processGroupDrained: drained,
    remainingProcessGroupMembers: remaining,
    terminated: Boolean(childCloseObserved) && drained,
    reason: remaining === null ? 'GROUP_MEMBERSHIP_UNVERIFIED'
      : !drained ? 'GROUP_STILL_ALIVE'
        : childCloseObserved ? 'EXACT_CHILD_CLOSE_AND_GROUP_DRAIN_OBSERVED' : 'CHILD_CLOSE_UNVERIFIED',
    observedAt: nowIso(),
    childIdentity,
  };
}

function recordedAutomaticHandoffs(run) {
  const recorded = run && run.build && run.build.failoverHandoffs;
  return Number.isInteger(recorded) && recorded > 0 ? recorded : 0;
}

/**
 * The single bounded authority that decides whether one automatic handoff may
 * execute. It answers exactly one question and returns a record either way, so
 * a refusal is as legible on the dashboard as an authorization.
 *
 * The "exactly once" property is structural, not a counter: executePayload
 * calls this once and executes at most one replacement, and there is no loop
 * for a second pass to re-enter. The recorded count is evidence of that fact
 * rather than the mechanism enforcing it.
 */
function authorizeBuilderFailover(context) {
  const {
    launchSpec, failure, run, authorizedMutationObserved, drainEvidence,
    policy = loadModelRoutingPolicy(), canon = loadToolCapabilityCanon(),
  } = context || {};
  if (!failure || !FAILOVER_FAILURE_CODES.includes(failure.code) ||
      failure.failoverEligible !== true) return null;
  const current = normalizeLaunchSpec(launchSpec);
  const blocked = (blockedReason, reason, candidate = null) => Object.freeze({
    state: 'BLOCKED',
    executable: false,
    blockedReason,
    reason,
    failureCode: failure.code,
    fromProvider: current.provider,
    toProvider: candidate ? candidate.launchSpec.provider : null,
    toPolicyModel: candidate ? candidate.policyModel : null,
    sameProviderRetryAllowed: false,
    unchangedObjective: true,
  });

  // 1. A builder that already wrote inside its authority owns the worktree. Its
  //    partial work is real, and a replacement would be a concurrent writer over
  //    another builder's output rather than a clean handoff.
  if (authorizedMutationObserved === true) {
    return blocked('AUTHORIZED_MUTATION_OBSERVED',
      'The original builder already applied an authorized file change, so the run may not be handed to a ' +
      'replacement builder. Automatic failover is available only before any authorized mutation.');
  }
  // 2. One automatic handoff, never a chain.
  if (recordedAutomaticHandoffs(run) >= 1) {
    return blocked('HANDOFF_ALREADY_USED',
      'This run already used its one automatic builder handoff. A second automatic handoff would be a ' +
      'retry loop across providers.');
  }
  // 3. No replacement writer starts while the original group may still be live.
  if (!processGroupDrainVerified(drainEvidence)) {
    return blocked('PROCESS_GROUP_DRAIN_UNVERIFIED',
      'The original builder process group was not verifiably drained, so a replacement builder could ' +
      'become a concurrent writer in the same worktree.');
  }
  let candidate;
  try {
    candidate = selectFailoverBuilder(current, failure, run, policy, canon);
  } catch (error) {
    return blocked(error && error.code ? error.code : 'FAILOVER_ROUTE_REFUSED',
      `No eligible replacement builder: ${error && error.message ? error.message : 'route refused'}.`);
  }
  if (!candidate) return null;
  return Object.freeze({
    ...candidate.handoff,
    state: 'AUTHORIZED',
    executable: true,
    blockedReason: null,
    reason: 'The original builder failed before any authorized file change and its process group is ' +
      'verifiably drained, so the unchanged run may be handed to the next eligible canonical builder once.',
    launchSpec: candidate.launchSpec,
    policyModel: candidate.policyModel,
    selectionReason: candidate.selectionReason,
    originalDrainReason: drainEvidence.reason || null,
  });
}

function baseEnvironment(source = process.env) {
  const env = {};
  for (const key of ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (typeof source[key] === 'string' && source[key]) env[key] = source[key];
  }
  env.PATH = FIXED_PATH;
  return env;
}

function workerEnvironment(source = process.env) {
  const env = baseEnvironment(source);
  const inspector = trustedProcessInspector(source);
  if (inspector) {
    env[TRUSTED_PROCESS_INSPECTOR_ENV] = inspector;
    env[TRUSTED_PROCESS_INSPECTOR_SHA_ENV] = source[TRUSTED_PROCESS_INSPECTOR_SHA_ENV];
    if (source.AEGIS_HOST_OUTER_CONTAINMENT === HOST_OUTER_CONTAINMENT_BOUNDARY) {
      env.AEGIS_HOST_OUTER_CONTAINMENT = HOST_OUTER_CONTAINMENT_BOUNDARY;
    }
    if (source.AEGIS_CHECK_SNAPSHOT_POLICY === CHECK_SNAPSHOT_POLICY) {
      env.AEGIS_CHECK_SNAPSHOT_POLICY = CHECK_SNAPSHOT_POLICY;
    }
  }
  if (Object.keys(source).some((key) => key.startsWith('ANTHROPIC_'))) {
    env.AEGIS_REMOVED_ANTHROPIC_OVERRIDES = '1';
    if (Object.prototype.hasOwnProperty.call(source, 'ANTHROPIC_API_KEY')) {
      env.AEGIS_REMOVED_ANTHROPIC_API_KEY = '1';
    }
  }
  for (const key of ['AEGIS_RUNS_DIR', 'AEGIS_CHECKPOINTS_DIR', 'AEGIS_LEDGER_FILE']) {
    if (typeof source[key] === 'string' && source[key]) env[key] = source[key];
  }
  if (source.NODE_ENV === 'test') {
    env.NODE_ENV = 'test';
    for (const [key, value] of Object.entries(source)) {
      if ((key === 'AEGIS_TEST_CLAUDE_EXECUTABLE' || key === 'AEGIS_TEST_GROK_EXECUTABLE' ||
          key === 'AEGIS_TEST_CONTAINMENT_MODE' ||
          key === 'AEGIS_TEST_CANONICAL_ROOT' || key.startsWith('FAKE_')) && typeof value === 'string') env[key] = value;
    }
  }
  return env;
}

function claudeEnvironment(source = process.env) {
  const env = baseEnvironment(source);
  // Containment, not the worker process, owns the child executable-search
  // invariant. Do not pass PATH back as caller-controlled override input.
  delete env.PATH;
  if (source.NODE_ENV === 'test') {
    env.NODE_ENV = 'test';
    for (const [key, value] of Object.entries(source)) {
      if (key.startsWith('FAKE_') && typeof value === 'string') env[key] = value;
    }
  }
  return env;
}

function grokEnvironment(disposableHome, source = process.env) {
  if (typeof disposableHome !== 'string' || !disposableHome.startsWith(GROK_HOME_PREFIX)) {
    throw invalidLaunch('Grok requires an exact disposable HOME');
  }
  const env = baseEnvironment(source);
  delete env.PATH;
  env.HOME = disposableHome;
  env.GROK_HOME = path.join(disposableHome, '.grok');
  env.TMPDIR = path.join(disposableHome, 'tmp');
  env.GROK_MANAGED_MCPS_ENABLED = 'false';
  if (source.NODE_ENV === 'test') {
    env.NODE_ENV = 'test';
    for (const [key, value] of Object.entries(source)) {
      if (key.startsWith('FAKE_') && typeof value === 'string') env[key] = value;
    }
  }
  return env;
}

// The pinned Claude client can consume its subscription token from an
// inherited descriptor. The control plane is the only caller allowed to read
// the exact Keychain item; the credential value never enters argv, env,
// ledger, or worker evidence.
function claudeReauthRequired(reason) {
  const operatorAction = `Run ${CLAUDE_EXECUTABLE} auth login --claudeai interactively, then retry the governed build.`;
  const error = new Error(
    `Claude subscription preflight blocked before model launch: ${reason}. Operator action: ${operatorAction}`);
  error.code = 'CLAUDE_SUBSCRIPTION_REAUTH_REQUIRED';
  error.operatorAction = operatorAction;
  return error;
}

function assertClaudeOAuthFreshness(metadata, nowMs = Date.now()) {
  if (!metadata || !Number.isFinite(metadata.expiresAt)) {
    throw claudeReauthRequired('the Keychain credential has no valid expiry metadata');
  }
  if (!Number.isFinite(nowMs)) throw new Error('Claude OAuth freshness check requires a finite clock');
  if (metadata.expiresAt <= nowMs + CLAUDE_OAUTH_EXPIRY_SKEW_MS) {
    throw claudeReauthRequired('the Keychain access token is expired or too close to expiry');
  }
  return Object.freeze({
    expiresAt: metadata.expiresAt,
    hasRefreshToken: metadata.hasRefreshToken === true,
  });
}

function readClaudeOAuthToken() {
  const helper = CONTAINMENT.claudeKeychainHelperPaths().securityHelper;
  const result = spawnSync(helper, [
    'find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE, '-w',
  ], {
    cwd: ROOT,
    env: baseEnvironment(),
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw new Error('Claude subscription credentials are unavailable');
  }
  let raw = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  let payload;
  try { payload = JSON.parse(raw); }
  catch {
    raw = '';
    throw new Error('Claude subscription credentials are malformed');
  }
  raw = '';
  const oauth = payload && payload.claudeAiOauth;
  const token = oauth && oauth.accessToken;
  assertClaudeOAuthFreshness({
    expiresAt: oauth && oauth.expiresAt,
    hasRefreshToken: Boolean(oauth && typeof oauth.refreshToken === 'string' && oauth.refreshToken.trim()),
  });
  payload = null;
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Claude subscription access token is unavailable');
  }
  return token;
}

function attachClaudeOAuthToken(child, token) {
  const tokenStream = child && Array.isArray(child.stdio) && child.stdio[3];
  if (!tokenStream || typeof tokenStream.end !== 'function') {
    throw new Error('Claude OAuth token descriptor was not inherited');
  }
  tokenStream.end(`${token}\n`);
}

async function runContainedClaudeAuthStatus(run, childEnv = claudeEnvironment()) {
  const claudeExecutable = resolveClaudeExecutable();
  const productionClaude = !(process.env.NODE_ENV === 'test' && process.env.AEGIS_TEST_CLAUDE_EXECUTABLE);
  if (!productionClaude) throw new Error('contained auth status requires the pinned Claude executable');
  let token = readClaudeOAuthToken();
  let contained;
  try {
    contained = prepareRunContainment(run, claudeExecutable, {
      ...childEnv,
      CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: CLAUDE_OAUTH_TOKEN_FILE_DESCRIPTOR,
    });
    const child = spawn(contained.command.bin, [...contained.command.argv, 'auth', 'status', '--json'], {
      cwd: run.worktree.path,
      env: contained.env,
      detached: false,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    });
    try { attachClaudeOAuthToken(child, token); }
    finally { token = null; }
    let stdout = '';
    let timedOut = false;
    if (child.stdout) child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-65536); });
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGKILL'); } catch { /* child may already be gone */ }
      }, 30000);
      child.once('error', () => {
        clearTimeout(timer);
        resolve(Object.freeze({ status: 127, loggedIn: false, authMethod: null, apiProvider: null }));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve(Object.freeze({ status: 124, loggedIn: false, authMethod: null, apiProvider: null }));
          return;
        }
        let payload;
        try { payload = JSON.parse(stdout); } catch { payload = null; }
        resolve(Object.freeze({
          status: code === null ? 1 : code,
          loggedIn: payload && payload.loggedIn === true,
          authMethod: payload && typeof payload.authMethod === 'string' ? payload.authMethod : null,
          apiProvider: payload && typeof payload.apiProvider === 'string' ? payload.apiProvider : null,
        }));
      });
    });
  } catch (error) {
    token = null;
    throw error;
  }
}

function canonicalRepositoryRoot() {
  if (process.env.NODE_ENV === 'test' && process.env.AEGIS_TEST_CANONICAL_ROOT) {
    return fs.realpathSync(process.env.AEGIS_TEST_CANONICAL_ROOT);
  }
  return fs.realpathSync(ROOT);
}

function resolveApprovedPacket(run, worktree) {
  if (!run || typeof run.packet !== 'string' || !run.packet.trim()) {
    throw new Error('run has no approved packet; refusing to infer filesystem authority');
  }
  const worktreeReal = fs.realpathSync(worktree || (run.worktree && run.worktree.path));
  const tmpRoot = fs.realpathSync(os.tmpdir());
  let packetPath;
  let canonicalPacketPath;
  let packetBytes;
  if (path.isAbsolute(run.packet)) {
    packetPath = fs.realpathSync(run.packet);
    const testPacket = process.env.NODE_ENV === 'test' &&
      (packetPath === tmpRoot || packetPath.startsWith(tmpRoot + path.sep));
    if (!testPacket) {
      const packetsRoot = fs.realpathSync(PACKETS_DIR);
      if (packetPath !== packetsRoot && !packetPath.startsWith(packetsRoot + path.sep)) {
        throw new Error('approved packet must resolve inside builder-control/packets');
      }
    }
    canonicalPacketPath = packetPath;
    packetBytes = fs.readFileSync(packetPath);
  } else {
    const relative = exactRelativePath(run.packet, 'run packet');
    const canonicalRoot = canonicalRepositoryRoot();
    const canonicalPacketsRoot = fs.realpathSync(path.join(canonicalRoot, 'builder-control', 'packets'));
    const canonicalCandidate = path.resolve(canonicalRoot, relative);
    if (fs.lstatSync(canonicalCandidate).isSymbolicLink()) {
      throw new Error('canonical approved packet may not be a symbolic link');
    }
    canonicalPacketPath = fs.realpathSync(canonicalCandidate);
    if (canonicalPacketPath !== canonicalPacketsRoot &&
        !canonicalPacketPath.startsWith(canonicalPacketsRoot + path.sep)) {
      throw new Error('canonical approved packet must resolve inside builder-control/packets');
    }
    const worktreeCandidate = path.resolve(worktreeReal, relative);
    if (fs.lstatSync(worktreeCandidate).isSymbolicLink()) {
      throw new Error('worktree approved packet may not be a symbolic link');
    }
    packetPath = fs.realpathSync(worktreeCandidate);
    if (packetPath !== worktreeReal && !packetPath.startsWith(worktreeReal + path.sep)) {
      throw new Error('worktree approved packet escapes the isolated worktree');
    }
    if (!fs.statSync(canonicalPacketPath).isFile() || !fs.statSync(packetPath).isFile()) {
      throw new Error('approved packet must be a regular file');
    }
    const canonicalBytes = fs.readFileSync(canonicalPacketPath);
    packetBytes = fs.readFileSync(packetPath);
    const canonicalDigest = sha256(canonicalBytes);
    const worktreeDigest = sha256(packetBytes);
    if (canonicalDigest !== worktreeDigest) {
      throw new Error('worktree approved packet digest does not match canonical approved packet');
    }
  }
  if (!fs.statSync(packetPath).isFile()) throw new Error('approved packet must be a file');
  const packetSha256 = sha256(packetBytes);
  const packet = JSON.parse(packetBytes.toString('utf8'));
  if (!packet || packet.agentId !== 'claude-code' || typeof packet.packetId !== 'string' || !packet.packetId ||
      !Array.isArray(packet.filesAllowed) || packet.filesAllowed.length === 0) {
    throw new Error('approved packet is malformed or does not authorize claude-code');
  }
  // Production runs carry the exact packet generation accepted at intake. The
  // detached worker is the final process that turns packet bytes into OS write
  // authority, so it must independently enforce that frozen coordinate rather
  // than trusting the mutable path observed by the launcher.
  const coordinate = run.packetCoordinate;
  const coordinateRequired = !path.isAbsolute(run.packet);
  if (coordinateRequired || coordinate !== undefined) {
    if (!coordinate || coordinate.path !== run.packet ||
        !/^[0-9a-f]{64}$/.test(coordinate.sha256 || '') ||
        typeof coordinate.packetId !== 'string' || !coordinate.packetId) {
      throw new Error('run has no complete immutable intake packet coordinate');
    }
    if (coordinate.sha256 !== packetSha256 || coordinate.packetId !== packet.packetId) {
      throw new Error('approved packet path, sha256, or packetId changed after objective intake');
    }
  }
  return Object.freeze({ packetPath, canonicalPacketPath, packetSha256, packet,
    packetBytes: Buffer.from(packetBytes) });
}

function exactRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') ||
      path.isAbsolute(value) || /[*?\[\]{}]/.test(value) || path.posix.normalize(value) !== value ||
      value === '.' || value.endsWith('/') || value.startsWith('../')) {
    throw new Error(`${label} is not an exact worktree-relative path: ${String(value)}`);
  }
  return value;
}

function globRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') ||
      path.isAbsolute(value) || /[?\[\]{}]/.test(value) || !value.includes('*') ||
      path.posix.normalize(value) !== value || value === '.' || value.endsWith('/') ||
      value.startsWith('../') || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} is not a supported worktree-relative * or ** glob: ${String(value)}`);
  }
  return value;
}

function expandExistingGlob(worktreeReal, pattern, label) {
  globRelativePath(pattern, label);
  const segments = pattern.split('/');
  const firstGlob = segments.findIndex((segment) => segment.includes('*'));
  const prefix = segments.slice(0, firstGlob).join('/');
  const rootCandidate = path.resolve(worktreeReal, prefix || '.');
  let rootReal;
  try { rootReal = fs.realpathSync(rootCandidate); }
  catch { throw new Error(`${label} static prefix is missing: ${pattern}`); }
  if (rootReal !== worktreeReal && !rootReal.startsWith(worktreeReal + path.sep)) {
    throw new Error(`${label} static prefix escapes the isolated worktree: ${pattern}`);
  }
  if (!fs.statSync(rootReal).isDirectory()) {
    throw new Error(`${label} static prefix is not a directory: ${pattern}`);
  }
  const matches = [];
  const pending = [rootReal];
  let inspected = 0;
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++inspected > 10000) throw new Error(`${label} expands beyond the 10000-entry safety bound: ${pattern}`);
      const candidate = path.join(directory, entry.name);
      const relative = path.relative(worktreeReal, candidate).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        if (PACKET_TOOLS.globMatch(pattern, relative) || entry.isDirectory()) {
          throw new Error(`${label} matched or traversed a symbolic link: ${relative}`);
        }
        continue;
      }
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && PACKET_TOOLS.globMatch(pattern, relative)) matches.push(relative);
    }
  }
  if (!matches.length) throw new Error(`${label} matched no existing regular files: ${pattern}`);
  return matches.sort();
}

function existingWorktreeFile(worktreeReal, value, label) {
  exactRelativePath(value, label);
  const candidate = path.resolve(worktreeReal, value);
  let real;
  try { real = fs.realpathSync(candidate); }
  catch { throw new Error(`${label} is missing or cannot resolve safely: ${value}`); }
  if (real !== worktreeReal && !real.startsWith(worktreeReal + path.sep)) {
    throw new Error(`${label} escapes the isolated worktree: ${value}`);
  }
  if (!fs.statSync(real).isFile()) throw new Error(`${label} must resolve to a file: ${value}`);
  return path.relative(worktreeReal, real).split(path.sep).join('/');
}

function declaredCheckEntrypoint(command) {
  if (typeof command !== 'string' || !command.trim() || command.includes('\0')) {
    throw new Error('packet testsRequired entry must be a non-empty command string');
  }
  const normalized = command.trim();
  if (normalized === 'git diff --check') return null;
  const testMatch = normalized.match(/^node --test ([A-Za-z0-9_./-]+\.test\.cjs)$/);
  if (testMatch) return exactRelativePath(testMatch[1], 'packet testsRequired input');
  // `--host-only` is a fixed, test-owned mode used by the canonical hosting
  // suite.  It is not caller-selected process authority: no other flag, value,
  // or second entrypoint is accepted here.  Keep this parser aligned with the
  // executable packet contract so deriving the worker's read allowlist cannot
  // reject a packet that the check authority itself is required to execute.
  const hostOnlyMatch = normalized.match(/^node ([A-Za-z0-9_./-]+\.test\.cjs) --host-only$/);
  if (hostOnlyMatch) return exactRelativePath(hostOnlyMatch[1], 'packet testsRequired input');
  const match = normalized.match(/^node(?:\s+--check)?\s+([A-Za-z0-9_./-]+\.(?:cjs|mjs|js|json))$/);
  if (!match) {
    throw new Error(`packet testsRequired entry is not an approved deterministic check form: ${command}`);
  }
  return match[1];
}

function resolveLocalModule(worktreeReal, importer, request) {
  const base = path.resolve(path.dirname(importer), request);
  const candidates = [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`, `${base}.json`,
    path.join(base, 'index.js'), path.join(base, 'index.cjs'), path.join(base, 'index.mjs'), path.join(base, 'index.json')];
  for (const candidate of candidates) {
    try {
      const real = fs.realpathSync(candidate);
      if (real !== worktreeReal && !real.startsWith(worktreeReal + path.sep)) {
        throw new Error(`declared check dependency escapes the isolated worktree: ${request}`);
      }
      if (fs.statSync(real).isFile()) return real;
    } catch (error) {
      if (error && /escapes the isolated worktree/.test(error.message)) throw error;
    }
  }
  throw new Error(`declared check dependency is missing: ${request} from ${path.relative(worktreeReal, importer)}`);
}

function literalLocalImports(source) {
  const found = [];
  const length = source.length;
  const skipQuoted = (at) => {
    const quote = source[at];
    for (let i = at + 1; i < length; i++) {
      if (source[i] === '\\') { i++; continue; }
      if (source[i] === quote) return i + 1;
    }
    return length;
  };
  const skipTrivia = (at) => {
    let i = at;
    while (i < length) {
      if (/\s/.test(source[i])) { i++; continue; }
      if (source[i] === '/' && source[i + 1] === '/') {
        i += 2; while (i < length && source[i] !== '\n') i++; continue;
      }
      if (source[i] === '/' && source[i + 1] === '*') {
        i += 2; while (i < length && !(source[i] === '*' && source[i + 1] === '/')) i++;
        i = Math.min(length, i + 2); continue;
      }
      break;
    }
    return i;
  };
  const readLiteral = (at) => {
    if (source[at] !== "'" && source[at] !== '"') return null;
    const quote = source[at]; let value = '';
    for (let i = at + 1; i < length; i++) {
      if (source[i] === '\\') return null;
      if (source[i] === quote) return { value, end: i + 1 };
      value += source[i];
    }
    return null;
  };
  for (let i = 0; i < length;) {
    if (source[i] === "'" || source[i] === '"' || source[i] === '`') { i = skipQuoted(i); continue; }
    if (source[i] === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) { i = skipTrivia(i); continue; }
    if (!/[A-Za-z_$]/.test(source[i])) { i++; continue; }
    const start = i++;
    while (i < length && /[A-Za-z0-9_$]/.test(source[i])) i++;
    const identifier = source.slice(start, i);
    if (identifier !== 'require' && identifier !== 'import') continue;
    let cursor = skipTrivia(i);
    if (source[cursor] === '(') cursor = skipTrivia(cursor + 1);
    let literal = readLiteral(cursor);
    if (!literal && identifier === 'import') {
      const statementEnd = source.indexOf('\n', cursor) === -1 ? length : source.indexOf('\n', cursor);
      const from = source.slice(cursor, statementEnd).match(/\bfrom\s*$/);
      if (from) literal = readLiteral(skipTrivia(cursor + from.index + from[0].length));
      if (!literal) {
        const fromMatch = source.slice(cursor, statementEnd).match(/\bfrom\s*(['"])/);
        if (fromMatch) literal = readLiteral(cursor + fromMatch.index + fromMatch[0].length - 1);
      }
    }
    if (literal && /^\.{1,2}\//.test(literal.value)) found.push(literal.value);
  }
  return [...new Set(found)].sort();
}

function collectLocalDependencies(worktreeReal, entryRelative) {
  const pending = [path.resolve(worktreeReal, entryRelative)];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    const real = fs.realpathSync(file);
    if (seen.has(real)) continue;
    if (real !== worktreeReal && !real.startsWith(worktreeReal + path.sep)) {
      throw new Error(`declared check dependency escapes the isolated worktree: ${file}`);
    }
    if (!fs.statSync(real).isFile()) throw new Error(`declared check dependency must be a file: ${file}`);
    seen.add(real);
    if (!/\.(?:cjs|mjs|js)$/.test(real)) continue;
    const source = fs.readFileSync(real, 'utf8');
    const requests = literalLocalImports(source);
    for (const request of requests) pending.push(resolveLocalModule(worktreeReal, real, request));
  }
  return [...seen].map((value) => path.relative(worktreeReal, value).split(path.sep).join('/')).sort();
}

function derivePacketAllowlists(run, worktree) {
  const worktreeReal = fs.realpathSync(worktree);
  const { packetPath, packet } = resolveApprovedPacket(run, worktreeReal);
  const readPaths = [];
  const writePaths = [];
  const isInsideWorktree = (value) => value === worktreeReal || value.startsWith(worktreeReal + path.sep);
  if (!isInsideWorktree(packetPath)) {
    throw new Error('approved packet must be inside the isolated worktree so it can be granted read-only authority');
  }
  readPaths.push(path.relative(worktreeReal, packetPath).split(path.sep).join('/'));
  if (!Array.isArray(packet.sourceOfTruth) || packet.sourceOfTruth.length === 0) {
    throw new Error('approved packet must declare at least one sourceOfTruth file');
  }
  for (const value of packet.sourceOfTruth) {
    readPaths.push(existingWorktreeFile(worktreeReal, value, 'packet sourceOfTruth entry'));
  }
  if (!Array.isArray(packet.testsRequired) || packet.testsRequired.length === 0) {
    throw new Error('approved packet must declare at least one testsRequired check');
  }
  for (const command of packet.testsRequired) {
    const entry = declaredCheckEntrypoint(command);
    if (!entry) continue;
    const entryRelative = existingWorktreeFile(worktreeReal, entry, 'packet testsRequired input');
    readPaths.push(...collectLocalDependencies(worktreeReal, entryRelative));
  }
  for (const value of packet.filesAllowed) {
    if (/[*?\[\]{}]/.test(value)) {
      const matches = expandExistingGlob(worktreeReal, value, 'packet filesAllowed entry');
      readPaths.push(...matches);
      writePaths.push(...matches);
      continue;
    }
    exactRelativePath(value, 'packet filesAllowed entry');
    const candidate = path.resolve(worktreeReal, value);
    try { fs.lstatSync(candidate); }
    catch (e) {
      if (!e || e.code !== 'ENOENT') {
        throw new Error(`packet filesAllowed path cannot be inspected safely: ${value}`);
      }
      const parent = path.dirname(candidate);
      let parentReal;
      try { parentReal = fs.realpathSync(parent); }
      catch { throw new Error(`packet filesAllowed parent is missing from the isolated worktree: ${value}`); }
      if (!isInsideWorktree(parentReal)) {
        throw new Error(`packet filesAllowed parent escapes the isolated worktree: ${value}`);
      }
      if (!fs.statSync(parentReal).isDirectory()) {
        throw new Error(`packet filesAllowed parent is not a directory: ${value}`);
      }
      writePaths.push(value);
      continue;
    }
    let real;
    try { real = fs.realpathSync(candidate); }
    catch { throw new Error(`packet filesAllowed path is missing or cannot resolve safely: ${value}`); }
    if (!isInsideWorktree(real)) {
      throw new Error(`packet filesAllowed path escapes the isolated worktree: ${value}`);
    }
    if (!fs.statSync(real).isFile()) {
      throw new Error(`packet filesAllowed path must be a file or an exact new leaf: ${value}`);
    }
    readPaths.push(value);
    writePaths.push(value);
  }
  return Object.freeze({
    packetId: packet.packetId,
    packetPath,
    readPaths: [...new Set(readPaths)].sort(),
    writePaths: [...new Set(writePaths)].sort(),
  });
}

function isDeterministicTestFixture(run, executable) {
  if (process.env.NODE_ENV !== 'test' || process.env.AEGIS_TEST_CONTAINMENT_MODE !== 'DETERMINISTIC_PROFILE_ONLY' ||
      !run || !run.worktree || typeof run.packet !== 'string') return false;
  const tmpRoot = fs.realpathSync(os.tmpdir());
  const insideTmp = (value) => {
    try { const real = fs.realpathSync(value); return real === tmpRoot || real.startsWith(tmpRoot + path.sep); }
    catch { return false; }
  };
  const packetIsFixture = path.isAbsolute(run.packet) ? insideTmp(run.packet) :
    Boolean(process.env.AEGIS_TEST_CANONICAL_ROOT && insideTmp(process.env.AEGIS_TEST_CANONICAL_ROOT));
  return packetIsFixture && insideTmp(run.worktree.path) && insideTmp(executable);
}

function prepareRunContainment(run, executable, env) {
  const allowlists = derivePacketAllowlists(run, run.worktree.path);
  const oauthTokenFileDescriptor = Object.prototype.hasOwnProperty.call(env,
    'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR')
    ? env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR : null;
  if (oauthTokenFileDescriptor !== null && oauthTokenFileDescriptor !== CLAUDE_OAUTH_TOKEN_FILE_DESCRIPTOR) {
    throw invalidLaunch(`Claude OAuth token descriptor must be ${CLAUDE_OAUTH_TOKEN_FILE_DESCRIPTOR}`);
  }
  let prepared;
  if (isDeterministicTestFixture(run, executable)) {
    const profile = CONTAINMENT.buildMacSandboxProfile({
      root: run.worktree.path,
      executable,
      readPaths: allowlists.readPaths.map((value) => path.resolve(run.worktree.path, value)),
      writePaths: allowlists.writePaths.map((value) => path.resolve(run.worktree.path, value)),
    });
    prepared = { command: CONTAINMENT.sandboxedCommand(profile), env: CONTAINMENT.strictEnvironment(env), profile };
  } else {
    const productionGrok = typeof env.GROK_HOME === 'string' && typeof env.HOME === 'string' &&
      env.GROK_HOME === path.join(env.HOME, '.grok') && executable === resolveGrokExecutable();
    const productionClaude = !productionGrok && executable === resolveClaudeExecutable();
    const subscriptionConfigs = productionClaude ? CONTAINMENT.claudeSubscriptionConfigPaths() : [];
    const disposableRuntimeDir = productionClaude ? CONTAINMENT.claudeDisposableRuntimeDir() : null;
    const claudeNativeRuntime = productionClaude
      ? CONTAINMENT.claudeNativeRuntimePaths(run.worktree.path) : null;
    // The parent control process reads the one exact Claude credential before
    // containment and hands it to the pinned client on descriptor 3. The
    // contained model process therefore receives no Keychain helper authority.
    const claudeKeychainHelper = null;
    prepared = CONTAINMENT.prepareWorkerContainment({
      worktree: run.worktree.path,
      executable,
      packetReadPaths: allowlists.readPaths,
      packetWritePaths: allowlists.writePaths,
      claudeSubscriptionConfigReadPaths: subscriptionConfigs,
      claudeDisposableRuntimeDirReadPath: disposableRuntimeDir,
      claudeNativeRuntime,
      claudeKeychainHelper,
      claudeOAuthTokenFileDescriptor: oauthTokenFileDescriptor,
      grokDisposableHome: productionGrok ? env.HOME : null,
      env,
    });
  }
  return Object.freeze({ ...prepared, allowlists });
}

function testLaunchInternals(value) {
  if (value === undefined) return Object.freeze({ spawnImpl: spawn, forceContainedCommand: false });
  if (process.env.NODE_ENV !== 'test' || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidLaunch('child-process instrumentation is test-only');
  }
  const unknown = Object.keys(value).filter((key) => !['spawn', 'forceContainedCommand'].includes(key));
  if (unknown.length || typeof value.spawn !== 'function' ||
      (value.forceContainedCommand !== undefined && value.forceContainedCommand !== true)) {
    throw invalidLaunch('invalid child-process instrumentation');
  }
  return Object.freeze({
    spawnImpl: value.spawn,
    forceContainedCommand: value.forceContainedCommand === true,
  });
}

function launchWorker({ runId, attemptId, launchSpec, timeoutSec = 900 }, testInternals) {
  const normalized = normalizeLaunchSpec(launchSpec);
  const boundedTimeout = normalizeTimeoutSec(timeoutSec);
  const { spawnImpl } = testLaunchInternals(testInternals);
  const launchSha256 = launchDigest(normalized);
  const controlDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-control-')));
  fs.chmodSync(controlDir, 0o700);
  const controlStat = fs.statSync(controlDir);
  const directoryIdentity = Object.freeze({ dev: Number(controlStat.dev), ino: Number(controlStat.ino) });
  const controlSecret = crypto.randomBytes(32).toString('hex');
  const payloadPath = path.join(os.tmpdir(), `aegis-worker-${crypto.randomBytes(12).toString('hex')}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify({
    runId, attemptId, launchSpec: normalized, launchSha256, timeoutSec: boundedTimeout,
    control: { dir: controlDir, secret: controlSecret, directoryIdentity },
  }), { mode: 0o600 });
  let child;
  try {
    child = spawnImpl(process.execPath, [__filename, '--execute', payloadPath, runId, attemptId], {
      cwd: HERE,
      detached: true,
      shell: false,
      stdio: 'ignore',
      env: workerEnvironment(),
    });
  } catch (e) {
    try { fs.unlinkSync(payloadPath); } catch {}
    try { fs.rmdirSync(controlDir); } catch {}
    throw e;
  }
  child.unref();
  return Object.freeze({
    workerPid: child.pid,
    processGroupId: child.pid,
    launchSha256,
    payloadPath,
    control: Object.freeze({ dir: controlDir, secret: controlSecret, secretSha256: sha256(controlSecret), directoryIdentity }),
  });
}

function launchClaudeProcess(run, launchSpec, childEnv, testInternals) {
  const normalized = normalizeLaunchSpec(launchSpec);
  const { spawnImpl, forceContainedCommand } = testLaunchInternals(testInternals);
  const claudeExecutable = resolveClaudeExecutable();
  const productionClaude = !(process.env.NODE_ENV === 'test' && process.env.AEGIS_TEST_CLAUDE_EXECUTABLE);
  assertClaudeModelSandboxPolicy();
  const claudeArgv = [
    '--print',
    ...CLAUDE_STREAM_PROGRESS_ARGV,
    '--model', normalized.model,
    '--permission-mode', 'acceptEdits',
    '--settings', JSON.stringify(CLAUDE_SETTINGS),
    '--tools', CLAUDE_FILE_TOOLS.join(','),
    '--allowedTools', CLAUDE_FILE_TOOLS.join(','),
    '--disallowedTools', CLAUDE_DISALLOWED_TOOLS.join(','),
    '--safe-mode',
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
  if (process.env.NODE_ENV === 'test' && process.env.FAKE_CLAUDE_PREFLIGHT_AUTH_FAILURE === '1') {
    throw claudeReauthRequired('the Keychain access token is expired or too close to expiry');
  }
  let oauthToken = productionClaude ? readClaudeOAuthToken() : null;
  let contained;
  let command;
  let authorizedWriteBaselineSha256;
  // The deterministic mode exists only for lifecycle tests executing inside
  // an already-sandboxed CI host. Instrumented tests can retain the real
  // containment command without executing it.
  let child;
  try {
    contained = prepareRunContainment(run, claudeExecutable, productionClaude
      ? { ...childEnv, CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: CLAUDE_OAUTH_TOKEN_FILE_DESCRIPTOR }
      : childEnv);
    authorizedWriteBaselineSha256 = authorizedWriteDigest(contained.allowlists.writePaths, run.worktree.path);
    command = contained.command;
    if (isDeterministicTestFixture(run, claudeExecutable) && !forceContainedCommand) {
      command = { bin: claudeExecutable, argv: [] };
    }
    child = spawnImpl(command.bin, [...command.argv, ...claudeArgv], {
      cwd: run.worktree.path,
      env: contained.env,
      detached: false,
      shell: false,
      stdio: productionClaude ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    });
    if (!child.stdin || typeof child.stdin.end !== 'function') {
      throw new Error('Claude prompt stdin was not inherited');
    }
    child.stdin.end(normalized.prompt);
    if (productionClaude) attachClaudeOAuthToken(child, oauthToken);
  } catch (error) {
    try { if (child && typeof child.kill === 'function') child.kill('SIGKILL'); } catch { /* fail closed */ }
    throw error;
  } finally {
    oauthToken = null;
  }
  return Object.freeze({
    child, contained, claudeExecutable, command: Object.freeze({ bin: command.bin, argv: Object.freeze([...command.argv]) }),
    claudeArgv: Object.freeze(claudeArgv),
    authorizedWriteBaselineSha256,
    enforceMutationProof: productionClaude,
  });
}

function grokArgv(launchSpec) {
  const normalized = normalizeLaunchSpec(launchSpec);
  if (normalized.provider !== 'grok-subscription') {
    throw invalidLaunch('Grok argv requires the grok-subscription provider');
  }
  return Object.freeze([
    '--single', normalized.prompt,
    '--model', normalized.model,
    '--permission-mode', 'acceptEdits',
    '--output-format', 'plain',
    '--no-subagents',
    '--verbatim',
    '--no-plan',
    '--disable-web-search',
    '--tools', GROK_FILE_TOOLS.join(','),
    '--disallowed-tools', GROK_DISALLOWED_TOOLS.join(','),
    '--max-turns', String(GROK_MAX_TURNS),
  ]);
}

function prepareGrokLaunch(run, launchSpec, disposableHome) {
  const normalized = normalizeLaunchSpec(launchSpec);
  if (normalized.provider !== 'grok-subscription') {
    throw invalidLaunch('Grok launch preparation requires the grok-subscription provider');
  }
  const executable = resolveGrokExecutable();
  const env = grokEnvironment(disposableHome);
  const contained = prepareRunContainment(run, executable, env);
  const argv = grokArgv(normalized);
  const command = Object.freeze({
    bin: contained.command.bin,
    argv: Object.freeze([...contained.command.argv, ...argv]),
  });
  return Object.freeze({
    provider: normalized.provider,
    model: normalized.model,
    executable,
    argv,
    command,
    env: contained.env,
    contained,
    authorizedWriteBaselineSha256: authorizedWriteDigest(
      contained.allowlists.writePaths, run.worktree.path),
  });
}

function createGrokDisposableHome() {
  const home = fs.realpathSync(fs.mkdtempSync(GROK_HOME_PREFIX));
  fs.chmodSync(home, 0o700);
  fs.mkdirSync(path.join(home, '.grok'), { mode: 0o700 });
  fs.mkdirSync(path.join(home, 'tmp'), { mode: 0o700 });
  return home;
}

/**
 * Execute the one authorized handoff.
 *
 * The replacement inherits the exact run: same runId, same objective, same
 * approved packet, same isolated worktree and the same prompt bytes. It is
 * launched only after the original group drained, joins THIS worker's process
 * group so the existing termination proof covers it too, and is bounded by the
 * same wall clock the original attempt carried. Nothing here re-selects a
 * provider or model — both arrive already decided by the handoff authority.
 */
async function executeFailoverBuilder(run, authorized, timeoutMs, testInternals) {
  const { spawnImpl } = testLaunchInternals(testInternals);
  const normalized = normalizeLaunchSpec(authorized.launchSpec);
  const startedAt = nowIso();
  const disposableHome = createGrokDisposableHome();
  let child = null;
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  try {
    const prepared = prepareGrokLaunch(run, normalized, disposableHome);
    const productionGrok = !(process.env.NODE_ENV === 'test' && process.env.AEGIS_TEST_GROK_EXECUTABLE);
    child = spawnImpl(prepared.command.bin, [...prepared.command.argv], {
      cwd: run.worktree.path,
      env: prepared.env,
      detached: false,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (child.stdout) child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-24000); });
    if (child.stderr) child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-24000); });
    const childIdentity = child.pid ? { pid: child.pid } : null;
    const outcome = new Promise((resolve) => {
      child.once('error', (error) => resolve({ exit: 127, signal: null, error }));
      child.once('close', (code, signal) =>
        resolve({ exit: code === null ? (timedOut ? 124 : 1) : code, signal, error: null }));
    });
    let timeout;
    const reached = new Promise((resolve) => { timeout = setTimeout(resolve, timeoutMs); });
    const first = await Promise.race([
      outcome.then((value) => ({ kind: 'child', value })),
      reached.then(() => ({ kind: 'timeout' })),
    ]);
    let result;
    let terminationEvidence = null;
    if (first.kind === 'child') {
      result = first.value;
      terminationEvidence = observeOwnedGroupDrain(childIdentity, true);
    } else {
      timedOut = true;
      terminationEvidence = await terminateOwnedChild(outcome, childIdentity, 1000);
      result = { exit: 124, signal: null, error: null };
    }
    clearTimeout(timeout);
    const authorizedMutationObserved = authorizedWriteDigest(
      prepared.contained.allowlists.writePaths, run.worktree.path) !==
      prepared.authorizedWriteBaselineSha256;
    let exit = result.exit;
    // The same honesty rule the original builder is held to: exit 0 with no
    // authorized file change is not a completed build.
    if (exit === 0 && productionGrok && !authorizedMutationObserved) exit = 3;
    return Object.freeze({
      provider: normalized.provider,
      model: normalized.model,
      startedAt,
      endedAt: nowIso(),
      exit,
      signal: result.signal || null,
      timedOut,
      authorizedMutationObserved,
      terminationEvidence,
      stdoutTail: boundedTail(stdout),
      stderrTail: boundedTail(result.error ? `${stderr}\n${result.error.message}` : stderr),
    });
  } finally {
    try { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
    catch { /* the replacement may already be gone */ }
    try { fs.rmSync(disposableHome, { recursive: true, force: true }); } catch { /* disposable */ }
  }
}

function assertLaunchBinding(payload, run) {
  const payloadSpec = normalizeLaunchSpec(payload && payload.launchSpec);
  const runSpec = normalizeLaunchSpec(run && run.build && run.build.launchSpec);
  const payloadDigest = launchDigest(payloadSpec);
  const runDigest = launchDigest(runSpec);
  if (!payload || typeof payload.launchSha256 !== 'string' ||
      payload.launchSha256 !== payloadDigest ||
      !run || !run.build || typeof run.build.launchSha256 !== 'string' ||
      run.build.launchSha256 !== runDigest ||
      payloadDigest !== runDigest ||
      JSON.stringify(payloadSpec) !== JSON.stringify(runSpec)) {
    const error = new Error('worker payload launchSpec does not match its canonical launch record');
    error.code = 'WORKER-LAUNCH-BINDING-MISMATCH';
    throw error;
  }
  return payloadSpec;
}

function assertControlBinding(payload, run) {
  const supplied = payload && payload.control;
  const recorded = run && run.build && run.build.control;
  if (!supplied || !recorded || typeof supplied.dir !== 'string' || typeof supplied.secret !== 'string' ||
      supplied.dir !== recorded.dir || sha256(supplied.secret) !== recorded.secretSha256 ||
      supplied.secret !== recorded.secret || JSON.stringify(supplied.directoryIdentity) !== JSON.stringify(recorded.directoryIdentity)) {
    const error = new Error('worker control capability does not match its canonical launch record');
    error.code = 'WORKER-CONTROL-BINDING-MISMATCH';
    throw error;
  }
  const dirReal = fs.realpathSync(supplied.dir);
  const dirStat = fs.statSync(dirReal);
  if (fs.lstatSync(supplied.dir).isSymbolicLink() || (dirStat.mode & 0o777) !== 0o700 ||
      Number(dirStat.dev) !== supplied.directoryIdentity.dev || Number(dirStat.ino) !== supplied.directoryIdentity.ino) {
    const error = new Error('worker control directory is not a private real directory');
    error.code = 'WORKER-CONTROL-DIRECTORY-UNSAFE';
    throw error;
  }
  return Object.freeze({ dir: dirReal, secret: supplied.secret, directoryIdentity: supplied.directoryIdentity });
}

async function terminateOwnedChild(childOutcome, childIdentity, graceMs = CANCEL_CLOSE_GRACE_MS) {
  const deadline = Date.now() + graceMs;
  const ownTermHandler = () => {};
  process.on('SIGTERM', ownTermHandler);
  let signalError = null;
  try { process.kill(-process.pid, 'SIGTERM'); }
  catch (error) { if (error.code !== 'ESRCH') signalError = error; }
  const close = await Promise.race([
    childOutcome,
    new Promise((done) => setTimeout(() => done(null), Math.max(0, deadline - Date.now()))),
  ]);
  let groupMembers = null;
  let processGroupDrained = false;
  if (close && !signalError) {
    // Allow already-delivered SIGTERM handlers one short quiescence turn, then
    // take one bounded group-membership snapshot. Repeated ps subprocesses can
    // themselves consume the control response budget and hide the precise
    // fail-closed reason behind a generic mailbox timeout.
    const remaining = Math.max(0, deadline - Date.now());
    if (remaining > 0) await new Promise((done) => setTimeout(done, Math.min(25, remaining)));
    groupMembers = processGroupMembers(process.pid, Math.max(25, Math.min(250, deadline - Date.now())));
    processGroupDrained = Array.isArray(groupMembers) &&
      groupMembers.every((pid) => pid === process.pid);
  }
  process.removeListener('SIGTERM', ownTermHandler);
  const terminated = Boolean(close) && !signalError && processGroupDrained;
  let reason = 'EXACT_CHILD_CLOSE_AND_GROUP_DRAIN_OBSERVED';
  if (signalError) reason = 'GROUP_SIGNAL_FAILED';
  else if (!close) reason = 'CHILD_CLOSE_UNVERIFIED';
  else if (groupMembers === null) reason = 'GROUP_MEMBERSHIP_UNVERIFIED';
  else if (!processGroupDrained) reason = 'GROUP_STILL_ALIVE';
  return {
    processGroupId: process.pid, terminated,
    childCloseObserved: Boolean(close), signal: 'SIGTERM', exit: close ? close.exit : null,
    processGroupDrained, remainingProcessGroupMembers: Array.isArray(groupMembers)
      ? groupMembers.filter((pid) => pid !== process.pid) : null,
    reason, observedAt: nowIso(), childIdentity,
  };
}

function monitorCancellation(control, attemptId, child, childOutcome, childIdentity, state = {}) {
  const requestPath = path.join(control.dir, 'cancel-request.json');
  const responsePath = path.join(control.dir, 'cancel-response.json');
  return new Promise((resolve) => {
    let handling = false;
    const poll = setInterval(async () => {
      if (handling || !fs.existsSync(requestPath)) return;
      handling = true;
      let request;
      try {
        const currentDirStat = fs.statSync(control.dir);
        if (fs.realpathSync(control.dir) !== control.dir || fs.lstatSync(control.dir).isSymbolicLink() ||
            Number(currentDirStat.dev) !== control.directoryIdentity.dev ||
            Number(currentDirStat.ino) !== control.directoryIdentity.ino ||
            fs.lstatSync(requestPath).isSymbolicLink() || !fs.statSync(requestPath).isFile()) {
          throw new Error('control mailbox replacement detected');
        }
        request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
        const body = request && request.body;
        if (!body || body.attemptId !== attemptId || !validControlMac(control.secret, body, request.mac) ||
            !Number.isFinite(body.expiresAt) || Date.now() > body.expiresAt) {
          throw new Error('invalid or expired cancellation capability');
        }
      } catch (error) {
        const body = { attemptId, cancellationId: request && request.body && request.body.cancellationId || null,
          terminated: false, childCloseObserved: false, reason: 'CONTROL_AUTHENTICATION_FAILED',
          observedAt: nowIso(), childIdentity };
        try { atomicPrivateJson(responsePath, { body, mac: controlMac(control.secret, body) }); } catch {}
        handling = false;
        return;
      }
      clearInterval(poll);
      // Mark ownership before signalling the group. The exact child close can
      // otherwise win the outer Promise.race while this handler is still
      // proving descendant drainage, causing the worker to exit before it
      // writes the signed cancellation response.
      state.requested = true;
      const body = { attemptId, cancellationId: request.body.cancellationId,
        ...(await terminateOwnedChild(childOutcome, childIdentity)) };
      try { atomicPrivateJson(responsePath, { body, mac: controlMac(control.secret, body) }); }
      catch { body.terminated = false; body.reason = 'CONTROL_RESPONSE_WRITE_FAILED'; }
      resolve(body);
    }, CONTROL_POLL_MS);
    poll.unref();
  });
}

function waitForLaunchRecord(R, runId, attemptId, expectedPid) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const run = R.loadRun(runId);
    if (run.build && run.build.attemptId !== attemptId) {
      const e = new Error(`worker attempt ${attemptId} lost ownership before execution`);
      e.code = 'STALE-WORKER-ATTEMPT';
      throw e;
    }
    if (run.state === 'BUILDING' && run.build && run.build.attemptId === attemptId && run.build.workerPid === expectedPid) return run;
    sleepMs(20);
  }
  throw new Error('worker launch metadata was not persisted before execution');
}

function updateBuild(R, runId, attemptId, patch) {
  if (process.env.NODE_ENV === 'test' && process.env.FAKE_INITIAL_UPDATE_FAILURE === '1' &&
      patch && patch.workerState === 'RUNNING') {
    delete process.env.FAKE_INITIAL_UPDATE_FAILURE;
    throw new Error('test initial worker-attempt update failure');
  }
  return R.updateWorkerAttempt(runId, attemptId, process.pid, patch);
}

async function failOwnedAttempt(R, payload, error, childOutcome = null, childIdentity = null) {
  let terminationEvidence = null;
  if (childOutcome) {
    try { terminationEvidence = await terminateOwnedChild(childOutcome, childIdentity, 1000); }
    catch (cleanupError) {
      terminationEvidence = { processGroupId: process.pid, terminated: false,
        error: boundedTail(cleanupError.message), observedAt: nowIso() };
    }
  }
  const message = boundedTail(error && (error.stack || error.message) || error || 'unknown worker bootstrap failure');
  R.transitionWorkerAttempt(payload.runId, payload.attemptId, process.pid, 'BUILD_FAILED',
    'asynchronous worker bootstrap failed', {
      workerState: terminationEvidence && !terminationEvidence.terminated ? 'TERMINATION_UNVERIFIED' : 'BOOTSTRAP_FAILED',
      endedAt: nowIso(), heartbeatAt: nowIso(), exit: 127, bootstrapFailure: true,
      stderrTail: message, terminationEvidence,
      ...(terminationEvidence && !terminationEvidence.terminated ? {
        recovery: {
          reason: 'TERMINATION_UNVERIFIED', observedAt: nowIso(), terminationVerified: false,
          retrySafe: false, abandonmentAllowed: true, attemptId: payload.attemptId,
        },
      } : {}),
    });
  return 127;
}

// Route one provider-owned subscription preflight failure through the same
// handoff classifier, authority and executor as a terminal child failure. This
// path exists only when launchClaudeProcess proved that no model child was
// created, so it can never hide a partial builder mutation or overlap writers.
async function handleProviderOwnedBootstrapFailure(R, payload, run, launchSpec, error, timeoutMs) {
  const failure = classifyBuilderFailure(launchSpec.provider, 127, '', error && error.message, {
    bootstrapFailure: true,
    bootstrapErrorCode: error && error.code,
    childLaunchObserved: false,
  });
  if (!failure) return null;

  const observedDrain = observeOwnedGroupDrain(null, false);
  const originalDrainEvidence = Object.freeze({
    ...observedDrain,
    noChildLaunchObserved: true,
    reason: observedDrain.processGroupDrained
      ? 'NO_MODEL_CHILD_LAUNCHED_AND_PROCESS_GROUP_DRAINED'
      : observedDrain.reason,
  });
  let handoff;
  try {
    handoff = authorizeBuilderFailover({
      launchSpec,
      failure,
      run,
      authorizedMutationObserved: false,
      drainEvidence: originalDrainEvidence,
    });
  } catch (handoffError) {
    handoff = Object.freeze({
      state: 'BLOCKED', executable: false, blockedReason: 'FAILOVER_AUTHORITY_UNAVAILABLE',
      reason: `The builder handoff authority could not be evaluated: ${boundedTail(handoffError.message)}`,
      failureCode: failure.code, fromProvider: launchSpec.provider, toProvider: null,
      toPolicyModel: null, sameProviderRetryAllowed: false, unchangedObjective: true,
    });
  }

  // Persist the original failure and the gate decision before a replacement
  // starts. A worker crash during the replacement can therefore never erase
  // why the original provider was left or the proof that no child existed.
  updateBuild(R, run.runId, payload.attemptId, {
    workerState: handoff && handoff.state === 'AUTHORIZED' ? 'FAILOVER_AUTHORIZED' : 'BOOTSTRAP_FAILED',
    heartbeatAt: nowIso(),
    originalExit: 127,
    bootstrapFailure: true,
    childLaunchObserved: false,
    authorizedMutationObserved: false,
    originalDrainEvidence,
    failure,
    providerSelection: handoff && handoff.toProvider ? {
      provider: handoff.toProvider,
      model: handoff.launchSpec ? handoff.launchSpec.model : null,
      reason: handoff.selectionReason || handoff.reason,
    } : null,
    handoff,
    stderrTail: boundedTail(error && error.message),
  });

  let replacement = null;
  if (handoff && handoff.state === 'AUTHORIZED') {
    try {
      replacement = await executeFailoverBuilder(run, handoff, timeoutMs);
      handoff = Object.freeze({ ...handoff, state: 'COMPLETED', handoffCount: 1 });
    } catch (replacementError) {
      handoff = Object.freeze({
        ...handoff, state: 'FAILED', executable: false, handoffCount: 1,
        reason: `The authorized handoff could not be executed: ${boundedTail(replacementError.message)}`,
      });
    }
  }

  const effectiveExit = replacement ? replacement.exit : 127;
  const fresh = updateBuild(R, run.runId, payload.attemptId, {
    workerState: effectiveExit === 0 ? 'EXITED' : 'FAILED',
    endedAt: nowIso(), heartbeatAt: nowIso(), exit: effectiveExit,
    originalExit: 127, bootstrapFailure: true, childLaunchObserved: false,
    authorizedMutationObserved: replacement ? replacement.authorizedMutationObserved : false,
    originalDrainEvidence, failure,
    providerSelection: handoff && handoff.toProvider ? {
      provider: handoff.toProvider,
      model: handoff.launchSpec ? handoff.launchSpec.model : null,
      reason: handoff.selectionReason || handoff.reason,
    } : null,
    handoff,
    failoverHandoffs: replacement ? 1 : recordedAutomaticHandoffs(run),
    replacement,
    recovery: handoff ? {
      reason: failure.code,
      observedAt: nowIso(),
      terminationVerified: processGroupDrainVerified(originalDrainEvidence),
      retrySafe: false,
      sameProviderRetryAllowed: false,
      providerFailoverRequired: handoff.state !== 'COMPLETED',
      handoffState: handoff.state,
      blockedReason: handoff.blockedReason || null,
      selectedProvider: handoff.toProvider || null,
      selectedModel: handoff.launchSpec ? handoff.launchSpec.model : null,
      attemptId: payload.attemptId,
    } : null,
    stderrTail: boundedTail(error && error.message),
  });
  if (fresh.state === 'BUILDING') {
    const outcomeNote = replacement
      ? `governed failover builder ${replacement.provider} exited ${effectiveExit} after ` +
        `${failure.code} on ${launchSpec.provider}`
      : `provider bootstrap failed with ${failure.code}; governed failover ${handoff && handoff.state || 'UNAVAILABLE'}`;
    R.transitionWorkerAttempt(run.runId, payload.attemptId, process.pid,
      effectiveExit === 0 ? 'BUILT' : 'BUILD_FAILED', outcomeNote);
  }
  return effectiveExit;
}

async function executePayload(payloadPath, expectedRunId, expectedAttemptId) {
  let payload;
  let payloadError = null;
  if (process.env.NODE_ENV === 'test' && process.env.FAKE_CORRUPT_WORKER_PAYLOAD === '1') {
    fs.writeFileSync(payloadPath, '{', { mode: 0o600 });
  }
  if (process.env.NODE_ENV === 'test' && process.env.FAKE_TAMPER_WORKER_PAYLOAD === '1') {
    const tampered = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    tampered.launchSpec = { ...tampered.launchSpec, prompt: `${tampered.launchSpec.prompt} tampered` };
    fs.writeFileSync(payloadPath, JSON.stringify(tampered), { mode: 0o600 });
  }
  if (process.env.NODE_ENV === 'test' && process.env.FAKE_PAYLOAD_IDENTITY_MODE) {
    const tampered = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    if (process.env.FAKE_PAYLOAD_IDENTITY_MODE === 'empty') {
      for (const key of Object.keys(tampered)) delete tampered[key];
    } else if (process.env.FAKE_PAYLOAD_IDENTITY_MODE === 'missing') {
      delete tampered.runId; delete tampered.attemptId;
    } else if (process.env.FAKE_PAYLOAD_IDENTITY_MODE === 'wrong') {
      tampered.runId = `${tampered.runId}-other`;
      tampered.attemptId = `${tampered.attemptId}-other`;
    } else if (process.env.FAKE_PAYLOAD_IDENTITY_MODE === 'wrong-type') {
      tampered.runId = 42; tampered.attemptId = { bad: true };
    }
    fs.writeFileSync(payloadPath, JSON.stringify(tampered), { mode: 0o600 });
  }
  try { payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8')); }
  catch (error) { payloadError = error; payload = { runId: expectedRunId, attemptId: expectedAttemptId }; }
  finally { try { fs.unlinkSync(payloadPath); } catch {} }

  const R = require(RUNTIME);
  const identityValid = payload && typeof payload.runId === 'string' &&
    typeof payload.attemptId === 'string' && payload.runId === expectedRunId &&
    payload.attemptId === expectedAttemptId;
  const identity = { runId: expectedRunId, attemptId: expectedAttemptId };
  const identityError = payloadError || (!identityValid
    ? new Error('worker payload ownership did not match its immutable launch identity') : null);
  // Always locate the canonical attempt using only the immutable CLI
  // identities. Untrusted payload IDs must never strand the owned run or
  // redirect failure evidence to another run.
  let globalLease = null;
  try {
  const run = waitForLaunchRecord(R, expectedRunId, expectedAttemptId, process.pid);
  // Launch metadata is not execution authority by itself. The launcher must
  // also have transferred the one global lifetime lease to this exact process
  // generation before the worker can spawn the governed builder.
  globalLease = R.verifyGlobalWorkerLease(expectedRunId, expectedAttemptId, process.pid);
  if (identityError) return failOwnedAttempt(R, identity, identityError);
  if (!run.worktree || !fs.existsSync(run.worktree.path)) {
    return failOwnedAttempt(R, payload, new Error('isolated worktree unavailable'));
  }

  let boundLaunchSpec;
  let control;
  try {
    boundLaunchSpec = assertLaunchBinding(payload, run);
    control = assertControlBinding(payload, run);
  }
  catch (error) { return failOwnedAttempt(R, payload, error); }

  const removedAnthropicOverrides = process.env.AEGIS_REMOVED_ANTHROPIC_OVERRIDES === '1'
    || Object.keys(process.env).some((key) => key.startsWith('ANTHROPIC_'));
  const childEnv = claudeEnvironment();

  let stdout = '';
  let stderr = '';
  let child;
  let launchSpec;
  let claudeExecutable;
  let contained;
  let command;
  let authorizedWriteBaselineSha256;
  let enforceMutationProof = false;
  let childOutcome;
  let childIdentity;
  try {
  if (process.env.NODE_ENV === 'test') {
    const preChildDelayMs = Number(process.env.FAKE_WORKER_PRE_CHILD_MS || 0);
    if (Number.isInteger(preChildDelayMs) && preChildDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(preChildDelayMs, 5000)));
    }
  }
  launchSpec = boundLaunchSpec;
  if (launchSpec.provider !== 'claude-subscription') {
    throw invalidLaunch('Grok provider handoff is prepared but network execution is not activated in this deterministic slice');
  }
  ({ child, contained, claudeExecutable, command, authorizedWriteBaselineSha256, enforceMutationProof } =
    launchClaudeProcess(run, launchSpec, childEnv));
  // Establish the close observer before any identity or ledger update work.
  // Every later failure must retain enough ownership evidence to drain the
  // exact worker process group or fail closed as TERMINATION_UNVERIFIED.
  let timedOut = false;
  let timeoutReason = null;
  let lastProgressAtMs = Date.now();
  let lastProgressAt = nowIso();
  let progressKind = 'STARTED';
  let progressActivity = 'STARTING';
  let progressActivityAt = lastProgressAt;
  let latestAuthorizedWriteSha256 = authorizedWriteBaselineSha256;
  const timeoutMs = normalizeTimeoutSec(payload.timeoutSec) * 1000;
  const noProgressTimeoutMs = builderNoProgressTimeoutMs(timeoutMs);
  let noProgressTimer = null;
  let resolveNoProgress = null;
  const noProgressReached = noProgressTimeoutMs === null
    ? new Promise(() => {})
    : new Promise((resolve) => { resolveNoProgress = resolve; });
  const armNoProgressWatchdog = () => {
    if (noProgressTimeoutMs === null || !resolveNoProgress) return;
    clearTimeout(noProgressTimer);
    noProgressTimer = setTimeout(() => {
      const resolve = resolveNoProgress;
      resolveNoProgress = null;
      resolve({ lastProgressAt, progressKind });
    }, noProgressTimeoutMs);
  };
  const recordProgress = (kind, activity) => {
    lastProgressAtMs = Date.now();
    lastProgressAt = nowIso();
    progressKind = kind;
    // The activity stamp moves only when a structured event actually named an
    // activity, so the published evidence time belongs to the event that named
    // it and never to a later event that named nothing.
    if (typeof activity === 'string' && PROGRESS_ACTIVITY_CODES.includes(activity)) {
      progressActivity = activity;
      progressActivityAt = lastProgressAt;
    }
    armNoProgressWatchdog();
  };
  armNoProgressWatchdog();
  childOutcome = new Promise((resolve) => {
    child.once('error', (error) => resolve({ exit: 127, signal: null, error }));
    child.once('close', (code, signal) => resolve({ exit: code === null ? (timedOut ? 124 : 1) : code, signal, error: null }));
  });
  const stdoutProgress = createClaudeStreamProgressDigest();
  if (child.stdout) child.stdout.on('data', (chunk) => {
    // Every stream event is real execution activity, so the existing stdout
    // progress path resets the no-progress watchdog while the retained
    // evidence stays a bounded, content-free event digest.
    stdout = stdoutProgress.push(chunk); recordProgress('STDOUT', stdoutProgress.activity());
  });
  if (child.stderr) child.stderr.on('data', (chunk) => {
    stderr += chunk; stderr = stderr.slice(-24000); recordProgress('STDERR', 'DIAGNOSING');
  });

  if (process.env.NODE_ENV === 'test' && process.env.FAKE_PROCESS_IDENTITY_FAILURE === '1') {
    delete process.env.FAKE_PROCESS_IDENTITY_FAILURE;
    throw new Error('test process identity failure after Claude spawn');
  }
  childIdentity = R.processIdentity(child.pid);
  if (!childIdentity || childIdentity.processGroupId !== process.pid) {
    throw new Error('Claude child did not join the owned worker process group');
  }
  updateBuild(R, run.runId, payload.attemptId, {
    childPid: child.pid,
    childProcessGroupId: process.pid,
    childProcessIdentity: childIdentity,
    workerState: 'RUNNING',
    heartbeatAt: nowIso(),
    lastProgressAt,
    progressKind,
    progressActivity,
    progressActivityAt,
    environment: {
      anthropicOverridesRemoved: removedAnthropicOverrides,
      anthropicApiKeyOverrideRemoved: process.env.AEGIS_REMOVED_ANTHROPIC_API_KEY === '1',
      minimized: true,
      claudeExecutable,
      packetId: contained.allowlists.packetId,
      readPaths: contained.allowlists.readPaths,
      writePaths: contained.allowlists.writePaths,
      osSandbox: command.bin === CONTAINMENT.SANDBOX_EXEC,
      permissionMode: 'acceptEdits',
      modelTools: CLAUDE_FILE_TOOLS,
      modelShellAuthority: false,
      nestedSandboxConfiguredAsDefenseInDepth: false,
      nestedSandboxRequired: false,
      subscriptionConfigPolicy: contained.profile.claudeSubscriptionConfigPolicy,
      subscriptionConfigFilesValidated: contained.profile.claudeSubscriptionConfigReadPaths.length === 2,
      disposableRuntimePolicy: contained.profile.claudeDisposableRuntimePolicy,
      disposableRuntimeDirectoryValidated: Boolean(contained.profile.claudeDisposableRuntimeDirReadPath),
      nativeRuntimePolicy: contained.profile.claudeNativeRuntimePolicy,
      keychainHelperPolicy: contained.profile.claudeKeychainHelperPolicy,
      modelIssuedKeychainAccessDenied: contained.profile.claudeKeychainHelperPolicy === null,
    },
  });

  const heartbeat = setInterval(() => {
    try {
      const writeSha256 = authorizedWriteDigest(contained.allowlists.writePaths, run.worktree.path);
      if (writeSha256 !== latestAuthorizedWriteSha256) {
        latestAuthorizedWriteSha256 = writeSha256;
        recordProgress('AUTHORIZED_WRITE', 'EDITING');
      }
      updateBuild(R, run.runId, payload.attemptId, {
        heartbeatAt: nowIso(),
        lastProgressAt,
        progressKind,
        progressActivity,
        progressActivityAt,
        stdoutTail: boundedTail(stdout),
        stderrTail: boundedTail(stderr),
      });
    } catch { /* the controlling process may be finalizing cancellation */ }
  }, HEARTBEAT_MS);

  let timeoutTerminationEvidence = null;
  const observedChildOutcome = process.env.NODE_ENV === 'test' && process.env.FAKE_NEVER_CLOSE === '1'
    ? new Promise(() => {}) : childOutcome;
  let timeout;
  const timeoutReached = new Promise((resolve) => { timeout = setTimeout(resolve, timeoutMs); });
  const cancellationState = { requested: false };
  const cancellation = monitorCancellation(control, payload.attemptId, child, childOutcome, childIdentity,
    cancellationState);
  let first = await Promise.race([
    observedChildOutcome.then((result) => ({ kind: 'child', result })),
    timeoutReached.then(() => ({ kind: 'timeout' })),
    noProgressReached.then((progress) => ({ kind: 'no-progress', progress })),
    cancellation.then((evidence) => ({ kind: 'cancel', evidence })),
  ]);
  if (first.kind === 'child' && cancellationState.requested) {
    first = { kind: 'cancel', evidence: await cancellation };
  }
  let result;
  if (first.kind === 'child') {
    result = first.result;
  } else if (first.kind === 'cancel') {
    clearInterval(heartbeat);
    clearTimeout(timeout);
    clearTimeout(noProgressTimer);
    return first.evidence.terminated ? 143 : 124;
  } else {
    timedOut = true;
    timeoutReason = first.kind === 'no-progress' ? 'NO_PROGRESS_TIMEOUT' : 'WALL_CLOCK_TIMEOUT';
    const testUnverified = process.env.NODE_ENV === 'test' && process.env.FAKE_UNVERIFIED_TIMEOUT === '1';
    const terminationOperation = testUnverified
      ? Promise.resolve({ processGroupId: process.pid, terminated: false, childCloseObserved: false,
        observedAt: nowIso(), testFixture: true, childIdentity })
      : terminateOwnedChild(childOutcome, childIdentity, 1000);
    timeoutTerminationEvidence = await Promise.race([
      terminationOperation,
      new Promise((resolve) => setTimeout(() => resolve({
        processGroupId: process.pid, terminated: false, observedAt: nowIso(), deadlineExceeded: true,
      }), TERMINATION_DEADLINE_MS)),
    ]);
    const closeAfterTermination = await Promise.race([
      observedChildOutcome,
      new Promise((resolve) => setTimeout(() => resolve(null), CHILD_CLOSE_GRACE_MS)),
    ]);
    timeoutTerminationEvidence = {
      ...(timeoutTerminationEvidence || {}), childCloseObserved: Boolean(closeAfterTermination),
      timeoutReason,
      lastProgressAt,
      progressKind,
      noProgressForMs: Math.max(0, Date.now() - lastProgressAtMs),
    };
    result = closeAfterTermination || { exit: 124, signal: null, error: null };
    if (result.exit === 0 || result.exit === null) result.exit = 124;
  }
  clearInterval(heartbeat);
  clearTimeout(timeout);
  clearTimeout(noProgressTimer);
  stdout = stdoutProgress.end();

  const authorizedMutationObserved = authorizedWriteDigest(contained.allowlists.writePaths, run.worktree.path) !==
    authorizedWriteBaselineSha256;
  if (result.exit === 0 && enforceMutationProof && !authorizedMutationObserved) {
    result = {
      exit: 3,
      signal: null,
      error: new Error('builder exited 0 without applying an authorized file change'),
    };
  }

  const failure = classifyBuilderFailure(launchSpec.provider, result.exit, stdout,
    result.error ? `${stderr}\n${result.error.message}` : stderr,
    { timedOut, timeoutReason });

  // The drain proof the handoff gate consumes. A timeout already produced one
  // by terminating the owned group; a natural close is proven the same way, by
  // one bounded membership snapshot rather than by assuming the exit was tidy.
  const originalDrainEvidence = timedOut ? timeoutTerminationEvidence
    : observeOwnedGroupDrain(childIdentity, !result.error);

  let handoff = null;
  if (failure) {
    try {
      handoff = authorizeBuilderFailover({
        launchSpec, failure, run, authorizedMutationObserved,
        drainEvidence: originalDrainEvidence,
      });
    } catch (error) {
      // The gate itself failing is not permission to hand off.
      handoff = Object.freeze({
        state: 'BLOCKED', executable: false, blockedReason: 'FAILOVER_AUTHORITY_UNAVAILABLE',
        reason: `The builder handoff authority could not be evaluated: ${boundedTail(error.message)}`,
        failureCode: failure.code, fromProvider: launchSpec.provider, toProvider: null,
        toPolicyModel: null, sameProviderRetryAllowed: false, unchangedObjective: true,
      });
    }
  }

  let replacement = null;
  if (handoff && handoff.state === 'AUTHORIZED') {
    try {
      replacement = await executeFailoverBuilder(run, handoff, timeoutMs);
      handoff = Object.freeze({ ...handoff, state: 'COMPLETED', handoffCount: 1 });
    } catch (error) {
      handoff = Object.freeze({
        ...handoff, state: 'FAILED', executable: false, handoffCount: 1,
        reason: `The authorized handoff could not be executed: ${boundedTail(error.message)}`,
      });
    }
  }

  const effectiveExit = replacement ? replacement.exit : result.exit;

  let fresh = updateBuild(R, run.runId, payload.attemptId, {
    workerState: effectiveExit === 0 ? 'EXITED' : 'FAILED',
    endedAt: nowIso(),
    heartbeatAt: nowIso(),
    exit: effectiveExit,
    originalExit: result.exit,
    signal: result.signal || null,
    timedOut,
    timeoutReason,
    lastProgressAt,
    progressKind,
    progressActivity,
    progressActivityAt,
    authorizedMutationObserved: replacement
      ? replacement.authorizedMutationObserved : authorizedMutationObserved,
    timeoutTerminationEvidence,
    originalDrainEvidence,
    failure,
    providerSelection: handoff && handoff.toProvider ? {
      provider: handoff.toProvider,
      model: handoff.launchSpec ? handoff.launchSpec.model : null,
      reason: handoff.selectionReason || handoff.reason,
    } : null,
    handoff,
    failoverHandoffs: replacement ? 1 : recordedAutomaticHandoffs(run),
    replacement,
    recovery: handoff ? {
      reason: failure.code,
      observedAt: nowIso(),
      terminationVerified: processGroupDrainVerified(originalDrainEvidence),
      retrySafe: false,
      sameProviderRetryAllowed: false,
      providerFailoverRequired: handoff.state !== 'COMPLETED',
      handoffState: handoff.state,
      blockedReason: handoff.blockedReason || null,
      selectedProvider: handoff.toProvider || null,
      selectedModel: handoff.launchSpec ? handoff.launchSpec.model : null,
      attemptId: payload.attemptId,
    } : null,
    stdoutTail: boundedTail(stdout),
    stderrTail: boundedTail(result.error ? `${stderr}\n${result.error.message}` : stderr),
  });
  if (fresh.build && fresh.build.cancelRequestedAt) return effectiveExit;
  if (timedOut && (!timeoutTerminationEvidence || !timeoutTerminationEvidence.terminated ||
      !timeoutTerminationEvidence.childCloseObserved)) {
    R.transitionWorkerAttempt(run.runId, payload.attemptId, process.pid, 'BUILD_FAILED',
      'builder timeout termination could not be verified; retry is blocked', {
        workerState: 'TERMINATION_UNVERIFIED',
        recovery: {
          reason: 'TERMINATION_UNVERIFIED', observedAt: nowIso(), terminationVerified: false,
          retrySafe: false, abandonmentAllowed: true, attemptId: payload.attemptId,
        },
      });
    return 124;
  }
  if (fresh.state === 'BUILDING') {
    // After a completed handoff the run's outcome is the REPLACEMENT builder's
    // outcome. The original provider failure stays recorded beside it as
    // build.failure and build.originalExit; it is never presented as the result.
    const outcomeNote = replacement
      ? `governed failover builder ${replacement.provider} exited ${effectiveExit} after ` +
        `${failure.code} on ${launchSpec.provider}`
      : effectiveExit === 0 ? 'asynchronous builder exited 0'
        : `asynchronous builder exited ${effectiveExit}`;
    R.transitionWorkerAttempt(run.runId, payload.attemptId, process.pid,
      effectiveExit === 0 ? 'BUILT' : 'BUILD_FAILED', outcomeNote);
  }
  return effectiveExit;
  } catch (error) {
    if (!child && launchSpec && error && error.code === 'CLAUDE_SUBSCRIPTION_REAUTH_REQUIRED') {
      const handled = await handleProviderOwnedBootstrapFailure(
        R, payload, run, launchSpec, error, normalizeTimeoutSec(payload.timeoutSec) * 1000);
      if (handled !== null) return handled;
    }
    return failOwnedAttempt(R, payload, error, childOutcome, childIdentity);
  }
  } finally {
    // A stale or replaced generation can never be removed. If a child or
    // descendant remains in this worker-owned process group, release refuses;
    // the durable lease then blocks admission until the complete group is
    // positively absent and a later launcher safely reclaims it.
    if (globalLease) {
      try { R.releaseGlobalWorkerLease(globalLease); } catch { /* fail closed: retained lease */ }
    }
  }
}

if (require.main === module) {
  const at = process.argv.indexOf('--execute');
  if (at === -1 || !process.argv[at + 1] || !process.argv[at + 2] || !process.argv[at + 3]) process.exit(2);
  executePayload(process.argv[at + 1], process.argv[at + 2], process.argv[at + 3])
    .then((code) => process.exit(code)).catch(() => process.exit(1));
}

module.exports = {
  launchWorker,
  processAlive, processGroupAlive, boundedTail,
  summarizeClaudeStreamLine, createClaudeStreamProgressDigest, claudeStreamActivity,
  CLAUDE_TOOL_ACTIVITY, PROGRESS_ACTIVITY_CODES,
  normalizeLaunchSpec, normalizeTimeoutSec, resolveClaudeExecutable, resolvePinnedGrokExecutable,
  resolveGrokExecutable,
  launchClaudeProcess, grokArgv, prepareGrokLaunch,
  runContainedClaudeAuthStatus,
  assertClaudeOAuthFreshness,
  resolveApprovedPacket, derivePacketAllowlists, prepareRunContainment,
  declaredCheckEntrypoint, literalLocalImports, collectLocalDependencies, assertLaunchBinding, launchDigest,
  authorizedWriteDigest,
  baseEnvironment, workerEnvironment, claudeEnvironment, grokEnvironment,
  assertClaudeModelSandboxPolicy,
  classifyBuilderFailure, selectFailoverBuilder, authorizeBuilderFailover,
  loadModelRoutingPolicy, loadToolCapabilityCanon,
  processGroupDrainVerified, observeOwnedGroupDrain, executeFailoverBuilder,
  FAILOVER_FAILURE_CODES, FAILOVER_FAILURE_SUMMARIES,
  MAX_PROMPT_BYTES, MAX_TIMEOUT_SEC, DEFAULT_NO_PROGRESS_TIMEOUT_SEC,
  builderNoProgressTimeoutMs, CLAUDE_SETTINGS, CLAUDE_FILE_TOOLS,
  CLAUDE_DISALLOWED_TOOLS, CLAUDE_VERSION, CLAUDE_EXECUTABLE, CLAUDE_STREAM_PROGRESS_ARGV,
  GROK_EXECUTABLE, GROK_PINNED_EXECUTABLE, GROK_FILE_TOOLS, GROK_DISALLOWED_TOOLS,
  GROK_MAX_TURNS, GROK_HOME_PREFIX, MODEL_ROUTING_POLICY,
  CLAUDE_KEYCHAIN_SERVICE, CLAUDE_OAUTH_TOKEN_FILE_DESCRIPTOR, CLAUDE_OAUTH_EXPIRY_SKEW_MS,
};
