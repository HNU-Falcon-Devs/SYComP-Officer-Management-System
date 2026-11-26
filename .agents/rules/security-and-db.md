---
trigger: glob
globs: "src/app/api/**/*.ts, src/services/**/*.ts, src/db/**/*.ts, src/lib/**/*.ts"
description: "Enforce SYComP OMS 3-layer RBAC, Ponytail safety floors, Drizzle server-only access, and audit immutability."
---

- Apply `.agents/skills/ponytail/SKILL.md` (`full` mode): write the smallest correct implementation, and NEVER simplify away trust-boundary validation, `authorize()` checks, state locks, error handling, or audit logging.
- Every API Route Handler and Server Action must call `authorize()` (`src/lib/auth/authorize.ts`). Never branch authorization on `officer_appointments.position_title`.
- Never hard-delete historical records (`users`, `academic_terms`, `officer_appointments`, `events`, `meetings`, `attendance_records`).
- Never expose `password_hash`, `token_hash`, or server env secrets in DTOs or `audit_logs`.
- Checkpoints are strictly `EXECUTIVE`-only (or `SUPER_ADMIN` with `break_glass: true` and `reason.trim().length >= 10`).
- Never run `pnpm db:generate` on `feat/a-*` or `feat/b-*` branches; migrations belong exclusively on `@itsMarchus`'s `chore/core-*` branches.