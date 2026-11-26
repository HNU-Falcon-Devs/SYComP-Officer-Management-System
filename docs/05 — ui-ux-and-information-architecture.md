## 1. Document Identity

- **Document ID:** `05-ui-ux-and-information-architecture.md`
    
- **System:** SYComP Organizational Management System (SYComP OMS)
    
- **Document Status:** v1.0 — Draft Baseline
    
- **Phase:** Phase 7 — UI/UX & Information Architecture
    
- **Repository Path:** `docs/05-ui-ux-and-information-architecture.md`
    
- **Dependencies:** [[00 — Project Charter SYComP Organizational Management System]], [[01 — Requirements Specification SYComP Organizational Management System]], [[02 — Organizational Workflow & Policies SYComP OMS]], [[02b — Business Rules & Workflow Design SYComP OMS]], [[03 — Domain Model & Data Dictionary SYComP OMS]], [[04 — Roles, Permissions & Security]]]
    

## 2. Design Philosophy & Visual Identity

### 2.1 Core Aesthetic Direction

SYComP OMS adopts a **Modern Clean SaaS** design language built on **Shadcn/ui** primitives and Tailwind CSS design tokens, paired with high-discipline UI implementation guidelines (compatible with the `impeccable` UI engineering workflow):

  

- **Purposeful Restraint:** Crisp 1px borders, clean surface elevation, structured grids, and clear typographic hierarchy over decorative clutter.
    
- **Brand Continuity:** Anchored in the official SYComP visual identity—combining deep graphite-charcoal surfaces with signature amethyst/lavender-violet accents.
    
- **Strict Iconography Rule (Zero Emojis):** Emojis are **strictly prohibited** across all UI surfaces (navigation items, buttons, status badges, callouts, empty states, toasts, and headings). Every icon must use **`lucide-react`** with consistent stroke weight (`1.75px` default, `16px` inline, `20px` navigation/buttons).
    
- **Dual Theme Support:** Full **Light Mode** and **Dark Mode** support via CSS custom properties, defaulting to the user's OS preference with a persistent manual theme toggle (`Light` / `Dark` / `System`) accessible from every shell header.
    

### 2.2 SYComP Brand Color System (Light & Dark Tokens)

Color tokens are derived directly from the official SYComP banner—its charcoal-slate base, dark violet-tinted emblem ring, vibrant isometric violet ribbon, and pale lilac highlight—calibrated for WCAG AA text contrast:

  

| **Semantic Token**             | **Light Mode Hex** | **Dark Mode Hex** | **Usage & Contrast Role**                                                                       |
| ------------------------------ | ------------------ | ----------------- | ----------------------------------------------------------------------------------------------- |
| `--background`                 | `#FAFAFC`          | `#121216`         | Primary page canvas (cool off-white / deep graphite-charcoal)                                   |
| `--surface` (`--card`)         | `#FFFFFF`          | `#1B1A22`         | Cards, panels, sidebar, bottom nav, modals                                                      |
| `--surface-subtle` (`--muted`) | `#F3F2F8`          | `#252330`         | Secondary backgrounds, table headers, input fills, hover states                                 |
| `--border`                     | `#E4E2EE`          | `#2E2C3B`         | Crisp 1px structural dividers and card outlines                                                 |
| `--foreground`                 | `#16151D`          | `#F4F3F8`         | Primary headings and body copy                                                                  |
| `--muted-foreground`           | `#5B586B`          | `#A29FB3`         | Captions, metadata, secondary labels, timestamps                                                |
| `--primary`                    | `#6D28D9`          | `#7C3AED`         | Primary CTA buttons, active pill fills (paired with `#FFFFFF` text for $\ge$ 5.7:1 AA contrast) |
| `--brand-accent`               | `#8B5CF6`          | `#A78BFA`         | Active nav icons, focus rings, brand highlights, stepper active nodes                           |
| `--brand-soft`                 | `#EDE9FE`          | `#2D2246`         | Active nav tint, subtle brand badges, highlighted rows                                          |
| `--success`                    | `#15803D`          | `#22C55E`         | `ACTIVE`, `APPROVED`, `PUBLISHED`, `PRESENT`, `DONE`, QR verified                               |
| `--warning`                    | `#B45309`          | `#F59E0B`         | `PENDING_REVIEW`, `NEEDS_REVISION`, `LATE`, `NEEDS_REVIEW`, Break-Glass alerts                  |
| `--destructive`                | `#B91C1C`          | `#EF4444`         | `REJECTED`, `DISABLED`, `ABSENT`, `CANCELLED`, destructive actions, `403` scan blocks           |
| `--info`                       | `#1D4ED8`          | `#60A5FA`         | `IN_PROGRESS`, `FOR_REVIEW`, `ONGOING`, `EXCUSED`, `SUBMITTED`                                  |

### 2.3 Typography & Formatting Standards

- **Primary UI Font:** `Inter` (or `Geist Sans`) for headings, body copy, forms, and navigation.
    
- **Monospace Metadata Font:** `JetBrains Mono` (or `Geist Mono`) strictly for structured operational identifiers so dense data scans effortlessly:
    
    - `student_id_number` (e.g., `2024-01234`)
        
    - `academic_terms.code` (e.g., `AY2026-2027-S1`)
        
    - Exact timestamps, scan logs, and `audit_logs` action keys
        
- **Type Scale:**
    
    - Page Title (`h1`): `24px` (`1.5rem`), Semibold, tight tracking (`-0.02em`)
        
    - Section Title (`h2`): `18px` (`1.125rem`), Semibold
        
    - Card Title (`h3`): `15px`–`16px`, Medium/Semibold
        
    - Body & Table Cell: `14px` (`0.875rem`), Regular, `1.5` line height
        
    - Micro / Badge / Metadata: `12px` (`0.75rem`), Medium
        

### 2.4 Unified Status Badge & Lucide Icon Language

Every domain state machine uses a consistent pill style (tinted semantic background + 1px subtle border + crisp Lucide icon):

  

|**Domain**|**Status Values & Visual Mapping**|
|---|---|
|**Events**|`DRAFT` (Neutral / `FileEdit`) $\cdot$ `PENDING_REVIEW` (Warning / `Clock`) $\cdot$ `NEEDS_REVISION` (Warning / `RotateCcw`) $\cdot$ `APPROVED` (Brand / `CheckCircle2`) $\cdot$ `PUBLISHED` (Success / `Globe`) $\cdot$ `COMPLETED` (Neutral-Filled / `Archive`) $\cdot$ `REJECTED` (Destructive / `XCircle`)|
|**Tasks**|`TO_DO` (Neutral / `Circle`) $\cdot$ `IN_PROGRESS` (Info / `Loader`) $\cdot$ `FOR_REVIEW` (Warning / `Eye`) $\cdot$ `DONE` (Success / `CheckCircle2`)|
|**Checkpoints**|`SCHEDULED` (Neutral / `CalendarClock`) $\cdot$ `OPEN` (Success + pulsing dot / `Radio`) $\cdot$ `CLOSED` (Neutral / `Lock`)|
|**Attendance**|`PRESENT` (Success / `Check`) $\cdot$ `LATE` (Warning / `ClockAlert`) $\cdot$ `EXCUSED` (Info / `FileCheck`) $\cdot$ `ABSENT` (Destructive / `X`)|
|**Meetings**|`SCHEDULED` (Brand / `Calendar`) $\cdot$ `ONGOING` (Success / `PlayCircle`) $\cdot$ `COMPLETED` (Neutral / `CheckCheck`) $\cdot$ `CANCELLED` (Destructive / `Ban`)|
|**Accounts**|`ACTIVE` (Success / `ShieldCheck`) $\cdot$ `NEEDS_REVIEW` (Warning / `ShieldAlert`) $\cdot$ `DISABLED` (Destructive / `ShieldOff`)|

## 3. Progressive Web App (PWA) & Mobile-First Standards

SYComP OMS is engineered as an installable **Progressive Web App (PWA)** to deliver a native-app feel for students checking attendance/calendars and officers scanning QR codes during live events:

  

- **Web App Manifest (`manifest.webmanifest`):**
    
    - `name`: `"SYComP OMS"` | `short_name`: `"SYComP"`
        
    - `display`: `"standalone"` (removes browser URL chrome when launched from home screen)
        
    - `start_url`: `"/"` (redirects automatically to `/portal` for `MEMBER` or `/dashboard` for `OFFICER`+)
        
    - `icons`: SYComP circular emblem exported in `192x192`, `512x512`, and `maskable` variants
        
    - Dynamic `<meta name="theme-color">` matching `#FAFAFC` (Light) and `#121216` (Dark)
        
- **Native Mobile Ergonomics:**
    
    - Respect `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` across top headers, mobile bottom nav bars, and camera scanner overlays.
        
    - Enforce a minimum **`44px × 44px`** touch target on all mobile buttons, tabs, and bottom navigation items.
        
    - Render secondary forms and filters as mobile **bottom drawers (Shadcn `Drawer`)** on screens `< 768px` and centered `Dialog` modals on desktop.
        
    - Subtle in-app **"Install App"** prompt banner inside Account settings (and non-intrusive dismissible prompt on supported mobile browsers).
        
- **Offline & Connectivity UX Contract:**
    
    - Service worker caches static assets and app shell for instant cold launches.
        
    - Displays a crisp top connectivity bar (`WifiOff` icon: _"You are offline. Live updates and attendance scanning require an internet connection."_) whenever `navigator.onLine === false`.
        
    - **Strict Integrity Rule:** QR attendance confirmation never queues fake "Confirmed" writes offline in v1; server-side duplicate checks (`BR-ATT-03`), `ACTIVE` account verification (`BR-ATT-07`), and Executive officer-attendance enforcement (`BR-ATT-05`) must execute live against the backend.
        

## 4. Dual-Shell Navigation & Information Architecture

SYComP OMS enforces a clean **two-shell layout split** reflecting the sharp capability boundary between General Members and Operational Officers.

  

### 4.1 Shell A: General Member Portal (`/portal/*`)

Designed as a **mobile-first, zero-clutter native-app portal** for `MEMBER` accounts:

  

- **Top Header (Sticky, `56px`):** SYComP emblem + `"SYComP"` wordmark on left; Theme Toggle (`Sun`/`Moon`) + Account Avatar on right.
    
- **Mobile Navigation (`< 768px`):** Fixed bottom tab bar with 5 single-tap destinations:
    
    1. `Home` (`Home` icon) $\rightarrow$ `/portal`
        
    2. `Calendar` (`Calendar` icon) $\rightarrow$ `/portal/calendar`
        
    3. `Attendance` (`ClipboardCheck` icon) $\rightarrow$ `/portal/attendance`
        
    4. `Notices` (`Megaphone` icon) $\rightarrow$ `/portal/announcements`
        
    5. `Account` (`UserCircle` icon) $\rightarrow$ `/portal/account`
        
- **Desktop Navigation ($\ge 768px$):** Clean centered top navigation bar (`max-w-5xl` container) using the exact same 5 destinations—no heavy sidebar needed for read-only consumers.
    
- **Security Prompt Banner:** If `users.must_change_password === true` or `users.email_verified_at === null`, a persistent top alert strip appears across `/portal/*` with a direct CTA to `/portal/account` (`FR-AUTH-08`).
    

### 4.2 Shell B: Officer, Executive & Super Admin Workspace

Designed as a **full collapsible sidebar SaaS workspace**:

  

- **Desktop Sidebar:** `248px` expanded / `64px` icon-only collapsed (persisted in user preference), with tooltips on hover when collapsed.
    
- **Mobile Navigation (`< 1024px`):** Slide-over `Sheet` drawer triggered from top-left menu button, paired with a quick header icon to jump straight to `/scanner` on mobile devices during live events.
    
- **Top Utility Bar (`56px`):** Sidebar collapse toggle + breadcrumb trail on left; Active Term Pill (`AY 2026–2027 • 1st Sem`), Theme Toggle, Role Tier Badge (`OFFICER` / `EXECUTIVE` / `SUPER ADMIN`), and Profile Menu on right.
    
- **Sidebar Navigation Groups (Role-Filtered):**
    

|**Group**|**Navigation Item**|**Lucide Icon**|**Route**|**Visible To**|
|---|---|---|---|---|
|**Core**|Dashboard|`LayoutDashboard`|`/dashboard`|`OFFICER`, `EXECUTIVE`, `SUPER_ADMIN`|
|**Core**|QR Scanner|`QrCode`|`/scanner`|`OFFICER`, `EXECUTIVE`, `SUPER_ADMIN`|
|**Operations**|Events & Proposals|`CalendarDays`|`/events`|`OFFICER`, `EXECUTIVE`, `SUPER_ADMIN`|
|**Operations**|My Tasks|`CheckSquare`|`/tasks`|`OFFICER`, `EXECUTIVE`, `SUPER_ADMIN`|
|**Operations**|Officer Meetings|`UsersRound`|`/meetings`|`OFFICER`, `EXECUTIVE`, `SUPER_ADMIN`|
|**Operations**|Documents|`FolderOpen`|`/documents`|`OFFICER`, `EXECUTIVE`, `SUPER_ADMIN`|
|**Operations**|Announcements|`Megaphone`|`/announcements`|`OFFICER`, `EXECUTIVE`, `SUPER_ADMIN`|
|**Organization**|Directory|`BookUser`|`/directory`|`OFFICER`, `EXECUTIVE`, `SUPER_ADMIN`|
|**Governance**|Terms & Officers|`GraduationCap`|`/admin/terms`|`SUPER_ADMIN` _(Read-only term switcher for Officers)_|
|**Governance**|Masterlist Import|`FileSpreadsheet`|`/admin/masterlist`|`SUPER_ADMIN` _(Summary read-only for `EXECUTIVE`)_|
|**Governance**|Audit Logs|`ScrollText`|`/admin/audit-logs`|`EXECUTIVE`, `SUPER_ADMIN`|
|**Governance**|System Settings|`Settings`|`/admin/settings`|`SUPER_ADMIN` (`document_types` also accessible to `EXECUTIVE`)|

Note: All route strings live in a single centralized route registry (`src/config/routes.ts`) so `/meetings`, `/events`, or `/scanner` can be renamed without hunting across components (`FR-MTG-01`, `NFR-MAINT-01`).

  

## 5. Complete Screen Hierarchy & Sitemap

Plaintext

```
SYComP OMS
├── Public & Authentication
│   ├── /login                          (Student ID + Password; SYComP branding + theme toggle)
│   ├── /forgot-password                (Verified university email OTP request -> 6-digit verify -> new password)
│   └── /account-hold                   (Blocked notice for DISABLED / NEEDS_REVIEW accounts post-credential check)
│
├── Member Portal (Shell A — Read-Only + Self-Service)
│   ├── /portal                         (Member Home: security banner, next events, pinned notices, attendance stat)
│   ├── /portal/calendar                (Month/List toggle of PUBLISHED & COMPLETED events -> detail drawer)
│   ├── /portal/attendance              (Personal attendance history grouped by term & event checkpoints)
│   ├── /portal/announcements           (Chronological ALL_MEMBERS published announcements feed + reader modal)
│   └── /portal/account                 (University email OTP binding, password update, PWA install info)
│
└── Officer / Executive / Super Admin Workspace (Shell B)
    ├── /dashboard                      (Role-tailored operational overview)
    ├── /scanner                        (Dedicated 2-step QR Attendance Scanner: Scan -> Verify Card -> Confirm)
    ├── /events                         (Filterable list/calendar of all events + Proposal Workspace tab/filter)
    │   ├── /events/new                 (Create Event Proposal: rich-text editor + drag-and-drop Drive upload)
    │   └── /events/[slug]              (Single Tabbed Event Hub: Overview, Committees, Tasks, Attendance, Docs)
    ├── /tasks                          (Consolidated personal task queue + committee/org deliverable filter)
    ├── /meetings                       (Isolated Officer Meetings namespace: Scheduled / Ongoing / Completed)
    │   └── /meetings/[id]              (Meeting detail: Agenda, Minutes editor, Officer Checkpoints, Attachments)
    ├── /documents                      (Centralized document registry, dynamic type filter, upload & Drive links)
    ├── /announcements                  (Draft/Published/Archived manager; ALL_MEMBERS vs OFFICERS_ONLY scoping)
    ├── /directory                      (Searchable Active & Historical Officers + General Members directory)
    ├── /account                        (Officer self-service email binding & password settings)
    └── /admin
        ├── /admin/terms                (Academic Term lifecycle, atomic rollover wizard, officer appointments)
        ├── /admin/masterlist           (CSV/XLSX upload -> discrepancy preview -> commit + import history)
        ├── /admin/audit-logs           (Searchable immutable ledger with before/after JSON diff viewer)
        └── /admin/settings             (Dynamic Document Types manager & system configuration)
```

## 6. Role-Aware Dashboard Layouts

Each tier lands on a focused operational cockpit rather than a generic list (`FR-AUD-01`):

  

### 6.1 `Member` Dashboard (`/portal`)

1. **Security Onboarding Banner** _(conditional)_: Prompts university email binding and default password update (`FR-AUTH-08`).
    
2. **Attendance Snapshot Strip:** Compact KPI cards (`Events Attended`, `Checkpoints Logged`, `Current Term`).
    
3. **Upcoming Published Events:** Next 3 `PUBLISHED` events with date badge, venue, and quick detail drawer.
    
4. **Latest Announcements:** Pinned `ALL_MEMBERS` announcements first, followed by recent notices.
    

### 6.2 `Officer` / `Committee Head` Dashboard (`/dashboard`)

1. **Quick Action Bar:** Primary CTA `Open QR Scanner` (badge showing count of currently `OPEN` checkpoints) + `Draft Proposal`.
    
2. **My Assigned Tasks:** Compact actionable list grouped by `Due Soon / Overdue`, `In Progress`, and `For Review`, with inline status progression (`TO_DO` $\rightarrow$ `IN_PROGRESS` $\rightarrow$ `FOR_REVIEW`).
    
3. **My Active Committees:** Cards for events where the officer is `Committee Head` (highlighted with a `Crown`/`Shield` Lucide badge and task completion progress bar) or a committee member.
    
4. **Open Proposals & Upcoming Meetings:** Quick feed of active event proposals and scheduled officer meetings.
    

### 6.3 `Executive` Dashboard (`/dashboard`)

1. **Governance Attention Strip:** High-priority cards with instant deep links:
    
    - `Proposals Pending Review` (count)
        
    - `Approved — Ready to Publish` (count)
        
    - `Overdue Event Deliverables` (count)
        
    - `Unassigned / Disabled Committee Heads` _(conditional warning banner per `02b` Edge-Case Matrix)_
        
2. **Active Events Overview:** Progress table showing each event's status, committee task completion %, and live checkpoint states (`OPEN`/`CLOSED`).
    
3. **Upcoming Officer Meetings & Recent Audit Highlights:** Next scheduled meeting with quick attendance launch + latest 5 high-impact audit entries.
    

### 6.4 `Super Admin` Dashboard (`/dashboard`)

1. **System Health Strip:** Active Term status card (`AY 2026–2027 - 1st Sem`), `Accounts Flagged NEEDS_REVIEW` counter (direct link to resolution queue), Total Active Members, and Last Masterlist Import summary.
    
2. **Quick Governance Controls:** `Import Masterlist`, `Manage Term & Appointments`, `Inspect Audit Logs`.
    
3. **Recent Break-Glass & System Audit Activity:** Filtered table highlighting account status changes, term events, and any `break_glass: true` overrides.
    

## 7. Deep-Dive Specifications for Signature Interfaces

### 7.1 Single Tabbed Event Hub (`/events/[slug]?tab=...`)

Keeping every operational facet of an event inside one tabbed workspace eliminates context switching and preserves URL-shareable state via query parameters (`?tab=overview|committees|tasks|attendance|documents`).

  

Plaintext

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Events / AY2026-2027-S1                                                    │
│ Tech Innovation Summit 2026                      [PUBLISHED] [••• Actions]   │
│ Oct 18, 2026 • 08:00 AM – 05:00 PM  |  HNU Barder Hall  |  All BSIT/BSCS     │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Overview & Proposal]  [Committees (4)]  [Tasks (18)]  [Attendance]  [Docs]  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Persistent Header Action Bar (Role-Conditional):**
    
    - _Proposal Author (`DRAFT`/`NEEDS_REVISION`):_ `Edit Proposal`, `Submit for Review`
        
    - _`EXECUTIVE`:_ Lifecycle transition buttons (`Approve`, `Request Revision`, `Reject`, `Publish`, `Unpublish`, `Mark Completed`)—only valid next states from `02b` are rendered.
        
    - _`SUPER_ADMIN`:_ Executive controls appear inside a visually distinct `Break-Glass Actions` dropdown triggering the mandatory reason modal.
        
- **Tab 1 — Overview & Proposal (`?tab=overview`):**
    
    - Rendered sanitized `description_html`, `public_summary` preview card, and attached proposal files (`Term > Proposals > [Title]`).
        
    - **Review & Feedback Timeline (`event_proposal_reviews`):** Chronological thread showing revision rounds (`Rev #1`, `Rev #2`), officer comments, and executive decision notes.
        
- **Tab 2 — Committees (`?tab=committees`):** _(Unlocked once `APPROVED`)_
    
    - Grid of event-scoped committee cards. Each card displays Committee Name, single **`Committee Head`** badge (with reassign option for `EXECUTIVE`), Officer Member list, and committee task completion bar.
        
    - `Committee Head` sees `Manage Roster` and `Add Task` buttons **exclusively on their own card**.
        
- **Tab 3 — Tasks (`?tab=tasks`):**
    
    - Toggleable **List / Board** view filterable by Committee, Assignee, Priority, and Status (`TO_DO`, `IN_PROGRESS`, `FOR_REVIEW`, `DONE`).
        
    - Creating a task lets `EXECUTIVE` pick any committee (or `Event-Wide`); a `Committee Head` has the committee dropdown locked to their assigned committee.
        
- **Tab 4 — Attendance (`?tab=attendance`):**
    
    - Top section: **Dynamic Checkpoints Strip** (e.g., `AM In [OPEN]`, `AM Out [SCHEDULED]`, `PM In [SCHEDULED]`).
        
    - **`EXECUTIVE`-only controls:** `Add Checkpoint`, `Open / Close` toggle, `Manual Attendance Entry / Override` button.
        
    - **Quick Scan Launcher:** Clicking `Scan Checkpoint` navigates to `/scanner?checkpointId=<uuid>`.
        
    - Bottom section: Filterable attendance table (search by Student ID or Name, filter by checkpoint/status) + `Export CSV` button.
        
- **Tab 5 — Documents (`?tab=documents`):**
    
    - Table of event-linked documents showing Document Type, Status badge, Uploader, and Google Drive preview/link action, plus `Upload Document` / `Link Drive URL` actions pre-bound to the current `event_id`.
        

### 7.2 Dedicated 2-Step QR Attendance Scanner (`/scanner`)

Designed as a dedicated, distraction-free page optimized for portrait mobile screens and laptops with webcams, implementing an explicit **Scan $\rightarrow$ Verify $\rightarrow$ Confirm** safeguard so officers visually verify student identity before committing an attendance record.

  

Plaintext

```
┌──────────────────────────────────────────────┐
│  QR Attendance Scanner              42 logs  │
├──────────────────────────────────────────────┤
│  Checkpoint: [ Tech Summit — AM In (OPEN) ▾] │
│  Scope: General Members   •   Event Session  │
├──────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐  │
│  │                                        │  │
│  │       [ Camera Viewfinder Frame ]      │  │
│  │            Align Student ID QR         │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│  [Switch Camera]      [Enter ID Manually]    │
├──────────────────────────────────────────────┤
│  VERIFICATION CARD (appears on QR decode)    │
│  ┌────────────────────────────────────────┐  │
│  │  Juan Dela Cruz              [ACTIVE]  │  │
│  │  ID: 2024-01234  •  Role: MEMBER       │  │
│  │  Checkpoint: AM In  •  Status: Ready   │  │
│  │                                        │  │
│  │  [ Cancel / Rescan ] [ Confirm Attend ]│  │
│  └────────────────────────────────────────┘  │
├──────────────────────────────────────────────┤
│  Recent Confirmed Scans                      │
│  • Maria Santos (2024-00812)   08:14:22 AM   │
│  • Carlos Reyes (2023-04190)   08:13:55 AM   │
└──────────────────────────────────────────────┘
```

#### Scanner Interaction Flow & Verification States

1. **Checkpoint Selection:** Dropdown lists only currently `OPEN` checkpoints the user is authorized to scan (supports pre-selection via `/scanner?checkpointId=<uuid>`). If no checkpoints are `OPEN`, displays a clear empty state explaining that an `EXECUTIVE` must open a checkpoint first.
    
2. **Step 1 — Decode & Lookup (Non-Mutating):**
    
    - Camera decodes QR payload (or officer enters `student_id_number` manually via fallback input if an ID is damaged).
        
    - Scanner pauses camera decoding immediately and calls a fast read-only lookup endpoint (`GET /api/attendance/lookup?checkpointId=...&studentId=...`).
        
3. **Step 2 — Verification Card Display (5 Explicit States):**
    
    - **Ready to Confirm (Green/Brand Border):** Displays Full Name, `student_id_number` (monospace), Role badge, Account `ACTIVE` status, and active Checkpoint label. Primary button **`Confirm Attendance`** is focused and enabled.
        
    - **Already Recorded (Amber Warning Card):** Displays student info + _"Already logged at 08:04:12 AM"_. Confirm button is disabled; only `Scan Next` is shown (`BR-ATT-03`).
        
    - **Officer Attendance Guard (Red Lock Card):** If a non-Executive `OFFICER` scans an active `OFFICER` or `EXECUTIVE`, displays _"Officer attendance must be recorded by an Executive (`BR-ATT-05`)"_. Confirm button is disabled.
        
    - **Account Hold Warning (Red Alert Card):** If target is `DISABLED` or `NEEDS_REVIEW`, displays _"Account is [DISABLED / NEEDS REVIEW] — Cannot log attendance (`BR-ATT-07`)"_. Confirm button is disabled.
        
    - **ID Not Found (Neutral Error Card):** _"Student ID not found in active masterlist."_ Offers `Rescan` or `Check ID`.
        
4. **Step 3 — Explicit Confirm & Rapid Reset:**
    
    - Clicking **`Confirm Attendance`** sends `POST /api/attendance/confirm` (`{ checkpoint_id, student_id_number }`), flashes a crisp success toast + subtle chime/haptic feedback, prepends the entry to the `Recent Confirmed Scans` feed, clears the card, and immediately resumes the camera viewfinder for the next student.
        

### 7.3 `SUPER_ADMIN` Break-Glass Override Modal

Whenever a `SUPER_ADMIN` triggers an Executive-scoped mutation or edits a locked historical record:

  

- **Visual Cue:** Amber/Destructive accented dialog header with `ShieldAlert` Lucide icon and title `"Break-Glass Administrative Override"`.
    
- **Context Summary:** Displays the exact action (e.g., `EVENT_PUBLISHED`, `ATTENDANCE_OVERRIDDEN`) and target record.
    
- **Mandatory Justification:** Required textarea (`min 10 characters`, live character counter) labeled `"Audit Reason (Required)"`.
    
- **Confirmation Control:** Confirm button stays disabled until the reason meets minimum length, submitting `{ ...payload, break_glass: true, reason }` to the backend.
    

### 7.4 Rich-Text Editor & Google Drive Upload UX

- **WYSIWYG Editor (Proposals, Meeting Agendas/Minutes, Announcements):** Clean Shadcn-styled toolbar using Lucide icons (`Heading2`, `Heading3`, `Bold`, `Italic`, `Underline`, `List`, `ListOrdered`, `Quote`, `Link`, `Undo`, `Redo`). Output is sanitized server-side (`FR-EVT-09`).
    
- **Drag-and-Drop Document Uploader:**
    
    - Displays accepted file types and `15 MB` max size limit clearly.
        
    - **Live Path Preview:** As the officer picks a Document Type and optional Event, a monospace pill previews the exact Google Drive destination folder (e.g., `AY 2026-2027 - 1st Sem / Communication Letters / Tech Summit 2026` or `.../ General`).
        
    - **Drive Preview & Link Notice:** Clicking a stored document opens a metadata drawer with an embedded preview frame (when supported) and an `"Open in Google Drive"` button (`ExternalLink` icon), paired with a concise helper note when `DRIVE_SHARE_MODE=domain`: *"Requires signing in with your official university Google account."*
        

## 8. Core User Journeys

### Journey 1: First-Time Member Login & University Email Binding

1. Student opens SYComP OMS PWA $\rightarrow$ enters `Student ID` + normalized default password (`lastname + ID`).
    
2. Lands on `/portal` (Shell A) and sees the top security prompt banner: _"Secure your account: bind your official university email and update your default password."_
    
3. Taps banner $\rightarrow$ opens `/portal/account`.
    
4. Enters official university email (client + server validate strict institutional domain) $\rightarrow$ clicks `Send Code` $\rightarrow$ enters 6-digit OTP $\rightarrow$ email badge flips to `Verified`.
    
5. Updates password (meeting 10+ char policy) $\rightarrow$ banner disappears permanently.
    

### Journey 2: Officer Proposal $\rightarrow$ Executive Approval $\rightarrow$ Publish

1. `Officer` clicks `New Proposal` on `/events` $\rightarrow$ completes title, schedule, venue, rich-text body, and drags proposal PDF into dropzone $\rightarrow$ clicks `Submit for Review`.
    
2. `Executive` sees `1 Proposal Pending Review` on `/dashboard` $\rightarrow$ opens `/events/[slug]` $\rightarrow$ reads proposal and clicks `Request Revision` with feedback note.
    
3. `Officer` sees `Needs Revision` status and feedback timeline $\rightarrow$ edits text / uploads revised file $\rightarrow$ clicks `Resubmit`.
    
4. `Executive` approves (`APPROVED`) $\rightarrow$ switches to `Committees` tab $\rightarrow$ creates _Logistics_ and _Technical_ committees with one `Officer` head each $\rightarrow$ opens `Attendance` tab to pre-configure checkpoints $\rightarrow$ clicks `Publish` so the event appears on `/portal/calendar`.
    

### Journey 3: Live Event QR Attendance Logging

1. `Executive` opens `/events/[slug]?tab=attendance` and flips `AM In` checkpoint from `SCHEDULED` to `OPEN`.
    
2. `Officer` opens `/scanner` on their phone (installed PWA), selects `AM In`, and scans a student's ID QR code.
    
3. Verification card pops up displaying the student's Full Name, Student ID, `MEMBER` badge, and `ACTIVE` status.
    
4. Officer verifies the student matches the displayed info and taps **`Confirm Attendance`** $\rightarrow$ green toast confirms log and camera automatically resumes for the next student in line.
    

### Journey 4: Executive Attendance Correction

1. Student checks `/portal/attendance`, notices a missed scan, and approaches an `Executive` in person.
    
2. `Executive` opens `/events/[slug]?tab=attendance`, searches the student's ID, clicks `Edit / Manual Log`, selects `PRESENT` (or `EXCUSED`), enters the mandatory verification reason, and saves.
    
3. Student refreshes `/portal/attendance` and immediately sees the updated status; the correction is permanently visible in `/admin/audit-logs`.
    

### Journey 5: Semester Masterlist Import & Discrepancy Resolution (`Super Admin`)

1. `Super Admin` navigates to `/admin/masterlist` and drops the semester's official CSV/XLSX.
    
2. **Pre-Commit Preview Screen** displays 3 clean tabs: `New Accounts to Create`, `Existing Active (Skipped)`, and `Warnings / Duplicates / Missing from Previous Term`.
    
3. `Super Admin` resolves any duplicate rows, clicks `Commit Import`, and reviews students flagged `NEEDS_REVIEW` inside `/directory?status=NEEDS_REVIEW` to confirm `DISABLED` (`Graduated`/`Transferred`) or reactivate.
    

## 9. Component Standards, Accessibility & Feedback States

### 9.1 Shadcn/ui Component Mapping

- **Tables & Directories:** `@tanstack/react-table` wrapped in Shadcn `Table` with sticky headers, debounced search, faceted filter chips, and horizontal scroll containers on mobile.
    
- **Dialogs & Responsive Sheets:** Shadcn `Dialog` on desktop ($\ge 768px$), `Drawer` on mobile (`< 768px`) for forms and detail previews.
    
- **Notifications:** `Sonner` toast stack positioned top-right on desktop and top-center on mobile (avoiding overlap with the Member bottom nav bar and Scanner confirm button).
    
- **Loading & Empty States:** Always use geometry-matched Shadcn `Skeleton` placeholders during fetches. Every empty table/feed displays a muted `40px` Lucide icon, a clear 1-line explanation, and a single contextual CTA (if the user has permission to create).
    

### 9.2 Accessibility Baseline (WCAG 2.1 AA)

- Full keyboard navigation (`Tab`, `Enter`, `Escape`) across sidebar, Event Hub tabs, dialogs, and tables, with visible `--brand-accent` focus rings.
    
- Semantic ARIA landmarks (`<nav>`, `<main>`, `<aside>`), `aria-live="polite"` regions on the QR Verification Card and toast alerts, and explicit `<label>` bindings on all form inputs.
    
- Status states never rely on color alone—every status pairs color with a text label and a distinct Lucide icon.
    

## 10. Architectural Alignment Notes (Handoff to `06` & `09`)

Two UX decisions finalized in this phase directly inform **`06 — Technical Architecture`** and will be recorded in **`09 — Decision Log`**:

  

1. **Two-Step Attendance API (`lookup` + `confirm`):** In addition to the write endpoint (`POST /api/attendance/confirm`), `06` will define a fast, read-only `GET /api/attendance/lookup` endpoint that evaluates account status, duplicate scan status, and officer-attendance guard rules prior to displaying the Verification Card—keeping end-to-end scan-to-verify well under `NFR-PERF-01` (1.5s).
    
2. **PWA Packaging:** `06` will include Web App Manifest generation, icon asset pipeline, and a lightweight Service Worker strategy (shell caching + offline detection banner without offline write queuing).