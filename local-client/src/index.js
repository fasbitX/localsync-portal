require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { pool } = require('./db');
const { startWatcher } = require('./watcher');
const sync = require('./sync');

// Route modules
const contactsRouter = require('./routes/contacts');
const invitesRouter = require('./routes/invites');
const foldersRouter = require('./routes/folders');

// ---------------------------------------------------------------------------
// Express setup
// ---------------------------------------------------------------------------

const app = express();

app.use(cors());
app.use(express.json());

// Serve the local dashboard UI
app.use(express.static(path.join(__dirname, 'ui')));

// Serve photos from watch directory for thumbnail display
app.use('/photos', express.static(path.resolve(config.watchDir)));

// Mount API routes
app.use('/api', contactsRouter);
app.use('/api', invitesRouter);
app.use('/api', foldersRouter);

// Fallback: serve index.html for SPA-style navigation
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'ui', 'index.html'));
});

// ---------------------------------------------------------------------------
// File watcher
// ---------------------------------------------------------------------------

let watcher;

function boot() {
  watcher = startWatcher({
    onFile: (absolutePath, relativePath) => {
      sync.addToQueue(absolutePath, relativePath);
    },
    onDir: (relativePath) => {
      sync.syncFolder(relativePath).catch((err) => {
        console.error(`[main] Folder sync error for ${relativePath}:`, err.message);
      });
    },
    onFileDelete: (relativePath) => {
      sync.syncDeletePhoto(relativePath).catch((err) => {
        console.error(`[main] Remote photo delete error for ${relativePath}:`, err.message);
      });
    },
    onDirDelete: (relativePath) => {
      sync.syncDeleteFolder(relativePath).catch((err) => {
        console.error(`[main] Remote folder delete error for ${relativePath}:`, err.message);
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const server = app.listen(config.port, () => {
  console.log('');
  console.log('============================================');
  console.log('   LocalSync Portal - Local Client');
  console.log('============================================');
  console.log(`   Dashboard : http://localhost:${config.port}`);
  console.log(`   Watch dir : ${path.resolve(config.watchDir)}`);
  console.log(`   Remote    : ${config.remote.url}`);
  console.log('============================================');
  console.log('');
  boot();
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal) {
  console.log(`\n[main] Received ${signal}. Shutting down gracefully...`);

  if (watcher) {
    watcher.close().then(() => {
      console.log('[main] File watcher closed.');
    });
  }

  server.close(() => {
    console.log('[main] HTTP server closed.');
    pool.end().then(() => {
      console.log('[main] Database pool closed.');
      process.exit(0);
    });
  });

  // Force exit after 5 seconds if graceful shutdown stalls
  setTimeout(() => {
    console.error('[main] Forced shutdown after timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
