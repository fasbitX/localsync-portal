package com.localsync.portal.repository;

import com.localsync.portal.model.PhotoFile;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface PhotoFileRepository extends JpaRepository<PhotoFile, Long> {

    Optional<PhotoFile> findByUuid(UUID uuid);

    List<PhotoFile> findAllByFolderIdAndVisibleTrue(Long folderId);

    List<PhotoFile> findAllByFolderIdOrderByUploadedAtDesc(Long folderId);

    int countByFolderId(Long folderId);

    Optional<PhotoFile> findByRelativePath(String relativePath);
}
