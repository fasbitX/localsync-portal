/**
 * LocalSync Portal - Gallery Frontend
 *
 * Reads the folder UUID from the URL path (/gallery/{uuid}),
 * fetches gallery info and photos, renders a responsive grid,
 * and provides a lightbox overlay for full-size viewing.
 */
(function () {
    "use strict";

    // --- State ---
    let photos = [];
    let currentIndex = -1;

    // --- DOM refs ---
    const loadingEl = document.getElementById("loading");
    const errorEl = document.getElementById("error");
    const galleryEl = document.getElementById("gallery");
    const titleEl = document.getElementById("gallery-title");
    const metaEl = document.getElementById("gallery-meta");
    const emptyEl = document.getElementById("empty-message");
    const gridEl = document.getElementById("photo-grid");
    const lightboxEl = document.getElementById("lightbox");
    const lightboxImg = document.getElementById("lightbox-img");
    const lightboxFilename = document.getElementById("lightbox-filename");
    const lightboxDownload = document.getElementById("lightbox-download");

    // --- Extract UUID from URL ---
    function getFolderUuid() {
        var parts = window.location.pathname.split("/");
        // Expect /gallery/{uuid}
        var idx = parts.indexOf("gallery");
        if (idx >= 0 && idx + 1 < parts.length) {
            return parts[idx + 1];
        }
        return null;
    }

    // --- Format date ---
    function formatDate(isoString) {
        try {
            var d = new Date(isoString);
            return d.toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric"
            });
        } catch (e) {
            return isoString;
        }
    }

    // --- Fetch and render ---
    async function init() {
        var uuid = getFolderUuid();
        if (!uuid) {
            showError();
            return;
        }

        try {
            // Fetch folder info and photos in parallel
            var [infoRes, photosRes] = await Promise.all([
                fetch("/api/gallery/" + uuid + "/info"),
                fetch("/api/gallery/" + uuid + "/photos")
            ]);

            if (!infoRes.ok || !photosRes.ok) {
                showError();
                return;
            }

            var info = await infoRes.json();
            photos = await photosRes.json();

            renderGallery(info, photos);
        } catch (err) {
            console.error("Failed to load gallery:", err);
            showError();
        }
    }

    function showError() {
        loadingEl.style.display = "none";
        errorEl.style.display = "block";
    }

    function renderGallery(info, photoList) {
        loadingEl.style.display = "none";
        galleryEl.style.display = "block";

        document.title = (info.displayName || "Gallery") + " - LocalSync";
        titleEl.textContent = info.displayName || "Gallery";
        metaEl.textContent = info.photoCount + " photo" +
            (info.photoCount !== 1 ? "s" : "") +
            " \u00B7 Created " + formatDate(info.createdAt);

        if (photoList.length === 0) {
            emptyEl.style.display = "block";
            return;
        }

        gridEl.innerHTML = "";
        photoList.forEach(function (photo, index) {
            var card = document.createElement("div");
            card.className = "photo-card";
            card.setAttribute("data-index", index);

            var img = document.createElement("img");
            img.src = "/photos/" + photo.uuid;
            img.alt = photo.filename;
            img.loading = "lazy";

            var name = document.createElement("div");
            name.className = "photo-name";
            name.textContent = photo.filename;

            var dl = document.createElement("a");
            dl.className = "photo-download";
            dl.href = "/photos/" + photo.uuid + "/download";
            dl.title = "Download";
            dl.textContent = "\u2193";
            dl.addEventListener("click", function (e) {
                e.stopPropagation();
            });

            card.appendChild(img);
            card.appendChild(name);
            card.appendChild(dl);

            card.addEventListener("click", function () {
                openLightbox(index);
            });

            gridEl.appendChild(card);
        });
    }

    // --- Lightbox ---
    function openLightbox(index) {
        currentIndex = index;
        updateLightboxContent();
        lightboxEl.style.display = "block";
        document.body.style.overflow = "hidden";
    }

    function closeLightbox() {
        lightboxEl.style.display = "none";
        document.body.style.overflow = "";
        currentIndex = -1;
    }

    function navigateLightbox(delta) {
        if (photos.length === 0) return;
        currentIndex = (currentIndex + delta + photos.length) % photos.length;
        updateLightboxContent();
    }

    function updateLightboxContent() {
        if (currentIndex < 0 || currentIndex >= photos.length) return;
        var photo = photos[currentIndex];
        lightboxImg.src = "/photos/" + photo.uuid;
        lightboxImg.alt = photo.filename;
        lightboxFilename.textContent = photo.filename;
        lightboxDownload.href = "/photos/" + photo.uuid + "/download";
    }

    // --- Event listeners ---
    document.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
    document.querySelector(".lightbox-backdrop").addEventListener("click", closeLightbox);
    document.querySelector(".lightbox-prev").addEventListener("click", function () {
        navigateLightbox(-1);
    });
    document.querySelector(".lightbox-next").addEventListener("click", function () {
        navigateLightbox(1);
    });

    document.addEventListener("keydown", function (e) {
        if (lightboxEl.style.display === "none") return;
        if (e.key === "Escape") closeLightbox();
        if (e.key === "ArrowLeft") navigateLightbox(-1);
        if (e.key === "ArrowRight") navigateLightbox(1);
    });

    // --- Start ---
    init();
})();
