# Thread-sidebar attention

## Progress

| Gate | Status | Evidence / next action |
|---|---|---|
| Map supported attention signals | Complete | Approval/plan-review, question, and completion-unread are available; no supported durable session-error signal, so no Error category was added. |
| Implement sticky headings, per-status grouping, and subagent exclusion default | Complete | Feature revision `0b3fa2ae`; Approval/Input grouped, Turn finished inline, subagents excluded by default. |
| Normalize formatting and preference tests | Complete | `oxfmt --check` passed for eight files; preference tests pass. Formatter follow-up `e66fbf5b`. |
| Integrate into current default history | Complete | Current default workspace has the same tree for all eight owned feature paths (`jj diff --from default@ --to @ --stat -- <paths>`: 0 files changed); source revisions are in ancestry. |
| Package validation | Complete | Typecheck, all 63 tests, build, and host-bundle import check pass using compatible generated declarations from the default checkout. |
| Rebuild other plugin-ui consumers | Partial | 11 consumer builds succeeded. Five were blocked by unrelated unresolved contracts/APIs (`dsh-agent` declarations, queue-reorder projection/API drift); project-folder-picker has no build script. |
| Scratch runtime and browser inspection | Complete | Isolated minimal profile on port 3199 booted with no activation failures. Chromium showed “DeepSeek Harness”, sidebar present, computed sticky heading `Active(0)`, zero console errors and failed responses. No real session data was seeded. |
| Live profile safety | Complete | Did not sync the web profile, touch `127.0.0.1:3080`, or restart the live instance. |

## Current state

- Source workspace: `/Users/astahmer/dev/dshfiles-sidebar-attention-settings` (`thread-attention-settings`). Feature revisions `0b3fa2ae` and `e66fbf5b` are in the current default workspace ancestry; owned-path tree comparison is empty.
- `fnm exec --using=22.23.3 pnpm --dir plugins/@dshfiles/thread-sidebar typecheck` passed. The full package suite passed 63/63 tests across 13 files. `pnpm build` produced all six artifacts; `node -e "import('./dist/index.js')"` succeeded.
- The source workspace lacked generated `session` and `api-session-controller` declarations. Temporary `lib` links to the default checkout’s artifacts enabled validation; they are environment-only and must be removed before closeout.
- Oxlint reported 0 errors and four existing antislop warnings in `client.tsx` (two explicit Record annotations and two passthrough aliases). Formatting check passed for all eight owned files.
- UI stylesheet consumer rebuilds: 11 passed; five failed on separate unresolved DSH contracts/APIs (queue-reorder, agent-communication, ai-accounts, project-checks); project-folder-picker has no build script. Those packages are not part of the thread-sidebar validation result.
- Scratch profile composition resolved the bundle once, and isolated boot reported no activation failures. Headless Chromium verified the loaded sidebar, sticky heading positioning, and clean console/network status. The live web profile and its stored state were not changed.

## Resume here

Remove temporary generated-declaration symlinks, confirm the source workspace is clean and the owned-path diff from default remains empty, then update/close this plan and mark the goal complete. Do not restart or sync the live web profile.
