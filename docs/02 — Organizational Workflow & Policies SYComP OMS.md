## 1. Document Identity
* **Document ID:** `02-organizational-workflow-and-policies.md`
* **System:** SYComP Organizational Management System (SYComP OMS)
* **Document Status:** v1.0 — Approved Baseline
* **Phase:** Phase 2 — Operational Analysis & Policy Definition (Completed)
* **Dependencies:** [[00 — Project Charter SYComP Organizational Management System]]

---

## 2. Purpose
This document defines how the Society of Young Computer Professionals (SYComP) operates in practice and translates those organizational processes into enforceable system workflows, state transitions, and governance policies. It serves as the direct behavioral input for **`01-requirements-specification.md`** and **`03-domain-model-and-data-dictionary.md`**.

---

## 3. Core Organizational Policies

### Policy 1: Separation of Governance Authority
* **Executive Governance (`Executive` Tier — Faculty Adviser, President, VP Internal, VP External):** Holds exclusive authority to approve event proposals, publish events to the member calendar, define event committees, appoint Committee Heads, schedule officer meetings, record officer attendance, and edit/correct any attendance log.
* **Operational Execution (`Officer` Tier):** Can draft event proposals, view organizational records, manage assigned tasks/documents, and scan/record **initial** general member attendance during events.
* **System Custody (`Super Admin` Tier — Technical Team):** Holds exclusive administrative control over academic term transitions, bulk masterlist provisioning, user account soft-disabling/reactivation, and system-level configuration.

### Policy 2: Non-Destructive Record Retention (Soft-Disable Rule)
* User accounts, historical officer appointments, event records, and attendance logs **must never be hard-deleted** once linked to operational data.
* Graduated officers, shifted students, inactive members, or duplicate masterlist records are handled via an account status / `is_disabled` flag (`Active`, `Disabled / Transferred`) controlled by the `Super Admin`.
* Disabling an account revokes login access and hides the user from active event selection lists while preserving all historical foreign-key relationships intact.

### Policy 3: Dynamic Attendance Sessions
* Attendance structures vary per event or meeting and are **never hardcoded** to a single check-in model.
* When configuring an event or meeting, the organizer defines one or more **Attendance Checkpoints/Sessions** based on the activity's schedule:
  * *Single Check-In:* e.g., `Attendance` (In only)
  * *Standard Session:* e.g., `Time-In` and `Time-Out`
  * *Whole-Day Split Session:* e.g., `Morning In`, `Morning Out`, `Afternoon In`, `Afternoon Out`
* Physical student IDs (or digital student ID QR codes from the university portal) serve as the primary scan identifier (`student_id_number`).

### Policy 4: Direct-Edit Attendance Correction (No In-App Dispute Queue)
* SYComP OMS does **not** maintain an in-app student dispute ticketing workflow in v1.
* General members view their attendance status via their read-only portal. If a discrepancy occurs, the student approaches an `Executive` directly, who verifies the claim and edits the attendance record with full audit logging.

### Policy 5: Modular Document Classification & Storage
* Uploaded files are stored directly in Google Drive via the Google Drive API and indexed in SYComP OMS.
* Folder routing follows a hierarchical path (`Academic Term > Document Type > Event / General`), implemented through an isolated, easily configurable classification strategy/resolver in the backend so routing rules can be extended without refactoring core upload logic.

---

## 4. Operational Workflows

### Workflow 1: Event Lifecycle (Proposal $\rightarrow$ Approval $\rightarrow$ Publish $\rightarrow$ Archive)

#### Actors
* **Initiator:** Any `Officer` (or `Executive`)
* **Approver & Publisher:** `Executive` (`Faculty Adviser`, `President`, `VP Internal`, `VP External`)

#### State Flow
`Draft` $\rightarrow$ `Pending Review` $\rightarrow$ `Needs Revision` $\leftrightarrow$ `Pending Review` $\rightarrow$ `Approved (Unpublished)` $\rightarrow$ `Published` $\rightarrow$ `Completed / Archived` *(or `Rejected`)*

#### Step-by-Step Procedure
1. **Proposal Creation:** An Officer creates a new event proposal containing:
   * Event Title and structured **Rich-Text Description** (supporting headers, font sizing, lists, and formatting).
   * Optional **Proposal File Attachment** (drag-and-drop upload stored in Google Drive under the dedicated proposals folder: `Academic Term > Proposals > [Proposal Title]`).
   * Proposed dates, venue, and target audience.
2. **Open Officer Review & Revision:** Submitted proposals are visible to officers as a collaborative planning workspace. Executives review the proposal and either:
   * Return it as **`Needs Revision`** with feedback so the author can refine the rich text or re-upload a revised file.
   * Mark it as **`Approved`** (remains internal and hidden from the General Member calendar).
   * Mark it as **`Rejected`** (archived for historical reference).
3. **Committee Structuring (Post-Approval):** Once approved, an `Executive` defines the event-specific committees (e.g., *Logistics*, *Technical*, *Creatives*, *Documentation*) and assigns exactly **one `Officer`** as `Committee Head` per committee.
4. **Calendar Publishing (Explicit Executive Gate):** When event details are finalized and ready for public visibility, an `Executive` triggers **`Publish`**. Only `Published` events appear on the General Members' event calendar and trigger member announcements.
5. **Execution & Completion:** Officers conduct event operations and attendance tracking. After the event concludes, an `Executive` marks the event **`Completed`**, locking operational edits while preserving records in the archive.

---

### Workflow 2: Attendance Operations & Verification

#### Actors
* **General Member Recorder:** Any `Officer` (initial scan/recording only)
* **Officer Attendance Recorder & Global Editor:** `Executive` only

#### Step-by-Step Procedure
1. **Checkpoint Configuration:** Before the event/meeting starts, an `Executive` (or authorized event lead) configures the active attendance checkpoints (e.g., `AM In`, `AM Out`, `PM In`, `PM Out`).
2. **Live QR Scanning:**
   * Officers open the event's active checkpoint scanner on mobile or desktop.
   * Scanning a student's physical ID card (or university portal ID QR) extracts the `student_id_number`.
   * The system matches the `student_id_number` against `Active` masterlist records, validates against duplicate scans for that same checkpoint, and logs the timestamp + recording officer ID.
   * *Constraint:* If the scanned ID belongs to a SYComP Officer and the session is an **Officer Attendance** log, the system restricts recording strictly to `Executive` accounts.
3. **Post-Recording Edits & Corrections:**
   * Once recorded (or if a student missed a scan and verified their presence in person), **only an `Executive`** can manually add, modify, or override an attendance entry (`Present`, `Late`, `Excused`, `Absent`).
   * Every manual edit logs the `edited_by` Executive ID, timestamp, previous value, and reason in the audit trail.

---

### Workflow 3: Officer Meeting Management (Separate Module)

#### Actors
* **Organizer & Attendance Recorder:** `Executive` only
* **Participants:** SYComP Officers

#### State Flow
`Scheduled` $\rightarrow$ `Ongoing` $\rightarrow$ `Completed` *(or `Cancelled`)*

#### Step-by-Step Procedure
1. **Scheduling:** An `Executive` creates a standalone Meeting record (separate from public/member Events) specifying title, date/time, location/link, agenda (rich text), and attendance checkpoints.
2. **Attendance Logging:** During the meeting, an `Executive` records officer attendance (via QR scan or executive checklist).
3. **Minutes & Archiving:** Post-meeting, the Secretary or an Executive attaches the **Minutes of Meeting** (rich text and/or uploaded file routed to `Academic Term > Minutes > General`) and marks the meeting **`Completed`**.

---

### Workflow 4: Document Upload & Google Drive Classification

#### Actors
* **Uploader:** `Officer` or `Executive`
* **Approver (where applicable):** `Executive`

#### Folder Routing Standard
Files uploaded to SYComP OMS are routed automatically via a modular backend classifier (`resolveDriveFolderPath(academicTerm, documentType, event?)`):

```text
SYComP OMS Root/
└── [Academic Term e.g., AY 2026-2027 - 1st Sem]/
    ├── Proposals/
    │   └── [Event / Proposal Name]/
    └── [Document Type e.g., Communication Letters, Reports, Minutes, Forms]/
        ├── [Event Name]/        <-- When linked to a specific Event
        └── General/             <-- Fallback when not tied to an Event
        
```

Note: Document types are stored dynamically (not locked to a rigid database enum) and mapped through a clean switch/resolver module so future technical directors can adjust folder routing rules easily.

### Workflow 5: Masterlist Provisioning & Term Transitions

#### Actors
- **Administrator:** `Super Admin` (Technical Director)
- **End User:** `Member` (General Computing Student
#### Step-by-Step Procedure

1. **Start-of-Term Masterlist Import:** The `Super Admin` uploads the official computing student list (`Student ID` + `Full Name`).
    - **New Students:** System auto-provisions a `Member` account with username = `student_id_number`, initial password = `lastname + student_id_number` (hashed), and status = `Active`.
    - **Existing Active Students:** Account remains intact and active; no duplicate account is created.
    - **Students Missing from New Masterlist (Shifted/Graduated):** Flagged for `Super Admin` review to transition to `Disabled` without deleting historical attendance records.
2. **First-Time Member Login & Email Binding:**
    - Student logs in immediately using `Student ID` and `lastname + ID`.
    - Dashboard prompts the student to bind their **University Email** and update their password.
    - Once bound and verified via email OTP/code, the university email enables self-service **Forgot Password** recovery and announcement notifications.
3. **Officer Term Rollover:**
    - At the end of an academic term, the `Super Admin` closes the outgoing `Academic Term` (archiving outgoing officer appointments as historical records), opens the new `Academic Term`, creates new officer appointments, and updates system tiers (`Executive`, `Officer`, `Member`) accordingly.

## 5. Summary of Operational Constraints for Engineering

1. **Rich-Text Editor:** Required for Event Proposals, Meeting Agendas/Minutes, and Announcements (must sanitize HTML/Markdown output against XSS).
    
2. **QR Scanner Integration:** Browser-based camera QR reader (`html5-qrcode` or equivalent) capable of fast continuous scanning of university ID numbers.
    
3. **Google Drive Service Integration:** Backend wrapper handling folder-exists/auto-create traversal, direct multipart file upload, permission management, and webViewLink previewing.
    
4. **Route Separation:** `Events` and `Meetings` must live under distinct route namespaces (e.g., `/events` and `/meetings`) with clean routing configuration so navigation paths can be adjusted effortlessly.
