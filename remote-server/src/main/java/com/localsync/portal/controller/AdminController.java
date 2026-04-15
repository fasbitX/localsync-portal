package com.localsync.portal.controller;

import com.localsync.portal.model.Admin;
import com.localsync.portal.model.Folder;
import com.localsync.portal.model.PhotoFile;
import com.localsync.portal.repository.AdminRepository;
import com.localsync.portal.repository.FolderRepository;
import com.localsync.portal.repository.PhotoFileRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Admin dashboard endpoints: authentication and read-only folder/photo listing.
 * Login is session-based using BCrypt for password verification.
 * This controller is display-only; no modification capabilities.
 */
@RestController
public class AdminController {

    private static final Logger log = LoggerFactory.getLogger(AdminController.class);

    private final AdminRepository adminRepository;
    private final FolderRepository folderRepository;
    private final PhotoFileRepository photoFileRepository;
    private final PasswordEncoder passwordEncoder;

    public AdminController(AdminRepository adminRepository,
                           FolderRepository folderRepository,
                           PhotoFileRepository photoFileRepository,
                           PasswordEncoder passwordEncoder) {
        this.adminRepository = adminRepository;
        this.folderRepository = folderRepository;
        this.photoFileRepository = photoFileRepository;
        this.passwordEncoder = passwordEncoder;
    }

    // -------------------------------------------------------------------------
    // Authentication
    // -------------------------------------------------------------------------

    /**
     * POST /admin/login
     * Validate credentials and create an authenticated session.
     */
    @PostMapping("/admin/login")
    public ResponseEntity<Map<String, Object>> login(
            @RequestParam("username") String username,
            @RequestParam("password") String password,
            HttpServletRequest request) {

        if (username == null || username.isBlank() || password == null || password.isBlank()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Username and password are required"));
        }

        Optional<Admin> adminOpt = adminRepository.findByUsername(username.trim());
        if (adminOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Invalid credentials"));
        }

        Admin admin = adminOpt.get();

        if (!passwordEncoder.matches(password, admin.getPasswordHash())) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Invalid credentials"));
        }

        // Create authenticated security context and bind to session
        UsernamePasswordAuthenticationToken auth =
                new UsernamePasswordAuthenticationToken(
                        admin.getUsername(),
                        null,
                        List.of(new SimpleGrantedAuthority("ROLE_ADMIN"))
                );

        SecurityContext securityContext = SecurityContextHolder.createEmptyContext();
        securityContext.setAuthentication(auth);
        SecurityContextHolder.setContext(securityContext);

        HttpSession session = request.getSession(true);
        session.setAttribute(
                HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,
                securityContext
        );

        log.info("Admin logged in: {}", username);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("message", "Login successful");
        response.put("redirect", "/admin/dashboard");
        return ResponseEntity.ok(response);
    }

    /**
     * POST /admin/logout
     * Invalidate the session and redirect to the login page.
     */
    @PostMapping("/admin/logout")
    public ResponseEntity<Map<String, Object>> logout(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        SecurityContextHolder.clearContext();

        log.info("Admin logged out");

        return ResponseEntity.ok(Map.of(
                "message", "Logged out",
                "redirect", "/admin/login.html"
        ));
    }

    /**
     * GET /admin/dashboard
     * Forward to the static admin.html page.
     */
    @GetMapping("/admin/dashboard")
    public String dashboard() {
        return "forward:/admin.html";
    }

    // -------------------------------------------------------------------------
    // Folder Management (Admin API)
    // -------------------------------------------------------------------------

    /**
     * GET /api/admin/folders
     * List all folders ordered by creation date descending.
     */
    @GetMapping("/api/admin/folders")
    public ResponseEntity<List<Map<String, Object>>> listFolders() {
        List<Folder> folders = folderRepository.findAllByOrderByCreatedAtDesc();

        List<Map<String, Object>> result = folders.stream()
                .map(this::folderToMap)
                .collect(Collectors.toList());

        return ResponseEntity.ok(result);
    }

    /**
     * GET /api/admin/folders/{id}/photos
     * List all photos in a folder (including hidden ones).
     */
    @GetMapping("/api/admin/folders/{id}/photos")
    public ResponseEntity<?> listFolderPhotos(@PathVariable Long id) {
        Optional<Folder> folderOpt = folderRepository.findById(id);
        if (folderOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Folder not found"));
        }

        List<PhotoFile> photos = photoFileRepository
                .findAllByFolderIdOrderByUploadedAtDesc(folderOpt.get().getId());

        List<Map<String, Object>> result = photos.stream()
                .map(this::photoToMap)
                .collect(Collectors.toList());

        return ResponseEntity.ok(result);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private Map<String, Object> folderToMap(Folder folder) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", folder.getId());
        m.put("uuid", folder.getUuid().toString());
        m.put("relativePath", folder.getRelativePath());
        m.put("displayName", folder.getDisplayName());
        m.put("visible", folder.getVisible());
        m.put("photoCount", folder.getPhotoCount());
        m.put("galleryUrl", "/gallery/" + folder.getUuid());
        m.put("createdAt", folder.getCreatedAt().toString());
        m.put("updatedAt", folder.getUpdatedAt().toString());
        return m;
    }

    private Map<String, Object> photoToMap(PhotoFile photo) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", photo.getId());
        m.put("uuid", photo.getUuid().toString());
        m.put("filename", photo.getFilename());
        m.put("relativePath", photo.getRelativePath());
        m.put("fileSize", photo.getFileSize());
        m.put("contentType", photo.getContentType());
        m.put("visible", photo.getVisible());
        m.put("photoUrl", "/photos/" + photo.getUuid());
        m.put("uploadedAt", photo.getUploadedAt().toString());
        return m;
    }
}
