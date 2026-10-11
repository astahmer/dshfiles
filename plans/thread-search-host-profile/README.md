# Thread-content search: Host/profile integration

| Milestone | Status | Evidence |
| --- | --- | --- |
| Diagnose the active Host boundary | Complete | Live Inspect exposes `ctx.sessions.search` and Host `sessionController.search`; installed provider still reads cold persisted logs serially. |
| Apply Host/profile settings and correct composition | Complete | Set `persistedReadConcurrency: 4` in both source patches; removed the SQLite service package from the E2E bundle list. |
| Verify user-visible behavior in isolation | Complete | Focused command-palette content-search Playwright scenario passed: 1 test, 9.9s, scratch `DSH_HOME`. |
| Finish Host plugin package gates | Complete | Focused package typecheck/test passed; build and import succeeded. Build reused the verified generated controller `lib` from the sibling default workspace because the canonical sync lacked generated Client reference outputs; that artifact is ignored and uncommitted. |
| Integrate and document runtime promotion | Pending | `integration-spine` remains conflicted. Current source change is based on clean `integration-spine@git` descendant `f37bde65`; live profile remains untouched. The active installed provider still needs the core concurrency fix before this setting can affect live behavior. |

Resume here: split/describe these five owned paths, then integrate only after a clean spine tip is available. The active provider package still needs the concurrency implementation delivered and a user-controlled restart; do not modify or restart live `127.0.0.1:3080`.
