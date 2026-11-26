## 1. Document Identity
* **Document ID:** `02b-business-rules-and-workflows.md`
* **System:** SYComP Organizational Management System (SYComP OMS)
* **Document Status:** v1.0 — Approved Baseline
* **Phase:** Phase 4 — Business Rules & Workflow Design
* **Dependencies:** [[00 — Project Charter SYComP Organizational Management System]], [[01 — Requirements Specification SYComP Organizational Management System]], [[02 — Organizational Workflow & Policies SYComP OMS]]

---

## 2. System-Wide Invariants (`BR-SYS`)
These rules apply globally across every module and must be enforced at the service/database layer—never solely in the UI.

* **`BR-SYS-01` (Single Active Term):** Exactly one Academic Term may have status `Active` at any given time. All new operational records (events, meetings, officer appointments, documents) default to the active term.
* **`BR-SYS-02` (Non-Destructive Retention):** User accounts, historical officer appointments, closed academic terms, completed events, and attendance logs shall never be hard-deleted. Deactivation uses status flags (`Disabled`, `Archived`, `Cancelled`).
* **`BR-SYS-03` (3-Layer Authorization Precedence):** Access checks evaluate in strict order:
  1. Account must be `Active` (`Disabled` accounts fail immediately with `403`).
  2. Global System Tier (`Super Admin` -> `Executive` -> `Officer` -> `Member`).
  3. Event-Scoped Context (`Committee Head` grants scoped write permissions strictly inside that specific committee).
* **`BR-SYS-04` (Mandatory Audit Trail):** Every state transition, approval, override, attendance edit, account status change, or role change writes an append-only audit entry containing `actor_id`, `action`, `entity_type`, `entity_id`, `before_state`, `after_state`, optional/mandatory `reason`, and `timestamp`.
* **`BR-SYS-05` (Historical Immutability):** Once an Academic Term is `Closed` or an Event/Meeting is `Completed`, operational mutations (tasks, committees, attendance scans) are locked. Only a `Super Admin` or `Executive` override with a logged audit reason may correct historical attendance or archive metadata.

---

## 3. Module Workflows & State Transition Matrices

### 3.1 Academic Terms & Account Lifecycle (`BR-TERM`, `BR-ACCT`)

#### Term State Machine
```text
Draft --> Active --> Closed
- **`BR-TERM-01`:** Only `Super Admin` may create, activate, or close an Academic Term.
    
- **`BR-TERM-02`:** Activating a `Draft` term automatically requires the previous `Active` term to be `Closed` inside a single atomic rollover workflow.
    
- **`BR-TERM-03`:** Closing a term freezes all Officer Appointments tied to that term as immutable historical records and reverts non-reappointed officers' global tier back to `Member` (or `Disabled` if graduated/shifted).
  
  
````

#### User Account Lifecycle State Machine
```
Needs Review <--> Active <--> Disabled
```

- **`BR-ACCT-01` (Default Credential Normalization):** Auto-provisioned accounts set `username = student_id_number` and hash the default password using a deterministic normalization rule:
    
    - Strip whitespace and punctuation from the student's surname, convert to lowercase, and concatenate with `student_id_number` (e.g., `"De La Cruz"` + `"2024-01234"` -> `"delacruz2024-01234"`).
        
    - Mark `must_change_password = true` so the user is prompted to bind a university email and update their password upon login.
        
- **`BR-ACCT-02` (Duplicate & Discrepancy Handling):** Re-importing a masterlist matches strictly on `student_id_number`. Matching active accounts are skipped; missing previously active accounts are flagged `Needs Review` for `Super Admin` confirmation before transitioning to `Disabled`.
    
- **`BR-ACCT-03` (Recovery Precondition):** Password reset via OTP is permitted only if `university_email` is present and `email_verified_at` is non-null. Unverified accounts that forgot their password must request a reset from `Super Admin`.

### 3.2 Event Proposal & Lifecycle (`BR-EVT`)

#### State Machine

Plaintext

```
Draft --> Pending Review <--> Needs Revision
                |
                +--> Rejected (Terminal)
                |
                +--> Approved (Unpublished) <--> Published --> Completed (Archived)
```

#### Transition Matrix

|**Current State**|**Action**|**Allowed Actor**|**Guard Conditions**|**Next State**|**Side Effects**|
|---|---|---|---|---|---|
|_(None)_|Create Proposal|`Officer`, `Executive`|Active term exists; title + rich-text body provided.|`Draft`|Optional file uploaded to `Term > Proposals > [Title]`.|
|`Draft`|Submit for Review|Author, `Executive`|Required metadata (title, description, proposed date) complete.|`Pending Review`|Visible in open Officer Proposal Workspace.|
|`Pending Review`|Request Revision|`Executive`|Mandatory revision feedback note provided.|`Needs Revision`|Audit log recorded; author notified in dashboard.|
|`Needs Revision`|Resubmit|Author, `Executive`|Proposal updated (text and/or revised file).|`Pending Review`|Revision counter incremented; audit logged.|
|`Pending Review`|Reject|`Executive`|Mandatory rejection reason provided.|`Rejected`|Locked read-only for historical archive.|
|`Pending Review`|Approve|`Executive`|None.|`Approved`|Unlocks Event Committee & Checkpoint setup; remains hidden from Members.|
|`Approved`|Publish|`Executive`|Confirmed event date, venue, and public summary exist.|`Published`|Appears on General Member Calendar; audit logged.|
|`Published`|Unpublish|`Executive`|Mandatory reason (e.g., postponement); event not `Completed`.|`Approved`|Hidden from Member Calendar; existing attendance/committees preserved.|
|`Published`|Complete / Archive|`Executive`|All open attendance checkpoints closed.|`Completed`|Locks operational edits; preserves committees, tasks, docs, and attendance.|

- **`BR-EVT-01` (Proposal Workspace Visibility):** `Draft` proposals are visible only to their author and `Executives`. Once `Pending Review` or later, proposals are visible to all active `Officers`.
    
- **`BR-EVT-02` (Rich-Text Sanitization):** Proposal descriptions are sanitized server-side against an HTML allowlist before persistence.
    

### 3.3 Event-Bound Committees & Tasks (`BR-COM`, `BR-TSK`)

#### Committee Rules

- **`BR-COM-01` (Creation Gate):** Committees may only be created on events in `Approved` or `Published` status, and only by an `Executive`.
    
- **`BR-COM-02` (Single Active Officer Head):** Every Event Committee must have **exactly one** `Committee Head`. The assigned user must hold an active `Officer` or `Executive` appointment in the current term (`Member` accounts are rejected by backend validation).
    
- **`BR-COM-03` (Zero Cross-Event Carryover):** Committees belong exclusively to one `event_id`. No automatic cloning or inheritance occurs between events.
    
- **`BR-COM-04` (Committee Roster):** A `Committee Head` (within their own committee) or an `Executive` (across any committee) may assign active `Officers` as committee members to help execute tasks.
    
- **`BR-COM-05` (Head Reassignment):** Only an `Executive` may transfer a committee's `Committee Head` role to another active `Officer`. Previous assignment history is preserved in the audit log.
    

#### Task State Machine

Plaintext

```
To Do --> In Progress --> For Review --> Done
  ^            |              |           |
  +------------+--------------+-----------+  (Reopen / Return)
```

#### Task Rules

- **`BR-TSK-01` (Creation & Override Scope):**
    
    - **Event Committee Tasks:** May be created, reassigned, edited, or overridden by the committee's `Committee Head` **or any `Executive`**.
        
    - **General / Event-Wide Tasks (No Committee):** May be created and managed by `Executives` only.
        
- **`BR-TSK-02` (Status Transitions):** Assigned officers may move their own tasks between `To Do`, `In Progress`, and `For Review`. Marking a task `Done` (or returning `For Review` -> `In Progress`) is permitted by the committee's `Committee Head` or any `Executive`.
    
- **`BR-TSK-03` (Completion Lock):** When the parent event transitions to `Completed`, all remaining incomplete tasks are frozen in their final state for post-event accountability reporting.
    

### 3.4 Dynamic Attendance & QR Scanning (`BR-ATT`)

#### Checkpoint State Machine

Plaintext

```
Scheduled --> Open --> Closed
```

- **`BR-ATT-01` (Dynamic Checkpoint Setup):** An `Executive` (or authorized event organizer) defines 1 to N checkpoints per Event or Meeting (e.g., `Single Check-In`, `In`/`Out`, or `AM In`/`AM Out`/`PM In`/`PM Out`).
    
- **`BR-ATT-02` (Scanning Window):** QR scans are accepted only when a checkpoint is `Open`. An `Executive` may still record manual overrides when `Closed` (prior to event completion, or via audited override afterward).
    
- **`BR-ATT-03` (Uniqueness Invariant):** A user may have at most **one** attendance record per checkpoint (`UNIQUE(checkpoint_id, user_id)`). Subsequent scans return a non-destructive duplicate warning displaying the original timestamp.
    

#### Actor vs. Subject Authorization Matrix (Strict Enforcement)

|**Recording Actor**|**Target Subject**|**Operation**|**Allowed?**|**Rule**|
|---|---|---|---|---|
|`Officer`|`Member` (General Student)|Initial QR Scan (`Event` checkpoint)|**Yes**|Standard event check-in (`BR-ATT-04`).|
|`Officer`|`Officer` / `Executive`|Initial QR Scan (`Event` or `Meeting`)|**No (`403`)**|Officer attendance is Executive-only (`BR-ATT-05`).|
|`Officer`|Any User|Edit / Override existing attendance|**No (`403`)**|Edits are Executive-only (`BR-ATT-06`).|
|`Executive`|`Member`|Initial Scan OR Manual Add/Edit|**Yes**|Manual edits require `reason` + audit log.|
|`Executive`|`Officer` / `Executive`|Initial Scan OR Manual Add/Edit|**Yes**|Applies to both Events and Officer Meetings.|

- **`BR-ATT-07` (Disabled Account Scan Guard):** If a scanned `student_id_number` matches a `Disabled` account, the scanner blocks logging and displays a clear warning (`"Account Disabled — Verify with Executive / Super Admin"`).
    
- **`BR-ATT-08` (Mandatory Override Reason):** Any manual status change (`Present`, `Late`, `Excused`, `Absent`) by an `Executive` requires a non-empty `reason` string stored in the audit trail.
    

### 3.5 Officer Meetings Module (`BR-MTG`)

#### State Machine

Plaintext

```
Scheduled --> Ongoing --> Completed
    |
    +--> Cancelled (Terminal)
```

- **`BR-MTG-01` (Module & Visibility Isolation):** Meetings live under an isolated route namespace (`/meetings`) and are completely inaccessible (`403`) to `Member` accounts.
    
- **`BR-MTG-02` (Executive-Only Scheduling):** Only `Executive` users may create, edit schedule details, start (`Ongoing`), cancel (`Cancelled`), or complete (`Completed`) a Meeting.
    
- **`BR-MTG-03` (Meeting Attendance):** Meetings reuse the dynamic checkpoint engine restricted strictly to active `Officers` and `Executives`, with recording and editing limited to `Executive` accounts.
    
- **`BR-MTG-04` (Minutes Attachment):** Rich-text Minutes of Meeting and/or uploaded files (routed to `Academic Term > Minutes > General`) may be attached by an `Executive` or an active `Officer` (e.g., Secretary) before the meeting is marked `Completed`.
    

### 3.6 Documents & Google Drive Classification (`BR-DOC`)

#### State Machine

Plaintext

```
Draft --> For Review --> Submitted --> Approved --> Archived
              ^              |
              +--------------+ (Returned for Revision)
```

- **`BR-DOC-01` (Dynamic Document Types):** Document types are managed as database records (`document_types`) configurable by `Executive` and `Super Admin`, rather than fixed enums.
    
- **`BR-DOC-02` (Modular Folder Routing Contract):** All direct uploads pass through a centralized backend resolver:
    
    Plaintext
    
    ```
    resolveDriveFolderPath({ academicTerm, documentType, event?, isProposal })
      - If isProposal == true   -> [AcademicTerm] / "Proposals" / [ProposalTitle]
      - Else if event != null   -> [AcademicTerm] / [DocumentType] / [EventTitle]
      - Else                    -> [AcademicTerm] / [DocumentType] / "General"
    ```
    
    _Implemented as an isolated strategy/switch module so routing conventions can be modified in one file without touching upload endpoints._
    
- **`BR-DOC-03` (Atomic Upload Guarantee):** The backend must confirm Google Drive folder creation and file upload (`file_id` + `webViewLink` returned) before committing the document metadata row to the database. If DB insertion fails afterward, a compensating cleanup deletes or flags the orphaned Drive upload.
    
- **`BR-DOC-04` (Approval Authority):** Any `Officer` may upload documents (`Draft` / `For Review`), while transitioning a document to `Approved` or `Archived` is restricted to `Executive`.
    

### 3.7 Announcements (`BR-ANN`)

#### State Machine

Plaintext

```
Draft --> Published --> Archived
```

- **`BR-ANN-01` (Executive-Only Publishing):** Only `Executive` users may transition an announcement to `Published`, edit an already-published announcement, or `Archive` it.
    
- **`BR-ANN-02` (Drafting Support):** `Officers` may optionally prepare `Draft` announcements (e.g., publicity copy drafted by PRO/Creatives) for Executive review, or `Executives` may author and publish directly. Drafts are never visible to General `Members`.
    
- **`BR-ANN-03` (Audience Scoping):** Every announcement specifies `audience`:
    
    - `ALL_MEMBERS`: Visible on both the Officer Workspace and the read-only Member Portal once `Published`.
        
    - `OFFICERS_ONLY`: Visible exclusively to active `Officers`, `Executives`, and `Super Admin`.
        

## 4. Edge-Case Resolution Matrix

| **Edge Case**                                                          | **System Behavior & Policy**                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Officer is soft-disabled mid-event while holding `Committee Head`**  | Account loses login immediately; `Executive` receives a warning banner on the event dashboard prompting Head reassignment (`BR-COM-05`). Historical tasks authored/completed by them remain attributed intact. |
| **Event is unpublished after some attendance was already logged**      | Event is hidden from Member Calendar (`Published` -> `Approved`); existing attendance records remain preserved in DB and are not deleted.                                                                      |
| **Student surname has multiple words or special characters**           | Default password normalizer strips spaces/hyphens/apostrophes and lowercases surname before appending `student_id_number` (`BR-ACCT-01`) so credentials are predictable across imports.                        |
| **Officer scans their own ID or another officer's ID during an Event** | Backend detects target user holds an active `Officer`/`Executive` appointment; if the scanner is a regular `Officer`, returns `403` (`"Officer attendance must be recorded by an Executive"`).                 |
| **Google Drive folder is renamed manually inside Drive**               | Backend caches Google Drive `folder_id` mappings (or resolves by stored ID first, falling back to path lookup) so manual label tweaks do not break existing file links.                                        |
| **Masterlist CSV contains duplicate `student_id_number` rows**         | Import validator flags duplicates in a pre-commit preview report and blocks duplicate insertion until resolved.                                                                                                |