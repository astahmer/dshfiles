# Plugin E2E coverage: remaining work

The harness, the layering, feature catalogs, the boot smoke and the evidence
receipts are documented in [docs/e2e-testing.md](../docs/e2e-testing.md).
Current state (2026-10-14): `features:check` passes with 33 catalogs, 103
features, 151 configuration options, 132 Gherkin scenarios and 350 unit-test
links; 18 entries are `not-applicable`, each with a concrete reason (8 multi-host,
3 goal-stall-guard, 3 mcp-servers, and one each in ai-accounts, project-checks,
request-messages and shared-streams).

## Remaining

- [ ] **Run the journeys in CI.** `plugin-e2e-coverage.yml` lists scenarios but
      never executes them. Add a PR smoke (client boot plus one or two journeys)
      and a scheduled full run, and feed the run results into `features:report`
      so it separates failing, unrun and browser-verified features.
- [ ] **Fresh green baseline on stock rc.2.** Run `test:e2e` end to end; most
      journeys landed 2026-10-13 and have not run together since.
- [ ] **Fix `command-palette.content-search`.** It boots
      `@dshfiles/dsh-core-runtime`, which was deleted, so it cannot pass.
      Recompose it on stock DSH or drop the feature.
- [ ] **Contain Host egress.** Only the browser is restricted; the Host can
      still reach the network during a journey.
- [ ] **Failed-entry boot scenario.** The step "every client entry that failed
      to activate is reported by id" (`e2e/support/steps.ts`) has no scenario;
      add one with a fixture bundle whose `apply` throws, or delete the step.
- [ ] **Scaffold a catalog.** `create-dshx` does not emit a `dshx.features.json`
      for a new plugin, so `features:check` only catches it after the fact.
- [ ] **Review catalogs against the running product** in a scratch profile and
      file discrepancies as bugs instead of trusting source-derived entries.
- [ ] Propose upstream a documented boot-state accessor
      (`window.__DSH_BOOT_STATE__`) so steps stop parsing the localized boot card.

## Open questions

1. Should the full journey suite gate every PR, or run on a schedule with a PR
   smoke only? Either way, reports must not count unrun features as covered.
2. How much evidence to retain in CI: measure the artifact size of a full run
   before raising retention.
