# JJ history consolidation

## Scope

Linearize work descended from `pxzzzvmq` (`468d7cae202e137c6285ce7c2000d6f320b6db1c`). Keep its parent history and unrelated pre-base recovery refs unchanged.

## Progress

| Gate | Status | Evidence |
|---|---|---|
| Capture source workspaces and rollback point | Complete | Status checked in every workspace before preflight. Pre-surgery operation: `ef7d429acf86`. Pre-prune operation: `8c2ee36b6c38`. |
| Build isolated integration spine | Complete | `main` now contains copies of default, E2E, Command Palette, Agent communication, and thread-sidebar-attention work. The temporary `history-unify` workspace and six source workspace pointers were forgotten only after tree checks; `jj workspace forget` left their directories untouched on disk. |
| Resolve distinct variants | Complete | Replayed Agent communication host-report, panel, and E2E host-log work. Kept current feature paths and scenarios, merged `No live Agents` assertion, and retained host-log diagnostics with redaction. No conflict remains. |
| Preserve trees and prune stale branches | Complete | Main/E2E copied trees compare equal to source heads; Command Palette and Agent communication patch comparisons match; thread plan patch comparison matches. 58 non-main descendants were checked individually (`CHECKED=58 UNSAFE=0`) then abandoned. One head remains above base: `main`. |
| Validation | Partial | Agent communication typecheck, 7 tests, build, and host-bundle import passed. Root `pnpm run check` stopped at DSHX typecheck because `@deepseek-ai/dsh-api-session-controller/client` is not linked in `tooling/dshx/node_modules` (generated declaration exists under `tooling/dsh-core`). Root lint reports 1,925 warnings and 4 errors; `fmt:check` reports 137 files. No formatter was run. Browser E2E/live-runtime validation was not run. |

## Source revisions and tree proof

- Base: `pxzzzvmq` / `468d7cae202e137c6285ce7c2000d6f320b6db1c`.
- Default: source `924b4bf3`; copy `twkzxolo` — `jj diff` reports 0 files changed.
- Plugin E2E: source `3a82b673`; copy `rpwlpxlt` — 0 files changed.
- Command Palette: source patch `924b4bf3..e1930b11` matches copy patch `rpwlpxlt..qvkttqrr`.
- Agent communication: source patch `924b4bf3..af8729f0` matches copy patch `rpwlpxlt..kvvvryql`.
- Thread sidebar: plan patch `924b4bf3..90ba0f27` matches copy patch `rpwlpxlt..ktvwtzzz`.
- Before recording this closeout: `jj diff --from 440578b6564d8d73b408dae0649c8bd69a8e6279 --to main --stat` reported 0 files changed. This closeout changes only this README; all-conflict scan is empty; `heads(all() & pxzzzvmq::)` reports only `main`.

Environment-only absolute symlinks from `6ccbf7dd` and the temporary `session-inspection-type-probe.ts` were not copied. Repeated/empty variants were superseded by current workspace snapshots. No source files or workspace directories were deleted. No push or live DSH restart occurred; `main@origin` remains behind locally.

## Recovery

- `jj op restore 8c2ee36b6c38` restores the state immediately before the 58-revision prune.
- `jj op restore ef7d429acf86` restores the earlier state before integration workspaces were created, with original workspace pointers attached.

## Resume here

No history-consolidation step remains. Remaining acceptance gate is validation: restore/install the local DSHX dependency link, then rerun focused DSHX checks and browser E2E in an isolated environment. Do not push or restart the live DSH instance.
