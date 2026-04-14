const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { query } = require('../db');
const sync = require('../sync');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.raw', '.cr2', '.nef', '.arw',
]);

/**
 * Recursively scan a directory and return a list of folder descriptors.
 */
function scanDirectorySync(rootDir) {
  const folders = [];
  const root = path.resolve(rootDir);

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const relativePath = path.relative(root, dir) || '.';
    let fileCount = 0;

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          fileCount++;
        }
      }
    }

    folders.push({ relativePath, fileCount });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      }
    }
  }

  walk(root);
  return folders;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/folders - List folders in the watch directory with sync info
router.get('/folders', async (req, res) => {
  try {
    const watchDir = path.resolve(config.watchDir);

    if (!fs.existsSync(watchDir)) {
      return res.json([]);
    }

    const folders = scanDirectorySync(watchDir);

    // Fetch gallery URLs from sync_log for synced files
    const syncedResult = await query(
      `SELECT DISTINCT ON (
         CASE
           WHEN relative_path LIKE '%/%' THEN substring(relative_path FROM '^(.+)/[^/]+$')
           ELSE '.'
         END
       )
       CASE
         WHEN relative_path LIKE '%/%' THEN substring(relative_path FROM '^(.+)/[^/]+$')
         ELSE '.'
       END AS folder_rel,
       remote_url
       FROM sync_log
       WHERE status = 'synced' AND remote_url IS NOT NULL
       ORDER BY folder_rel, synced_at DESC`
    );

    const galleryMap = {};
    for (const row of syncedResult.rows) {
      galleryMap[row.folder_rel] = row.remote_url;
    }

    const result = folders.map((f) => ({
      ...f,
      galleryUrl: galleryMap[f.relativePath] || null,
    }));

    res.json(result);
  } catch (err) {
    console.error('[folders] GET error:', err.message);
    res.status(500).json({ error: 'Failed to list folders' });
  }
});

// POST /api/folders - Create a new folder in the watch directory
router.post('/folders', async (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath || typeof folderPath !== 'string') {
      return res.status(400).json({ error: 'folderPath is required' });
    }

    // Sanitize: no path traversal
    const normalized = path.normalize(folderPath).replace(/^(\.\.[/\\])+/, '');
    if (normalized.startsWith('/') || normalized.includes('..')) {
      return res.status(400).json({ error: 'Invalid folder path' });
    }

    const watchDir = path.resolve(config.watchDir);
    const fullPath = path.join(watchDir, normalized);

    // Ensure it stays within the watch directory
    if (!fullPath.startsWith(watchDir)) {
      return res.status(400).json({ error: 'Invalid folder path' });
    }

    // Create the directory (recursive for nested paths like 2024/Football/Game1)
    fs.mkdirSync(fullPath, { recursive: true });

    // Sync folder to remote server
    let galleryUrl = null;
    try {
      const result = await sync.syncFolder(normalized);
      if (result && result.galleryUrl) {
        galleryUrl = config.remote.url + result.galleryUrl;
      }
    } catch (syncErr) {
      console.error('[folders] Remote sync failed:', syncErr.message);
      // Folder is created locally even if remote sync fails
    }

    res.status(201).json({
      relativePath: normalized,
      fullPath,
      galleryUrl,
      message: 'Folder created' + (galleryUrl ? ' and synced' : ' locally (remote sync pending)'),
    });
  } catch (err) {
    console.error('[folders] POST error:', err.message);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// GET /api/sync-status - Sync queue and log status
router.get('/sync-status', async (req, res) => {
  try {
    const queueStatus = sync.getStatus();

    // Recent sync log entries
    const recentResult = await query(
      `SELECT id, file_path, relative_path, status, remote_url, attempts, last_error, created_at, synced_at
       FROM sync_log
       ORDER BY created_at DESC
       LIMIT 50`
    );

    // Summary counts
    const summaryResult = await query(
      `SELECT status, COUNT(*)::int AS count
       FROM sync_log
       GROUP BY status`
    );

    const summary = { pending: 0, syncing: 0, synced: 0, failed: 0 };
    for (const row of summaryResult.rows) {
      summary[row.status] = row.count;
    }

    res.json({
      queue: queueStatus,
      recent: recentResult.rows,
      summary,
    });
  } catch (err) {
    console.error('[sync-status] GET error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sync status' });
  }
});

module.exports = router;
