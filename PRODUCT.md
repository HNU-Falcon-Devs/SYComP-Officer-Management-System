# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary Operational Users (Priority Context):** Student **Officers** (`OFFICER`), event-scoped **Committee Heads**, **Executives** (`EXECUTIVE` — Faculty Adviser, President, VP Internal, VP External), and the **Super Admin** (`SUPER_ADMIN` — Technical Director / System Maintainer) of the Society of Young Computer Professionals (SYComP) at Holy Name University. They run daily organizational governance, draft and review event proposals, coordinate temporary event committees and deliverables, classify official documents into Google Drive, operate live event QR attendance checkpoints under queue pressure, and manage semester masterlists and academic term transitions.
- **Secondary Audience (Isolated Read-Only Self-Service):** General **Members** (`MEMBER` — enrolled Holy Name University BSIT/BSCS computing students pre-provisioned from official semester masterlists). They check published events, personal attendance history, and official announcements on mobile, and complete account security self-service (binding their `@hnu.edu.ph` university email via OTP and replacing their default password).

## Product Purpose

SYComP OMS centralizes the internal operations, leadership transitions, event structures, deliverable tracking, attendance logging, and institutional archives of the Society of Young Computer Professionals—replacing fragmented spreadsheets, scattered personal cloud folders, and informal group-chat tracking.

Success means:
- Enrolled computing students from each semester's masterlist can log in immediately with zero manual sign-up friction.
- Governance boundaries between `Member`, `Officer`, `Committee Head`, `Executive`, and `Super Admin` are strictly enforced on the server.
- Live event QR attendance verification runs reliably in under 1.5 seconds per scan with explicit visual confirmation.
- Uploaded organizational documents auto-classify into structured Google Drive folders linked to trackable records.
- Consecutive academic terms remain independently queryable without overwriting prior officer appointments, event committees, or attendance history.

## Positioning

Purpose-built for an annual-turnover university computing student organization running entirely on $0/month free-tier infrastructure, SYComP OMS combines four mechanisms rarely unified in generic student-club or team tools:
1. **3-layer decoupled RBAC:** Separates global system tiers (`SUPER_ADMIN`, `EXECUTIVE`, `OFFICER`, `MEMBER`), event-scoped `Committee Head` authority, and non-authoritative historical officer position titles.
2. **Academic-term institutional continuity:** Zero hard deletes on historical records so leadership transitions never erase organizational memory.
3. **Online-only 2-step QR attendance verification:** Non-mutating lookup followed by explicit officer confirmation (`Scan -> Verify Card -> Confirm`) with live duplicate, active-account, and officer-attendance guards.
4. **Direct-to-Drive resumable auto-classified archiving:** Bypasses serverless body limits (up to 15 MB) while filing documents into deterministic term/type/event folder paths inside SYComP's Google Drive.

## Operating Context

- **Priority Trade-Off Rule:** Prioritize Officer/Executive operational speed and live-event QR scanning reliability first, while keeping the Member Portal ultra-simple, uncluttered, and strictly read-only.
- **Dual-Shell Separation:** Shell A (`/portal/*`) serves `MEMBER` accounts as a mobile-first read-only portal; Shell B serves `OFFICER`, `EXECUTIVE`, and `SUPER_ADMIN` accounts as a collapsible-sidebar workspace covering `/dashboard`, `/scanner`, `/events` (with the tabbed `/events/[slug]` Event Hub), isolated `/meetings`, `/tasks`, `/documents`, `/announcements`, `/directory`, `/account`, and `/admin/*`.
- **Live Event Attendance Scene:** Officers run `/scanner` on personal phones (installed PWA) or laptops at campus venues (e.g., HNU Barder Hall) with a manual student ID fallback for damaged IDs. Offline attendance confirmation queuing is strictly prohibited—live server checks must run before any confirmation commits.
- **Semester Transitions & Masterlists:** Each term begins with bulk CSV/XLSX masterlist import (1,000–2,000 students) via a pre-commit duplicate/discrepancy preview and batched transactional commit, plus atomic academic term rollover that archives outgoing appointments and revokes downgraded sessions.
- **Institutional Email Domain:** Official university email domain for OTP verification, password recovery, and domain-scoped Drive sharing is `hnu.edu.ph`.

## Capabilities and Constraints

- **Stack & Runtime Architecture:** Next.js App Router (TypeScript strict) modular monolith with Drizzle ORM (`postgres-js` server-side only—no client Supabase SDK), Supabase PostgreSQL (21 tables, PostgREST RLS lockdown, immutable `audit_logs`), Google Drive API v3 (OAuth2 refresh token, 3-phase resumable upload up to 15 MB), swappable email adapter (Resend / SMTP), and Serwist PWA packaging (`NetworkOnly` on `/api/*`).
- **Non-Negotiable Security Invariants:** Every API route handler, Server Action, and protected Server Component loader must call centralized `authorize()`. Never branch RBAC on `officer_appointments.position_title`. Never hard-delete historical records (`users`, `academic_terms`, `officer_appointments`, `events`, `meetings`, `attendance_records`). Passwords hash with Node.js `crypto.scrypt`; OTPs hash with `HMAC-SHA256`; never expose credential hashes or secrets in DTOs or audit logs. Attendance checkpoints are configured and toggled strictly by `EXECUTIVE` (or `SUPER_ADMIN` with `break_glass: true` and `reason >= 10 chars`).
- **Repository Ownership Constraints:** Two-developer workflow enforced by `AGENTS.md` and `.github/CODEOWNERS` across Locked Shared Core (`chore/core-*`), Track A (`feat/a-*`), and Track B (`feat/b-*`). Never commit directly to `main`.
- **Explicit v1 Exclusions (Do Not Build):** In-app student attendance dispute ticketing queue (discrepancies are verified offline and corrected directly by an `Executive` with mandatory audit logging), peer-to-peer chat, social feeds or public comment threads, LMS features, online payment processing, or replacement of the university SIS.
- **Domain Terminology:** Preserve canonical system terms (`Academic Term`, `Officer Appointment`, `Committee Head`, `Event Proposal`, `Checkpoint`, `Break-Glass Override`, `Masterlist Import`) and exact lifecycle status names (`ACTIVE`, `NEEDS_REVIEW`, `DISABLED`; `DRAFT`, `PENDING_REVIEW`, `NEEDS_REVISION`, `APPROVED`, `PUBLISHED`, `COMPLETED`, `REJECTED`; `TO_DO`, `IN_PROGRESS`, `FOR_REVIEW`, `DONE`; `SCHEDULED`, `OPEN`, `CLOSED`; `PRESENT`, `LATE`, `EXCUSED`, `ABSENT`).

## Brand Commitments

- **Organization & Product Name:** Society of Young Computer Professionals (SYComP) — Holy Name University; product name **SYComP OMS** (short name **SYComP**).
- **Voice:** Crisp, institutional student-organization voice—direct, structured, accountable, and concise without casual filler or marketing hype.
- **Binding UI Commitments:** Strictly zero emojis across all UI surfaces (`lucide-react` icons only); structured operational identifiers (`student_id_number`, `academic_terms.code`, timestamps, and audit keys) rendered in monospace; Shadcn/ui primitives; Light and Dark theme support anchored to the official SYComP brand identity in `docs/inspo/Banner.png` and `docs/05 — ui-ux-and-information-architecture.md` (which holds final authority on SYComP tokens, dual-shell structure, and the 2-step QR Verification Card).

## Evidence on Hand

- **Authoritative Blueprint Documentation:** `AGENTS.md`, `PLAN.md`, and `docs/00`–`docs/06` (`00 — Project Charter`, `01 — Requirements Specification`, `02` & `02b` organizational workflows and business rules, `03 — Domain Model & Data Dictionary`, `04 — Roles, Permissions & Security`, `05 — ui-ux-and-information-architecture.md`, `06 — technical-architecture.md`).
- **Official Visual Reference:** `docs/inspo/Banner.png` (Holy Name University — Society of Young Computer Professionals banner depicting the official SYComP emblem).
- **Known Absences (Do Not Fabricate):** Standalone SYComP emblem assets (`public/brand/`) and exported PWA icons (`public/icons/` in `192x192`, `512x512`, and `maskable` variants) have not been added to the repository yet and must be supplied by the team rather than invented. No live usage metrics, testimonials, or implemented feature screens exist yet (repository is at M0 foundation harness stage).

## Product Principles

1. **Governance integrity over convenience:** Enforce 3-layer RBAC, online-only live attendance checks, immutable audit trails, and zero hard deletes on every mutation without shortcuts.
2. **Operational speed for officers, zero clutter for members:** Optimize Shell B and `/scanner` for rapid, low-error execution during live campus operations while keeping Shell A strictly read-only, calm, and scannable on mobile.
3. **Institutional continuity across terms:** Structure every appointment, committee, attendance record, and classified Drive document so annual officer turnover adds to a permanent archive rather than resetting it.
4. **Verify before committing high-stakes changes:** Make identity checks (2-step QR Verification Card), bulk masterlist imports (pre-commit discrepancy preview), and `Super Admin` break-glass overrides (mandatory audit reason) explicit before persistence.
5. **Zero-cost maintainability for student successors:** Keep the modular monolith lean, standard, and well-documented so incoming student Technical Directors can operate and extend the system on $0 free-tier infrastructure.

## Accessibility & Inclusion

- Target **WCAG 2.1 AA** contrast and interaction compliance across both Light and Dark themes.
- Provide full keyboard navigation (`Tab`, `Enter`, `Escape`) with visible focus rings, semantic ARIA landmarks (`<nav>`, `<main>`, `<aside>`), `aria-live="polite"` announcements for the QR Verification Card and toast feedback, and explicit `<label>` bindings on all form fields.
- Enforce a `44px x 44px` minimum mobile touch target size and respect safe-area insets (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`) across mobile headers, bottom navigation, and scanner controls.
- Never convey status by color alone—pair every status indicator with a clear text label and a distinct `lucide-react` icon.
