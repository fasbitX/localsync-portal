/**
 * LocalSync Portal - Admin Dashboard Frontend
 *
 * Handles login, folder listing, photo listing, visibility toggles,
 * and deletion with confirmation dialogs.
 */
(function () {
    "use strict";

    // --- State ---
    var folders = [];
    var selectedFolderId = null;
    var confirmCallback = null;

    // --- DOM refs ---
    var loginView = document.getElementById("login-view");
    var dashboardView = document.getElementById("dashboard-view");
    var loginForm = document.getElementById("login-form");
    var loginError = document.getElementById("login-error");
    var logoutBtn = document.getElementById("logout-btn");
    var folderListEl = document.getElementById("folder-list");
    var noSelectionEl = document.getElementById("no-selection");
    var folderDetailEl = document.getElementById("folder-detail");
    var detailTitle = document.getElementById("detail-title");
    var detailMeta = document.getElementById("detail-meta");
    var detailGalleryLink = document.getElementById("detail-gallery-link");
    var toggleFolderVisBtn = document.getElementById("toggle-folder-vis-btn");
    var deleteFolderBtn = document.getElementById("delete-folder-btn");
    var photoListEl = document.getElementById("photo-list");
    var confirmOverlay = document.getElementById("confirm-overlay");
    var confirmMessage = document.getElementById("confirm-message");
    var confirmCancel = document.getElementById("confirm-cancel");
    var confirmOk = document.getElementById("confirm-ok");

    // --- Init: try to load folders (if session is valid we get data, otherwise 401) ---
    async function init() {
        try {
            var res = await fetch("/api/admin/folders");
            if (res.ok) {
                showDashboard();
                folders = await res.json();
                renderFolderList();
            } else {
                showLogin();
            }
        } catch (e) {
            showLogin();
        }
    }

    function showLogin() {
        loginView.style.display = "flex";
        dashboardView.style.display = "none";
    }

    function showDashboard() {
        loginView.style.display = "none";
        dashboardView.style.display = "flex";
    }

    // --- Login ---
    loginForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        loginError.style.display = "none";

        var username = document.getElementById("username").value.trim();
        var password = document.getElementById("password").value;

        if (!username || !password) {
            loginError.textContent = "Please enter both username and password.";
            loginError.style.display = "block";
            return;
        }

        try {
            var body = new URLSearchParams();
            body.append("username", username);
            body.append("password", password);

            var res = await fetch("/admin/login", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: body.toString()
            });

            var data = await res.json();

            if (res.ok) {
                showDashboard();
                await loadFolders();
            } else {
                loginError.textContent = data.error || "Login failed.";
                loginError.style.display = "block";
            }
        } catch (err) {
            loginError.textContent = "Connection error. Please try again.";
            loginError.style.display = "block";
        }
    });

    // --- Logout ---
    logoutBtn.addEventListener("click", async function () {
        try {
            await fetch("/admin/logout", { method: "POST" });
        } catch (e) {
            // ignore
        }
        showLogin();
        folders = [];
        selectedFolderId = null;
    });

    // --- Folders ---
    async function loadFolders() {
        try {
            var res = await fetch("/api/admin/folders");
            if (!res.ok) {
                if (res.status === 401) {
                    showLogin();
                    return;
                }
                return;
            }
            folders = await res.json();
            renderFolderList();
        } catch (e) {
            console.error("Failed to load folders", e);
        }
    }

    function renderFolderList() {
        if (folders.length === 0) {
            folderListEl.innerHTML = '<p class="muted">No folders yet.</p>';
            return;
        }

        folderListEl.innerHTML = "";
        folders.forEach(function (folder) {
            var item = document.createElement("div");
            item.className = "folder-item";
            if (folder.id === selectedFolderId) {
                item.classList.add("active");
            }
            if (!folder.visible) {
                item.classList.add("folder-item-hidden");
            }

            var info = document.createElement("div");
            info.className = "folder-item-info";

            var name = document.createElement("div");
            name.className = "folder-item-name";
            name.textContent = folder.displayName || folder.relativePath;

            var count = document.createElement("div");
            count.className = "folder-item-count";
            count.textContent = folder.photoCount + " photo" +
                (folder.photoCount !== 1 ? "s" : "") +
                (folder.visible ? "" : " (hidden)");

            info.appendChild(name);
            info.appendChild(count);
            item.appendChild(info);

            item.addEventListener("click", function () {
                selectFolder(folder.id);
            });

            folderListEl.appendChild(item);
        });
    }

    async function selectFolder(folderId) {
        selectedFolderId = folderId;
        renderFolderList();

        var folder = folders.find(function (f) { return f.id === folderId; });
        if (!folder) return;

        noSelectionEl.style.display = "none";
        folderDetailEl.style.display = "block";

        detailTitle.textContent = folder.displayName || folder.relativePath;
        detailMeta.textContent = folder.relativePath +
            " \u00B7 " + folder.photoCount + " photo" +
            (folder.photoCount !== 1 ? "s" : "");
        detailGalleryLink.innerHTML =
            '<a href="' + folder.galleryUrl + '" target="_blank">Gallery link: ' +
            window.location.origin + folder.galleryUrl + '</a>';

        toggleFolderVisBtn.textContent = folder.visible ? "Hide" : "Show";

        // Load photos
        await loadPhotos(folderId);
    }

    // --- Toggle folder visibility ---
    toggleFolderVisBtn.addEventListener("click", async function () {
        if (!selectedFolderId) return;
        try {
            var res = await fetch("/api/admin/folders/" + selectedFolderId + "/visibility", {
                method: "PATCH"
            });
            if (res.ok) {
                var updated = await res.json();
                // Update local state
                var idx = folders.findIndex(function (f) { return f.id === updated.id; });
                if (idx >= 0) folders[idx] = updated;
                renderFolderList();
                toggleFolderVisBtn.textContent = updated.visible ? "Hide" : "Show";
            }
        } catch (e) {
            console.error("Failed to toggle folder visibility", e);
        }
    });

    // --- Delete folder ---
    deleteFolderBtn.addEventListener("click", function () {
        if (!selectedFolderId) return;
        var folder = folders.find(function (f) { return f.id === selectedFolderId; });
        var name = folder ? (folder.displayName || folder.relativePath) : "this folder";
        showConfirm(
            "Delete \"" + name + "\" and all its photos? This cannot be undone.",
            async function () {
                try {
                    var res = await fetch("/api/admin/folders/" + selectedFolderId, {
                        method: "DELETE"
                    });
                    if (res.ok) {
                        selectedFolderId = null;
                        folderDetailEl.style.display = "none";
                        noSelectionEl.style.display = "block";
                        await loadFolders();
                    }
                } catch (e) {
                    console.error("Failed to delete folder", e);
                }
            }
        );
    });

    // --- Photos ---
    async function loadPhotos(folderId) {
        photoListEl.innerHTML = '<p class="muted">Loading photos...</p>';

        try {
            var res = await fetch("/api/admin/folders/" + folderId + "/photos");
            if (!res.ok) {
                photoListEl.innerHTML = '<p class="muted">Failed to load photos.</p>';
                return;
            }
            var photos = await res.json();
            renderPhotos(photos);
        } catch (e) {
            photoListEl.innerHTML = '<p class="muted">Failed to load photos.</p>';
        }
    }

    function renderPhotos(photos) {
        if (photos.length === 0) {
            photoListEl.innerHTML = '<p class="muted">No photos in this folder.</p>';
            return;
        }

        photoListEl.innerHTML = "";
        photos.forEach(function (photo) {
            var item = document.createElement("div");
            item.className = "photo-item";
            if (!photo.visible) {
                item.classList.add("photo-item-hidden");
            }

            var img = document.createElement("img");
            img.src = "/photos/" + photo.uuid;
            img.alt = photo.filename;
            img.loading = "lazy";

            var info = document.createElement("div");
            info.className = "photo-item-info";

            var nameEl = document.createElement("div");
            nameEl.className = "photo-item-name";
            nameEl.title = photo.filename;
            nameEl.textContent = photo.filename;

            var actions = document.createElement("div");
            actions.className = "photo-item-actions";

            var visBtn = document.createElement("button");
            visBtn.className = "btn btn-sm btn-outline";
            visBtn.textContent = photo.visible ? "Hide" : "Show";
            visBtn.addEventListener("click", function () {
                togglePhotoVisibility(photo.id);
            });

            var delBtn = document.createElement("button");
            delBtn.className = "btn btn-sm btn-danger";
            delBtn.textContent = "Delete";
            delBtn.addEventListener("click", function () {
                showConfirm(
                    "Delete photo \"" + photo.filename + "\"? This cannot be undone.",
                    function () { deletePhoto(photo.id); }
                );
            });

            actions.appendChild(visBtn);
            actions.appendChild(delBtn);
            info.appendChild(nameEl);
            info.appendChild(actions);
            item.appendChild(img);
            item.appendChild(info);
            photoListEl.appendChild(item);
        });
    }

    async function togglePhotoVisibility(photoId) {
        try {
            var res = await fetch("/api/admin/photos/" + photoId + "/visibility", {
                method: "PATCH"
            });
            if (res.ok && selectedFolderId) {
                await loadPhotos(selectedFolderId);
            }
        } catch (e) {
            console.error("Failed to toggle photo visibility", e);
        }
    }

    async function deletePhoto(photoId) {
        try {
            var res = await fetch("/api/admin/photos/" + photoId, {
                method: "DELETE"
            });
            if (res.ok) {
                // Refresh folders (photo count changed) and photos
                await loadFolders();
                if (selectedFolderId) {
                    // Re-select to update detail header
                    await selectFolder(selectedFolderId);
                }
            }
        } catch (e) {
            console.error("Failed to delete photo", e);
        }
    }

    // --- Confirm Dialog ---
    function showConfirm(message, onConfirm) {
        confirmMessage.textContent = message;
        confirmCallback = onConfirm;
        confirmOverlay.style.display = "flex";
    }

    function hideConfirm() {
        confirmOverlay.style.display = "none";
        confirmCallback = null;
    }

    confirmCancel.addEventListener("click", hideConfirm);

    confirmOk.addEventListener("click", function () {
        if (confirmCallback) {
            confirmCallback();
        }
        hideConfirm();
    });

    confirmOverlay.addEventListener("click", function (e) {
        if (e.target === confirmOverlay) {
            hideConfirm();
        }
    });

    // --- Start ---
    init();
})();
