package com.localsync.portal.repository;

import com.localsync.portal.model.Folder;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface FolderRepository extends JpaRepository<Folder, Long> {

    Optional<Folder> findByUuid(UUID uuid);

    Optional<Folder> findByRelativePath(String relativePath);

    List<Folder> findAllByVisibleTrue();

    List<Folder> findAllByOrderByCreatedAtDesc();
}
