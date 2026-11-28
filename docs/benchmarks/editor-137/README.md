# Reproduce the editor #137 evaluation

This is a benchmark fixture, not a DSH plugin. [Decision and scope](../../performance.md#editor-engine-evaluation-2026-11-23). It requires Node 24.11.1, Jujutsu with `4c0774edaf0995d0639d235e725a1c977622e62f` available, npm, and locally installed Playwright 1.56.1 Chromium and WebKit binaries. Set `PLAYWRIGHT_BROWSERS_PATH` to their cache directory; the runner does not download browsers. Use a quiet machine. Run from the repository root:

```sh
node docs/benchmarks/editor-137/run.mjs install
export PLAYWRIGHT_BROWSERS_PATH=/absolute/path/to/playwright-browser-cache
node docs/benchmarks/editor-137/run.mjs desktop        # five Chromium cold/warm pairs per mode
node docs/benchmarks/editor-137/run.mjs phone          # one 390×844 WebKit cold/warm pair per mode
node docs/benchmarks/editor-137/run.mjs native         # five stock Chromium preview pairs
node docs/benchmarks/editor-137/run.mjs native-phone   # one stock 390×844 WebKit preview pair
node docs/benchmarks/editor-137/verify.mjs             # verify logged measurements against the report
```

`RUNS=1` selects a smoke sample. `MODES=current`, `MODES=modern-core`, or `MODES=modern-full` selects an editor mode. An editor phone failure exits nonzero and emits a sanitized failure row (including the step and any model error); other attempts continue. Syntax and model behavior are checked using synthetic 241-line TypeScript files. The scratch save is not the DSH write API.

**Negative control:** run `node docs/benchmarks/editor-137/run.mjs red`. It must exit 1 with `save must deliver the exact edited synthetic file` despite HTTP 204. Then run `MODES=current RUNS=1 node docs/benchmarks/editor-137/run.mjs desktop`; the same save assertion must pass.

**Isolation:** [package.json](package.json) pins the direct packages. Only `install` contacts the public npm registry, using an isolated npm environment, with lifecycle scripts, audit, and funding disabled. npm writes its resolved transitive lock in the scratch stage; it is not part of this fixture. The pinned upstream engine inputs are read via `jj file show`, not from the working copy. The editor HTTP server binds an ephemeral loopback port, serves only an allowlist of local modules, workers, and language assets, and rejects off-origin save requests. The browser uses an ephemeral Playwright context and never uses a personal browser profile.

**Native launch:** [native-launch.mjs](native-launch.mjs) creates a fresh scratch HOME, DSH_HOME, Documents directory and two generated files; it checks canonical paths, absence of prior workspace state, and the exact effective `workspace-controller.documentsDirectory` in the stock CLI's `--dump-config` output. It refuses to start Web if any check fails. This override matters on macOS: `HOME` alone does not redirect the native Documents lookup. The stock CLI then binds `127.0.0.1` on port `0` with `--no-open`, no model/account configuration, and no credential environment. The launch URL stays in process memory and is not passed as an argument or written to disk. The probe permits only the launched origin's browser HTTP/WebSocket traffic and verifies the rendered Files root before opening files. The owned Host and native scratch home are cleaned up when the probe ends. Nothing accesses the live DSH instance. The ignored `node_modules/.editor-137-repro` stage can be discarded after all runs stop.

**Recorded inputs:** [Chromium editor](samples/editor-desktop.jsonl), [WebKit editor](samples/editor-webkit.jsonl), [Chromium native](samples/native-desktop.jsonl), and [WebKit native](samples/native-webkit.jsonl) are the successful raw rows behind the comparison, not targets that later runs must match exactly. The original WebKit run aborted on full mode's warm exact-text check, after the recorded cold success. The [durable-runner WebKit rerun](samples/editor-webkit-rerun.jsonl) records all six attempts, including the full-mode warm `Model is disposed!` failure. The durable runner also tightens native origin blocking and renames the source DOM marker, so small shell/network differences from the recorded revision of the probe are expected. Columns include endpoint/asset names and aggregate lengths only, never request payloads or local profile paths.
