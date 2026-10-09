# DSH web UI performance baseline (P0.1)

Measured 2026-10-09 on an isolated scratch instance copied from the `web` profile (same 15 `@dshfiles` bundles,
production `dist`, port 3311), in the built-in Browser pane. The live `web` instance on :3080 needs its process
token, so it was not profiled. The scratch home has 1 thread, so palette numbers are a floor; the 2,000-thread
numbers come from the P0.3/P0.6 harness.

In-page probe: `KeyboardEvent` ⌘K on `window`, poll `[cmdk-input]` per frame; 6 keystrokes into the cmdk input, each
measured to the next frame; "full recalc" appends one `<style>` and times the forced `offsetHeight` (rule-set rebuild,
which scales with the number of sheets). Long tasks via `PerformanceObserver('longtask')`.

| Metric | Target | Baseline |
|---|---|---|
| ⌘K palette open → first frame (p50 / max, 5 runs) | < 50 ms | 67.5 / 113 ms |
| Keystroke → frame (p50 / p95, 30 keys) | < 16 ms p95 | 8 / 15.6 ms |
| Long tasks during palette runs | none > 50 ms | 52, 58 ms (first opens) |
| Full style recalc, idle / palette open | < 5 ms | 15.3 / 21.2 ms |
| Idle long tasks, 10 s | none | none |
| `style[data-plugin]` total (all Host + plugins) | — | 151 tags, 1.87 MB |
| `@dshfiles` sheets | 1 | 12 tags, 1.39 MB (11 × 115,980 B identical, queue-reorder 116,407 B) |
| `document.styleSheets` | — | 153 |
| Client JS, 15 plugins (raw / gzip) | −25 % | 7.34 MB / 1.77 MB (already minified) |

Top client bundles: jujutsu 1.88 MB, ai-accounts 686 KB, multi-host 614 KB, secret-catalog 611 KB, mcp-servers
562 KB, thread-sidebar 516 KB.

Not captured: React Profiler render counts (no DevTools hook in the Browser pane); P0.4 measures them with a render
counter in tests instead.

## After P0.2 (shared sheet)

dshx folds each plugin's CSS into one `style[data-plugin="dshx:shared-css"][data-dshx-shared-css=<sha256/16>]`
injected once per content hash; each plugin keeps an empty owned marker `style[data-plugin][data-dshx-css]` so the
Host's HMR/disposal removal still works, and a MutationObserver drops the shared sheet once no marker references it.
queue-reorder's dock rule moved inline so its sheet is byte-identical.

| Metric | Before | After |
|---|---|---|
| Non-empty `@dshfiles` sheets | 12 (1.39 MB) | 1 (115,980 B) + 12 empty markers |
| Full style recalc, idle / palette open | 15.3 / 21.2 ms | 0.4 / 0.2 ms |
| Thread-sidebar HMR rebuild | — | 12 markers, 1 sheet kept |
| Remove 11 of 12 markers / all 12 | — | sheet kept / sheet removed |

## After P0.3 (palette)

cmdk filtering was already off and rows were already capped at 50; ranking is not the bottleneck. Search keys are now
lowercased once per thread list (`indexThreads`) and the query goes through `useDeferredValue`.

| Metric | Before | After |
|---|---|---|
| `rankThreads`, 2,000 threads, per keystroke (Node bench, 1,200 runs) | 0.56 ms | 0.40 ms |
| Palette open → `[cmdk-input]` committed (MutationObserver, pane hidden, 7 runs p50/max) | — | 21.2 / 21.7 ms |
| Keystroke → commit (42 keys p50/p95) | — | 1.1 / 4.2 ms |

The Browser pane was hidden for this run, so `requestAnimationFrame` numbers are not comparable with P0.1; commit
latency excludes paint. Regression guard: `thread-sidebar/src/palette-perf.test.ts` (p95 < 8 ms at 2,000 threads).
