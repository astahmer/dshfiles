# Plugin E2E coverage implementation

Plan: [../plugin-e2e-coverage.md](../plugin-e2e-coverage.md)

| Milestone | Status | Evidence / revision |
|---|---|---|
| Create isolated JJ workspace from plan revision | completed | `plugin-e2e-coverage` at `/Users/astahmer/dev/dshfiles-plugin-e2e-coverage`, base `34f9e519` |
| Dynamic standalone bundle discovery + validated ignores | in progress | 5 inventory tests pass; 22 bundles / 17 client halves discovered at base `34f9e519`; latest boot gate 16/22 passed, six package builds still fail |
| DSHX feature declarations and completeness reporting | in progress | Feature schema, manifest diagnostics, report/checker, and fixture tests implemented; DSHX schema/manifest tests pass 30/30; root check blocks on 111 Gherkin tags not yet authored |
| Full plugin/library feature and configuration catalog | in progress | 26 package catalogs (22 bundles + 4 libraries), 80 features, 148 verification references; independent test mapping/review ongoing |
| Deterministic external fakes + browser behavior journeys | pending | External boundaries inventoried; no new journeys or fake adapters completed yet |
| CI wiring and complete validation | pending | |

## Resume here

Continue only from `/Users/astahmer/dev/dshfiles-plugin-e2e-coverage`; do not modify the original shared workspace. Dynamic discovery and validated ignore handling are implemented, but the latest boot gate still has six package-build failures and no ignores are being used to hide them. DSHX feature schema/manifest diagnostics and the repository report/checker are implemented; all 26 currently present owned package catalogs (22 bundles and 4 libraries) declare 80 features and 148 verification targets. The catalog check currently reports 111 missing Gherkin tags; add real behavior journeys and deterministic external fakes, not placeholder tags. Keep this branch based on `34f9e519`: the shared source checkout contains active edits, so do not rebase or import the later `command-palette` commit until its owner’s work is safely integrated. Next use the read-only test-mapping audits, fix configuration gaps, implement and run the journeys, then wire CI and checkpoint each milestone with `jj split`.
