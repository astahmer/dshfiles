# Workspace cleanup audit — dry run, nothing deleted

Repo: `/Users/astahmer/dev/dshfiles` · spine `d5145d1d` · **43 registered jj
workspaces**. Classified from jj metadata (`<name>@`, ancestry against
`integration-spine`, `~empty()`), never from directory name or age.

## Method, and a bug worth recording

The first classifier was wrong and would have been dangerous. `jj workspace list`
prints `name: path …`, so splitting on whitespace left a trailing colon; the
revset `name:@` then failed to parse, every query silently returned nothing, and
**every workspace was classified "safe to remove" — including this session's own
`release-candidate`, `lkg`, `ade-ux` and `core-narrow`.** The corrected parser
strips the colon, and each query is now checked for failure rather than
defaulting to zero.

That is the concrete reason this audit uses jj metadata and a dry run.

## ACTIVE / PROTECTED — never remove

| Workspace                                    | Why                                                |
| -------------------------------------------- | -------------------------------------------------- |
| `default`                                    | the canonical checkout itself; the repository root |
| `chrome-profile-debug`                       | cwd of the live `:3080` Host                       |
| `release-candidate`                          | cwd of this session                                |
| any workspace with a live process or session | see the pre-deletion gate below                    |

## UNINTEGRATED — real unique work, preserve

| Workspace              | non-empty commits off the spine |
| ---------------------- | ------------------------------- |
| `optmem-reliability`   | 4                               |
| `pnpm-root`            | 4                               |
| `agent-comm-audit`     | 3                               |
| `chrome-profile-debug` | 3                               |
| `history-repair`       | 3                               |

## UNCERTAIN — divergent `@`, needs a human look

| Workspace                                | Note                   |
| ---------------------------------------- | ---------------------- |
| `thread-archive-toast-final`             | divergent working copy |
| `workspace-folder-picker-browser-latest` | divergent working copy |

## SAFE TO REMOVE — empty, off-spine, nothing unique

Dev workspaces whose work is already in the spine: `ade-thread-provision`,
`ade-ux`, `consolidation`, `core-narrow`, `dep-hygiene`,
`integration-spine-20261012`, `lkg`, `release-candidate`, `store-editor-fix`,
`workspace-cleanup`.

**Thread workspaces: 25**, every one empty and off-spine, **≈704 MB** logical.
These are the disposable per-thread workspaces and the main reclaimable set.

## THE PRE-DELETION GATE — not yet satisfied

Two checks must pass before any removal, and neither has been run:

1. **No live session or process references the directory.** Session persistence
   directories encode a session's cwd; a workspace whose path appears there is
   still referenced, and its thread history must survive the filesystem cleanup.
2. **No writer lease or observer** in the jj-integration registry.

Until both are asserted per candidate, the thread list is a **candidate list, not
an approval list**.

## Orphan from the failed thread creation

`~/dev/dshfiles-threads/dshfiles-7d55906b` — provisioned before the attach
failure, **no DSH workspace record, no attached session**, empty and off-spine.
Safe to reconcile: `jj workspace forget` plus directory removal, or let the
automatic lifecycle take it. **Not touched.**

## Estimated reclaim

| Set                  | Logical                               |
| -------------------- | ------------------------------------- |
| 25 thread workspaces | ≈704 MB                               |
| Safe dev workspaces  | not measured; each is a full checkout |

Logical size overstates the real gain: the store is shared, so the reclaim is the
working-copy files, not the history.

## Automatic post-integration cleanup — readiness

The machinery already exists in `@dshfiles/jj-integration`:
`decideCleanup` (a pure rule table), `cleanupReport`, `cleanupWorkspaces`,
`isDisposableWorkspacePath`, and the retirement states. It is **deployed with
`dryRun: true`**, which is why nothing has been reclaimed automatically.

Not yet proven, and therefore not ready to enable:

- the sweep has never run against real workspaces;
- the "no session depends on this cwd" check is the missing gate above;
- `workspace.cleaned` has not been observed retiring a real workspace.

**Readiness: the logic is written and unit/real-jj tested; enabling unattended
deletion is not authorised until the two gates above are asserted on real data.**

## What I did not do

No `jj workspace forget`, no directory removal, no registry edit. The audit is
read-only.
