# Plugin E2E coverage implementation

Plan: [../plugin-e2e-coverage.md](../plugin-e2e-coverage.md)

| Milestone | Status | Evidence / revision |
|---|---|---|
| Create isolated JJ workspace from plan revision | completed | `plugin-e2e-coverage-resume` at `/Users/astahmer/dev/dshfiles-plugin-e2e-coverage-resume`; preserved coverage integration `0d1441e8`; original source workspace remains untouched |
| Dynamic standalone bundle discovery + validated ignores | in progress | 23 bundles / 18 Client halves discovered; latest isolated boot passed 18/23 with zero ignores and 5 build failures (dsh-core-runtime, editor, jujutsu, queue-reorder, thread-sidebar) |
| DSHX feature declarations and completeness reporting | in progress | `features:check` reports 91 issues: 89 missing scenario tags, one stale unit-test reference, and the explicit missing-file diagnostic. Checker regression tests pass 3/3; the AI Accounts failure-recovery scenario is now mapped and tagged |
| Full plugin/library feature and configuration catalog | in progress | 27 catalogs (23 bundles + 4 libraries), 87 features, 126 configuration options, 119 Gherkin references, 239 unit-test references |
| Deterministic external fakes + browser behavior journeys | in progress | Settings Search 3/3, Shortcuts 4/4, Prompt Stash 5/5, AI Accounts recovery settings 1/1, and reserved-origin network probe 1/1 pass; full Command Palette run 6/7. Browser E2E now blocks external HTTP/WebSocket and service workers. Host-side egress remains uncontained; 23 fake descriptions across 11 packages still need proof of use |
| CI wiring and complete validation | pending | `deps:check` and `test:e2e:gen` pass. No CI workflow exists; E2E is outside the aggregate `check`, and no evidence-upload workflow is wired |

## Resume here

Continue only from `/Users/astahmer/dev/dshfiles-plugin-e2e-coverage-resume`; leave `/Users/astahmer/dev/dshfiles` and `/Users/astahmer/dev/dshfiles-plugin-e2e-coverage` untouched. AI Accounts type repair is recoverable in `c69ddcf8`; its failure-recovery settings journey and follow-ups are described revisions from `23fbafc5` through `9bccc9e5`. Other named workspaces remain active; split only exact owned paths and avoid rebasing/integrating while their writes are in flight. Current `@` still contains sibling changes.

Current inventory: 27 catalogs, 87 features, 126 options, 119 Gherkin references, 239 unit references. `features:check` has 91 issues: 89 declared scenarios lack `@scenario` tags, one unit reference is stale, and the checker reports the missing `plugin-journeys.feature` explicitly. `ai-accounts.failure-recovery` now maps to a tagged browser scenario; New Thread search/invocation passes isolated Chromium but does not prove session creation. `test:feature-coverage` passes 3/3, `deps:check` passes, and `test:e2e:gen` passes. DSHX maps `ClientContext.sessions` to Controller `ISessions`; build/typecheck and 48 focused tests passed previously.

Latest `test:boot`: 23 bundles / 18 Client halves, zero ignored, 18 pass and 5 fail (`dsh-core-runtime`, `editor`, `jujutsu`, `queue-reorder`, `thread-sidebar`). Isolated journeys: Prompt Stash 5/5, Settings Search 3/3, Shortcuts 4/4, AI Accounts recovery settings 1/1, and reserved-origin browser network probe 1/1; full Command Palette 6/7, with New Thread search/invocation separately passing 1/1. The 33-test full E2E run had 18 passes and 15 failures; the two Prompt Stash onboarding-overlay timeouts were fixed and Prompt Stash now passes 5/5, but the full suite was not rerun. Remaining failures are tied to known dsh-core-runtime and Thread Sidebar build blockers. Browser HTTP/WebSocket egress is blocked and service workers disabled; Host-side egress is not. CI remains unwired. Preserve sibling changes; checkpoint only owned paths.
