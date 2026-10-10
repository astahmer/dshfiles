# Plugin E2E coverage implementation

Plan: [../plugin-e2e-coverage.md](../plugin-e2e-coverage.md)

| Milestone | Status | Evidence / revision |
|---|---|---|
| Create isolated JJ workspace from plan revision | completed | `plugin-e2e-coverage` at `/Users/astahmer/dev/dshfiles-plugin-e2e-coverage`, descends from `34f9e519`; original workspace remains untouched |
| Dynamic standalone bundle discovery + validated ignores | in progress | 5 inventory tests pass; current tree discovers 23 bundles / 18 client halves; previous 16/22 boot result is stale and must be rerun |
| DSHX feature declarations and completeness reporting | in progress | Feature schema, diagnostics, report/checker, fixture tests, and package catalogs implemented; schema/manifest tests previously passed 30/30; current report still has missing scenario tags |
| Full plugin/library feature and configuration catalog | in progress | 27 catalogs (23 bundles + 4 libraries), 86 features, 123 configuration options, 117 Gherkin references, 230 unit-test references |
| Deterministic external fakes + browser behavior journeys | in progress | Settings Search and Command Palette journeys authored; `test:e2e:gen` passes; Settings Search browser proof is being retried after first-run modal interception |
| CI wiring and complete validation | pending | |

## Resume here

Continue only from `/Users/astahmer/dev/dshfiles-plugin-e2e-coverage`; do not modify the original shared workspace. The task workspace is conflict-free at `60e37ded` after shared JJ reconciliation; the original workspace still has active edits and remains untouched. Current inventory is 23 bundles / 18 client halves. The last boot gate (16/22) predates the current tree and must be rerun. All 27 owned package catalogs declare 86 features, 123 configuration options, 117 Gherkin references, and 230 unit-test references; the latest feature report still has 114 issues (missing scenario tags plus two orphan Settings Search tags). `test:e2e:gen` passes; the first real Settings Search browser run exposed the native Preview Notice intercepting clicks, so verify the unconditional dismissal fix before claiming the journey works. Next map Settings Search tags, add the command-palette performance tag, resolve remaining coverage gaps without placeholders, build deterministic external fakes and run real browser journeys, wire CI, then checkpoint only owned paths with `jj split`.
