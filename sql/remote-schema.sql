-- ============================================
-- LocalSync Portal - Remote Database Schema
-- Database: localsync_remote (PostgreSQL)
-- Purpose: File mapping, gallery URLs, admin
-- ============================================

-- Folder hierarchy with public UUIDs
CREATE TABLE IF NOT EXISTS folders (
    id SERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    relative_path VARCHAR(500) NOT NULL UNIQUE,
    display_name VARCHAR(200),
    visible BOOLEAN DEFAULT TRUE,
    photo_count INTEGER DEFAULT 0,
    location VARCHAR(300),
    game_date TIMESTAMP WITH TIME ZONE,
    score VARCHAR(50),
    opponent VARCHAR(200),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Photo files mapped to folders
CREATE TABLE IF NOT EXISTS photos (
    id SERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    relative_path VARCHAR(500) NOT NULL UNIQUE,
    file_size BIGINT,
    content_type VARCHAR(100),
    visible BOOLEAN DEFAULT TRUE,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Admin accounts (session-based auth)
CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- API keys for local client authentication
CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    key_value VARCHAR(64) NOT NULL UNIQUE,
    description VARCHAR(200),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_folders_uuid ON folders(uuid);
CREATE INDEX IF NOT EXISTS idx_photos_uuid ON photos(uuid);
CREATE INDEX IF NOT EXISTS idx_photos_folder_id ON photos(folder_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(key_value) WHERE active = TRUE;

-- Seed a default API key (change in production!)
INSERT INTO api_keys (key_value, description)
VALUES ('ls-dev-key-change-me-in-production-00000000', 'Default development API key')
ON CONFLICT (key_value) DO NOTHING;
