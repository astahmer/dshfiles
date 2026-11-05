# Backlog

Next: [Backlog v2](v2.md) (storage, ids, agent noise, multi-source sync) supersedes the open steps below where they
overlap; its decisions replace "No GitHub/Linear sync" and "One global store" under Decisions.

Resume here: the backlinks chip (step 6b, needs thread-sidebar), then steps 7 and 8. Steps 1–6, the FTS half of 6b,
the redesign ([redesign.md](redesign.md)) and its journeys landed in `@dshfiles/backlog`; see its README.

## Why

TODOs live in one Discord channel today. That channel works because capture costs nothing (type, send)
and old notes sink below the fold on their own. It fails at everything a tracker does: no status, no
owner, no links to threads, revisions or branches, no way to find what referenced a note, and agents
cannot read or move any of it.

The backlog keeps the Discord properties — one input, newest activity first, idle things sink — and
adds the tracker ones: typed status, agents as actors, typed links with backlinks, search, and facets
(feed, board, by project, by agent) over the same store.

## Principles

- **One input.** A capture box (and `backlog_capture` for agents) takes free text. Structure is
  derived, never required: kind, refs and project come from the text and the caller.
- **Sorting is activity, not filing.** The default view is a feed ordered by last activity. Nothing
  needs to be filed to be findable later; search and facets do that.
- **Decay, not a hard "outdated" status.** Freshness is computed from last activity and kind, so it
  never needs a sweep and any touch revives an item. See [Freshness](#freshness).
- **A capability the user has, the Agent gets.** Every verb the panel offers is an agent tool on the
  same Host method (`AGENTS.md`).
- **The human wins.** A field the user set is not moved by an automatic rule; an agent may still
  change it when asked, and every change is an event with its actor.
- **Links are data.** `jj:<rev>`, `b:<n>`, thread references, branches and URLs in the body become
  typed edges, so an item shows what it references and what references it.

## Model

| Field            | Notes                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `id`             | Monotone integer, shown as `b:<n>` (like memory's `n:<n>`).                                                   |
| `title`, `body`  | Title is the first line; body is markdown.                                                                    |
| `kind`           | `task`, `bug`, `idea`, `note`, `question`. Derived from a `bug:`/`idea:`/… prefix or `?`, defaults to `task`. |
| `status`         | `inbox` → `todo` → `doing` → `done`, or `dropped`. Capture lands in `inbox`.                                  |
| `project`        | Absolute path; from the agent caller's `cwd` or the capture box. A facet, not a partition.                    |
| `actors`         | `{ id, role }`: `user` or `agent:<sessionId>`, roles `owner`, `contributor`.                                  |
| `links`          | `{ type, target }`: `item`, `thread`, `revision`, `branch`, `workspace`, `url`.                               |
| `pinned`         | Pinned items never go dormant.                                                                                |
| `events`         | Append-only: created, edited, moved, linked, commented, with actor and time.                                  |
| `humanFields`    | Fields the user set by hand; automatic moves skip them.                                                       |
| `lastActivityAt` | Any event bumps it; drives feed order and freshness.                                                          |

Storage is a Host-owned storage-domain table (`backlog`), like prompt-stash: every browser and
agent reads the same rows. Search is a token scorer over title, tags, body, comments, capture, project
and link targets, behind a trigram full-text index (`search-index.ts`) that only narrows which items are
scored, so ranking stays the scorer's (parity tests in `search-index.test.ts`). An embedding index is not
planned.

## Freshness

Derived on read from `lastActivityAt`, `kind` and `status`; never stored, never swept.

| Kind / status                   | Fresh         | Dormant after                              |
| ------------------------------- | ------------- | ------------------------------------------ |
| `note`                          | 14 days       | 14 days                                    |
| `idea`, `question`              | 30 days       | 30 days                                    |
| `task`, `bug` in `inbox`/`todo` | 30 days       | 30 days                                    |
| `doing`                         | never dormant | flagged **stale** after 14 days            |
| `done`, `dropped`               | —             | always archived from the feed after 7 days |
| pinned                          | always fresh  | never                                      |

Dormant items leave the default feed (the Discord "below the fold") but stay in search, facets and
backlinks. Touching one (edit, comment, link, move) makes it fresh again.

## Automatic organization

1. **Deterministic triage (shipped):** kind prefix, `#project` hint, link extraction, caller session
   linked as contributor, caller `cwd` as project.
2. **Agent triage (shipped, off by default):** a cheap model reads new `inbox` items and proposes kind, status, title,
   duplicates and links through the same tools, with a confidence. Above threshold it applies; below,
   the item stays in `inbox` with the proposal attached. Jev (TypeSafe) answers the cheap yes/no
   questions first — "is this actionable?", "is this a duplicate of b:n?" — as memory already does.
3. **Lifecycle signals (shipped):** a user message mentioning `b:<n>` starts the item; a jj revision on
   `main` with `Closes b:<n>` finishes it. Each signal is an event with actor `system` and skips
   `humanFields`. Open: a settled thread with no linked revision → back to `todo` (needs thread-sidebar's
   settled state across plugins), and GitHub PR merges.

User corrections of an automatic move are kept as labelled examples for step 4's few-shot prompt.

## Steps

| #   | Step                                                                                        | State |
| --- | ------------------------------------------------------------------------------------------- | ----- |
| 1   | Host store, API, agent tools, deterministic triage, freshness                               | done  |
| 2   | Panel: capture box, feed, board, facets, item detail with links and backlinks               | done  |
| 3   | Web profile, feature catalog, e2e journey                                                   | done  |
| 4   | Agent triage: Jev + cheap model proposals in `inbox`, threshold, corrections as examples    | done  |
| 5   | Lifecycle signals from threads, jj revisions and PRs                                        | done  |
| 6   | `@b:` scope in the composer's `@` menu (mentions, MCP and skill sources learn the scope)    | done  |
| 6b  | Backlinks chip on threads and revisions; FTS index once the corpus outgrows the token match | FTS done; chip open (needs thread-sidebar) |
| 7   | Rich body editing (rich-composer) and quoting a thread message into an item                 | open  |
| 8   | One-off import of the Discord TODO channel (also a labelled set for step 4)                 | open  |

## Remaining

- [x] e2e journeys for the approved UI: `backlog-views.feature` covers the feed day separator, Inbox filters with
      read and resolve, Items grouping and collapse, Projects, search operators, saved views, `#`/`@` autocomplete,
      Retry after a refused capture, inspector pickers and links, and triage suggestion accept/dismiss. Bulk move,
      board drag and card detail were already covered (`backlog.multi-select`, `backlog.board-multi-drag`,
      `backlog.start-thread`). The Retry journey found and fixed a lost-text bug in the composer.
- [ ] Feed paging (150 entries a page) and Inbox thread rows (Acknowledge on a thread) have no journey: the first
      needs a seeded store, the second thread-sidebar's settled threads in the composition.
- [x] `@b:` mentions journey: the @ menu was empty in any composition without multi-host (its owner-missing
      rejection dropped the thread rows too); fixed in `@dshfiles/mentions`, plus journey drift. `kill EPERM` on
      teardown did not reproduce in five runs.
- [x] Board column customization, lost in a reconcile, is restored; the Attention menu row is aligned again.
- [x] An item's `secret:` link reveals inline through the Secret Catalog (`secret-link-reveal` contract).
- [ ] Live model triage: Jev is checked live (about 200 ms a call, bug/tip/task and a duplicate read correctly);
      the model path still needs a provider that accepts calls outside OpenCode.
- [ ] Load the landed plugin in the live DSH checkout (127.0.0.1:3080) at its next planned restart.
- [ ] Steps 6b, 7 and 8 below.

## Decisions taken without the user

- Standalone `@dshfiles/backlog`, not part of memory: memory holds facts, the backlog holds intent.
  A shared capture router (note → memory, intent → backlog) is a later step-4 option.
- One global store across projects.
- No GitHub/Linear sync; they appear as `url` links.

## Open questions

- Dormant thresholds above are a first guess; tune from use.
- Should step 4's proposals run on capture or in a batch (cheaper, less noisy)?
- Discord import: which channel, and is a bot token available?
