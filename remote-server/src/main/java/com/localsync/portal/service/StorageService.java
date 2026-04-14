package com.localsync.portal.service;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.net.MalformedURLException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.stream.Stream;

@Service
public class StorageService {

    private static final Logger log = LoggerFactory.getLogger(StorageService.class);

    @Value("${app.storage.base-path}")
    private String basePath;

    private Path baseDirectory;

    @PostConstruct
    public void init() {
        this.baseDirectory = Paths.get(basePath).toAbsolutePath().normalize();
        try {
            Files.createDirectories(baseDirectory);
            log.info("Storage base directory initialized: {}", baseDirectory);
        } catch (IOException e) {
            throw new RuntimeException("Could not create storage base directory: " + baseDirectory, e);
        }
    }

    /**
     * Store a file at the given relative path under the base directory.
     * Creates parent directories as needed.
     *
     * @param file         the uploaded file
     * @param relativePath the path relative to base (e.g. "events/birthday/photo1.jpg")
     * @return the absolute Path where the file was written
     */
    public Path storeFile(MultipartFile file, String relativePath) throws IOException {
        Path targetPath = resolveAndValidate(relativePath);
        Files.createDirectories(targetPath.getParent());

        try (InputStream inputStream = file.getInputStream()) {
            Files.copy(inputStream, targetPath, StandardCopyOption.REPLACE_EXISTING);
        }

        log.info("Stored file: {}", targetPath);
        return targetPath;
    }

    /**
     * Delete a file at the given relative path.
     *
     * @param relativePath the path relative to base
     */
    public void deleteFile(String relativePath) throws IOException {
        Path filePath = resolveAndValidate(relativePath);
        if (Files.exists(filePath)) {
            Files.delete(filePath);
            log.info("Deleted file: {}", filePath);
        } else {
            log.warn("File not found for deletion: {}", filePath);
        }
    }

    /**
     * Load a file as a Resource for serving to HTTP clients.
     *
     * @param relativePath the path relative to base
     * @return the file as a Resource
     */
    public Resource loadFile(String relativePath) throws MalformedURLException {
        Path filePath = resolveAndValidate(relativePath);
        Resource resource = new UrlResource(filePath.toUri());

        if (!resource.exists() || !resource.isReadable()) {
            throw new RuntimeException("File not found or not readable: " + relativePath);
        }

        return resource;
    }

    /**
     * Ensure a directory exists at the given relative path.
     *
     * @param relativePath the directory path relative to base
     */
    public void createDirectory(String relativePath) throws IOException {
        Path dirPath = resolveAndValidate(relativePath);
        Files.createDirectories(dirPath);
        log.info("Created directory: {}", dirPath);
    }

    /**
     * Delete a directory and all its contents.
     *
     * @param relativePath the directory path relative to base
     */
    public void deleteDirectory(String relativePath) throws IOException {
        Path dirPath = resolveAndValidate(relativePath);
        if (!Files.exists(dirPath)) {
            log.warn("Directory not found for deletion: {}", dirPath);
            return;
        }

        try (Stream<Path> walk = Files.walk(dirPath)) {
            walk.sorted(Comparator.reverseOrder())
                    .forEach(path -> {
                        try {
                            Files.delete(path);
                        } catch (IOException e) {
                            log.error("Failed to delete: {}", path, e);
                        }
                    });
        }

        log.info("Deleted directory: {}", dirPath);
    }

    /**
     * Resolve the relative path against the base directory and validate
     * that it does not escape outside the base directory (path traversal protection).
     */
    private Path resolveAndValidate(String relativePath) {
        Path resolved = baseDirectory.resolve(relativePath).normalize();
        if (!resolved.startsWith(baseDirectory)) {
            throw new SecurityException("Path traversal attempt detected: " + relativePath);
        }
        return resolved;
    }
}
