# Plugin E2E coverage implementation

Plan: [../plugin-e2e-coverage.md](../plugin-e2e-coverage.md)

| Milestone | Status | Evidence / revision |
|---|---|---|
| Dynamic standalone bundle discovery + validated ignores | in progress | `test:boot` discovers bundles dynamically with zero ignores; the last recorded run predates the removal of the core-runtime and Cursor bundles, so re-run it for a current pass/fail list |
| DSHX feature declarations and completeness reporting | in progress | `features:check` reports 75 missing scenario tags; no bundle feature is missing a Gherkin reference. The checker now counts only tags attached to Scenario or Scenario Outline and diagnoses misplaced Feature-level tags. `test:feature-coverage` passes 5/5. Added a `shared-runtime` catalog and isolated clean-boot journey; account draft, manual save policy, usage-history retention, pricing settings, OptMem pause/resume, and Models-page account curation now have UI scenarios |
| Full plugin/library feature and configuration catalog | in progress | 30 catalogs, 95 features, 134 configuration options, 135 Gherkin references, 264 unit-test references; 0 Host-test references and 2 explicitly not-applicable references |
| Deterministic external fakes + browser behavior journeys | in progress | Prior-workspace E2E evidence: Settings Search 3/3, Shortcuts 4/4, Prompt Stash 5/5, AI Accounts recovery 1/1, network boundary 1/1, Command Palette 6/7; full 33-test run 20/33 with 13 build-blocked failures. Current BDD generation lists 58 tests in 17 files; the new Models-page curation journey has not been browser-executed. Two fake boundaries link to six concrete tests: models.dev pricing uses injected fetch/fake clock; OptMem uses a synthetic summarizer and fake clock. Focused AI Accounts tests pass 14/14 and OptMem tests pass 19/19. Other external fake descriptions remain unproven. E2E build fails because `@deepseek-ai/dsh-api-session-controller/client` declarations are missing. Browser HTTP/WebSocket routing allows only the scratch profile origin; Host-side egress remains uncontained |
| CI wiring and complete validation | in progress | New `.github/workflows/plugin-e2e-coverage.yml` runs inventory, catalog invariant tests, report generation, BDD generation/listing, and uploads the report/test list. `features:check` is a required gate and currently fails on 75 missing tags. Full browser execution is not wired into CI yet because the isolated build is blocked by Session Controller declarations |

## Resume here

Work from a named jj workspace off `main`. The counts above were recorded before
the vendored DSH core packages and the `dsh-core-runtime` and `cursor-agent`
bundles were removed; several blockers they list (missing Session Controller
client declarations, `dsh-core-runtime` packaging failures) came from that
vendored core. Re-run `pnpm --dir tooling/dshx test:boot`, `features:check` and
`test:e2e` on stock DSH 0.2.0-rc.2 to get a current baseline before continuing.
