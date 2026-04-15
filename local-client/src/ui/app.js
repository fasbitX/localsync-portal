/* =========================================================================
   LocalSync Portal - Dashboard Application (Vanilla JS)
   ========================================================================= */

(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  let currentView = 'folders';
  let contactsCache = [];
  let groupsCache = [];
  let invitesCache = [];
  let foldersCache = [];
  let syncPollTimer = null;
  var THUMB_SIZES = { small: 120, medium: 180, large: 260 };
  var thumbnailSize = localStorage.getItem('thumbnailSize') || 'medium';
  var currentFolderFiles = [];
  var currentPhotoIndex = 0;
  var currentFolderPath = '';

  // DOM references
  const contentEl = document.getElementById('content');
  const navItems = document.querySelectorAll('.nav-item');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  const contextMenu = document.getElementById('contextMenu');
  let contextMenuPath = null;

  // -----------------------------------------------------------------------
  // Utility helpers
  // -----------------------------------------------------------------------

  async function api(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + path, opts);
    if (!res.ok) {
      const data = await res.json().catch(function () { return {}; });
      throw new Error(data.error || 'Request failed (' + res.status + ')');
    }
    return res.json();
  }

  function escapeHtml(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    return d.toLocaleString();
  }

  function statusBadge(status) {
    return '<span class="badge badge-' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>';
  }

  function showLoading() {
    contentEl.innerHTML = '<div class="loading">Loading...</div>';
  }

  function showError(msg) {
    contentEl.innerHTML = '<div class="error-msg">' + escapeHtml(msg) + '</div>';
  }

  // -----------------------------------------------------------------------
  // Modal
  // -----------------------------------------------------------------------

  function openModal(title, htmlContent) {
    modalTitle.textContent = title;
    modalBody.innerHTML = htmlContent;
    modalOverlay.classList.add('open');
  }

  function closeModal() {
    modalOverlay.classList.remove('open');
    modalBody.innerHTML = '';
    document.getElementById('modal').classList.remove('modal--lightbox');
  }

  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', function (e) {
    if (e.target === modalOverlay) closeModal();
  });

  // -----------------------------------------------------------------------
  // Duplicate file detection
  // -----------------------------------------------------------------------

  /**
   * Check a list of Files against the target folder for name collisions.
   * Calls back with { duplicates: [...], suggestions: { orig: newName } }.
   */
  function checkDuplicates(folderPath, files, callback) {
    var encodedPath = folderPath.replace(/\//g, '--');
    var filenames = [];
    for (var i = 0; i < files.length; i++) {
      filenames.push(files[i].name);
    }

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/folders/' + encodedPath + '/check-duplicates');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      if (xhr.status === 200) {
        callback(JSON.parse(xhr.responseText));
      } else {
        callback({ duplicates: [], suggestions: {} });
      }
    };
    xhr.onerror = function () {
      callback({ duplicates: [], suggestions: {} });
    };
    xhr.send(JSON.stringify({ filenames: filenames }));
  }

  /**
   * Show a dialog listing duplicate files with Skip / Rename options.
   * Calls onResolved(resolvedFiles) with the final file list to upload.
   */
  function showDuplicateDialog(files, result, onResolved) {
    var dupeSet = {};
    for (var i = 0; i < result.duplicates.length; i++) {
      dupeSet[result.duplicates[i]] = true;
    }

    var html = '<div style="margin-bottom:12px;">' +
      '<p>The following files already exist in this folder:</p></div>' +
      '<div style="max-height:300px;overflow-y:auto;">';

    for (var d = 0; d < result.duplicates.length; d++) {
      var name = result.duplicates[d];
      var suggestion = result.suggestions[name] || name;
      html += '<div class="dupe-row" data-original="' + escapeHtml(name) + '" ' +
        'data-suggestion="' + escapeHtml(suggestion) + '" ' +
        'style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">' +
        '<strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</strong>' +
        '<select class="form-input dupe-action" style="width:auto;min-width:120px;">' +
          '<option value="skip">Skip</option>' +
          '<option value="rename">Rename</option>' +
        '</select>' +
        '<span class="dupe-rename-label text-secondary text-sm" style="display:none;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(suggestion) + '">&rarr; ' + escapeHtml(suggestion) + '</span>' +
      '</div>';
    }

    html += '</div>' +
      '<div class="form-actions" style="margin-top:16px;">' +
        '<button type="button" class="btn btn-secondary" id="dupeCancel">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="dupeProceed">Continue Upload</button>' +
      '</div>';

    openModal('Duplicate Files Found', html);

    // Wire up skip/rename toggles
    var selects = document.querySelectorAll('.dupe-action');
    selects.forEach(function (sel) {
      sel.addEventListener('change', function () {
        var label = sel.closest('.dupe-row').querySelector('.dupe-rename-label');
        label.style.display = sel.value === 'rename' ? 'inline' : 'none';
      });
    });

    document.getElementById('dupeCancel').addEventListener('click', function () {
      closeModal();
    });

    document.getElementById('dupeProceed').addEventListener('click', function () {
      var resolved = [];
      var rows = document.querySelectorAll('.dupe-row');
      var decisions = {};
      rows.forEach(function (row) {
        var orig = row.dataset.original;
        var action = row.querySelector('.dupe-action').value;
        decisions[orig] = {
          action: action,
          suggestion: row.dataset.suggestion
        };
      });

      for (var f = 0; f < files.length; f++) {
        var file = files[f];
        if (dupeSet[file.name]) {
          var decision = decisions[file.name];
          if (decision.action === 'skip') continue;
          // Rename: create a new File with the suggested name
          resolved.push(new File([file], decision.suggestion, { type: file.type }));
        } else {
          resolved.push(file);
        }
      }

      closeModal();
      onResolved(resolved);
    });
  }

  /**
   * Check for duplicates and handle resolution before uploading.
   * Calls onReady(filesToUpload) when ready to proceed.
   */
  function checkAndResolve(folderPath, files, onReady) {
    checkDuplicates(folderPath, files, function (result) {
      if (result.duplicates.length === 0) {
        onReady(files);
      } else {
        showDuplicateDialog(files, result, function (resolved) {
          if (resolved.length > 0) {
            onReady(resolved);
          }
        });
      }
    });
  }

  // -----------------------------------------------------------------------
  // Context menu
  // -----------------------------------------------------------------------

  function showContextMenu(x, y, relPath) {
    contextMenuPath = relPath;
    contextMenu.style.display = 'block';
    // Position then adjust for viewport overflow
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    var rect = contextMenu.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) {
      contextMenu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    }
    if (y + rect.height > window.innerHeight) {
      contextMenu.style.top = (window.innerHeight - rect.height - 8) + 'px';
    }
  }

  function hideContextMenu() {
    contextMenu.style.display = 'none';
    contextMenuPath = null;
  }

  document.addEventListener('click', function (e) {
    if (!contextMenu.contains(e.target)) hideContextMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      hideContextMenu();
      closePhotoOverlay();
    }
    // Arrow keys only when overlay is open
    var overlay = document.getElementById('photoOverlay');
    if (overlay && overlay.classList.contains('open') && currentFolderFiles.length > 0) {
      if (e.key === 'ArrowLeft') { navigatePhoto(-1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { navigatePhoto(1); e.preventDefault(); }
    }
  });

  contextMenu.addEventListener('click', function (e) {
    var item = e.target.closest('.context-menu-item');
    if (!item) return;
    var action = item.dataset.action;
    var folderPath = contextMenuPath;
    hideContextMenu();
    if (!folderPath) return;
    var folderData = foldersCache.find(function (f) { return f.relativePath === folderPath; });
    switch (action) {
      case 'upload': openUploadPhotosModal(folderPath); break;
      case 'subfolder': openSubFolderModal(folderPath); break;
      case 'invite': openFolderInviteModal(folderPath, folderData ? folderData.galleryUrl || '' : ''); break;
      case 'rename': openRenameFolderModal(folderPath); break;
      case 'delete': openDeleteFolderModal(folderPath, folderData ? folderData.fileCount : 0); break;
    }
  });

  // -----------------------------------------------------------------------
  // Navigation
  // -----------------------------------------------------------------------

  function navigate(view) {
    currentView = view;
    navItems.forEach(function (el) {
      el.classList.toggle('active', el.dataset.view === view);
    });
    // Stop sync polling when leaving the sync log view
    if (syncPollTimer && view !== 'synclog') {
      clearInterval(syncPollTimer);
      syncPollTimer = null;
    }
    // Clear photo viewer state and close overlay when leaving folders
    if (view !== 'folders') {
      closePhotoOverlay();
      currentFolderFiles = [];
      currentPhotoIndex = 0;
      currentFolderPath = '';
    }
    renderView();
    // Close sidebar on mobile after navigating
    sidebar.classList.remove('open');
  }

  navItems.forEach(function (el) {
    el.addEventListener('click', function () {
      navigate(el.dataset.view);
    });
  });

  sidebarToggle.addEventListener('click', function () {
    sidebar.classList.toggle('open');
  });

  // -----------------------------------------------------------------------
  // View router
  // -----------------------------------------------------------------------

  function renderView() {
    switch (currentView) {
      case 'folders':  renderFolders();  break;
      case 'contacts': renderContacts(); break;
      case 'groups':   renderGroups();   break;
      case 'invites':  renderInvites();  break;
      case 'synclog':  renderSyncLog();  break;
      case 'settings': renderSettings(); break;
    }
  }

  // -----------------------------------------------------------------------
  // FOLDERS VIEW
  // -----------------------------------------------------------------------

  // -- Tree builder: convert flat folder array to nested tree ---------------

  function buildFolderTree(folders) {
    var nodeMap = {};

    // Pass 1: create all nodes
    folders.forEach(function (f) {
      var segments = f.relativePath === '.' ? [] : f.relativePath.split('/');
      var name = segments.length ? segments[segments.length - 1] : '(root)';
      nodeMap[f.relativePath] = {
        relativePath: f.relativePath,
        name: name,
        fileCount: f.fileCount,
        galleryUrl: f.galleryUrl,
        isPhoto: f.fileCount > 0,
        children: []
      };
    });

    // Pass 2: wire parent-child relationships
    Object.keys(nodeMap).forEach(function (key) {
      if (key === '.') return;
      var parentPath = key.includes('/') ? key.substring(0, key.lastIndexOf('/')) : '.';
      var parent = nodeMap[parentPath];
      if (parent) {
        parent.children.push(nodeMap[key]);
      }
    });

    // Sort children alphabetically at every level
    function sortChildren(node) {
      node.children.sort(function (a, b) { return a.name.localeCompare(b.name); });
      node.children.forEach(sortChildren);
    }

    var root = nodeMap['.'];
    if (root) {
      sortChildren(root);
      return root.children;
    }
    return [];
  }

  // -- Recursive tree renderer ---------------------------------------------

  function renderTreeNodes(nodes, depth) {
    var html = '';
    nodes.forEach(function (node) {
      var hasChildren = node.children.length > 0;
      html += '<li class="tree-node" data-path="' + escapeHtml(node.relativePath) + '">';
      html += '<div class="tree-row">';
      html += '<span class="tree-indent" style="width:' + (depth * 20) + 'px"></span>';

      if (hasChildren) {
        html += '<span class="tree-chevron tree-chevron--open">&#9654;</span>';
      } else {
        html += '<span class="tree-chevron tree-chevron--leaf">&#9654;</span>';
      }

      html += '<span class="tree-icon">&#128193;</span>';

      html += '<span class="tree-label">' + escapeHtml(node.name) + '</span>';

      if (node.isPhoto) {
        html += '<span class="tree-meta">' + node.fileCount + ' image' + (node.fileCount !== 1 ? 's' : '') + '</span>';
      }
      if (node.galleryUrl) {
        html += '<a href="' + escapeHtml(node.galleryUrl) + '" target="_blank" class="tree-gallery-link" title="Open gallery">&#128279;</a>';
      }

      html += '</div>';

      if (hasChildren) {
        html += '<ul class="tree-children">';
        html += renderTreeNodes(node.children, depth + 1);
        html += '</ul>';
      }

      html += '</li>';
    });
    return html;
  }

  // -- Tree event binding --------------------------------------------------

  function bindTreeEvents() {
    var tree = contentEl.querySelector('.folder-tree');
    if (!tree) return;

    // Click on chevron: expand/collapse
    tree.addEventListener('click', function (e) {
      var chevron = e.target.closest('.tree-chevron:not(.tree-chevron--leaf)');
      if (chevron) {
        toggleNode(chevron.closest('.tree-node'));
        return;
      }
      // Click on row: select folder and load photos
      var row = e.target.closest('.tree-row');
      if (!row) return;
      if (e.target.closest('.tree-gallery-link')) return;
      var node = row.closest('.tree-node');
      // Highlight selected
      tree.querySelectorAll('.tree-row--selected').forEach(function (el) {
        el.classList.remove('tree-row--selected');
      });
      row.classList.add('tree-row--selected');
      loadFolderPhotos(node.dataset.path);
    });

    // Double-click on row: expand/collapse or open gallery
    tree.addEventListener('dblclick', function (e) {
      var row = e.target.closest('.tree-row');
      if (!row) return;
      if (e.target.closest('.tree-gallery-link')) return;
      var node = row.closest('.tree-node');
      var childrenUl = node.querySelector(':scope > .tree-children');
      if (childrenUl) {
        toggleNode(node);
      } else {
        // Leaf photo folder: open gallery
        var folderData = foldersCache.find(function (f) { return f.relativePath === node.dataset.path; });
        if (folderData && folderData.galleryUrl) {
          window.open(folderData.galleryUrl, '_blank');
        }
      }
    });

    // Right-click: context menu
    tree.addEventListener('contextmenu', function (e) {
      var row = e.target.closest('.tree-row');
      if (!row) return;
      e.preventDefault();
      var node = row.closest('.tree-node');
      showContextMenu(e.clientX, e.clientY, node.dataset.path);
    });

    // Drag and drop: drag photos onto a folder row to upload
    tree.addEventListener('dragover', function (e) {
      var row = e.target.closest('.tree-row');
      if (!row) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      // Clear previous highlights
      tree.querySelectorAll('.tree-row--dragover').forEach(function (el) {
        el.classList.remove('tree-row--dragover');
      });
      row.classList.add('tree-row--dragover');
    });

    tree.addEventListener('dragleave', function (e) {
      var row = e.target.closest('.tree-row');
      if (row) row.classList.remove('tree-row--dragover');
    });

    tree.addEventListener('drop', function (e) {
      e.preventDefault();
      tree.querySelectorAll('.tree-row--dragover').forEach(function (el) {
        el.classList.remove('tree-row--dragover');
      });
      var row = e.target.closest('.tree-row');
      if (!row) return;
      var node = row.closest('.tree-node');
      var folderPath = node.dataset.path;

      var files = e.dataTransfer.files;
      if (!files || files.length === 0) return;

      // Filter to image and zip files
      var allowed = ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.raw', '.cr2', '.nef', '.arw', '.zip'];
      var imageFiles = [];
      var zipFiles = [];
      for (var i = 0; i < files.length; i++) {
        var ext = files[i].name.substring(files[i].name.lastIndexOf('.')).toLowerCase();
        if (ext === '.zip') {
          zipFiles.push(files[i]);
        } else if (allowed.indexOf(ext) !== -1) {
          imageFiles.push(files[i]);
        }
      }

      if (imageFiles.length === 0 && zipFiles.length === 0) {
        alert('No supported files found.\nSupported: ' + allowed.join(', '));
        return;
      }

      // Duplicate-check image files; zips are handled server-side during extraction
      checkAndResolve(folderPath, imageFiles, function (resolvedImages) {
        var filesToUpload = resolvedImages.concat(zipFiles);
        if (filesToUpload.length === 0) return;

        var label = row.querySelector('.tree-label');
        var originalText = label.textContent;
        label.textContent = originalText + ' (uploading ' + filesToUpload.length + '...)';
        row.classList.add('tree-row--uploading');

        var formData = new FormData();
        for (var j = 0; j < filesToUpload.length; j++) {
          formData.append('photos', filesToUpload[j]);
        }

        var encodedPath = folderPath.replace(/\//g, '--');
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/folders/' + encodedPath + '/upload');

        xhr.onload = function () {
          row.classList.remove('tree-row--uploading');
          if (xhr.status >= 200 && xhr.status < 300) {
            var result = JSON.parse(xhr.responseText);
            label.textContent = originalText + ' (+' + result.uploaded + ')';
            setTimeout(function () { renderFolders(); }, 1500);
          } else {
            label.textContent = originalText + ' (upload failed)';
            setTimeout(function () { label.textContent = originalText; }, 3000);
          }
        };

        xhr.onerror = function () {
          row.classList.remove('tree-row--uploading');
          label.textContent = originalText + ' (upload failed)';
          setTimeout(function () { label.textContent = originalText; }, 3000);
        };

        xhr.send(formData);
      });
    });
  }

  function toggleNode(li) {
    var childrenUl = li.querySelector(':scope > .tree-children');
    if (!childrenUl) return;
    var chevron = li.querySelector(':scope > .tree-row > .tree-chevron');
    var isOpen = childrenUl.style.display !== 'none';
    childrenUl.style.display = isOpen ? 'none' : 'block';
    if (chevron) chevron.classList.toggle('tree-chevron--open', !isOpen);
  }

  // -- Main render function ------------------------------------------------

  async function renderFolders() {
    showLoading();
    try {
      foldersCache = await api('GET', '/folders');
      var tree = buildFolderTree(foldersCache);

      var html = '<div class="folders-layout">';

      // Left panel: tree
      html += '<div class="folders-tree-panel"><div class="card"><div class="card-header">' +
        '<h2 class="card-title">Photo Folders</h2>' +
        '<button class="btn btn-primary btn-sm" id="createFolderBtn">+ New</button></div>';

      if (tree.length === 0) {
        html += '<div class="empty-state"><p>No folders yet.</p></div>';
      } else {
        html += '<ul class="folder-tree">' + renderTreeNodes(tree, 0) + '</ul>';
        html += '<p class="text-secondary text-sm" style="padding:8px 12px 0;">Right-click for actions</p>';
      }
      html += '</div></div>';

      // Right panel: photo detail
      html += '<div class="folders-detail-panel" id="folderDetail">' +
        '<div class="card"><div class="empty-state"><p>Select a folder to view photos</p></div></div></div>';

      html += '</div>';
      contentEl.innerHTML = html;

      document.getElementById('createFolderBtn').addEventListener('click', function () {
        openCreateFolderModal();
      });

      bindTreeEvents();
    } catch (err) {
      showError('Failed to load folders: ' + err.message);
    }
  }

  // -- Load and display photos for a selected folder (thumbnail grid) --------

  async function loadFolderPhotos(folderPath) {
    var detail = document.getElementById('folderDetail');
    if (!detail) return;
    detail.innerHTML = '<div class="card"><div class="loading">Loading photos...</div></div>';

    try {
      var encodedPath = folderPath === '.' ? '.' : folderPath.replace(/\//g, '--');
      var files = await api('GET', '/folders/' + encodedPath + '/files');
      var folderName = folderPath === '.' ? '(root)' : folderPath.split('/').pop();

      currentFolderFiles = files;
      currentPhotoIndex = 0;
      currentFolderPath = folderPath;

      var html = '<div class="card"><div class="card-header">' +
        '<h2 class="card-title">' + escapeHtml(folderName) + '</h2>' +
        '<span class="text-secondary text-sm">' + files.length + ' photo' + (files.length !== 1 ? 's' : '') + '</span></div>';

      if (files.length === 0) {
        html += '<div class="empty-state"><p>No photos in this folder.<br>Drag &amp; drop images onto the folder, or right-click to upload.</p></div>';
      } else {
        html += '<div class="photo-grid">';
        files.forEach(function (f, idx) {
          html += '<div class="photo-thumb" data-index="' + idx + '">';
          if (f.browserViewable) {
            html += '<img src="' + escapeHtml(f.url) + '" alt="' + escapeHtml(f.name) + '" loading="lazy">';
          } else {
            var ext = f.name.substring(f.name.lastIndexOf('.') + 1).toUpperCase();
            html += '<div class="photo-thumb-placeholder">' +
              '<div class="photo-thumb-placeholder-ext">' + escapeHtml(ext) + '</div>' +
              '<p>No preview</p></div>';
          }
          var caption = f.exif && f.exif.title ? f.exif.title : f.name;
          html += '<div class="photo-thumb-caption" title="' + escapeHtml(f.name) + '">' + escapeHtml(caption) + '</div>';
          if (f.exif) {
            var meta = [];
            if (f.exif.camera) meta.push(f.exif.camera);
            if (f.exif.focalLength) meta.push(f.exif.focalLength + 'mm');
            if (f.exif.fNumber) meta.push('f/' + f.exif.fNumber);
            if (f.exif.exposure) meta.push(f.exif.exposure);
            if (f.exif.iso) meta.push('ISO ' + f.exif.iso);
            if (meta.length > 0) {
              html += '<div class="photo-thumb-meta">' + escapeHtml(meta.join(' \u2022 ')) + '</div>';
            }
          }
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      detail.innerHTML = html;

      // Bind click on thumbnails to open overlay
      var grid = detail.querySelector('.photo-grid');
      if (grid) {
        grid.addEventListener('click', function (e) {
          var thumb = e.target.closest('.photo-thumb');
          if (!thumb) return;
          var idx = parseInt(thumb.dataset.index, 10);
          openPhotoOverlay(idx);
        });
      }
    } catch (err) {
      detail.innerHTML = '<div class="card"><div class="error-msg">Failed to load photos: ' + escapeHtml(err.message) + '</div></div>';
    }
  }

  // -- Fullscreen photo overlay ---------------------------------------------

  function openPhotoOverlay(index) {
    if (currentFolderFiles.length === 0) return;
    currentPhotoIndex = index;

    // Remove any existing overlay before creating a new one
    var existing = document.getElementById('photoOverlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'photoOverlay';
    overlay.className = 'photo-overlay open';

    overlay.innerHTML =
      '<span class="photo-overlay-counter" id="overlayCounter"></span>' +
      '<button class="photo-overlay-close" id="overlayClose" title="Close">&times;</button>' +
      '<button class="photo-overlay-nav--prev" id="overlayPrev">&lt;</button>' +
      '<div class="photo-overlay-stage" id="overlayStage"></div>' +
      '<button class="photo-overlay-nav--next" id="overlayNext">&gt;</button>' +
      '<div class="photo-overlay-bar">' +
        '<div class="photo-overlay-info" id="overlayInfo"></div>' +
        '<button class="btn btn-danger btn-sm" id="overlayDelete">Delete</button>' +
      '</div>';

    document.body.appendChild(overlay);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    showPhotoAtIndex(index);

    // Event listeners
    document.getElementById('overlayClose').addEventListener('click', closePhotoOverlay);
    document.getElementById('overlayPrev').addEventListener('click', function () { navigatePhoto(-1); });
    document.getElementById('overlayNext').addEventListener('click', function () { navigatePhoto(1); });
    document.getElementById('overlayDelete').addEventListener('click', function () { deleteCurrentPhoto(); });

    // Click on backdrop to close (only if clicking the overlay itself, not children)
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.id === 'overlayStage') {
        closePhotoOverlay();
      }
    });
  }

  function closePhotoOverlay() {
    var overlay = document.getElementById('photoOverlay');
    if (!overlay) return;
    overlay.remove();
    document.body.style.overflow = '';
  }

  // -- Photo viewer navigation (works inside overlay) -------------------------

  function showPhotoAtIndex(index) {
    if (currentFolderFiles.length === 0) return;
    currentPhotoIndex = index;
    var f = currentFolderFiles[index];
    var stage = document.getElementById('overlayStage');
    var info = document.getElementById('overlayInfo');
    var counter = document.getElementById('overlayCounter');
    if (!stage) return;

    if (f.browserViewable) {
      stage.innerHTML = '<img class="photo-overlay-img" src="' + escapeHtml(f.url) + '" alt="' + escapeHtml(f.name) + '">';
    } else {
      var ext = f.name.substring(f.name.lastIndexOf('.') + 1).toUpperCase();
      stage.innerHTML = '<div class="photo-overlay-placeholder">' +
        '<div class="photo-overlay-placeholder-ext">' + escapeHtml(ext) + '</div>' +
        '<p>Cannot preview this format in the browser.</p>' +
        '<a href="' + escapeHtml(f.url) + '" download class="btn btn-primary btn-sm mt-8">Download</a></div>';
    }

    if (counter) {
      counter.textContent = (index + 1) + ' / ' + currentFolderFiles.length;
    }

    var name = f.exif && f.exif.title ? f.exif.title : f.name;
    var infoHtml = '<span class="photo-overlay-name">' + escapeHtml(name) + '</span>';
    if (f.exif) {
      var meta = [];
      if (f.exif.camera) meta.push(f.exif.camera);
      if (f.exif.focalLength) meta.push(f.exif.focalLength + 'mm');
      if (f.exif.fNumber) meta.push('f/' + f.exif.fNumber);
      if (f.exif.exposure) meta.push(f.exif.exposure);
      if (f.exif.iso) meta.push('ISO ' + f.exif.iso);
      if (meta.length > 0) {
        infoHtml += '<span class="photo-overlay-meta">' + escapeHtml(meta.join(' \u2022 ')) + '</span>';
      }
    }
    info.innerHTML = infoHtml;

    var prev = document.getElementById('overlayPrev');
    var next = document.getElementById('overlayNext');
    if (prev) prev.style.visibility = currentFolderFiles.length <= 1 ? 'hidden' : 'visible';
    if (next) next.style.visibility = currentFolderFiles.length <= 1 ? 'hidden' : 'visible';
  }

  function navigatePhoto(delta) {
    if (currentFolderFiles.length === 0) return;
    var newIndex = currentPhotoIndex + delta;
    if (newIndex < 0) newIndex = currentFolderFiles.length - 1;
    if (newIndex >= currentFolderFiles.length) newIndex = 0;
    showPhotoAtIndex(newIndex);
  }

  async function deleteCurrentPhoto() {
    if (currentFolderFiles.length === 0) return;
    var f = currentFolderFiles[currentPhotoIndex];
    if (!confirm('Delete "' + f.name + '"?\n\nThis does NOT delete the photo from the remote server.')) return;

    var encodedPath = currentFolderPath === '.' ? '.' : currentFolderPath.replace(/\//g, '--');
    try {
      await api('DELETE', '/folders/' + encodedPath + '/photos/' + encodeURIComponent(f.name));
      currentFolderFiles.splice(currentPhotoIndex, 1);
      if (currentFolderFiles.length === 0) {
        closePhotoOverlay();
        loadFolderPhotos(currentFolderPath);
      } else {
        if (currentPhotoIndex >= currentFolderFiles.length) currentPhotoIndex = 0;
        showPhotoAtIndex(currentPhotoIndex);
        // Refresh the thumbnail grid underneath without clobbering overlay state
        var savedFiles = currentFolderFiles.slice();
        var savedIndex = currentPhotoIndex;
        var savedPath = currentFolderPath;
        loadFolderPhotos(currentFolderPath).then(function () {
          currentFolderFiles = savedFiles;
          currentPhotoIndex = savedIndex;
          currentFolderPath = savedPath;
        });
      }
    } catch (err) {
      alert('Failed to delete photo: ' + err.message);
    }
  }

  function openUploadPhotosModal(folderPath) {
    var encodedPath = folderPath.replace(/\//g, '--');
    var html = '<form id="uploadPhotosForm" enctype="multipart/form-data">' +
      '<div class="form-group"><label class="form-label">Folder</label>' +
      '<input class="form-input" value="' + escapeHtml(folderPath) + '" readonly></div>' +
      '<div class="form-group"><label class="form-label">Select Photos</label>' +
      '<input class="form-input" type="file" name="photos" multiple accept=".jpg,.jpeg,.png,.tiff,.tif,.raw,.cr2,.nef,.arw,.zip" required>' +
      '<small class="text-secondary">Supported: JPG, PNG, TIFF, RAW, CR2, NEF, ARW</small></div>' +
      '<div id="uploadProgress" style="display:none;">' +
        '<div style="background:var(--border);border-radius:4px;height:8px;margin:8px 0;">' +
          '<div id="uploadBar" style="background:var(--primary);height:100%;border-radius:4px;width:0%;transition:width 0.3s;"></div>' +
        '</div>' +
        '<p class="text-secondary text-sm" id="uploadStatus">Uploading...</p>' +
      '</div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="document.getElementById(\'modalOverlay\').classList.remove(\'open\')">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Upload</button>' +
      '</div></form>';
    openModal('Upload Photos', html);

    document.getElementById('uploadPhotosForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var fileInput = form.querySelector('[name="photos"]');
      var files = fileInput.files;
      if (!files || files.length === 0) return;

      var selectedImages = [];
      var selectedZips = [];
      for (var i = 0; i < files.length; i++) {
        var ext = files[i].name.substring(files[i].name.lastIndexOf('.')).toLowerCase();
        if (ext === '.zip') {
          selectedZips.push(files[i]);
        } else {
          selectedImages.push(files[i]);
        }
      }

      closeModal();

      checkAndResolve(folderPath, selectedImages, function (resolvedImages) {
        var filesToUpload = resolvedImages.concat(selectedZips);
        if (filesToUpload.length === 0) return;

        // Re-open a progress modal for the upload
        var progressHtml = '<div>' +
          '<div style="background:var(--border);border-radius:4px;height:8px;margin:8px 0;">' +
            '<div id="uploadBar" style="background:var(--primary);height:100%;border-radius:4px;width:0%;transition:width 0.3s;"></div>' +
          '</div>' +
          '<p class="text-secondary text-sm" id="uploadStatus">Uploading ' + filesToUpload.length + ' file(s)...</p>' +
        '</div>';
        openModal('Uploading Photos', progressHtml);

        var formData = new FormData();
        for (var j = 0; j < filesToUpload.length; j++) {
          formData.append('photos', filesToUpload[j]);
        }

        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/folders/' + encodedPath + '/upload');

        xhr.upload.addEventListener('progress', function (evt) {
          if (evt.lengthComputable) {
            var pct = Math.round((evt.loaded / evt.total) * 100);
            var bar = document.getElementById('uploadBar');
            var status = document.getElementById('uploadStatus');
            if (bar) bar.style.width = pct + '%';
            if (status) status.textContent = 'Uploading... ' + pct + '%';
          }
        });

        xhr.onload = function () {
          closeModal();
          if (xhr.status >= 200 && xhr.status < 300) {
            var result = JSON.parse(xhr.responseText);
            renderFolders();
            alert(result.uploaded + ' photo(s) uploaded to ' + folderPath + '.\nThe watcher will sync them to the remote server.');
          } else {
            var err = JSON.parse(xhr.responseText || '{}');
            alert('Upload failed: ' + (err.error || xhr.statusText));
          }
        };

        xhr.onerror = function () {
          closeModal();
          alert('Upload failed: network error');
        };

        xhr.send(formData);
      });
    });
  }

  function openCreateFolderModal() {
    var html = '<form id="createFolderForm">' +
      '<div class="form-group"><label class="form-label">Folder Path *</label>' +
      '<input class="form-input" name="folderPath" placeholder="e.g. 2024/Varsity_Football/Game1" required>' +
      '<small class="text-secondary">Use forward slashes for nested folders</small></div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="document.getElementById(\'modalOverlay\').classList.remove(\'open\')">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Create Folder</button>' +
      '</div></form>';
    openModal('New Folder', html);

    document.getElementById('createFolderForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var folderPath = form.folderPath.value.trim();
      if (!folderPath) return;
      var btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Creating...';
      api('POST', '/folders', { folderPath: folderPath })
        .then(function (result) {
          closeModal();
          renderFolders();
          if (result.galleryUrl) {
            alert('Folder created and synced!\nGallery: ' + result.galleryUrl);
          }
        })
        .catch(function (err) {
          alert('Error: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Create Folder';
        });
    });
  }

  function openSubFolderModal(parentPath) {
    var parentDisplay = parentPath === '.' ? '(root)' : parentPath;
    var html = '<form id="subFolderForm">' +
      '<div class="form-group"><label class="form-label">Parent Folder</label>' +
      '<input class="form-input" value="' + escapeHtml(parentDisplay) + '" readonly></div>' +
      '<div class="form-group"><label class="form-label">Sub-folder Name *</label>' +
      '<input class="form-input" name="subName" placeholder="e.g. Game1" required></div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="document.getElementById(\'modalOverlay\').classList.remove(\'open\')">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Create Sub-folder</button>' +
      '</div></form>';
    openModal('New Sub-folder', html);

    document.getElementById('subFolderForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var subName = e.target.subName.value.trim();
      if (!subName) return;
      var fullPath = parentPath === '.' ? subName : parentPath + '/' + subName;
      var btn = e.target.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Creating...';
      api('POST', '/folders', { folderPath: fullPath })
        .then(function (result) {
          closeModal();
          renderFolders();
          if (result.galleryUrl) {
            alert('Sub-folder created and synced!\nGallery: ' + result.galleryUrl);
          }
        })
        .catch(function (err) {
          alert('Error: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Create Sub-folder';
        });
    });
  }

  function openRenameFolderModal(folderPath) {
    var currentName = folderPath.includes('/') ? folderPath.split('/').pop() : folderPath;
    var parentDir = folderPath.includes('/') ? folderPath.substring(0, folderPath.lastIndexOf('/')) : '';
    var html = '<form id="renameFolderForm">' +
      '<div class="form-group"><label class="form-label">Current Path</label>' +
      '<input class="form-input" value="' + escapeHtml(folderPath) + '" readonly></div>' +
      '<div class="form-group"><label class="form-label">New Name *</label>' +
      '<input class="form-input" name="newName" value="' + escapeHtml(currentName) + '" required></div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="document.getElementById(\'modalOverlay\').classList.remove(\'open\')">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Rename</button>' +
      '</div></form>';
    openModal('Rename Folder', html);

    document.getElementById('renameFolderForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var newName = e.target.newName.value.trim();
      if (!newName) return;
      var newPath = parentDir ? parentDir + '/' + newName : newName;
      if (newPath === folderPath) { closeModal(); return; }
      var btn = e.target.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Renaming...';
      api('PUT', '/folders', { oldPath: folderPath, newPath: newPath })
        .then(function () {
          closeModal();
          renderFolders();
        })
        .catch(function (err) {
          alert('Error: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Rename';
        });
    });
  }

  function openDeleteFolderModal(folderPath, fileCount) {
    // Count sub-folders too
    var subFolders = foldersCache.filter(function (f) {
      return f.relativePath !== folderPath && f.relativePath.startsWith(folderPath + '/');
    });
    var totalFiles = fileCount;
    subFolders.forEach(function (sf) { totalFiles += sf.fileCount; });

    var warnings = [];
    if (totalFiles > 0) {
      warnings.push('<strong>' + totalFiles + ' image' + (totalFiles !== 1 ? 's' : '') + '</strong> will be permanently deleted from this machine');
    }
    if (subFolders.length > 0) {
      warnings.push('<strong>' + subFolders.length + ' sub-folder' + (subFolders.length !== 1 ? 's' : '') + '</strong> will also be removed');
    }
    warnings.push('This does <strong>NOT</strong> delete photos from the remote server');
    warnings.push('This action <strong>cannot be undone</strong>');

    var html = '<div class="delete-warning">' +
      '<div style="font-size:36px;text-align:center;margin-bottom:12px;">&#9888;</div>' +
      '<p style="text-align:center;font-weight:600;margin-bottom:16px;">Delete "' + escapeHtml(folderPath) + '"?</p>' +
      '<ul style="margin:0 0 20px 20px;line-height:1.8;">' +
      warnings.map(function (w) { return '<li>' + w + '</li>'; }).join('') +
      '</ul>' +
      '<div class="form-group"><label class="form-label">Type the folder name to confirm:</label>' +
      '<input class="form-input" id="deleteConfirmInput" placeholder="' + escapeHtml(folderPath) + '"></div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="document.getElementById(\'modalOverlay\').classList.remove(\'open\')">Cancel</button>' +
        '<button type="button" class="btn btn-danger" id="confirmDeleteBtn" disabled>Delete Permanently</button>' +
      '</div></div>';
    openModal('Delete Folder', html);

    var confirmInput = document.getElementById('deleteConfirmInput');
    var deleteBtn = document.getElementById('confirmDeleteBtn');

    confirmInput.addEventListener('input', function () {
      deleteBtn.disabled = confirmInput.value.trim() !== folderPath;
    });

    deleteBtn.addEventListener('click', function () {
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';
      api('DELETE', '/folders', { folderPath: folderPath })
        .then(function (result) {
          closeModal();
          renderFolders();
          alert(result.message);
        })
        .catch(function (err) {
          alert('Error: ' + err.message);
          deleteBtn.disabled = false;
          deleteBtn.textContent = 'Delete Permanently';
        });
    });
  }

  function openFolderInviteModal(folderPath, galleryUrl) {
    var html = '<form id="folderInviteForm">' +
      '<div class="form-group"><label class="form-label">Folder</label>' +
      '<input class="form-input" value="' + escapeHtml(folderPath) + '" readonly></div>' +
      '<div class="form-group"><label class="form-label">Gallery URL</label>' +
      '<input class="form-input" name="galleryUrl" value="' + escapeHtml(galleryUrl) + '" placeholder="Paste gallery URL" required></div>' +
      '<div class="form-group"><label class="form-label">Select Contacts</label>' +
      '<div class="checkbox-list" id="inviteContactsList">Loading...</div></div>' +
      '<div class="form-group"><label class="form-label">Select Groups</label>' +
      '<div class="checkbox-list" id="inviteGroupsList">Loading...</div></div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="document.getElementById(\'modalOverlay\').classList.remove(\'open\')">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Send Invites</button>' +
      '</div></form>';
    openModal('Send Gallery Invites', html);

    // Load contacts and groups
    Promise.all([api('GET', '/contacts'), api('GET', '/groups')]).then(function (results) {
      var contacts = results[0];
      var groups = results[1];
      var cList = document.getElementById('inviteContactsList');
      var gList = document.getElementById('inviteGroupsList');
      if (contacts.length === 0) {
        cList.innerHTML = '<span class="text-secondary text-sm">No contacts yet</span>';
      } else {
        cList.innerHTML = contacts.map(function (c) {
          return '<label class="checkbox-item"><input type="checkbox" name="contactId" value="' + c.id + '"> ' +
            escapeHtml(c.first_name + ' ' + c.last_name) + ' (' + escapeHtml(c.email) + ')</label>';
        }).join('');
      }
      if (groups.length === 0) {
        gList.innerHTML = '<span class="text-secondary text-sm">No groups yet</span>';
      } else {
        gList.innerHTML = groups.map(function (g) {
          return '<label class="checkbox-item"><input type="checkbox" name="groupId" value="' + g.id + '"> ' +
            escapeHtml(g.name) + ' (' + g.member_count + ' members)</label>';
        }).join('');
      }
    });

    document.getElementById('folderInviteForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var url = form.querySelector('[name="galleryUrl"]').value.trim();
      if (!url) return;
      var contactIds = Array.from(form.querySelectorAll('[name="contactId"]:checked')).map(function (el) { return parseInt(el.value, 10); });
      var groupIds = Array.from(form.querySelectorAll('[name="groupId"]:checked')).map(function (el) { return parseInt(el.value, 10); });
      if (contactIds.length === 0 && groupIds.length === 0) {
        alert('Select at least one contact or group.');
        return;
      }
      var btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      api('POST', '/invites/send', { contactIds: contactIds, groupIds: groupIds, folderPath: folderPath, galleryUrl: url })
        .then(function (result) {
          closeModal();
          alert('Invites sent: ' + result.sent + ', failed: ' + result.failed);
        })
        .catch(function (err) {
          alert('Error: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Send Invites';
        });
    });
  }

  // -----------------------------------------------------------------------
  // CONTACTS VIEW
  // -----------------------------------------------------------------------

  async function renderContacts() {
    showLoading();
    try {
      contactsCache = await api('GET', '/contacts');
      var html = '<div class="card"><div class="card-header">' +
        '<h2 class="card-title">Contacts</h2>' +
        '<button class="btn btn-primary" id="addContactBtn">+ Add Contact</button></div>';
      if (contactsCache.length === 0) {
        html += '<div class="empty-state"><p>No contacts yet. Add your first contact.</p></div>';
      } else {
        html += '<div class="table-wrap"><table><thead><tr>' +
          '<th>Name</th><th>Email</th><th>Phone</th><th>Notes</th><th>Actions</th></tr></thead><tbody>';
        contactsCache.forEach(function (c) {
          html += '<tr>' +
            '<td>' + escapeHtml(c.first_name + ' ' + c.last_name) + '</td>' +
            '<td>' + escapeHtml(c.email) + '</td>' +
            '<td>' + escapeHtml(c.phone || '-') + '</td>' +
            '<td class="truncate">' + escapeHtml(c.notes || '-') + '</td>' +
            '<td>' +
              '<button class="btn btn-sm btn-secondary edit-contact" data-id="' + c.id + '">Edit</button> ' +
              '<button class="btn btn-sm btn-danger delete-contact" data-id="' + c.id + '">Delete</button>' +
            '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
      html += '</div>';
      contentEl.innerHTML = html;

      document.getElementById('addContactBtn').addEventListener('click', function () {
        openContactModal();
      });
      contentEl.querySelectorAll('.edit-contact').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var contact = contactsCache.find(function (c) { return c.id === parseInt(btn.dataset.id, 10); });
          if (contact) openContactModal(contact);
        });
      });
      contentEl.querySelectorAll('.delete-contact').forEach(function (btn) {
        btn.addEventListener('click', function () {
          deleteContact(parseInt(btn.dataset.id, 10));
        });
      });
    } catch (err) {
      showError('Failed to load contacts: ' + err.message);
    }
  }

  function openContactModal(existing) {
    var isEdit = !!existing;
    var html = '<form id="contactForm">' +
      '<div class="form-group"><label class="form-label">First Name *</label>' +
      '<input class="form-input" name="firstName" value="' + escapeHtml(isEdit ? existing.first_name : '') + '" required></div>' +
      '<div class="form-group"><label class="form-label">Last Name *</label>' +
      '<input class="form-input" name="lastName" value="' + escapeHtml(isEdit ? existing.last_name : '') + '" required></div>' +
      '<div class="form-group"><label class="form-label">Email *</label>' +
      '<input class="form-input" name="email" type="email" value="' + escapeHtml(isEdit ? existing.email : '') + '" required></div>' +
      '<div class="form-group"><label class="form-label">Phone</label>' +
      '<input class="form-input" name="phone" value="' + escapeHtml(isEdit ? existing.phone || '' : '') + '"></div>' +
      '<div class="form-group"><label class="form-label">Notes</label>' +
      '<textarea class="form-textarea" name="notes">' + escapeHtml(isEdit ? existing.notes || '' : '') + '</textarea></div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="document.getElementById(\'modalOverlay\').classList.remove(\'open\')">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">' + (isEdit ? 'Update' : 'Create') + '</button>' +
      '</div></form>';
    openModal(isEdit ? 'Edit Contact' : 'New Contact', html);

    document.getElementById('contactForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var data = {
        firstName: form.firstName.value.trim(),
        lastName: form.lastName.value.trim(),
        email: form.email.value.trim(),
        phone: form.phone.value.trim() || null,
        notes: form.notes.value.trim() || null,
      };
      var btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      var promise = isEdit ? api('PUT', '/contacts/' + existing.id, data) : api('POST', '/contacts', data);
      promise.then(function () {
        closeModal();
        renderContacts();
      }).catch(function (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
      });
    });
  }

  function deleteContact(id) {
    if (!confirm('Delete this contact?')) return;
    api('DELETE', '/contacts/' + id).then(function () {
      renderContacts();
    }).catch(function (err) {
      alert('Error: ' + err.message);
    });
  }

  // -----------------------------------------------------------------------
  // GROUPS VIEW
  // -----------------------------------------------------------------------

  async function renderGroups() {
    showLoading();
    try {
      groupsCache = await api('GET', '/groups');
      var html = '<div class="card"><div class="card-header">' +
        '<h2 class="card-title">Contact Groups</h2>' +
        '<button class="btn btn-primary" id="addGroupBtn">+ New Group</button></div>';
      if (groupsCache.length === 0) {
        html += '<div class="empty-state"><p>No groups yet. Create one to organize contacts.</p></div>';
      } else {
        html += '<div class="table-wrap"><table><thead><tr>' +
          '<th>Name</th><th>Description</th><th>Members</th><th>Actions</th></tr></thead><tbody>';
        groupsCache.forEach(function (g) {
          html += '<tr>' +
            '<td><a href="#" class="view-group" data-id="' + g.id + '">' + escapeHtml(g.name) + '</a></td>' +
            '<td class="truncate">' + escapeHtml(g.description || '-') + '</td>' +
            '<td>' + g.member_count + '</td>' +
            '<td>' +
              '<button class="btn btn-sm btn-secondary manage-members" data-id="' + g.id + '">Members</button> ' +
              '<button class="btn btn-sm btn-secondary edit-group" data-id="' + g.id + '">Edit</button> ' +
              '<button class="btn btn-sm btn-danger delete-group" data-id="' + g.id + '">Delete</button>' +
            '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
      html += '</div>';
      contentEl.innerHTML = html;

      document.getElementById('addGroupBtn').addEventListener('click', function () {
        openGroupModal();
      });
      contentEl.querySelectorAll('.edit-group').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var group = groupsCache.find(function (g) { return g.id === parseInt(btn.dataset.id, 10); });
          if (group) openGroupModal(group);
        });
      });
      contentEl.querySelectorAll('.delete-group').forEach(function (btn) {
        btn.addEventListener('click', function () {
          deleteGroup(parseInt(btn.dataset.id, 10));
        });
      });
      contentEl.querySelectorAll('.manage-members, .view-group').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.preventDefault();
          openMembersModal(parseInt(el.dataset.id, 10));
        });
      });
    } catch (err) {
      showError('Failed to load groups: ' + err.message);
    }
  }

  function openGroupModal(existing) {
    var isEdit = !!existing;
    var html = '<form id="groupForm">' +
      '<div class="form-group"><label class="form-label">Name *</label>' +
      '<input class="form-input" name="name" value="' + escapeHtml(isEdit ? existing.name : '') + '" required></div>' +
      '<div class="form-group"><label class="form-label">Description</label>' +
      '<textarea class="form-textarea" name="description">' + escapeHtml(isEdit ? existing.description || '' : '') + '</textarea></div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="document.getElementById(\'modalOverlay\').classList.remove(\'open\')">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">' + (isEdit ? 'Update' : 'Create') + '</button>' +
      '</div></form>';
    openModal(isEdit ? 'Edit Group' : 'New Group', html);

    document.getElementById('groupForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var data = { name: form.name.value.trim(), description: form.description.value.trim() || null };
      var btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      var promise = isEdit ? api('PUT', '/groups/' + existing.id, data) : api('POST', '/groups', data);
      promise.then(function () {
        closeModal();
        renderGroups();
      }).catch(function (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
      });
    });
  }

  function deleteGroup(id) {
    if (!confirm('Delete this group? Members will not be deleted.')) return;
    api('DELETE', '/groups/' + id).then(function () {
      renderGroups();
    }).catch(function (err) {
      alert('Error: ' + err.message);
    });
  }

  async function openMembersModal(groupId) {
    var group = groupsCache.find(function (g) { return g.id === groupId; });
    openModal('Members of ' + (group ? group.name : 'Group'), '<div class="loading">Loading...</div>');

    try {
      var results = await Promise.all([
        api('GET', '/groups/' + groupId + '/members'),
        api('GET', '/contacts'),
      ]);
      var members = results[0];
      var allContacts = results[1];
      var memberIds = new Set(members.map(function (m) { return m.id; }));

      var html = '<h3 class="mb-8" style="font-size:14px;">Current Members</h3>';
      if (members.length === 0) {
        html += '<p class="text-secondary text-sm mb-16">No members yet.</p>';
      } else {
        html += '<div class="mb-16">';
        members.forEach(function (m) {
          html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">' +
            '<span>' + escapeHtml(m.first_name + ' ' + m.last_name) + '</span>' +
            '<button class="btn btn-sm btn-danger remove-member" data-cid="' + m.id + '">Remove</button></div>';
        });
        html += '</div>';
      }

      // Add member
      var nonMembers = allContacts.filter(function (c) { return !memberIds.has(c.id); });
      if (nonMembers.length > 0) {
        html += '<h3 class="mb-8" style="font-size:14px;">Add Member</h3>' +
          '<div style="display:flex;gap:8px;">' +
          '<select class="form-select" id="addMemberSelect" style="flex:1">';
        nonMembers.forEach(function (c) {
          html += '<option value="' + c.id + '">' + escapeHtml(c.first_name + ' ' + c.last_name) + '</option>';
        });
        html += '</select><button class="btn btn-sm btn-primary" id="addMemberBtn">Add</button></div>';
      } else {
        html += '<p class="text-secondary text-sm">All contacts are already in this group.</p>';
      }

      modalBody.innerHTML = html;

      // Bind events
      modalBody.querySelectorAll('.remove-member').forEach(function (btn) {
        btn.addEventListener('click', function () {
          api('DELETE', '/groups/' + groupId + '/members/' + btn.dataset.cid).then(function () {
            openMembersModal(groupId);
            // Also refresh the groups table in the background
            api('GET', '/groups').then(function (g) { groupsCache = g; });
          }).catch(function (err) { alert('Error: ' + err.message); });
        });
      });

      var addBtn = document.getElementById('addMemberBtn');
      if (addBtn) {
        addBtn.addEventListener('click', function () {
          var sel = document.getElementById('addMemberSelect');
          var contactId = parseInt(sel.value, 10);
          api('POST', '/groups/' + groupId + '/members', { contactId: contactId }).then(function () {
            openMembersModal(groupId);
            api('GET', '/groups').then(function (g) { groupsCache = g; });
          }).catch(function (err) { alert('Error: ' + err.message); });
        });
      }
    } catch (err) {
      modalBody.innerHTML = '<div class="error-msg">' + escapeHtml(err.message) + '</div>';
    }
  }

  // -----------------------------------------------------------------------
  // INVITES VIEW
  // -----------------------------------------------------------------------

  async function renderInvites() {
    showLoading();
    try {
      var results = await Promise.all([
        api('GET', '/invites'),
        api('GET', '/folders'),
        api('GET', '/contacts'),
        api('GET', '/groups'),
      ]);
      invitesCache = results[0];
      foldersCache = results[1];
      contactsCache = results[2];
      groupsCache = results[3];

      var html = '<div class="card"><div class="card-header"><h2 class="card-title">Send Invites</h2></div>';
      html += '<form id="inviteForm">';
      html += '<div style="display:flex;gap:16px;flex-wrap:wrap;">';

      // Folder selector
      html += '<div class="form-group" style="flex:1;min-width:200px;"><label class="form-label">Folder</label>' +
        '<select class="form-select" name="folderPath" required><option value="">Select folder...</option>';
      foldersCache.forEach(function (f) {
        var name = f.relativePath === '.' ? '(root)' : f.relativePath;
        html += '<option value="' + escapeHtml(f.relativePath) + '" data-gallery="' + escapeHtml(f.galleryUrl || '') + '">' + escapeHtml(name) + ' (' + f.fileCount + ' files)</option>';
      });
      html += '</select></div>';

      // Gallery URL
      html += '<div class="form-group" style="flex:1;min-width:200px;"><label class="form-label">Gallery URL</label>' +
        '<input class="form-input" name="galleryUrl" id="inviteGalleryUrl" placeholder="Auto-filled or paste URL" required></div>';
      html += '</div>';

      // Contacts
      html += '<div style="display:flex;gap:16px;flex-wrap:wrap;">';
      html += '<div class="form-group" style="flex:1;min-width:200px;"><label class="form-label">Contacts</label>' +
        '<div class="checkbox-list">';
      if (contactsCache.length === 0) {
        html += '<span class="text-secondary text-sm">No contacts</span>';
      } else {
        contactsCache.forEach(function (c) {
          html += '<label class="checkbox-item"><input type="checkbox" name="contactId" value="' + c.id + '"> ' +
            escapeHtml(c.first_name + ' ' + c.last_name) + '</label>';
        });
      }
      html += '</div></div>';

      // Groups
      html += '<div class="form-group" style="flex:1;min-width:200px;"><label class="form-label">Groups</label>' +
        '<div class="checkbox-list">';
      if (groupsCache.length === 0) {
        html += '<span class="text-secondary text-sm">No groups</span>';
      } else {
        groupsCache.forEach(function (g) {
          html += '<label class="checkbox-item"><input type="checkbox" name="groupId" value="' + g.id + '"> ' +
            escapeHtml(g.name) + ' (' + g.member_count + ')</label>';
        });
      }
      html += '</div></div></div>';

      html += '<div class="form-actions"><button type="submit" class="btn btn-primary">Send Invites</button></div>';
      html += '</form></div>';

      // Invite history
      html += '<div class="card"><div class="card-header"><h2 class="card-title">Invite History</h2></div>';
      if (invitesCache.length === 0) {
        html += '<div class="empty-state"><p>No invites sent yet.</p></div>';
      } else {
        html += '<div class="table-wrap"><table><thead><tr>' +
          '<th>Recipient</th><th>Email</th><th>Folder</th><th>Status</th><th>Sent</th></tr></thead><tbody>';
        invitesCache.forEach(function (inv) {
          var name = inv.first_name ? escapeHtml(inv.first_name + ' ' + inv.last_name) : '-';
          html += '<tr>' +
            '<td>' + name + '</td>' +
            '<td>' + escapeHtml(inv.email) + '</td>' +
            '<td>' + escapeHtml(inv.folder_path) + '</td>' +
            '<td>' + statusBadge(inv.status) + '</td>' +
            '<td>' + formatDate(inv.sent_at) + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
      html += '</div>';

      contentEl.innerHTML = html;

      // Auto-fill gallery URL when folder changes
      var folderSelect = contentEl.querySelector('[name="folderPath"]');
      folderSelect.addEventListener('change', function () {
        var opt = folderSelect.options[folderSelect.selectedIndex];
        var url = opt.dataset.gallery || '';
        document.getElementById('inviteGalleryUrl').value = url;
      });

      // Submit handler
      document.getElementById('inviteForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var form = e.target;
        var folderPath = form.folderPath.value;
        var galleryUrl = form.galleryUrl.value.trim();
        var contactIds = Array.from(form.querySelectorAll('[name="contactId"]:checked')).map(function (el) { return parseInt(el.value, 10); });
        var groupIds = Array.from(form.querySelectorAll('[name="groupId"]:checked')).map(function (el) { return parseInt(el.value, 10); });

        if (contactIds.length === 0 && groupIds.length === 0) {
          alert('Select at least one contact or group.');
          return;
        }

        var btn = form.querySelector('[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Sending...';

        api('POST', '/invites/send', { contactIds: contactIds, groupIds: groupIds, folderPath: folderPath, galleryUrl: galleryUrl })
          .then(function (result) {
            alert('Sent: ' + result.sent + ', Failed: ' + result.failed);
            renderInvites();
          })
          .catch(function (err) {
            alert('Error: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Send Invites';
          });
      });
    } catch (err) {
      showError('Failed to load invites view: ' + err.message);
    }
  }

  // -----------------------------------------------------------------------
  // SYNC LOG VIEW
  // -----------------------------------------------------------------------

  async function renderSyncLog() {
    showLoading();
    await refreshSyncLog();

    // Start polling every 5 seconds
    if (syncPollTimer) clearInterval(syncPollTimer);
    syncPollTimer = setInterval(function () {
      if (currentView === 'synclog') refreshSyncLog();
    }, 5000);
  }

  async function refreshSyncLog() {
    try {
      var data = await api('GET', '/sync-status');
      var q = data.queue;
      var s = data.summary;

      var html = '<div class="stats-row">' +
        '<div class="stat-card"><div class="stat-value" style="color:var(--success)">' + s.synced + '</div><div class="stat-label">Synced</div></div>' +
        '<div class="stat-card"><div class="stat-value" style="color:var(--warning)">' + s.pending + '</div><div class="stat-label">Pending</div></div>' +
        '<div class="stat-card"><div class="stat-value" style="color:var(--primary)">' + s.syncing + '</div><div class="stat-label">Syncing</div></div>' +
        '<div class="stat-card"><div class="stat-value" style="color:var(--danger)">' + s.failed + '</div><div class="stat-label">Failed</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + q.queueLength + '</div><div class="stat-label">In Queue</div></div>' +
        '</div>';

      // Update top-bar indicator
      if (q.processing || q.queueLength > 0) {
        statusDot.className = 'status-dot syncing';
        statusText.textContent = 'Syncing (' + q.queueLength + ' queued)';
      } else if (s.failed > 0 && s.pending === 0 && s.syncing === 0) {
        statusDot.className = 'status-dot error';
        statusText.textContent = s.synced + ' synced, ' + s.failed + ' failed';
      } else {
        statusDot.className = 'status-dot online';
        statusText.textContent = s.synced + ' synced';
      }

      html += '<div class="card"><div class="card-header"><h2 class="card-title">Recent Sync Log</h2>' +
        '<span class="text-secondary text-sm">Auto-refreshing every 5s</span></div>';
      if (data.recent.length === 0) {
        html += '<div class="empty-state"><p>No files synced yet. Add photos to the watched directory.</p></div>';
      } else {
        html += '<div class="table-wrap"><table><thead><tr>' +
          '<th>File</th><th>Status</th><th>Attempts</th><th>Created</th><th>Synced</th><th>Error</th></tr></thead><tbody>';
        data.recent.forEach(function (entry) {
          html += '<tr>' +
            '<td class="truncate" title="' + escapeHtml(entry.relative_path) + '">' + escapeHtml(entry.relative_path) + '</td>' +
            '<td>' + statusBadge(entry.status) + '</td>' +
            '<td>' + entry.attempts + '</td>' +
            '<td>' + formatDate(entry.created_at) + '</td>' +
            '<td>' + formatDate(entry.synced_at) + '</td>' +
            '<td class="truncate text-sm" title="' + escapeHtml(entry.last_error || '') + '">' + escapeHtml(entry.last_error || '-') + '</td>' +
            '</tr>';
        });
        html += '</tbody></table></div>';
      }
      html += '</div>';

      contentEl.innerHTML = html;
    } catch (err) {
      // Don't overwrite the entire view on a single poll failure
      if (contentEl.querySelector('.stats-row')) {
        console.error('[sync-log] Refresh error:', err.message);
      } else {
        showError('Failed to load sync status: ' + err.message);
      }
    }
  }

  // -----------------------------------------------------------------------
  // SETTINGS VIEW
  // -----------------------------------------------------------------------

  function renderSettings() {
    var html = '<div class="card"><div class="card-header"><h2 class="card-title">Settings</h2></div>';
    html += '<div class="form-group"><label class="form-label">Thumbnail Size</label>' +
      '<div class="settings-radio-group">';
    ['small', 'medium', 'large'].forEach(function (size) {
      var checked = thumbnailSize === size ? ' checked' : '';
      html += '<label><input type="radio" name="thumbSize" value="' + size + '"' + checked + '> ' +
        size.charAt(0).toUpperCase() + size.slice(1) + ' (' + THUMB_SIZES[size] + 'px)</label>';
    });
    html += '</div></div></div>';
    contentEl.innerHTML = html;

    contentEl.querySelectorAll('[name="thumbSize"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        thumbnailSize = radio.value;
        localStorage.setItem('thumbnailSize', thumbnailSize);
        document.documentElement.style.setProperty('--thumb-size', THUMB_SIZES[thumbnailSize] + 'px');
      });
    });
  }

  // -----------------------------------------------------------------------
  // Initial sync status indicator
  // -----------------------------------------------------------------------

  function updateStatusIndicator() {
    api('GET', '/sync-status').then(function (data) {
      var q = data.queue;
      var s = data.summary;
      if (q.processing || q.queueLength > 0) {
        statusDot.className = 'status-dot syncing';
        statusText.textContent = 'Syncing (' + q.queueLength + ' queued)';
      } else if (s.failed > 0 && s.pending === 0 && s.syncing === 0) {
        statusDot.className = 'status-dot error';
        statusText.textContent = s.synced + ' synced, ' + s.failed + ' failed';
      } else {
        statusDot.className = 'status-dot online';
        statusText.textContent = s.synced + ' synced';
      }
    }).catch(function () {
      statusDot.className = 'status-dot error';
      statusText.textContent = 'Offline';
    });
  }

  // Poll global status every 10 seconds for the header indicator
  setInterval(updateStatusIndicator, 10000);

  // -----------------------------------------------------------------------
  // Boot
  // -----------------------------------------------------------------------

  // Apply saved thumbnail size
  document.documentElement.style.setProperty('--thumb-size', THUMB_SIZES[thumbnailSize] + 'px');

  renderView();
  updateStatusIndicator();

})();
