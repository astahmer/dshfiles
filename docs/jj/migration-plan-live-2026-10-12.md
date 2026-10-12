# Live migration plan — workspace isolation rollout, 2026-10-12

Status: **prepared, not executed. Awaiting explicit approval.**

Produced from a read-only `jj-isolation preflight` at 2026-10-12T09:46Z. The live
store can move; re-run the preflight immediately before executing and treat any
difference as a stop condition.

## Current shape

```
a6cedcdf  main * integration-spine   "chore(jj): workspace slot for default"
├── 83bbf929  docs(jj): record artifact repair, editor blockage, …   (N)
│   └── 3d098420  agent-comm-audit   @ (E)                     head, 0 descendants
└── 9918ee6a  default                @ (E)
    └── 27f7238e  fix(dsh-core): separate the client Session service …
        └── b9621310  test(activity-timeline): keep the high-volume window test …
            └── 0aa9458f  docs(jj): record the artifact repair and the typecheck …
                └── 53eb7e3a  history-repair  @ (E)          head, 0 descendants

below main (folded, interior):
  238abc57 → b52c3418  thread-archive-toast-final  @ (E)     10 descendants
           → 636ddeac  workspace-folder-picker-browser-latest @ (E)   9 descendants
```

Two workspaces are live leaves above the spine, two are folded slots below it,
and `default` is the repository-root checkout. Nothing is currently diverged, no
workspace `@` is conflicted, and no two workspaces share a `@`.

Live writers at preflight time: store quiet (newest operation 56 minutes old), no
mutating jj command in flight, **two VisualJJ `jj branching server` processes
running** (see `jj-guard-coverage.md` — they are outside any PATH shim).

## Per-workspace plan

Rollback for every workspace is the same shape: the migrator prints
`jj edit <previous head>` and the previous revision keeps its whole tree in the
store. Nothing is abandoned, so no operation-log recovery is ever needed.

### 1. `agent-comm-audit` — 3d098420, above spine, 0 descendants

- Mode `leaf-from-current`; graft 1 path, `docs/jj-history-consolidation.md`,
  attributed to `83bbf929` (the commit directly below its slot).
- Dirt: not detected (heuristic, not proof).
- Decision needed: accept the graft (its own docs revision) **or** run
  `--mode reset-to-base` if that docs copy is stale and already landed.
- Command: `migrate agent-comm-audit --base integration-spine --accept-graft`
- Checkpoint before: `jj op log -n1 -T id`, `jj log -r 3d098420 -T commit_id`,
  directory digest.
- Verify after: digest unchanged, `3d098420` still in the store, `@` has 0
  descendants, `default` and `history-repair` untouched.

### 2. `history-repair` — 53eb7e3a, above spine, 0 descendants

- Mode `leaf-from-current`; graft 5 paths, each attributed to one of its own
  three commits (`27f7238e`, `b9621310`, `0aa9458f`): `docs/jj-history-consolidation.md`,
  `plugins/@dshfiles/activity-timeline/src/service.test.ts`,
  `plugins/@dshfiles/queue-reorder/src/session-queue-editor.ts`,
  `tooling/dsh-core/FORK.md`,
  `tooling/dsh-core/api-session-controller/src/client/index.ts`.
- Command: `migrate history-repair --base integration-spine --accept-graft`
- Verify after: digest unchanged, `@` has 0 descendants, its three commits remain
  reachable, `default` untouched.

Order between 1 and 2 does not matter (both have 0 live descendants). Doing both
before the folded slots keeps the store as simple as possible.

### 3. `workspace-folder-picker-browser-latest` — 636ddeac, below spine, 9 descendants

- Mode `reset-to-base`: its content is already on the spine, so it gets a fresh
  empty leaf. **The old `@` is not rewritten**, which is why the live workspaces
  above it do not block it.
- Refuses if the working copy may hold unsnapshotted changes (a snapshot there
  would rewrite an ancestor of the spine and rebase everything above main).
- Command: `migrate workspace-folder-picker-browser-latest --base integration-spine`
- Verify after: digest unchanged, `636ddeac` still an ancestor of main, main and
  the two live leaves unmoved.

### 4. `thread-archive-toast-final` — b52c3418, below spine, 10 descendants

- Same mode and the same clean-working-copy precondition as 3.
- Command: `migrate thread-archive-toast-final --base integration-spine`
- Verify after: as above.

### `default` — 9918ee6a — not migrated

It is the repository-root checkout, not an agent workspace. Its preflight blocker
(`history-repair` sits above it) clears once `history-repair` migrates. It should
end the rollout as a leaf off `main`, which it already is.

## Exact execution sequence (requires approval)

```sh
# 0. confirm nothing moved since the plan was reviewed
node scripts/jj-isolation/cli.mjs preflight --quiet-seconds 300

# 1. fence the store; refuses while an operation is recent or a mutation is running
node scripts/jj-isolation/cli.mjs maintenance arm --quiet-seconds 300 --json

# 2. dry-run every plan first, read them, then apply one at a time
node scripts/jj-isolation/cli.mjs migrate agent-comm-audit  --base integration-spine --accept-graft
node scripts/jj-isolation/cli.mjs migrate history-repair    --base integration-spine --accept-graft
node scripts/jj-isolation/cli.mjs migrate workspace-folder-picker-browser-latest --base integration-spine
node scripts/jj-isolation/cli.mjs migrate thread-archive-toast-final --base integration-spine
# ...then repeat each with --apply, verifying the digest and head report after each

# 3. lift the fence
node scripts/jj-isolation/cli.mjs maintenance disarm --token <token>
```

The migrator re-fences itself after each successful migration, so the fence stays
valid across the sequence. The token is printed by `maintenance arm`.

## Stop conditions

Abort and re-plan if any of these holds when executing:

- the preflight is not quiet, or lists a mutating jj process;
- any workspace's `@` changed since this plan was written;
- a migration reports a changed directory digest, a moved foreign working copy,
  or an `@` with descendants;
- a plan grows a new blocker;
- VisualJJ or another VS Code jj view is actively pointed at this store.

## Recovery

- Any workspace: `jj edit <printed previous head>` inside that workspace restores
  the exact previous tree; both revisions remain in the store.
- A divergent or lost working copy: `node scripts/jj-isolation/cli.mjs recover`
  lists divergent changes with file counts and modifies nothing.
- Never `jj op restore` this store, and never run `jj util gc` while this
  rollout is still reversible.
