# Experiment: parallel read-only bash

Status: **built and tested, not promoted.** Measured ceiling did not justify
adding it to the `web` profile.

## Question

DSH serializes every `bash` call in one assistant turn, because `bash` declares
no `isConcurrencySafe` and the registry fails closed (`dsh-tools/lib/index.js`
`executionMode`: only an exact `true` opts in). A comparable tool parallelizes
shell batches. Should we let independent reads run together?

## What we measured first

37 real sessions, 2,573 tool calls, from `~/.dsh/sessions/**/*.jsonl.zstd`.
Timestamps on `tool/call` and `tool/result` give per-call duration directly.

| metric | value |
|---|---|
| multi-call steps | 140 of 2,379 (5.9%) |
| bash is already the slowest call | 76 of 115 bash steps (66%) |
| max recoverable wall clock | 42.2s across 37 sessions |
| share of total tool wall clock | **0.5%** |
| steps that issued 2+ bash calls | 70 of 2,011 (3.5%) |
| steps already issuing one batched `bash` call | 1,941 of 2,011 (96.5%) |

The ceiling is low because the model already batches: `ls A; echo ---; ls B` is
one tool call, not three. That is why the **batching rule in `AGENTS.md`** is
the fix that matches the data — it costs nothing and needs no classifier.

## What we built anyway

`plugins/@dshfiles/bash-parallel/` — a separate `bash_readonly` tool that takes
an array of commands and runs them concurrently.

A plugin cannot re-register `bash` (duplicate names fail) and `executionMode` is
not a waterfall, so the classifier could not be attached to the existing tool. A
distinct tool name is the only extension point available.

### Classifier

`src/classify.ts`, ~13µs per call, fail-closed. Allowlist of read-only verbs,
per-verb mutating flags, enumerated subcommand allowlists for `git` and `jj`,
and structural rejection of write redirects, `$(...)`, backticks, backgrounding,
and nested shells.

Replay over all 2,087 historical commands: 566 approved (27.1%), **0 genuine
false positives**. `2>&1`, `>/dev/null`, and quoted backticks are handled
correctly.

### Benchmark

Real subprocesses, 12 reads of comparable cost, three strategies:

| strategy | wall clock |
|---|---|
| one chained `bash` call | 1089ms |
| 12 exclusive calls (today's default) | 1406ms |
| 12 concurrent calls (`bash_readonly`) | 591ms |

2.4x against the default, 1.8x against chaining — on a workload that represents
0.5% of actual tool time.

## Why it was not promoted

The tool is sound and tested; the win is real but tiny. Adding a tool to every
session's catalog to recover ~0.5% of tool time is not a trade worth making,
especially when the same waste is better addressed by the batching rule.

It stays available as a reference implementation. If the ceiling ever changes —
more multi-call steps, slower reads, a much wider read-only share — the numbers
to re-measure are in the table above.

Two caveats, stated plainly:

- The classifier is a **conservative static verdict, not a purity proof**.
  Commands run under the session's existing sandbox mode, not a per-call
  read-only confinement, so a false positive would write rather than be denied.
- It was **never executed through the harness**. The workspace pnpm store is
  missing (`node_modules/.pnpm` absent, so every plugin's `node_modules` symlinks
  dangle) and `dshx build` / `tsc` cannot run on this plugin or its siblings.
  Unit tests and the benchmark run standalone; the tool has never booted in DSH.

## Facts established along the way

- **`jj` reads write an operation.** With a dirty working copy, `jj diff` took
  the op count from 6 to 7. `jj status`, `jj log`, and `jj file show` do not
  write further operations after that. The read-only form is
  `jj --ignore-working-copy ...`, so the classifier rejects bare `jj`.
- **Concurrent `jj diff` is safe in practice.** 10 concurrent `jj diff` on a
  dirty repo produced 10 valid outputs with zero lock errors — jj serializes
  internally. Unsafe under OS-enforced read-only confinement, not under
  concurrency alone.
- **`git` reads do not touch `.git/index`** on this machine, even with a stale
  index mtime. The exception is `core.untrackedCache=true`.
- **ast-grep does not ship a shell grammar** in the published `@ast-grep/napi`
  package; `Lang` contains only JS/TS/TSX/CSS/HTML. `tree-sitter-bash` WASM is
  the working parser (10.8µs/parse) if an AST classifier is ever needed.
- **shellcheck has no purity check** and is GPL-3.0, so it is not usable as a
  read-only oracle.
- Claude Code ships an equivalent AST classifier documented at
  <https://code.claude.com/docs/en/permissions>; its published carve-outs are
  the best available test corpus if we revisit this.