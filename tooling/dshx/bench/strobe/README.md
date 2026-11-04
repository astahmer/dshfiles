# Scratch DSH strobe benches

These cases use a scratch DSH URL only. Never point them at `http://127.0.0.1:3080` or another live profile.

## Start and prepare the fixture

From the repository root, after machine load is below 12 on the 10-core Mac:

```sh
node tooling/dshx/packages/dshx/dist/cli/bin.js dev up --name strobe-bench
```

`up` without `--plugin` builds and loads the full owned bundle set. Wait for `dshx dev doctor --name strobe-bench` to pass. The bench `prepare` hook creates two short synthetic Sessions and one scratch-only Session with a 500 KB synthetic user message containing `strobe large history marker`; it uses no provider credentials and does not copy live Session data.

`dshx dev up` keeps its authenticated launch URL in a mode-600 state file at `$TMPDIR/dshx-dev/strobe-bench/state.json`. Supply that URL as `STROBE_BENCH_URL` through private shell environment only; do not echo, log, or save it. The bench `prepare` hook seeds synthetic sessions. If Strobe's browser cannot connect on this macOS setup, seed through the scratch browser instead with `node tooling/dshx/bench/strobe/seed-fixtures.mjs` and use the existing probes below.

## Run

Use the workspace-pinned `@hona/strobe` CLI. The authenticated URL stays in the environment, never in the process arguments. Use paired A/A runs to check same-build noise and collect timing results:

```sh
STROBE_BENCH_URL="${STROBE_BENCH_URL:?set scratch URL privately}" pnpm --dir tooling/dshx exec strobe bench bench/strobe/dsh-web.bench.ts --head . --aa --filter 'page-load-interactive,thread-switch,new-thread-composer,large-thread-open'
```

Use `bench --check` only to validate the driver. If CPU/layout attribution is needed, collect it separately with `record --bench ... --probes attribution`; those samples perturb timing and must not be mixed with timing results. Use the existing `host-lag.mjs` and `switch-probe.mjs` against the same scratch URL for Host event-loop, request, DOM, long-task, and WebSocket evidence that strobe does not replace.

### macOS CDP status (2026-11-04)

The pinned Strobe 0.6.0 `bench --check` attempt failed 0/4 cases before their hooks: every fresh Chromium CDP connection timed out in `prepare: overCDP` after 30 seconds. Do not treat that run as a timing result. Until Strobe's macOS CDP connection works, use the fallback probes above; retry `bench --check` first before collecting timings.

The primary metrics are per-case `phase.*` wall times. Thread switch and large history readiness are reported only after the composer/history DOM is visible; the screenshot/frame metrics are deliberately omitted on macOS because this project run skips additional Screen Recording or Accessibility grants.

Always clean up the DSH and strobe afterward:

```sh
node tooling/dshx/packages/dshx/dist/cli/bin.js dev down --name strobe-bench
pnpm --dir tooling/dshx exec strobe leave --yes
```
