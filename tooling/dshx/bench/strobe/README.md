# Scratch DSH web benchmarks

Run only against a disposable `strobe-bench` scratch instance. The driver reads
its launch URL and fixture IDs from scratch state; it does not take a live URL.

## Prepare the fixture

From the repository root, with the workspace dependencies installed and
Playwright Chromium available (`pnpm --dir tooling/dshx exec playwright install chromium`):

```sh
pnpm --dir tooling/dshx run build
umask 077
bench_tmp=$(mktemp -d "${TMPDIR:-/tmp}/dsh-strobe.XXXXXXXX")
export DSHX_DEV_STATE_ROOT="$bench_tmp/dsh"
dshx() { node tooling/dshx/packages/dshx/dist/cli/bin.js "$@"; }
dshx dev up --name strobe-bench > "$bench_tmp/startup.log" 2>&1
dshx dev doctor --name strobe-bench
node tooling/dshx/bench/strobe/seed-fixtures.mjs
```

`up` builds and loads the full owned bundle set. Wait for `doctor` to pass.
The seeder uses a separate, headless Playwright browser. It creates two short
synthetic Sessions and one Session with a roughly 500 KB synthetic user
message, without provider credentials or live Session data. Seed once per
scratch instance, not once per Strobe block.

The project-selection regression test needs Chromium but no running DSH:
`node --test tooling/dshx/bench/strobe/select-project.test.mjs`.

## Run Strobe

Strobe's runner needs Bun on `PATH`. The [pinned Strobe 0.6.0 runner](https://github.com/anomalyco/strobe/blob/v0.6.0/sdk/bench/src/runner.ts#L154-L164)
attempts a second CDP connection through Playwright before running a target's
`prepare` hook. In the original macOS run, that attachment timed out even
though Strobe had already started Chromium. The DSH driver now seeds out of
process and uses Strobe's own browser driver, with no `prepare` hook. The smoke
check takes one sample per case; do not report those samples as a timing baseline.

```sh
strobe() { XDG_DATA_HOME="$bench_tmp/strobe" pnpm --dir tooling/dshx exec strobe "$@"; }
strobe bench bench/strobe/dsh-web.bench.ts --head . --check --filter page-load-interactive > "$bench_tmp/check-one.log" 2>&1
strobe bench bench/strobe/dsh-web.bench.ts --head . --check > "$bench_tmp/check-all.log" 2>&1
```

Keep raw logs and Strobe artifacts in the private temp directory: they may
contain the authenticated launch URL. Do not print or share that URL. If
Strobe fails to start Chromium itself, try setting `STROBE_BROWSER` to the
absolute path of an installed **full** Chrome/Chromium executable, not the
Playwright headless shell, and retry the one-case check.

Once all four checks pass, wait until the machine is quiet (on the 10-core test
Mac, one-minute load below 12, no builds or E2E runs). Collect paired A/A
results on the same build to estimate noise, with no attribution runs:

```sh
uptime
strobe bench bench/strobe/dsh-web.bench.ts --head . --aa --pairs 6 --why never > "$bench_tmp/aa.log" 2>&1
uptime
```

Report the four `phase.*` wall times and their A/A spread. See the
[macOS baseline](../../../../docs/performance.md#scratch-dsh-strobe-baseline-2026-11-23).
These are scratch measurements, not comparisons against live DSH. Use `record --bench ...
--probes attribution` separately if CPU/layout attribution is needed. For Host
event-loop, request, DOM, long-task and WebSocket evidence that Strobe does not
replace, run the existing `host-lag.mjs` and `switch-probe.mjs` probes against
the same scratch URL. No Screen Recording or Accessibility permissions are
needed for these phases.

## Fallback without Strobe's browser

After preparing the same scratch fixture, run all four cases with Playwright
(or pass a single case name):

```sh
node tooling/dshx/bench/strobe/run-playwright.mjs
```

This runs the same actions and readiness checks and prints the median and range
of five iterations. It does not collect Strobe traces or provide paired A/A
statistics. Label the results as Playwright timings; don't mix them with
Strobe's timing baseline.

When done, shut down only the scratch instance. Keep or remove the private
temp directory according to whether you still need its evidence.

```sh
dshx dev down --name strobe-bench
```
