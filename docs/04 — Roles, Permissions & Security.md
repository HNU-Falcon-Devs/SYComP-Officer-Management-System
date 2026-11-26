## 1. Document Identity

* **Document ID:** `04-roles-permissions-and-security.md`
* **System:** SYComP Organizational Management System (SYComP OMS)
* **Document Status:** v1.1 — Approved Baseline
* **Phase:** Phase 6 — Roles, Permissions & Security Architecture
* **Repository Path:** `docs/04-roles-permissions-and-security.md`
* **Dependencies:** [[00 — Project Charter SYComP Organizational Management System]], [[01 — Requirements Specification SYComP Organizational Management System]], [[02 — Organizational Workflow & Policies SYComP OMS]], [[02b — Business Rules & Workflow Design SYComP OMS]], [[03 — Domain Model & Data Dictionary SYComP OMS]]



---

## 2. Purpose & Security Objectives

This document establishes the authoritative access control architecture, permission matrices, authentication flows, session controls, privacy policies, Google Drive access model, and application security standards for **SYComP OMS Version 1**. It operationalizes the 3-layer decoupled role architecture (`BR-SYS-03`), strict member isolation (`FR-MEM-05`), server-side authorization enforcement (`NFR-SEC-02`), and immutable audit logging (`BR-SYS-04`) across all 19 domain entities.

Core security principles:

* **Deny by Default:** Every API endpoint, server action, and database query denies access unless an explicit rule evaluates to `ALLOW`.
* **Strict Active-Account Gate:** Only `ACTIVE` user accounts may authenticate or maintain an active session; both `DISABLED` and `NEEDS_REVIEW` accounts are blocked immediately.
* **Decoupled Authority:** Access checks evaluate account status, global system tier, and event-committee context—never organizational position titles (`officer_appointments.position_title`).
* **Audited Break-Glass Custody:** `SUPER_ADMIN` holds direct break-glass override capability across all modules, strictly gated by a mandatory justification reason and immutable audit tagging.
* **Defense in Depth:** Authorization, sanitization, state-transition locks, and relational constraints are enforced independently across both the service layer and PostgreSQL (`FR-AUD-05`, `NFR-SEC-02`).



---

## 3. 3-Layer Decoupled Role & Authority Model

SYComP OMS evaluates authorization in strict sequential order (`BR-SYS-03`):

| Evaluation Layer | Backing Data Source | Allowed Values / Scope | Security Behavior |
| --- | --- | --- | --- |
| **Layer 0: Account Lifecycle Gate** | `users.account_status` | `ACTIVE`, `NEEDS_REVIEW`, `DISABLED` | Mandatory entry gate. Only `ACTIVE` accounts may log in or access any endpoint. Both `DISABLED` and `NEEDS_REVIEW` immediately fail authentication (`403 Forbidden`) and revoke all active sessions until resolved by `SUPER_ADMIN`. |
| **Layer 1: Global System Tier** | `users.system_role` | `SUPER_ADMIN`, `EXECUTIVE`, `OFFICER`, `MEMBER` | Controls baseline module access and organizational governance authority. Recomputed atomically from active `officer_appointments` (`SUPER_ADMIN` > `EXECUTIVE` > `OFFICER`, fallback `MEMBER`). |
| **Layer 2: Organizational Title *(Metadata Only)*** | `officer_appointments.position_title` | e.g., `Faculty Adviser`, `President`, `VP Internal`, `Secretary`, `Technical Director` | **Non-authoritative.** Used strictly for UI display, directory filtering, and historical archiving. Authorization logic must never branch on `position_title`. |
| **Layer 3: Contextual & Ownership Authority** | `event_committees.head_user_id`, `event_committee_members`, `task_assignees`, `events.created_by`, `users.id` | Scoped strictly to one `committee_id`, `event_id`, `task_id`, or `self` record | Grants fine-grained write/read access (e.g., `Committee Head` task and roster control strictly within their assigned committee, proposal author edits while `DRAFT`/`NEEDS_REVISION`, and Member self-service views).

 |

### 3.1 `SUPER_ADMIN` Custody & Break-Glass Override Policy

* **Native System Custody:** `SUPER_ADMIN` holds exclusive authority over academic term creation/activation/closure (`BR-TERM-01`), bulk masterlist provisioning (`FR-AUTH-01`), account lifecycle transitions (`ACTIVE`/`NEEDS_REVIEW`/`DISABLED`), officer appointment management (`FR-ORG-02`), administrative password resets (`BR-ACCT-03`), and system configuration.


* **Universal Break-Glass Override (`BG`):** `SUPER_ADMIN` is permitted direct break-glass override access across all operational modules (event approvals/publishing, committee management, tasks, meetings, attendance checkpoints/overrides, document approvals, and announcements) as well as locked historical records (`BR-SYS-05`).


* **Mandatory Safeguards on Break-Glass Actions:**
1. The request payload must explicitly include a non-empty `reason` (minimum 10 characters) and an explicit override intent flag (e.g., `break_glass: true`).
2. The UI must present a distinct warning confirmation modal before submitting any break-glass mutation.
3. The backend writes an append-only `audit_logs` entry containing `reason`, `before_state`, `after_state`, and `"break_glass": true` inside the action metadata so Executive leadership can inspect every technical intervention.



---

## 4. Permission Matrices

**Legend:**

* **Y** = Allowed natively (within active term unless noted)
* **BG** = `SUPER_ADMIN` Break-Glass Override (allowed globally with mandatory `reason` + `break_glass` audit flag)
* **C** = Conditional / Contextual (see Scope Rule)
* **S** = Self only (`target.user_id === actor.id` and `account_status === 'ACTIVE'`)
* **R** = Read-only
* **—** = Denied (`HTTP 403 Forbidden`)

### 4.1 Identity, Account Lifecycle & Term Governance

| Capability / Action | `SUPER_ADMIN` | `EXECUTIVE` | `OFFICER` | `MEMBER` | Scope Rule & Invariant |
| --- | --- | --- | --- | --- | --- |
| Import student masterlist (`masterlist_imports`) | Y | — | — | — | Requires active term; pre-commit duplicate/discrepancy preview (`FR-AUTH-01`). |
| View masterlist import history & discrepancy reports | Y | R | — | — | Executives may inspect summary counts; only `SUPER_ADMIN` resolves flags. |
| Change `users.account_status` (`ACTIVE`/`NEEDS_REVIEW`/`DISABLED`) | Y | — | — | — | Cannot disable the last active `SUPER_ADMIN`. Transition away from `ACTIVE` immediately revokes sessions (`FR-AUTH-06`). |
| View full Member & Officer Directory | Y | Y | Y | — | Excludes `password_hash` and `token_hash` (`FR-ORG-04`). |
| Bind/verify own university email & change own password | S | S | S | S | Requires `ACTIVE` account; email must match institutional university domain (`FR-AUTH-04`, `FR-AUTH-05`). |
| Trigger administrative password reset (unverified/locked accounts) | Y | — | — | — | Sets `must_change_password = true`; revokes active sessions; audit logged (`BR-ACCT-03`). |
| Create, activate, or close `academic_terms` | Y | — | — | — | Atomic rollover enforces single `ACTIVE` term (`BR-SYS-01`, `BR-TERM-02`). |
| Create / end `officer_appointments` | Y | — | — | — | Atomically recomputes `users.system_role` (`03` Sec 6.3). |
| View historical terms & past officer appointments | Y | Y | Y | — | Read-only once `academic_terms.status = 'CLOSED'` (`FR-ORG-03`).

 |

### 4.2 Events, Proposals, Committees & Tasks

| Capability / Action | `SUPER_ADMIN` | `EXECUTIVE` | `OFFICER` | `Committee Head` *(Event-Scoped)* | `MEMBER` | Scope Rule & Invariant |
| --- | --- | --- | --- | --- | --- | --- |
| Create Event Proposal (`DRAFT`) | BG | Y | Y | Y | — | Active term required; `SUPER_ADMIN` uses `Y` if holding an active officer appointment, else `BG` (`FR-EVT-01`). |
| View `DRAFT` proposals | Y | Y | C | C | — | Visible to `events.created_by`, `EXECUTIVE`, and `SUPER_ADMIN` (`BR-EVT-01`). |
| View `PENDING_REVIEW` / `NEEDS_REVISION` / `APPROVED` / `REJECTED` events | Y | Y | Y | Y | — | Open Officer Proposal Workspace (`FR-EVT-03`). |
| View `PUBLISHED` & `COMPLETED` public events | Y | Y | Y | Y | Y | Members receive public fields only (`public_summary`, schedule, venue) (`FR-EVT-08`). |
| Edit & resubmit `DRAFT` / `NEEDS_REVISION` proposal | BG | Y | C | C | — | Author (`events.created_by`) or `EXECUTIVE` (`FR-EVT-05`). |
| Post collaborative review `COMMENT` (`event_proposal_reviews`) | BG | Y | Y | Y | — | Non-empty `feedback_note` required. |
| Approve / Request Revision / Reject proposal | BG | Y | — | — | — | `REQUEST_REVISION` & `REJECTED` require mandatory `feedback_note` (`FR-EVT-04`). |
| Publish / Unpublish / Complete event | BG | Y | — | — | — | Unpublish requires mandatory reason; Complete requires all checkpoints `CLOSED`. |
| Create/edit `event_committees` & assign/reassign `head_user_id` | BG | Y | — | — | — | Event must be `APPROVED` or `PUBLISHED`; head must be active Officer/Executive (`BR-COM-01`, `BR-COM-02`). |
| Add/remove `event_committee_members` | BG | Y | — | C | — | `Committee Head` scoped strictly to own `committee_id`; cannot add `head_user_id` as member (`BR-COM-04`). |
| Create/edit/assign Committee `tasks` | BG | Y | — | C | — | `Committee Head` scoped strictly to `tasks.committee_id === own_committee_id` (`BR-TSK-01`). |
| Create/edit/assign General / Event-wide `tasks` (no committee) | BG | Y | — | — | — | Executive-only (`BR-TSK-01`). |
| Update assigned task status (`TO_DO` $\leftrightarrow$ `IN_PROGRESS` $\rightarrow$ `FOR_REVIEW`) | BG | Y | C | C | — | Must be listed in `task_assignees` for that `task_id` (`BR-TSK-02`). |
| Mark task `DONE` or return `FOR_REVIEW` $\rightarrow$ `IN_PROGRESS` | BG | Y | — | C | — | `Committee Head` (for committee tasks) or any `EXECUTIVE` (`BR-TSK-02`).

 |

### 4.3 Officer Meetings & Dynamic Attendance

| Capability / Action | `SUPER_ADMIN` | `EXECUTIVE` | `OFFICER` | `Committee Head` *(Event-Scoped)* | `MEMBER` | Scope Rule & Invariant |
| --- | --- | --- | --- | --- | --- | --- |
| Access `/meetings` module & view schedules/agendas/minutes | Y | Y | Y | Y | — | Strictly isolated from `MEMBER` (`403`) (`FR-MTG-05`, `BR-MTG-01`). |
| Create, edit, start (`ONGOING`), cancel, or complete `meetings` | BG | Y | — | — | — | Executive-only (`FR-MTG-02`, `BR-MTG-02`). |
| Author/attach Minutes of Meeting (`minutes_html` / file) | BG | Y | C | C | — | Active `OFFICER` or `EXECUTIVE` prior to `COMPLETED` (`BR-MTG-04`). |
| Create, edit, open, or close `attendance_checkpoints` (Events & Meetings) | BG | Y | — | — | — | **Strictly `EXECUTIVE`-only** (plus `SUPER_ADMIN` break-glass). Meetings enforce `audience_scope = 'OFFICERS_ONLY'`. |
| Initial QR Scan: Target is `MEMBER` (Event checkpoint `OPEN`) | BG | Y | Y | Y | — | Blocks duplicates and non-`ACTIVE` (`DISABLED`/`NEEDS_REVIEW`) targets (`BR-ATT-03`, `BR-ATT-04`, `BR-ATT-07`). |
| Initial QR Scan: Target is active `OFFICER` / `EXECUTIVE` (Event or Meeting) | BG | Y | — | — | — | **Hard `403` for non-Executive `OFFICER**`, including self-scan (`BR-ATT-05`). |
| Manual attendance add / status override (`PRESENT`/`LATE`/`EXCUSED`/`ABSENT`) | BG | Y | — | — | — | Mandatory non-empty `edit_reason` + audit log (`BR-ATT-06`, `BR-ATT-08`). |
| View event/meeting attendance logs & export CSV | Y | Y | Y | Y | — | Export minimizes PII and applies CSV formula-injection defense (`FR-ATT-08`). |
| View personal attendance history | S | S | S | S | S | Members see only own `attendance_records` for `PUBLISHED`/`COMPLETED` events (`FR-MEM-02`).

 |

### 4.4 Documents, Announcements & Audit Logs

| Capability / Action | `SUPER_ADMIN` | `EXECUTIVE` | `OFFICER` | `MEMBER` | Scope Rule & Invariant |
| --- | --- | --- | --- | --- | --- |
| Manage `document_types` (create/edit/soft-disable) | Y | Y | — | — | Dynamic categories feeding `resolveDriveFolderPath` (`FR-DOC-02`, `BR-DOC-01`). |
| Upload document (`DRIVE_UPLOAD`) or register `EXTERNAL_LINK` | Y | Y | Y | — | Initial status `DRAFT` or `FOR_REVIEW`; server verifies Drive upload + domain sharing before DB commit (`BR-DOC-03`). |
| View/preview `documents` | Y | Y | Y | — | Hidden from `MEMBER` (`FR-MEM-05`). |
| Transition document to `APPROVED` / `ARCHIVED` | BG | Y | — | — | Executive-only (`BR-DOC-04`). |
| Draft `announcements` (`DRAFT`) | BG | Y | Y | — | Drafts hidden from `MEMBER` (`BR-ANN-02`). |
| Publish, edit published, pin, or archive `announcements` | BG | Y | — | — | Executive-only (`BR-ANN-01`). |
| View `PUBLISHED` announcements (`ALL_MEMBERS`) | Y | Y | Y | Y | Public Member Portal feed (`FR-MEM-04`). |
| View `PUBLISHED` announcements (`OFFICERS_ONLY`) | Y | Y | Y | — | Denied to `MEMBER` (`BR-ANN-03`). |
| Search & inspect `audit_logs` | Y | Y | — | — | Strictly read-only for all roles; no UI or API allows update/delete (`FR-AUD-03`).

 |

### 4.5 Temporal State-Based Immutability Locks (`BR-SYS-05`)

Even when a user passes role checks, the service layer enforces lifecycle locks:

* **`academic_terms.status = 'CLOSED'`:** All term-scoped tables become strictly read-only. Modifications require an audited `SUPER_ADMIN` break-glass or `EXECUTIVE` historical correction with a mandatory `reason`.
* **`events.status = 'COMPLETED'`:** Locks `event_committees`, `event_committee_members`, `tasks`, `task_assignees`, `attendance_checkpoints`, and QR scanning for that event.
* **`meetings.status = 'COMPLETED'` or `'CANCELLED'`:** Locks meeting metadata, minutes edits, and checkpoint scans.
* **`events.status = 'REJECTED'`:** Permanently read-only historical record.



---

## 5. Authentication & Session Security Architecture

### 5.1 Primary Authentication & Default Provisioning

* **Identifier:** `users.student_id_number` (trimmed and case-normalized consistently at lookup).
* **Default Credential Normalization (`BR-ACCT-01`):**
1. Extract `last_name` from the masterlist import.
2. Strip whitespace, hyphens, apostrophes, and punctuation; convert to lowercase ASCII (e.g., `"De La Cruz"` + `"2024-01234"` $\rightarrow$ `"delacruz2024-01234"`).
3. Hash immediately prior to insertion; plaintext default credentials are never persisted or logged.
4. Set `users.must_change_password = true`, rendering a persistent security reminder banner on login (`FR-AUTH-08`).




* **Password Hashing (`NFR-SEC-01`):**
* Primary: **`Argon2id`** (minimum `m=19456` KiB, `t=2`, `p=1`).
* Fallback (if runtime-constrained): **`bcrypt`** with cost factor $\ge 12$.
* All credential comparisons must run in constant time.


* **User-Set Password Policy:** Minimum 10 characters, at least 1 letter and 1 number, rejecting exact matches against `student_id_number` or the normalized default password.

### 5.2 Session Management & Immediate Revocation

* **Cookie Transport:** Sessions use `HttpOnly`, `Secure`, `SameSite=Lax` cookies. Authentication tokens must never be stored in `localStorage` or `sessionStorage`.
* **Session Lifetimes:** Sliding idle timeout of **24 hours** for `MEMBER`/`OFFICER` (**8 hours** for `EXECUTIVE`/`SUPER_ADMIN`), with a **7-day** absolute maximum session lifetime.
* **Server-Side State Verification & Instant Revocation:** Every authenticated request verifies current `account_status` and `system_role` server-side (never trusting stale stateless JWT claims). All active sessions for a user are **immediately revoked** upon:
* `account_status` transitioning to `DISABLED` or `NEEDS_REVIEW`.
* Password change, self-service OTP reset, or administrative password reset.
* `system_role` downgrade during term rollover or mid-term step-down.



### 5.3 Strict University Email Domain Binding & OTP Recovery (`verification_tokens`)

* **Strict Institutional Domain Enforcement:** Account email binding (`FR-AUTH-04`) strictly enforces the institution's official university email domain configured via server environment variable (`UNIVERSITY_EMAIL_DOMAIN`, e.g., `@<university-domain>`).
* Emails are trimmed and lowercased before validation.
* Any email whose domain does not match `UNIVERSITY_EMAIL_DOMAIN` exactly (including personal providers like Gmail/Yahoo or lookalike subdomains) is rejected server-side with `400 Bad Request` before any OTP is generated or sent.
* Domain enforcement applies identically during email binding and password reset lookup.


* **OTP Generation & Storage (`NFR-SEC-04`):**
* Generate a cryptographically random 6-digit numeric code (`CSPRNG`).
* Store only a keyed hash (`HMAC-SHA256` or `Argon2id`) in `verification_tokens.token_hash`.
* Set `expires_at` to **10 minutes** from issue (`10–15` minute window).


* Issuing a new OTP for `(user_id, purpose)` immediately invalidates all prior unconsumed tokens for that pair.


* **Verification & Recovery Guards:**
* Increment `attempt_count` atomically before hash verification; lock/invalidate the token after **5 failed attempts**.
* Set `consumed_at = NOW()` atomically upon first valid verification to prevent replay.
* Self-service `PASSWORD_RESET` requires `users.account_status = 'ACTIVE'`, `users.university_email IS NOT NULL`, and `users.email_verified_at IS NOT NULL` (`BR-ACCT-03`). Unverified or non-active users see neutral instructions to contact SYComP `SUPER_ADMIN`.





### 5.4 Brute-Force Protection & Non-Enumeration

* **Rate Limiting:**
* Login: Max 10 attempts per IP / 15 minutes; 5 consecutive failures per `student_id_number` trigger a 15-minute cooldown.
* OTP dispatch: Max 3 emails per account / 15 minutes and 10 per hour.


* **Non-Enumeration Hygiene:** Unknown IDs and incorrect passwords return the identical generic error (`"Invalid Student ID or password."`) and perform a dummy hash comparison to prevent timing leaks. Account hold notices (`DISABLED` or `NEEDS_REVIEW` — directing the student to contact SYComP officers / `SUPER_ADMIN`) are returned **only after** valid credentials verify (`FR-AUTH-03`).



---

## 6. Server-Side Authorization Enforcement Pipeline

Every protected API route or server action passes through a single centralized guard (`authorize(ctx, permission, resource)`) in strict sequence (`NFR-SEC-02`):

```text
Incoming Request
  │
  ├─► 1. Authenticate Session
  │       └─ Missing / expired / revoked session ──────────────────────► 401 Unauthorized
  │
  ├─► 2. Account Lifecycle Gate (BR-SYS-03 Step 1)
  │       └─ account_status !== 'ACTIVE' ('DISABLED' | 'NEEDS_REVIEW') ► 403 Forbidden (Revoke session)
  │
  ├─► 3. Route Namespace & Global Tier Check (BR-SYS-03 Step 2)
  │       ├─ Native permission satisfied ──────────────────────────────► Continue
  │       ├─ SUPER_ADMIN break-glass applicable?
  │       │    ├─ break_glass=true & valid reason (>=10 chars) ────────► Continue (Flag BG audit)
  │       │    └─ Missing flag or reason ──────────────────────────────► 400 Bad Request
  │       └─ Otherwise ────────────────────────────────────────────────► 403 Forbidden
  │
  ├─► 4. Temporal & State Lock Check (BR-SYS-05)
  │       └─ Term CLOSED / Event COMPLETED / Meeting COMPLETED
  │            ├─ Audited override allowed & reason present ───────────► Continue
  │            └─ Otherwise ───────────────────────────────────────────► 409 Conflict
  │
  ├─► 5. Contextual & Resource-Level Check (BR-SYS-03 Step 3)
  │       ├─ Member portal query: enforce WHERE user_id = actor.id
  │       ├─ Committee Head: verify event_committees.head_user_id == actor.id
  │       │                  AND active officer_appointment in event.academic_term_id
  │       ├─ Proposal edit: verify events.created_by == actor.id (or EXECUTIVE / BG)
  │       ├─ Checkpoint management: strictly EXECUTIVE (or SUPER_ADMIN BG)
  │       └─ Attendance scan: reject non-EXECUTIVE OFFICER scanning active Officer/Executive (BR-ATT-05)
  │
  └─► 6. Execute Domain Service + Atomic Audit Log (BR-SYS-04)

```

### 6.1 Route Namespace Isolation & IDOR Prevention

* **Member Portal (`/portal/*`, `/api/portal/*`):** Accessible to all `ACTIVE` users; queries strictly enforce `user_id = session.user_id`, `events.status IN ('PUBLISHED', 'COMPLETED')`, and `announcements.audience = 'ALL_MEMBERS'`.


* **Officer Workspace (`/workspace/*`, `/api/events/*`, `/api/tasks/*`, `/api/documents/*`):** Requires `system_role IN ('OFFICER', 'EXECUTIVE', 'SUPER_ADMIN')`.
* **Officer Meetings (`/meetings/*`, `/api/meetings/*`):** Dedicated isolated namespace (`FR-MTG-01`); returns `403 Forbidden` for any `MEMBER`.


* **Administration (`/admin/*`, `/api/admin/*`):** Restricted to `SUPER_ADMIN` (with read-only `/audit-logs` and `/reports` accessible to `EXECUTIVE`).


* **IDOR Defense:** Data-access queries scope lookups by the caller's authorized tenant/ownership predicates rather than fetching records blindly by client-supplied UUIDs. Client-supplied `system_role`, `recorded_by`, or `user_id` fields on self-service endpoints are always ignored in favor of the authenticated server session.

---

## 7. Data Privacy, PII Handling & Member Isolation

Aligned with the **Philippine Data Privacy Act of 2012 (RA 10173)** (transparency, legitimate purpose, and proportionality):

### 7.1 Data Classification Matrix

| Classification | Examples in SYComP OMS | Access & Storage Controls |
| --- | --- | --- |
| **Secret / Credentials** | `users.password_hash`, `verification_tokens.token_hash`, Google Drive Service Account JSON, SMTP/Email API keys | Server-only. Excluded from all API DTOs, client bundles, error stack traces, and `audit_logs` (`NFR-SEC-05`, `03` Sec 6.5). |
| **Restricted Operational PII** | `student_id_number`, `university_email`, individual `attendance_records`, `audit_logs.ip_address`, `masterlist_imports.report_summary` | Visible only to the data subject (`self`) or authorized active Officers/Executives/Super Admins on a strict need-to-know basis. |
| **Internal Organizational Data** | Draft/pending proposals, review notes, committee rosters, tasks, `documents` metadata & Drive URLs, `meetings`, `OFFICERS_ONLY` announcements | Strictly denied to `MEMBER` accounts (`FR-MEM-05`). |
| **Member-Visible Data** | `PUBLISHED` / `COMPLETED` event calendar entries (`public_summary`, schedule, venue), `ALL_MEMBERS` published announcements | Read-only for authenticated `ACTIVE` `MEMBER` accounts.

 |

### 7.2 Privacy Controls

* **Explicit DTO Allowlisting:** Every API response serializes through explicit Data Transfer Objects; raw ORM records are never returned.
* **Non-Destructive Archival Masking (`BR-SYS-02`):** `DISABLED` and `NEEDS_REVIEW` accounts retain historical relational links but are excluded from active event pickers, committee head selection, and QR scanning.


* **CSV Export Minimization (`FR-ATT-08`):** Attendance exports include only `student_id_number`, `full_name`, checkpoint label, status, and timestamp—omitting `university_email` and internal lifecycle notes.



---

## 8. Application & Integration Security Policies

### 8.1 Rich-Text XSS Prevention (`FR-EVT-09`, `NFR-SEC-03`)

All rich-text fields (`events.description_html`, `meetings.agenda_html`, `meetings.minutes_html`, `announcements.body_html`) pass through a server-side HTML allowlist sanitizer before storage and rendering:

* **Allowed Tags:** `p`, `br`, `h1`, `h2`, `h3`, `h4`, `strong`, `em`, `u`, `s`, `ul`, `ol`, `li`, `blockquote`, `code`, `pre`, `a`, `hr`.
* **Allowed Attributes:** `a[href, target, rel]` restricted exclusively to `https://` and `mailto:` protocols (enforcing `rel="noopener noreferrer"`).
* **Explicitly Stripped:** `<script>`, `<iframe>`, `<object>`, `<embed>`, `<style>`, inline `on*` event attributes, and `javascript:` / `data:` URIs.

### 8.2 Google Drive API & University-Domain Access Model (`FR-DOC-01`–`06`, `NFR-SEC-05`)

* **Server-Only Service Account:** Google Drive API credentials reside strictly in server environment secrets and are scoped solely to the dedicated `SYComP OMS Root` folder/Shared Drive—never personal or organization-wide root access.


* **Native Domain-Restricted Link Sharing:** When uploading a file (`storage_mode = 'DRIVE_UPLOAD'`), the backend configures Google Drive permissions natively on the uploaded file (or inherited from `SYComP OMS Root`):
* `type: "domain"`
* `domain: UNIVERSITY_EMAIL_DOMAIN`
* `role: "reader"`
* `allowFileDiscovery: false` (prevents files from appearing in campus-wide Google Drive search)
* Authorized officers open or preview `web_view_link` directly using their university Google Workspace account; external/personal Google accounts are blocked by Google Drive natively.


* **Accepted Trade-Off & Safeguards:** Because general `MEMBER` students also possess university-domain Google accounts, domain-scoped sharing means an unlisted `web_view_link` could be opened if explicitly leaked outside the app. To mitigate this in v1:
1. `documents` records and `web_view_link` URLs are strictly withheld from all `MEMBER` APIs (`FR-MEM-05`).


2. `allowFileDiscovery: false` keeps files unsearchable in Google Drive.
3. *(Future v2 Upgrade Path)* Permissions can be tightened to a synced SYComP Officers Google Group (`type: "group"`) without altering the `documents` schema.


* **File Upload Hardening:**
* Enforce a default **15 MB** max file size (configurable via env).
* Validate both extension and **file signature (magic bytes) / MIME type** against an allowlist (`application/pdf`, `.docx`, `.xlsx`, `.pptx`, `image/png`, `image/jpeg`, `text/plain`, `text/csv`). Reject executable and script-capable files (`.exe`, `.sh`, `.js`, `.html`, `.svg`).
* Sanitize folder segments and filenames inside `resolveDriveFolderPath` by stripping path traversal sequences (`../`, `/`, `\`, null/control bytes).


* **External Link Validation (`FR-DOC-06`):** `EXTERNAL_LINK` records must validate strictly against `[https://drive.google.com/](https://drive.google.com/)*` or `[https://docs.google.com/](https://docs.google.com/)*` hostnames.


* **Compensating Orphan Cleanup (`BR-DOC-03`):** If database persistence fails after a successful Google Drive upload, the service deletes the newly uploaded `drive_file_id` immediately (logging any cleanup failure for `SUPER_ADMIN` review).



### 8.3 QR Attendance Integrity

* **Server-Authoritative Logging:** The client transmits only `{ checkpoint_id, scanned_student_id }`. The server derives `recorded_by` from the authenticated session and `recorded_at` from server UTC `NOW()`.
* **Strict Checkpoint & Target Guards:**
* Scans fail unless `attendance_checkpoints.status === 'OPEN'` (`BR-ATT-02`).
* Scans fail if the target user's `account_status !== 'ACTIVE'` (`DISABLED` or `NEEDS_REVIEW`) (`BR-ATT-07`).
* If the target holds an active `officer_appointments` row (`is_current = true`) or `system_role IN ('OFFICER', 'EXECUTIVE', 'SUPER_ADMIN')`, a regular `OFFICER` scanner receives `403 Forbidden` (`BR-ATT-05`).




* **Payload Validation:** Validate decoded QR text against the institutional `student_id_number` regex before executing database lookups.

### 8.4 CSV / Masterlist Hardening

* **Import Limits:** Cap masterlist uploads at **5 MB / 2,000 rows** per batch and parse strictly via typed schema validation (`NFR-PERF-03`).


* **CSV Formula Injection Defense:** Prefix exported cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` with a single quote (`'`) to prevent spreadsheet formula execution.

### 8.5 Web Transport & HTTP Security Headers

* **HTTPS Everywhere:** Enforce TLS 1.2+ with `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
* **CSRF Defense:** Enforce `SameSite=Lax` cookies paired with strict `Origin`/`Referer` header validation (or framework CSRF tokens) on all state-changing requests.
* **Standard Response Headers:**
* `Content-Security-Policy` restricting scripts to `'self'`, permitting camera access solely on scanner routes, and allowing preview frames solely from `[https://drive.google.com](https://drive.google.com)` and `[https://docs.google.com](https://docs.google.com)`.
* `X-Content-Type-Options: nosniff`
* `X-Frame-Options: DENY`
* `Referrer-Policy: strict-origin-when-cross-origin`
* `Permissions-Policy: camera=(self), microphone=(), geolocation=()`



---

## 9. Audit Logging & Incident Response Policies

### 9.1 Standardized Audit Event Catalog (`audit_logs`)

Every high-impact mutation writes an immutable `audit_logs` record inside the same database transaction as the mutation (`FR-AUD-02`, `BR-SYS-04`):

| Action Key (`audit_logs.action`) | Routine Actor | `SUPER_ADMIN` Mode | `reason` Mandatory? | Redacted State Snapshot |
| --- | --- | --- | --- | --- |
| `MASTERLIST_IMPORTED` | `SUPER_ADMIN` | Native | No | Import counts & `masterlist_import_id` |
| `USER_STATUS_CHANGED` / `USER_DISABLED` | `SUPER_ADMIN` | Native | **Yes** | `account_status`, `status_reason` |
| `USER_PASSWORD_ADMIN_RESET` | `SUPER_ADMIN` | Native | **Yes** | `user_id`, `must_change_password` (no hash) |
| `TERM_ACTIVATED` / `TERM_CLOSED` | `SUPER_ADMIN` | Native | No | Old/new term IDs & closed appointment count |
| `OFFICER_APPOINTED` / `OFFICER_ENDED` | `SUPER_ADMIN` | Native | No | `position_title`, `granted_system_role`, `users.system_role` |
| `EVENT_APPROVED` / `EVENT_REJECTED` / `EVENT_REVISION_REQUESTED` | `EXECUTIVE` | Break-Glass | **Yes** *(Reject/Revise/BG)* | `status`, `revision_count`, `break_glass` |
| `EVENT_PUBLISHED` / `EVENT_UNPUBLISHED` / `EVENT_COMPLETED` | `EXECUTIVE` | Break-Glass | **Yes** *(Unpublish/BG)* | `status`, timestamps, `break_glass` |
| `COMMITTEE_CREATED` / `COMMITTEE_HEAD_ASSIGNED` | `EXECUTIVE` | Break-Glass | **Yes** *(BG only)* | `committee_id`, old/new `head_user_id`, `break_glass` |
| `CHECKPOINT_CREATED` / `CHECKPOINT_STATE_CHANGED` | `EXECUTIVE` | Break-Glass | **Yes** *(BG only)* | `checkpoint_id`, `audience_scope`, `status`, `break_glass` |
| `ATTENDANCE_MANUAL_CREATED` / `ATTENDANCE_OVERRIDDEN` | `EXECUTIVE` | Break-Glass | **Yes** | `checkpoint_id`, `user_id`, before/after `status`, `break_glass` |
| `DOCUMENT_APPROVED` / `DOCUMENT_ARCHIVED` | `EXECUTIVE` | Break-Glass | **Yes** *(BG only)* | `document_id`, before/after `status`, `break_glass` |
| `ANNOUNCEMENT_PUBLISHED` / `ANNOUNCEMENT_ARCHIVED` | `EXECUTIVE` | Break-Glass | **Yes** *(BG only)* | `announcement_id`, `audience`, `status`, `break_glass` |
| `MEETING_CANCELLED` / `MEETING_COMPLETED` | `EXECUTIVE` | Break-Glass | **Yes** *(Cancel/BG)* | `meeting_id`, before/after `status`, `break_glass`

 |

* **Database-Level Immutability:** The application database role holds `INSERT` and `SELECT` privileges on `audit_logs`, with `UPDATE` and `DELETE` revoked.
* **Credential Redaction:** A centralized audit serializer strips any keys matching `/password|token|secret|hash|cookie/i` prior to storing `before_state` or `after_state`.



### 9.2 Incident Response Playbooks

1. **Compromised Default Member Account:** `SUPER_ADMIN` revokes active sessions, executes `USER_PASSWORD_ADMIN_RESET` (`must_change_password = true`), verifies university email ownership in person, and inspects `audit_logs`.
2. **Mid-Term Officer Step-Down / Removal:** `SUPER_ADMIN` sets `officer_appointments.is_current = false` (`ended_at = NOW()`), triggering atomic `users.system_role` downgrade, immediate session revocation, and an `EXECUTIVE` dashboard alert if the officer held any active `Committee Head` assignment (`02b` Edge-Case Matrix).


3. **Suspected Google Drive Key Exposure:** Rotate the Service Account key immediately in Google Cloud Console, revoke the compromised key, update server environment secrets, and review Drive activity logs inside `SYComP OMS Root`.

---

## 10. Security Verification Baseline (Handoff to `07 — Testing & QA`)

All eight verification tests must pass prior to v1 release sign-off:

1. **`SEC-TEST-01` (Member Isolation):** Authenticated `MEMBER` receives `403` on `/meetings`, `/proposals`, `/committees`, `/documents`, `/audit-logs`, and another student's `/attendance` endpoint (`AC-02`).


2. **`SEC-TEST-02` (Role Escalation Guard):** `OFFICER` cannot approve/publish events (`AC-03`), create committees, manage attendance checkpoints, publish announcements, or alter `users.system_role`.


3. **`SEC-TEST-03` (Contextual Boundary):** `Committee Head` of Committee A receives `403` when attempting to create tasks or modify rosters in Committee B of the same event or any committee of another event (`AC-05`).


4. **`SEC-TEST-04` (Attendance Actor-Subject Guard):** `OFFICER` scanning an active `OFFICER`/`EXECUTIVE` ID or attempting to `PATCH` an existing attendance log receives `403`; `EXECUTIVE` override without `edit_reason` receives `400`, and with `edit_reason` persists an `audit_logs` row (`AC-07`).


5. **`SEC-TEST-05` (Immediate Account Hold Revocation):** Transitioning a logged-in user to `DISABLED` or `NEEDS_REVIEW` causes their next API request to fail with `403` and blocks subsequent logins while preserving historical foreign keys (`AC-08`).


6. **`SEC-TEST-06` (XSS & Sanitization):** Submitting `<script>alert(1)</script><img src=x onerror=alert(1)>` in an event proposal strips all executable tags before storage (`FR-EVT-09`).


7. **`SEC-TEST-07` (Strict Email Domain & OTP Abuse Limits):** Attempting to bind a non-university email domain (e.g., `@gmail.com`) returns `400`; entering 5 wrong OTP codes invalidates `verification_tokens`; replaying a consumed OTP fails (`NFR-SEC-04`).


8. **`SEC-TEST-08` (`SUPER_ADMIN` Break-Glass Auditability):** A `SUPER_ADMIN` invoking an Executive-scoped mutation without `break_glass: true` and a valid `reason` receives `400`; with both provided, the mutation succeeds and writes an immutable `audit_logs` entry flagged `break_glass: true`.