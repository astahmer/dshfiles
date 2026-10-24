# Plan: GitHub-like changes review

Status: in progress. Owner thread: this one (b:34).

Owner plugin: `plugins/@dshfiles/pulls-review`.

## Why

Clicking a row of the native changed-files card ("Preview in sidebar") opens the
native `changes-review` tab: one file at a time behind a file selector, capped at
5,000 rendered lines, no searchable file list, no stacked review, no comments.
The request is a GitHub pull-request experience inside DSH:

- every file of the change set in one scroll, diffs loaded lazily as you reach
  them,
- a file rail with search, jump and viewed progress,
- per-file viewed marks (`@dshfiles/diff-viewed` owns those today), auto-marked
  when scrolled past, default on and configurable,
- collapse/expand per file, sticky headers, jump to next unviewed,
- unified/split and wrap choices kept per review,
- pulls.review scope grouping and AI scope summaries,
- inline comment threads anchored to file lines, shared between browser, Agent
  and every other viewer,
- two sources: the turn's recorded snapshot (what the card lists) and the
  thread's live jj workspace diff (`base..@`).

## Reuse verdict

`@dshfiles/pulls-review` already owns the hard parts of the second half: the jj
range read, `@pulls.review/core` patch parsing and deterministic scope grouping,
AI scope summaries through the thread's own model route, the `/pulls` command and
the `pulls_review` agent tool. Extending it keeps one review story instead of a
second bundle that restates the same contracts.

The native side contributes: the `workspace/changes` summary route
(`/api/changes.summary`) and its per-file comparison route
(`/api/changes.diff`), the `dsh-resource://changes-review/session/<id>/<seq>/<turn>`
tab address, and the changed-files card that opens it.

`@dshfiles/diff-viewed` stays the durable owner of turn-scope viewed marks
(Host storage `diff_viewed`), so the native tab (kept reachable) and the new
surface always agree.

## Surfaces

1. **Sidebar review tab** — written under the same `changes-review` kind, taken
   over through the sidebar-right tab registry's `extension` band (a supported
   API: an extension may shadow a `builtin` kind and the builtin resumes when it
   unregisters). Every row of the changed-files card and every prose file link
   then opens the new surface on that file.
2. **Main-area page** — the same surface through the existing `main` panel
   registration; the sidebar header's Expand action opens it on the same review
   and file.
3. **Classic native tab stays reachable** — plugin setting `classicReviewTab`
   (default off). Off means our takeover; on means the native one-file tab, so
   the old behavior is one setting away. Sidebar-only; no Host change.

## Shape

```
+--------------------------------------------------------------------------+
| Review · This turn | Workspace       12 files  +340 −82   4/12 viewed    |
| [rail toggle] [search]      [unified|split] [wrap] [hide viewed] [ ⋯ ]   |
+----------------------+---------------------------------------------------+
| Files (12)           | src/host.ts                            +38 −6  [x] |
| search…              | @@ -10,7 +10,9 @@                                |
| Code (9)             |  10   ...                                         |
|  src/host.ts    4/…  |  11 + …                            [+ comment]     |
|  src/api.ts     1/…  |     ┌ thread: "why here?"  reply… resolve ┐        |
| Docs (3)             |  12   ...                                         |
| …                    | src/api.ts                             +2 −1   [x] |
|                      | (lazy: nothing fetched/rendered until near view)  |
+----------------------+---------------------------------------------------+
```

- Container queries, not viewport breakpoints: the rail is persistent at
  `@container` ≥ 42rem, a toggleable sheet below it.
- One scroll container for the whole review. A file section mounts its
  comparison only within a scroll margin; below it a measured placeholder keeps
  scroll position stable. Around the viewport, an IntersectionObserver reports
  "header scrolled above the viewport" for auto-mark.
- The diff renderer is our own (unified + split, numbered lines, sticky hunk
  headers, wrap, Shiki spans through the Host `useCodeHighlighter`), because
  inline comments and per-line affordances need per-line React nodes. It reads
  the same hunks the native tab reads.
- Comments render as annotation rows under their line and never shift the line
  numbering.

## Sources

| Source    | Files + stats                          | Comparison                       | Marks                       |
| --------- | -------------------------------------- | -------------------------------- | --------------------------- |
| `turn`    | `/api/changes.summary?sessionId&seq`   | `/api/changes.diff` per file     | `diff-viewed` Host API      |
| `workspace` | `pullsReviewApi.review` (jj, scopes) | whole patch, parsed per file     | review-local Host API (new) |

A turn review is immutable (Session + announcing seq + turn). A workspace review
is keyed by workspace path, base bookmark and head revision, so a new revision
starts a fresh review; comments on a workspace review carry the same identity
and state that they belong to that revision.

## Data model

`diff-viewed` gains one idempotent method (auto-mark needs set, not flip) and
becomes an importable dshx module:

```ts
diffViewedApi.mark({ sessionId, seq, path, viewed }) // → snapshot
```

`pulls-review` gains Host storage `changes_review` (storageDomain):

```ts
CommentThread {
  id: string
  source: { kind: 'turn'; sessionId; seq } | { kind: 'workspace'; path; base; head }
  filePath: string
  anchor: { side: 'old' | 'new'; line: number }
  author: { kind: 'user' } | { kind: 'agent'; sessionId?: string; handle?: string }
  body: string
  createdAt: number
  resolvedAt?: number
  replies: { id; author; body; createdAt }[]
}
```

API (one dshx registry, agent tools bound to the same methods):
`list`, `create`, `reply`, `setResolved`, `delete`. Reads are read-only tools;
writes are tools whose description says they may run only when the user asked,
and `delete` takes an explicit `confirm` field.

Local review preferences (surface only, `createStoredValue`): rail open, hide
viewed, collapsed files, last source, layout/wrap defaults. Marks are never
local-only on a current Host.

## Phases

| #   | Phase                                                                 | State |
| --- | --------------------------------------------------------------------- | ----- |
| 1   | Research: native tab contract, pulls-review reuse, diff-viewed marks    | done  |
| 2   | `diff-viewed`: idempotent `mark`, `./api` dshx module, tests             | todo  |
| 3   | Review model: sources, file list, scoped grouping, progress, settings  | todo  |
| 4   | Diff renderer: stacked, lazy, unified/split, wrap, sticky headers      | todo  |
| 5   | File rail: search, jump, scope groups, viewed progress, hide viewed    | todo  |
| 6   | Viewed: per-file toggle, auto-mark on scroll (default on), mark all    | todo  |
| 7   | Tab takeover + main page + expand + classic-tab setting                | todo  |
| 8   | Comments: Host storage/API/agent tools, inline threads, resolve        | todo  |
| 9   | Scope grouping + AI summaries inside the new surface                   | todo  |
| 10  | Tests, catalog/telemetry, screenshot, scratch-DSH verification          | todo  |

## Acceptance criteria

- A changed-files card row opens the new review with every file listed, that
  file scrolled to, and no comparison fetched for files never approached.
- A 500-file turn review scrolls smoothly; the rail search narrows and jumps.
- Viewed marks match `@dshfiles/diff-viewed`'s records; scrolling past a file
  marks it only when auto-mark is enabled; "mark all"/clear work.
- The Workspace source shows the same scopes as `/pulls` and the AI summaries
  replace the deterministic ones once requested.
- Inline comments survive a reload, are visible to the agent through its tools,
  and resolve without losing the thread.
- Setting `classicReviewTab` on restores the native one-file tab; off restores
  the takeover.
- `pnpm --dir plugins/@dshfiles/pulls-review typecheck test build`, the
  `diff-viewed` equivalents, `check:features`, and a scratch-DSH reach + shot
  pass.

## Risks / accepted degradations

- A future DSH release may change the `changes-review` address or summary route;
  the takeover then stops matching and the native tab resumes (visible fallback,
  not a crash). A boot journey guards it.
- An older Host without the comments API hides the comment affordances instead
  of failing; an older Host without `diff-viewed.mark` disables auto-mark only.
- Comments on a workspace review belong to the revision that was reviewed.
