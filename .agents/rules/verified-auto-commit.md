---
trigger: always_on
description: "Automatically commit verified changes on feature branches after every completed task."
---

After completing any coding task (never mid-task while code is broken):
1. Check current branch via `git branch --show-current`. If on `main`, STOP and refuse to commit.
2. Run `git status --short` and verify:
   - Zero secret/env files are untracked or staged (`.env`, `.env.*`, `*.pem`, `*secret*`).
   - Every modified file belongs strictly to the active branch's track (`chore/core-*`/`feat/a-*` = `@itsMarchus`, `feat/b-*` = `@Syris-EkzD`).
3. Run `pnpm typecheck && pnpm lint` and affected `pnpm vitest run` tests. Do NOT commit if any check fails.
4. Stage files strictly by explicit path (`git add <file1> <file2>`). NEVER run `git add -A` or `git add .`.
5. Commit with a Conventional Commit message (`feat(<scope>): ...`, `fix(<scope>): ...`, `chore(<scope>): ...`).
6. Never force-push (`git push --force`) or push directly to `main`.