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
  }

  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', function (e) {
    if (e.target === modalOverlay) closeModal();
  });

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
    if (e.key === 'Escape') hideContextMenu();
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
      var typeClass = node.isPhoto ? ' tree-node--photo' : '';

      html += '<li class="tree-node' + typeClass + '" data-path="' + escapeHtml(node.relativePath) + '">';
      html += '<div class="tree-row">';
      html += '<span class="tree-indent" style="width:' + (depth * 20) + 'px"></span>';

      if (hasChildren) {
        html += '<span class="tree-chevron tree-chevron--open">&#9654;</span>';
      } else {
        html += '<span class="tree-chevron tree-chevron--leaf">&#9654;</span>';
      }

      if (node.isPhoto) {
        html += '<span class="tree-icon tree-icon--photo">&#128247;</span>';
      } else {
        html += '<span class="tree-icon tree-icon--header">&#128193;</span>';
      }

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
      if (!chevron) return;
      toggleNode(chevron.closest('.tree-node'));
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

      var html = '<div class="card"><div class="card-header">' +
        '<h2 class="card-title">Photo Folders</h2>' +
        '<button class="btn btn-primary" id="createFolderBtn">+ New Folder</button></div>';

      if (tree.length === 0) {
        html += '<div class="empty-state"><p>No folders found. Create one or drop photos into the watched directory.</p></div>';
      } else {
        html += '<ul class="folder-tree">' + renderTreeNodes(tree, 0) + '</ul>';
        html += '<p class="text-secondary text-sm" style="padding:8px 12px 0;">Right-click a folder for actions</p>';
      }

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

  function openUploadPhotosModal(folderPath) {
    var encodedPath = folderPath.replace(/\//g, '--');
    var html = '<form id="uploadPhotosForm" enctype="multipart/form-data">' +
      '<div class="form-group"><label class="form-label">Folder</label>' +
      '<input class="form-input" value="' + escapeHtml(folderPath) + '" readonly></div>' +
      '<div class="form-group"><label class="form-label">Select Photos</label>' +
      '<input class="form-input" type="file" name="photos" multiple accept=".jpg,.jpeg,.png,.tiff,.tif,.raw,.cr2,.nef,.arw" required>' +
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

      var btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Uploading...';
      var progressDiv = document.getElementById('uploadProgress');
      var progressBar = document.getElementById('uploadBar');
      var statusText = document.getElementById('uploadStatus');
      progressDiv.style.display = 'block';

      var formData = new FormData();
      for (var i = 0; i < files.length; i++) {
        formData.append('photos', files[i]);
      }

      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/folders/' + encodedPath + '/upload');

      xhr.upload.addEventListener('progress', function (evt) {
        if (evt.lengthComputable) {
          var pct = Math.round((evt.loaded / evt.total) * 100);
          progressBar.style.width = pct + '%';
          statusText.textContent = 'Uploading... ' + pct + '%';
        }
      });

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          var result = JSON.parse(xhr.responseText);
          closeModal();
          renderFolders();
          alert(result.uploaded + ' photo(s) uploaded to ' + folderPath + '.\nThe watcher will sync them to the remote server.');
        } else {
          var err = JSON.parse(xhr.responseText || '{}');
          alert('Upload failed: ' + (err.error || xhr.statusText));
          btn.disabled = false;
          btn.textContent = 'Upload';
        }
      };

      xhr.onerror = function () {
        alert('Upload failed: network error');
        btn.disabled = false;
        btn.textContent = 'Upload';
      };

      xhr.send(formData);
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

  renderView();
  updateStatusIndicator();

})();
