# Contributing to SYComP OMS

Welcome to the **SYComP Organizational Management System (SYComP OMS)** repository for the Society of Young Computer Professionals at Holy Name University.

This guide is written for **human contributors** (current developers and incoming student Technical Directors). For coding agent rules, see `AGENTS.md`.

---

## 1. Repository Map (Where Truth Lives)

Before starting a task or reviewing a pull request, check the authoritative source for that concern:

| File / Directory | Purpose |
|---|---|
| `PLAN.md` | Milestone roadmap (M0–M5), Track A / Track B split, and delivery sequence |
| `AGENTS.md` | Agent instructions, locked paths, and architectural guardrails |
| `PRODUCT.md` | Product purpose, user roles, operating context, and v1 exclusions |
| `DESIGN.md` & `design.json` | Normative UI design system, Light/Dark tokens, Dual-Shell rules, and component specs |
| `docs/00`–`docs/06` | Full charter, requirements, workflows, data dictionary, RBAC/security, UI/UX, and technical architecture |
| `.github/CODEOWNERS` | Automated reviewer routing across Core, Track A, and Track B paths |

---

## 2. Local Development Setup

### Prerequisites

- Node.js (LTS matching the version in `.github/` workflows)
- Git configured with your GitHub account
- Access to the team's development Supabase PostgreSQL database and Google Drive API credentials

### Getting Started

1. Clone the repository and sync `main`:
   ```bash
   git clone <repo-url>
   cd <repo-dir>
   git checkout main
   git pull origin main
   ```

2. Install dependencies using the repository's configured package manager (examples below use `npm`):
   ```bash
   npm install
   ```

3. Configure local environment variables:
   ```bash
   cp .env.example .env.local
   ```
   Fill in all required keys in `.env.local`. Environment variables are validated with fail-fast Zod schemas in `src/lib/env.ts`—missing or malformed keys will intentionally halt startup. Never commit `.env.local` or real credentials.

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Run the full verification suite locally before pushing:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run build
   ```

Formatting uses ESLint and Prettier with a **4-space tab width**.

---

## 3. Branching & Two-Developer Ownership Model

**Never commit or push directly to `main`.** All changes—including configuration and shared UI updates—must go through a Pull Request with green CI checks.

### Branch Prefixes

| Prefix | Ownership Scope | Examples |
|---|---|---|
| `chore/core-*` | **Locked Shared Core** — scaffolding, CI/workflows, DB schema & Drizzle config, core auth/RBAC helpers, `src/app/globals.css`, `src/components/ui/`, `PRODUCT.md`, `DESIGN.md`, `design.json` | `chore/core-m0-harness`, `chore/core-theme-tokens` |
| `feat/a-*` | **Track A** feature work (per `PLAN.md` & `CODEOWNERS`) | `feat/a-auth-onboarding`, `feat/a-event-hub` |
| `feat/b-*` | **Track B** feature work (per `PLAN.md` & `CODEOWNERS`) | `feat/b-qr-scanner`, `feat/b-masterlist-import` |
| `fix/*` | Targeted bug fixes scoped to the owning track or core | `fix/scanner-offline-guard` |

### Avoiding Merge Conflicts

- Keep `feat/a-*` and `feat/b-*` strictly within their assigned directories in `PLAN.md` and `.github/CODEOWNERS`.
- If a feature branch needs a new shared Shadcn primitive, global token tweak, or database schema migration, stop and land that shared change via a small `chore/core-*` PR first, then rebase your feature branch onto `main`.
- Rebase frequently against `origin/main` to keep diffs small and clean:
  ```bash
  git fetch origin
  git rebase origin/main
  ```

### Commit Messages

Use clear, concise Conventional Commits:
- `feat(scanner): add 5-state QR verification card`
- `fix(auth): enforce server-side authorize on attendance route`
- `chore(core): wire SYComP light and dark CSS tokens`
- `docs: add contributor workflow guide`

---

## 4. Working with Team Skills (Impeccable & Ponytail)

Our repository includes shared agent skills in `.agents/skills/` for both **Antigravity** (slash commands: `/...`) and **Codex** (dollar commands: `$...`).

### Impeccable (UI Design & Quality)

`PRODUCT.md`, `DESIGN.md`, and `design.json` are already initialized at the root. Impeccable reads them automatically on every UI task.

**Recommended Feature Loop:**
1. **Plan complex views first:** Run `/impeccable shape <feature>` before writing JSX for multi-state flows (e.g., `/scanner`, `/events/[slug]` Event Hub, bulk masterlist import).
2. **Build within specs:** Use `/impeccable <plain-English request>` when implementing screens or components.
3. **Evaluate & harden:**
   - `/impeccable audit <path>` — check WCAG 2.1 AA contrast, keyboard focus, ARIA landmarks, and `44px` mobile touch targets.
   - `/impeccable harden <path>` — verify loading skeletons, empty states, offline lockouts, and long/edge-case data.
   - `/impeccable critique <path>` — run when a screen's UX or hierarchy feels off.
4. **Targeted fixes & finish:** Use `/impeccable adapt <path>` (responsive breakpoints) or `/impeccable clarify <path>` (labels and error copy), then run `/impeccable polish <path>`.
5. **Local static check:** Run `npx impeccable detect <path>` before opening your PR to catch visual regressions.

**Impeccable Team Rules:**
- **Do not run `init`, `document`, or `extract` on `feat/a-*` or `feat/b-*` branches.** Updates to `PRODUCT.md`, `DESIGN.md`, `design.json`, or shared `src/components/ui/` primitives must go through `chore/core-*`.
- **Do not use `colorize`, `delight`, or `overdrive`.** They conflict with SYComP OMS's flat-by-default, 10% amethyst restraint, and zero-emoji rules.
- **Prompt wording:** Ask to **"refine"** when preserving an existing layout and fixing details; ask to **"redesign"** only when intentionally replacing a screen's structure.

### Ponytail (Lean & Secure Implementation)

Ponytail has no initialization step and generates no project files. Use it to prevent over-engineering, dead abstractions, and missing validation:
- Keep Ponytail on `/ponytail lite` during normal feature development (or `/ponytail off` briefly when laying down initial route skeletons).
- Always run `/ponytail-review` against your branch diff right before opening a Pull Request to strip unnecessary boilerplate and catch security or validation gaps.

---

## 5. Engineering & Security Non-Negotiables

Every contributor and PR reviewer must verify these invariants—there are no shortcuts:

1. **Centralized Server Authorization:** Every API route handler, Server Action, and protected Server Component loader must call centralized `authorize()`. Never trust client-side role checks alone.
2. **3-Layer Decoupled RBAC:** Never branch permission checks on `officer_appointments.position_title`. Check global tier (`SUPER_ADMIN`, `EXECUTIVE`, `OFFICER`, `MEMBER`) and event-scoped `Committee Head` assignments.
3. **Zero Hard Deletes on Historical Data:** Never hard-delete `users`, `academic_terms`, `officer_appointments`, `events`, `meetings`, or `attendance_records`. Preserve institutional continuity across terms.
4. **Online-Only 2-Step QR Attendance:** Never queue attendance confirmations offline in the Service Worker (`/api/*` stays `NetworkOnly`). Scans must follow `Scan -> Verify Card -> Confirm` with live server checks.
5. **Break-Glass Accountability:** Any `SUPER_ADMIN` override of Executive-scoped mutations or locked historical records requires `break_glass: true` and an audit `reason` of at least 10 characters.
6. **Server-Only Data Access & Secret Hygiene:** Use Drizzle ORM (`postgres-js`) on the server only—never add a client-side Supabase SDK. Never expose password hashes, OTP hashes, OAuth tokens, or secrets in DTOs, logs, or `audit_logs`.
7. **Respect v1 Scope:** Do not build excluded v1 features (student attendance dispute ticketing queues, peer-to-peer chat, social feeds/comments, LMS modules, or online payments).

---

## 6. UI & Accessibility Standards

When building or reviewing frontend code, verify alignment with `DESIGN.md`:

- **Zero Emojis:** Never put emojis in JSX, navigation labels, badges, headings, empty states, or toasts. Use `lucide-react` icons paired with explicit text.
- **Monospace Operational IDs:** Render `student_id_number`, `academic_terms.code`, exact timestamps, Drive folder paths, and `audit_logs` keys in `JetBrains Mono` (`font-mono`).
- **Dual-Shell Separation:** Keep Shell A (`/portal/*` read-only member portal) completely isolated from Shell B (officer/executive/admin sidebar workspace).
- **Theme Parity & Restraint:** Reference semantic CSS variables (`--background`, `--card`, `--primary`, `--border`, `--success`, `--warning`, `--destructive`, `--info`) rather than hardcoded hex colors. Keep resting cards flat with 1px borders, keep amethyst accents under 10% of the viewport, and avoid neon glows, glassmorphism, or marketing gradients.
- **Accessibility:** Target WCAG 2.1 AA contrast in both Light and Dark themes, maintain `44px x 44px` minimum mobile touch targets, respect safe-area insets, never communicate status by color alone, and preserve `aria-live="polite"` feedback on `/scanner`.
- **No Fabricated Brand Assets:** Do not invent placeholder SVGs for the official SYComP emblem (`public/brand/`) or PWA icons (`public/icons/`)—wait for the official exported team assets.

---

## 7. Pull Request & Review Checklist

Before requesting a review from your teammate:

- [ ] Branch is up to date with `origin/main` and touches only files within your track/core scope.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` all pass locally with zero errors.
- [ ] UI changes were checked with `/impeccable audit`, `/impeccable harden`, and `npx impeccable detect <path>`.
- [ ] Full branch diff was reviewed with `/ponytail-review`.
- [ ] All security invariants (`authorize()`, zero hard deletes, no secret leaks, break-glass rules) are verified.
- [ ] PR description briefly states **what changed**, **how to verify it** (including Light/Dark and mobile screenshots for UI work), and links the relevant milestone in `PLAN.md`.