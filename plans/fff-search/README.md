# fff search for Agents

Question: should DSH Agents search code through [fff](https://github.com/dmtrKovalenko/fff)
(a resident, frecency-ranked file and content index) instead of the native
`grep`/`glob`, and if so as an MCP server or as an owned plugin?

## How it was measured

- Harness: [`scripts/fff-bench.ts`](../../scripts/fff-bench.ts) with tasks in
  [`scripts/fff-bench-tasks.json`](../../scripts/fff-bench-tasks.json). It runs
  headless `claude -p` sessions with no user/project settings, hooks, CLAUDE.md
  or other MCP servers, so only the arm differs. Each task has a known answer
  that the script grades.
- Arms: `baseline` (Read, Grep, Glob and read-only Bash), `fff` (baseline plus
  the fff MCP and the upstream hint "use fff tools"), and `fff-only` (Read plus
  fff).
- Corpus: a clean checkout of welii at `be37644993` (11.5k tracked files, no
  `node_modules`). fff-mcp `v0.11.0` prebuilt `aarch64-apple-darwin`, checksum
  verified, with per-run frecency and history databases so runs never warm each
  other.
- Claude Code: seven "find me X" tasks × 3 arms × 2 reps, Sonnet, 2026-10-19.
  Raw rows: [`runs-sonnet-2026-10-19.jsonl`](runs-sonnet-2026-10-19.jsonl).
- DSH: the same tasks through DSH Agents on a scratch DSH (`dshx dev up`),
  OpenCode Go `opencode-go-alex` / `deepseek-v4.1-flash` (high), 3 parallel
  sessions, 3 reps per arm, driven by
  [`scripts/fff-bench-dsh.ts`](../../scripts/fff-bench-dsh.ts). Raw rows:
  [`runs-dsh-flash-2026-10-19.jsonl`](runs-dsh-flash-2026-10-19.jsonl).

```sh
node scripts/fff-bench.ts --corpus <checkout> --fff <fff-mcp binary> --out <dir> --reps 2 --model sonnet
DSHX_URL=<scratch launch url> node scripts/fff-bench-dsh.ts --corpus <checkout> --arm <label> --out <dir> --reps 3
node scripts/fff-bench.ts --report <dir>
```

The DSH arm is whatever the scratch profile loads. Seed the scratch home's
`.credentials.yaml` and `plugins/ai-accounts/accounts.json` first, because
`dshx dev up` passes no Host environment through.

## Claude Code results

| Arm        | Accuracy | Median session | Median API | Turns (total) | Input tokens | Tool output chars | Cost  |
| ---------- | -------- | -------------- | ---------- | ------------- | ------------ | ----------------- | ----- |
| `baseline` | 1.000    | 20.4 s         | 7.5 s      | 44            | 359k         | 85.7k             | $0.38 |
| `fff`      | 1.000    | 18.4 s         | 7.2 s      | 49            | 453k         | 35.6k             | $0.38 |
| `fff-only` | 0.959    | 14.2 s         | 6.3 s      | 57            | 356k         | 54.2k             | $0.38 |

Session time excludes the ~15 s `claude` CLI boot, which every arm pays.

- **`fff-only` is faster** (−30% median session time, −16% API time) and returns
  37% fewer tool-output characters, at the same cost. It won or tied 6 of 7 tasks.
- **It loses on exhaustive listings.** fff `grep` shows 20 lines by default
  (`20/50 matches shown`); for "list every caller" Sonnet paged with cursors for
  up to 10 turns and still found 71% of the 19 files, while one native Grep
  call found all of them.
- **Adding fff next to the native tools does not pay.** The model used both
  (`mcp__fff__grep` then `Grep`), so input grew 26% for a smaller time win.
  fff only helps when it replaces the native search.

Tool-level, warm index vs one `rg` spawn on the same corpus (median of 3; the
machine was loaded, so absolute `rg` times are high):

| Query                        | fff `grep` | `rg -n` | fff chars | `rg` chars |
| ---------------------------- | ---------- | ------- | --------- | ---------- |
| `organizationIdChecker`      | 8 ms       | 2.8 s   | 1.5k      | 43k        |
| `LetAutoRenewBlocked…Error`  | 2 ms       | 2.5 s   | 1.0k      | 0.9k       |
| `CommitmentV2LifecycleRules` | 652 ms     | 2.8 s   | 2.5k      | 24k        |
| `find_files` vs `fd`         | 82 ms      | 808 ms  | –         | –          |

fff's first call pays the index build (4–8 s here).

## DSH results (DeepSeek V4.1 Flash)

| Arm             | What the Agent has                                           | Accuracy | Median session | Search time per session (median) | `grep` per call (median / p90)    |
| --------------- | ------------------------------------------------------------ | -------- | -------------- | -------------------------------- | --------------------------------- |
| `stock`         | native `grep`/`glob`                                         | 21/21    | 37.2 s         | 5.5 s                            | 3.1 s / 9.4 s                     |
| `stock-control` | native, same instance as the plugin runs                     | 20/21    | 32.8 s         | 5.6 s                            | 4.1 s / 6.3 s                     |
| `fff-mcp`       | native plus the fff MCP row                                  | 21/21    | 39.5 s         | 4.9 s                            | native 4.1 s; fff 0.8 s (4 calls) |
| `fff-only`      | fff MCP, `tool-fs-search` disabled                           | 21/21    | 34.2 s         | 0.3 s                            | 0.28 s / 1.7 s                    |
| `fff-plugin-v3` | [`fff-search`](../../plugins/@dshfiles/fff-search/README.md) | 21/21    | 20.6 s         | 0.7 s                            | 0.36 s / 1.1 s                    |

- **Native DSH `grep` is the slow part:** 3–4 s median per call with three
  Agents searching, because every call spawns ripgrep. Session time is mostly
  OpenCode Go latency, which swings by minutes (the control's 248 s p90 and its
  one failure are provider stalls with 3–5 turns), so search time per session is
  the number to compare.
- **Flash behaves like Sonnet:** with both available it calls native `grep` 26
  times and fff 8 times, so the MCP row alone changes little. Replacing the
  native tools cuts search time per session from 5.5 s to 0.3–0.7 s.
- **The plugin matches the MCP once warm.** v1 (fff on the Host thread, every
  pattern wrapped in a regex group) measured 0.9 s per call. v3 moved the index
  into a worker thread, sends plain literals in fff's plain mode, wraps only
  constraint-shaped patterns and makes `glob` wait only for the file scan. A
  fresh index still costs 5–15 s before the first content search; the plugin
  warms it when an Agent starts. Rep 0 of v2 ran against a cold index and was
  4 s per session.
- `fff-only` loses the exhaustive-listing case less on Flash than on Sonnet. The
  Agent falls back to `bash` rg, which the stock preset keeps.

## Limits

- Three reps per arm, one machine under load from other work, one corpus of
  11.5k files. The plugin arm and its control ran on a later scratch instance
  than the MCP arms.
- The fff-mcp server stopped answering after about 20 identical back-to-back
  `grep` calls in a micro-benchmark. Agents never repeat a query like that.

## Decision

Port, through the owned [`fff-search`](../../plugins/@dshfiles/fff-search/README.md)
bundle. It registers `grep`/`glob` per Agent through `agent.ctx`, which shadows
the stock tools without restating the standard preset. The MCP route needs the
preset restated without `tool-fs-search` and renames the tools, and the MCP row
next to the native tools does not change what the model calls.

## Open work

1. Add `@dshfiles/fff-search` to the `web` profile. This needs a DSH restart,
   which is the user's call.
2. Benchmark a larger corpus (≥100k files) with more listing-style tasks at 5
   reps, and a pass on a reasoning model, not only Flash.
3. Watch for the fff-mcp hang on repeated identical `grep` calls through the
   fff-node path, and report it upstream if it reproduces.
