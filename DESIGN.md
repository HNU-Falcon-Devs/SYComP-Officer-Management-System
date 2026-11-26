---
name: "SYComP OMS"
description: "Modern clean institutional SaaS design system for the Society of Young Computer Professionals (SYComP) — Holy Name University."
colors:
  primary-light: "#6D28D9"
  primary-dark: "#7C3AED"
  primary-foreground: "#FFFFFF"
  brand-accent-light: "#8B5CF6"
  brand-accent-dark: "#A78BFA"
  brand-soft-light: "#EDE9FE"
  brand-soft-dark: "#2D2246"
  background-light: "#FAFAFC"
  background-dark: "#121216"
  surface-light: "#FFFFFF"
  surface-dark: "#1B1A22"
  surface-subtle-light: "#F3F2F8"
  surface-subtle-dark: "#252330"
  border-light: "#E4E2EE"
  border-dark: "#2E2C3B"
  foreground-light: "#16151D"
  foreground-dark: "#F4F3F8"
  muted-foreground-light: "#5B586B"
  muted-foreground-dark: "#A29FB3"
  success-light: "#15803D"
  success-dark: "#22C55E"
  warning-light: "#B45309"
  warning-dark: "#F59E0B"
  destructive-light: "#B91C1C"
  destructive-dark: "#EF4444"
  info-light: "#1D4ED8"
  info-dark: "#60A5FA"
typography:
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  card-title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0.01em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  touch-min: "44px"
  header-height: "56px"
components:
  button-primary:
    backgroundColor: "{colors.primary-light}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "40px"
  button-primary-dark:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.surface-subtle-light}"
    textColor: "{colors.foreground-light}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "40px"
  button-destructive:
    backgroundColor: "{colors.destructive-light}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "40px"
  card:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.foreground-light}"
    rounded: "{rounded.lg}"
    padding: "20px"
  input:
    backgroundColor: "{colors.surface-subtle-light}"
    textColor: "{colors.foreground-light}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  status-badge:
    backgroundColor: "{colors.brand-soft-light}"
    textColor: "{colors.primary-light}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  sidebar-nav:
    backgroundColor: "{colors.brand-soft-light}"
    textColor: "{colors.primary-light}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    height: "40px"
  verification-card-ready:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.foreground-light}"
    rounded: "{rounded.xl}"
    padding: "16px"
---

# Design System: SYComP OMS

## Overview

**Creative North Star: "The Operations Ledger"**

SYComP OMS is designed as a crisp, disciplined institutional SaaS ledger for the Society of Young Computer Professionals (SYComP) at Holy Name University. Its visual authority comes directly from the official SYComP banner (`docs/inspo/Banner.png`)—deep graphite-charcoal surfaces, isometric amethyst-violet ribbon geometry, pale lilac highlights, and razor-sharp contrast—translated into a restrained Light and Dark UI built on Shadcn/ui primitives and Tailwind CSS v4 tokens.

Every surface favors clarity, scanability, and fast accountability over ornament: crisp 1px structural borders separate containers without heavy drop shadows, operational identifiers snap cleanly in monospace, and the signature amethyst accent signals active controls and primary governance actions without visual fatigue. Operational screens strictly reject neon glows, frosted glassmorphism, decorative circuit-pattern backgrounds, marketing gradients, and emojis anywhere in the interface.

Implementation note: `src/app/globals.css` currently retains the M0 neutral Shadcn scaffolding (`--radius: 0.625rem` / `10px`) until M1/M2 UI wiring binds these normative SYComP Light and Dark tokens.

**Key Characteristics:**

- Refined, restrained institutional SaaS built on 1px borders and tonal surface stepping rather than decorative shadows.
- Signature amethyst-violet (`Amethyst Ribbon`) primary actions balanced against cool alabaster daylight and deep `Graphite Canvas` dark surfaces.
- Strictly zero emojis across all UI surfaces; every semantic signifier pairs a crisp `lucide-react` icon with explicit text.
- Dual-Shell separation isolating the mobile-first General Member Portal (Shell A) from the collapsible-sidebar Officer/Executive/Admin Workspace (Shell B).
- Monospace precision (`JetBrains Mono`) for `student_id_number`, `academic_terms.code`, scan timestamps, and audit keys.

## Colors

The SYComP OMS color system pairs cool alabaster and graphite neutrals with controlled amethyst accents and WCAG AA semantic status tokens across Light and Dark themes.

### Primary

- **Amethyst Ribbon** (`primary-light` / `primary-dark`): Primary CTA fills, active navigation pill text/accents, and confirmed governance actions, paired with `#FFFFFF` foreground text for at least 5.7:1 AA contrast (`--primary`).
- **Lavender Signal** (`brand-accent-light` / `brand-accent-dark`): Active navigation icons, keyboard focus rings, brand highlights, and workflow stepper active nodes (`--brand-accent`).
- **Pale Lilac Wash / Deep Plum Wash** (`brand-soft-light` / `brand-soft-dark`): Active navigation row tints, subtle brand badges, and highlighted table rows (`--brand-soft`).

### Secondary

- **Verified Emerald** (`success-light` / `success-dark`): `ACTIVE` accounts, `APPROVED` proposals, `PUBLISHED` events, `PRESENT` attendance, `DONE` tasks, and `READY` QR verification states (`--success`).
- **Amber Hold** (`warning-light` / `warning-dark`): `PENDING_REVIEW`, `NEEDS_REVISION`, `LATE` attendance, `NEEDS_REVIEW` accounts, `ALREADY_LOGGED` QR warnings, and `SUPER_ADMIN` Break-Glass alerts (`--warning`).
- **Crimson Block** (`destructive-light` / `destructive-dark`): `REJECTED`, `DISABLED`, `ABSENT`, `CANCELLED`, destructive actions, and `403` / `OFFICER_RESTRICTED` / `ACCOUNT_HOLD` QR lockouts (`--destructive`).
- **Cobalt Progress** (`info-light` / `info-dark`): `IN_PROGRESS`, `FOR_REVIEW`, `ONGOING`, `EXCUSED`, and `SUBMITTED` states (`--info`).

### Neutral

- **Alabaster Mist / Graphite Canvas** (`background-light` / `background-dark`): Primary page canvas behind cards and navigation chrome (`--background`).
- **Pure Ledger White / Charcoal Slate** (`surface-light` / `surface-dark`): Cards, panels, collapsible sidebar, bottom navigation bar, and modals (`--card`).
- **Cool Lilac Mist / Elevated Dusk** (`surface-subtle-light` / `surface-subtle-dark`): Secondary containers, table headers, input fills, and hover states (`--muted`).
- **Violet-Tinted Hairline / Graphite Hairline** (`border-light` / `border-dark`): Crisp 1px structural dividers and card outlines (`--border`).
- **Obsidian Ink / Cloud Ivory** (`foreground-light` / `foreground-dark`): Primary headings and body copy (`--foreground`).
- **Graphite Muted / Silver Slate** (`muted-foreground-light` / `muted-foreground-dark`): Captions, metadata, secondary labels, and timestamps (`--muted-foreground`).

### Named Rules

**The Amethyst Restraint Rule.** Amethyst Ribbon and Lavender Signal occupy at most 10% of any viewport—reserved strictly for primary CTAs, active navigation states, focus rings, and stepper indicators so semantic Emerald, Amber, and Crimson alerts stay unmistakable.

**The Dual-Theme Parity Rule.** Every surface, border, and status token must map cleanly between Light (`Alabaster Mist`) and Dark (`Graphite Canvas`) via CSS custom properties (`next-themes`: `Light` / `Dark` / `System`), defaulting to OS preference without hardcoded hex overrides in components.

## Typography

**Display Font:** `Inter` (fallback: `ui-sans-serif, system-ui, sans-serif`)
**Body Font:** `Inter` (fallback: `ui-sans-serif, system-ui, sans-serif`)
**Label/Mono Font:** `JetBrains Mono` (fallback: `ui-monospace, SFMono-Regular, monospace`)

**Character:** Clean geometric neo-grotesque clarity for dense governance forms and tables, paired with crisp tabular monospace figures for high-speed ID scanning and audit inspection.

### Hierarchy

- **Headline (`h1`)** (`600`, `24px` / `1.5rem`, `1.25` line-height, `-0.02em` tracking): Page titles across Shell A and Shell B views.
- **Title (`h2`)** (`600`, `18px` / `1.125rem`, `1.35` line-height): Major workspace section headers and modal/drawer titles.
- **Card Title (`h3`)** (`600`, `15px`–`16px` / `0.9375rem`, `1.4` line-height): Dashboard widgets, committee cards, and QR Verification Card student names.
- **Body** (`400`, `14px` / `0.875rem`, `1.5` line-height, `65ch`–`75ch` max reading measure): Standard prose, table cells, form inputs, and proposal content.
- **Label** (`500`, `12px` / `0.75rem`, `1.35` line-height): Micro-metadata, form captions, status badge text, and sidebar group headers.
- **Monospace Identifiers** (`500`, `13px` / `0.8125rem`, `1.4` line-height): Operational codes, IDs, timestamps, Drive path previews, and audit keys.

### Named Rules

**The Monospace Identifier Rule.** Format `student_id_number` (e.g., `2024-01234`), `academic_terms.code` (e.g., `AY2026-2027-S1`), exact scan timestamps, Google Drive folder preview paths, and `audit_logs` action keys in `JetBrains Mono` (`font-mono`) with tabular spacing so dense rows scan without column jitter.

## Layout

SYComP OMS enforces a strict **Dual-Shell Layout** separating read-only General Member self-service from operational Officer, Executive, and Super Admin governance:

- **Shell A — General Member Portal (`/portal/*`):** Mobile-first zero-clutter shell for `MEMBER` accounts. Uses a sticky `56px` top header (SYComP emblem + `"SYComP"` wordmark on left; Theme Toggle + Account Avatar on right). On mobile (`< 768px`), renders a fixed 5-tab bottom navigation bar (`Home` / `/portal`, `Calendar` / `/portal/calendar`, `Attendance` / `/portal/attendance`, `Notices` / `/portal/announcements`, `Account` / `/portal/account`) with minimum `44px x 44px` touch targets and `env(safe-area-inset-bottom)` clearance. On desktop (`>= 768px`), displays a centered top navigation bar inside a `max-w-5xl` container with no sidebar. When `users.must_change_password === true` or `users.email_verified_at === null`, a persistent top Security Onboarding Banner spans `/portal/*` linking directly to `/portal/account`.
- **Shell B — Officer, Executive & Super Admin Workspace:** Collapsible sidebar SaaS workspace. Desktop (`>= 1024px`) renders a persistent sidebar at `248px` expanded / `64px` icon-only collapsed (persisted in user preference, with hover tooltips when collapsed), grouped into role-filtered sections (`Core`, `Operations`, `Organization`, `Governance`). Mobile/tablet (`< 1024px`) replaces the static sidebar with a slide-over `Sheet` drawer triggered from the top-left menu button plus a one-tap `/scanner` shortcut icon in the `56px` top utility bar (which also houses the collapse toggle, breadcrumbs, Active Term pill, Theme Toggle, Role Tier badge, and Profile Menu).
- **Single Tabbed Event Hub (`/events/[slug]?tab=...`):** Consolidates all facets of an event under a persistent role-conditional header action bar and 5 URL-synced tabs: `Overview & Proposal` (`overview`), `Committees` (`committees`, unlocked at `APPROVED`), `Tasks` (`tasks`, toggleable List/Board), `Attendance` (`attendance`, dynamic checkpoints strip + filterable log + CSV export), and `Documents` (`documents`).
- **Responsive Overlays, Toasts & Offline Banner:** Secondary forms and detail previews open as centered `Dialog` modals on desktop (`>= 768px`) and bottom `Drawer` sheets on mobile (`< 768px`). `Sonner` toasts anchor top-right on desktop and top-center on mobile so they never obscure Shell A's bottom tab bar or the Scanner's `Confirm Attendance` action. When offline (`navigator.onLine === false`), a persistent top connectivity bar (`WifiOff` icon) informs the user and blocks live QR attendance submissions.

### Named Rules

**The Dual-Shell Boundary Rule.** Never leak Shell B sidebar chrome, governance counters, or operational shortcuts into Shell A (`/portal/*`), and never render mobile bottom tab bars inside Shell B—each shell owns one unambiguous navigation model.

## Elevation & Depth

SYComP OMS uses a **flat-by-default planar hierarchy**: structural separation relies on crisp 1px borders (`--border`) and subtle tonal steps (`Alabaster Mist` / `Pure Ledger White` / `Cool Lilac Mist` in Light; `Graphite Canvas` / `Charcoal Slate` / `Elevated Dusk` in Dark). Drop shadows are omitted from resting cards, tables, and navigation rails and reserved exclusively for elevated floating overlays (`Dialog`, `Drawer`, `Sheet`, `Popover`, `DropdownMenu`, `Sonner` toasts).

### Shadow Vocabulary

- **Floating Overlay Small (`overlay-sm`)** (`box-shadow: 0 4px 12px rgba(18, 18, 22, 0.08)` light / `0 4px 16px rgba(0, 0, 0, 0.36)` dark): Dropdown menus, tooltips, and toast notifications.
- **Floating Overlay Medium (`overlay-md`)** (`box-shadow: 0 12px 32px rgba(18, 18, 22, 0.14)` light / `0 12px 36px rgba(0, 0, 0, 0.48)` dark): Centered `Dialog` modals, Break-Glass confirmation dialogs, and mobile `Sheet`/`Drawer` overlays.

### Named Rules

**The Flat-By-Default Rule.** Resting cards, tables, sidebars, and verification panels stay strictly flat with 1px structural borders; elevation shadows appear solely on transient overlay surfaces above the page plane.

## Shapes

The system pairs controlled modern rounding with crisp 1px edges anchored to `--radius: 10px` (`0.625rem`):

- **Small (`6px`):** Compact checkboxes, inline code chips, and tight table action buttons.
- **Medium (`8px`):** Standard buttons (`40px` desktop height, `>= 44px` on mobile touch targets), form inputs, dropdown items, and sidebar nav items.
- **Large (`10px`):** Primary cards, data table containers, and alert banners (`--radius`).
- **Extra Large (`14px`):** `Dialog` modals, mobile `Drawer` sheets, and the 2-step QR Verification Card.
- **Pill (`9999px`):** Status badges, Active Term pill, Role Tier badges, and segmented filter chips.
- **Borders:** 1px solid `--border` on all resting containers; 2px semantic borders reserved strictly for active QR Verification Card states and keyboard `focus-visible` rings (`Lavender Signal`).

## Components

Components embody refined, restrained utility—crisp borders, clear state feedback, generous touch hit areas (`>= 44px` on mobile), and zero ornamental clutter.

### Buttons

- **Shape:** Medium rounded corners (`8px` radius).
- **Primary:** `Amethyst Ribbon` fill (`#6D28D9` light / `#7C3AED` dark), `#FFFFFF` text, `10px 16px` padding (`40px` desktop height, `>= 44px` mobile touch height).
- **Hover / Focus:** Smooth `150ms` background darken/lighten shift with a 2px `Lavender Signal` `focus-visible` ring offset `2px`.
- **Secondary / Ghost / Destructive:** Secondary uses `Cool Lilac Mist` / `Elevated Dusk` with 1px `--border`; Ghost stays transparent until subtle hover tint; Destructive uses `Crimson Block` fill with `#FFFFFF` text strictly for confirmed irreversible-state actions (e.g., `DISABLED` account transition or `REJECTED` proposal).

### Chips

All domain status badges share a pill silhouette (`9999px` radius), `4px 10px` padding, `12px` medium label, tinted semantic fill (~12% opacity), 1px subtle border, and an inline `14px`–`16px` `lucide-react` icon (`1.75px` stroke):

- **Events:** `DRAFT` (Neutral / `FileEdit`), `PENDING_REVIEW` (Warning / `Clock`), `NEEDS_REVISION` (Warning / `RotateCcw`), `APPROVED` (Brand / `CheckCircle2`), `PUBLISHED` (Success / `Globe`), `COMPLETED` (Neutral-Filled / `Archive`), `REJECTED` (Destructive / `XCircle`).
- **Tasks:** `TO_DO` (Neutral / `Circle`), `IN_PROGRESS` (Info / `Loader`), `FOR_REVIEW` (Warning / `Eye`), `DONE` (Success / `CheckCircle2`).
- **Checkpoints:** `SCHEDULED` (Neutral / `CalendarClock`), `OPEN` (Success + subtle pulsing indicator dot / `Radio`), `CLOSED` (Neutral / `Lock`).
- **Attendance:** `PRESENT` (Success / `Check`), `LATE` (Warning / `ClockAlert`), `EXCUSED` (Info / `FileCheck`), `ABSENT` (Destructive / `X`).
- **Meetings:** `SCHEDULED` (Brand / `Calendar`), `ONGOING` (Success / `PlayCircle`), `COMPLETED` (Neutral / `CheckCheck`), `CANCELLED` (Destructive / `Ban`).
- **Accounts:** `ACTIVE` (Success / `ShieldCheck`), `NEEDS_REVIEW` (Warning / `ShieldAlert`), `DISABLED` (Destructive / `ShieldOff`).

### Cards / Containers

- **Corner Style:** Large rounded (`10px` radius).
- **Background:** `Pure Ledger White` (Light) / `Charcoal Slate` (Dark).
- **Shadow Strategy:** Flat at rest (no shadow); hoverable list cards shift border contrast subtly.
- **Border:** 1px solid `--border`.
- **Internal Padding:** `16px`–`20px` (`md`/`lg`), pairing loading states with geometry-matched `Skeleton` blocks and empty states with a muted `40px` `lucide-react` icon, 1-line explanation, and at most one permitted CTA.

### Inputs / Fields

- **Style:** 1px `--border` around `Cool Lilac Mist` / `Elevated Dusk` fill (`8px` radius, `40px` height on desktop, `>= 44px` on mobile).
- **Focus:** 2px `Lavender Signal` ring (`--brand-accent`) with clear `<label>` association.
- **Error / Disabled:** `Crimson Block` border + concise helper message below; disabled inputs dim opacity cleanly while preserving legible contrast.
- **Rich-Text & Drive Dropzone:** Tiptap WYSIWYG toolbar uses monochrome `lucide-react` icons (`Heading2`, `Heading3`, `Bold`, `Italic`, `Underline`, `List`, `ListOrdered`, `Quote`, `Link`, `Undo`, `Redo`). The Google Drive dropzone clearly prints accepted formats, the `15 MB` cap, and a live monospace path preview pill (e.g., `AY 2026-2027 - 1st Sem / Communication Letters / Tech Summit 2026`).

### Navigation

- **Shell A:** Fixed bottom bar on `< 768px` (5 items, `44px x 44px` min targets, active item highlighted in `Amethyst Ribbon` + `Pale Lilac Wash` / `Deep Plum Wash` tint) and centered horizontal top bar inside `max-w-5xl` on `>= 768px`.
- **Shell B:** `248px` / `64px` collapsible sidebar with `10px 12px` nav items (`8px` radius), `20px` `lucide-react` icons, and `Amethyst Ribbon` + `--brand-soft` active fill; collapses cleanly into a mobile `Sheet` drawer below `1024px`.

### 2-Step QR Verification Card

Dedicated `/scanner` signature component enforcing **Scan -> Verify -> Confirm** with `aria-live="polite"` status announcements, automatic camera decode pause upon lookup, manual `student_id_number` fallback, and offline confirm blocking:

1. **Ready to Confirm (`READY`) — Green/Brand 2px Border:** Shows Full Name, `student_id_number` in `JetBrains Mono`, Role badge, `ACTIVE` status badge, and active Checkpoint label; focuses primary **`Confirm Attendance`** button (`Amethyst Ribbon`) alongside **`Cancel / Rescan`**.
2. **Already Recorded (`ALREADY_LOGGED`) — Amber 2px Border:** Shows student identity plus exact timestamp (e.g., `"Already logged at 08:04:12 AM"`); `Confirm Attendance` is disabled, offering only **`Scan Next`**.
3. **Officer Attendance Guard (`OFFICER_RESTRICTED`) — Crimson 2px Lock Card:** Triggered when a non-Executive `OFFICER` scans an active `OFFICER` or `EXECUTIVE`; displays `"Officer attendance must be recorded by an Executive"`, disables confirm, and offers **`Scan Next`**.
4. **Account Hold Warning (`ACCOUNT_HOLD`) — Crimson 2px Alert Card:** Triggered when the scanned student is `DISABLED` or `NEEDS_REVIEW`; displays `"Account is [DISABLED / NEEDS REVIEW] — Cannot log attendance"`, disables confirm, and offers **`Scan Next`**.
5. **ID Not Found (`NOT_FOUND`) — Neutral Error Card:** Displays `"Student ID not found in active masterlist."` with **`Rescan`** and **`Check ID`** actions.

### Super Admin Break-Glass Override Modal

Triggered whenever a `SUPER_ADMIN` invokes an Executive-scoped mutation or edits a locked historical record:

- **Header:** Amber/Destructive accented dialog title `"Break-Glass Administrative Override"` paired with a `ShieldAlert` `lucide-react` icon.
- **Context Summary:** Displays the exact audit action (e.g., `EVENT_PUBLISHED`, `ATTENDANCE_OVERRIDDEN`) and target record identifier.
- **Mandatory Justification:** Required `"Audit Reason (Required)"` textarea (`min 10 characters`) with a live character counter; confirmation button remains disabled until the threshold is met.

## Do's and Don'ts

### Do:

- **Do** use `lucide-react` icons (`1.75px` stroke, `16px` inline, `20px` nav/buttons) paired with text labels for every status, action, and empty state.
- **Do** render `student_id_number`, `academic_terms.code`, timestamps, Drive folder paths, and `audit_logs` keys in `JetBrains Mono` (`font-mono`).
- **Do** keep `Amethyst Ribbon` and `Lavender Signal` accents under 10% of the viewport so status badges and QR Verification Card alerts read instantly.
- **Do** enforce `44px x 44px` minimum mobile touch targets, safe-area insets, responsive `Drawer` (`< 768px`) / `Dialog` (`>= 768px`) overlays, and `Skeleton` loading states.
- **Do** maintain strict 1px structural borders (`--border`) and flat-by-default card surfaces across both Light (`Alabaster Mist`) and Dark (`Graphite Canvas`) themes.
- **Do** pause camera decoding and require explicit human verification via the 5-state QR Verification Card before committing any attendance scan.

### Don't:

- **Don't** place emojis anywhere in JSX, navigation labels, status pills, empty states, headings, or `Sonner` toasts.
- **Don't** introduce neon glows, frosted glassmorphism, decorative circuit-pattern backgrounds, or marketing gradients onto operational workspace or portal screens.
- **Don't** convey status by color alone—every state pill and QR Verification Card must pair color with explicit text and a distinct `lucide-react` icon.
- **Don't** render Shell B sidebar chrome inside `/portal/*` or render Shell A mobile bottom navigation inside Shell B.
- **Don't** queue offline QR attendance confirmations in the Service Worker or allow `Confirm Attendance` submissions while `navigator.onLine === false`.
- **Don't** hardcode light or dark hex values inside UI components—reference semantic CSS variables (`--background`, `--card`, `--primary`, `--border`, `--success`, `--warning`, `--destructive`, `--info`).
- **Don't** bypass the mandatory 10-character audit justification modal when `SUPER_ADMIN` performs an Executive-scoped break-glass action.
