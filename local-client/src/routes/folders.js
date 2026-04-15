const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const AdmZip = require('adm-zip');
const exifr = require('exifr');
const config = require('../config');
const { query } = require('../db');
const sync = require('../sync');

const router = express.Router();

// Multer storage: save uploaded files into the correct subfolder of watchDir
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const folderPath = (req.params.folderPath || '').replace(/--/g, '/');
    const watchDir = path.resolve(config.watchDir);
    const dest = path.join(watchDir, folderPath);
    if (!dest.startsWith(watchDir)) {
      return cb(new Error('Invalid path'));
    }
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.raw', '.cr2', '.nef', '.arw', '.zip']);
    if (allowed.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image or zip files are allowed (' + ext + ')'));
    }
  }
});

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

// Browser-viewable image formats (TIFF/RAW can't reliably render in <img>)
const BROWSER_VIEWABLE = new Set(['.jpg', '.jpeg', '.png']);

// GET /api/folders/:folderPath/files - List photos in a folder with EXIF data
router.get('/folders/:folderPath/files', async (req, res) => {
  try {
    const folderPath = req.params.folderPath === '.' ? '' : req.params.folderPath.replace(/--/g, '/');
    const watchDir = path.resolve(config.watchDir);
    const fullPath = folderPath ? path.join(watchDir, folderPath) : watchDir;

    if (!fullPath.startsWith(watchDir)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.json([]);
    }

    let entries;
    try {
      entries = fs.readdirSync(fullPath, { withFileTypes: true });
    } catch {
      return res.json([]);
    }

    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;

      const filePath = path.join(fullPath, entry.name);
      const relativePath = folderPath ? folderPath + '/' + entry.name : entry.name;
      const stat = fs.statSync(filePath);

      // Build URL-encoded path for browser
      const urlPath = '/photos/' + relativePath.split('/').map(s => encodeURIComponent(s)).join('/');

      // Extract EXIF data
      let exif = null;
      try {
        const raw = await exifr.parse(filePath, {
          pick: ['ImageDescription', 'DateTimeOriginal', 'Make', 'Model',
                 'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'LensModel']
        });
        if (raw) {
          exif = {
            title: raw.ImageDescription || path.basename(entry.name, ext),
            dateTaken: raw.DateTimeOriginal || null,
            camera: [raw.Make, raw.Model].filter(Boolean).join(' ') || null,
            lens: raw.LensModel || null,
            exposure: raw.ExposureTime ? (raw.ExposureTime < 1 ? '1/' + Math.round(1 / raw.ExposureTime) : raw.ExposureTime + 's') : null,
            fNumber: raw.FNumber || null,
            iso: raw.ISO || null,
            focalLength: raw.FocalLength ? Math.round(raw.FocalLength) : null,
          };
        }
      } catch {
        // EXIF extraction failed — use filename as title
      }

      if (!exif) {
        exif = { title: path.basename(entry.name, ext) };
      }

      files.push({
        name: entry.name,
        relativePath,
        size: stat.size,
        url: urlPath,
        browserViewable: BROWSER_VIEWABLE.has(ext),
        exif,
      });
    }

    files.sort((a, b) => a.name.localeCompare(b.name));
    res.json(files);
  } catch (err) {
    console.error('[folders] GET files error:', err.message);
    res.status(500).json({ error: 'Failed to list files' });
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

    // Mark this path + parents as synced so the watcher doesn't duplicate
    sync.markSynced(normalized);

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

// POST /api/folders/:folderPath/check-duplicates - Check for existing filenames
router.post('/folders/:folderPath/check-duplicates', (req, res) => {
  const folderPath = (req.params.folderPath || '').replace(/--/g, '/');
  const watchDir = path.resolve(config.watchDir);
  const dest = path.join(watchDir, folderPath);

  if (!dest.startsWith(watchDir)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const filenames = req.body.filenames || [];
  const duplicates = [];
  const suggestions = {};

  for (const name of filenames) {
    if (fs.existsSync(path.join(dest, name))) {
      duplicates.push(name);
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      let counter = 1;
      let suggestion;
      do {
        suggestion = base + ' (' + counter + ')' + ext;
        counter++;
      } while (fs.existsSync(path.join(dest, suggestion)));
      suggestions[name] = suggestion;
    }
  }

  res.json({ duplicates, suggestions });
});

/**
 * Generate a unique filename in a directory by appending (1), (2), etc.
 */
function uniqueName(dir, name) {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let counter = 1;
  let candidate;
  do {
    candidate = base + ' (' + counter + ')' + ext;
    counter++;
  } while (fs.existsSync(path.join(dir, candidate)));
  return candidate;
}

// POST /api/folders/:folderPath/upload - Upload photos (and zips) to a folder
// The folderPath param uses -- as separator (since / can't be in URL params)
// e.g. POST /api/folders/2024--Milton-Varsity-Baseball/upload
router.post('/folders/:folderPath/upload', upload.array('photos', 50), async (req, res) => {
  try {
    const folderPath = req.params.folderPath.replace(/--/g, '/');
    const watchDir = path.resolve(config.watchDir);
    const dest = path.join(watchDir, folderPath);
    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    let photoCount = 0;
    let extractedCount = 0;
    const savedFiles = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.zip') {
        // Extract images from zip, then delete the zip
        const zipPath = path.join(dest, file.originalname);
        try {
          const zip = new AdmZip(zipPath);
          const entries = zip.getEntries();
          for (const entry of entries) {
            if (entry.isDirectory) continue;
            const entryName = path.basename(entry.entryName);
            if (entryName.startsWith('.')) continue;
            const entryExt = path.extname(entryName).toLowerCase();
            if (!IMAGE_EXTENSIONS.has(entryExt)) continue;

            const safeName = uniqueName(dest, entryName);
            fs.writeFileSync(path.join(dest, safeName), entry.getData());
            savedFiles.push(safeName);
            extractedCount++;
          }
        } catch (zipErr) {
          console.error('[folders] Zip extraction error:', zipErr.message);
        }
        // Remove the zip file
        try { fs.unlinkSync(zipPath); } catch (_) { /* ignore */ }
      } else {
        savedFiles.push(file.originalname);
        photoCount++;
      }
    }

    const total = photoCount + extractedCount;
    let message = total + ' photo(s) uploaded.';
    if (extractedCount > 0) {
      message = photoCount + ' photo(s) + ' + extractedCount + ' extracted from zip.';
    }
    message += ' The watcher will sync them automatically.';

    res.json({
      uploaded: total,
      photoCount,
      extractedCount,
      folder: folderPath,
      files: savedFiles,
      message,
    });
  } catch (err) {
    console.error('[folders] Upload error:', err.message);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// PUT /api/folders - Rename a folder
router.put('/folders', async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      return res.status(400).json({ error: 'oldPath and newPath are required' });
    }

    const watchDir = path.resolve(config.watchDir);
    const normalizedOld = path.normalize(oldPath).replace(/^(\.\.[/\\])+/, '');
    const normalizedNew = path.normalize(newPath).replace(/^(\.\.[/\\])+/, '');

    if (normalizedOld.includes('..') || normalizedNew.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const fullOld = path.join(watchDir, normalizedOld);
    const fullNew = path.join(watchDir, normalizedNew);

    if (!fullOld.startsWith(watchDir) || !fullNew.startsWith(watchDir)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!fs.existsSync(fullOld)) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    if (fs.existsSync(fullNew)) {
      return res.status(409).json({ error: 'A folder with that name already exists' });
    }

    // Ensure parent of new path exists
    fs.mkdirSync(path.dirname(fullNew), { recursive: true });
    fs.renameSync(fullOld, fullNew);

    // Update sync_log entries that reference the old path
    await query(
      `UPDATE sync_log
       SET file_path = REPLACE(file_path, $1, $2),
           relative_path = REPLACE(relative_path, $3, $4)
       WHERE relative_path LIKE $5`,
      [fullOld, fullNew, normalizedOld, normalizedNew, normalizedOld + '%']
    );

    // Propagate rename to remote server
    sync.syncRenameFolder(normalizedOld, normalizedNew).catch(function (err) {
      console.error('[folders] Remote folder rename failed:', err.message);
    });

    res.json({ oldPath: normalizedOld, newPath: normalizedNew, message: 'Folder renamed' });
  } catch (err) {
    console.error('[folders] PUT error:', err.message);
    res.status(500).json({ error: 'Failed to rename folder' });
  }
});

// DELETE /api/folders - Delete a folder and its contents
router.delete('/folders', async (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath || typeof folderPath !== 'string') {
      return res.status(400).json({ error: 'folderPath is required' });
    }

    if (folderPath === '.') {
      return res.status(400).json({ error: 'Cannot delete the root watch directory' });
    }

    const normalized = path.normalize(folderPath).replace(/^(\.\.[/\\])+/, '');
    if (normalized.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const watchDir = path.resolve(config.watchDir);
    const fullPath = path.join(watchDir, normalized);

    if (!fullPath.startsWith(watchDir) || fullPath === watchDir) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    // Count files being deleted for the warning response
    let deletedFiles = 0;
    function countFiles(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) deletedFiles++;
        else if (entry.isDirectory()) countFiles(path.join(dir, entry.name));
      }
    }
    countFiles(fullPath);

    // Remove directory and all contents
    fs.rmSync(fullPath, { recursive: true, force: true });

    // Clean up sync_log entries for deleted files
    await query(
      `DELETE FROM sync_log WHERE relative_path LIKE $1`,
      [normalized + '%']
    );

    // Propagate deletion to remote server
    sync.syncDeleteFolder(normalized).catch(function (err) {
      console.error('[folders] Remote folder delete failed:', err.message);
    });

    res.json({
      relativePath: normalized,
      deletedFiles,
      message: 'Folder and ' + deletedFiles + ' file(s) deleted',
    });
  } catch (err) {
    console.error('[folders] DELETE error:', err.message);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// DELETE /api/folders/:folderPath/photos/:photoName - Delete a single photo
router.delete('/folders/:folderPath/photos/:photoName', async (req, res) => {
  try {
    const folderPath = req.params.folderPath === '.' ? '' : req.params.folderPath.replace(/--/g, '/');
    const photoName = req.params.photoName;

    if (!photoName || photoName.includes('/') || photoName.includes('..')) {
      return res.status(400).json({ error: 'Invalid photo name' });
    }

    const watchDir = path.resolve(config.watchDir);
    const fullPath = folderPath
      ? path.join(watchDir, folderPath, photoName)
      : path.join(watchDir, photoName);

    if (!fullPath.startsWith(watchDir)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    fs.unlinkSync(fullPath);

    // Clean up sync_log entry
    const relativePath = folderPath ? folderPath + '/' + photoName : photoName;
    await query(
      `DELETE FROM sync_log WHERE relative_path = $1`,
      [relativePath]
    );

    // Propagate deletion to remote server
    sync.syncDeletePhoto(relativePath).catch(function (err) {
      console.error('[folders] Remote photo delete failed:', err.message);
    });

    res.json({ message: 'Photo deleted', relativePath });
  } catch (err) {
    console.error('[folders] DELETE photo error:', err.message);
    res.status(500).json({ error: 'Failed to delete photo' });
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
