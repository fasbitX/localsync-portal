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

  async function renderFolders() {
    showLoading();
    try {
      foldersCache = await api('GET', '/folders');
      var html = '<div class="card"><div class="card-header">' +
        '<h2 class="card-title">Photo Folders</h2></div>';
      if (foldersCache.length === 0) {
        html += '<div class="empty-state"><p>No folders found. Drop photos into the watched directory.</p></div>';
      } else {
        foldersCache.forEach(function (f) {
          var name = f.relativePath === '.' ? '(root)' : escapeHtml(f.relativePath);
          html += '<div class="folder-item">' +
            '<div class="folder-info">' +
              '<span class="folder-icon">&#128193;</span>' +
              '<div><div class="folder-name">' + name + '</div>' +
              '<div class="folder-meta">' + f.fileCount + ' image' + (f.fileCount !== 1 ? 's' : '') + '</div></div>' +
            '</div>' +
            '<div class="folder-actions">';
          if (f.galleryUrl) {
            html += '<a href="' + escapeHtml(f.galleryUrl) + '" target="_blank" class="gallery-link">Gallery</a>';
          }
          html += '<button class="btn btn-sm btn-primary" data-folder-invite="' + escapeHtml(f.relativePath) + '" data-gallery="' + escapeHtml(f.galleryUrl || '') + '">Send Invites</button>';
          html += '</div></div>';
        });
      }
      html += '</div>';
      contentEl.innerHTML = html;

      // Bind invite buttons
      contentEl.querySelectorAll('[data-folder-invite]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          openFolderInviteModal(btn.dataset.folderInvite, btn.dataset.gallery);
        });
      });
    } catch (err) {
      showError('Failed to load folders: ' + err.message);
    }
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
