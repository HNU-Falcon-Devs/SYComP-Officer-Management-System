# SYCOMP Officer Management & Operations Portal

## Revised System Architecture & Technical Specifications (v3 — Consolidated 14-Table Edition)

**Organization:** Society of Young Computer Professionals (SYCOMP), Holy Name University

**Target users:** Active SYCOMP officers and Faculty Adviser

**Document status:** Consolidated production specification — event-scoped committees & 14-table schema

**Primary objective:** Build a lean, maintainable internal operations platform that centralizes officer records, event-specific committee leadership, deliverables, attendance, endorsement letter workflows, and institutional history without over-engineering.

## 1. Project Overview

### 1.1 Problem

SYCOMP's operational information is currently distributed across Facebook Messenger group chats, spreadsheets, and Google Drive links. This makes it difficult to track event responsibilities, document endorsements, attendance, deadlines, and historical organizational records across academic terms.

### 1.2 Proposed solution

Build a centralized internal portal backed by a streamlined **14-table PostgreSQL schema** that supports:

* Stable officer directory and account lifecycle

* Historical officer appointments and term-bound permission tiers (`admin` and `member`)

* Semester activity planning, event management, and event-specific Committee Heads

* Unified requirements, form templates, and deliverable submissions

* Attendance recording and personal attendance history

* Endorsement-letter tracking with independent signatory steps

* In-app notifications, announcements, and unified audit logs

The portal is designed to be inherited by future SYCOMP student cohorts. It avoids redundant tables, prevents privilege leaks across semester rollovers, and preserves historical records when officers change positions or graduate.

### 1.3 Design principles

1. **Preserve history:** Never overwrite previous appointments, event committees, attendance, approvals, or submissions during a semester rollover.

2. **Separate identity from office:** A person's account/profile is stable (`officers`); their organizational position and system authority are time-bound to an academic term (`officer_appointments`).

3. **Event-scoped committees only:** Working committees (e.g., Technical, Creatives, Logistics) exist strictly within the context of an individual event (`event_committees`) and record only the designated Committee Head—never standing organizational sub-rosters.

4. **Term-bound least privilege:** Elevated permissions (`admin`) belong to an active term appointment so that when a term closes, outgoing leaders do not silently retain administrative access.

5. **Database-enforced security:** PostgreSQL Row-Level Security (RLS) and constraints are the true security boundary; hiding UI controls is not authorization.

6. **Human verification:** AI may assist with extracting routing-sheet signatories, but a human officer must review and confirm before records are saved.

7. **Radical maintainability:** Every table must earn its keep. Avoid parallel tables for identical workflows (such as separate form submissions vs. requirement submissions, or separate assignee tables vs. pending submissions).

## 2. Core Functional Modules

### A. Officer Directory & Account Lifecycle

**Stable officer profile (`officers`)**

* Full name

* University email

* Student ID number (optional/restricted)

* Contact number (optional/restricted)

* Account status (`active`, `suspended`, `inactive`)

* Created and updated timestamps

Emergency contact information is intentionally excluded to minimize sensitive personal data storage. Initial system bootstrapping or emergency administrative recovery is handled directly at the database level via the Supabase dashboard/SQL editor rather than exposing a permanent super-admin flag in the application schema.

**Term-bound organizational appointment history (`officer_appointments`)**

* Officer reference

* Academic term reference

* Standing position title (e.g., `President`, `Faculty Adviser`, `Vice President`, `Secretary`, `Technical Director`, `Creative Director`)

* Permission tier (`admin`, `member`)

* Appointment start and end dates

* Appointment status (`active`, `completed`, `resigned`, `revoked`)

* Optional notes

An officer may hold different appointments across academic terms. Because permissions are tied to `permission_tier` on the active appointment rather than a permanent user flag, closing a term automatically ends elevated privileges for outgoing officers.

**Account deletion policy**

* Normal organizational workflows must never hard-delete an officer profile or `auth.users` account.

* Deactivate or suspend access instead (`account_status = 'inactive'` or `'suspended'`).

* Use `ON DELETE RESTRICT` or `ON DELETE SET NULL` on historical foreign keys to preserve institutional attribution.

### B. Activity, Event & Committee Head Management

Events belong to an academic term and serve both as the **semester roadmap** (when in `'planned'` or `'draft'` status) and the **operational calendar** (when `'published'` or `'completed'`).

**Core event attributes (`events`)**

* Academic term

* Title and description/objectives

* Start and end timestamps

* Venue and venue booking status (`not_required`, `pending`, `confirmed`, `rejected`, `cancelled`)

* Event status (`planned`, `draft`, `published`, `completed`, `cancelled`)

* Optional overall Event Lead (`lead_officer_id`)

* Creator (`created_by`)

**Event-Scoped Committees (`event_committees`)**
In SYCOMP's operational workflow, committees do not exist as permanent standing bodies across the organization. Instead, committees are formed specifically for an event, and **only the designated Committee Head is recorded** (there are no committee members tracked in the system).

**Intended Workflow:**

1. An Admin (President or Adviser) creates an event (e.g., *Hinabo 2026*).

2. The Admin (or designated Event Lead) defines the working committees needed for that specific event (e.g., *Technical*, *Creatives*, *Logistics*).

3. For each committee, an officer is assigned as the **Committee Head** (`head_officer_id`) with a defined responsibility scope (`description`).

4. An officer may be assigned as Committee Head for **multiple committees within the same event** (e.g., heading both *Technical* and *Logistics*) as well as across different events.

5. These committee assignments belong exclusively to *Hinabo 2026* and do not automatically carry over to subsequent events.

**Example — Hinabo 2026 (`event_committees` records):**

| Event       | Committee Name | Committee Head | Responsibility / Scope (`description`)             |     |
| ----------- | -------------- | -------------- | -------------------------------------------------- | --- |
| Hinabo 2026 | Technical      | Marchus        | Responsible for technical operations and equipment |     |
| Hinabo 2026 | Creatives      | Officer B      | Responsible for graphics and publicity materials   |     |
| Hinabo 2026 | Logistics      | Officer C      | Responsible for venue and event materials          |     |

### C. Requirements, Deliverables & Forms Matrix

Rather than maintaining separate subsystems for deliverables, assignee snapshots, and form submissions, the portal unifies all trackable officer outputs into two tables: `requirements` and `submissions`, backed by `resources` for downloadable templates.

**Requirement definition (`requirements`)**

* Academic term

* Optional linked event (`event_id`)

* Optional linked template or form (`template_resource_id` referencing `resources`)

* Title and instructions

* Deadline

* Target scope (`all_officers`, `event_leads_only`, `event_committee_heads`, `specific_officers`)

* Publication status (`is_published`)

**Unified assignee snapshot & submission tracking (`submissions`)**
When a requirement is published, the system resolves the target officers and inserts rows directly into `submissions` with `status = 'pending'`.

* A row with `status = 'pending'` serves as the immutable assignment snapshot (preserving who was assigned at publication time even if event leadership changes later).

* When the officer completes the requirement or fills out the linked form template, they update their row with a `submission_url` or uploaded `file_path`, transitioning the status to `'submitted'` (or `'late'` if past deadline).

* Authorized reviewers (`admin` or parent Event Lead) then mark the row `'approved'` or `'rejected'` with `review_notes`.

### D. Document & Endorsement Letter Pipeline

Letters have an overall workflow status (`letters`), while each signatory/endorsement step has its own independent status (`letter_signatories`).

**Overall letter status:** `draft`, `for_review`, `in_routing`, `completed`, `rejected`, `cancelled`

**Individual signatory-step status:** `pending`, `signed`, `rejected`, `not_required`

* A letter can transition to `completed` only when all required steps are marked `signed` or `not_required`.

* Optional AI vision extraction may suggest signatory steps from a photo of a routing sheet, but an officer must review and confirm the checklist before steps are saved.

* All status changes and checklist edits are recorded in the unified `audit_logs` table (`entity_table = 'letters'`).

### E. Attendance Management

Attendance sessions (`attendance_records`) can be linked to an event or recorded as a standalone internal meeting/general assembly. Individual officer statuses (`attendance_entries`) support four distinct values:

* `present`

* `absent`

* `late`

* `excused` (`excused` is strictly distinct from `absent` in reports)

**Authority:** Only an active officer holding the `admin` permission tier (President and Faculty Adviser) in the current academic term can create or modify attendance records.

### F. Academic Term & Rollover Management

A single `academic_terms` table manages academic periods (e.g., `academic_year = '2026-2027'`, `name = 'First Semester'`). A partial unique index enforces that only one term has `is_active = true` at any time.

**Transactional Rollover Behavior:**

1. Preview incoming term details and proposed officer appointments.

2. Mark the current term `is_active = false` and set `status = 'completed'` on its active appointments.

3. Activate the new term (`is_active = true`) and insert the new `officer_appointments` rows.

4. Because permissions derive from active appointments in the active term, outgoing `admin` officers automatically lose elevated write access upon rollover unless re-appointed as `admin` in the new term, while retaining full historical attribution.

### G. Notifications, Broadcasts & Resource Repository

* **Notifications & Announcements (`notifications`):** Supports both targeted user alerts (`recipient_officer_id` is set) and organization-wide broadcast announcements (`is_broadcast = true`, `recipient_officer_id = null`).

* **Resource & Template Catalog (`resources`):** Central catalog of Google Drive folders, official templates, reusable forms, and reference documents (`category` e.g. `'template'`, `'guideline'`, `'drive_folder'`).

## 3. Roles, Permissions & Governance

### 3.1 Two-tier term-bound permissions (`admin` & `member`)

Instead of a complex hierarchy or a permanent untimed permissions table that risks leaving elevated privileges active after an officer steps down, operational authority is determined by a strict two-tier `permission_tier` on an officer's active appointment in the active academic term:

* `admin`: Assigned exclusively to the **Organization President** and **Faculty Adviser**. Grants full administrative authority across the entire system, including managing officer profiles and appointments, academic terms and rollovers, events and Committee Head assignments, requirements and deliverable reviews, resources, broadcast announcements, and attendance recording.

* `member`: Assigned to **all other active officers** (e.g., Vice President, Secretary, Treasurer, Technical Director, Auditors, etc.). Grants standard officer access to view the directory and calendar, submit assigned deliverables, update endorsement letter progress, and manage their own assigned event scope when designated as an Event Lead (`events.lead_officer_id`) or Committee Head (`event_committees.head_officer_id`).

### 3.2 Permissions matrix

| Action                                        | Member (Standard Officer) | Event Lead / Committee Head       | Admin (President & Adviser) |     |
| --------------------------------------------- | ------------------------- | --------------------------------- | --------------------------- | --- |
| View basic officer directory & calendar       | Yes                       | Yes                               | Yes                         |     |
| Manage officer profiles & appointments        | No                        | No                                | **Yes**                     |     |
| Manage academic terms & rollover              | No                        | No                                | **Yes**                     |     |
| Create/manage events & assign Committee Heads | No                        | Assigned event scope (Event Lead) | **Yes**                     |     |
| Update Event Committee scope/description      | No                        | Yes (own committee)               | **Yes**                     |     |
| Create & review requirements/deliverables     | No                        | Assigned event scope (Event Lead) | **Yes**                     |     |
| Submit assigned deliverables                  | Yes                       | Yes                               | **Yes**                     |     |
| Update endorsement letter progress            | Yes                       | Yes                               | **Yes**                     |     |
| Record / edit attendance                      | No                        | No                                | **Yes**                     |     |
| Manage resource & template links              | No                        | No                                | **Yes**                     |     |
| Publish broadcast announcements               | No                        | No                                | **Yes**                     |     |

## 4. Recommended Technology Stack

| Layer | Technology | Purpose | 
| ----- | ----- | ----- | 
| Framework | Next.js (App Router, TypeScript) | Full-stack web application, Server Components, Server Actions | 
| Styling & UI | Tailwind CSS + shadcn/ui | Accessible, responsive interface components | 
| Database & Auth | Supabase (PostgreSQL + Auth) | Relational storage, magic-link/Google university auth, RLS enforcement | 
| File Storage | Supabase Storage / Google Drive | Private buckets for letter scans/submissions; Drive links for resources | 
| Transactional Email | Resend | Deadline reminders and assignment alerts | 
| Scheduled Jobs | Vercel Cron / GitHub Actions | Daily deadline reminder checks | 
| AI Vision (Optional) | Server-side LLM Vision Adapter | Draft extraction of routing-sheet signatories | 

## 5. Consolidated Database Architecture (14 Tables)

### 5.1 What was simplified (25 Tables $\rightarrow$ 14 Tables)

| Removed Table(s) | Consolidated Into | Architectural Reason | 
| ----- | ----- | ----- | 
| `committees`, `committee_members`, `event_staff` | `event_committees` | Standing committees and committee member rosters do not exist; committees are event-specific and record only the Committee Head. | 
| `officer_permissions` | `officer_appointments.permission_tier` | Two simple tiers (`admin` for President/Adviser, `member` for all others) tied to the active term prevent privilege leaks across rollovers. | 
| `academic_years` | `academic_terms.academic_year` | Eliminates unnecessary joins just to display `'2026-2027'` alongside `'First Semester'`. | 
| `requirement_assignees` | `submissions` (`status = 'pending'`) | Eliminates 1:1 duplicate unique keys `(requirement_id, officer_id)`; a `'pending'` submission row is the assignment snapshot. | 
| `form_templates`, `form_submissions` | `resources` + `requirements` / `submissions` | Unifies downloadable templates and submission review workflows into a single engine. | 
| `semester_plans`, `plan_milestones` | `events` (`status = 'planned'`) | Eliminates double-entry between semester planning and event execution. | 
| `letter_activity_logs` | `audit_logs` (`entity_table = 'letters'`) | Consolidates append-only audit trails into a single unified table. | 
| `announcements` | `notifications` (`is_broadcast = true`) | Unifies broadcast announcements and targeted user alerts. | 

### 5.2 Entity relationship overview

```
auth.users
    │
    ▼
officers
    │
    ├──────── officer_appointments ─────────── academic_terms
    │         (permission_tier: admin | member)      │
    │                                                ├── events (includes 'planned' roadmap items)
    │         ┌──────────────────────────────────────┤     │
    │         │                                      │     └── event_committees (head_officer_id)
    │         ▼                                      │
    │   event_committees                             ├── attendance_records
    │   (event_id, name, head_officer_id)            │     │
    │                                                │     └── attendance_entries
    │                                                │
    │                                                ├── requirements ─── resources (templates/links)
    │                                                │     │
    │                                                │     └── submissions ('pending' = assigned)
    │                                                │
    │                                                └── letters
    │                                                      │
    │                                                      └── letter_signatories
    │
    ├──────── notifications (targeted alerts & broadcast announcements)
    └──────── audit_logs (unified history for letters, attendance, rollovers)
```

### 5.3 Complete 14-table inventory

| \# | Table | Primary Responsibility | 
| ----- | ----- | ----- | 
| 1 | `academic_terms` | Academic year/semester context and single active-term enforcement | 
| 2 | `officers` | Stable user profile linked to `auth.users` | 
| 3 | `officer_appointments` | Historical position title and `permission_tier` (`admin` or `member`) per academic term | 
| 4 | `events` | Semester activity roadmap (`planned`) and active events (`published`, `completed`) | 
| 5 | `event_committees` | Event-specific committees and their designated `head_officer_id` (no members) | 
| 6 | `attendance_records` | Event or meeting attendance session header | 
| 7 | `attendance_entries` | Per-officer attendance status (`present`, `absent`, `late`, `excused`) | 
| 8 | `resources` | Reusable form templates, Google Drive links, and organizational documents | 
| 9 | `requirements` | Deliverable definitions, deadlines, and target scopes | 
| 10 | `submissions` | Materialized officer assignments (`pending`) and submitted work/reviews | 
| 11 | `letters` | Endorsement letter metadata and overall workflow status | 
| 12 | `letter_signatories` | Ordered, independent signatory steps per endorsement letter | 
| 13 | `notifications` | In-app targeted notifications and organization-wide broadcast announcements | 
| 14 | `audit_logs` | Append-only audit trail for letters, attendance changes, and administrative actions | 

## 6. Complete PostgreSQL DDL (14-Table Schema)

### 6.1 Extensions and enums

```sql
create extension if not exists pgcrypto;

create type public.officer_account_status as enum (
  'active', 'suspended', 'inactive'
);

-- Strictly two permission tiers: 'admin' (President & Adviser) and 'member' (all other officers)
create type public.appointment_permission_tier as enum (
  'admin', 'member'
);

create type public.appointment_status as enum (
  'active', 'completed', 'resigned', 'revoked'
);

create type public.event_status as enum (
  'planned', 'draft', 'published', 'completed', 'cancelled'
);

create type public.venue_booking_status as enum (
  'not_required', 'pending', 'confirmed', 'rejected', 'cancelled'
);

create type public.attendance_status as enum (
  'present', 'absent', 'late', 'excused'
);

create type public.letter_status as enum (
  'draft', 'for_review', 'in_routing', 'completed', 'rejected', 'cancelled'
);

create type public.signatory_status as enum (
  'pending', 'signed', 'rejected', 'not_required'
);

create type public.requirement_scope as enum (
  'all_officers', 'event_leads_only', 'event_committee_heads', 'specific_officers'
);

create type public.submission_status as enum (
  'pending', 'submitted', 'late', 'approved', 'rejected'
);
```

### 6.2 Identity, terms, and appointments (Tables 1–3)

```sql
-- 1. Academic Terms
create table public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null, -- e.g. '2026-2027'
  name text not null,          -- e.g. 'First Semester', 'Second Semester'
  starts_on date,
  ends_on date,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (academic_year, name),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create unique index one_active_academic_term_idx
  on public.academic_terms (is_active)
  where is_active = true;

-- 2. Officers (Stable Profiles)
create table public.officers (
  id uuid primary key references auth.users(id) on delete restrict,
  email text not null unique,
  full_name text not null,
  student_id text unique,
  contact_number text,
  account_status public.officer_account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Officer Appointments (Term-Scoped Titles & Permissions)
create table public.officer_appointments (
  id uuid primary key default gen_random_uuid(),
  officer_id uuid not null references public.officers(id) on delete restrict,
  academic_term_id uuid not null references public.academic_terms(id) on delete restrict,
  position_title text not null, -- e.g. 'President', 'Faculty Adviser', 'Technical Director'
  permission_tier public.appointment_permission_tier not null default 'member',
  status public.appointment_status not null default 'active',
  starts_on date,
  ends_on date,
  notes text,
  created_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index idx_appointments_term_active
  on public.officer_appointments (academic_term_id, officer_id)
  where status = 'active';

create index idx_appointments_officer_history
  on public.officer_appointments (officer_id, created_at desc);
```

### 6.3 Events and event-scoped committees (Tables 4–5)

```sql
-- 4. Events (Includes Semester Roadmap 'planned' items & Active Events)
create table public.events (
  id uuid primary key default gen_random_uuid(),
  academic_term_id uuid not null references public.academic_terms(id) on delete restrict,
  title text not null,
  description text,
  venue text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.event_status not null default 'planned',
  venue_booking_status public.venue_booking_status not null default 'pending',
  lead_officer_id uuid references public.officers(id) on delete set null,
  created_by uuid references public.officers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at >= starts_at)
);

create index idx_events_term_starts
  on public.events (academic_term_id, starts_at);

-- 5. Event Committees (Event-Scoped Committees & Designated Heads Only)
create table public.event_committees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null, -- e.g. 'Technical', 'Creatives', 'Logistics'
  description text,   -- Responsibility or scope of the committee for this event
  head_officer_id uuid not null references public.officers(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Prevents duplicate committee names in the same event while allowing
  -- the same officer to head multiple committees in the same or different events
  unique (event_id, name)
);

create index idx_event_committees_event_id
  on public.event_committees (event_id);

create index idx_event_committees_head_officer_id
  on public.event_committees (head_officer_id);
```

### 6.4 Attendance (Tables 6–7)

```sql
-- 6. Attendance Records (Session Header)
create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  academic_term_id uuid not null references public.academic_terms(id) on delete restrict,
  event_id uuid references public.events(id) on delete set null,
  title text not null,
  held_at timestamptz not null,
  notes text,
  recorded_by uuid references public.officers(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 7. Attendance Entries (Per-Officer Status)
create table public.attendance_entries (
  id uuid primary key default gen_random_uuid(),
  attendance_record_id uuid not null references public.attendance_records(id) on delete cascade,
  officer_id uuid not null references public.officers(id) on delete restrict,
  status public.attendance_status not null,
  remarks text,
  updated_by uuid references public.officers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attendance_record_id, officer_id)
);

create index idx_attendance_entries_officer
  on public.attendance_entries (officer_id, attendance_record_id);
```

### 6.5 Resources, requirements, and submissions (Tables 8–10)

```sql
-- 8. Resources (Templates, Reusable Forms, and Drive Links)
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  academic_term_id uuid references public.academic_terms(id) on delete set null,
  name text not null,
  description text,
  category text not null default 'general', -- e.g. 'template', 'form', 'guideline', 'drive_folder'
  resource_url text not null,
  version text not null default '1.0',
  is_active boolean not null default true,
  created_by uuid references public.officers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 9. Requirements (Deliverables & Form Assignments)
create table public.requirements (
  id uuid primary key default gen_random_uuid(),
  academic_term_id uuid not null references public.academic_terms(id) on delete restrict,
  event_id uuid references public.events(id) on delete set null,
  template_resource_id uuid references public.resources(id) on delete set null,
  title text not null,
  description text,
  deadline timestamptz not null,
  target_scope public.requirement_scope not null default 'all_officers',
  is_published boolean not null default false,
  created_by uuid references public.officers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_requirements_term_deadline
  on public.requirements (academic_term_id, deadline);

-- 10. Submissions (Materialized Assignees + Deliverable Submissions)
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  officer_id uuid not null references public.officers(id) on delete restrict,
  status public.submission_status not null default 'pending',
  submission_url text,
  file_path text,
  submitted_at timestamptz,
  reviewed_by uuid references public.officers(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requirement_id, officer_id),
  check (submission_url is not null or file_path is not null or status = 'pending')
);

create index idx_submissions_officer_status
  on public.submissions (officer_id, status);
```

### 6.6 Endorsement letters, notifications, and audit logs (Tables 11–14)

```sql
-- 11. Letters (Endorsement Letter Metadata)
create table public.letters (
  id uuid primary key default gen_random_uuid(),
  academic_term_id uuid not null references public.academic_terms(id) on delete restrict,
  event_id uuid references public.events(id) on delete set null,
  title text not null,
  description text,
  overall_status public.letter_status not null default 'draft',
  file_path text,
  created_by uuid references public.officers(id) on delete set null,
  updated_by uuid references public.officers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 12. Letter Signatories (Ordered Independent Steps)
create table public.letter_signatories (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references public.letters(id) on delete cascade,
  step_order integer not null check (step_order > 0),
  office_or_designation text not null,
  signatory_name text,
  status public.signatory_status not null default 'pending',
  signed_at timestamptz,
  updated_by uuid references public.officers(id) on delete set null,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (letter_id, step_order)
);

-- 13. Notifications (Targeted Alerts & Broadcast Announcements)
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_officer_id uuid references public.officers(id) on delete cascade,
  is_broadcast boolean not null default false,
  title text not null,
  body text not null,
  related_table text,
  related_id uuid,
  read_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.officers(id) on delete set null,
  created_at timestamptz not null default now(),
  check (
    (is_broadcast = true and recipient_officer_id is null)
    or (is_broadcast = false and recipient_officer_id is not null)
  )
);

create index idx_notifications_recipient_unread
  on public.notifications (recipient_officer_id, created_at desc)
  where read_at is null or is_broadcast = true;

-- 14. Audit Logs (Unified Append-Only History)
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.officers(id) on delete set null,
  action text not null,
  entity_table text not null, -- e.g. 'letters', 'attendance_entries', 'academic_terms'
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_entity
  on public.audit_logs (entity_table, entity_id, created_at desc);
```

## 7. Database Security & RLS Strategy

### 7.1 Term-aware authorization helper functions

Because permissions derive strictly from the two-tier (`admin` / `member`) model in the active academic term, RLS policies use two clean `SECURITY DEFINER` boolean helper functions: `current_officer_is_active()` and `current_officer_is_admin()`.

```sql
-- 1. Check if current user is an active officer
create or replace function public.current_officer_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.officers o
    where o.id = (select auth.uid())
      and o.account_status = 'active'
  );
$$;

-- 2. Check if current user holds an active 'admin' appointment (President or Adviser) in the active term
create or replace function public.current_officer_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.officers o
    join public.officer_appointments oa on oa.officer_id = o.id
    join public.academic_terms at on at.id = oa.academic_term_id
    where o.id = (select auth.uid())
      and o.account_status = 'active'
      and oa.status = 'active'
      and at.is_active = true
      and oa.permission_tier = 'admin'
  );
$$;

revoke all on function public.current_officer_is_active() from public;
grant execute on function public.current_officer_is_active() to authenticated;

revoke all on function public.current_officer_is_admin() from public;
grant execute on function public.current_officer_is_admin() to authenticated;
```

### 7.2 Concrete RLS policies for `event_committees`

```sql
alter table public.event_committees enable row level security;

-- 1. Read: Any active officer can view event committee assignments
create policy "Active officers can view event committees"
  on public.event_committees
  for select
  to authenticated
  using (public.current_officer_is_active());

-- 2. Insert: Admin (President/Adviser) or the Event Lead can create event committees
create policy "Admin or Event Lead can create event committees"
  on public.event_committees
  for insert
  to authenticated
  with check (
    public.current_officer_is_admin()
    or exists (
      select 1 from public.events e
      where e.id = event_id
        and e.lead_officer_id = (select auth.uid())
    )
  );

-- 3. Update: Admin or Event Lead can update anything; designated Committee Head can update scope/description
create policy "Admin, Event Lead, or Committee Head can update event committees"
  on public.event_committees
  for update
  to authenticated
  using (
    public.current_officer_is_admin()
    or exists (
      select 1 from public.events e
      where e.id = event_id
        and e.lead_officer_id = (select auth.uid())
    )
    or head_officer_id = (select auth.uid())
  )
  with check (
    case
      when (
        not public.current_officer_is_admin()
        and not exists (
          select 1 from public.events e
          where e.id = event_id and e.lead_officer_id = (select auth.uid())
        )
      ) then (
        -- Committee Head cannot reassign head_officer_id or move the committee to another event
        head_officer_id = (select auth.uid())
        and event_id = (select ec.event_id from public.event_committees ec where ec.id = id)
      )
      else true
    end
  );

-- 4. Delete: Admin (President/Adviser) or Event Lead
create policy "Admin or Event Lead can delete event committees"
  on public.event_committees
  for delete
  to authenticated
  using (
    public.current_officer_is_admin()
    or exists (
      select 1 from public.events e
      where e.id = event_id
        and e.lead_officer_id = (select auth.uid())
    )
  );
```

### 7.3 RLS policy matrix across all 14 tables

| Table | `SELECT` Policy | `INSERT` / `UPDATE` / `DELETE` Policy | 
| ----- | ----- | ----- | 
| `academic_terms` | Active officers | `admin` only | 
| `officers` | Active officers | `admin` only (self may update own contact number) | 
| `officer_appointments` | Active officers | `admin` only | 
| `events` | Active officers | `admin` or assigned `lead_officer_id` | 
| `event_committees` | Active officers | `admin` or Event Lead (`UPDATE` description allowed for `head_officer_id`) | 
| `attendance_records` | Active officers | `admin` only | 
| `attendance_entries` | Own rows (or all active officers if open-roster policy chosen); `admin` reads all | `admin` only | 
| `resources` | Active officers | `admin` only | 
| `requirements` | Active officers | `admin` or parent Event Lead | 
| `submissions` | Own rows; `admin` or parent Event Lead reads all | Assignees update own submission fields; `admin` or Event Lead inserts `'pending'` rows and updates review fields | 
| `letters` | Active officers | Active officers (status completion validated against `letter_signatories`) | 
| `letter_signatories` | Active officers | Active officers | 
| `notifications` | Own rows (`recipient_officer_id = auth.uid()`) or `is_broadcast = true` | `admin` creates broadcasts; server actions create alerts; recipient marks `read_at` | 
| `audit_logs` | `admin` (and active officers for `entity_table = 'letters'`) | Inserted via database triggers / trusted server actions only; no `UPDATE` or `DELETE` | 

## 8. Application Architecture

Streamlined Next.js App Router structure aligned with the 14-table model:

```
src/
├── app/
│   ├── (auth)/
│   │   └── login/
│   ├── (dashboard)/
│   │   ├── page.tsx                 # Active term overview, upcoming events & personal pending deliverables
│   │   ├── directory/               # Officer profiles & appointment history by term
│   │   ├── events/                  # Semester roadmap ('planned'), calendar & event_committees workspace
│   │   ├── deliverables/            # Requirements & unified submissions tracker
│   │   ├── attendance/              # Personal attendance history & Admin recording console
│   │   ├── letters/                 # Endorsement letter pipeline & signatory checklist
│   │   ├── resources/               # Form templates & Google Drive repository
│   │   └── notifications/           # Broadcast announcements & personal inbox
│   ├── admin/
│   │   ├── appointments/            # Manage term appointments & admin/member tiers
│   │   ├── terms/                   # Academic term management & transactional rollover wizard
│   │   └── audit-logs/              # System-wide audit trail viewer
│   └── api/
│       ├── auth/callback/
│       ├── cron/reminders/          # Automated deadline reminders
│       └── vision/extract-routing/  # Optional AI signatory extraction
├── components/
│   ├── dashboard/
│   ├── directory/
│   ├── events/                      # Event card, EventCommitteeList, AssignCommitteeHeadModal
│   ├── deliverables/
│   ├── attendance/
│   ├── letters/
│   └── ui/
└── lib/
    ├── supabase/
    ├── permissions/
    ├── email/
    └── validation/
```

## 9. Core Day-to-Day Workflows

### A. Event creation and Committee Head assignment (e.g., Hinabo 2026)

1. **Event Creation:** An Admin (President or Adviser) creates `Hinabo 2026` under the active academic term.

2. **Committee Definition & Head Assignment:** Inside the `Hinabo 2026` workspace, the Admin adds rows to `event_committees`:

   * `Technical` $\rightarrow$ `head_officer_id`: Marchus (*"Responsible for technical operations and equipment"*)

   * `Creatives` $\rightarrow$ `head_officer_id`: Officer B (*"Responsible for graphics and publicity materials"*)

   * `Logistics` $\rightarrow$ `head_officer_id`: Officer C (*"Responsible for venue and event materials"*)

3. **Multiple Assignments Support:** If Marchus is also needed to lead *Documentation* for `Hinabo 2026`, the Admin adds a fourth row (`name = 'Documentation'`, `head_officer_id = Marchus`). The schema permits this seamlessly because uniqueness is scoped to `(event_id, name)`.

4. **No Sub-Member Overhead:** No committee members are entered or tracked; each Committee Head is directly accountable for their area.

5. **Strict Event Isolation:** When the Admin later creates *General Assembly 2026*, its `event_committees` list starts completely empty.

### B. Deliverable & form requirement workflow

1. An Admin (or Event Lead) creates a requirement (e.g., *"Committee Budget & Equipment Request"*), links `event_id = Hinabo 2026`, optionally attaches a Google Doc template from `resources` (`template_resource_id`), and selects `target_scope = 'event_committee_heads'`.

2. Upon publication, the server queries `select distinct head_officer_id from event_committees where event_id = ...` and inserts a row into `submissions` (`status = 'pending'`) for Marchus, Officer B, and Officer C.

3. Each Committee Head sees the pending item in their personal deliverables queue, completes the template, and submits the link.

4. The Admin or Event Lead reviews and marks each submission `'approved'` or `'rejected'`.

### C. Academic term rollover

1. At the end of the semester, an Admin (President or Adviser) opens the Rollover Wizard.

2. The system previews the outgoing term (`2026-2027, First Semester`) and the incoming term (`2026-2027, Second Semester`), along with the proposed roster of `officer_appointments`.

3. Upon confirmation, a single database transaction:

   * Marks all active appointments in the outgoing term as `'completed'`.

   * Sets `is_active = false` on the outgoing term and `is_active = true` on the incoming term.

   * Inserts the new term's `officer_appointments` rows (assigning `permission_tier = 'admin'` to the incoming President and Faculty Adviser, and `'member'` to all other officers).

   * Writes an entry to `audit_logs`.

4. All historical events, `event_committees`, attendance records, letters, and submissions from the previous term remain intact and browsable by filtering on `academic_term_id`.

## 10. Implementation Roadmap

### Phase 1 — Core Foundation & Term-Bound Security (Tables 1–3, 14)

* Configure Supabase project, Auth, and database migrations for `academic_terms`, `officers`, `officer_appointments`, and `audit_logs`.

* Implement `current_officer_is_active()` and `current_officer_is_admin()` RLS functions.

* Build the Officer Directory, Appointment Manager, and Term Rollover Wizard.

### Phase 2 — Events & Event-Scoped Committees (Tables 4–5)

* Implement `events` (supporting `'planned'` semester roadmap items through `'completed'` events) and `event_committees`.

* Build the Event Detail workspace where Admins assign Committee Heads (`head_officer_id`) and scopes (`description`).

### Phase 3 — Unified Deliverables & Resources (Tables 8–10)

* Implement `resources`, `requirements`, and `submissions`.

* Build target scope resolution (`all_officers`, `event_leads_only`, `event_committee_heads`, `specific_officers`) that materializes `'pending'` rows in `submissions`.

* Build the officer submission portal and reviewer approval console.

### Phase 4 — Attendance & Endorsement Letters (Tables 6–7, 11–12)

* Implement `attendance_records` and `attendance_entries` locked to the `admin` permission tier.

* Implement `letters` and `letter_signatories` with audit logging into `audit_logs`.

* Add optional server-side AI vision route for extracting draft signatory steps.

### Phase 5 — Notifications, Reminders & Handover (Table 13)

* Implement `notifications` for targeted alerts and broadcast announcements.

* Configure daily cron job for 48-hour deadline email reminders via Resend.

* Finalize backup/export scripts and handover documentation for incoming Technical Directors.

## 11. Testing & Acceptance Criteria

1. **Event Committee Isolation:** Verify that creating committees under *Hinabo 2026* (`Technical`, `Creatives`, `Logistics`) does not create global committees or carry over to other events, and that the same officer can be assigned as `head_officer_id` for multiple committees in the same event.

2. **Rollover Privilege Expiration:** Verify that when an officer with `permission_tier = 'admin'` in Term 1 is appointed with `permission_tier = 'member'` in Term 2, they immediately lose administrative write access once Term 2 becomes active.

3. **Deliverable Snapshot Integrity:** Verify that publishing a requirement for `'event_committee_heads'` creates `'pending'` rows in `submissions` for all current heads of that event, and that deduplication prevents duplicate rows if an officer heads two committees in the same event.

4. **Admin Attendance & Governance Exclusivity:** Verify via RLS tests that officers with `permission_tier = 'member'` cannot `INSERT`, `UPDATE`, or `DELETE` rows in `attendance_records`, `attendance_entries`, `officer_appointments`, or `academic_terms`.

5. **Endorsement Letter Completion Guard:** Verify that a letter cannot be marked `overall_status = 'completed'` while any of its `letter_signatories` rows has `status = 'pending'` or `'rejected'`.

## 12. Remaining Organizational Policy Confirmations

Before launching to production, confirm these three operational choices with SYCOMP leadership:

1. **Directory Contact Visibility:** Should `contact_number` and `student_id` on `officers` be visible to all active officers, or restricted to `admin` (President and Adviser)?

2. **Attendance Roster Visibility:** Can `member` officers view the full attendance table for meetings, or only their own `attendance_entries` rows?

3. **Alumni Read-Only Access:** When an officer graduates, should their `account_status` be set to `'inactive'` (revoking login while keeping historical attribution), or should alumni retain read-only portal access?