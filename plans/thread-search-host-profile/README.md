# Thread-content search: Host/profile integration

| Milestone | Status | Evidence |
| --- | --- | --- |
| Diagnose the active Host boundary | Complete | Live Inspect exposes `ctx.sessions.search` and Host `sessionController.search`; installed provider still reads cold persisted logs serially. |
| Apply Host/profile settings and correct composition | Complete | Set `persistedReadConcurrency: 4` in both source patches; removed the SQLite service package from the E2E bundle list. |
| Verify user-visible behavior in isolation | Complete | Focused command-palette content-search Playwright scenario passed: 1 test, 10.8s, scratch `DSH_HOME`, on the new workspace. |
| Finish Host plugin package gates | Complete | Focused package typecheck/test passed; build and import succeeded. Build reused the verified generated controller `lib` from the sibling default workspace because the canonical sync lacked generated Client reference outputs; that artifact is ignored and uncommitted. |
| Integrate and document runtime promotion | Pending | Source fix is based on clean head `838557b1` in a fresh linked workspace. The shared `integration-spine` bookmark is still conflicted (`05e760f0` vs `4cfd2229`), so the workspace board cannot identify a single spine. Live profile remains untouched; active provider still needs the core concurrency fix before this setting can affect live behavior. |

Resume here: source change is `25dedbec` in workspace `thread-search-host-profile-current`, based on `838557b1`. Do not resolve or rewrite other workspaces' history. Wait for a clean spine tip before integration; do not modify or restart live `127.0.0.1:3080`.
