# Thread-sidebar attention

## Progress

| Gate | Status | Evidence / next action |
|---|---|---|
| Map supported attention signals | Complete | Approval/plan-review, question, and completion-unread are available; no durable session-error signal. |
| Implement sticky headings, per-status grouping, and subagent exclusion default | Complete | Feature revision `0b3fa2ae`; Approval/Input grouped, Turn finished inline, subagents excluded by default. |
| Normalize formatting and preference tests | Complete | `oxfmt --check` passed for eight files; `preferences.test.ts` passed 8/8. Formatter follow-up `e66fbf5b`. |
| Integrate into current default history | Complete, tree check pending | `default@` ancestry includes both feature and formatter revisions. Verify no owned-path changes after formatter revision. |
| Package typecheck/build and full tests | Blocked | Current build fails on absent generated DSH declarations and unrelated `client-entry.tsx` contract/type errors. Do not edit that unowned file. |
| Probe runtime and inspect UI | Pending | Requires a successful current bundle. Never restart or touch live web profile. |
| Confirm final integration/runtime state | Pending | Compare owned paths, check default workspace safely, then close goal only with runtime evidence. |

## Current state

- Source workspace: `/Users/astahmer/dev/dshfiles-sidebar-attention-settings` (`thread-attention-settings`). Working copy was clean after the formatter revision.
- Current `default@` is `ad674f56` (`wip`); its ancestry contains feature `0b3fa2ae` and formatter `e66fbf5b`.
- `jj diff --from e66fbf5b --to default@ --stat` showed only three unrelated Command Palette files, so no later changes to the feature tree were reported.
- Focused checks passed: `fnm exec --using=22.23.3 pnpm exec oxfmt --check --config .oxfmtrc.json <8 owned files>` and `fnm exec --using=22.23.3 pnpm --dir plugins/@dshfiles/thread-sidebar exec vitest run src/preferences.test.ts` (8/8).
- Current plugin build failed at `client-entry.tsx`, `client.tsx`, `organization.ts`, and tests because `@deepseek-ai/dsh-api-session-controller/client` / `@deepseek-ai/dsh-session/types` declarations are absent; concurrent `client-entry.tsx` edits also reference missing `ClientContext.sessions` and an implicit `item` type.
- No live DSH restart, profile sync, or runtime verification has occurred.

## Resume here

Resolve only the missing generated-contract/build environment if a trusted compatible artifact is available; do not edit the concurrent `client-entry.tsx` work. Re-run package checks and import-check the current host bundle. After successful build, use an isolated probe/scratch profile for runtime verification; leave `127.0.0.1:3080` untouched. Reassess whether the default workspace is safe to fast-forward without rewriting active work.
