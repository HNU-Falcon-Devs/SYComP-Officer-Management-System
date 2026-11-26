## 1. Document Identity

- **Document ID:** `06-technical-architecture.md`
    
- **System:** SYComP Organizational Management System (SYComP OMS)
    
- **Document Status:** v1.0 — Draft Baseline
    
- **Phase:** Phase 8 — Technical Architecture & Infrastructure Design
    
- **Repository Path:** `docs/06-technical-architecture.md`
    
- **Dependencies:** [[00 — Project Charter SYComP Organizational Management System]], [[01 — Requirements Specification SYComP Organizational Management System]], [[02 — Organizational Workflow & Policies SYComP OMS]], [[02b — Business Rules & Workflow Design SYComP OMS]], [[03 — Domain Model & Data Dictionary SYComP OMS]], [[04 — Roles, Permissions & Security]], [[05 — ui-ux-and-information-architecture]]
    

## 2. Architectural Goals & $0-Cost Engineering Constraints

SYComP OMS is architected as a **modular monolith** deployed on **$0 free-tier cloud infrastructure** while meeting institutional security, maintainability, and sub-1.5-second live event attendance performance targets:

  

- **Zero Monthly Infrastructure Cost:** Runs entirely on Vercel Hobby, Supabase Free Tier (PostgreSQL), Resend Free Tier (or SMTP fallback), and SYComP's regular Google account (15 GB Google Drive).
    
- **Maintainable Modular Monolith:** Single Next.js TypeScript codebase with strict domain boundaries so future student Technical Directors can onboard, modify folder routing, or adjust routes without managing microservices.
    
- **Serverless-Resilient Engineering:** Eliminates native C++ bundling hazards (via Node.js `crypto.scrypt`), bypasses Vercel's 4.5 MB serverless payload ceiling (via Direct-to-Drive Resumable Uploads), and uses connection pooling (Supavisor) for PostgreSQL.
    
- **Defense in Depth:** All authorization, state transitions, XSS sanitization, and audit writes execute strictly on the server, backed by PostgreSQL relational constraints and PostgREST lockdown.
    

## 3. Technology Stack & Library Selection

|**Layer**|**Technology / Library**|**Rationale**|
|---|---|---|
|**Framework & Runtime**|**Next.js (App Router)** + **TypeScript (strict)** on Node.js 22 LTS|Unified full-stack architecture combining React Server Components, Route Handlers, and middleware on Vercel.|
|**Styling & UI System**|**Tailwind CSS** + **Shadcn/ui** + **`lucide-react`** + **`next-themes`**|Modern clean SaaS components, SYComP violet/charcoal Light & Dark CSS tokens, and strict zero-emoji iconography.|
|**Data Tables & Forms**|**`@tanstack/react-table`** + **`react-hook-form`** + **`zod`**|Type-safe form validation shared between client forms and server API contracts; scalable directory/attendance tables.|
|**Rich-Text & XSS Security**|**Tiptap** (WYSIWYG) + **`sanitize-html`** (server-side)|Accessible rich-text editing for proposals, agendas, minutes, and announcements with strict HTML allowlist sanitization (`FR-EVT-09`).|
|**QR Camera Scanning**|**`html5-qrcode`** (client component)|Reliable cross-browser camera viewfinder (iOS Safari + Android Chrome) for decoding university ID QR payloads (`FR-ATT-02`).|
|**CSV / Excel Parsing**|**`papaparse`** + **`exceljs`** (or **`xlsx`** server-side parser)|Streams and validates up to 1,000–2,000 masterlist rows with duplicate/discrepancy previewing (`FR-AUTH-01`, `NFR-PERF-03`).|
|**Database & ORM**|**Supabase PostgreSQL 15+** + **Drizzle ORM** (`drizzle-orm`, `drizzle-kit`, `postgres`)|SQL-first type safety, atomic multi-table transactions, native partial unique indexes, and deterministic migrations.|
|**Auth & Password Hashing**|**Custom DB Sessions** (`user_sessions`) + Node.js **`crypto.scrypt`**|Native `student_id_number` login, zero-rate-limit bulk masterlist provisioning, instant revocation on `DISABLED`/`NEEDS_REVIEW`, and zero native-addon build risk on Vercel.|
|**Cloud File Storage**|**Google Drive API v3** (`googleapis` or lightweight `fetch` OAuth2 client)|Direct-to-Drive resumable uploads using SYComP's Google account OAuth2 Refresh Token and modular `resolveDriveFolderPath`.|
|**Transactional Email**|**Swappable `EmailProvider` Adapter** (**Resend** primary + **Nodemailer SMTP** fallback)|Sends 6-digit OTP verification and password reset emails at $0 cost with or without a verified custom DNS domain.|
|**PWA Packaging**|Next.js `app/manifest.ts` + **Serwist** (`@serwist/next`)|Standalone home-screen installability, static app-shell caching, and clean offline detection without unsafe offline attendance queuing.|
|**Toast & Feedback**|**`sonner`**|Clean, accessible mobile/desktop notification stack compatible with Shadcn/ui.|

## 4. High-Level System Architecture

Code snippet

```
flowchart TB
    subgraph Client["Client (PWA — Mobile & Desktop Browsers)"]
        ShellA["Shell A: Member Portal (/portal/*)"]
        ShellB["Shell B: Officer / Exec / Admin Workspace"]
        Scanner["2-Step QR Scanner (/scanner)"]
        SW["Service Worker (Shell Cache + Offline Banner)"]
    end

    subgraph Vercel["Vercel Serverless (Next.js App Router)"]
        MW["Edge Middleware (Session Cookie Presence + Route Preflight)"]
        RSC["Server Components & Layouts"]
        API["Route Handlers (/api/*) & Server Actions"]
        AuthGuard["Centralized authorize() Pipeline (Layers 0–3 + Break-Glass)"]
        Services["Domain Services (Events, Attendance, Meetings, Masterlist, Audit)"]
        DriveMod["Drive Classifier (resolveDriveFolderPath) & Upload Coordinator"]
        EmailMod["Swappable Email Adapter (Resend | SMTP)"]
    end

    subgraph External["External Services ($0 Free Tiers)"]
        SupaDB[("Supabase PostgreSQL\n(Supavisor Pooler • 21 Tables\nRLS Locked for PostgREST)")]
        GDrive["Google Drive API v3\n(SYComP Account • OAuth2 Refresh Token\n15 GB My Drive)"]
        EmailSvc["Resend API / Gmail SMTP"]
    end

    ShellA & ShellB & Scanner --> MW
    MW --> RSC & API
    RSC & API --> AuthGuard
    AuthGuard --> Services
    Services --> SupaDB
    Services --> DriveMod
    Services --> EmailMod
    DriveMod -->|"1. Init Resumable URI\n3. Finalize & Set Share Mode"| GDrive
    ShellB -.->|"2. Direct Browser PUT (up to 15 MB)\nBypasses Vercel 4.5 MB Limit"| GDrive
    EmailMod --> EmailSvc
```

## 5. Modular Repository & Directory Structure

The codebase enforces clean separation between UI routes, centralized configuration, domain business logic, database schema, and external adapters (`NFR-MAINT-01`):

  

Plaintext

```
sycomp-oms/
├── docs/                                # Blueprint documentation (00 through 09)
├── drizzle/                             # Generated versioned SQL migrations
├── public/
│   ├── icons/                           # PWA icons (192x192, 512x512, maskable)
│   └── brand/                           # Official SYComP emblem assets
├── src/
│   ├── app/
│   │   ├── manifest.ts                  # Dynamic PWA Web App Manifest
│   │   ├── sw.ts                        # Serwist service worker entry
│   │   ├── (auth)/                      # /login, /forgot-password, /account-hold
│   │   ├── (portal)/portal/             # Shell A: Read-only Member Portal
│   │   ├── (workspace)/                 # Shell B: Collapsible Sidebar Workspace
│   │   │   ├── dashboard/
│   │   │   ├── scanner/                 # Dedicated 2-step QR scanner page
│   │   │   ├── events/                  # /events, /events/new, /events/[slug]
│   │   │   ├── meetings/                # Isolated Officer Meetings namespace
│   │   │   ├── tasks/
│   │   │   ├── documents/
│   │   │   ├── announcements/
│   │   │   ├── directory/
│   │   │   ├── account/
│   │   │   └── admin/                   # /admin/terms, /masterlist, /audit-logs, /settings
│   │   └── api/                         # Typed REST Route Handlers
│   │       ├── auth/
│   │       ├── portal/
│   │       ├── events/
│   │       ├── meetings/
│   │       ├── attendance/              # /lookup (GET) & /confirm (POST) & /override (PATCH)
│   │       ├── documents/               # /upload-init, /upload-finalize, /external
│   │       ├── tasks/
│   │       ├── announcements/
│   │       └── admin/
│   ├── config/
│   │   ├── routes.ts                    # Single source of truth for all app & nav routes
│   │   ├── permissions.ts               # Declarative role & capability registry
│   │   └── env.ts                       # Zod-validated server/client environment schema
│   ├── db/
│   │   ├── index.ts                     # Drizzle + postgres-js client (Supavisor config)
│   │   ├── schema/                      # Modular Drizzle table definitions (1 file per aggregate)
│   │   │   ├── identity.ts              # users, user_sessions, verification_tokens, terms, appointments, imports
│   │   │   ├── events.ts                # events, event_proposal_reviews, committees, committee_members
│   │   │   ├── tasks.ts                 # tasks, task_assignees
│   │   │   ├── meetings.ts              # meetings
│   │   │   ├── attendance.ts            # attendance_checkpoints, attendance_records
│   │   │   ├── documents.ts             # document_types, drive_folder_cache, documents
│   │   │   ├── governance.ts            # announcements, audit_logs, rate_limit_buckets
│   │   │   └── index.ts
│   │   └── seed.ts                      # Initial Super Admin, default document_types, dev seed
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── password.ts              # crypto.scrypt hashing, default password normalizer
│   │   │   ├── session.ts               # Cookie issuance, DB lookup, instant revocation
│   │   │   └── authorize.ts             # Centralized 6-stage authorization & break-glass guard
│   │   ├── drive/
│   │   │   ├── classifier.ts            # Isolated resolveDriveFolderPath() strategy module
│   │   │   ├── client.ts                # OAuth2 token refresh, folder ensure, resumable init/finalize
│   │   │   └── permissions.ts           # Configurable DRIVE_SHARE_MODE (domain | unlisted)
│   │   ├── email/
│   │   │   ├── adapter.ts               # EmailProvider interface + runtime factory
│   │   │   ├── resend.provider.ts       # Resend implementation
│   │   │   └── smtp.provider.ts         # Nodemailer Gmail/SMTP fallback implementation
│   │   ├── security/
│   │   │   ├── sanitize.ts              # Server-side rich-text HTML allowlist sanitizer
│   │   │   ├── rate-limit.ts            # Postgres-backed sliding/fixed window rate limiter
│   │   │   └── csv-safe.ts              # CSV formula-injection neutralization
│   │   └── audit.ts                     # Transactional append-only audit writer + key redactor
│   ├── services/                        # Pure domain services (called by API & RSCs)
│   └── components/
│       ├── ui/                          # Shadcn/ui primitives
│       ├── shells/                      # ShellA (Member) & ShellB (Officer Sidebar)
│       ├── event-hub/                   # Tabbed Event Hub components
│       ├── scanner/                     # Camera viewfinder + 5-state Verification Card
│       └── editor/                      # Tiptap rich-text editor + Drive dropzone
└── drizzle.config.ts
```

## 6. Database Architecture & Drizzle ORM Strategy

### 6.1 Connection Pooling & Serverless Safety

Because Vercel spawns ephemeral serverless instances, database connections must follow a dual-URL pattern:

  

- **Runtime Traffic (`DATABASE_URL`):** Connects through Supabase's **Supavisor Transaction Pooler** (port `6543`) using `postgres` (`postgres-js`) with `{ prepare: false, max: 5 }` to prevent prepared-statement collisions and connection exhaustion under burst QR scanning.
    
- **Schema Migrations (`DIRECT_DATABASE_URL`):** Connects directly (or via Session Pooler, port `5432`) strictly during `drizzle-kit migrate` in CI/CD or local development.
    

### 6.2 Infrastructure Table Extensions to `03 — Domain Model`

To support custom server-side sessions and $0 serverless rate limiting without adding Redis, two lightweight infrastructure tables join the 19 core domain entities defined in `03` (total **21 PostgreSQL tables**):

  

1. **`user_sessions` (Table 20 — Identity Aggregate):**
    
    - `id` (`UUID` PK), `user_id` (`UUID` FK $\rightarrow$ `users.id` `ON DELETE CASCADE`), `token_hash` (`TEXT` UNIQUE — SHA-256 hash of opaque 256-bit cookie token), `role_tier_snapshot` (`ENUM` for idle-timeout calculation), `expires_at` (`TIMESTAMPTZ` — absolute 7-day cap), `last_active_at` (`TIMESTAMPTZ` — sliding 24h / 8h idle check), `revoked_at` (`TIMESTAMPTZ` nullable), `ip_address` (`VARCHAR(45)`), `user_agent` (`VARCHAR(255)`), `created_at` (`TIMESTAMPTZ`).
        
    - **Instant Revocation:** Transitioning `users.account_status` to `DISABLED`/`NEEDS_REVIEW`, resetting a password, or downgrading a role executes `UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL` inside the same database transaction.
        
2. **`rate_limit_buckets` (Table 21 — Security Infrastructure):**
    
    - `key` (`VARCHAR(160)` PK, e.g., `login:ip:1.2.3.4`, `login:id:2024-01234`, `otp:user:<uuid>`), `count` (`INTEGER`), `window_expires_at` (`TIMESTAMPTZ`), `updated_at` (`TIMESTAMPTZ`).
        
    - Updated atomically via `INSERT ... ON CONFLICT (key) DO UPDATE`, delivering reliable distributed rate limiting across Vercel functions at $0 cost.
        

### 6.3 PostgreSQL Hardening on Supabase

- **PostgREST Lockdown:** Because SYComP OMS uses Drizzle directly on the server rather than client-side Supabase Data APIs, every table in `public` executes `ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;` with **zero** `anon` or `authenticated` policies. Even if the Supabase URL/anon key were ever inspected, PostgREST returns zero rows and rejects all writes.
    
- **Database-Enforced `audit_logs` Immutability:** In addition to omitting update/delete code paths, a PostgreSQL migration installs a `BEFORE UPDATE OR DELETE` trigger (`prevent_audit_log_mutation()`) on `audit_logs` that raises an exception, guaranteeing append-only integrity even against privileged database roles.
    
- **Native Constraints Migration:** All `CHECK` constraints, partial unique indexes (`UNIQUE(status) WHERE status = 'ACTIVE'` on `academic_terms`; `UNIQUE(checkpoint_id, user_id)` on `attendance_records`), and composite foreign keys (`(committee_id, event_id)` on `tasks`) defined in `03` are codified directly in Drizzle schema definitions and verified in SQL migrations.
    

### 6.4 Transactional Consistency Rules

Every multi-step domain operation runs inside `db.transaction(async (tx) => { ... })`:

  

- **Masterlist Commit:** Batch-inserts new `users` (chunked in 200-row batches to handle 1,000+ records smoothly within serverless timeouts), flags absent previously active users as `NEEDS_REVIEW`, revokes their sessions, writes the `masterlist_imports` record, and appends an `audit_logs` entry (`NFR-PERF-03`).
    
- **Term Rollover:** Closes active term, sets `is_current = false` / `ended_at = NOW()` on outgoing `officer_appointments`, recomputes `users.system_role`, revokes downgraded officers' sessions, activates the new term, and writes `audit_logs` (`BR-TERM-02`, `BR-TERM-03`).
    
- **Every Audited Mutation:** Domain row update + `audit_logs` insert always share the same transaction—neither commits without the other (`BR-SYS-04`).
    

## 7. Authentication, Hashing & Authorization Implementation

### 7.1 Password Hashing (`src/lib/auth/password.ts`)

- **Algorithm:** Node.js native **`crypto.scrypt`** (memory-hard, zero native C++ bindings, zero Vercel bundling failures).
    
- **Parameters:** `N = 16384` ($2^{14}$), `r = 8`, `p = 1`, `keylen = 64` bytes, 16-byte `crypto.randomBytes` salt.
    
- **Storage Format:** Versioned string `scrypt$16384$8$1$<hex_salt>$<hex_derived_key>`. The prefix allows upgrading cost parameters or migrating algorithms in the future without invalidating existing user passwords.
    
- **Constant-Time Verification:** Uses `crypto.timingSafeEqual` on derived buffers, running a dummy scrypt computation when a `student_id_number` does not exist to prevent timing-based enumeration.
    

### 7.2 Session Cookie & Request Flow

1. Login validates credentials against `users.password_hash`, checks `users.account_status === 'ACTIVE'` (routing `DISABLED`/`NEEDS_REVIEW` accounts to `/account-hold` only after password verification), generates a 32-byte `CSPRNG` session token, stores its SHA-256 hash in `user_sessions`, and sets cookie `sycomp_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`).
    
2. **Next.js Middleware (`src/middleware.ts`):** Performs fast lightweight cookie presence checks and redirects unauthenticated traffic away from `/portal/*` and workspace routes. Never trusts cookie presence alone for authorization.
    
3. **Centralized `authorize()` Guard (`src/lib/auth/authorize.ts`):** Executed at the entry of every API Route Handler, Server Action, and protected Server Component data loader. Joins `user_sessions` with `users` in a single indexed query to enforce:
    
    - Valid, non-revoked, non-expired session (sliding idle window check).
        
    - Layer 0 (`account_status === 'ACTIVE'`).
        
    - Layer 1 (`system_role`) + `SUPER_ADMIN` Break-Glass validation (`break_glass: true` + `reason.trim().length >= 10`).
        
    - Temporal state locks (`CLOSED` term, `COMPLETED` event/meeting).
        
    - Layer 3 contextual ownership (`event_committees.head_user_id`, `events.created_by`, `task_assignees`, `MEMBER` self-scope).
        

## 8. External Integrations Architecture

### 8.1 Google Drive Direct-to-Drive Resumable Upload & Classifier

Using SYComP's regular Google account (15 GB My Drive) with a server-stored **OAuth2 Refresh Token** (`GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`) ensures uploaded files consume SYComP's org storage cleanly and **bypass Vercel's 4.5 MB serverless body limit** for uploads up to 15 MB.

  

#### Modular Folder Classifier (`src/lib/drive/classifier.ts`)

All path decisions live in one isolated, pure function (`BR-DOC-02`, `NFR-MAINT-01`):

  

TypeScript

```
export function resolveDriveFolderPath(input: {
    academicTermName: string;
    academicTermCode: string;
    documentTypeSegment: string;
    documentTypeSlug: string;
    eventTitle?: string | null;
    eventSlug?: string | null;
    isProposal?: boolean;
}): { segments: string[]; pathKey: string } {
    const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 100);
    const termSeg = sanitize(input.academicTermName);

    if (input.isProposal && input.eventTitle) {
        return {
            segments: [termSeg, "Proposals", sanitize(input.eventTitle)],
            pathKey: `${input.academicTermCode}/proposals/${input.eventSlug}`,
        };
    }
    const typeSeg = sanitize(input.documentTypeSegment);
    const leafSeg = input.eventTitle ? sanitize(input.eventTitle) : "General";
    const leafKey = input.eventSlug ?? "general";

    return {
        segments: [termSeg, typeSeg, leafSeg],
        pathKey: `${input.academicTermCode}/${input.documentTypeSlug}/${leafKey}`,
    };
}
```

#### 3-Phase Resumable Upload Sequence (Supports up to 15 MB on Vercel)

Code snippet

```
sequenceDiagram
    participant Browser as Officer Browser
    participant API as Next.js API (Vercel)
    participant DB as Supabase Postgres
    participant Drive as Google Drive API v3

    Browser->>API: 1. POST /api/documents/upload-init (metadata, filename, mimeType, fileSize)
    API->>API: authorize() + validate MIME allowlist & size <= 15 MB
    API->>DB: Check drive_folder_cache by pathKey
    alt Folder not cached or stale
        API->>Drive: Traverse/create nested folders under SYComP OMS Root
        API->>DB: Upsert drive_folder_cache
    end
    API->>Drive: POST /upload/drive/v3/files?uploadType=resumable (with Origin header + parent folderId)
    Drive-->>API: 200 OK (Location: single-use Resumable Upload URI)
    API-->>Browser: Return { uploadUrl, uploadIntentToken, folderCacheId }

    Browser->>Drive: 2. Direct PUT uploadUrl (File bytes up to 15 MB, bypasses Vercel)
    Drive-->>Browser: 200 OK ({ id: driveFileId, name, mimeType, size })

    Browser->>API: 3. POST /api/documents/upload-finalize ({ driveFileId, uploadIntentToken, metadata })
    API->>Drive: GET /drive/v3/files/{driveFileId} (Verify actual parent, MIME, size <= 15 MB)
    API->>Drive: POST /drive/v3/files/{driveFileId}/permissions (DRIVE_SHARE_MODE: domain | unlisted)
    API->>DB: TX: Insert documents row + audit_logs
    alt Verification or DB Transaction Fails
        API->>Drive: DELETE /drive/v3/files/{driveFileId} (Compensating orphan cleanup)
        API-->>Browser: 4xx / 5xx Error
    else Success
        API-->>Browser: 201 Created (Document DTO + webViewLink)
    end
```

- **CORS & Integrity Notes:**
    
    - Passing the browser's verified `Origin` header during step 1 instructs Google Drive to return matching CORS headers on the resumable session URI for step 2.
        
    - Step 3 never trusts client-claimed file sizes or MIME types; the backend queries Google Drive directly for the uploaded file's actual `mimeType`, `size`, and `parents` before committing to Postgres—deleting the file automatically if validation or DB commit fails (`BR-DOC-03`).
        
- **Configurable Drive Sharing Mode (`src/lib/drive/permissions.ts`):**
    
    - Controlled via `DRIVE_SHARE_MODE`:
        
        - `domain` _(default)_: Grants `{ type: "domain", domain: UNIVERSITY_EMAIL_DOMAIN, role: "reader", allowFileDiscovery: false }`.
            
        - `unlisted` _(zero-code fallback if consumer Google account restricts domain sharing)_: Grants `{ type: "anyone", role: "reader", allowFileDiscovery: false }` while continuing to restrict `web_view_link` visibility strictly to authenticated `OFFICER`+ endpoints (`FR-MEM-05`).
            

### 8.2 Swappable Transactional Email Adapter (`src/lib/email/`)

Decouples OTP delivery from any single vendor so SYComP can launch at $0 with Resend (verified domain) or fall back to SYComP's Gmail SMTP App Password with a single environment variable switch (`EMAIL_PROVIDER=resend | smtp`):

  

TypeScript

```
export interface SendEmailInput {
    to: string;
    subject: string;
    html: string;
    text: string;
}

export interface EmailProvider {
    send(input: SendEmailInput): Promise<{ messageId: string }>;
}
```

- **`ResendEmailProvider` (`EMAIL_PROVIDER=resend`):** Calls Resend HTTP API using `RESEND_API_KEY` and `EMAIL_FROM` (verified custom domain/subdomain; 3,000 emails/month, 100/day free tier).
    
- **`SmtpEmailProvider` (`EMAIL_PROVIDER=smtp`):** Uses `nodemailer` over TLS (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`) for zero-domain deployment via SYComP's org Gmail App Password.
    
- **Strict Domain Pre-Check:** Before invoking `emailProvider.send()`, the service asserts `to.toLowerCase().endsWith("@" + env.UNIVERSITY_EMAIL_DOMAIN)`.
    

## 9. Core API Contract & Endpoint Architecture

All mutations validate request bodies with `zod`, return consistent JSON envelopes (`{ data }` or `{ error: { code, message, details? } }`), and map domain violations cleanly (`400` validation/missing reason, `401` unauthenticated, `403` unauthorized/account hold, `404` not found/out of scope, `409` state lock/duplicate, `429` rate limited).

  

### 9.1 Signature Endpoint Groups

|**Module**|**Endpoint**|**Method**|**Purpose & Key Guardrails**|
|---|---|---|---|
|**Auth**|`/api/auth/login`|`POST`|Rate-limited `student_id_number` + password check; sets `HttpOnly` cookie.|
|**Auth**|`/api/auth/logout`|`POST`|Revokes active `user_sessions` row and clears cookie.|
|**Auth**|`/api/auth/email/request-otp` & `/verify-otp`|`POST`|Strict `UNIVERSITY_EMAIL_DOMAIN` check; hashed 6-digit OTP (`10m` expiry, max 5 attempts).|
|**Auth**|`/api/auth/password/reset-request` & `/reset-confirm`|`POST`|Requires `ACTIVE` account with verified `university_email`; revokes all sessions on reset.|
|**Attendance**|`/api/attendance/lookup`|`GET`|**Step 1 of QR Scanner:** Non-mutating lookup returning Verification Card state (`READY`, `ALREADY_LOGGED`, `OFFICER_RESTRICTED`, `ACCOUNT_HOLD`, `NOT_FOUND`) in <300ms.|
|**Attendance**|`/api/attendance/confirm`|`POST`|**Step 2 of QR Scanner:** Server-authoritative UTC log; enforces `OPEN` checkpoint, `BR-ATT-03` uniqueness, `BR-ATT-05` officer guard, and `BR-ATT-07` active guard.|
|**Attendance**|`/api/attendance/override`|`POST` / `PATCH`|`EXECUTIVE` (or `SUPER_ADMIN` `BG`) manual add/edit with mandatory `edit_reason` + audit log.|
|**Attendance**|`/api/attendance/export`|`GET`|Streams CSV with formula-injection neutralization (`FR-ATT-08`).|
|**Events**|`/api/events`, `/api/events/[id]/transition`|`GET`/`POST`/`PATCH`|Proposal drafting, sanitized rich-text updates, Executive workflow transitions (`APPROVE`, `REQUEST_REVISION`, `REJECT`, `PUBLISH`, `UNPUBLISH`, `COMPLETE`).|
|**Committees**|`/api/events/[id]/committees` & `/members`|`POST`/`PATCH`/`DELETE`|`EXECUTIVE` creates/reassigns single active Officer `head_user_id`; `Committee Head` manages own roster.|
|**Meetings**|`/api/meetings/*`|`GET`/`POST`/`PATCH`|Isolated namespace; hard `403` for `MEMBER`; Executive scheduling + minutes attachment.|
|**Documents**|`/api/documents/upload-init`, `/upload-finalize`, `/external`|`POST`|3-phase resumable Google Drive upload or validated Drive URL registration.|
|**Portal**|`/api/portal/summary`, `/calendar`, `/attendance`, `/announcements`|`GET`|Strict `MEMBER` read-only DTO projections filtered by `session.user_id` and `PUBLISHED` status.|
|**Admin**|`/api/admin/masterlist/preview` & `/commit`|`POST`|`SUPER_ADMIN` CSV/XLSX validation preview and batched transactional import.|
|**Admin**|`/api/admin/terms/*`, `/users/[id]/status`, `/audit-logs`|`GET`/`POST`/`PATCH`|Term rollover, officer appointments, soft-disabling, and audit ledger queries.|

### 9.2 Break-Glass Request Contract (`SUPER_ADMIN`)

Any `SUPER_ADMIN` invoking an Executive-scoped mutation includes an optional schema extension validated by `authorize()`:

  

JSON

```
{
    "break_glass": true,
    "reason": "President unavailable during live event; opening AM In checkpoint per VP Internal confirmation."
}
```

Requests missing `break_glass: true` or with `reason.trim().length < 10` fail with `400 Bad Request` (`BREAK_GLASS_REASON_REQUIRED`).

  

## 10. PWA Architecture & Performance Engineering

### 10.1 Progressive Web App Configuration

- **Manifest (`src/app/manifest.ts`):** Generates `/manifest.webmanifest` with `display: "standalone"`, SYComP brand colors (`theme_color: "#121216"`, `background_color: "#121216"`), and `192x192` / `512x512` / `maskable` emblem icons.
    
- **Service Worker (`@serwist/next`):**
    
    - **Precaches:** Next.js static bundles (`/_next/static/*`), fonts, and brand icons for near-instant cold launches.
        
    - **Network-Only Policy for APIs (`/api/*`):** Never caches sensitive PII, role checks, or attendance endpoints in browser Cache Storage.
        
    - **Offline Fallback:** Serves a clean offline banner via client connectivity listeners (`online`/`offline` events) and blocks QR `Confirm Attendance` submissions while offline to preserve live duplicate and role integrity (`BR-ATT-03`, `BR-ATT-05`).
        

### 10.2 Performance Budgets (`NFR-PERF-01` – `NFR-PERF-03`)

- **Sub-1.5s QR Scan Latency (`NFR-PERF-01`):** Both `/api/attendance/lookup` and `/api/attendance/confirm` execute single indexed queries on `users(student_id_number)` and `attendance_records(checkpoint_id, user_id)` with zero N+1 joins, targeting `< 250ms` server execution in Singapore (`sin1`) Vercel + Supabase Southeast Asia (`ap-southeast-1`) regions for minimum latency from the Philippines.
    
- **Co-Located Region Pinning:** Both the Vercel Serverless Function region (`sin1`) and Supabase PostgreSQL project (`ap-southeast-1`, Singapore) are pinned to the same Southeast Asian region to minimize cross-region round-trip overhead.
    
- **Sub-2.5s Interactive Load (`NFR-PERF-02`):** Dashboard queries run in parallel (`Promise.all`) inside React Server Components with Suspense streaming and Shadcn `Skeleton` fallbacks.
    

## 11. Deployment, Environments & Secret Management

### 11.1 Environment Topology

|**Environment**|**Hosting & Branch**|**Database**|**Google Drive Root**|**Email Behavior**|
|---|---|---|---|---|
|**Local Dev**|`localhost:3000` (`feature/*`)|Local Docker Postgres or Dev Supabase project|`SYComP OMS Dev Root`|Console log provider or Resend test sandbox|
|**Preview / Staging**|Vercel Preview URLs (Pull Requests / `develop`)|Supabase Dev/Staging Free Project|`SYComP OMS Staging Root`|Restricted to test recipients / Resend sandbox|
|**Production**|Vercel Production (`main`)|Supabase Production Free Project|`SYComP OMS Root`|Live `EMAIL_PROVIDER` (`resend` or `smtp`)|

### 11.2 Required Environment Variables (`src/config/env.ts`)

Validated at build/startup using `zod` so misconfigurations fail fast:

  

- **Database:** `DATABASE_URL` (Supavisor pooler), `DIRECT_DATABASE_URL` (migrations)
    
- **App & Security:** `APP_URL`, `UNIVERSITY_EMAIL_DOMAIN`, `OTP_HMAC_SECRET`, `UPLOAD_INTENT_SECRET`
    
- **Google Drive:** `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `DRIVE_SHARE_MODE` (`domain` | `unlisted`), `MAX_UPLOAD_SIZE_BYTES` (`15728640`)
    
- **Email Adapter:** `EMAIL_PROVIDER` (`resend` | `smtp`), `EMAIL_FROM`, `RESEND_API_KEY` _(if resend)_, `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` _(if smtp)_
    

### 11.3 CI/CD Pipeline (GitHub Actions + Vercel)

1. **Pull Request Checks:** `pnpm typecheck` (`tsc --noEmit`) $\rightarrow$ `pnpm lint` $\rightarrow$ `pnpm test` (unit & permission guard tests) $\rightarrow$ Vercel Preview Deployment.
    
2. **Production Release (`main`):** Runs `drizzle-kit migrate` against production `DIRECT_DATABASE_URL` prior to promoting the Vercel build, ensuring schema changes are backward-compatible and applied atomically.
    

## 12. $0 Free-Tier Operational Guardrails & Maintenance

Running production student organization software at $0 cost requires explicit awareness of free-tier platform constraints:

  

|**Platform**|**Free-Tier Constraint**|**Architectural Mitigation**|
|---|---|---|
|**Supabase Free**|Pauses database after **7 days of complete inactivity**; **500 MB** DB storage cap; 2 active free projects max.|Configure a lightweight scheduled GitHub Action / Vercel Cron health ping (`GET /api/health`) every 5 days during semester breaks to prevent auto-pausing; store all binary files in Google Drive (never Postgres) so DB stays well under 50 MB across multiple academic years.|
|**Vercel Hobby**|4.5 MB request body cap; 10s–60s serverless execution timeout; non-commercial usage.|Direct-to-Drive resumable uploads bypass the 4.5 MB limit; masterlist imports chunk inserts cleanly in 200-row batches; suitable for non-commercial student org governance.|
|**Google OAuth2 (Regular Account)**|Google Cloud apps left in **"Testing"** publishing status expire Refresh Tokens after **7 days**!|Set the Google Cloud OAuth Consent Screen publishing status to **"In Production"** (even for a single internal org account—skipping unverified warning once during initial SYComP admin token generation) so the Refresh Token remains long-lived without 7-day expiry.|
|**Resend Free**|100 emails/day, 3,000 emails/month; requires verified domain for arbitrary recipients.|Rate-limit OTP requests (`3 / 15m` per user); fall back to `EMAIL_PROVIDER=smtp` (SYComP Gmail App Password) if no custom domain is configured yet.|
|**Backups**|Supabase Free does not include automated daily PITR backups.|Schedule a weekly GitHub Action (`pg_dump`) exporting encrypted schema/data snapshots to a private backup folder in Google Drive or GitHub Artifacts (retained 30 days) for institutional continuity.|
