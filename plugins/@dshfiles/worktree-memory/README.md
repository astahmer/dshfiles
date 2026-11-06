# DSH worktree memory

![Process memory and Node origins](docs/screenshots/memory-board.png)

System monitors show many `node` rows without context. This page adds a rule-based summary of current-user Node
processes (known script labels, nearest app ancestor or immediate parent, and working directory) alongside DSH trees
grouped by workspace. Node origins are read-only: they expose process IDs and resident RSS, not command arguments or
environment values. Stops remain scoped to DSH trees and require confirmation.

This is the **RAM** tab of **Observe › Processes** (owned by `@dshfiles/background-jobs`), and the RAM part of the
thread panel's **Jobs** tab. Without background-jobs it stays its own page, the **Worktree Memory: RAM** view, with
the pressure dot and detached total on its navigation glyph.

## Where the rows come from

```
ps (current UID, pid, ppid, rss, lstart, args) ──► DSH candidates + Node rows ──► bounded cwd probes
                                          │
ctx.jobs live views ──────────────────────┼──► ProcessTable.snapshot ──► worktree-memory API ──► RAM panel
workspaceRegistry + sessionController ────┘
```

- **Candidates** are this Host's direct children and the user's orphans (`ppid = 1`) that are not apps or system
  agents. The Host also probes up to 100 highest-RSS Node PIDs, within the same 400-process limit.

- **Node origin** uses a fixed script-name rule list, the nearest `.app` ancestor (or immediate parent executable), and
  working directory. Home paths display as `~`; unknown scripts use the generic `Node process` label. The summary
  covers only the current OS user and never returns argv or env. RSS is resident memory, not compressed or swapped.
- **Workspace** is the deepest registered workspace containing the working directory, else a jj sibling checkout of
  one (`<repo>-<name>`, `<repo>-threads/<name>`). An orphan outside every workspace is not ours and is not listed.
- **Origin**: `job` when a live job of this Host owns the tree (matched by label prefix, then by a unique start time),
  `host` for other children of this Host, `detached` for a tree init adopted that still runs inside a workspace — a
  leaked dev server, a test browser, an earlier `dshx dev up` Host. A daemon started on purpose looks the same, so
  the page labels it and asks for confirmation instead of guessing.
- A tree's memory is the sum of RSS over the root and its descendants; its name is the heaviest process
  (`node …/node_modules/vitest/vitest.mjs run` reads as `vitest run`).
- The Host that serves the page and every ancestor of it (a supervisor) are never listed, so they cannot be stopped.

The sidebar samples every 30 s and the open panel polls every 5 s; both share one 3 s process-table cache.

## Stop

`stop` takes `{ pid, startedAt }` pairs from a snapshot and re-reads the process table first: a pid that is not a
listed tree root is refused, and a recycled pid (another start time) too. A job tree goes through the job registry so
its Session records the kill; any other tree gets SIGTERM children-first, then SIGKILL after 3 s on the exact
identities that were signalled.

The panel offers the verb at three scopes: one tree, one section — the `Stop all (N)` button in a workspace header,
so a leaked pile goes without expanding the card — and the sticky footer's `Stop everything (N)`, which covers every
listed tree except a job whose owning thread is mid-turn: that one is left to its own Stop so the turn cannot fail,
and the footer says how many it left alone. A bulk stop names the tree count before it arms, continues in batches of
200 (the API's target limit) and reports one summary. `Stop detached (N)` keeps the narrower leftovers-only verb, per
section and in the footer.

## Scratch DSH Hosts and orphans

![Scratch DSH Hosts with an orphan](docs/screenshots/orphan-scratch-hosts.png)

The RAM tab lists every scratch DSH Host of this user (`--profile dshx-boot`: E2E fixtures and `dshx dev up`) by owner,
with CPU and resident memory summed over its tree. The owner comes from the record dshx writes for each scratch Host,
`$TMPDIR/dshx-scratch/<hostPid>.json` = `{ hostPid, hostStartedAt, ownerPid, ownerStartedAt, workspace, kind, command }`
([orphan cleanup](../../../docs/orphan-cleanup.md)). The Host reads those files itself and decodes them with
Effect Schema; a missing directory means no records and a malformed file is skipped.

A Host is an **orphan** when:

- its record names an owner whose pid is dead or now runs a process started at another time, or
- it has no record (started before the record contract), init adopted it (PPID 1) and it is older than 2 h.

**Stop orphans (N)** on the section, and the `worktree_memory_stop_orphans` tool, re-read the process table and
signal only a pid that still runs `--profile dshx-boot` with the same start time: SIGTERM to its process group (dshx
starts scratch Hosts as group leaders; one that is not gets only its own tree, children first), then SIGKILL after 3 s on
the same identity. The Host serving the page and its ancestors are never signalled.

The frame status strip (`@dshfiles/frame-layout` `StatusItems`, which this plugin provides; frame-layout never imports
it) shows **N orphaned DSH · size · CPU** only while orphans use at least the configured CPU or memory, and opens the
RAM tab. The item polls `scratchHosts` every 30 s: one `ps` and the record directory, no working-directory probes.

| Setting (`dshfiles-worktree-memory`) | Default | Meaning                                        |
| ------------------------------------ | ------- | ---------------------------------------------- |
| `orphanAlertCpuPercent`              | 50      | Warn at or above this CPU, percent of one core |
| `orphanAlertMemoryMb`                | 1024    | Warn at or above this resident memory, in MB   |

## Agent tools

`worktree_memory_snapshot` (read-only, includes `scratchHosts`), `worktree_memory_stop` and
`worktree_memory_stop_orphans` (both require `confirm: true`).

## Host gap

The job registry exposes no pid or working directory for a job, so attribution is inferred from the process table.
Recorded in [`plans/dsh-host-gaps.md`](../../../plans/dsh-host-gaps.md).
