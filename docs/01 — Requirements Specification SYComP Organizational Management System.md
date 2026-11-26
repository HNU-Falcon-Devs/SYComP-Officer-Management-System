## 1. Document Identity
* **Document ID:** `01-requirements-specification.md`
* **System:** SYComP Organizational Management System (SYComP OMS)
* **Document Status:** v1.0 — Draft Baseline
* **Phase:** Phase 3 — Requirements Engineering
* **Dependencies:** [[00 — Project Charter SYComP Organizational Management System]], [[02 — Organizational Workflow & Policies SYComP OMS]]

---

## 2. Purpose & Scope
This Software Requirements Specification (SRS) defines the complete functional requirements, non-functional requirements, core use cases, and acceptance criteria for **SYComP OMS Version 1**. It translates SYComP's governance model, dynamic attendance operations, event-bound committee structure, and Google Drive document workflows into verifiable engineering specifications.

---

## 3. User Classes & System Access Summary
Access is governed by the 3-layer decoupled role model:

| System Tier / Context | Assigned To | Primary Capabilities |
| :--- | :--- | :--- |
| **`Super Admin`** | Technical Director / System Maintainer | Term management, masterlist provisioning, account status overrides, audit logs, system settings. |
| **`Executive`** | Faculty Adviser, President, VP Internal, VP External | Approve/reject/revise event proposals, publish events, define event committees, appoint Committee Heads, schedule meetings, record officer attendance, edit any attendance log. |
| **`Officer`** | Standard SYComP Officers | Draft event proposals, view organizational records, manage assigned tasks, upload/track documents, scan/record initial general member attendance. |
| **`Member`** | General Computing Students | Read-only access to personal attendance, published event calendar, and official announcements; self-service university email binding and password recovery. |
| **`Committee Head`** *(Event-Scoped)* | Any `Officer` assigned to a specific Event Committee | Create/assign tasks, manage committee roster, and track deliverables strictly within their assigned event committee. |

---

## 4. Functional Requirements

### 4.1 Authentication, Masterlist Provisioning & Account Lifecycle
* **`FR-AUTH-01` (Masterlist Bulk Provisioning):** The system shall allow a `Super Admin` to import a student masterlist (CSV/spreadsheet containing `student_id_number` and `full_name`) to automatically create `Member` accounts without duplicate creation for existing IDs.
* **`FR-AUTH-02` (Default Credential Generation):** Upon automated provisioning, the system shall assign `student_id_number` as the login identifier and generate a securely hashed default password following the pattern `lastname + student_id_number` (normalized consistently, e.g., trimmed/lowercase surname).
* **`FR-AUTH-03` (Standard Authentication):** Users shall authenticate using their `student_id_number` and password. Disabled accounts shall be rejected at login with a clear administrative notice.
* **`FR-AUTH-04` (University Email Binding):** Logged-in users without a verified email shall be prompted to bind their institutional university email address via a time-limited verification code (OTP).
* **`FR-AUTH-05` (Password Management & Recovery):** Users shall be able to change their password when authenticated. Users with a verified university email shall be able to reset a forgotten password via an email-delivered one-time verification code.
* **`FR-AUTH-06` (Non-Destructive Account Lifecycle):** The system shall never hard-delete user accounts linked to operational or historical records. Each account shall maintain an explicit lifecycle status (`Active`, `Disabled`, `Needs Review`) controlled solely by `Super Admin`.
* **`FR-AUTH-07` (Masterlist Discrepancy Handling):** During subsequent term imports, the system shall flag previously `Active` accounts absent from the new masterlist, as well as duplicate or malformed entries, for `Super Admin` review and soft-disabling (`Transferred` / `Graduated` / `Inactive`).
* **`FR-AUTH-08` (First-Login Security Prompt):** Accounts still using their auto-generated default password shall display a persistent banner recommending password update and university email binding.

### 4.2 Academic Terms & Officer Registry
* **`FR-ORG-01` (Academic Term Management):** A `Super Admin` shall be able to create, activate, and close Academic Terms (e.g., `AY 2026–2027 - 1st Semester`), ensuring only one term is marked `Active` at a time.
* **`FR-ORG-02` (Officer Appointment History):** A `Super Admin` shall be able to bind a user to an organizational position title (metadata, e.g., *President*, *Secretary*, *Auditor*) and a global system tier (`Executive` or `Officer`) scoped to a specific Academic Term.
* **`FR-ORG-03` (Historical Term Preservation):** Closing an Academic Term shall archive its officer appointments as immutable historical records without overwriting past terms when new officers are appointed.
* **`FR-ORG-04` (Officer & Member Directory):** Authorized officers shall be able to search and filter active and historical officer appointments and general member records by name, Student ID, academic term, and account status.
* **`FR-ORG-05` (Automatic Tier Downgrade on Rollover):** When an officer's term ends and they are not re-appointed in the new active term, the `Super Admin` rollover workflow shall revert their global system tier to `Member` (or `Disabled` if graduated) while preserving historical appointment records.

### 4.3 Event Proposals, Lifecycle & Calendar
* **`FR-EVT-01` (Officer Proposal Drafting):** Any `Officer` or `Executive` shall be able to create an Event Proposal containing a title, rich-text description (supporting headings, font sizes, bold/italic, bullet/numbered lists), proposed schedule, venue, and target audience.
* **`FR-EVT-02` (Proposal File Attachment):** Proposal authors shall be able to upload supporting proposal files via drag-and-drop directly into the dedicated Google Drive proposals path (`Academic Term > Proposals > [Proposal Title]`).
* **`FR-EVT-03` (Open Officer Proposal Workspace):** Submitted proposals shall be viewable by all active Officers as a collaborative planning board, with structured review notes/feedback recorded alongside the proposal.
* **`FR-EVT-04` (Executive Review Decisions):** Only `Executive` users shall be able to transition a `Pending Review` proposal to `Needs Revision` (with mandatory feedback), `Approved`, or `Rejected`.
* **`FR-EVT-05` (Proposal Revision Cycle):** When a proposal is marked `Needs Revision`, the author (or an `Executive`) shall be able to update the rich-text body, replace/attach revised files, and resubmit it for `Pending Review`.
* **`FR-EVT-06` (Separate Calendar Publish Gate):** Approved events shall remain internal (`Approved - Unpublished`) by default. Only an `Executive` shall be able to trigger the `Publish` action to make the event visible on the General Members' calendar.
* **`FR-EVT-07` (Event Unpublish & Completion):** Only an `Executive` shall be able to unpublish an event (if postponed/changed) or mark a concluded event as `Completed / Archived`, locking operational mutations.
* **`FR-EVT-08` (Event Calendar View):** The system shall render a filterable calendar view of events. General `Members` shall see only `Published` and `Completed` public events; `Officers` and `Executives` shall see all events filtered by lifecycle status.
* **`FR-EVT-09` (Rich-Text Sanitization):** All rich-text content saved for event proposals shall be sanitized server-side prior to storage and rendering to prevent XSS injection.

### 4.4 Event-Bound Committees
* **`FR-COM-01` (Event-Scoped Committee Creation):** Once an event is created/approved, only an `Executive` shall be able to define custom committees scoped strictly to that single event (e.g., *Logistics*, *Technical*, *Creatives*).
* **`FR-COM-02` (Single-Officer Committee Head Constraint):** Each Event Committee shall be assigned **exactly one** `Committee Head`, restricted strictly to users holding an active `Officer` or `Executive` appointment in the current term. General `Members` shall be ineligible.
* **`FR-COM-03` (No Cross-Event Persistence):** Committee definitions and head assignments shall not carry over automatically to other events.
* **`FR-COM-04` (Contextual Committee Authority):** The assigned `Committee Head` shall automatically receive management permissions (adding officer committee members, creating/assigning tasks, tracking deliverables) restricted strictly to their assigned committee within that event.
* **`FR-COM-05` (Historical Committee Archive):** Completed events shall permanently preserve their exact committee structure, assigned Committee Heads, and committee rosters for institutional reference.

### 4.5 Tasks & Deliverables
* **`FR-TSK-01` (Task Creation):** `Executives` (event-wide or org-wide) and `Committee Heads` (within their assigned event committee) shall be able to create tasks with a title, description, assignee(s), due date, priority, and optional linked document.
* **`FR-TSK-02` (Task Status Tracking):** Assigned officers shall be able to update task progress through defined statuses (`To Do`, `In Progress`, `For Review`, `Done`).
* **`FR-TSK-03` (Deliverable Monitoring):** `Executives` and `Committee Heads` shall be able to view task completion rates and overdue deliverables per event and per committee.
* **`FR-TSK-04` (Personal Officer Task Queue):** Every `Officer` shall have a consolidated view of all tasks currently assigned to them across active events and general operations.
* **`FR-TSK-05` (Task Auditability):** Task assignments, reassignments, due-date changes, and completions shall record actor and timestamp metadata.

### 4.6 Dynamic Attendance & QR Scanning
* **`FR-ATT-01` (Configurable Attendance Checkpoints):** For any Event or Meeting, only an `Executive` (or `Super Admin` via audited break-glass) shall be able to configure, open, or close one or more custom attendance checkpoints dynamically (e.g., single `Check-In`, `Time-In` + `Time-Out`, or multi-session `AM In`, `AM Out`, `PM In`, `PM Out`) with optional open/close time windows.
* **`FR-ATT-02` (QR Code Scanner):** The system shall provide a responsive camera-based QR scanner capable of decoding the student's `student_id_number` from physical university IDs or digital school portal ID QR codes.
* **`FR-ATT-03` (Real-Time Validation & Duplicate Prevention):** Upon scanning a QR code, the system shall validate that the `student_id_number` maps to an `Active` user account, prevent duplicate logging for the same checkpoint, and display immediate visual/audio feedback (Student Name, ID, Timestamp, Status).
* **`FR-ATT-04` (General Member Attendance Authority):** Any active `Officer` or `Executive` shall be permitted to scan and record **initial** attendance for general `Members` at an event checkpoint.
* **`FR-ATT-05` (Officer Attendance Authority):** Recording attendance for users holding an active `Officer` or `Executive` appointment (in both Events and Meetings) shall be restricted strictly to `Executive` accounts. If a non-Executive `Officer` scans another officer's ID during a restricted officer attendance session, the system shall block the write and display an authorization notice.
* **`FR-ATT-06` (Exclusive Executive Editing):** Once an attendance record is created—or when an entry must be manually added/corrected after verification—**only an `Executive`** shall be permitted to modify the record (`Present`, `Late`, `Excused`, `Absent`).
* **`FR-ATT-07` (Mandatory Correction Metadata):** Every manual attendance creation or override by an `Executive` shall require a brief reason and log the previous value, new value, actor ID, and timestamp in the audit log.
* **`FR-ATT-08` (Attendance Export & Summaries):** `Officers` and `Executives` shall be able to filter attendance logs by event, checkpoint, and status, and export structured summary tables (CSV).

### 4.7 Officer Meetings Module (Separate Route Namespace)
* **`FR-MTG-01` (Isolated Module & Configurable Routing):** Officer Meetings shall be implemented as an independent module under its own route namespace (e.g., `/meetings`), decoupled from `/events` so routes can be renamed or relocated via centralized route configuration.
* **`FR-MTG-02` (Executive-Only Scheduling):** Only `Executive` users shall be able to create, reschedule, cancel, or mark Officer Meetings as `Completed`.
* **`FR-MTG-03` (Meeting Agenda & Minutes):** Each Meeting record shall support a rich-text agenda, rich-text Minutes of Meeting, and file attachments routed via Google Drive (`Academic Term > Minutes > General`).
* **`FR-MTG-04` (Meeting Attendance):** Meetings shall reuse the dynamic checkpoint attendance engine (`FR-ATT-01`) restricted strictly to active `Officers`/`Executives`, with recording and editing limited to `Executive` users.
* **`FR-MTG-05` (Internal Visibility):** Officer Meetings and their minutes shall be completely hidden from general `Member` accounts.

### 4.8 Documents & Google Drive Classification
* **`FR-DOC-01` (Direct File Upload):** `Officers` and `Executives` shall be able to upload organizational files (PDF, DOCX, XLSX, PNG/JPG, etc.) directly through SYComP OMS via drag-and-drop or file picker.
* **`FR-DOC-02` (Dynamic Document Types):** Document categories/types shall be stored dynamically (configurable by `Executive`/`Super Admin`) rather than hardcoded into rigid database enums.
* **`FR-DOC-03` (Modular Google Drive Routing Classifier):** The backend shall route uploaded files into Google Drive using a dedicated, easily editable classification module (`resolveDriveFolderPath`) implementing the default hierarchy `Academic Term > Document Type > Event` (with `General` as the default fallback when no event is linked, and `Proposals` for draft event proposals).
* **`FR-DOC-04` (Automatic Folder Traversal & Creation):** Before uploading a file via the Google Drive API, the backend shall check whether each folder in the resolved path exists and automatically create missing nested folders.
* **`FR-DOC-05` (In-App Preview & Drive Link Access):** Stored document records shall persist the Google Drive `file_id`, `webViewLink`, MIME type, uploader, timestamp, and document status (`Draft`, `For Review`, `Submitted`, `Approved`, `Archived`), allowing authorized users to preview or open files directly.
* **`FR-DOC-06` (External Link Fallback):** If direct upload is bypassed or an existing Google Doc/Sheet is used, authorized users shall also be able to register an external Google Drive URL with full metadata and status tracking.

### 4.9 Announcements & Read-Only Member Portal
* **`FR-MEM-01` (Official Announcements):** `Executives` (and optionally authorized `Officers` subject to Phase 4 policy) shall be able to create, edit, publish, and archive official organizational announcements with rich-text formatting and audience targeting (`All Members` vs. `Officers Only`).
* **`FR-MEM-02` (Read-Only Personal Attendance):** Authenticated `Member` users shall be able to view their own historical and current-term attendance records across published events and checkpoints, with zero ability to view other students' records or edit entries.
* **`FR-MEM-03` (Read-Only Event Calendar):** Authenticated `Member` users shall be able to view `Published` SYComP events (title, date/time, venue, public description) in calendar and list formats.
* **`FR-MEM-04` (Read-Only Announcements Feed):** Authenticated `Member` users shall be able to view published public announcements ordered chronologically with pinned/priority indicators.
* **`FR-MEM-05` (Strict Member Isolation):** `Member` accounts shall be denied API and UI access to officer proposals, unpublished events, internal meetings, committee tasks, document tracking tables, and audit logs.

### 4.10 Dashboards, Reporting & Audit Logging
* **`FR-AUD-01` (Role-Aware Operational Dashboard):** Upon login, users shall see a dashboard tailored to their system tier:
  * *Executive/Super Admin:* Pending event proposals, active events, overdue committee deliverables, upcoming meetings, and recent audit highlights.
  * *Officer:* Assigned tasks, active committee roles, open proposals, and quick-launch attendance scanner.
  * *Member:* Upcoming published events, latest announcements, personal attendance summary, and email/password security prompt (if incomplete).
* **`FR-AUD-02` (Immutable Audit Trail):** The system shall automatically write append-only audit entries (`actor_id`, `action`, `entity_type`, `entity_id`, `before_state`, `after_state`, `reason`, `timestamp`) for all high-impact operations: proposal approvals/rejections, event publishing, committee head assignments, attendance overrides, account disabling, masterlist imports, and term rollovers.
* **`FR-AUD-03` (Audit Log Inspection):** Only `Super Admin` and `Executive` users shall be able to search and filter audit logs by actor, action type, entity, and date range.
* **`FR-AUD-04` (Term & Event Summary Reports):** `Executives` shall be able to generate summary snapshots per event or per academic term showing total attendance counts, officer participation, committee completion rates, and linked documents.
* **`FR-AUD-05` (Data Integrity Enforcement):** All mutations shall enforce referential integrity and state-transition rules server-side, never relying solely on frontend button visibility.

---

## 5. Non-Functional Requirements (NFRs)

### 5.1 Security & Privacy
* **`NFR-SEC-01` (Password Security):** All passwords—including auto-provisioned default credentials—shall be hashed using a memory-hard adaptive algorithm: Node.js native `crypto.scrypt` (`N=16384`, `r=8`, `p=1`, `keylen=64`, versioned storage format) as the serverless-safe primary standard (or `Argon2id` if migrated off serverless).
* **`NFR-SEC-02` (Server-Side Authorization):** Every API endpoint and server action shall enforce RBAC checks across all three layers (Global System Tier, Account Active Status, and Event Committee Head ownership).
* **`NFR-SEC-03` (Input & Rich-Text Security):** Rich-text inputs shall pass through a strict HTML allowlist sanitizer before storage/rendering; all database queries shall use parameterized statements/ORM bindings.
* **`NFR-SEC-04` (OTP & Recovery Limits):** Password reset and email verification OTPs shall expire within 10–15 minutes, be single-use, and be rate-limited against brute-force attempts.
* **`NFR-SEC-05` (Credential & Token Protection):** Google Drive API OAuth2 credentials (`client_secret`, `refresh_token`) and HMAC signing secrets shall reside strictly on the server environment and never be exposed to client bundles.

### 5.2 Performance & Responsiveness
* **`NFR-PERF-01` (QR Scan Responsiveness):** From QR decode to visual confirmation on campus Wi-Fi or 4G mobile data, attendance logging shall complete in under **1.5 seconds** (95th percentile).
* **`NFR-PERF-02` (Page Load & Navigation):** Core dashboard and directory views shall achieve interactive load times under **2.5 seconds** on standard mobile and desktop browsers.
* **`NFR-PERF-03` (Bulk Provisioning Throughput):** Masterlist imports of up to **1,000 student records** shall complete reliably in a batched transaction/job with clear row-level validation reporting.

### 5.3 Reliability & External Integration Resilience
* **`NFR-REL-01` (Google Drive Fault Isolation):** Temporary Google Drive API outages or quota errors shall return actionable error messages without leaving orphaned database metadata records (transactional upload-then-persist or cleanup on failure).
* **`NFR-REL-02` (Database Consistency):** Foreign-key constraints, unique composite indexes (e.g., `(checkpoint_id, user_id)` on attendance), and soft-disable flags shall prevent duplicate scans and broken historical references.

### 5.4 Usability & Compatibility
* **`NFR-USAB-01` (Mobile-First Attendance & Member Views):** The QR attendance scanner and the read-only Member Portal shall operate smoothly on mobile browsers (iOS Safari, Android Chrome) with camera permission handling.
* **`NFR-USAB-02` (Accessible Rich-Text Editing):** The proposal and minutes editor shall provide an intuitive WYSIWYG toolbar without requiring officers to write raw Markdown or HTML.

### 5.5 Maintainability & Extensibility
* **`NFR-MAINT-01` (Modular Routing & Classification):** Application routes (`/events`, `/meetings`, etc.) and Google Drive folder routing logic (`resolveDriveFolderPath`) shall be centralized in isolated configuration/service modules for low-friction updates by future technical officers.
* **`NFR-MAINT-02` (Documentation Parity):** Codebase modules, database migrations, and environment setup instructions shall remain synchronized with the `docs/` repository.

---

## 6. Core Use Cases

### `UC-01`: Automated Masterlist Provisioning & First Member Login
* **Actors:** `Super Admin`, `Member`
* **Preconditions:** An `Active` Academic Term exists; official student CSV (`Student ID`, `Full Name`) is prepared.
* **Main Flow:**
  1. `Super Admin` uploads the masterlist CSV.
  2. System validates formatting, creates new `Member` accounts (`Active`) with default hashed passwords (`lastname + ID`), skips existing active IDs, and lists any missing/duplicate records for review.
  3. A student navigates to SYComP OMS and logs in with `Student ID` and `lastname + ID`.
  4. System grants read-only Member Portal access and prompts the student to bind their university email and change their password.
  5. Student enters their university email, verifies via OTP, and sets a personal password.
* **Alternate Flow:** If a student's account was soft-disabled (`Transferred`), login is blocked with a message directing them to SYComP officers.

### `UC-02`: Event Proposal Drafting, Revision, Approval & Publishing
* **Actors:** `Officer` (Author), `Executive`
* **Preconditions:** Both actors are authenticated in the active term.
* **Main Flow:**
  1. `Officer` creates an Event Proposal using the rich-text editor and drags/drops a proposal DOCX/PDF.
  2. Backend auto-creates/locates `Academic Term > Proposals > [Proposal Title]` in Google Drive, uploads the file, and saves the proposal as `Pending Review`.
  3. `Executive` reviews the proposal and marks it `Needs Revision` with notes.
  4. `Officer` edits the rich text / uploads a revised file and resubmits (`Pending Review`).
  5. `Executive` marks the proposal `Approved` (event remains unpublished/internal).
  6. `Executive` configures Event Committees and assigns one `Officer` as `Committee Head` per committee.
  7. Once ready for students, `Executive` clicks `Publish`; event appears on the General Member calendar.

### `UC-03`: Dynamic Multi-Session QR Attendance Recording
* **Actors:** `Officer` (Scanner), `Executive`, `Member`
* **Preconditions:** Event is `Published` and has configured checkpoints (`AM In`, `AM Out`, `PM In`, `PM Out`).
* **Main Flow:**
  1. `Officer` opens the event's active checkpoint (`AM In`) scanner on a mobile device.
  2. Student presents their physical university ID (or university portal QR).
  3. Scanner decodes `student_id_number`, verifies `Active` status, confirms no existing record for `AM In`, and writes the attendance entry.
  4. UI flashes green confirmation with the student's full name and timestamp.
* **Alternate Flow A (Duplicate Scan):** System displays an amber warning showing the original check-in timestamp and prevents duplicate insertion.
* **Alternate Flow B (Officer Attendance):** During an officer attendance checkpoint, if a regular `Officer` attempts to scan another officer, the system rejects the write; an `Executive` logs in and records officer attendance successfully.

### `UC-04`: Executive Attendance Correction
* **Actors:** `Executive`, `Member` (in person)
* **Preconditions:** Student noticed a missing/incorrect record in their read-only portal and approached an `Executive` offline.
* **Main Flow:**
  1. `Executive` locates the event checkpoint and the student's record.
  2. `Executive` adds or updates the status (e.g., `Absent` to `Present` or `Excused`) and enters a verification reason.
  3. System updates the attendance record and appends an immutable audit log entry.
  4. Student refreshes their read-only portal and sees the updated status.

### `UC-05`: Officer Meeting Scheduling & Archiving
* **Actors:** `Executive`, `Officer`
* **Preconditions:** Authenticated `Executive` in `/meetings` module.
* **Main Flow:**
  1. `Executive` creates a new Meeting with title, date/time, venue, rich-text agenda, and attendance checkpoint(s).
  2. During the meeting, `Executive` records officer attendance via QR scan or officer roster.
  3. Post-meeting, Minutes of Meeting (rich text and/or uploaded file) are saved and routed to `Academic Term > Minutes > General`.
  4. `Executive` marks the meeting `Completed`.

### `UC-06`: Classified Document Upload via Google Drive
* **Actors:** `Officer` or `Executive`
* **Preconditions:** Google Drive API integration is configured; active Academic Term exists.
* **Main Flow:**
  1. User selects a Document Type (e.g., `Communication Letters`), optionally links an Event, sets initial status (`Draft`), and uploads a file.
  2. Backend invokes `resolveDriveFolderPath(term, docType, event?)` to resolve either `Term > DocType > Event` or `Term > DocType > General`.
  3. Backend ensures folder hierarchy exists in Google Drive, uploads the file, and stores metadata + `webViewLink`.
  4. Authorized officers view and preview the file directly from SYComP OMS.

---

## 7. Acceptance Criteria (Version 1 Sign-Off)
* **`AC-01`:** Importing a test CSV of 100 students creates 100 `Member` accounts login-ready via `Student ID` + `lastname + ID`, and re-importing the same CSV creates **0** duplicates.
* **`AC-02`:** A `Member` account attempting to access any officer API route (`/proposals`, `/meetings`, `/committees`, `/audit-logs`, or another student's attendance) receives HTTP `403 Forbidden`.
* **`AC-03`:** An `Officer` can draft a rich-text proposal with a file upload routed to `Academic Term > Proposals > [Title]`, but cannot approve or publish it (HTTP `403`).
* **`AC-04`:** An `Approved` event does not appear on the `Member` calendar until an `Executive` executes the explicit `Publish` action.
* **`AC-05`:** Assigning a General `Member` as a `Committee Head` is rejected by backend validation; assigning an active `Officer` grants committee management strictly within that single event committee.
* **`AC-06`:** Scanning a physical/test QR code logs attendance to the selected dynamic checkpoint in under 1.5 seconds and blocks duplicate scans for the same checkpoint.
* **`AC-07`:** A non-Executive `Officer` cannot edit an existing attendance record and cannot record officer-level attendance; an `Executive` edit succeeds and produces an audit log entry containing before/after values and reason.
* **`AC-08`:** Soft-disabling a graduated officer blocks their login while keeping their past term appointments, authored proposals, and historical attendance intact.
* **`AC-09`:** Uploading a document linked to an event places it inside `Academic Term > Document Type > Event` in Google Drive, while an unlinked document routes to `Academic Term > Document Type > General`.