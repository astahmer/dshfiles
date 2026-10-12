# Concurrent workspace isolation in one Jujutsu store

Status: **investigated, reproduced, fixed in isolation; not yet deployed.**
jj 0.45.1, macOS, a colocated jj/git repository driven by 10–20 concurrent
coding agents.

## 1. What actually destroyed the work

Two independent jj processes rewrote the same change at the same time, and jj
kept both results as a *divergent* change. The victim's next command then merged
the divergent operations and checked out the sibling copy over the working
directory.

The full sequence, reproduced 20/20 times (`scripts/jj-isolation/isolation.test.mjs`,
"S3 control"):

```
# one shared line:  spine -> wsMid slot -> wsVictim slot   (victim holds 18 unsnapshotted files)
agent in wsVictim:  jj describe -m "victim work"        # snapshots the 18 files into its @
other agent:        jj describe -r <wsMid> -m "other"   # rewrites an ancestor; prints "Rebased 1 descendant commits."
# victim's next command:
Concurrent modification detected, resolving automatically.
Rebased 1 descendant commits onto commits rewritten by other operation.
Working copy  (@) now at: <change>/3 <other-copy> (divergent) (empty) (no description set)
Added 0 files, modified 0 files, removed 18 files
Updated working copy to fresh commit <other-copy>
The working copy has no changes.
```

Result: 19 files on disk become 1. The change id resolves at `/3` — three
divergent copies. The work is still reachable in the store (20/20 runs), so it is
recoverable, but nothing in the working directory says so.

### Why jj does this

`cli/src/cli_util.rs` in jj 0.45.1:

- `resolve_operation` merges multiple operation heads when it finds them
  (`Concurrent modification detected, resolving automatically.`), and
  `merge_operations` rebases descendants onto rewritten commits
  (`Rebased N descendant commits onto commits rewritten by other operation.`).
- `recover_stale_working_copy_impl` snapshots the working copy, then re-loads the
  merged repo, then calls `update_stale_working_copy`, which **checks out the
  merged working-copy commit**:

  ```rust
  let stats = locked_ws.locked_wc().check_out(new_commit).await?;
  ```

  Its only guard compares the stale commit's tree with the working copy's
  recorded tree — after the snapshot those agree, so it passes. jj's own comment
  on the merge admits the choice is arbitrary: *"The wc_commit_id of the merged
  repo wouldn't change because the old one wins, but it's probably fine if we
  picked the new wc_commit_id."* When it picks the copy that lacks the local
  snapshot, the snapshot's files are checked out of existence.

So the loss is **native jj behaviour under concurrent rewrites of one change**.
No agent-side discipline removes it: the race window spans the read phase, before
jj takes any lock, so a "commit early" rule only shrinks the window.

### The architectural cause: every workspace `@` was a link in one shared line

A workspace's `@` is a mutable commit. In this repository each parked workspace
kept a permanent empty slot commit folded into the single shared line, so
`main` and every other workspace's `@` sat *above* other workspaces' `@`s. That
has two consequences:

1. **A read in one workspace rewrote another workspace's revision.** Measured:
   `jj log -r @` (no `--ignore-working-copy`) in `ws1` rewrote `ws1`'s `@` and
   moved `ws2`'s `@` from `2101e4b1` to `94f50979`, with nobody touching `ws2`'s
   files. Every `jj` command snapshots its `cwd` unless told not to.
2. **Any rewrite of an interior revision rebased every live workspace above it**,
   making their working copies stale and handing them to the destructive recovery
   path above.

`jj workspace add` without `--revision` makes this worse: the new workspace's
working-copy commit is created **on top of the parent of the caller's `@`** (jj
0.45.1 `--help`), i.e. sharing a mutable parent rather than starting an
independent line.

### Aggravating writers found in our own code

Only one jj read in `@dshfiles/jj-integration/src/jj.ts` passed
`--ignore-working-copy` (`duplicate`). `resolveRevision` and `isRevisionEmpty` run
with `cwd = workspace.path` — **the coordinator snapshots the workspace it is
auditing**, from another process, at a moment the agent does not control. The
`@dshfiles/jujutsu` panel additionally runs `jj status` on a 60 s refresh and the
composer runs `jj log -r @` on a timer in the session workspace, and
`pnpm run jj:workspaces` / `jj:sweep` snapshotted whatever workspace invoked them,
dry run included.

A snapshot-only racer reconciles cleanly (measured: 15/15 runs, no divergence, no
loss), so these are not independent causes — they are second writers that make
the fatal pairing (a snapshot **and** a content-changing rewrite of one change)
much more likely.

## 2. The isolation guarantee

> If no foreign workspace head lies in `(targets)::`, the operation cannot change
> any foreign workspace's working-copy commit id, so no foreign workspace can
> become stale and no foreign checkout can fire.

That is mechanically checkable with two `--ignore-working-copy` reads:

```sh
jj --ignore-working-copy workspace list -T 'name ++ "\t" ++ target.commit_id() ++ "\n"'
jj --ignore-working-copy log -r '(a | b)::' --no-graph -T 'commit_id ++ "\n"'
```

`scripts/jj-isolation/` implements this as a `jj` shim, so one implementation
covers every writer — agents' raw `jj`, the repo scripts, and the plugins (which
resolve `jj` through `PATH`).

### The structural rule that goes with it

**A workspace's working-copy commit must be a leaf of a frozen revision, and
exactly one process may write it.**

- Base every workspace on a full commit id or a bookmark that is only ever
  advanced (`jj workspace add <path> --name <n> -r integration-spine`). Never on
  `@`, `@-`, a change id, or another workspace's `@`.
- Never fold a workspace's `@` into the shared line. A workspace `@` must have no
  descendants, must not be an ancestor of `main`, and must not be a parent of
  another workspace's `@`.
- Integration *advances a bookmark* (`jj bookmark set`), which rewrites nothing
  and touches nobody's `@`.
- One writer per workspace: a panel or coordinator must not snapshot a workspace
  another agent is editing. `--ignore-working-copy` for every read that does not
  need fresh on-disk state.

The cost is honest: the workspace `@`s are siblings, so `jj log` shows one head
per workspace instead of one line. That fan is what buys the isolation. The old
"keep the line single-headed" rule is exactly what made every workspace's
working copy rewritable by every other agent.

## 3. Migrating an already-folded line

Do this only when no agent is mid-task, and keep the old slots until each
workspace is verified. Per workspace, inside its own directory:

```sh
jj status                      # snapshot whatever is on disk; nothing is lost by this
jj new <frozen spine commit>   # move @ to an independent leaf of the frozen base
jj describe -m "chore(jj): workspace leaf for <name>"
```

Leaving the old slot commits in place is fine — they are empty and can be
reclaimed later. Do **not** `jj op restore` the store; it discards every other
agent's operations since that point. `scripts/jj-isolation/cli.mjs recover`
lists divergent changes non-destructively if the migration surfaces any.

## 4. Reproducing the bug in this clone

```sh
node --test scripts/jj-isolation      # 26 tests, real jj, multi-process
```

The suite's "S3 control" and "S9" tests assert the loss without the guard, and
"S3", "S8", "S14" assert the refusal with it.

## 5. What is still not covered

See the incident report's *Remaining risks* section. The short version: the shim
is bypassable by an absolute path to the real `jj`; `--prove-clean` in the sweep
snapshots candidates (a preserving write) through jjw; the coordinator's lock is
still scoped to `DSH_HOME` and its bookmark advance has no compare-and-swap; the
jujutsu panel's periodic `jj status` snapshot remains deliberate behaviour; and
the deployment, migration, and live browser verification have not been performed.
