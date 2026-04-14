const path = require('path');
const chokidar = require('chokidar');
const config = require('./config');
const { query } = require('./db');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.raw', '.cr2', '.nef', '.arw',
]);

const IGNORED_FILES = new Set(['.ds_store', 'thumbs.db']);

/**
 * Determine whether a file should be tracked by the sync system.
 * @param {string} filePath - Absolute path to the file
 * @returns {boolean}
 */
function isImageFile(filePath) {
  const basename = path.basename(filePath);

  // Ignore dot-files and known OS junk
  if (basename.startsWith('.')) return false;
  if (IGNORED_FILES.has(basename.toLowerCase())) return false;

  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Compute the relative path of a file within the watch directory.
 * @param {string} absolutePath
 * @returns {string}
 */
function relativePath(absolutePath) {
  const watchAbsolute = path.resolve(config.watchDir);
  return path.relative(watchAbsolute, absolutePath);
}

/**
 * Start watching the configured directory for new photos.
 *
 * @param {Object} callbacks
 * @param {function(string, string): void} callbacks.onFile  - (absolutePath, relativePath)
 * @param {function(string): void}         callbacks.onDir   - (relativePath)
 * @returns {import('chokidar').FSWatcher}
 */
function startWatcher(callbacks) {
  const watchPath = path.resolve(config.watchDir);
  console.log(`[watcher] Watching directory: ${watchPath}`);

  const watcher = chokidar.watch(watchPath, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 200,
    },
    ignored: [
      /(^|[/\\])\../, // dot-files / dot-directories
      /[Tt]humbs\.db$/,
    ],
    depth: 99,
  });

  watcher.on('add', async (filePath) => {
    if (!isImageFile(filePath)) return;

    const relPath = relativePath(filePath);
    console.log(`[watcher] New file detected: ${relPath}`);

    try {
      // Check if already in sync_log to avoid duplicates on restart
      const existing = await query(
        'SELECT id FROM sync_log WHERE file_path = $1',
        [filePath]
      );
      if (existing.rows.length > 0) return;

      await query(
        `INSERT INTO sync_log (file_path, relative_path, status) VALUES ($1, $2, 'pending')`,
        [filePath, relPath]
      );

      if (callbacks && typeof callbacks.onFile === 'function') {
        callbacks.onFile(filePath, relPath);
      }
    } catch (err) {
      console.error(`[watcher] Error processing file ${relPath}:`, err.message);
    }
  });

  // Debounce directory events to batch-detect parent vs. leaf directories.
  // When mkdir -p creates 2026/Milton-Varsity-Baseball, chokidar fires addDir
  // for both "2026" and "2026/Milton-Varsity-Baseball". We only want to sync
  // the leaf directory, not the intermediate parent.
  let pendingDirs = [];
  let dirDebounceTimer = null;
  const DIR_DEBOUNCE_MS = 800;

  function flushPendingDirs() {
    if (pendingDirs.length === 0) return;

    // Filter out any directory that is a parent of another detected directory
    const dirs = pendingDirs.slice();
    pendingDirs = [];

    const leafDirs = dirs.filter(function (dir) {
      return !dirs.some(function (other) {
        return other !== dir && other.startsWith(dir + '/');
      });
    });

    const skipped = dirs.length - leafDirs.length;
    if (skipped > 0) {
      console.log(`[watcher] Skipped ${skipped} intermediate parent director${skipped === 1 ? 'y' : 'ies'}`);
    }

    leafDirs.forEach(function (relPath) {
      if (callbacks && typeof callbacks.onDir === 'function') {
        callbacks.onDir(relPath);
      }
    });
  }

  watcher.on('addDir', (dirPath) => {
    const watchAbsolute = path.resolve(config.watchDir);
    // Skip the root watch directory itself
    if (path.resolve(dirPath) === watchAbsolute) return;

    const relPath = relativePath(dirPath);
    console.log(`[watcher] New directory detected: ${relPath}`);

    pendingDirs.push(relPath);
    clearTimeout(dirDebounceTimer);
    dirDebounceTimer = setTimeout(flushPendingDirs, DIR_DEBOUNCE_MS);
  });

  watcher.on('ready', () => {
    console.log('[watcher] Initial scan complete. Watching for changes...');
  });

  watcher.on('error', (err) => {
    console.error('[watcher] Error:', err.message);
  });

  return watcher;
}

module.exports = { startWatcher };
