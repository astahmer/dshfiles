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
