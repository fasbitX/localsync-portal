# LocalSync Portal

A streamlined photo publishing system designed for sports photographers. Manage photos locally, sync them to a remote server, and share gallery links with parents via email.

## How It Works

1. **Create folders** on your local machine (e.g., `2024/Varsity_Football/Game1`)
2. **Drop in photos** — the watcher detects new files and auto-syncs them to the remote server
3. **Folder structure is preserved** identically on the remote server
4. **Share galleries** — each folder gets a unique UUID link, send it to parents via built-in email invites
5. **Parents view & download** photos from a clean, responsive gallery page

## Architecture

```
┌─────────────────────────┐          ┌─────────────────────────────┐
│     LOCAL CLIENT        │          │       REMOTE SERVER         │
│     (Node.js)           │          │     (Spring Boot)           │
│                         │  sync    │                             │
│  photos/ ──► watcher ──────────────► /api/upload                │
│                         │  API key │                             │
│  Local UI (port 3000)   │          │  Gallery (port 8080)        │
│  ├─ Contacts            │          │  ├─ /gallery/{uuid}         │
│  ├─ Groups              │          │  ├─ /photos/{uuid}          │
│  ├─ Email Invites       │          │  └─ /admin/dashboard        │
│  └─ Sync Status         │          │                             │
│                         │          │                             │
│  ┌──────────┐           │          │  ┌──────────┐              │
│  │ Postgres │           │          │  │ Postgres │              │
│  │ (local)  │           │          │  │ (remote) │              │
│  └──────────┘           │          │  └──────────┘              │
└─────────────────────────┘          └─────────────────────────────┘
```

## Prerequisites

- **Node.js** 18+
- **Java** 17+
- **PostgreSQL** 14+
- **Maven** (or use the included Maven wrapper)

## Quick Start

### 1. Create the Databases

```bash
createdb localsync_local
createdb localsync_remote
psql localsync_local < sql/local-schema.sql
psql localsync_remote < sql/remote-schema.sql
```

### 2. Start the Remote Server

```bash
cd remote-server
./mvnw spring-boot:run
```

The server starts on [http://localhost:8080](http://localhost:8080).

### 3. Start the Local Client

```bash
cd local-client
cp .env.example .env    # edit with your database, SMTP, and API key settings
npm install
npm start
```

The local dashboard opens at [http://localhost:3000](http://localhost:3000).

### 4. Start Publishing Photos

Drop image files into the `local-client/photos/` directory. Organize them in folders:

```
photos/
├── 2024/
│   ├── Varsity_Football/
│   │   ├── Game1/
│   │   │   ├── IMG_0001.jpg
│   │   │   └── IMG_0002.jpg
│   │   └── Game2/
│   │       └── IMG_0010.jpg
│   └── JV_Soccer/
│       └── Tournament/
│           └── IMG_0100.jpg
```

The watcher picks up new files automatically and syncs them to the remote server.

## Configuration

### Local Client (.env)

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_HOST` | Local PostgreSQL host | `localhost` |
| `DB_PORT` | Local PostgreSQL port | `5432` |
| `DB_NAME` | Local database name | `localsync_local` |
| `DB_USER` | Database username | `postgres` |
| `DB_PASSWORD` | Database password | `postgres` |
| `REMOTE_URL` | Remote server base URL | `http://localhost:8080` |
| `API_KEY` | API key for remote server auth | — |
| `SMTP_HOST` | SMTP server host | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP username | — |
| `SMTP_PASS` | SMTP password / app password | — |
| `SMTP_FROM` | Sender address | — |
| `WATCH_DIR` | Directory to watch for photos | `./photos` |
| `PORT` | Local UI server port | `3000` |

### Remote Server (application.properties)

| Property | Description | Default |
|----------|-------------|---------|
| `spring.datasource.url` | PostgreSQL JDBC URL | `jdbc:postgresql://localhost:5432/localsync_remote` |
| `spring.datasource.username` | Database username | `postgres` |
| `spring.datasource.password` | Database password | `postgres` |
| `app.storage.base-path` | Directory for stored photos | `./photo-storage` |
| `server.port` | Server port | `8080` |

## Features

### Local Dashboard (port 3000)

- **Folders** — Browse your local photo folders with sync status
- **Contacts** — Manage parent/viewer contact list (name, email, phone)
- **Groups** — Organize contacts into groups for bulk invites
- **Invites** — Select a folder, pick contacts or groups, send gallery links via email
- **Sync Log** — Real-time view of the upload queue and sync history

### Remote Server (port 8080)

- **Public Gallery** — Clean, responsive photo grid with lightbox viewer and download buttons
- **Admin Dashboard** — Full CRUD for managing folders and photos, visibility toggles, delete operations
- **API** — RESTful endpoints for file upload, folder management, and gallery data

### Security Model

| Path | Access |
|------|--------|
| `/api/upload`, `/api/folders` | API key required (`X-API-Key` header) |
| `/admin/**` | Admin login required (session-based, BCrypt) |
| `/gallery/{uuid}` | Public — anyone with the link |
| `/photos/{uuid}` | Public — anyone with the link |

Gallery links are **unlisted**. They use UUIDs that cannot be guessed or crawled, but anyone who has the exact link can view the photos.

## Supported Image Formats

`.jpg` `.jpeg` `.png` `.tiff` `.tif` `.raw` `.cr2` `.nef` `.arw`

## Project Structure

```
localsync-portal/
├── CLAUDE.md
├── README.md
├── sql/
│   ├── local-schema.sql          # Local DB: contacts, groups, invites, sync_log
│   └── remote-schema.sql         # Remote DB: folders, photos, admins, api_keys
├── local-client/
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── index.js              # Express server entry point
│       ├── config.js             # Environment configuration
│       ├── db.js                 # PostgreSQL connection pool
│       ├── watcher.js            # Chokidar file watcher
│       ├── sync.js               # Remote sync queue with retry
│       ├── smtp.js               # Email invitation sender
│       ├── routes/
│       │   ├── contacts.js       # Contact & group CRUD
│       │   ├── invites.js        # Invite sending & history
│       │   └── folders.js        # Folder listing & sync status
│       └── ui/
│           ├── index.html        # Local dashboard SPA
│           ├── style.css
│           └── app.js
└── remote-server/
    ├── pom.xml
    └── src/main/
        ├── java/com/localsync/portal/
        │   ├── PortalApplication.java
        │   ├── config/
        │   │   ├── SecurityConfig.java
        │   │   └── ApiKeyFilter.java
        │   ├── controller/
        │   │   ├── UploadController.java
        │   │   ├── GalleryController.java
        │   │   └── AdminController.java
        │   ├── model/
        │   │   ├── Folder.java
        │   │   ├── PhotoFile.java
        │   │   ├── Admin.java
        │   │   └── ApiKey.java
        │   ├── repository/
        │   │   ├── FolderRepository.java
        │   │   ├── PhotoFileRepository.java
        │   │   ├── AdminRepository.java
        │   │   └── ApiKeyRepository.java
        │   └── service/
        │       └── StorageService.java
        └── resources/
            ├── application.properties
            ├── schema.sql
            └── static/
                ├── gallery.html
                ├── admin.html
                ├── css/
                │   ├── gallery.css
                │   └── admin.css
                └── js/
                    ├── gallery.js
                    └── admin.js
```

## License

Private — All rights reserved.
