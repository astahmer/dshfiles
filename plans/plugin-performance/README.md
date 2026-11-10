# Plugin performance pass: remaining plugins

Resume here: measure the twelve plugins below, largest first. Waves 1–6 are landed on `main` (wave 6: tool-search,
queue-reorder, worktree-memory, tweet-context, 2026-11-08) and their results, method and macro round are in
[docs/plugin-performance.md](../../docs/plugin-performance.md). A plugin is measured when it has a row there; a
package with no row is unmeasured.

Method: the `performance-optimization` skill — target, measure, hypothesis, smallest change, prove. Benches live
outside `src/` (a scratch file under `src/` breaks `dshx build`), judge by paired A/B and medians on this shared
machine, and add one result row per plugin to the docs table in the same revision as its fix (or `no-change` with the
evidence).

| Plugin                    | Source lines (`src/**/*.ts*`) | Note                                                                                                                     |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| cordis-client-runner      | 8,518                         | native fork (2026-11-09) of the stock runner; boot `syncInspectManifest` dedupe already measured in performance.md       |
| schedule                  | 7,492                         | native fork of `ui-schedule` (one source per Session, measured in performance.md); Host half unmeasured                  |
| session-persistence-jsonl | 5,396                         | native fork; lazy catalog hashing / folder memo already measured in the ultra-fast plan; tool catalog dedupe (perf docs) |
| agent-loop                | 2,503                         | native fork; replay-block trim measured in ram-usage.md                                                                  |
| cordis-cards              | 1,739                         | native fork of `ui-cordis`; boot inventory dedupe measured in performance.md                                             |
| storage-domain            | 1,380                         | native fork; per-record hydration measured in ram-usage.md                                                               |
| phone-pairing             | 1,176                         |                                                                                                                          |
| settings-subagent         | 1,020                         | native fork; boot catalog read through `joinPageRead`                                                                    |
| storage-json              | 894                           | native fork; per-record hydration measured in ram-usage.md                                                               |
| session-log-window        | 794                           | small-log tail refusal measured in the ultra-fast plan                                                                   |
| mermaid-diagrams          | 623                           |                                                                                                                          |
| phone-access              | 268                           |                                                                                                                          |

Most are native forks whose specific wins were measured elsewhere; a row here is still owed: the whole plugin
measured against a real workload, not only the delta that motivated the fork.
