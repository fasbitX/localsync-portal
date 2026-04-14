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

module.exports = {
  syncFile,
  syncFolder,
  addToQueue,
  processQueue,
  getStatus,
};
