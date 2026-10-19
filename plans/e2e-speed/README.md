# E2E speed and work-skipping plan

## Context

The browser suite is the repository's bottleneck: a broad `check:e2e` measured 2594s of owner-task
time (43 journey tasks, 193 scenarios, 48 feature files) and one accidental invocation cost 50
minutes of wall time. The requested outcome: a full suite that mostly _replays_ — after landing one
or two plugins, only what that change can reach should run — plus a faster journey itself.

The first revision landed on `main` as `jj:znlyqmymomlv` (bounded waits, an unscoped-run refusal,
fail-fast broad runs, one BDD generation per run, a ledger-based scratch-Host reaper). This plan
covers what is left.

## Measured before the first revision

| Fact                                       | Number                        | Source                                             |
| ------------------------------------------ | ----------------------------- | -------------------------------------------------- |
| Broad run owner-task time                  | 2594s across 32 fresh tasks   | `plugins/*/.turbo/turbo-test$colon$e2e.log`        |
| Timeout tax (unbounded Playwright actions) | 1302s, 4 owners               | `locator.click: Test timeout of 300000ms exceeded` |
| Per-scenario wall, median                  | 8.3s, of which 5-8s boot      | `output/e2e-evidence/run-*/manifest.json`          |
| `pnpm install` per scratch profile         | 1.19s warm                    | leak sample, `--prefer-offline`                    |
| `dsh --dump-config` per scenario           | 0.17s                         | same                                               |
| APFS clone of a prepared profile           | 0.42s                         | `cp -Rc` of a 21 MB / 359-entry tree               |
| `bddgen` per owner task                    | 3.6-4.8s, all 48 specs        | direct timing                                      |
| No-change closure build                    | 1.03s, 48 tasks, `FULL TURBO` | Turbo                                              |
| Dist digest pass, all packages             | 0.27s                         | `writeDistDigests`                                 |
| Serial vs 3 owners at once                 | 155s vs 110s (1.41x), 1 flake | 8 owners, forced                                   |
| Leaked scratch Hosts and providers         | 13 + 12, oldest 23h           | `ps`                                               |

## Why the cache missed after the linearization

Turbo keys a task on input _content_, and two different JJ workspaces produced byte-identical task
hashes, so a rebase that keeps a file's content does not bust anything. The 50-minute run re-ran
because the merged tree genuinely changed ~30 bundles' `dist`, because the run was the whole suite,
and because half its wall time was the timeout tax. Fan-out is earned, not an artifact: the task key
covers every bundle the journey's steps touch.

## Fan-out (tasks re-run when this bundle's dist changes)

`dshx` 43 · `plugin-ui` 39 · `ui-styles` 38 · `shared-runtime` 36 · `command-palette`,
`workspace-folder-picker`, `project-folder-picker` 30 · `project-checks` 28 · `jj-integration`,
`multi-host` 27 · `ai-accounts`, `request-messages`, `secret-catalog` 23 · `thread-sidebar` 10 ·
a leaf plugin 3.

## Where a scenario's time goes (measured 2026-10-19)

`DSHX_E2E_BOOT_TRACE=1 pnpm run check:e2e pulls-review ui-styles editor frame-layout`, six scenarios,
one worker, a machine at load 8-10:

| Phase                 |         Range | What it is                                                                |
| --------------------- | ------------: | ------------------------------------------------------------------------- |
| `prepare`             |      2.1-3.8s | fresh scratch home: manifest write plus `pnpm install --prefer-offline`   |
| `composition-dump`    |    0.45-0.83s | a whole `dsh --dump-config` process proving the profile loads its bundles |
| `host-url`            | **4.0-12.1s** | spawning `dsh` until it announces its URL — the dominant cost             |
| `page-load`           |    0.24-0.94s | `page.goto` to `domcontentloaded`                                         |
| `profile-interactive` |      2.7-5.8s | client boot, first paint, onboarding dialog dismissed                     |

So a scenario is 10-19s here, and ~12s of that is the Host: its startup and the client's boot. Nothing
about the _assertions_ is the bottleneck.

## Work packages

| #   | Package                                                                                                                                                                                                      | Status                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| E1  | Bound every wait, refuse an unscoped broad run, fail fast, one BDD generation, reap leaked Hosts                                                                                                             | Landed as `jj:znlyqmymomlv` |
| E2  | Boot-phase trace and the composition-validation cache                                                                                                                                                        | Landed (below)              |
| E3  | Route-interception cost (the network boundary round-trips every request of every page load)                                                                                                                  | Rejected with numbers       |
| E4  | Scenario-level result cache: key each scenario by its own steps plus the dists it reaches, so a change re-runs the scenarios that can see it and replays the rest — rebase-proof because it is content-keyed | Slice 1 landed (below)      |
| E5  | Boot reuse: hide the Host startup behind the previous scenario                                                                                                                                               | Landed (below)              |
| E6  | Wall-time budget ratchet (warn-only first)                                                                                                                                                                   | Optional                    |

### E2 receipt

`traceBootPhase` prints the five phases under `DSHX_E2E_BOOT_TRACE=1`, and the worker now validates a
composition once instead of once per scenario: the composition is a property of the profile files, not
of the scratch home. Measured on two scenarios of one composition: `composition-validated` **481ms then
1ms**, and the `frame-layout` task 44s → 23s across two runs (only the dump is attributable — the
machine was quieter for the second). 23 of the 26 `thread-sidebar` scenarios share one composition, so
a heavy file now spends that cost once.

### E4 design sketch

A task is one owner × its feature files, so a change to a bundle booted by 30 owners re-runs every
scenario those owners hold — the fan-out table above. Split the key per scenario instead:

1. The planner already matches each feature's steps to definitions; do it per _scenario_ and record the
   `@dshfiles/*` ids each scenario's own steps name, plus the harness and feature bytes.
2. Key = sha256 of the scenario text, its steps' expressions and bodies, those bundles' dist digests,
   and `pnpm-lock.yaml`. A change to a bundle a scenario never drives does not move its key.
3. Store a pass receipt per key under `.turbo/e2e-scenarios/`, and let the runner select the scenarios
   whose key is missing or failing. Report the reused count in the summary so a "green in 20s" run is
   legible rather than suspicious.
4. Risks to settle first: retries and flakes must invalidate the receipt, a `--force` must ignore the
   cache, evidence receipts must say which scenarios were replayed rather than run, and the step-body
   mapping stays conservative (a step that boots every bundle keeps its whole task keyed).

### E3 receipt: the network boundary is not a cost

A/B on `frame-layout`, forced (knobs pass through and are not part of the task key, so an unforced A/B
replays one side), two runs each side, four samples per side: with the boundary installed `page-load`
median 92ms and `profile-interactive` median 954ms; with it skipped, 82ms and 1130ms. The differences are
noise, and the "slower" side is the boundary-free one. **Keep the boundary as it is**; narrowing its
`**/*` pattern would buy nothing and weaken a real guarantee.

### E4 slice 1 receipt: per-scenario impact

`featureScenarios` splits a feature into scenarios with their own step lines, the planner records what
each scenario's own steps reach, and `node tooling/dshx/scripts/browser-tasks.mjs --impact @dshfiles/x`
prints the scenarios a change to that bundle can see. Measured task-level vs scenario-level reach:

| Bundle                              | Tasks | Scenarios |
| ----------------------------------- | ----: | --------: |
| `@dshfiles/ui-styles`               |    38 |       176 |
| `@dshfiles/thread-sidebar`          |    10 |        42 |
| `@dshfiles/ai-accounts`             |    23 |        41 |
| `@dshfiles/workspace-folder-picker` |    30 |        37 |
| `@dshfiles/command-palette`         |    30 |        19 |
| `@dshfiles/pulls-review`            |     3 |         2 |

Slice 2 is the receipt store plus enforcement: key each scenario on its own steps and the dists they
reach, keep a pass receipt, and let the runner skip the scenarios whose key is unchanged — reporting the
replayed count in the summary. Until that lands, `--impact` is how a person decides what to run.

### E5 receipt

`prewarmSibling(profile)` starts a sibling boot of the same composition while the current scenario runs
its steps, and the next scenario that asks for that composition takes it (`prewarmed-take`); at most one
spare is kept, an untaken spare is dropped when the next prewarm starts, and a spare still alive when
the worker exits is killed by its pid from a synchronous `exit` handler. Isolation is untouched: the
sibling has its own home, Host and port. `DSHX_E2E_PREWARM=0` disables it.

Measured on `frame-layout` (two scenarios, one composition): the first scenario booted in 6.0s
(prepare 1.2s, dump 0.28s, host-url 3.0s, page-load 0.15s, interactive 1.4s) and started a sibling that
finished in 4.1s while it ran; the second scenario's trace shows `prewarmed-take` and no
prepare/host-url at all, 6.3s end to end against 8.7s for the first. On the loaded machine the same
file went 63s → 40s, and the run leaves zero orphaned Hosts. A file whose scenarios change composition
each time pays the sibling's CPU for nothing — that is the cost to watch before widening this.

### E5 design notes (superseded by the receipt above)

`host-url` is 4-12s and cannot be cached — only avoided. A worker's scenarios share a composition, so
while scenario N runs, prepare and boot the Host for a spare slot of the _same_ composition, and hand
it to scenario N+1 when its Given step asks for that composition; discard it otherwise. Isolation
survives because each scenario keeps its own home and Host; only the wall-clock overlaps. Measure the
idle-slot host memory and the discard rate before making it the default.

## Resume here

E1, E2, E3 (rejected), E4 slice 1 and E5 are done. Next: **E4 slice 2**, the per-scenario receipt store
and its enforcement in the runner — key each scenario on its own steps plus the dist digests they reach,
store a pass receipt, skip the unchanged ones, and report how many were replayed. Two measurements worth
taking alongside it: a browser pool is worth ~58ms per context (median, measured — not the bottleneck),
and the prewarm's cost when consecutive scenarios change composition (one wasted sibling boot, overlapped,
seen on `activity-timeline`).
