const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const config = require('./config');
const { query } = require('./db');

// ---------------------------------------------------------------------------
// Internal queue state
// ---------------------------------------------------------------------------
const queue = [];
let processing = false;
let totalSynced = 0;
let totalFailed = 0;

// Track recently synced folders to prevent duplicate sync from watcher + route
const recentFolderSyncs = new Map(); // relativePath -> timestamp
const FOLDER_DEDUP_TTL = 10000; // 10 seconds

const recentDeletes = new Map();
const DELETE_DEDUP_TTL = 10000;

// Retry back-off schedule in milliseconds
const RETRY_DELAYS = [1000, 3000, 9000];
const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiHeaders() {
  return { 'X-API-Key': config.remote.apiKey };
}

// ---------------------------------------------------------------------------
// Core sync operations
// ---------------------------------------------------------------------------

/**
 * Upload a single file to the remote server.
 * Implements retry logic with exponential back-off (1s, 3s, 9s).
 *
 * @param {string} absolutePath - Full path to the local file
 * @param {string} relativePath - Path relative to the watch directory
 * @returns {Promise<Object|null>} Server response data or null on failure
 */
async function syncFile(absolutePath, relativePath) {
  // Mark as syncing
  await query(
    `UPDATE sync_log SET status = 'syncing' WHERE file_path = $1`,
    [absolutePath]
  );

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Update attempt counter
      await query(
        `UPDATE sync_log SET attempts = $1 WHERE file_path = $2`,
        [attempt, absolutePath]
      );

      const form = new FormData();
      form.append('file', fs.createReadStream(absolutePath));
      form.append('relativePath', relativePath);

      const response = await axios.post(
        `${config.remote.url}/api/upload`,
        form,
        {
          headers: {
            ...apiHeaders(),
            ...form.getHeaders(),
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 120000, // 2 minutes for large files
        }
      );

      const data = response.data;

      // Build the gallery URL from the response
      const remoteUrl = data.galleryUrl || `${config.remote.url}/gallery/${data.folderUuid}`;

      await query(
        `UPDATE sync_log
         SET status = 'synced', remote_url = $1, synced_at = NOW(), last_error = NULL
         WHERE file_path = $2`,
        [remoteUrl, absolutePath]
      );

      totalSynced++;
      console.log(`[sync] Synced: ${relativePath}`);
      return data;
    } catch (err) {
      const errorMsg = err.response
        ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
        : err.message;

      console.error(
        `[sync] Attempt ${attempt}/${MAX_ATTEMPTS} failed for ${relativePath}: ${errorMsg}`
      );

      await query(
        `UPDATE sync_log SET last_error = $1 WHERE file_path = $2`,
        [errorMsg, absolutePath]
      );

      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS[attempt - 1] || 9000;
        console.log(`[sync] Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        // Final failure
        await query(
          `UPDATE sync_log SET status = 'failed' WHERE file_path = $1`,
          [absolutePath]
        );
        totalFailed++;
        console.error(`[sync] Failed permanently: ${relativePath}`);
        return null;
      }
    }
  }

  return null;
}

/**
 * Register a folder with the remote server.
 *
 * @param {string} relativePath - Folder path relative to the watch directory
 * @returns {Promise<Object|null>} Server response or null on failure
 */
async function syncFolder(relativePath) {
  // Deduplicate: skip if this folder was synced very recently
  const lastSync = recentFolderSyncs.get(relativePath);
  if (lastSync && Date.now() - lastSync < FOLDER_DEDUP_TTL) {
    console.log(`[sync] Skipping duplicate folder sync: ${relativePath}`);
    return null;
  }
  recentFolderSyncs.set(relativePath, Date.now());

  try {
    const form = new FormData();
    form.append('relativePath', relativePath);

    const response = await axios.post(
      `${config.remote.url}/api/folders`,
      form,
      {
        headers: {
          ...apiHeaders(),
          ...form.getHeaders(),
        },
        timeout: 15000,
      }
    );

    console.log(`[sync] Folder registered: ${relativePath}`);
    return response.data;
  } catch (err) {
    const errorMsg = err.response
      ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    console.error(`[sync] Folder sync failed for ${relativePath}: ${errorMsg}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Queue mechanism
// ---------------------------------------------------------------------------

/**
 * Add a file to the sync queue.
 *
 * @param {string} absolutePath
 * @param {string} relativePath
 */
function addToQueue(absolutePath, relativePath) {
  queue.push({ absolutePath, relativePath });
  console.log(`[sync] Queued: ${relativePath} (queue size: ${queue.length})`);
  processQueue();
}

/**
 * Process the sync queue one item at a time.
 */
async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const item = queue.shift();
    try {
      await syncFile(item.absolutePath, item.relativePath);
    } catch (err) {
      console.error(`[sync] Unexpected queue error for ${item.relativePath}:`, err.message);
    }
  }

  processing = false;
}

/**
 * Get the current status of the sync system.
 *
 * @returns {{ queueLength: number, processing: boolean, totalSynced: number, totalFailed: number }}
 */
function getStatus() {
  return {
    queueLength: queue.length,
    processing,
    totalSynced,
    totalFailed,
  };
}

/**
 * Mark a folder path and all its parent paths as recently synced.
 * Prevents the watcher from re-syncing intermediate directories
 * when mkdir -p creates a nested path.
 */
function markSynced(relativePath) {
  const parts = relativePath.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const partial = parts.slice(0, i).join('/');
    recentFolderSyncs.set(partial, Date.now());
  }
}

async function syncDeletePhoto(relativePath) {
  var key = 'photo:' + relativePath;
  if (recentDeletes.has(key) && Date.now() - recentDeletes.get(key) < DELETE_DEDUP_TTL) {
    console.log('[sync] Skipping duplicate photo delete: ' + relativePath);
    return null;
  }
  recentDeletes.set(key, Date.now());

  try {
    var response = await axios.delete(config.remote.url + '/api/photos', {
      headers: apiHeaders(),
      params: { relativePath: relativePath },
      timeout: 15000,
    });
    console.log('[sync] Remote photo deleted: ' + relativePath);
    return response.data;
  } catch (err) {
    var errorMsg = err.response
      ? 'HTTP ' + err.response.status + ': ' + JSON.stringify(err.response.data)
      : err.message;
    console.error('[sync] Remote photo delete failed for ' + relativePath + ': ' + errorMsg);
    return null;
  }
}

async function syncDeleteFolder(relativePath) {
  var key = 'folder:' + relativePath;
  if (recentDeletes.has(key) && Date.now() - recentDeletes.get(key) < DELETE_DEDUP_TTL) {
    console.log('[sync] Skipping duplicate folder delete: ' + relativePath);
    return null;
  }
  recentDeletes.set(key, Date.now());

  try {
    var response = await axios.delete(config.remote.url + '/api/folders', {
      headers: apiHeaders(),
      params: { relativePath: relativePath },
      timeout: 15000,
    });
    console.log('[sync] Remote folder deleted: ' + relativePath);
    return response.data;
  } catch (err) {
    var errorMsg = err.response
      ? 'HTTP ' + err.response.status + ': ' + JSON.stringify(err.response.data)
      : err.message;
    console.error('[sync] Remote folder delete failed for ' + relativePath + ': ' + errorMsg);
    return null;
  }
}

async function syncRenameFolder(oldPath, newPath) {
  try {
    var response = await axios.put(config.remote.url + '/api/folders/rename', null, {
      headers: apiHeaders(),
      params: { oldPath: oldPath, newPath: newPath },
      timeout: 15000,
    });
    console.log('[sync] Remote folder renamed: ' + oldPath + ' -> ' + newPath);
    return response.data;
  } catch (err) {
    var errorMsg = err.response
      ? 'HTTP ' + err.response.status + ': ' + JSON.stringify(err.response.data)
      : err.message;
    console.error('[sync] Remote folder rename failed for ' + oldPath + ': ' + errorMsg);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reconciliation – force remote to mirror local filesystem on startup
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.raw', '.cr2', '.nef', '.arw',
]);

/**
 * Scan the local watch directory and return Sets of relative paths for all
 * folders and image files found on disk.
 *
 * @returns {{ folders: Set<string>, photos: Set<string> }}
 */
function scanLocalState() {
  const watchDir = path.resolve(config.watchDir);
  const folders = new Set();
  const photos = new Set();

  function scan(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(watchDir, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        folders.add(rel);
        scan(full);
      } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        photos.add(rel);
      }
    }
  }

  scan(watchDir);
  return { folders, photos };
}

/**
 * Reconcile remote state with the local filesystem.
 *
 * - Remote folders not present locally are deleted from the remote.
 * - Remote photos not present locally are deleted from the remote.
 * - Local folders not present on remote are created.
 * - Local photos not present on remote are queued for upload.
 */
async function reconcile() {
  console.log('[sync] Reconciliation starting...');

  let remoteState;
  try {
    const response = await axios.get(config.remote.url + '/api/sync/state', {
      headers: apiHeaders(),
      timeout: 30000,
    });
    remoteState = response.data;
  } catch (err) {
    console.error('[sync] Reconciliation failed - cannot reach remote:', err.message);
    return;
  }

  const local = scanLocalState();
  let foldersRemoved = 0;
  let photosRemoved = 0;
  let photosQueued = 0;

  // Delete remote folders not in local
  for (const rf of remoteState.folders) {
    if (!local.folders.has(rf.relativePath)) {
      console.log('[sync] Removing stale remote folder: ' + rf.relativePath);
      await syncDeleteFolder(rf.relativePath);
      foldersRemoved++;
    } else {
      // Check photos in this folder
      for (const photoPath of rf.photos) {
        if (!local.photos.has(photoPath)) {
          console.log('[sync] Removing stale remote photo: ' + photoPath);
          await syncDeletePhoto(photoPath);
          photosRemoved++;
        }
      }
    }
  }

  // Create local folders not in remote
  const remoteFolderPaths = new Set(remoteState.folders.map(function (f) { return f.relativePath; }));
  for (const localFolder of local.folders) {
    if (!remoteFolderPaths.has(localFolder)) {
      console.log('[sync] Creating missing remote folder: ' + localFolder);
      await syncFolder(localFolder);
    }
  }

  // Queue local photos not in remote
  const remotePhotoPaths = new Set();
  for (const rf of remoteState.folders) {
    for (const p of rf.photos) {
      remotePhotoPaths.add(p);
    }
  }
  const watchDir = path.resolve(config.watchDir);
  for (const localPhoto of local.photos) {
    if (!remotePhotoPaths.has(localPhoto)) {
      console.log('[sync] Queuing missing photo for upload: ' + localPhoto);
      const absPath = path.join(watchDir, localPhoto);
      addToQueue(absPath, localPhoto);
      photosQueued++;
    }
  }

  console.log(
    '[sync] Reconciliation complete: ' +
      foldersRemoved + ' folders removed, ' +
      photosRemoved + ' photos removed, ' +
      photosQueued + ' photos queued for upload'
  );
}

module.exports = {
  syncFile,
  syncFolder,
  syncDeletePhoto,
  syncDeleteFolder,
  syncRenameFolder,
  addToQueue,
  processQueue,
  getStatus,
  markSynced,
  reconcile,
};
