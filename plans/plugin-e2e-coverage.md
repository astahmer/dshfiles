# Plugin E2E coverage: remaining work

The harness, the layering, feature catalogs, the boot smoke, the evidence receipts and the CI shape (a `@smoke` subset
on every PR, every journey nightly in six shards) are documented in [docs/e2e-testing.md](../docs/e2e-testing.md).

Resume here: wait for the first nightly `journeys` run of `plugin-e2e-coverage.yml`, triage its red shards, then feed
its results into `features:report`.

## Remaining

- [ ] **Fresh green baseline on stock rc.2.** The nightly `journeys` job is the baseline run; it has not run yet. Triage
      each red owner from its `plugin-journeys-<run>-<shard>` artifact as drift, harness gap or regression
      (`maintain-verify-dsh`). Known red locally on 2026-11-10: `session-undo.undo-redo-files` fails in a scratch DSH
      from a dirty shared workspace (the `bash` tool call its turn depends on), so check it there first.
- [ ] **Feed run results into `features:report`**, so it separates failing, unrun and browser-verified features instead
      of counting a linked tag as covered.
- [ ] **Measure the artifact size** of a red nightly shard before raising its seven-day retention.
- [ ] **Clean the coverage report.** `features:report` exits 1; rerun it on `main` for the current issue list (missing
      `dshx.features` manifest references, orphaned tags, unspanned Host I/O). The 2026-10-21 per-feature inventory was
      dropped: the catalog grew from 197 to 478 features, and the report lists the features without a Gherkin journey.
- [ ] **Review catalogs against the running product** in a scratch profile and file discrepancies as bugs instead of
      trusting source-derived entries.
- [ ] Propose upstream a documented boot-state accessor (`window.__DSH_BOOT_STATE__`) so steps stop parsing the
      localized boot card.
