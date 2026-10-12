# Incident report: concurrent Jujutsu workspaces destroying uncommitted work

Date: 2026-10-12. jj 0.45.1. Investigated read-only against the live store; fixes
built and tested in an independent clone (`~/dev/dshfiles-jj-isolation`, its own
`.jj` store, commits `c2e0abb417e3` and `29ee0ce4fda2`, porting patch
`/private/tmp/jj-isolation.patch`).

Nothing on the live repository was modified: no sweep, no consolidation, no
`main`/`integration-spine` advance, no profile restart, no push, no `op restore`.
Reads from the live store used `--ignore-working-copy`; the only unflagged reads
were `jj status` / `jj workspace list` in the first minute, when the default
workspace had no changes, so no snapshot operation was recorded.

---

## A. Root cause

**Two jj processes rewrote the same change at the same time. jj recorded a
divergent change, and the owning workspace's next command merged the divergent
operations and checked out the sibling copy over the working directory.**

Reproduced 20/20 times with 18 unsnapshotted files; 19 files on disk become 1.

The reported transcripts are exactly this:

```
(other agent)     Rebased 1 descendant commits.
(victim's next)   Concurrent modification detected, resolving automatically.
                  Rebased 1 descendant commits onto commits rewritten by other operation.
                  Working copy  (@) now at: <change>/3 <other-copy> (divergent) (empty)
                  Added 0 files, modified 0 files, removed 18 files
                  Updated working copy to fresh commit <other-copy>
                  The working copy has no changes.
```

`/3` means three visible copies of one change id. Every message in the incident
notes (`Rebased N descendant commits`, `Updated working copy to fresh commit`,
the divergent revision, the `wrqpkzys`-style leftover) is accounted for.

### Why jj does this (jj 0.45.1, `cli/src/cli_util.rs`)

- `resolve_operation` merges multiple operation heads whenever it finds them,
  printing `Concurrent modification detected, resolving automatically.`;
  `merge_operations` then rebases descendants onto rewritten commits and prints
  `Rebased N descendant commits onto commits rewritten by other operation.`
- `recover_stale_working_copy_impl` snapshots the working copy, re-loads the
  merged repo, then calls `update_stale_working_copy`, which ends in:

  ```rust
  let stats = locked_ws.locked_wc().check_out(new_commit).await?;
  ```

  Its single guard compares the stale commit's tree with the working copy's
  *recorded* tree — after the snapshot those agree, so it passes. The merge's own
  comment concedes the choice is arbitrary: *"The wc_commit_id of the merged repo
  wouldn't change because the old one wins, but it's probably fine if we picked
  the new wc_commit_id."* When it picks the copy without the local snapshot,
  `check_out` deletes the snapshot's files from disk.

This is native jj behaviour under a concurrent rewrite of one change. No
agent-side rule removes it: the race spans the read phase, before jj takes any
lock, so "commit early" only narrows the window. The work is **relocated, not
deleted** — 20/20 runs left it reachable in the store — but nothing on disk says
so, and the reported agents could only recover by hunting a divergent revision.

### The architectural cause: every workspace `@` was a link in one shared line

`jj workspace add` without `--revision` creates the new working-copy commit **on
top of the parent of the caller's `@`** (jj 0.45.1 `--help`), and this repository
folded each parked workspace's slot commit into the single shared line, so
`main` and other workspaces' `@`s sat *above* other workspaces' `@`s. Two
consequences, both measured:

1. **A read in one workspace rewrote another workspace's revision.** `jj log -r @`
   (no `--ignore-working-copy`) in `ws1` rewrote `ws1`'s `@` and moved `ws2`'s
   `@` from `2101e4b1` to `94f50979`, with nobody touching `ws2`'s files. Any jj
   command snapshots its `cwd` unless told not to.
2. **Any rewrite of an interior revision rebased every live workspace above it**,
   making their working copies stale and handing them to the destructive recovery
   path above.

`agent-comm-audit`'s `@` is *still* interior today (`main` → `83bbf929` →
`3d098420` → three more commits → `history-repair`'s slot), so the coupling is
live, not historical.

### Aggravating writers in our own code

`@dshfiles/jj-integration` passed `--ignore-working-copy` on exactly one of its
fourteen jj invocations (`duplicate`). `resolveRevision` and `isRevisionEmpty`
run with `cwd = workspace.path` — **the coordinator snapshots the workspace it is
auditing**, from another process, at a moment the agent does not control. That is
the auditor incident's second writer. `pnpm run jj:workspaces`,
`pnpm run jj:sweep` (dry run included), and the `jujutsu` panel's `jj status`
(60 s refresh) were additional second writers.

A snapshot-only racer reconciles cleanly — measured 15/15 runs, no divergence, no
loss — so those are aggravators, not independent causes: they make the fatal
pairing (a snapshot **and** a content-changing rewrite of one change) likely
rather than exceptional.

### Repository evidence

| measure | value |
| --- | --- |
| total operations in the live op log | 10 083 |
| `reconcile divergent operations` (concurrent-writer collisions) | **200** |
| `snapshot working copy` | 5 316 |
| `rebase commit … and descendants` | 111 |
| `abandon …` | 117 (incl. `abandon commit c1286edd… and 80 more` at 00:35:24) |
| `add workspace` / `forget workspace` | 114 / 80 |

Reconcile clusters by hour: `2026-10-11T03` **60**, `04` 22, `14` 13,
`2026-10-10T23` 13, `10-10T22` 13, `15` 12, `16` 10, `20` 9; then
`2026-10-11T22:56:05`, `22:58:59`, `22:59:02`, `22:59:05`, `22:59:06`,
`23:28:16`, `23:31:17`, and `2026-10-12T01:00:38`, `01:03:51`, `01:04:22`.
The consolidation window is visible as 12 `forget workspace` ops at
`00:31:26–00:33:27` followed by the 81-commit abandon and further abandons of
28/17/12/10 commits through `00:39:30`.

**Attribution is not recoverable from jj.** Every operation records the same OS
user (`astahmer@mac-1.home`); jj keeps no per-process, per-agent or per-session
identity. Timestamps correlate with agent sessions but do not prove which agent
acted, and this report does not claim they do.

**No two workspaces ever shared a working-copy revision.** Queried at four
historical operations (including reconciles at `e9c7583cd8cb`, `b090cda2e96e`,
`5c7acade180d`, `22b1dadb2a66`, with 4–12 live workspaces each): every workspace
had a distinct `@`. Workspace misattachment is ruled out; the divergence came
from concurrent rewriting of one workspace's own `@`.

---

## B. Reproduction

Independent repository, no shared store:

```sh
L=$(mktemp -d); cd "$L"; jj git init --no-colocate repo; cd repo
printf 'spine\n' > spine.txt; jj describe -m spine
S=$(jj log -r @ --no-graph -T commit_id)
jj workspace add "$L/wsMid"  --name wsMid  -r "$S"    # interior slot
M=$(jj workspace list -T 'name ++ " " ++ target.commit_id() ++ "\n" | awk '$1=="wsMid"{print $2}')
jj workspace add "$L/wsVictim" --name wsVictim -r "$M"
jj new -m tip                                          # victim's @ is now interior

cd "$L/wsVictim"; for i in $(seq 1 18); do echo w$i > feature-$i.txt; done
( jj describe -m "victim work" ) &                     # victim snapshots 18 files
( cd "$L/repo" && jj describe -r "$M" -m "other agent" ) &
wait

cd "$L/wsVictim" && jj status                          # the destructive step
ls | wc -l                                             # 19 -> 1
```

`scripts/jj-isolation/isolation.test.mjs` ("S3 control") runs this and asserts the
loss; "S3" runs it with the guard installed and asserts a refusal instead.

---

## C. Fixes

Two commits in the independent clone.

### `feat(jj-isolation)` — one enforcement point, one invariant

> **No command may rewrite a commit that another live workspace holds as its `@`.**

That is the only way a foreign process can change a workspace's working-copy
commit id, so it is the exact condition under which a workspace can go stale and
lose files. It is decidable from two `--ignore-working-copy` reads:

```sh
jj --ignore-working-copy workspace list -T 'name ++ "\t" ++ target.commit_id() ++ "\n"'
jj --ignore-working-copy log -r '(a | b)::' --no-graph -T 'commit_id ++ "\n"'
```

New files:

- `scripts/jj-isolation/guard.mjs` — argv parsing, target extraction per
  subcommand, the footprint/intersection decision, the workspace-base rule, the
  bookmark and repo-wide rules. Pure logic is separated so it is unit-testable.
- `scripts/jj-isolation/cli.mjs` — `run` (decide then exec), `check` (JSON),
  `recover` (non-destructive divergence listing), `footprint`.
- `scripts/jj-isolation/shim-jj.sh` + `install-shim.mjs` — the `jj` boundary
  shim; the real jj path is baked in at install time. Read-only commands exec the
  real jj directly; mutating ones are routed through the guard.
- `scripts/jj-isolation/README.md`, `docs/jj/concurrent-workspace-isolation.md`.

Rules enforced: refuse a rewrite whose footprint hits a foreign `@`; pin
`workspace add` to a frozen base commit when it would otherwise stack on a live
working copy; refuse a canonical-bookmark move to a non-descendant; refuse
`op restore`/`op revert`/`util gc`; refuse `workspace forget` without an explicit
`JJ_ISOLATION_FORGET_PROOF`. Every refusal has a documented one-variable override
for authorized consolidation. Enablement is per repository
(`.jj/jj-isolation.json`) and off by default; uninstalling is deleting a file.

*Architectural decision:* enforcement lives at the `jj` executable boundary
rather than in each caller, because agents invoke `jj` directly from the shell and
a per-caller guard would need four copies that drift. The guard keeps no
registry — it derives everything from jj on demand, so it is not a second
workspace registry and cannot compete with `@dshfiles/jj-integration`'s
ownership records.

*Companion structural rule* (in `AGENTS.md`): a workspace `@` is a **leaf** of a
frozen revision and has exactly one writer. Never base a workspace on `@`, `@-`, a
change id, or another workspace's `@`; never fold a workspace `@` into the shared
line; integration advances a bookmark, which rewrites nothing. The cost is
explicit: `jj log` shows one head per workspace instead of one line. That fan is
what buys the isolation — the old single-line rule is what made every workspace's
working copy rewritable by every other agent.

### `fix(jj)` — remove the unintended writers

- `plugins/@dshfiles/jj-integration/src/jj.ts` — read-only command shapes
  (`log`, `diff`, `evolog`, `file`, `resolve`, `root`, `workspace list`,
  `bookmark list`, `operation log`) now pass `--ignore-working-copy`
  automatically, so the coordinator can never snapshot a workspace it observes.
- `scripts/jj-workspaces.mjs`, `scripts/jj-workspace-sweep.mjs` — every read
  passes `--ignore-working-copy`, so the board and a sweep dry run write nothing.
- `scripts/jj-workspace-sweep.mjs` — `target.empty()` (a property of the recorded
  commit, silent about the files on disk) is no longer a safety proof.
  `--apply` now requires `--prove-clean`, sweeps only rows jjw actually inspected
  and found `clean`, passes `JJ_ISOLATION_FORGET_PROOF`, and prints a recovery
  record instead of suggesting `jj op restore` on a shared store.

### Safety guarantees, stated falsifiably

1. A guard-covered command cannot change a foreign workspace's working-copy
   commit id. Tested: `S3`, `S5b`, `S8`, `S14`, `S14b`.
2. A workspace created through the shim is a leaf of a frozen revision, never a
   child of a live working copy. Tested: `S5`, `S5b`, `S12`.
3. A guard-enabled `jj describe` in workspace A cannot act on workspace B's
   revision, and B's files and `@` are byte-identical afterwards. Tested: `S1`,
   `S2`, `S13`.
4. No guard path snapshots a workspace it does not own. Tested: `S4`, `S4b`,
   `S11`, `S13`, `S14`.
5. A guard-enabled divergence is deterministic to find and recover, and `recover`
   modifies nothing. Tested: `S9`.

---

## D. Tests

`node --test scripts/jj-isolation/guard.test.mjs scripts/jj-isolation/isolation.test.mjs`
— **26 tests, 26 pass, 0 fail** on the committed tree. Real Jujutsu repositories
in temp directories, real OS processes for every concurrency case, no mocks.

The fourteen required scenarios map to: S1, S2, S3 (+ control), S4/S4b,
S5/S5b, S6, S7, S8, S9, S10, S11/S11b/S11c, S12, S13, S14. Each asserts that
every unrelated workspace's files remain intact and that its `@` commit id is
unchanged; where an operation cannot be made safe the test asserts an explicit
refusal (`exit 3`, a `jj-isolation: refused [<code>]` line) rather than silent
mutation.

Failure scenarios proven by the suite itself:

- the bug, unfixed, destroys 18 files (`S3 control`) — so the refusal is
  load-bearing, not assumed;
- a refusal that still executed (found and fixed during development);
- a `describe -m` message parsed as a revset target (found and fixed);
- a workspace "repin" that appended a second `--revision` instead of replacing
  it, which would have created a merge (found and fixed);
- `--apply` without proof, and a dirty candidate surviving `--prove-clean`
  (`S11b`).

Existing suites still pass in the clone: `@dshfiles/jj-integration` **15/15**
vitest tests and `tsc --noEmit` clean.

Measured shim cost: jj read ≈36 ms direct, ≈47–58 ms through the shim
(+11–21 ms). Mutating commands pay a node start (~80 ms) in addition to jj.

---

## E. Recovery

Recovery is needed in two situations, and both are non-destructive.

**A workspace's files vanished after `Updated working copy to fresh commit`.** The
content is still in the store on the losing copy. Do not `jj op restore`.

```sh
node scripts/jj-isolation/cli.mjs recover          # lists each divergent change, its copies, file counts
# then, inside the owning workspace, on the copy that holds the work:
jj new <kept-commit-id>
ls                                  # files are back on disk
jj abandon <losing-commit-id>       # only once verified
```

**A workspace was swept or is otherwise unregistered.** Its directory is never
deleted, and the sweep prints a recovery record:

```sh
jj workspace add <path> --name <name> -r <recorded-commit>
```

**Interrupted mutation** (crash, SIGKILL). Nothing is required: a partially
snapshotted working copy is just a dirty working copy, and `S10` asserts no files
are lost and no divergence appears. Re-run the command.

**Migration for an already-folded line**, per workspace, inside its directory,
with no agent mid-task: `jj status`, then `jj new <frozen spine commit>`, then
`jj describe -m "chore(jj): workspace leaf for <name>"`. Keep the old slots; they
are empty.

---

## F. Remaining risks

1. **Not deployed and not verified live.** The guard exists only in the clone,
   the shim is not installed, and no live profile or runtime has exercised it.
2. **The shim is bypassable.** An absolute path to the real `jj`
   (`~/.nix-profile/bin/jj`), or a shell that does not resolve `jj` through
   `PATH`, skips the guard. It raises the cost of the mistake; it is not a kernel
   boundary.
3. **The live store still has the coupling.** `agent-comm-audit`'s `@` sits
   interior with descendants, and `history-repair` added a separate head, so a
   rewrite of `main` or of `83bbf929` still rebases a live workspace's working
   copy today. Migration is required, not optional.
4. **`--prove-clean` snapshots candidates.** jjw's dirty check runs
   `jj -R <ws> status`, a preserving write, which races a candidate's owner. It
   is far safer than pretending `empty()` proves cleanliness, and snapshot-only
   racing measured harmless (15/15), but it is a write.
5. **The panel's periodic `jj status` remains deliberate behaviour** — removing
   it would change what the panel shows. It is bounded and non-destructive, but
   it is a second writer.
6. **The coordinator defect set is unchanged.** Its lock is still scoped to
   `DSH_HOME` (a second host with a different `DSH_HOME` on the same store has no
   mutual exclusion), the bookmark advance still has no compare-and-swap, crash
   recovery can still leave staging workspaces, and `jj duplicate` still leaks a
   duplicate head on every blocked path. The guard now blocks the bookmark
   rewind and the foreign-write window; the rest belongs to the coordinator
   hardening phase.
7. **Not verified:** other jj versions (0.45.1 only), a genuine 20-agent soak,
   Windows, and browser/runtime behaviour of any fix.
8. **`scripts/` has no typecheck coverage** for the new `.mjs` guard; it is
   covered by tests, not by `tsc`.

---

## G. Deployment

Bring the safeguards in without disrupting active agents; each step is reversible
and none rewrites history.

1. **Land the code, read-only.** Merge the two commits (patch at
   `/private/tmp/jj-isolation.patch`). No behaviour changes: the guard is off
   until a repository opts in, and the write-removal fixes only stop unintended
   snapshots.
2. **Install the shim but enable nothing.**
   `pnpm run jj:isolation:install -- --bindir <dir>`; add `<dir>` ahead of jj in
   the devshell `PATH` (a Nix `modules/` change; not applied here). With no
   `.jj/jj-isolation.json` every command passes through, and the new script gates
   (`jj:workspaces`, `jj:sweep`) already stop writing.
3. **Run `pnpm run jj:sweep` for one day** and confirm it reports the board
   without touching any workspace's `@`.
4. **Enable the guard per workspace as its agent finishes**: write
   `.jj/jj-isolation.json` in that workspace. Refusals appear on stderr with a
   code and an override; watch for false positives from `describe -r`/`rebase`
   workflows and report them.
5. **Migrate the folded line workspace by workspace**, only when that workspace's
   agent is idle and its files are snapshotted. Verify with
   `pnpm run jj:workspaces` that each `@` is a leaf off the frozen base.
6. **Only then** enable the guard for the default checkout and turn on the
   coordinator hardening work (repo-scoped lock, bookmark compare-and-swap,
   crash-safe staging).
7. Keep `scripts/jj-isolation/guard.test.mjs` +
   `isolation.test.mjs` in the gate lane (`pnpm run test:jj-isolation`), and add
   it to CI so a future change to the guard cannot silently weaken it.

---

## H. Verdict

**CONDITIONALLY READY.**

Isolation is demonstrated under realistic concurrent use *in the tested
configuration*: 26 real-jj multi-process tests, including the exact incident
sequence, with the unfixed control losing all 18 files and the guarded run
refusing and leaving every unrelated workspace byte-identical.

It is not READY because the safeguards are not deployed, the shim is a policy
boundary rather than an unbypassable one, the live store still carries the
folded-line coupling that caused the incident, and no 20-agent live run has been
performed. The explicit conditions:

- the `jj` shim is on `PATH` **and** the repository has opted in;
- every workspace's `@` is a leaf of a frozen revision (the migration in G.5);
- only one process writes a given workspace's `@` (the `fix(jj)` commit);
- any operation that must rewrite a foreign working copy uses the documented
  override deliberately, with the store quiet.

Under those conditions the failure mechanism cannot fire for guard-covered
commands. Without them, the mechanism is unchanged and, as the op log shows, still
firing.
