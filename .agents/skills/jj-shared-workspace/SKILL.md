---
name: jj-shared-workspace
description: Commit, resolve conflicts and checkpoint long runs in this repo's shared jj working copy, where other agents edit other paths at the same time. Use whenever you finish a logical change, see another agent's files in `jj status`, hit a conflicted revision, or run a long multi-milestone task that a usage limit could interrupt.
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
