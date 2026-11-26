---
trigger: glob
globs: "src/app/**/*.tsx, src/components/**/*.tsx"
description: "Enforce SYComP OMS design tokens, zero-emoji Lucide icons, and Impeccable + Ponytail balance on UI files."
---

- Use `.agents/skills/impeccable/SKILL.md` for visual craft, spacing rhythm, and layout polish, while treating `docs/05-ui-ux-and-information-architecture.md` as final authority on SYComP Light/Dark violet-charcoal tokens, Shadcn/ui primitives, Dual-Shell layout, and the 2-step QR Verification Card.
- Apply `.agents/skills/ponytail/SKILL.md` discipline: reuse existing Shadcn components and native HTML inputs before adding wrapper abstractions or new UI packages.
- Zero emojis anywhere in JSX, navigation, badges, empty states, or toasts—use `lucide-react` icons only.
- Format `student_id_number`, `academic_terms.code`, timestamps, and audit keys in monospace (`font-mono`).
- Enforce `44px x 44px` minimum mobile touch targets and responsive `Drawer` (mobile) / `Dialog` (desktop) forms.