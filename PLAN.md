# PLAN.md — SYComP OMS v1 Execution Roadmap

> **Workflow Rule:** Complete **M0** and **M1** sequentially on `main` (via `chore/core-*` PRs) before branching into parallel **Track A (`@itsMarchus`)** and **Track B (`@Syris-EkzD`)** feature work. Always open a fresh agent session per slice and verify the active branch prefix before editing.

## Contributors & Branch Conventions
| Track | Owner | Branch Prefix | Scope |
| :--- | :--- | :--- | :--- |
| **Locked Shared Core** | `@itsMarchus` | `chore/core-*` | Schema, migrations, auth, audit, config, globals, packages, docs, agent rules |
| **Track A** | `@itsMarchus` | `feat/a-*` | Auth UI, Admin/Terms/Masterlist, Directory, QR Scanner/Attendance, Drive Documents, Meetings |
| **Track B** | `@Syris-EkzD` | `feat/b-*` | Dual Shells, PWA, Member Portal, Dashboard, Events/Proposals/Committees, Tasks, Announcements |
| **Joint Release** | `@itsMarchus` + `@Syris-EkzD` | `chore/release-*` | Integration QA, production hardening, `docs/07`–`09` handover |

---

## Phase 0 — Shared Foundation (Sequential on `main`)

### M0: Harness, Tokens & Agent Setup `[Core — @itsMarchus]` · `chore/core-m0-harness`
- [x] Reconcile the 5 cross-document drifts in `docs/00`–`05` (hashing, Drive OAuth2, Executive-only checkpoints, no in-app dispute queue, 21-table parity)
- [x] Scaffold Next.js App Router (`TypeScript` strict, `pnpm`) + Tailwind CSS + Shadcn/ui + `lucide-react` + `next-themes` + `sonner`
- [x] Configure SYComP Light/Dark CSS tokens (`docs/05` Sec 2.2) and `Inter` + `JetBrains Mono` fonts in `src/app/globals.css`
- [x] Create `src/config/env.ts` (Zod-validated), `src/config/routes.ts`, and `src/config/permissions.ts`
- [x] Configure ESLint, Prettier, Vitest (wired to real local/dev PostgreSQL via `DIRECT_DATABASE_URL`), and `.github/workflows/validation.yml` (`lint` + `typecheck` + `test` + `build`)
- [x] Commit `AGENTS.md`, `PLAN.md`, `.agents/skills/impeccable/SKILL.md`, `.agents/rules/ui-standards.md`, and `.github/CODEOWNERS`
- [x] **Gate:** `pnpm typecheck`, `pnpm lint`, and smoke test pass on CI; Antigravity and Codex both discover `AGENTS.md` and `impeccable`

### M1: 21-Table Schema & Security Core `[Core — @itsMarchus]` · `chore/core-m1-schema-security`
- [x] Define all 21 Drizzle tables in `src/db/schema/` (19 domain entities + `user_sessions` + `rate_limit_buckets`) with all `CHECK` constraints, partial unique indexes, and composite FKs (`docs/03`)
- [x] Configure `src/db/index.ts` (Supavisor transaction pooler `prepare: false`) and `drizzle.config.ts` (strictly `DIRECT_DATABASE_URL`)
- [x] Generate and apply initial SQL migration including the `audit_logs` `BEFORE UPDATE OR DELETE` immutability trigger and PostgREST RLS lockdown on all 21 tables (`docs/06` Sec 6.3)
- [x] Implement `src/lib/auth/password.ts` (`crypto.scrypt`, constant-time verify, surname normalizer) and `src/lib/auth/session.ts` (`user_sessions`, 24h/8h idle timeout, 7d cap, instant revocation)
- [x] Implement centralized 6-stage `src/lib/auth/authorize.ts` (Layers 0–3, temporal locks, and `SUPER_ADMIN` Break-Glass requiring `break_glass: true` + `reason >= 10 chars`)
- [x] Implement `src/lib/audit.ts` (transactional append-only writer + credential key redactor), `src/lib/security/rate-limit.ts`, `sanitize.ts` (`sanitize-html`), and `csv-safe.ts`
- [x] Implement `src/lib/email/` (`ConsoleEmailProvider`, `ResendEmailProvider`, `SmtpEmailProvider` with strict `UNIVERSITY_EMAIL_DOMAIN` check) and `src/db/seed.ts`
- [x] **Gate:** Core RBAC, session revocation, audit immutability, and constraint tests (`SEC-TEST-01`–`08` foundations) pass against real Postgres

---

## Phase 1 — Parallel Feature Tracks (Branch from `main` after M1)

### M2A: Auth, Academic Terms & Masterlist `[Track A — @itsMarchus]` · `feat/a-auth-terms-masterlist`
- [x] Build `/login`, `/forgot-password`, `/account-hold`, and `/api/auth/*` (rate-limited login, non-enumeration errors, strict `UNIVERSITY_EMAIL_DOMAIN` 6-digit `HMAC-SHA256` OTP binding & password reset)
- [x] Build `/admin/terms` and `/api/admin/terms/*` (single-active-term atomic rollover, Officer Appointments CRUD, atomic `users.system_role` sync + session revocation on downgrade)
- [x] Build `/admin/masterlist` and `/api/admin/masterlist/*` (CSV/XLSX pre-commit duplicate/discrepancy preview + 200-row batched transactional commit + `NEEDS_REVIEW` flagging)
- [x] Build `/directory` (searchable active/historical Officers and General Members directory + `Super Admin` soft-disable/reactivation controls)
- [x] **Gate:** `AC-01`, `AC-08`, `SEC-TEST-05`, and `SEC-TEST-07` pass

### M2B: Dual Shells, PWA & Member Portal `[Track B — @Syris-EkzD]` · `feat/b-shells-pwa-portal`
- [ ] Build Shell A (`src/components/shells/`): mobile 5-tab bottom bar (`44x44px` touch targets), desktop top nav, theme toggle, and conditional first-login security onboarding banner
- [ ] Build Shell B (`src/components/shells/`): collapsible desktop sidebar, mobile `Sheet` drawer, Active Term pill, role tier badge, and quick `/scanner` header shortcut
- [ ] Configure `src/app/manifest.ts`, SYComP PWA icons (`192x192`, `512x512`, `maskable`), and Serwist (`src/app/sw.ts` with explicit `NetworkOnly` on `/api/*`, `no-cache` SW response headers, and offline detection banner)
- [ ] Build read-only Member Portal (`/portal`, `/portal/calendar`, `/portal/attendance`, `/portal/announcements`, `/portal/account`, `/api/portal/*`) and Officer `/account` self-service page
- [ ] **Gate:** `AC-02` (`403` member isolation), zero-emoji Lucide audit, and mobile responsive checks pass

### M3A: Dynamic Attendance & 2-Step QR Scanner `[Track A — @itsMarchus]` · `feat/a-attendance-scanner`
- [x] Build Executive-only (plus `SUPER_ADMIN` break-glass) checkpoint CRUD and `SCHEDULED`/`OPEN`/`CLOSED` state toggle endpoints
- [x] Build `/api/attendance/lookup` (`< 300ms` non-mutating 5-state verification check) and `/api/attendance/confirm` (server-authoritative UTC log, duplicate guard, officer-attendance `403` guard, active-account guard)
- [x] Build `/scanner` (`html5-qrcode` camera viewfinder, 5-state Verification Card, manual ID fallback, live recent scans feed, offline submit block)
- [x] Build Executive manual attendance entry/override modal (mandatory `edit_reason` + audit log), formula-safe CSV export (`/api/attendance/export`), and `src/components/event-hub/attendance-tab.tsx`
- [x] **Gate:** `AC-06`, `AC-07`, `SEC-TEST-04`, and `< 1.5s` end-to-end scan latency verified

### M3B: Events, Committees, Tasks & Announcements `[Track B — @Syris-EkzD]` · `feat/b-events-tasks-announcements`
- [x] Build reusable rich-text editor (`src/components/editor/rich-text-editor.tsx`) backed by server-side `sanitize-html` *(zero-dependency toolbar + safe React preview; `package.json` Locked Core untouched)*
- [x] Build `/events` (filterable list/calendar + Proposal Workspace), `/events/new`, and `/api/events/*` enforcing full proposal-to-archive state transitions and Executive publish gate
- [x] Build `/events/[slug]` Single Tabbed Event Hub (`Overview`, `Committees`, `Tasks`, plus mounting slots for `<EventAttendanceTab />` and `<EventDocumentsTab />` passing `{ eventId, eventStatus, userRole }`)
- [x] Build event-scoped Committees (single active Officer `Committee Head`, roster management) and `/tasks` (personal queue + committee/event deliverable board)
- [ ] Build `/announcements` (`DRAFT`/`PUBLISHED`/`ARCHIVED`, `ALL_MEMBERS` vs `OFFICERS_ONLY`), role-aware `/dashboard` cockpits (`Officer`, `Executive`, `Super Admin`), and reusable `SUPER_ADMIN` Break-Glass confirmation modal *(Break-Glass modal done at `src/components/ui/break-glass-modal.tsx`; `/announcements` & `/dashboard` pending)*
- [ ] **Gate:** `AC-03`, `AC-04`, `AC-05`, `SEC-TEST-02`, `SEC-TEST-03`, `SEC-TEST-06`, and `SEC-TEST-08` pass *(Events, Committees & Tasks criteria verified on `feat/b-tasks`; Announcements & Dashboard pending)*

### M4A: Google Drive Documents, Meetings & Audit UI `[Track A — @itsMarchus]` · `feat/a-drive-meetings-audit`
- [x] Build `src/lib/drive/classifier.ts` (`resolveDriveFolderPath`), OAuth2 Refresh Token client, `drive_folder_cache` traversal, and configurable `DRIVE_SHARE_MODE` (`domain` | `unlisted`)
- [x] Build 3-phase Direct-to-Drive resumable upload (`/api/documents/upload-init` with HMAC-signed `uploadIntentToken`, `/upload-finalize` verifying actual MIME/size/parent + compensating orphan cleanup, `/external`)
- [x] Build `/documents`, `/admin/settings` (dynamic `document_types` manager), and `src/components/event-hub/documents-tab.tsx`
- [x] Build isolated `/meetings` & `/meetings/[id]` (Executive scheduling, rich-text agenda/minutes, officer-only checkpoints, hard `403` for `MEMBER`)
- [x] Build `/admin/audit-logs` (searchable immutable ledger with redacted before/after JSON diff viewer)
- [ ] **Gate:** `AC-09` and end-to-end 15 MB Direct-to-Drive upload + orphan-cleanup verified *(automated via MockDriveProvider + orphan-cleanup tests; live 15 MB Google Drive OAuth upload verified in M5 staging)*

---

## Phase 2 — Integration, QA & Launch (Joint)

### M5: Integration, Free-Tier Ops & Handover `[Joint — @itsMarchus + @Syris-EkzD]` · `chore/release-v1`
- [ ] Wire `<EventAttendanceTab />` and `<EventDocumentsTab />` cleanly inside `/events/[slug]` and verify zero cross-tab regressions
- [ ] Run full `AC-01`–`AC-09` and `SEC-TEST-01`–`08` regression suite on Vercel Preview (`sin1`) + Staging Supabase (`ap-southeast-1`)
- [ ] Confirm Google Cloud OAuth Consent Screen is set to **"In Production"** so the SYComP Drive Refresh Token does not expire every 7 days
- [ ] Configure GitHub Actions: 5-day Supabase keep-alive ping (`GET /api/health`) and weekly encrypted `pg_dump` backup (`docs/06` Sec 12)
- [ ] Author final `docs/07-testing-and-qa.md`, `docs/08-deployment-and-handover.md`, and `docs/09-decision-log.md` synchronized with the shipped v1 codebase
- [ ] **Gate:** Production launch checklist green and handover docs `00`–`09` complete