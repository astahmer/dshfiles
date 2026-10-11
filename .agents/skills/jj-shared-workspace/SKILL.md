---
name: jj-shared-workspace
description: Commit, resolve conflicts and checkpoint long runs in this repo's shared jj working copy, where 20+ agents edit other paths at the same time. Use whenever you finish a logical change, see another agent's files in `jj status`, hit a conflicted revision, or run a long multi-milestone task that a usage limit could interrupt. Also load it for every history-shape request — "unify the jj history", "one branch", "spine branch", "linear history", "single line of descendants", "too many heads", "consolidate the history" — because this store's history is shared by every agent.
---

# jj in a shared working copy

Several agents share one `@`. `jj status` shows everyone's edits; only your paths are yours.

## Commit only your paths

```sh
jj status                                    # identify your files
jj diff <your paths>                         # review
jj split -m "feat(jujutsu): restore workspaces through a machine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" plugins/@dshfiles/jujutsu
```

`jj split <paths>` moves exactly those paths into a new described revision and leaves everything else in `@`.
One described revision per logical change, Conventional-Commit title, trailer above. Never `jj describe` the shared
`@` (it would claim other agents' files), never `jj git push` without asking. `dist/` is not versioned.

## Resolve a conflicted revision without moving @

```sh
jj log -r 'conflicts()'                      # after any rebase
jj file show -r <rev>- <file>                # inspect the parent side
jj diff -r <rev> <file>                      # inspect what the revision did
jj resolve -r <rev> --tool :ours <file>      # or :theirs, after deciding
```

Do not `jj edit` / `jj new` onto the conflicted revision — that moves the shared `@` under other agents. Recover a
deleted file with `jj file show -r <change> <path>`.

## Long runs

A usage-limit stop must lose nothing:

- After each milestone: `jj split` your paths and tick the plan's checkboxes in the same revision.
- Keep `plans/<topic>/README.md` with a progress table and a **Resume here** line naming the next step
  (see `plans/optmem/README.md`).

## Whole-graph surgery in the shared store

Consolidating everything above a base revision rewrites other agents' working copies. Beyond the checkout hazards in
AGENTS.md (`@` mid-line, `--use-destination-message`):

- Name only revisions you created. Describing, squashing, amending or abandoning
  a revision that another workspace holds as its `@` races that workspace's
  snapshot and leaves a divergent copy of the same change (same change-id, second
  commit-id) — that is how this store's spine once forked into three chains.
- Rebuild with `jj duplicate -r <immutable commit-id> -o <tip>`. Rebasing a set of planned commit ids goes stale
  as soon as one step hole-fills its descendants.
- Back out only your own steps with `jj op revert <op-id>`; `jj op restore` also discards every other agent's
  operation since that point. Expect stray `reconcile divergent operations` entries — the VisualJJ branching
  server writes to this store too.
- `jj abandon '<base>:: & ~::<tip>'` prints `Deleted bookmarks:` and re-creates abandoned workspace `@`s on the
  nearest visible ancestor, which can sit below the base. Sweep `jj workspace list` so no `@` is left off the line.
- Snapshot every workspace before the first rewrite (`jj status` inside each); an edit that was never snapshotted
  is not in the store. A rewrite orphans each live `@` that was a child of the tip, so re-fold after every pass:
  `jj rebase -r <stray-head> -d <tip>`, then abandon the duplicate copy. Agents keep committing — expect repeats.
- Move an interior `@` with `jj new <tip>` **inside that workspace**. `jj rebase -r` on an interior revision
  re-applies everything above it and re-introduces conflicts you already resolved.

- Check the board before and after: `pnpm run jj:workspaces` lists every
  workspace's `@` with on-spine / ahead / off-spine, conflicts and empty slots.
  `pnpm run jj:sweep` dry-runs the stale ones through `jjw`; `--apply` forgets
  them and `--abandon-empty` also drops their orphan slot (directories stay on
  disk).

## After the line is one head

- `main` and `integration-spine` both point at the tip, and each workspace `@` is its own empty slot on the line.
- Resolve a conflicted `integration-spine` before running repo scripts
  (`jj bookmark set integration-spine -r <tip> --allow-backwards`): a conflicted bookmark is not a usable revset
  name and breaks `pnpm run jj:workspaces`.
- The cached plugin gate keys on the revision's content (`jj diff --from root() --to <rev>`), not on where `main`
  points — do not reintroduce a `main`-based cache key.

Full recipe: `jj-history-consolidation`.
