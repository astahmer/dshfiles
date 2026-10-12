# jj-isolation

A boundary guard for a shared Jujutsu store that several agents drive concurrently.

It exists because of one reproducible data-loss bug, described in
[`docs/jj/concurrent-workspace-isolation.md`](../../docs/jj/concurrent-workspace-isolation.md).

## The invariant

> No command may rewrite a commit that another live workspace holds as its `@`.

That is the only way a foreign process can change a workspace's working-copy
commit id. When two processes rewrite the same change at once, jj records a
*divergent* change (one change id, several commit ids). The next command in the
owning workspace then merges the divergent operations, checks out whichever copy
won the merge, and **deletes the files that only the losing copy had
snapshotted** — reported innocently as `Updated working copy to fresh commit`.

Measured on jj 0.45.1: 20/20 runs lost all 18 unsnapshotted files. The content
stayed reachable in the store, but the working directory was emptied.

## What it refuses, rewrites, and allows

| jj command | decision |
| --- | --- |
| `describe`, `split`, `squash`, `rebase`, `abandon`, `restore` whose footprint `(targets)::` hits a foreign workspace `@` | **refuse** (`foreign-working-copy-rewrite`) |
| `workspace add` with no base, or a base that resolves to a live workspace `@` | **rewrite** to pin `--revision <frozen base commit>` (`pin-workspace-base`) |
| `bookmark set \| move` moving a canonical bookmark to a non-descendant | **refuse** (`bookmark-rewind`) |
| `workspace forget` without `JJ_ISOLATION_FORGET_PROOF=<the workspace's @ commit>` | **refuse** (`forget-needs-proof`) |
| `op restore`, `op revert`, `util gc` | **refuse** (`repo-wide-refused`) |
| every read-only command (`log`, `diff`, `status`, …) | pass through untouched; the shim bakes in the real jj path, so a read costs one shell exec (measured +11–21 ms on top of jj's own ~36 ms) |

All of the guard's own jj calls pass `--ignore-working-copy`, so the guard is
never a writer.

## Enablement is per repository and off by default

The shim does nothing unless it is both on `PATH` **and** the repository opts in:

```sh
node scripts/jj-isolation/install-shim.mjs --bindir /path/to/bin   # writes <bindir>/jj
export PATH="/path/to/bin:$PATH"
```

Then, inside the repository:

```sh
printf '%s\n' '{"version":1,"base":"integration-spine"}' > .jj/jj-isolation.json
```

`.jj/` is outside the tracked tree, so enabling the guard is a local, reversible
act: delete `.jj/jj-isolation.json` (or `export JJ_ISOLATION=off`) to disable it,
and remove `<bindir>/jj` to uninstall the shim.

`JJ_ISOLATION=on` enables it for a repository without a config file.

## Escape hatches (all explicit, all logged to stderr)

| variable | unblocks |
| --- | --- |
| `JJ_ISOLATION_ALLOW_FOREIGN_REWRITE=1` | rewriting another workspace's `@` — for an authorized consolidation |
| `JJ_ISOLATION_ALLOW_CHAINED_WORKSPACE=1` | creating a workspace stacked on a live working copy |
| `JJ_ISOLATION_ALLOW_BOOKMARK_REWIND=1` | moving a canonical bookmark backwards |
| `JJ_ISOLATION_ALLOW_REPO_WIDE=1` | `op restore`, `op revert`, `util gc` |
| `JJ_ISOLATION_FORGET_PROOF=<commit>` | forgetting one workspace whose `@` commit is `<commit>` |

## Commands

```sh
node scripts/jj-isolation/cli.mjs check <jj args…>   # print the decision as JSON, exit 3 when refused
node scripts/jj-isolation/cli.mjs recover [--json]   # list divergent changes and where their content lives
node scripts/jj-isolation/cli.mjs footprint <revset> # show what a rewrite would touch
```

`recover` never modifies anything. It prints each divergent change with its
copies and file counts so the copy holding the work can be identified, then the
documented two-step recovery is yours to run.

## Tests

```sh
node --test scripts/jj-isolation
```

26 tests, real jj repositories, real multi-process races, no mocks. They cover
the fourteen scenarios in the incident report: concurrent describes, a rewrite of
another workspace's ancestry, integration while an agent edits, concurrent
workspace creation and cleanup, workspace reuse, stale workspaces, divergence
recovery, a kill mid-mutation, sweep safety, several agents on one bookmark, a
coordinator racing an editor, and a background operation against an active
ancestry.

`isolation.test.mjs` "S3 control" deliberately runs the bug **without** the guard
and asserts the files are lost, so the refusal is proven load-bearing rather than
assumed.

## Rolling out without disrupting agents

```sh
node scripts/jj-isolation/cli.mjs preflight            # read-only: workspaces, blockers, migration order
node scripts/jj-isolation/cli.mjs maintenance arm      # fence the store (refuses while ops are recent)
node scripts/jj-isolation/cli.mjs migrate <name> --base integration-spine            # plan only
node scripts/jj-isolation/cli.mjs migrate <name> --base integration-spine --apply    # needs the fence
node scripts/jj-isolation/cli.mjs maintenance disarm --token <token>
```

`preflight` never writes: every jj call passes `--ignore-working-copy`, and dirt is
reported as a heuristic (a file newer than jj's last working-copy write) — so
"detected" is reliable and "not detected" is not proof of clean.

`maintenance arm` refuses unless no operation landed inside `--quiet-seconds`
(default 120) and no mutating jj command is in flight. While armed, the guard
refuses every mutating command from every process except the holder of the token,
and the fence records the operation id and every workspace head so a migration
aborts rather than proceeding if anything moved underneath it. It re-fences itself
after each successful migration.

`migrate` has two modes, chosen from the graph:

- `reset-to-base` — the `@` is at or below the frozen base, so its content is
  already on the spine and the workspace gets a fresh empty leaf. It never
  rewrites the old `@`, so live workspaces above it do not block it. It refuses
  when the working copy may hold unsnapshotted changes, because a snapshot would
  rewrite an ancestor of the spine.
- `leaf-from-current` — the `@` holds unlanded work, so the leaf copies its whole
  tree with `jj restore --from <head>` built in a scratch workspace and adopted by
  a single `jj edit`. Rebase-shaped operations (`jj duplicate --onto`,
  `jj rebase -r`) would re-apply only the revision's own diff and drop the content
  of the revisions in between. Live working copies above must migrate first.

Both modes verify the directory content digest is unchanged, that no foreign
working-copy revision moved, and that the new `@` has no descendants, and both
print a rollback (`jj edit <previous head>`) plus a recovery note. Because jj
records no authorship, a leaf whose change would contain paths introduced by a
workspace below is reported as a warning and requires `--accept-graft`.
