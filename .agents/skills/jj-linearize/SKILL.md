---
name: jj-linearize
description: Collapse the many JJ workspace heads above a base revision into one linear line without losing work. Use for "linearize everything since main@origin", "unify the history", "one branch", "single line", "get rid of duplicates/empties", "rebase stuff oldest to newest on top of each other", or when the revision graph exploded into dozens of heads after parallel thread work.
---

# Linearize jj thread work into one line

Turn every off-bookmark lane (a thread/workspace stack) into one chain that ends
at the target bookmark: `base..bookmark` = **1 head, 0 merges, 0 conflicts,
0 divergence**, with nothing abandoned that holds work. Judgment only enters at
"is this lane already upstream?" and "how do I merge this conflict?" — everything
else is scripted and reproducible.

Run every command from the repository, never with `-R` on a workspace you do not own.
`scripts/linearize.mjs` does the bookkeeping; state lives in `$TMPDIR/jj-linearize/<repo>`
(override with `--state`), never in the repository.

## 0. Snapshot first (always)

```sh
node .agents/skills/jj-linearize/scripts/linearize.mjs snapshot
```

Prints the op id to restore to (`jj op restore <op>`) and the current shape. Record
it in the report; it is the single undo for the whole run. `jj undo` only steps back
one operation.

## 1. Inventory the lanes

```sh
node …/linearize.mjs inventory          # lanes, oldest first, with owners + verdicts
node …/linearize.mjs plan               # ordered lane list + the exact rebase per lane
```

A **lane** is a connected component of `base.. ~ ::bookmark`: revisions that are not
ancestors of the bookmark, grouped through their off-bookmark parents. The script
orders lanes by the oldest author timestamp (stable, rewrite-proof), lists the owning
workspaces, and flags each lane:

- `SUPERSEDED` — every contentful revision's description already exists on the bookmark line.
- `N dup` — N revisions whose patch (`jj diff --git` sha256) is byte-identical to a
  commit already on the bookmark line.
- `unique` — carries content the bookmark does not have.

Also read the product evidence you have (thread inventory, session status, a prior
audit): lane size, whether an owner is finished, whether a lane rewrites newer
bookmark code. That is the part a script cannot decide.

## 2. Classify each lane (the only real decisions)

| signal | action |
|---|---|
| lane is empty `wip` working copies | integrate (cheap, nothing to merge) |
| `SUPERSEDED` / all revisions duplicate | integrate, then empty the commits (step 4a) |
| unique and merges cleanly | integrate |
| unique, small conflicts | integrate, resolve by hand (step 4) |
| huge chain whose *own* conflicts span nearly every commit, or a lane that rewrites newer bookmark features | **do not integrate**: `skip` it and `preserve` its revisions (step 5) |

Measure "own vs inherited" conflicts before deciding on a big lane: conflicts are
inherited when the conflicted paths are not in the revision's own `jj diff --summary`
(they come from an ancestor), so resolving the *origin* oldest-first clears the
descendants. A 146-of-148 own-conflict lane is a red flag, not a merge you should
attempt commit by commit.

## 3. Chain the lanes, oldest first

```sh
node …/linearize.mjs rebase 0            # rebase lane 0 onto the tip, update tip.txt
node …/linearize.mjs rebase 1 --auto-empty
```

- `rebase <n>` rebases `lane n` onto the running tip with `jj rebase -r '<ids|…>' -o <tip>`.
  In-set parent order is preserved, so a lane becomes a chain, not a fan.
- Conflict detection is **delta-based**: only conflicts introduced in the lane's own
  revset count; pre-existing conflicts elsewhere are ignored.
- Exit code 3 = unresolved conflicts, listing the change ids. Fix them (step 4), then
  re-run `rebase n` (it skips what is already in place) or continue with `rebase n+1`.
- `--auto-empty` empties commits whose description already exists on the bookmark line.

Never use `jj rebase … --skip-emptied` when the human asked to keep every revision: it
abandons commits. Emptying keeps the revision (and its bookmark/workspace references).

## 4. Resolve conflicts

```sh
node …/linearize.mjs take-main <change>…   # destination side of every conflict in that commit
node …/linearize.mjs empty <change>…       # make the commit content-free
```

| situation | resolution |
|---|---|
| revision's patch is byte-identical to a commit already upstream | `empty` — the content is upstream |
| revision is an older implementation of work the bookmark already has in newer form | `empty` (record why; originals stay recoverable via the op log) |
| overlapping edits where the bookmark side is newer | `take-main` — policy: keep both intents, prefer the bookmark's newer code, never drop bookmark-side changes |
| generated files (`pnpm-lock.yaml`, snapshots) | take either side, then regenerate from the merged sources (`pnpm install --lockfile-only`, then `pnpm install --frozen-lockfile`) |
| docs index tables: both sides added a row | **union**, not a pick. Materialize it: `jj workspace add <tmp> -r <conflicted>`, edit the markers, `jj squash --use-destination-message`, then `jj workspace forget <tmp>` and delete the dir |
| `N-sided conflict including 1 deletion` | read both sides; usually "the revision re-adds a file the bookmark deleted" → `take-main` |

Resolve **oldest first**: rewriting a conflicted commit rebases its descendants and
usually clears their inherited conflicts. Re-check `jj log -r 'conflicts()'` after each.

## 5. Keep a lane you are not integrating

```sh
node …/linearize.mjs skip 27 --reason "rewrites newer thread-sidebar code"
node …/linearize.mjs preserve 27 kept/thread-sidebar-settings-surfaces
```

`preserve` runs `jj duplicate` on the lane and bookmarks the copy. Why not bookmark the
original: a rewritten-away revision and its rewrite share a change id, and a bookmark on
the original makes the change **divergent**. Duplicates get fresh change ids, so the
content stays visible and reachable without poisoning the graph. Leave the original lane
untouched (never rebase a lane you are keeping) and report its revset, its owner and the
concrete reason.

## 6. Finish the shape

```sh
# put the default workspace on the tip (never `jj rebase @` if @ is inside the new line)
jj new <bookmark>                       # in the default workspace
jj bookmark set main -r <final-tip>     # only when the human wants the bookmark moved
node …/linearize.mjs prune              # dry run: content-free empty revisions
node …/linearize.mjs prune --apply      # excludes working_copies() and bookmarks()
node …/linearize.mjs verify             # 1 head, 0 merges, 0 conflicts, 0 divergence
node …/linearize.mjs report
```

`prune` only abandons empties that are neither a live workspace's `@` nor a bookmark
target; it is content-neutral (the tip tree is unchanged) but rewrites commit ids above
the first pruned revision. Keep the working copies of archived threads if the DSH panel
still references them, or its thread rows stop resolving.

Then resync the tree the merge invalidated:

```sh
ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile   # node_modules vs the new lockfile
pnpm install --lockfile-only                                     # if manifests gained dependencies
node tooling/dshx/packages/dshx/dist/cli/bin.js checkout sync    # rebuild + profile sync (never restarts DSH)
```

## 7. Verify before claiming success

Shape (`verify`) proves nothing about the code. Run the repository gates and compare
every failure against a scratch workspace at the **pre-linearization tip**:

```sh
pnpm --dir plugins run check       # contract, build, typecheck, test
pnpm run check:plugin-boot         # every plugin Host bundle activates
pnpm run check:e2e:smoke           # browser smoke journeys
pnpm run verify:web-profile-contract
pnpm run check:desktop; pnpm run typecheck:scripts; pnpm run test:scripts
jj workspace add /tmp/baseline -r <pre-linearization-tip>   # baseline comparison
```

Baseline rule: if the failing file is **byte-identical** to the old tip, or the failure
reproduces in the baseline workspace, it is pre-existing — say so with the evidence,
never silently discount it. A stale `node_modules` (peer-resolution mismatch like
`react` vs `react-dom`) is a common false failure: `pnpm install --frozen-lockfile`
usually clears it.

## 8. Safety rules that this session learned the hard way

- Record an op id before **every** risky step; `jj op restore <op>` is the only clean undo.
- Never `jj abandon` a revision that holds content the human wants kept; empty it or preserve it.
- Rebase only what the human authorized; leave lanes you skip exactly where they are.
- The repository is not yours alone: a live DSH plugin (auto-archive, auto-integration) can
  forget workspaces and rewrite revisions while you work. Re-run `snapshot`/`verify` after long
  pauses and check `jj op log` for foreign operations before concluding anything changed.
- Report the four numbers (revisions, heads, merges, conflicts), the not-integrated lanes with
  their revsets and reasons, the conflict policy you applied, and the restore point. Nothing is
  pushed without being asked.

See `reference.md` for the jj syntax traps and the deterministic-vs-judgment split.
