# AGENTS.md — SYComP OMS

## Project Overview
SYComP Organizational Management System (SYComP OMS) is a full-stack Next.js (App Router, TypeScript strict) + Drizzle ORM + Supabase PostgreSQL + Google Drive API v3 modular monolith running on $0 free-tier infrastructure.

## Exact Commands (Run Before Finishing Any Task)
- Dev server: `pnpm dev`
- Type check: `pnpm typecheck`
- Lint: `pnpm lint`
- Test suite: `pnpm test`
- Single test: `pnpm vitest run <path>`
- Generate migration (Dev 1 on `chore/core-*` ONLY): `pnpm db:generate`
- Apply migration (requires `DIRECT_DATABASE_URL`): `pnpm db:migrate`

## Document Routing Map (Read Only What Applies to Your Task)
- Scope & Non-Goals: `docs/00-project-charter.md`
- Requirements & Acceptance Criteria (`AC-01`–`AC-09`): `docs/01-requirements-specification.md`
- Workflows & Business Rules (`BR-*`): `docs/02-organizational-workflow-and-policies.md`, `docs/02b-business-rules-and-workflows.md`
- 21-Table Schema & Constraints: `docs/03-domain-model-and-data-dictionary.md`
- 3-Layer RBAC, Break-Glass & `SEC-TEST-01`–`08`: `docs/04-roles-permissions-and-security.md`
- UI Tokens, Dual Shells, PWA & 2-Step QR Scanner: `docs/05-ui-ux-and-information-architecture.md`
- Tech Stack, Drizzle, `scrypt`, Drive Resumable Upload & Email Adapter: `docs/06-technical-architecture.md`
- Milestone Checklist: `PLAN.md`

## Team Ownership & Anti-Conflict Boundaries (2-Developer Repo)
Before editing any file, run `git branch --show-current` to confirm your active track:
- `chore/core-*` or `feat/a-*` -> **Track A / Locked Core (`@itsMarchus`)**
- `feat/b-*` -> **Track B (`@Syris-EkzD`)**
- Never commit directly to `main`.

### Path Ownership
- **Locked Shared Core (`@itsMarchus` ONLY):** `src/db/schema/*`, `drizzle/*`, `src/lib/auth/*`, `src/lib/audit.ts`, `src/lib/security/*`, `src/lib/email/*`, `src/config/*`, `src/app/globals.css`, `package.json`, `pnpm-lock.yaml`, `docs/*`, `AGENTS.md`, `.agents/*`, `.github/*`
- **Track A (`@itsMarchus`):** `src/app/(auth)/`, `src/app/api/auth/`, `src/app/(workspace)/admin/`, `src/app/api/admin/`, `src/app/(workspace)/directory/`, `src/app/(workspace)/scanner/`, `src/app/api/attendance/`, `src/components/scanner/`, `src/app/(workspace)/documents/`, `src/app/api/documents/`, `src/lib/drive/`, `src/app/(workspace)/meetings/`, `src/app/api/meetings/`, `src/components/event-hub/attendance-tab.tsx`, `src/components/event-hub/documents-tab.tsx`
- **Track B (`@Syris-EkzD`):** `src/app/manifest.ts`, `src/app/sw.ts`, `src/app/(portal)/`, `src/app/api/portal/`, `src/components/shells/`, `src/components/ui/`, `src/app/(workspace)/dashboard/`, `src/app/(workspace)/account/`, `src/app/(workspace)/events/`, `src/app/api/events/`, `src/components/event-hub/` (excluding `attendance-tab.tsx` & `documents-tab.tsx`), `src/components/editor/`, `src/app/(workspace)/tasks/`, `src/app/api/tasks/`, `src/app/(workspace)/announcements/`, `src/app/api/announcements/`

### Anti-Conflict Rules
1. **Hard Stop on Locked Core:** On a `feat/b-*` branch, NEVER edit Locked Core files or run `pnpm db:generate`. If a Track B task requires a new package, route constant, or schema tweak, stop and output a brief **Core Change Request** for `@itsMarchus` to merge via `chore/core-*` first.
2. **Event Hub Seam:** `@Syris-EkzD` mounts `<EventAttendanceTab />` and `<EventDocumentsTab />` inside `/events/[slug]` passing only `{ eventId, eventStatus, userRole }`. `@itsMarchus` owns those two files.
3. **Zero Drive-By Edits:** Never reformat, rename, or fix warnings outside the current task's files.
4. **End-of-Task Audit:** Run `git status --short` before finishing and confirm every modified path belongs to your track.

## Non-Negotiable Engineering Invariants
1. **Server-Side Security:** Every API route handler, Server Action, and protected Server Component loader must call `authorize()` (`src/lib/auth/authorize.ts`). Never branch RBAC on `officer_appointments.position_title`.
2. **No Hard Deletes & No Client Supabase SDK:** Never hard-delete historical records (`users`, `academic_terms`, `officer_appointments`, `events`, `meetings`, `attendance_records`). All DB access runs server-side via Drizzle (`postgres-js`).
3. **Auth & Secrets:** Hash passwords with Node.js `crypto.scrypt` and OTPs with `HMAC-SHA256`. Never expose `password_hash`, `token_hash`, or env secrets in API DTOs or `audit_logs`.
4. **Attendance Rules:** Checkpoints are configured/toggled strictly by `EXECUTIVE` (or `SUPER_ADMIN` with `break_glass: true` + `reason >= 10 chars`). Never queue offline QR confirmations in the Service Worker.
5. **UI & `impeccable` Skill Precedence:** Activate `.agents/skills/impeccable/SKILL.md` ONLY when creating or editing UI under `src/app/` or `src/components/`. `impeccable` governs visual craft and spacing, while `docs/05` strictly overrides on SYComP violet/charcoal Light & Dark tokens, Shadcn/ui primitives, Dual-Shell layout, 2-step QR Verification Card, and **zero emojis** (`lucide-react` icons only).
6. **Out-of-Scope Guard:** Do NOT build an in-app student attendance dispute queue, peer-to-peer chat, social feeds, LMS features, or online payments.

## Mandatory Working Loop
1. Check `git branch --show-current` and confirm track ownership.
2. Output a concise file-level plan before editing non-trivial features.
3. Write tests covering authorization failures (`403`/`400`/`409`) and happy paths.
4. Run `pnpm typecheck && pnpm lint` and relevant `pnpm vitest run` checks until green.
5. Run `git status --short` to verify strict track compliance.