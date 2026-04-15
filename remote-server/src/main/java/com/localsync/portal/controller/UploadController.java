package com.localsync.portal.controller;

import com.localsync.portal.model.Folder;
import com.localsync.portal.model.PhotoFile;
import com.localsync.portal.repository.FolderRepository;
import com.localsync.portal.repository.PhotoFileRepository;
import com.localsync.portal.service.StorageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import org.springframework.dao.DataIntegrityViolationException;

import java.io.IOException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Handles file uploads and folder creation from the local sync client.
 * All endpoints require a valid API key via the X-API-Key header.
 */
@RestController
@RequestMapping("/api")
public class UploadController {

    private static final Logger log = LoggerFactory.getLogger(UploadController.class);

    private final FolderRepository folderRepository;
    private final PhotoFileRepository photoFileRepository;
    private final StorageService storageService;

    public UploadController(FolderRepository folderRepository,
                            PhotoFileRepository photoFileRepository,
                            StorageService storageService) {
        this.folderRepository = folderRepository;
        this.photoFileRepository = photoFileRepository;
        this.storageService = storageService;
    }

    /**
     * POST /api/upload
     * Upload a photo file. The folder is created automatically if it does not exist.
     *
     * @param file         the photo file
     * @param relativePath the path relative to the storage root (e.g. "events/birthday/photo1.jpg")
     */
    @PostMapping("/upload")
    @Transactional
    public ResponseEntity<Map<String, Object>> uploadPhoto(
            @RequestParam("file") MultipartFile file,
            @RequestParam("relativePath") String relativePath) {

        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "File is empty"));
        }

        if (relativePath == null || relativePath.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "relativePath is required"));
        }

        // Normalize and sanitize the path
        String normalizedPath = relativePath.replace("\\", "/");
        if (normalizedPath.startsWith("/")) {
            normalizedPath = normalizedPath.substring(1);
        }

        try {
            // Extract folder path (parent directory) and filename
            Path pathObj = Paths.get(normalizedPath);
            String folderPath;
            String filename;

            if (pathObj.getParent() != null) {
                folderPath = pathObj.getParent().toString().replace("\\", "/");
                filename = pathObj.getFileName().toString();
            } else {
                // File is at the root level -- use a default folder
                folderPath = "_root";
                filename = normalizedPath;
            }

            // Find or create the folder
            Folder folder = findOrCreateFolder(folderPath);

            // Store the file on disk
            storageService.storeFile(file, normalizedPath);

            // Create or update PhotoFile record (handles re-uploads / retries)
            Optional<PhotoFile> existingPhoto = photoFileRepository.findByRelativePath(normalizedPath);
            PhotoFile photo;
            if (existingPhoto.isPresent()) {
                photo = existingPhoto.get();
                photo.setFolder(folder);
                photo.setFileSize(file.getSize());
                photo.setContentType(file.getContentType());
                photo.setVisible(true);
            } else {
                photo = new PhotoFile();
                photo.setFolder(folder);
                photo.setFilename(filename);
                photo.setRelativePath(normalizedPath);
                photo.setFileSize(file.getSize());
                photo.setContentType(file.getContentType());
                photo.setVisible(true);
            }
            photoFileRepository.save(photo);

            // Update folder photo count
            int count = photoFileRepository.countByFolderId(folder.getId());
            folder.setPhotoCount(count);
            folderRepository.save(folder);

            log.info("Uploaded photo: {} -> folder: {}", normalizedPath, folderPath);

            Map<String, Object> response = new LinkedHashMap<>();
            response.put("photoUuid", photo.getUuid().toString());
            response.put("folderUuid", folder.getUuid().toString());
            response.put("galleryUrl", "/gallery/" + folder.getUuid());

            return ResponseEntity.status(HttpStatus.CREATED).body(response);

        } catch (IOException e) {
            log.error("Failed to store uploaded file: {}", relativePath, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to store file: " + e.getMessage()));
        } catch (SecurityException e) {
            log.warn("Path traversal attempt: {}", relativePath);
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Invalid file path"));
        }
    }

    /**
     * POST /api/folders
     * Explicitly create a folder (and its disk directory).
     *
     * @param relativePath the folder path relative to storage root
     */
    @PostMapping("/folders")
    @Transactional
    public ResponseEntity<Map<String, Object>> createFolder(
            @RequestParam("relativePath") String relativePath) {

        if (relativePath == null || relativePath.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "relativePath is required"));
        }

        String normalizedPath = relativePath.replace("\\", "/");
        if (normalizedPath.startsWith("/")) {
            normalizedPath = normalizedPath.substring(1);
        }
        if (normalizedPath.endsWith("/")) {
            normalizedPath = normalizedPath.substring(0, normalizedPath.length() - 1);
        }

        try {
            // Check if folder already exists
            Optional<Folder> existing = folderRepository.findByRelativePath(normalizedPath);
            if (existing.isPresent()) {
                Folder folder = existing.get();
                Map<String, Object> response = new LinkedHashMap<>();
                response.put("folderUuid", folder.getUuid().toString());
                response.put("galleryUrl", "/gallery/" + folder.getUuid());
                response.put("message", "Folder already exists");
                return ResponseEntity.ok(response);
            }

            // Create directory on disk
            storageService.createDirectory(normalizedPath);

            // Create Folder in DB
            Folder folder = new Folder();
            folder.setRelativePath(normalizedPath);
            folder.setDisplayName(extractDisplayName(normalizedPath));
            folder.setVisible(true);
            folder.setPhotoCount(0);
            folderRepository.save(folder);

            log.info("Created folder: {}", normalizedPath);

            Map<String, Object> response = new LinkedHashMap<>();
            response.put("folderUuid", folder.getUuid().toString());
            response.put("galleryUrl", "/gallery/" + folder.getUuid());

            return ResponseEntity.status(HttpStatus.CREATED).body(response);

        } catch (DataIntegrityViolationException e) {
            // Race condition: another request created this folder between our check and insert
            log.info("Folder already exists (concurrent create): {}", normalizedPath);
            Optional<Folder> raceFolder = folderRepository.findByRelativePath(normalizedPath);
            if (raceFolder.isPresent()) {
                Folder folder = raceFolder.get();
                Map<String, Object> response = new LinkedHashMap<>();
                response.put("folderUuid", folder.getUuid().toString());
                response.put("galleryUrl", "/gallery/" + folder.getUuid());
                response.put("message", "Folder already exists");
                return ResponseEntity.ok(response);
            }
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to create folder"));
        } catch (IOException e) {
            log.error("Failed to create folder: {}", normalizedPath, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to create folder: " + e.getMessage()));
        } catch (SecurityException e) {
            log.warn("Path traversal attempt: {}", relativePath);
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Invalid folder path"));
        }
    }

    /**
     * Find an existing folder by relative path, or create a new one.
     */
    private Folder findOrCreateFolder(String folderPath) throws IOException {
        Optional<Folder> existing = folderRepository.findByRelativePath(folderPath);
        if (existing.isPresent()) {
            return existing.get();
        }

        // Create the directory on disk
        storageService.createDirectory(folderPath);

        // Create the DB record
        Folder folder = new Folder();
        folder.setRelativePath(folderPath);
        folder.setDisplayName(extractDisplayName(folderPath));
        folder.setVisible(true);
        folder.setPhotoCount(0);
        return folderRepository.save(folder);
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
