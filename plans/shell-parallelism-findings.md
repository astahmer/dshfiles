# Findings: shell command parallelism in DSH

Not a plan — nothing here is queued. This records what was measured so the same
question is not re-litigated, and what is true about the shell tooling we use.

## Why DSH serializes `bash`

`executionMode` in `dsh-tools` is fail-closed: only a tool declaring
`isConcurrencySafe(args) === true` joins a parallel group. Omission, a throwing
classifier, or any non-`true` return is exclusive. `bash` declares nothing, so
every `bash` call in a turn runs one after another. Exclusive calls also act as
barriers — they drain any in-flight pool first.

Tools that *are* concurrency-safe today: `read`, `read_image`, `web_search`,
`web_fetch`, `subagent`, `subagent_fork`. `glob`, `grep`, `write`, `edit`,
`bash`, `todo_write`, `job_*` are **not**. Verified by grepping every published
`@deepseek-ai/dsh-tool-*` package for the declaration.

## The measurement

37 real sessions, 2,573 tool calls, read from `~/.dsh/sessions/**/*.jsonl.zstd`
(record type `tool/call` and `tool/result` carry the timestamps).

| metric | value |
|---|---|
| multi-call steps | 140 of 2,379 (5.9%) |
| steps already issuing exactly one bash call | 1,941 of 2,011 (96.5%) |
| steps that issued 2+ bash calls | 70 of 2,011 (3.5%) |
| bash is already the slowest call in the step | 76 of 115 bash steps (66%) |
| max recoverable wall clock, all multi-call steps | 42.2s across 37 sessions |
| share of total tool wall clock | **0.5%** |

The ceiling is low for one reason: **the model already batches.** A turn that
wants to read eight files emits one `bash` call with `;` separators, not eight
calls. There is no concurrency left to recover.

A classifier plus a concurrent execution tool was built and measured, then
deleted. Against the same 12 reads:

| strategy | wall clock |
|---|---|
| one chained `bash` call | 1039ms |
| 12 exclusive calls (the default) | 2395ms |
| 12 concurrent calls (the built tool) | 1073ms |

**2.2x against the default, 0.97x against chaining** — no better than the single
chained call the default behaviour already produces. The win exists only against
a strategy nobody uses. Hence `AGENTS.md` teaches batching and nothing was added
to the profile.

A classifier replayed over all 2,087 historical commands approved 27.1% and
produced zero genuine false positives at ~13µs per call. That part worked; the
ceiling is what disqualified it.

## Facts about our shell tooling

- **`jj` reads write an operation.** With a dirty working copy, `jj diff` moved
  the operation count from 6 to 7. `jj status`, `jj log`, and `jj file show`
  add none after that. The read-only form is `jj --ignore-working-copy ...`.
- **Concurrent `jj diff` is safe.** 10 concurrent `jj diff` on a dirty repo
  produced 10 valid outputs and zero lock errors — jj serializes internally.
  The risk is OS-enforced read-only confinement, not concurrency.
- **`git` reads do not touch `.git/index`** here, even with a deliberately stale
  index mtime. Exception: `core.untrackedCache=true` makes `git status` rewrite it.
- **`ast-grep` has no shell grammar in the published package.** `Bash` exists
  upstream, but `@ast-grep/napi` ships only JS/TS/TSX/CSS/HTML. `tree-sitter-bash`
  WASM is the working parser if an AST classifier is ever needed (~11µs/parse).
- **shellcheck is not a purity oracle** — no side-effect check exists in its
  tree — and it is GPL-3.0, so it cannot be embedded in our tooling anyway.
- **Claude Code ships the equivalent classifier**, documented at
  <https://code.claude.com/docs/en/permissions>. Its published carve-outs
  (`find -delete` via glob expansion, `tee` targets, `docker -H`, `file -f`) are
  the best available test corpus if this ever gets revisited.
- **A plugin cannot add `isConcurrencySafe` to the built-in `bash` tool.**
  `executionMode` is not a waterfall and re-registering a name fails; a distinct
  tool name is the only extension point.

## Reproducing

The profiling scripts read the compressed session logs and need only Node and a
`zstd` binary. They are throwaway — rerun rather than trusting these numbers if
the workload has changed.