# LocalSync Portal

A streamlined photo publishing system for sports photographers.

## Project Structure

```
localsync-portal/
├── local-client/       # Node.js local application (Express, port 3000)
├── remote-server/      # Java Spring Boot REST API (port 8080)
└── sql/                # Database schemas for both ends
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Local Client | Node.js, Express, Chokidar, Nodemailer, vanilla JS UI |
| Remote Server | Java 17, Spring Boot 3.2, Spring Security 6, JPA |
| Databases | PostgreSQL on both local (`localsync_local`) and remote (`localsync_remote`) |

## Architecture

- **Local client** watches a `photos/` directory for new images, syncs them to the remote server via REST API
- **Remote server** stores photos on disk preserving folder hierarchy, serves public galleries via UUID links
- **Auth**: API key (`X-API-Key` header) for sync operations, BCrypt + session for admin dashboard
- **Gallery access**: Unlisted UUID-based links (not secure, not discoverable)

## Database Setup

```bash
createdb localsync_local
createdb localsync_remote
psql localsync_local < sql/local-schema.sql
psql localsync_remote < sql/remote-schema.sql
```

## Running the Remote Server

```bash
cd remote-server
./mvnw spring-boot:run
```

Runs on `http://localhost:8080`. Requires PostgreSQL with `localsync_remote` database.

## Running the Local Client

```bash
cd local-client
cp .env.example .env    # configure DB, remote URL, API key, SMTP
npm install
npm start
```

Runs on `http://localhost:3000`. Requires PostgreSQL with `localsync_local` database.

## Key Conventions

- **Local client**: CommonJS (`require`/`module.exports`), no ES modules
- **Remote server**: Standard Spring Boot 3 patterns, no Lombok (explicit getters/setters)
- **SQL**: All tables use `IF NOT EXISTS`, timestamps are `TIMESTAMP WITH TIME ZONE`
- **API key**: Default dev key is `ls-dev-key-change-me-in-production-00000000` (seeded in remote schema)
- **File sync**: Queue-based, one file at a time, retry with exponential backoff (1s/3s/9s)
- **Image formats watched**: .jpg, .jpeg, .png, .tiff, .tif, .raw, .cr2, .nef, .arw

## API Endpoints (Remote Server)

### Sync (requires API key)
- `POST /api/upload` — multipart file + relativePath
- `POST /api/folders` — create folder by relativePath

### Public Gallery
- `GET /gallery/{folderUuid}` — gallery page
- `GET /api/gallery/{folderUuid}/photos` — photo list JSON
- `GET /photos/{photoUuid}` — serve photo inline
- `GET /photos/{photoUuid}/download` — download photo

### Admin (requires session auth)
- `POST /admin/login` — authenticate
- `GET /admin/dashboard` — admin UI
- `GET/DELETE/PATCH /api/admin/folders/{id}` — manage folders
- `GET/DELETE/PATCH /api/admin/photos/{id}` — manage photos

## Local Client API

- `GET/POST/PUT/DELETE /api/contacts` — contact CRUD
- `GET/POST/PUT/DELETE /api/groups` — group CRUD
- `POST/DELETE /api/groups/:id/members` — group membership
- `POST /api/invites/send` — send gallery invites via email
- `GET /api/folders` — local folder listing
- `GET /api/sync-status` — sync queue and log
