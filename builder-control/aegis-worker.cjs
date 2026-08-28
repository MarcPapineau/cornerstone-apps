#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const CONTAINMENT = require('./sandbox-containment.cjs');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const PACKETS_DIR = path.join(HERE, 'packets');
const RUNTIME = path.join(HERE, 'aegis-run.cjs');
const MODEL_ROUTING_POLICY = path.join(HERE, 'MODEL-ROUTING-POLICY.json');
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
const GROK_FILE_TOOLS = Object.freeze(['read_file', 'search_replace', 'grep', 'list_dir']);
const GROK_DISALLOWED_TOOLS = Object.freeze(['run_terminal_cmd', 'web_search', 'web_fetch', 'task']);
const GROK_MAX_TURNS = 32;
const GROK_HOME_PREFIX = '/private/tmp/aegis-grok-';
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
    .split('\n').slice(-TAIL_LINES).join('\n').slice(-12000);
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

function processGroupMembers(processGroupId, timeoutMs = 250) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 1) return null;
  const observed = spawnSync('ps', ['-axo', 'pid=,pgid='], {
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

function resolveGrokExecutable() {
  if (process.env.NODE_ENV === 'test' && process.env.AEGIS_TEST_GROK_EXECUTABLE) {
    const real = fs.realpathSync(path.resolve(process.env.AEGIS_TEST_GROK_EXECUTABLE));
    if (!path.isAbsolute(real) || !fs.statSync(real).isFile()) throw invalidLaunch('test Grok executable must resolve to a file');
    fs.accessSync(real, fs.constants.X_OK);
    return real;
  }
  const real = fs.realpathSync(GROK_EXECUTABLE);
  if (real !== fs.realpathSync(GROK_PINNED_EXECUTABLE)) {
    throw invalidLaunch('Grok executable must resolve to the pinned managed binary');
  }
  fs.accessSync(real, fs.constants.X_OK);
  return real;
}

function classifyBuilderFailure(provider, exit, stdout, stderr) {
  const output = `${stdout || ''}\n${stderr || ''}`;
  if (provider === 'claude-subscription' && exit !== 0 &&
      /(401[^\n]*(?:oauth|token)|oauth access token has expired|failed to authenticate)/i.test(output)) {
    return Object.freeze({
      code: 'MODEL_AUTH_FAILURE', provider,
      summary: 'Claude authentication expired. AEGIS marked Claude unavailable for this objective and will use the next eligible builder.',
      retrySafe: true, failoverEligible: true,
    });
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

function selectFailoverBuilder(launchSpec, failure, run, policy = loadModelRoutingPolicy()) {
  const current = normalizeLaunchSpec(launchSpec);
  if (!failure || failure.code !== 'MODEL_AUTH_FAILURE' || failure.provider !== current.provider ||
      failure.failoverEligible !== true) return null;
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
  if (!selected) throw invalidLaunch('canonical builder failover routes are exhausted');

  const selectedFamily = ((policy.models || {})[selectedPolicyModel] || {}).providerFamily || selectedPolicyModel;
  const reviewers = Object.entries(policy.roles || {})
    .filter(([roleId, role]) => roleId.endsWith('review') && role && role.mayApproveOwnWork === false)
    .map(([roleId, role]) => ({
      roleId,
      model: role.default,
      providerFamily: (((policy.models || {})[role.default] || {}).providerFamily || role.default),
    }));
  const independentReviewers = reviewers.filter((reviewer) => reviewer.providerFamily !== selectedFamily);
  if (independentReviewers.length === 0) {
    throw invalidLaunch('selected failover builder has no independent reviewer');
  }
  const objectiveSha256 = sha256(run.objective);
  const promptSha256 = sha256(current.prompt);
  return Object.freeze({
    launchSpec: selected,
    selectionReason: `${failure.code}: ${currentModel[0]} is unavailable for the unchanged objective; selected ${selectedPolicyModel} as the next eligible canonical subscription builder`,
    handoff: Object.freeze({
      state: 'READY_FOR_PROVIDER_HANDOFF',
      fromProvider: current.provider,
      toProvider: selected.provider,
      fromPolicyModel: currentModel[0],
      toPolicyModel: selectedPolicyModel,
      failureCode: failure.code,
      sameProviderRetryAllowed: false,
      unchangedObjective: true,
      objectiveSha256,
      promptSha256,
      builderMayApproveOwnWork: false,
      independentReviewers: Object.freeze(independentReviewers),
      excludedSelfReviewModels: Object.freeze(reviewers
        .filter((reviewer) => reviewer.providerFamily === selectedFamily)
        .map((reviewer) => reviewer.model)),
    }),
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
    const canonicalDigest = sha256(fs.readFileSync(canonicalPacketPath));
    const worktreeDigest = sha256(fs.readFileSync(packetPath));
    if (canonicalDigest !== worktreeDigest) {
      throw new Error('worktree approved packet digest does not match canonical approved packet');
    }
  }
  if (!fs.statSync(packetPath).isFile()) throw new Error('approved packet must be a file');
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  if (!packet || packet.agentId !== 'claude-code' || typeof packet.packetId !== 'string' || !packet.packetId ||
      !Array.isArray(packet.filesAllowed) || packet.filesAllowed.length === 0) {
    throw new Error('approved packet is malformed or does not authorize claude-code');
  }
  return Object.freeze({ packetPath, canonicalPacketPath, packetSha256: sha256(fs.readFileSync(packetPath)), packet });
}

function exactRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') ||
      path.isAbsolute(value) || /[*?\[\]{}]/.test(value) || path.posix.normalize(value) !== value ||
      value === '.' || value.endsWith('/') || value.startsWith('../')) {
    throw new Error(`${label} is not an exact worktree-relative path: ${String(value)}`);
  }
  return value;
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
    const claudeKeychainHelper = productionClaude ? CONTAINMENT.claudeKeychainHelperPaths() : null;
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
  const run = waitForLaunchRecord(R, expectedRunId, expectedAttemptId, process.pid);
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
  childOutcome = new Promise((resolve) => {
    child.once('error', (error) => resolve({ exit: 127, signal: null, error }));
    child.once('close', (code, signal) => resolve({ exit: code === null ? (timedOut ? 124 : 1) : code, signal, error: null }));
  });
  if (child.stdout) child.stdout.on('data', (chunk) => { stdout += chunk; stdout = stdout.slice(-24000); });
  if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk; stderr = stderr.slice(-24000); });

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
      nestedSandboxConfiguredAsDefenseInDepth: true,
      nestedSandboxRequired: false,
      subscriptionConfigPolicy: contained.profile.claudeSubscriptionConfigPolicy,
      subscriptionConfigFilesValidated: contained.profile.claudeSubscriptionConfigReadPaths.length === 2,
      disposableRuntimePolicy: contained.profile.claudeDisposableRuntimePolicy,
      disposableRuntimeDirectoryValidated: Boolean(contained.profile.claudeDisposableRuntimeDirReadPath),
      nativeRuntimePolicy: contained.profile.claudeNativeRuntimePolicy,
      keychainHelperPolicy: contained.profile.claudeKeychainHelperPolicy,
      modelIssuedKeychainAccessDenied: true,
    },
  });

  const heartbeat = setInterval(() => {
    try {
      updateBuild(R, run.runId, payload.attemptId, {
        heartbeatAt: nowIso(),
        stdoutTail: boundedTail(stdout),
        stderrTail: boundedTail(stderr),
      });
    } catch { /* the controlling process may be finalizing cancellation */ }
  }, HEARTBEAT_MS);

  let timeoutTerminationEvidence = null;
  const timeoutMs = normalizeTimeoutSec(payload.timeoutSec) * 1000;
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
    return first.evidence.terminated ? 143 : 124;
  } else {
    timedOut = true;
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
    };
    result = closeAfterTermination || { exit: 124, signal: null, error: null };
    if (result.exit === 0 || result.exit === null) result.exit = 124;
  }
  clearInterval(heartbeat);
  clearTimeout(timeout);

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
    result.error ? `${stderr}\n${result.error.message}` : stderr);
  const failover = failure && !authorizedMutationObserved
    ? selectFailoverBuilder(launchSpec, failure, run) : null;

  let fresh = updateBuild(R, run.runId, payload.attemptId, {
    workerState: result.exit === 0 ? 'EXITED' : 'FAILED',
    endedAt: nowIso(),
    heartbeatAt: nowIso(),
    exit: result.exit,
    signal: result.signal || null,
    timedOut,
    authorizedMutationObserved,
    timeoutTerminationEvidence,
    failure,
    providerSelection: failover ? {
      provider: failover.launchSpec.provider,
      model: failover.launchSpec.model,
      reason: failover.selectionReason,
    } : null,
    handoff: failover ? failover.handoff : null,
    recovery: failover ? {
      reason: failure.code,
      observedAt: nowIso(),
      terminationVerified: true,
      retrySafe: false,
      sameProviderRetryAllowed: false,
      providerFailoverRequired: true,
      selectedProvider: failover.launchSpec.provider,
      selectedModel: failover.launchSpec.model,
      attemptId: payload.attemptId,
    } : null,
    stdoutTail: boundedTail(stdout),
    stderrTail: boundedTail(result.error ? `${stderr}\n${result.error.message}` : stderr),
  });
  if (fresh.build && fresh.build.cancelRequestedAt) return result.exit;
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
    R.transitionWorkerAttempt(run.runId, payload.attemptId, process.pid,
      result.exit === 0 ? 'BUILT' : 'BUILD_FAILED',
      result.exit === 0 ? 'asynchronous builder exited 0' : `asynchronous builder exited ${result.exit}`);
  }
  return result.exit;
  } catch (error) {
    return failOwnedAttempt(R, payload, error, childOutcome, childIdentity);
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
  normalizeLaunchSpec, normalizeTimeoutSec, resolveClaudeExecutable, resolveGrokExecutable,
  launchClaudeProcess, grokArgv, prepareGrokLaunch,
  runContainedClaudeAuthStatus,
  assertClaudeOAuthFreshness,
  resolveApprovedPacket, derivePacketAllowlists, prepareRunContainment,
  declaredCheckEntrypoint, literalLocalImports, collectLocalDependencies, assertLaunchBinding, launchDigest,
  authorizedWriteDigest,
  baseEnvironment, workerEnvironment, claudeEnvironment, grokEnvironment,
  assertClaudeModelSandboxPolicy,
  classifyBuilderFailure, selectFailoverBuilder, loadModelRoutingPolicy,
  MAX_PROMPT_BYTES, MAX_TIMEOUT_SEC, CLAUDE_SETTINGS, CLAUDE_FILE_TOOLS,
  CLAUDE_DISALLOWED_TOOLS, CLAUDE_VERSION, CLAUDE_EXECUTABLE,
  GROK_EXECUTABLE, GROK_PINNED_EXECUTABLE, GROK_FILE_TOOLS, GROK_DISALLOWED_TOOLS,
  GROK_MAX_TURNS, GROK_HOME_PREFIX, MODEL_ROUTING_POLICY,
  CLAUDE_KEYCHAIN_SERVICE, CLAUDE_OAUTH_TOKEN_FILE_DESCRIPTOR, CLAUDE_OAUTH_EXPIRY_SKEW_MS,
};
