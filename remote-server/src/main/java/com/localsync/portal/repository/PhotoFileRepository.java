package com.localsync.portal.repository;

import com.localsync.portal.model.PhotoFile;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface PhotoFileRepository extends JpaRepository<PhotoFile, Long> {

    Optional<PhotoFile> findByUuid(UUID uuid);

    List<PhotoFile> findAllByFolderIdAndVisibleTrueOrderByFilenameAsc(Long folderId);

    List<PhotoFile> findAllByFolderIdOrderByFilenameAsc(Long folderId);

    int countByFolderId(Long folderId);

    Optional<PhotoFile> findByRelativePath(String relativePath);

    @Modifying
    @Query("UPDATE PhotoFile p SET p.relativePath = CONCAT(:newPrefix, SUBSTRING(p.relativePath, LENGTH(:oldPrefix) + 1)) WHERE p.folder.id = :folderId")
    int updateRelativePathPrefix(@Param("folderId") Long folderId, @Param("oldPrefix") String oldPrefix, @Param("newPrefix") String newPrefix);
}
