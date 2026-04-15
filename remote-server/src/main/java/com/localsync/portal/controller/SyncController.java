package com.localsync.portal.controller;

import com.localsync.portal.model.Folder;
import com.localsync.portal.model.PhotoFile;
import com.localsync.portal.repository.FolderRepository;
import com.localsync.portal.repository.PhotoFileRepository;
import com.localsync.portal.service.StorageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Handles sync-related operations: deleting photos/folders and renaming folders.
 * All endpoints require a valid API key via the X-API-Key header.
 */
@RestController
@RequestMapping("/api")
public class SyncController {

    private static final Logger log = LoggerFactory.getLogger(SyncController.class);

    private final FolderRepository folderRepository;
    private final PhotoFileRepository photoFileRepository;
    private final StorageService storageService;

    public SyncController(FolderRepository folderRepository,
                          PhotoFileRepository photoFileRepository,
                          StorageService storageService) {
        this.folderRepository = folderRepository;
        this.photoFileRepository = photoFileRepository;
        this.storageService = storageService;
    }

    /**
     * DELETE /api/photos?relativePath=...
     * Delete a single photo by its relative path.
     * Idempotent: returns 200 even if the photo was already deleted.
     */
    @DeleteMapping("/photos")
    @Transactional
    public ResponseEntity<Map<String, Object>> deletePhoto(
            @RequestParam("relativePath") String relativePath) {

        String normalizedPath = normalizePath(relativePath);

        Optional<PhotoFile> existing = photoFileRepository.findByRelativePath(normalizedPath);
        if (existing.isEmpty()) {
            Map<String, Object> response = new LinkedHashMap<>();
            response.put("message", "Photo not found (already deleted)");
            return ResponseEntity.ok(response);
        }

        PhotoFile photo = existing.get();
        Folder folder = photo.getFolder();

        // Delete from DB
        photoFileRepository.delete(photo);

        // Update folder photo count
        int count = photoFileRepository.countByFolderId(folder.getId());
        folder.setPhotoCount(count);
        folderRepository.save(folder);

        // Delete from disk (best-effort)
        try {
            storageService.deleteFile(normalizedPath);
        } catch (Exception e) {
            log.warn("Could not delete file from disk (may already be gone): {}", normalizedPath, e);
        }

        log.info("Deleted photo: {}", normalizedPath);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("message", "Photo deleted");
        return ResponseEntity.ok(response);
    }

    /**
     * DELETE /api/folders?relativePath=...
     * Delete a folder and all its photos by relative path.
     * Idempotent: returns 200 even if the folder was already deleted.
     */
    @DeleteMapping("/folders")
    @Transactional
    public ResponseEntity<Map<String, Object>> deleteFolder(
            @RequestParam("relativePath") String relativePath) {

        String normalizedPath = normalizePath(relativePath);

        Optional<Folder> existing = folderRepository.findByRelativePath(normalizedPath);
        if (existing.isEmpty()) {
            Map<String, Object> response = new LinkedHashMap<>();
            response.put("message", "Folder not found (already deleted)");
            return ResponseEntity.ok(response);
        }

        Folder folder = existing.get();

        // Delete from DB (cascade handles photos)
        folderRepository.delete(folder);

        // Delete from disk (best-effort)
        try {
            storageService.deleteDirectory(normalizedPath);
        } catch (Exception e) {
            log.warn("Could not delete directory from disk (may already be gone): {}", normalizedPath, e);
        }

        log.info("Deleted folder: {}", normalizedPath);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("message", "Folder deleted");
        return ResponseEntity.ok(response);
    }

    /**
     * PUT /api/folders/rename?oldPath=...&newPath=...
     * Rename a folder: updates the DB record, batch-updates photo paths, and renames on disk.
     */
    @PutMapping("/folders/rename")
    @Transactional
    public ResponseEntity<Map<String, Object>> renameFolder(
            @RequestParam("oldPath") String oldPath,
            @RequestParam("newPath") String newPath) {

        String normalizedOldPath = normalizePath(oldPath);
        String normalizedNewPath = normalizePath(newPath);

        Optional<Folder> existing = folderRepository.findByRelativePath(normalizedOldPath);
        if (existing.isEmpty()) {
            Map<String, Object> response = new LinkedHashMap<>();
            response.put("error", "Folder not found: " + normalizedOldPath);
            return ResponseEntity.status(404).body(response);
        }

        Folder folder = existing.get();

        // Update folder record
        folder.setRelativePath(normalizedNewPath);
        folder.setDisplayName(extractDisplayName(normalizedNewPath));
        folderRepository.save(folder);

        // Batch update photo relative paths
        photoFileRepository.updateRelativePathPrefix(folder.getId(), normalizedOldPath, normalizedNewPath);

        // Rename on disk (best-effort)
        try {
            storageService.renameDirectory(normalizedOldPath, normalizedNewPath);
        } catch (Exception e) {
            log.warn("Could not rename directory on disk: {} -> {}", normalizedOldPath, normalizedNewPath, e);
        }

        log.info("Renamed folder: {} -> {}", normalizedOldPath, normalizedNewPath);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("message", "Folder renamed");
        return ResponseEntity.ok(response);
    }

    /**
     * Normalize a relative path: convert backslashes to forward slashes and strip leading slash.
     */
    private String normalizePath(String path) {
        String normalized = path.replace("\\", "/");
        if (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        return normalized;
    }

    /**
     * Extract a human-friendly display name from the last segment of the path.
     * e.g. "events/birthday-party" -> "birthday-party"
     */
    private String extractDisplayName(String path) {
        if (path == null || path.isBlank()) {
            return "Untitled";
        }
        String[] segments = path.split("/");
        String last = segments[segments.length - 1];
        return last.isBlank() ? "Untitled" : last;
    }
}
