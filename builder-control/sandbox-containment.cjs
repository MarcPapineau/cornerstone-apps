#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const FIXED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const CLAUDE_SUBSCRIPTION_CONFIG_POLICY = 'CLAUDE_SUBSCRIPTION_CONFIG_V1';
const CLAUDE_DISPOSABLE_RUNTIME_POLICY = 'CLAUDE_DISPOSABLE_RUNTIME_DIR_V1';
const CLAUDE_NATIVE_RUNTIME_POLICY = 'CLAUDE_NATIVE_RUNTIME_V1';
const CLAUDE_KEYCHAIN_HELPER_POLICY = 'CLAUDE_KEYCHAIN_HELPER_READ_V2';
const CLAUDE_OAUTH_TOKEN_FD = '3';
const GROK_DISPOSABLE_HOME_POLICY = 'GROK_DISPOSABLE_HOME_V1';
const MAX_CLAUDE_CONFIG_BYTES = 1024 * 1024;
const CONTAINED_ENVIRONMENT_OVERRIDE_KEYS = new Set([
  'HOME',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'CODEX_HOME',
  'GROK_DISABLE_AUTOUPDATER',
  'GROK_MANAGED_MCPS_ENABLED',
  'GROK_HOME',
  'GIT_OPTIONAL_LOCKS',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
]);
let sandboxProbe = null;

function sandboxCapability() {
  if (sandboxProbe) return sandboxProbe;
  if (process.platform !== 'darwin' || !fs.existsSync(SANDBOX_EXEC)) {
    sandboxProbe = Object.freeze({ available: false, reason: 'macOS sandbox-exec is unavailable' });
    return sandboxProbe;
  }
  // Probe the same deny-by-default policy class used for real launches. A
  // permissive `(allow default)` probe can succeed inside a host sandbox even
  // when nested restrictive profiles abort, which would falsely advertise
  // containment as operational and fail only after a paid worker is launched.
  const probeProfile = [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow sysctl-read)',
    '(allow file-read-metadata)',
    '(allow file-read-data (literal "/"))',
    '(allow file-read* (subpath "/System") (subpath "/usr/lib") (literal "/usr/bin/true"))',
  ].join('\n') + '\n';
  const result = spawnSync(SANDBOX_EXEC, ['-p', probeProfile, '/usr/bin/true'], {
    encoding: 'utf8',
    env: { PATH: FIXED_PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  sandboxProbe = Object.freeze({
    available: result.status === 0 && !result.error,
    reason: result.status === 0 && !result.error
      ? null
      : `OS sandbox preflight failed${result.status === null ? '' : ` with exit ${result.status}`}: ${(result.error && result.error.message) || (result.stderr || '').trim() || 'unknown error'}`,
  });
  return sandboxProbe;
}

function assertSandboxOperational() {
  const capability = sandboxCapability();
  if (!capability.available) throw new Error(`${capability.reason}; refusing uncontained launch`);
  return capability;
}

function quoteSbpl(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function quoteSbplRegex(value) {
  // SBPL regex literals consume regex escapes directly. Reusing quoteSbpl()
  // would double every backslash and turn `\.` into a literal backslash plus
  // wildcard instead of an escaped dot.
  return `#"${String(value).replace(/"/g, '\\"')}"`;
}

function realExisting(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  const real = fs.realpathSync(value);
  if (!path.isAbsolute(real)) throw new Error(`${label} did not resolve absolutely`);
  return real;
}

function assertInside(root, candidate, label) {
  const rootReal = realExisting(root, 'containment root');
  const candidateReal = realExisting(candidate, label);
  if (candidateReal !== rootReal && !candidateReal.startsWith(rootReal + path.sep)) {
    throw new Error(`${label} escapes containment root: ${candidate}`);
  }
  return candidateReal;
}

function uniqueRealPaths(values, root, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  return [...new Set(values.map((value) => assertInside(root, value, label)))].sort();
}

function claudeSubscriptionConfigPaths(home = require('os').homedir()) {
  if (typeof home !== 'string' || !path.isAbsolute(home)) {
    throw new Error('Claude subscription HOME must be an absolute path');
  }
  return Object.freeze([
    path.join(home, '.claude.json'),
    path.join(home, '.claude', 'settings.json'),
  ]);
}

/**
 * Validate metadata only. This function deliberately never opens or parses a
 * config file: Claude itself may read the two exact literals under the OS
 * profile, while AEGIS must never ingest or log their credential contents.
 */
function validateClaudeSubscriptionConfigPaths(values, {
  home = require('os').homedir(),
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  const expected = claudeSubscriptionConfigPaths(home);
  if (!Array.isArray(values) || values.length !== expected.length ||
      values.some((value, index) => value !== expected[index])) {
    throw new Error(`Claude subscription config must match ${CLAUDE_SUBSCRIPTION_CONFIG_POLICY} exact literals`);
  }
  const validated = [];
  for (const literal of expected) {
    let stat;
    try { stat = fs.lstatSync(literal); }
    catch (error) {
      if (error && error.code === 'ENOENT') throw new Error('required Claude subscription config is absent');
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('Claude subscription config must be a regular non-symlink file');
    }
    if (stat.nlink !== 1) {
      throw new Error('Claude subscription config must not have alternate hard-link paths');
    }
    const real = fs.realpathSync(literal);
    if (real !== literal) throw new Error('Claude subscription config resolved away from its exact literal path');
    if (ownerUid !== null && stat.uid !== ownerUid) {
      throw new Error('Claude subscription config must be controlled by the current owner');
    }
    if ((stat.mode & 0o400) === 0 || (stat.mode & 0o077) !== 0) {
      throw new Error('Claude subscription config permissions must be owner-readable and deny group and other access');
    }
    if (stat.size < 1 || stat.size > MAX_CLAUDE_CONFIG_BYTES) {
      throw new Error('Claude subscription config size violates the pinned metadata policy');
    }
    validated.push(real);
  }
  return Object.freeze(validated);
}

function claudeDisposableRuntimeDir(ownerUid = typeof process.getuid === 'function' ? process.getuid() : null) {
  if (!Number.isInteger(ownerUid) || ownerUid < 0) {
    throw new Error('Claude disposable runtime owner must be a non-negative uid');
  }
  return path.join('/private/tmp', `claude-${ownerUid}`);
}

/**
 * Validate metadata only. The directory contents are never opened or listed
 * here; the pinned Claude process receives directory-data access to this exact
 * literal solely so its native runtime can resolve its private runtime state.
 */
function validateClaudeDisposableRuntimeDir(value, {
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
  expectedPath = claudeDisposableRuntimeDir(ownerUid),
} = {}) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value !== expectedPath) {
    throw new Error(`Claude disposable runtime directory must match ${CLAUDE_DISPOSABLE_RUNTIME_POLICY} exact literal`);
  }
  const stat = fs.lstatSync(value);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('Claude disposable runtime path must be a real non-symlink directory');
  }
  const real = fs.realpathSync(value);
  if (real !== value) throw new Error('Claude disposable runtime directory resolved away from its exact literal path');
  if (ownerUid === null || stat.uid !== ownerUid) {
    throw new Error('Claude disposable runtime directory must be controlled by the current owner');
  }
  if ((stat.mode & 0o777) !== 0o700) {
    throw new Error('Claude disposable runtime directory permissions must be exactly owner-only 0700');
  }
  return real;
}

function validateOwnedRuntimePath(value, label, {
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
  directory = false,
} = {}) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  const stat = fs.lstatSync(value);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error(`${label} must be a real non-symlink ${directory ? 'directory' : 'file'}`);
  }
  const real = fs.realpathSync(value);
  if (real !== value) throw new Error(`${label} resolved away from its exact literal path`);
  if (ownerUid !== null && stat.uid !== ownerUid) {
    throw new Error(`${label} must be controlled by the current owner`);
  }
  return real;
}

function validateGrokDisposableHome(value, {
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  const prefix = '/private/tmp/aegis-grok-';
  if (typeof value !== 'string' || !value.startsWith(prefix) || path.dirname(value) !== '/private/tmp') {
    throw new Error(`Grok disposable home must match ${GROK_DISPOSABLE_HOME_POLICY}`);
  }
  const stat = fs.lstatSync(value);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o777) !== 0o700 ||
      (ownerUid !== null && stat.uid !== ownerUid) || fs.realpathSync(value) !== value) {
    throw new Error('Grok disposable home must be a real owner-controlled 0700 directory');
  }
  return value;
}

function claudeNativeRuntimePaths(root, home = require('os').homedir(),
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null) {
  const rootReal = realExisting(root, 'Claude runtime worktree');
  const worktreeGitFile = path.join(rootReal, '.git');
  const gitFile = validateOwnedRuntimePath(worktreeGitFile, 'worktree Git pointer', { ownerUid });
  const gitPointer = fs.readFileSync(gitFile, 'utf8');
  if (Buffer.byteLength(gitPointer, 'utf8') > 4096) throw new Error('worktree Git pointer is oversized');
  const match = gitPointer.match(/^gitdir: (\/[^\r\n]+)\r?\n?$/);
  if (!match) throw new Error('worktree Git pointer is not an exact absolute gitdir reference');
  const gitDir = validateOwnedRuntimePath(match[1], 'worktree Git metadata', { ownerUid, directory: true });
  const worktreesSegment = `${path.sep}worktrees${path.sep}`;
  const segmentAt = gitDir.lastIndexOf(worktreesSegment);
  if (segmentAt < 1 || path.basename(gitDir) !== path.basename(rootReal)) {
    throw new Error('worktree Git metadata is not bound to the isolated worktree');
  }
  const gitCommonDir = validateOwnedRuntimePath(gitDir.slice(0, segmentAt),
    'common Git metadata', { ownerUid, directory: true });
  const gitReadFiles = [
    path.join(gitDir, 'HEAD'),
    path.join(gitDir, 'index'),
    path.join(gitDir, 'commondir'),
    path.join(gitDir, 'gitdir'),
  ].filter((candidate) => {
    try { return fs.lstatSync(candidate).isFile(); } catch { return false; }
  }).map((candidate) => validateOwnedRuntimePath(candidate,
    'exact Claude Git runtime file', { ownerUid }));
  const claudeLocksDir = validateOwnedRuntimePath(path.join(home, '.local', 'state', 'claude', 'locks'),
    'Claude runtime locks', { ownerUid, directory: true });
  return Object.freeze({ rootGitFile: gitFile, gitDir, gitCommonDir,
    gitReadFiles: Object.freeze(gitReadFiles), claudeLocksDir });
}

function validateClaudeNativeRuntime(value, {
  root,
  home = require('os').homedir(),
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Claude native runtime boundary must be an object');
  }
  const expected = claudeNativeRuntimePaths(root, home, ownerUid);
  const keys = ['rootGitFile', 'gitDir', 'gitCommonDir', 'gitReadFiles', 'claudeLocksDir'];
  if (Object.keys(value).length !== keys.length ||
      keys.some((key) => key === 'gitReadFiles'
        ? !Array.isArray(value[key]) || value[key].length !== expected[key].length ||
          value[key].some((item, index) => item !== expected[key][index])
        : value[key] !== expected[key])) {
    throw new Error(`Claude native runtime must match ${CLAUDE_NATIVE_RUNTIME_POLICY} exact literals`);
  }
  return expected;
}

function claudeKeychainHelperPaths(home = require('os').homedir(),
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null) {
  const securityHelper = realExisting('/usr/bin/security', 'macOS security helper');
  const keychainsDir = validateOwnedRuntimePath(path.join(home, 'Library', 'Keychains'),
    'user Keychain directory', { ownerUid, directory: true });
  const userTextEncoding = validateOwnedRuntimePath(path.join(home, '.CFUserTextEncoding'),
    'user text encoding', { ownerUid });
  const securityMessages = validateOwnedRuntimePath(
    `/private/var/db/mds/messages/${ownerUid}/se_SecurityMessages`, 'Security framework messages', { ownerUid });
  return Object.freeze({ securityHelper, keychainsDir, userTextEncoding, securityMessages });
}

/**
 * Bind the outer authentication exception to the one canonical macOS helper
 * and its exact native support paths.  Callers cannot use the generic profile
 * builder to substitute another executable or another HOME subtree.
 *
 * This is only the trusted-client half of the boundary.  aegis-worker also
 * requires Claude's fail-closed nested OS sandbox to deny the Keychain tree to
 * every model-issued shell.  Consequently wrapper scripts, variable
 * indirection and indirect `security` invocations cannot inherit this outer
 * exception even though the pinned Claude client can authenticate.
 */
function validateClaudeKeychainHelper(value, {
  home = require('os').homedir(),
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Claude Keychain helper boundary must be an object');
  }
  const expected = claudeKeychainHelperPaths(home, ownerUid);
  const keys = ['securityHelper', 'keychainsDir', 'userTextEncoding', 'securityMessages'];
  if (Object.keys(value).length !== keys.length ||
      keys.some((key) => value[key] !== expected[key])) {
    throw new Error(`Claude Keychain helper must match ${CLAUDE_KEYCHAIN_HELPER_POLICY} exact literals`);
  }
  return expected;
}

function resolveWriteAuthorities(values, root, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  const rootReal = realExisting(root, 'containment root');
  const byAuthority = new Map();
  for (const value of values) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
      throw new Error(`${label} must be an absolute path`);
    }
    let authority;
    try {
      const initial = fs.lstatSync(value);
      if (initial.isSymbolicLink()) {
        throw new Error(`${label} must not be a symbolic link: ${value}`);
      }
      const real = assertInside(rootReal, value, label);
      const stat = fs.lstatSync(real);
      if (stat.dev !== initial.dev || stat.ino !== initial.ino) {
        throw new Error(`${label} changed while containment authority was resolved: ${value}`);
      }
      if (!stat.isDirectory() && !stat.isFile()) {
        throw new Error(`${label} must resolve to a regular file or directory: ${value}`);
      }
      if (stat.isFile() && stat.nlink !== 1) {
        throw new Error(`${label} regular file must have exactly one hard link: ${value}`);
      }
      authority = Object.freeze({
        path: real,
        matcher: stat.isDirectory() ? 'subpath' : 'literal',
        newLeaf: false,
        device: stat.dev,
        inode: stat.ino,
      });
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
      const parentReal = assertInside(rootReal, path.dirname(value), `${label} parent`);
      if (!fs.statSync(parentReal).isDirectory()) {
        throw new Error(`${label} parent must resolve to a directory: ${value}`);
      }
      const leaf = path.basename(value);
      if (!leaf || leaf === '.' || leaf === '..') throw new Error(`${label} has no exact leaf: ${value}`);
      authority = Object.freeze({
        path: path.join(parentReal, leaf),
        matcher: 'literal',
        newLeaf: true,
        device: null,
        inode: null,
      });
    }
    byAuthority.set(`${authority.matcher}\0${authority.path}`, authority);
  }
  return Object.freeze([...byAuthority.values()].sort((a, b) =>
    a.path.localeCompare(b.path) || a.matcher.localeCompare(b.matcher)));
}

function revalidateWriteAuthorities(authorities, root) {
  const rootReal = realExisting(root, 'containment root');
  for (const authority of authorities) {
    if (!authority || typeof authority.path !== 'string') {
      throw new Error('write authority is malformed');
    }
    if (authority.newLeaf) {
      const parentReal = assertInside(rootReal, path.dirname(authority.path), 'write authority parent');
      if (!fs.statSync(parentReal).isDirectory()) {
        throw new Error(`write authority parent must remain a directory: ${authority.path}`);
      }
      try {
        fs.lstatSync(authority.path);
        throw new Error(`new write leaf appeared before contained launch: ${authority.path}`);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
      }
      continue;
    }

    const stat = fs.lstatSync(authority.path);
    if (stat.isSymbolicLink() || stat.dev !== authority.device || stat.ino !== authority.inode) {
      throw new Error(`write authority identity changed before contained launch: ${authority.path}`);
    }
    if (authority.matcher === 'literal') {
      if (!stat.isFile() || stat.nlink !== 1) {
        throw new Error(`write authority regular file must retain exactly one hard link: ${authority.path}`);
      }
    } else if (authority.matcher === 'subpath' && !stat.isDirectory()) {
      throw new Error(`write authority directory changed before contained launch: ${authority.path}`);
    }
  }
  return true;
}

function atomicWriteTemporaryRegex(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error('atomic write target must be an absolute path');
  }
  const escaped = value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  return `^${escaped}\\.tmp\\.[0-9]+\\.[^/]+$`;
}

function strictEnvironment(overrides = {}, source = process.env) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('contained environment overrides must be an object');
  }
  const env = {};
  for (const key of ['LANG', 'LC_ALL', 'LC_CTYPE', 'TERM']) {
    if (typeof source[key] === 'string' && source[key]) env[key] = source[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || typeof value !== 'string' || value.includes('\0')) {
      throw new Error(`invalid contained environment entry ${key}`);
    }
    const testOnly = source.NODE_ENV === 'test' &&
      ((key === 'NODE_ENV' && value === 'test') || key.startsWith('FAKE_'));
    if (!CONTAINED_ENVIRONMENT_OVERRIDE_KEYS.has(key) && !testOnly) {
      throw new Error(`contained environment override ${key} is not allowed`);
    }
    if (key === 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR' && value !== CLAUDE_OAUTH_TOKEN_FD) {
      throw new Error(`Claude OAuth token descriptor must be ${CLAUDE_OAUTH_TOKEN_FD}`);
    }
    env[key] = value;
  }
  // This invariant is assigned last and PATH is deliberately absent from the
  // override allowlist, so callers cannot redirect contained executable lookup.
  env.PATH = FIXED_PATH;
  return Object.freeze(env);
}

function buildMacSandboxProfile({
  root,
  executable,
  readPaths = [],
  writePaths = [],
  processOnlyReadPaths = [],
  processOnlyReadDirectoryPaths = [],
  claudeSubscriptionConfigReadPaths = [],
  claudeDisposableRuntimeDirReadPath = null,
  claudeNativeRuntime = null,
  claudeKeychainHelper = null,
  claudeOAuthTokenFileDescriptor = null,
  grokDisposableHome = null,
  allowNetwork = true,
  reviewerRuntime = false,
}) {
  if (process.platform !== 'darwin' || !fs.existsSync(SANDBOX_EXEC)) {
    throw new Error('OS sandbox containment is unavailable; refusing launch');
  }
  const rootReal = realExisting(root, 'containment root');
  const executableReal = realExisting(executable, 'contained executable');
  const executableDir = path.dirname(executableReal);
  const reads = uniqueRealPaths(readPaths, rootReal, 'read path');
  const writeAuthorities = resolveWriteAuthorities(writePaths, rootReal, 'write path');
  const writes = writeAuthorities.map((authority) => authority.path);
  const credentialReads = uniqueRealPaths(processOnlyReadPaths, rootReal, 'process-only read path');
  const processDirectoryReads = uniqueRealPaths(
    processOnlyReadDirectoryPaths,
    rootReal,
    'process-only read directory path',
  );
  for (const value of processDirectoryReads) {
    if (!fs.statSync(value).isDirectory()) {
      throw new Error(`process-only read directory path must resolve to a directory: ${value}`);
    }
  }
  const subscriptionConfigReads = claudeSubscriptionConfigReadPaths.length
    ? validateClaudeSubscriptionConfigPaths(claudeSubscriptionConfigReadPaths)
    : [];
  const disposableRuntimeDirRead = claudeDisposableRuntimeDirReadPath
    ? validateClaudeDisposableRuntimeDir(claudeDisposableRuntimeDirReadPath)
    : null;
  const nativeRuntime = claudeNativeRuntime
    ? validateClaudeNativeRuntime(claudeNativeRuntime, { root: rootReal })
    : null;
  const keychainHelper = claudeKeychainHelper
    ? validateClaudeKeychainHelper(claudeKeychainHelper)
    : null;
  const grokHome = grokDisposableHome ? validateGrokDisposableHome(grokDisposableHome) : null;
  if (claudeOAuthTokenFileDescriptor !== null && claudeOAuthTokenFileDescriptor !== CLAUDE_OAUTH_TOKEN_FD) {
    throw new Error(`Claude OAuth token descriptor must be ${CLAUDE_OAUTH_TOKEN_FD}`);
  }
  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow signal (target self))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow ipc-posix-shm)',
    '(allow file-read-metadata)',
    '(allow file-read-data (literal "/"))',
    // Claude resolves its current working directory during native startup.
    // Permit directory data for this exact canonical root only: this allows
    // listing its immediate entries, never reading descendant file contents.
    `(allow file-read-data (literal ${quoteSbpl(rootReal)}))`,
    '(allow file-read* (subpath "/System") (subpath "/usr/lib") (subpath "/bin") (subpath "/private/var/db/dyld") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))',
    `(allow file-read* (literal ${quoteSbpl(executableReal)}))`,
  ];
  if (reviewerRuntime) {
    // Codex/Grok need these macOS runtime facilities to initialize. This
    // profile is used only for disposable independent-review subprocesses;
    // the builder worker never receives these allowances.
    lines.push('(allow system-socket)');
    lines.push('(allow user-preference-read)');
    lines.push(`(allow file-read* (literal ${quoteSbpl(executableDir)}) (subpath ${quoteSbpl(executableDir)}))`);
    lines.push('(allow file-read* (subpath "/usr/share/icu") (subpath "/private/var/db/timezone") (literal "/Library/Preferences/com.apple.networkd.plist") (literal "/Library/Preferences/com.apple.security.plist") (literal "/dev/autofs_nowait") (literal "/dev/dtracehelper"))');
  }
  for (const value of reads) lines.push(`(allow file-read* (subpath ${quoteSbpl(value)}))`);
  for (const authority of writeAuthorities) {
    lines.push(`(allow file-write* (${authority.matcher} ${quoteSbpl(authority.path)}))`);
    if (authority.matcher === 'literal') {
      // Claude's Edit/Write tools replace files atomically through an
      // unpredictable same-directory leaf.  Permit only the tool's exact
      // <authorized-file>.tmp.<pid>.<suffix> form; never the parent directory
      // or an unrelated sibling.  The final replacement remains independently
      // constrained by the exact literal authority above.
      lines.push(`(allow file-write* (regex ${quoteSbplRegex(atomicWriteTemporaryRegex(authority.path))}))`);
    }
  }
  for (const value of [...credentialReads, ...subscriptionConfigReads]) {
    lines.push(`(allow file-read* (require-all (literal ${quoteSbpl(value)}) (process-path ${quoteSbpl(executableReal)})))`);
  }
  for (const value of processDirectoryReads) {
    // Reviewer CLIs need to inspect the disposable cache/config trees that
    // they create during startup. Bind that authority to the pinned client
    // executable so model-issued child processes cannot read credentials or
    // other disposable HOME contents.
    lines.push(`(allow file-read* (require-all (subpath ${quoteSbpl(value)}) (process-path ${quoteSbpl(executableReal)})))`);
  }
  if (disposableRuntimeDirRead) {
    lines.push(`(allow file-read-data (require-all (literal ${quoteSbpl(disposableRuntimeDirRead)}) (process-path ${quoteSbpl(executableReal)})))`);
  }
  if (nativeRuntime) {
    lines.push('(allow user-preference-read)');
    lines.push('(allow system-socket)');
    lines.push('(allow file-read* (literal "/usr/bin/git") (subpath "/usr/share/icu") (subpath "/private/var/db/timezone") (subpath "/Library/Developer/CommandLineTools/usr/lib") (literal "/dev/dtracehelper") (literal "/dev/autofs_nowait") (literal "/private/etc/ssl/cert.pem"))');
    lines.push('(allow file-write-data (literal "/dev/null"))');
    lines.push(`(allow file-read* (literal ${quoteSbpl(nativeRuntime.rootGitFile)})${nativeRuntime.gitReadFiles.map((value) => ` (literal ${quoteSbpl(value)})`).join('')})`);
    lines.push(`(allow file-read-data (literal ${quoteSbpl(nativeRuntime.gitDir)}) (literal ${quoteSbpl(nativeRuntime.gitCommonDir)}))`);
    lines.push(`(allow file-read* (subpath ${quoteSbpl(nativeRuntime.claudeLocksDir)}))`);
    lines.push(`(allow file-write* (subpath ${quoteSbpl(nativeRuntime.claudeLocksDir)}))`);
  }
  if (keychainHelper) {
    const helper = quoteSbpl(keychainHelper.securityHelper);
    lines.push(`(allow file-read* (require-all (subpath ${quoteSbpl(keychainHelper.keychainsDir)}) (process-path ${helper})))`);
    lines.push(`(allow file-read* (require-all (literal ${quoteSbpl(keychainHelper.userTextEncoding)}) (process-path ${helper})))`);
    lines.push(`(allow file-read* (require-all (literal ${quoteSbpl(keychainHelper.securityMessages)}) (process-path ${helper})))`);
  }
  if (claudeOAuthTokenFileDescriptor === CLAUDE_OAUTH_TOKEN_FD) {
    lines.push(`(allow file-read-data (require-all (literal "/dev/fd/${CLAUDE_OAUTH_TOKEN_FD}") (process-path ${quoteSbpl(executableReal)})))`);
  }
  if (grokHome) {
    lines.push(`(allow file-read* (subpath ${quoteSbpl(grokHome)}))`);
    lines.push(`(allow file-write* (subpath ${quoteSbpl(grokHome)}))`);
  }
  if (allowNetwork) lines.push('(allow network-outbound)');
  return Object.freeze({
    bin: SANDBOX_EXEC,
    profile: lines.join('\n') + '\n',
    root: rootReal,
    executable: executableReal,
    readPaths: reads,
    writePaths: writes,
    writeAuthorities,
    processOnlyReadPaths: credentialReads,
    processOnlyReadDirectoryPaths: processDirectoryReads,
    claudeSubscriptionConfigReadPaths: subscriptionConfigReads,
    claudeSubscriptionConfigPolicy: subscriptionConfigReads.length ? CLAUDE_SUBSCRIPTION_CONFIG_POLICY : null,
    claudeDisposableRuntimeDirReadPath: disposableRuntimeDirRead,
    claudeDisposableRuntimePolicy: disposableRuntimeDirRead ? CLAUDE_DISPOSABLE_RUNTIME_POLICY : null,
    claudeNativeRuntimePolicy: nativeRuntime ? CLAUDE_NATIVE_RUNTIME_POLICY : null,
    claudeKeychainHelperPolicy: keychainHelper ? CLAUDE_KEYCHAIN_HELPER_POLICY : null,
    claudeOAuthTokenFileDescriptor,
    grokDisposableHome: grokHome,
    grokDisposableHomePolicy: grokHome ? GROK_DISPOSABLE_HOME_POLICY : null,
  });
}

function sandboxedCommand(profile, argv = []) {
  if (!profile || profile.bin !== SANDBOX_EXEC || typeof profile.profile !== 'string') {
    throw new Error('valid OS sandbox profile is required');
  }
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) {
    throw new Error('contained argv must be a string array');
  }
  revalidateWriteAuthorities(profile.writeAuthorities, profile.root);
  return Object.freeze({
    bin: profile.bin,
    argv: ['-p', profile.profile, profile.executable, ...argv],
  });
}

/**
 * Integration API for aegis-worker.cjs. The caller must resolve the canonical
 * worktree, derive packet-relative read/write paths, and then launch only the
 * returned command/environment. Any missing path or unavailable sandbox throws.
 */
function prepareWorkerContainment({
  worktree, executable, packetReadPaths, packetWritePaths,
  claudeSubscriptionConfigReadPaths = [], claudeDisposableRuntimeDirReadPath = null,
  claudeNativeRuntime = null, claudeKeychainHelper = null, env = {},
  claudeOAuthTokenFileDescriptor = null,
  grokDisposableHome = null,
}) {
  const toWorktreePath = (value) => {
    if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) {
      throw new Error('packet path must be a non-empty POSIX path');
    }
    return path.isAbsolute(value) ? value : path.resolve(worktree, value);
  };
  const profile = buildMacSandboxProfile({
    root: worktree,
    executable,
    readPaths: packetReadPaths.map(toWorktreePath),
    writePaths: packetWritePaths.map(toWorktreePath),
    processOnlyReadPaths: [],
    claudeSubscriptionConfigReadPaths,
    claudeDisposableRuntimeDirReadPath,
    claudeNativeRuntime,
    claudeKeychainHelper,
    claudeOAuthTokenFileDescriptor,
    grokDisposableHome,
    allowNetwork: true,
  });
  assertSandboxOperational();
  return Object.freeze({
    command: sandboxedCommand(profile),
    env: strictEnvironment({ ...env, GIT_OPTIONAL_LOCKS: '0' }),
    profile,
  });
}

module.exports = {
  SANDBOX_EXEC,
  FIXED_PATH,
  sandboxCapability,
  assertSandboxOperational,
  assertInside,
  resolveWriteAuthorities,
  revalidateWriteAuthorities,
  atomicWriteTemporaryRegex,
  strictEnvironment,
  buildMacSandboxProfile,
  sandboxedCommand,
  prepareWorkerContainment,
  claudeSubscriptionConfigPaths,
  validateClaudeSubscriptionConfigPaths,
  CLAUDE_SUBSCRIPTION_CONFIG_POLICY,
  claudeDisposableRuntimeDir,
  validateClaudeDisposableRuntimeDir,
  CLAUDE_DISPOSABLE_RUNTIME_POLICY,
  claudeNativeRuntimePaths,
  validateClaudeNativeRuntime,
  CLAUDE_NATIVE_RUNTIME_POLICY,
  claudeKeychainHelperPaths,
  validateClaudeKeychainHelper,
  CLAUDE_KEYCHAIN_HELPER_POLICY,
  CLAUDE_OAUTH_TOKEN_FD,
  validateGrokDisposableHome,
  GROK_DISPOSABLE_HOME_POLICY,
};
