package com.localsync.portal.controller;

import com.localsync.portal.model.Folder;
import com.localsync.portal.model.PhotoFile;
import com.localsync.portal.repository.FolderRepository;
import com.localsync.portal.repository.PhotoFileRepository;
import com.localsync.portal.service.StorageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.ResponseBody;

import java.net.MalformedURLException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Public gallery endpoints. No authentication required.
 * Gallery pages are unlisted -- there is no index of all galleries.
 */
@Controller
public class GalleryController {

    private static final Logger log = LoggerFactory.getLogger(GalleryController.class);

    private final FolderRepository folderRepository;
    private final PhotoFileRepository photoFileRepository;
    private final StorageService storageService;

    public GalleryController(FolderRepository folderRepository,
                             PhotoFileRepository photoFileRepository,
                             StorageService storageService) {
        this.folderRepository = folderRepository;
        this.photoFileRepository = photoFileRepository;
        this.storageService = storageService;
    }

    /**
     * GET /gallery/{folderUuid}
     * Forward to the static gallery.html page. The JS on that page reads
     * the UUID from the URL path and fetches data via the API.
     */
    @GetMapping("/gallery/{folderUuid}")
    public String galleryPage(@PathVariable String folderUuid) {
        // Validate UUID format
        try {
            UUID.fromString(folderUuid);
        } catch (IllegalArgumentException e) {
            return "forward:/404.html";
        }
        return "forward:/gallery.html";
    }

    /**
     * GET /api/gallery/{folderUuid}/info
     * Returns folder metadata as JSON.
     */
    @GetMapping("/api/gallery/{folderUuid}/info")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> getFolderInfo(@PathVariable String folderUuid) {
        UUID uuid;
        try {
            uuid = UUID.fromString(folderUuid);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid UUID format"));
        }

        Optional<Folder> folderOpt = folderRepository.findByUuid(uuid);
        if (folderOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Gallery not found"));
        }

        Folder folder = folderOpt.get();

        if (!folder.getVisible()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Gallery not found"));
        }

        Map<String, Object> info = new LinkedHashMap<>();
        info.put("displayName", folder.getDisplayName());
        info.put("photoCount", folder.getPhotoCount());
        info.put("createdAt", folder.getCreatedAt().toString());

        return ResponseEntity.ok(info);
    }

    /**
     * GET /api/gallery/{folderUuid}/photos
     * Returns list of visible photos in the gallery as JSON.
     */
    @GetMapping("/api/gallery/{folderUuid}/photos")
    @ResponseBody
    public ResponseEntity<?> getGalleryPhotos(@PathVariable String folderUuid) {
        UUID uuid;
        try {
            uuid = UUID.fromString(folderUuid);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid UUID format"));
        }

        Optional<Folder> folderOpt = folderRepository.findByUuid(uuid);
        if (folderOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Gallery not found"));
        }

        Folder folder = folderOpt.get();

        if (!folder.getVisible()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Gallery not found"));
        }

        List<PhotoFile> photos = photoFileRepository.findAllByFolderIdAndVisibleTrue(folder.getId());

        List<Map<String, Object>> photoList = photos.stream()
                .map(photo -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("uuid", photo.getUuid().toString());
                    m.put("filename", photo.getFilename());
                    m.put("uploadedAt", photo.getUploadedAt().toString());
                    return m;
                })
                .collect(Collectors.toList());

        return ResponseEntity.ok(photoList);
    }

    /**
     * GET /photos/{photoUuid}
     * Serve the photo file inline.
     */
    @GetMapping("/photos/{photoUuid}")
    @ResponseBody
    public ResponseEntity<Resource> servePhoto(@PathVariable String photoUuid) {
        return servePhotoFile(photoUuid, false);
    }

    /**
     * GET /photos/{photoUuid}/download
     * Serve the photo file as a download attachment.
     */
    @GetMapping("/photos/{photoUuid}/download")
    @ResponseBody
    public ResponseEntity<Resource> downloadPhoto(@PathVariable String photoUuid) {
        return servePhotoFile(photoUuid, true);
    }

    /**
     * Shared logic for serving a photo file either inline or as attachment.
     */
    private ResponseEntity<Resource> servePhotoFile(String photoUuid, boolean asAttachment) {
        UUID uuid;
        try {
            uuid = UUID.fromString(photoUuid);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }

        Optional<PhotoFile> photoOpt = photoFileRepository.findByUuid(uuid);
        if (photoOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        PhotoFile photo = photoOpt.get();

        try {
            Resource resource = storageService.loadFile(photo.getRelativePath());

            String contentType = photo.getContentType();
            if (contentType == null || contentType.isBlank()) {
                contentType = "application/octet-stream";
            }

            HttpHeaders headers = new HttpHeaders();
            if (asAttachment) {
                headers.add(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + photo.getFilename() + "\"");
            } else {
                headers.add(HttpHeaders.CONTENT_DISPOSITION,
                        "inline; filename=\"" + photo.getFilename() + "\"");
            }

            return ResponseEntity.ok()
                    .headers(headers)
                    .contentType(MediaType.parseMediaType(contentType))
                    .body(resource);

        } catch (MalformedURLException e) {
            log.error("Malformed URL for photo: {}", photo.getRelativePath(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        } catch (RuntimeException e) {
            log.error("Could not load photo file: {}", photo.getRelativePath(), e);
            return ResponseEntity.notFound().build();
        }
    }
}
