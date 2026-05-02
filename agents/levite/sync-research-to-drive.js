#!/usr/bin/env node
/**
 * sync-research-to-drive.js
 * Levite (Vault Keeper) — Google Drive sync tool
 *
 * Syncs /luke-app/research/peptides/ → Google Drive: Vitalis Research / Master / Peptides/
 * Idempotent: filename-match strategy, never deletes Drive files.
 * Auth: OAuth2 refresh token (stored in Doppler, never in source).
 *
 * Doppler keys required:
 *   GOOGLE_DRIVE_CLIENT_ID
 *   GOOGLE_DRIVE_CLIENT_SECRET
 *   GOOGLE_DRIVE_REFRESH_TOKEN
 *   GOOGLE_DRIVE_MARC_EMAIL          (marc@cornerstoneregroup.ca — granted editor on bootstrap)
 *
 * Exit codes:
 *   0  — success
 *   1  — auth failure
 *   2  — Drive API error
 *   3  — filesystem read error
 *   4  — missing env vars
 *
 * Usage:
 *   node sync-research-to-drive.js [--dry-run]
 *
 * Called by Vault Keeper via: levite.callTool("sync-research-to-drive", { dryRun: false })
 */

"use strict";

const fs    = require("fs");
const path  = require("path");
const https = require("https");

// ─── Config ──────────────────────────────────────────────────────────────────

const SOURCE_DIR = path.resolve(
  __dirname, "../../luke-app/research/peptides"
);

const DRIVE_ROOT_NAME   = "Vitalis Research";
const DRIVE_MASTER_NAME = "Master";
const DRIVE_LEAF_NAME   = "Peptides";

const LOG_FILE = path.resolve(__dirname, "sync-log.json");

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Env validation ──────────────────────────────────────────────────────────

const REQUIRED_ENV = [
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_DRIVE_MARC_EMAIL",
];

function validateEnv() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(
      `[levite:sync] FATAL — missing Doppler env vars: ${missing.join(", ")}\n` +
      "  Run: doppler run -- node sync-research-to-drive.js\n" +
      "  Or set vars manually for testing (never in plaintext in source)."
    );
    process.exit(4);
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

// ─── OAuth2 ──────────────────────────────────────────────────────────────────

let _accessToken = null;

async function getAccessToken() {
  if (_accessToken) return _accessToken;

  const body = new URLSearchParams({
    client_id:     process.env.GOOGLE_DRIVE_CLIENT_ID,
    client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
    grant_type:    "refresh_token",
  }).toString();

  const res = await httpsRequest(
    {
      hostname: "oauth2.googleapis.com",
      path:     "/token",
      method:   "POST",
      headers:  {
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    },
    body
  );

  if (res.status !== 200 || !res.body.access_token) {
    console.error("[levite:sync] OAuth refresh failed:", JSON.stringify(res.body));
    process.exit(1);
  }

  _accessToken = res.body.access_token;
  return _accessToken;
}

// ─── Drive API wrappers ───────────────────────────────────────────────────────

async function driveGet(path_) {
  const token = await getAccessToken();
  return httpsRequest({
    hostname: "www.googleapis.com",
    path:     path_,
    method:   "GET",
    headers:  { Authorization: `Bearer ${token}` },
  });
}

async function drivePost(path_, bodyObj, contentType = "application/json") {
  const token = await getAccessToken();
  const body  = JSON.stringify(bodyObj);
  return httpsRequest(
    {
      hostname: "www.googleapis.com",
      path:     path_,
      method:   "POST",
      headers:  {
        Authorization:  `Bearer ${token}`,
        "Content-Type": contentType,
        "Content-Length": Buffer.byteLength(body),
      },
    },
    body
  );
}

// ─── Folder helpers ───────────────────────────────────────────────────────────

/**
 * Find a Drive folder by name under a given parent.
 * Returns the folder ID or null.
 */
async function findFolder(name, parentId) {
  const q = encodeURIComponent(
    `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
  );
  const res = await driveGet(`/drive/v3/files?q=${q}&fields=files(id,name)`);
  if (res.status !== 200) {
    console.error("[levite:sync] Drive list error:", res.body);
    process.exit(2);
  }
  return res.body.files && res.body.files.length > 0
    ? res.body.files[0].id
    : null;
}

/**
 * Create a folder under parentId. Returns the new folder ID.
 */
async function createFolder(name, parentId) {
  const res = await drivePost("/drive/v3/files?fields=id", {
    name:     name,
    mimeType: "application/vnd.google-apps.folder",
    parents:  [parentId],
  });
  if (res.status !== 200) {
    console.error("[levite:sync] Failed to create folder:", name, res.body);
    process.exit(2);
  }
  return res.body.id;
}

/**
 * Share a file/folder with an email as role.
 */
async function shareWith(fileId, email, role = "writer") {
  const token = await getAccessToken();
  const body  = JSON.stringify({ role, type: "user", emailAddress: email });
  await httpsRequest(
    {
      hostname: "www.googleapis.com",
      path:     `/drive/v3/files/${fileId}/permissions`,
      method:   "POST",
      headers:  {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    },
    body
  );
}

/**
 * Bootstrap: ensure Vitalis Research / Master / Peptides/ exists.
 * Returns the Peptides folder ID.
 */
async function bootstrapFolders() {
  // Start from Drive root ("root")
  let rootId = await findFolder(DRIVE_ROOT_NAME, "root");
  if (!rootId) {
    console.log(`[levite:sync] Creating folder: ${DRIVE_ROOT_NAME}`);
    if (!DRY_RUN) {
      rootId = await createFolder(DRIVE_ROOT_NAME, "root");
      await shareWith(rootId, process.env.GOOGLE_DRIVE_MARC_EMAIL, "writer");
    } else {
      rootId = "DRY_RUN_ROOT_ID";
    }
  }

  let masterId = await findFolder(DRIVE_MASTER_NAME, rootId);
  if (!masterId) {
    console.log(`[levite:sync] Creating folder: ${DRIVE_MASTER_NAME}`);
    if (!DRY_RUN) {
      masterId = await createFolder(DRIVE_MASTER_NAME, rootId);
    } else {
      masterId = "DRY_RUN_MASTER_ID";
    }
  }

  let peptidesId = await findFolder(DRIVE_LEAF_NAME, masterId);
  if (!peptidesId) {
    console.log(`[levite:sync] Creating folder: ${DRIVE_LEAF_NAME}`);
    if (!DRY_RUN) {
      peptidesId = await createFolder(DRIVE_LEAF_NAME, masterId);
    } else {
      peptidesId = "DRY_RUN_PEPTIDES_ID";
    }
    // Write README on first bootstrap
    await uploadReadme(peptidesId);
  }

  return peptidesId;
}

// ─── File upload helpers ──────────────────────────────────────────────────────

/**
 * List all non-trashed files in a Drive folder.
 * Returns Map<filename, fileId>
 */
async function listDriveFiles(folderId) {
  const q = encodeURIComponent(
    `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`
  );
  const res = await driveGet(
    `/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1000`
  );
  if (res.status !== 200) {
    console.error("[levite:sync] Drive list error:", res.body);
    process.exit(2);
  }
  const map = new Map();
  for (const f of res.body.files || []) {
    map.set(f.name, f.id);
  }
  return map;
}

/**
 * Multipart upload a file to Drive (create or update by ID).
 */
async function uploadFile(localPath, filename, folderId, existingId) {
  const token    = await getAccessToken();
  const content  = fs.readFileSync(localPath);
  const mimeType = "text/markdown";

  const boundary = "levite_boundary_" + Date.now();
  const metadata = JSON.stringify(
    existingId
      ? { name: filename }                          // update — no parents
      : { name: filename, parents: [folderId] }     // create
  );

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const apiPath = existingId
    ? `/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id`
    : `/upload/drive/v3/files?uploadType=multipart&fields=id`;

  const method = existingId ? "PATCH" : "POST";

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "www.googleapis.com",
        path:     apiPath,
        method,
        headers:  {
          Authorization:  `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function uploadReadme(folderId) {
  const readme = `# Vitalis Research — Master Peptide Store

Mirrored from local Luke-app at:
  ~/.openclaw/workspace/luke-app/research/peptides/

**DO NOT EDIT FILES HERE.**
Edits will be overwritten on the next Levite sync run.

Single source of truth = local PC (Git-versioned in the luke-app repo).
Sync is push-only (never destructive — local is authoritative).

Last bootstrapped by: Levite (Vault Keeper) sync-research-to-drive.js
`;
  const tmpPath = path.join(require("os").tmpdir(), "_README.md");
  fs.writeFileSync(tmpPath, readme, "utf8");
  if (!DRY_RUN) {
    await uploadFile(tmpPath, "_README.md", folderId, null);
  }
  console.log("[levite:sync] Wrote _README.md to Drive folder");
  fs.unlinkSync(tmpPath);
}

// ─── Logging ─────────────────────────────────────────────────────────────────

function appendLog(entry) {
  let log = [];
  try {
    log = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  } catch { /* first run */ }
  log.push(entry);
  // Keep last 500 entries
  if (log.length > 500) log = log.slice(-500);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), "utf8");
}

// ─── Main sync ────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[levite:sync] Started at ${startedAt}${DRY_RUN ? " (DRY RUN)" : ""}`);

  validateEnv();

  // Read local source files
  let localFiles;
  try {
    localFiles = fs.readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".md"));
  } catch (err) {
    console.error("[levite:sync] Cannot read source directory:", err.message);
    process.exit(3);
  }
  console.log(`[levite:sync] Source files: ${localFiles.length}`);

  // Bootstrap Drive folders
  const peptidesId = await bootstrapFolders();
  console.log(`[levite:sync] Target Drive folder ID: ${peptidesId}`);

  // Get existing Drive files for idempotency
  const existing = DRY_RUN ? new Map() : await listDriveFiles(peptidesId);
  console.log(`[levite:sync] Existing Drive files: ${existing.size}`);

  // Sync
  let created  = 0;
  let updated  = 0;
  let bytesTotal = 0;
  const errors = [];

  for (const filename of localFiles) {
    const localPath = path.join(SOURCE_DIR, filename);
    const stat      = fs.statSync(localPath);
    bytesTotal += stat.size;

    if (DRY_RUN) {
      const action = existing.has(filename) ? "UPDATE" : "CREATE";
      console.log(`[levite:sync:dry-run] ${action} ${filename} (${stat.size}B)`);
      if (existing.has(filename)) updated++; else created++;
      continue;
    }

    try {
      const existingId = existing.get(filename) || null;
      const action     = existingId ? "UPDATE" : "CREATE";
      const res = await uploadFile(localPath, filename, peptidesId, existingId);

      if (res.status !== 200) {
        console.error(`[levite:sync] ${action} failed for ${filename}: status ${res.status}`);
        errors.push({ filename, status: res.status });
      } else {
        console.log(`[levite:sync] ${action} ${filename} → ${res.body.id}`);
        if (existingId) updated++; else created++;
      }
    } catch (err) {
      console.error(`[levite:sync] Upload error for ${filename}:`, err.message);
      errors.push({ filename, error: err.message });
    }
  }

  const finishedAt = new Date().toISOString();
  const logEntry   = {
    timestamp:   finishedAt,
    dryRun:      DRY_RUN,
    sourceDir:   SOURCE_DIR,
    driveFolder: `${DRIVE_ROOT_NAME} / ${DRIVE_MASTER_NAME} / ${DRIVE_LEAF_NAME}`,
    folderId:    peptidesId,
    fileCount:   localFiles.length,
    created,
    updated,
    bytesTransferred: bytesTotal,
    errors:      errors.length > 0 ? errors : [],
    status:      errors.length === 0 ? "ok" : "partial",
  };

  appendLog(logEntry);

  console.log(
    `[levite:sync] Done — ${created} created, ${updated} updated, ` +
    `${errors.length} errors, ${(bytesTotal / 1024).toFixed(1)} KB`
  );

  if (errors.length > 0) {
    console.error("[levite:sync] Errors:", JSON.stringify(errors));
    process.exit(2);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[levite:sync] Unhandled error:", err);
  process.exit(2);
});
