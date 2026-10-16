# Plan: pulls.review-style review of thread workspace diffs

Status: in progress. Owner thread: `thread-c3740a`.

## What we want

Review the current **thread workspace's own changes** (the jj working-copy
revision against a base bookmark) the way [pulls.review](https://pulls.review)
does: changed files grouped into review scopes, one scope at a time, with
review progress. All of it inside DSH, as an owned plugin.

The product question was _integrate the real pulls.review, or replicate its
review surface_. The answer, after measuring both, is **replicate the review
surface in DSH and reuse pulls.review's own core for the hard part**:

- `@pulls.review/core` (MIT, `packages/core`) exports the patch parser
  (`createPasteSource` → `parsePatch`) and the deterministic rule-based
  grouper (`createRuleBasedAdapter`), with no model call and no GitHub token.
  Probed against a 366k-line jj patch: 1789 files parsed and grouped into
  `docs / code / tests / config / deps / generated / other` with per-file
  hunks. So the grouping is real pulls.review behaviour, not a lookalike.
- pulls.review's _UI_ is Vue and cannot be reused in DSH's React client, and
  its site is a GitHub-PR product that cannot read a jj thread workspace.

## Why not embed the real app

Measured on the shipping CLI (`npx pulls.review@0.3.3`) in a thread workspace:

1. A thread workspace has **no `.git`** (`.jj/repo` + `working_copy` only), so
   the CLI's git-backed targets cannot resolve anything. It works only when
   `GIT_DIR` is pointed at the colocated main checkout's `.git` and the target
   is an explicit revision range (`main...<commit>`), never `/worktree`.
2. The dev server gates the browser behind a devframe one-time code. The code
   is printed on the _first untrusted connection_, and consuming it from the
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

| #   | Phase                                                                  | State          |
| --- | ---------------------------------------------------------------------- | -------------- |
| 1   | Research: pulls.review surfaces, core reuse, integration blockers      | done           |
| 2   | Scaffold `@dshfiles/pulls-review` (dshx ui template, contract scripts) | done           |
| 3   | Host API: workspace resolution, jj range, core parse + grouping, tests | done           |
| 4   | Client panel: scopes, per-scope files, patch, reviewed progress, tests | done           |
| 5   | Verify in a scratch DSH (reach + screenshot), then report stages       | done           |
| 6   | Gherkin journey green with `pnpm check:e2e @dshfiles/pulls-review`     | done           |
| 7   | AI scope summaries through the thread's own model route                | done           |
| 8   | `/pulls` command and the `pulls_review` agent tool                     | done           |
| 9   | Upstream `dsh` local-agent adapter in `antfu/pulls.review`             | done, unpushed |
| 10  | Independent review, then fix what it found                             | done           |
| 11  | Optional: an "Open in pulls.review" action for a GitHub PR branch      | backlog        |

### The review round (phase 10)

A subagent reviewed both revisions and the upstream patch read-only. What it
found and what happened:

- **Fixed, plugin.** `summarize` now passes the thread's `sessionId` to the llm
  call (providers keyed per session, e.g. OpenCode Go, reject a call without it);
  file lists are clipped to `MAX_FILES` with `truncated` set, so a >4000-file
  diff no longer fails RPC output validation; the per-scope answer is the
  `key: sentence` line protocol instead of JSON (this also removed the plugin's
  only `no-direct-json-parse` finding and the first-brace/last-brace fragility);
  a review failure and an empty diff have their own reasons instead of
  `llm-failed`/`unparsed`; reviewed marks are keyed by workspace + base +
  revision and the record keeps the 20 most recently touched scopes; the
  `pulls_review` tool marks `path` required; the real-jj test now drives
  `reviewWorkspace` through the exported argv instead of duplicating it, and a
  boundary test covers the file cap.
- **Fixed, upstream.** Session loss matches what the launcher prints
  (`session "…" does not exist`), which the old regexes never matched; a failed
  run yields an error final instead of a malformed answer, since the runner
  prints its text before exiting non-zero; the profile can be pointed elsewhere
  with `PULLS_REVIEW_DSH_PROFILE` and the doc table plus a Trust-and-limits
  bullet state that DSH has no per-run tool restriction, that the shipped
  `headless` template mounts write/shell/web tools, and that each analysis
  persists a session in the user's `DSH_HOME`.
- **Accepted, not changed.** The reviewed-mark store still ignores a refused
  `localStorage` write (the marks simply do not persist); `pnpm-lock.yaml` churn
  comes from `@pulls.review/core`; `pnpm lint`'s ast-grep ratchet is already red
  on the base revision (`no-direct-json-parse: 186/185`) and this plugin now
  contributes none of it; the read-only profile remains the user's to author,
  because a `--patch` overlay can only _set_ entry fields and silently skips a
  row id it does not find, which would fake enforcement.
- **Still open.** A component-level test for the panel's file-name join on
  space/unicode/binary paths (the reviewer verified both parsers agree on real jj
  output, but no automated test pins it).

Resume here: phase 11, or close the plan: the shipped behavior is documented in
[the plugin README](../../plugins/@dshfiles/pulls-review/README.md).

Verified by hand in a scratch instance (`dshx dev`, name `pulls-review`,
bundles `pulls-review + jj-integration + thread-sidebar + home +
workspace-folder-picker`): `doctor` green (all 6 bundles loaded, no host-log
errors) and both catalog reaches passed — the `/pulls` command printed
`pulls.review · main..@`, the panel showed `1 file +1 −0 1/1 reviewed`, the
`Docs` scope with `seeded-work.md`, the rendered diff after marking the file, and
**Summarize** reported the no-model failure in place of inventing summaries. The
only console noise was the known multi-host 404 (`/api/dshx-…/list`) from not
loading `@dshfiles/multi-host`. The Gherkin journey
(`@scenario:pulls-review.thread-scopes`, which now runs `/pulls` too) passes, as
do the plugin boot check and `pnpm check:diff`.

The panel owns DSH's main slot, which unmounts the Session it reviews, so the
on-screen thread is remembered from plugin setup (`src/session-focus.ts`); a
component-level read of `sidebarRight.mounted` sees only `undefined` there.

`pnpm knip` at the repository root still fails on the rich-composer baseline
(unused file, three devDependencies, unlisted `jsdom`); this plugin adds none.

### Phase 7: where the summary route comes from

The thread's own provider is read from its session log (`request/header`), and
the model is the first id that provider offers; an explicit provider/model from
a caller wins. This is deliberately not OptMem's configured cheap-model policy —
that would couple a review plugin to another plugin's settings. The scratch
profile has no account, so the browser path can only show the failure; the route,
parse and failure paths are unit-tested and the UI path has a `not-applicable`
entry in `dshx.features.json`.

### Phase 9: the upstream adapter

`packages/cli/src/agents/dsh.ts` in [antfu/pulls.review](https://github.com/antfu/pulls.review)
adds DSH to its "Local agent" provider: the task goes in on stdin, the
`--json` projection is mapped (`session` → resumable id, `text` and
`tool_call`/`tool_result` → transcript and reading progress, `final` → answer),
and `--session-id` resumes chat. The profile owns the model and the tools, so a
per-run model is refused rather than ignored and the doc table says to point the
analysis profile at a read-only tool set. It is committed on a local branch, not
pushed: the upstream PR is the human's call.

## Open questions

- Phase 10: a thread's branch is usually detached in jj, so resolving a GitHub PR
  needs `gh` against a git dir the workspace does not have. Left out of v1.
- Whether scope summaries should also be reachable from a right-sidebar panel
  instead of DSH's main slot.
