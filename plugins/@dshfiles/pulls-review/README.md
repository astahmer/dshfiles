# pulls.review

Review this thread's changes the way [pulls.review](https://pulls.review) does:
changed files grouped into scopes, one scope at a time, with review progress —
inside DSH, for the thread's own jj workspace.

## What it does

A thread works in its own jj workspace, so its changes are `jj diff --from
<base> --to @`. The Host reads that patch and groups it with
[`@pulls.review/core`](https://github.com/antfu/pulls.review)'s deterministic
rule-based adapter (MIT): no model call, no GitHub token, and the same rules the
site uses, so a scope reads `Code` / `Tests` / `Docs` / `Config` /
`Dependencies` / `Generated` / `Other` here exactly as it does there.

The panel shows the range and totals, a scope chip per group with its reviewed
count, the selected scope's files with per-file `+/-` stats, and that scope's
diff. Marking a file reviewed persists locally, keyed by workspace and
working-copy revision, so a new revision starts fresh.

## Why the rules rather than the site

The site is a GitHub-PR product, and the `pulls.review` CLI needs a git
checkout. A DSH thread workspace is a jj workspace with no `.git`, and the
CLI's dev server gates its browser behind a one-time pairing code, so embedding
it would depend on another project's dev-server internals. Reusing the core
package gets the real grouping without that coupling. See
[the plan](../../../plans/pulls-review/README.md) for the measured evidence.

## Host API

`pullsReviewApi.review({ path, base? })` returns one of:

- `{ status: 'ok', path, base, head, range, patch, truncated, files, additions, deletions, scopes }`
  — the patch is capped at 1.2 M characters and `truncated` says whether the cap
  cut it; `base` defaults to the first of `main`, `master`, `trunk` that resolves.
- `{ status: 'failed', path, reason, message }` with `reason` one of
  `workspace-missing`, `not-a-repository`, `no-base`, `jj-missing`, `jj-failed`.

`jj` runs with explicit argv, a bounded output, a timeout and the caller's
signal; its stderr is read only to classify a failure and never leaves the Host.
