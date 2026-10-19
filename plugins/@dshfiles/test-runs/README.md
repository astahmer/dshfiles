# @dshfiles/test-runs

A `bash` call that runs Vitest renders as a test-results card in the chat transcript instead of a terminal block:

- a header with the tally (`2 failed · 40 passed · 1 skipped`) and the run's duration, over a pass/fail/skip bar;
- `All`, `Failed`, `Skipped` and `Slow` filters (slow is Vitest's own `slowTestThreshold` default, 300 ms);
- one row per test file, failing files open first;
- for each failing test: the error, the `- Expected` / `+ Received` diff, the source location, the code frame with the failing line highlighted, any further stack frames, and **Ask to fix**, **Rerun** and **Copy**.

Any other command, or Vitest output the parser cannot read, keeps the native bash card.

Built with dshx (no port). The design follows the "agent test runs" block from hextaui; nothing is vendored from it.

Run `pnpm build`, `pnpm test` and `pnpm typecheck` from this package.

## How it takes over the bash card

`tool.call.toolview` is keyed per tool. This plugin registers `key: 'bash'` at priority `-10`, below the native view's default `0`, so its entry renders. When the call is not a Vitest run it reads the native entry back from the slot ledger (`ctx.slots.entries('tool.call.toolview')`, any registrant but this one, lowest priority first) and renders it with the same props, so other commands look exactly as before. `tool-meta`'s timing line still frames the card, since it wraps the dispatch rather than a view.

## What it reads

The settled result's single text block, with DSH's `[exit code: N]` footer and terminal colours stripped. `VitestReport.parse` reads Vitest's text reporters:

| Reporter                | What it prints                                                                 | What the card shows                                                                                |
| ----------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| default, in a DSH shell | every file and test, indented by describe depth but without the describe names | every test in run order; a failing test's describe path (from its `FAIL` block) prefixes its title |
| default, with `CI` set  | only files with failures, and only their failing tests                         | those files, then "N more files passed"                                                            |
| `--reporter=verbose`    | every test with its full `file > describe > title` path                        | tests grouped under their describe blocks                                                          |

The fixtures in `src/fixtures/` are real Vitest 4.1.11 runs of one small suite with an assertion failure, a timeout and a skip.

## Ask to fix and Rerun

A tool view cannot reach the composer, so the plugin also registers an invisible composer action whose only job is to hand its session's `inputActions` to the card. **Ask to fix** inserts a prompt naming the test and quoting its failure; **Rerun** inserts a prompt asking to rerun only that test. Neither sends anything. Both appear once the session's composer has mounted; **Copy** is always there.

## Limits

Both are recorded in [`plans/dsh-host-gaps.md`](../../../plans/dsh-host-gaps.md):

- No live count while Vitest runs: the Host gives a running `bash` call no output, so the running state shows the command and an indeterminate bar.
- The native "Ran commands" group caps its body at 384 px, so a long card scrolls inside the group.
