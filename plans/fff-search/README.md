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
- Seven "find me X" tasks × 3 arms × 2 reps, Sonnet, 2026-10-19. Raw rows:
  [`runs-sonnet-2026-10-19.jsonl`](runs-sonnet-2026-10-19.jsonl).

```sh
node scripts/fff-bench.ts --corpus <checkout> --fff <fff-mcp binary> --out <dir> --reps 2 --model sonnet
node scripts/fff-bench.ts --report <dir>
```

## Results

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

## Limits of this run

- Two reps per cell and one model; treat the differences as directional.
- 11.5k files is a mid-size repository. fff claims its largest wins on very
  large trees.
- Claude Code's Grep, not DSH's, was the baseline. DSH `grep` also spawns
  ripgrep for every call, caps at 250 matches, and its `glob` runs with
  `--no-ignore --hidden`. DeepSeek models may use the tools differently.
- The fff-mcp server stopped answering after about 20 identical back-to-back
  `grep` calls in the micro-benchmark. Agents never repeat a query like that,
  but report it upstream if it shows up in real use.

## Recommendation

Choose **port**: an owned `fff-search` plugin that disables the stock
`tool-fs-search` row and registers `grep`/`glob` backed by `@ff-labs/fff-node`.
Do not just add the MCP server.

- Replacing is where the gain is. MCP can only add `mcp__fff__*` next to native
  `grep`/`glob`, which is the `fff` arm. A plugin keeps the tool names and
  prompts Agents already know.
- A dshx plugin can hold the index across calls: build it in `setup`, dispose it
  in a `ctx.effect` cleanup, as `memory` and `session-search` do.
- The plugin decides the output contract. Always print the total match count, and
  return everything up to native's 250-match cap for listing-style queries.
  That removes the cursor paging behind the 0.71.

Zero-code trial meanwhile: add an `fff` stdio row through the `mcp-servers`
plugin (`command: <abs fff-mcp>`, `args: [--no-update-check]`) and watch
whether DeepSeek threads use it.

## Open work

1. Run the same tasks through a DSH Agent (DeepSeek), stock tools vs fff, with
   the [`dsh-sessions`](../../.agents/skills/dsh-sessions) digest for turns and
   tokens.
2. Add a larger corpus (≥100k files) and more listing-style tasks, at 5 reps.
3. Package fff-mcp / libfff from the prebuilt release in nixfiles before any
   profile depends on it.
4. Prototype the `fff-search` plugin behind a profile flag, then benchmark it
   against stock `tool-fs-search`.
