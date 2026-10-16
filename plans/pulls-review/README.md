# Plan: pulls.review-style review of thread workspace diffs

Status: in progress. Owner thread: `thread-c3740a`.

## What we want

Review the current **thread workspace's own changes** (the jj working-copy
revision against a base bookmark) the way [pulls.review](https://pulls.review)
does: changed files grouped into review scopes, one scope at a time, with
review progress. All of it inside DSH, as an owned plugin.

The product question was *integrate the real pulls.review, or replicate its
review surface*. The answer, after measuring both, is **replicate the review
surface in DSH and reuse pulls.review's own core for the hard part**:

- `@pulls.review/core` (MIT, `packages/core`) exports the patch parser
  (`createPasteSource` → `parsePatch`) and the deterministic rule-based
  grouper (`createRuleBasedAdapter`), with no model call and no GitHub token.
  Probed against a 366k-line jj patch: 1789 files parsed and grouped into
  `docs / code / tests / config / deps / generated / other` with per-file
  hunks. So the grouping is real pulls.review behaviour, not a lookalike.
- pulls.review's *UI* is Vue and cannot be reused in DSH's React client, and
  its site is a GitHub-PR product that cannot read a jj thread workspace.

## Why not embed the real app

Measured on the shipping CLI (`npx pulls.review@0.3.3`) in a thread workspace:

1. A thread workspace has **no `.git`** (`.jj/repo` + `working_copy` only), so
   the CLI's git-backed targets cannot resolve anything. It works only when
   `GIT_DIR` is pointed at the colocated main checkout's `.git` and the target
   is an explicit revision range (`main...<commit>`), never `/worktree`.
2. The dev server gates the browser behind a devframe one-time code. The code
   is printed on the *first untrusted connection*, and consuming it from the
   URL fragment is racy: pairing succeeded once and then failed on four
   consecutive attempts in the same flow, with no rotation of the printed code.
3. Deep links to a ref route (`/compare/A...B`) serve an index whose `./assets`
   resolve under the ref path, so the entry bundle 404s
   (`/compare/assets/index-*.js`). The CLI's own printed URL hits this.

So an embedded iframe would depend on another project's dev-server internals,
pairing races and a broken deep-link path. That is not a plugin we can keep
green. The link-out route stays as an optional action for GitHub PRs, where the
product is designed to work.

## Shape

One plugin, `plugins/@dshfiles/pulls-review`:

- **Host** (`src/host.ts`, `src/api.ts`): typed API. Resolve a workspace path,
  read the thread diff with `jj diff --git -r '<base>..@'`, parse and group it
  with `@pulls.review/core`, return scopes + per-file stats + hunks, bounded.
- **Client** (`src/client.tsx`): a session-scoped panel. Scope list with counts
  and progress, the selected scope's files, one file's patch at a time
  (`PatchView` from `@dshfiles/plugin-ui/diff`), reviewed marks persisted
  locally, keyboard navigation, refresh.
- **Commands**: `/pulls` opens the panel/reviews the current thread; a palette
  action does the same from anywhere. An "Open in pulls.review" action resolves
  the branch's GitHub PR (`gh pr view`) and opens `pulls.review/gh/...`.

## Phases

| # | Phase | State |
| - | ----- | ----- |
| 1 | Research: pulls.review surfaces, core reuse, integration blockers | done |
| 2 | Scaffold `@dshfiles/pulls-review` (dshx ui template, contract scripts) | done |
| 3 | Host API: workspace resolution, jj range, core parse + grouping, tests | done |
| 4 | Client panel: scopes, per-scope files, patch, reviewed progress, tests | done |
| 5 | Verify in a scratch DSH (reach + screenshot), then report stages | done |
| 6 | Gherkin journey green with `pnpm check:e2e @dshfiles/pulls-review` | done |
| 7 | Optional: an "Open in pulls.review" action for a GitHub PR branch | backlog |

Resume here: phase 7, or close the plan: the shipped behavior is documented in
[the plugin README](../../plugins/@dshfiles/pulls-review/README.md).

Verified by hand in a scratch instance (`dshx dev`, name `pulls-review`,
bundles `pulls-review + jj-integration + thread-sidebar + home +
workspace-folder-picker`): `doctor` green (all 6 bundles loaded, no host-log
errors) and the catalog reach passed — the panel showed `main..@`,
`1 file +1 −0 0/1 reviewed`, the `Docs` scope with `seeded-work.md`, the
rendered diff, and `1/1 reviewed` after marking the file. The only console noise
was the known multi-host 404 (`/api/dshx-…/list`) from not loading
`@dshfiles/multi-host`. The Gherkin journey
(`@scenario:pulls-review.thread-scopes`) passes, as do the plugin boot check,
`pnpm check:diff` and `pnpm knip` for this package.

The panel owns DSH's main slot, which unmounts the Session it reviews, so the
on-screen thread is remembered from plugin setup (`src/session-focus.ts`); a
component-level read of `sidebarRight.mounted` sees only `undefined` there.

`pnpm knip` at the repository root still fails on the rich-composer baseline
(unused file, three devDependencies, unlisted `jsdom`); this plugin adds none.

## Open questions

- Whether scope summaries get an AI pass (DSH model) later; v1 is the
  deterministic rule-based text, per `RuleText`.
- Phase 7: a thread's branch is usually detached in jj, so resolving a GitHub PR
  needs `gh` against a git dir the workspace does not have. Left out of v1.
