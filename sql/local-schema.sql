-- ============================================
-- LocalSync Portal - Local Database Schema
-- Database: localsync_local (PostgreSQL)
-- Purpose: Contact management & sync tracking
-- ============================================

-- Contacts / Parents
CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(20),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Contact groups for bulk invitations
CREATE TABLE IF NOT EXISTS contact_groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Many-to-many: contacts <-> groups
CREATE TABLE IF NOT EXISTS contact_group_members (
    group_id INTEGER NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, contact_id)
);

-- Track sent email invitations
CREATE TABLE IF NOT EXISTS invites (
    id SERIAL PRIMARY KEY,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    email VARCHAR(255) NOT NULL,
    folder_path VARCHAR(500) NOT NULL,
    gallery_url VARCHAR(500) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'failed'))
);

-- Track file sync status with remote server
CREATE TABLE IF NOT EXISTS sync_log (
    id SERIAL PRIMARY KEY,
    file_path VARCHAR(500) NOT NULL,
    relative_path VARCHAR(500) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'synced', 'failed')),
    remote_url VARCHAR(500),
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    synced_at TIMESTAMP WITH TIME ZONE
);

-- Folder details (game info, notes)
CREATE TABLE IF NOT EXISTS folder_details (
    id SERIAL PRIMARY KEY,
    relative_path VARCHAR(500) NOT NULL UNIQUE,
    location VARCHAR(300),
    game_date TIMESTAMP WITH TIME ZONE,
    score VARCHAR(50),
    opponent VARCHAR(200),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_folder_details_path ON folder_details(relative_path);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_invites_contact_id ON invites(contact_id);
CREATE INDEX IF NOT EXISTS idx_invites_folder_path ON invites(folder_path);
CREATE INDEX IF NOT EXISTS idx_sync_log_status ON sync_log(status);
CREATE INDEX IF NOT EXISTS idx_sync_log_relative_path ON sync_log(relative_path);
