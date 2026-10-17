# jj-linearize reference

Everything here was learned on jj 0.45.1 during the 2026-10-17 dshfiles linearization
(57 lanes, 254 off-main revisions, 3 lanes kept aside, 49 empties pruned).

## Deterministic vs judgment

| step | determinism |
|---|---|
| off-main revision set, lanes, lane order, owners, tips | **full** — revsets + author timestamps, stable tiebreak on change id |
| duplicate detection | **full** — sha256 of `jj diff --git -r <commit>` against the bookmark line's patches |
| `SUPERSEDED` verdict | **full** — every contentful description present on the bookmark line |
| rebase mechanics, running tip, delta conflict detection | **full** — one `jj rebase` per lane, conflicts diffed before/after inside the lane revset |
| inherited-vs-own conflict split | **full** — conflicted paths ∩ the revision's own `--summary` paths |
| lockfile/doc-index/prose conflict content | **judgment** — union, take-main, or regenerate |
| "is this lane worth integrating at all?" | **judgment** — owner readiness, size, whether it rewrites newer bookmark code |
| "is this gate failure pre-existing?" | **mechanical once you have a baseline workspace** — byte-identical file or reproduced failure |

Semi-deterministic in practice: the script stops at each judgment point with a
machine-readable state (lane index, change ids, conflicted paths) and every action it
does take is logged to `resolutions.jsonl`, so a run can be replayed or audited.

## jj 0.45 syntax traps

- `description(a)` matches **nothing** in this version; use `description(substring:"a")`.
  Prefer change/commit ids in scripts.
- `jj log` has no `--graph` flag (the graph is the default); `--no-graph` exists.
- A log template must end with `"\n"`: without it all rows concatenate into one line.
- Build templates with `execFileSync` argument arrays, not a shell string: an unquoted
  `++` or `(` in a template is a shell syntax error and the failure looks like a jj bug.
- macOS `/bin/bash` is 3.2: no `mapfile`, no `readarray`.
- `jj rebase -r '<set>' -o <dest>` **preserves in-set parent order** — this is what makes a
  lane a chain instead of a fan. `jj rebase -s <rev>` moves source + all descendants (which
  can drag other lanes).
- `-r` re-parents descendants of the moved set onto the set's **old** parent, so another
  workspace's empty `@` (a child of the lane tip) is left behind as a stub unless it is in
  the set or moved afterwards. `-s` avoids that but risks dragging shared descendants.
- Rebasing another workspace's working-copy commit is allowed; that workspace updates
  itself on its next command (`Updated working copy to fresh commit`). No `stale` error.
- `jj abandon <revset>` on content-free empties is content-neutral and rewrites the
  descendants' commit ids (change ids survive, so bookmarks and plugin thread mappings do).
- `--skip-emptied` **abandons** revisions that become empty. Only use it when abandonment is
  authorized; otherwise let them become empty and keep them.
- `working_copies()` and `bookmarks()` are revset functions — use them to protect live
  working copies from a prune.
- Divergence: one change id, two visible commits (`divergent()`). It appears the moment a
  rewritten-away revision is made visible again (a bookmark, `jj log -r all()`), and it
  poisons every later revset. Preserve rewritten versions with `jj duplicate` (new change
  ids) instead of bookmarking the original, and abandon the lingering original.
- `jj workspace forget <name>` needs `--ignore-working-copy` when the workspace is not the
  one you are running from.

## Conflict patterns seen in the wild

- **Stale duplicate lane**: same patch already on the bookmark line → the rebase leaves one
  conflicted file that the bookmark later modified. Resolve with the destination side
  (`jj restore --from <change>- --to <change> <paths>`) → the revision becomes empty.
- **Superseded implementation**: the lane implements a feature the bookmark later landed
  differently. Resolve by emptying the whole revision and record why; the original stays in
  the op log and in the `kept/*` copy if you preserved the lane.
- **Lockfile**: never hand-merge. Take a side, then regenerate from the merged manifests and
  add the lockfile as its own described revision.
- **Docs index tables**: both sides added rows → union in a scratch workspace, then
  `jj squash --use-destination-message` into the conflicted commit.
- **Fixture/template tests that "fail after the merge"**: check whether the failing file
  differs from the old tip at all; usually it does not, and the real cause is a stale
  `node_modules` peer layout.

## Reporting shape that the human actually wants

1. Before/after numbers: revisions, heads, merges, conflicts, divergent.
2. What was integrated, per lane, and what was left aside — with the exact revsets and the
   reason, plus the bookmark that keeps it discoverable.
3. The conflict policy applied and every mechanical resolution (`resolutions.jsonl`).
4. Verification: which gates ran, which failed, and the baseline proof for each failure.
5. The restore point(s) and the explicit statement that nothing was pushed.
