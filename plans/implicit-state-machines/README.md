# Implicit state machines

## Why

An audit on 2026-11-05 found 180 flows across `plugins/@dshfiles/*` and `tooling/` that encode a lifecycle in
scattered booleans, refs, `status` strings, timers and generation counters instead of one explicit state: 28 high,
72 medium and 80 low. The high ones are reachable bugs (cross-thread races, lost clicks, stuck editors, leaked
captures), and the most common smell is an explicit xstate machine with parallel flags kept beside it. Every finding,
with its file, inferred states and the concrete flags, is in the [catalog](catalog.md); ids below (`H3`, `M12`, `L4`)
refer to it.

## Resume here

WP1, WP2 and WP3 are done on this line (WP3: device sign-in, autosave and hover-intent built; the shared poll actor closed as obsolete because H25 and M29 own their polls inside their machines). WP4 is nearly done (20 of 22; subprocess-local M53 and workspace-folder-picker M69 are in the last WP4 lane), WP5 and WP6 are in flight in parallel lanes, and WP7 has 10 of its 14 fixes done with L18 left and the L1-L80 walk recorded.

## Progress

| WP  | Scope                                          | Findings             | Status                                                |
| --- | ---------------------------------------------- | -------------------- | ----------------------------------------------------- |
| 1   | Real bugs with small fixes                     | 12                   | done (11 fixed, H5 obsolete)                          |
| 2   | Wire the machines we already have              | 17                   | done (16 fixed, L51 left)                             |
| 3   | Shared building blocks                         | 4 blocks, 10 callers | done (3 built, poll actor obsolete)                   |
| 4   | Host lifecycles                                | 22                   | in progress (20 of 22)                                |
| 5   | Client flows that need a machine               | 34                   | in progress                                           |
| 6   | Query, mutation or union instead of hand state | 17                   | in progress                                           |
| 7   | Low-severity triage                            | 80 (14 to fix)       | in progress (10 of 14 fixed, L18 left, walk recorded) |

Update a row's status and the "Resume here" line after each milestone commit.

## Rules for every fix (do not re-litigate)

- **Pick the smallest tool that makes bad states impossible**, per the `plugin-state` skill:
  - Host or async server data, polling, paging → TanStack Query (`refetchInterval`, `useInfiniteQuery`) or `useMutation`.
  - Two or three states with no timers → one discriminated union in a single `useState`/`Ref`.
  - Three or more tangled states, timers, cancellation or child work → xstate v5 from `@dshfiles/plugin-ui/machine`
    (`after` for timers, invoked actors for async, `fromCallback` for listeners).
  - Host side → Effect: `SynchronizedRef.modifyEffect`/`Ref.modify` for check-then-act, `FiberMap`/`FiberSet` for
    per-key work, `Effect.ensuring` for flags that must reset, a pure `transition(state, event)` for persisted records.
- **A machine owns all of its flow.** When a component wraps a machine, its parallel flags, refs and effects move into
  the machine as context, states, events or invoked actors. Never add a second source of truth beside one.
- **Per-key state is per key.** Anything fed by events from several Sessions, accounts or paths keys its state by that
  id (`H10` is the model bug).
- **Reproduce first.** Each high finding gets a failing test that shows the bad combination, then the fix. Machines get
  a transition test; React flows get an existing dshx E2E journey step when the bug is user-visible.
- **No behavior change beyond the bug.** Preserve current defaults; a refactor that changes UX needs the user's OK.
- **One revision per finding, or one per work-package slice for small ones,** with a Conventional Commit title naming
  the plugin and the catalog id in the body (`Fixes implicit state machine H10.`).
- **Leave is a valid outcome.** A finding closed as "leave" gets one line in the catalog's row saying why.

## WP1 — Real bugs with small fixes

Each one is a reachable defect fixed without a redesign.

| Id       | Plugin                               | Fix                                                                                                       |
| -------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| H10      | goal-stall-guard                     | Key `StallDetector` state by `sessionId`; test two interleaved Sessions.                                  |
| H16, H17 | model-effort-picker, model-selection | Split `status` into `catalog` and `selection` fields; derive the combined status. Same fix in both forks. |
| H7       | diff-viewed                          | Compute the next mark from the optimistic value; queue toggles so a response cannot clear a newer flip.   |
| H21      | rich-composer                        | Reset the `settled` latch when a rename fails; editing stays responsive.                                  |
| H15      | memory                               | Raw content via `useQuery` keyed by thread id (`enabled: tab === 'raw'`).                                 |
| H14      | memory                               | Apply a focus request as one update (project, tab, selection); drop the effect that wipes it.             |
| H4       | backlog                              | Voice capture as one `phase` union with `starting`; ignore clicks while starting; stop on unmount.        |
| H5       | backlog                              | Guard autosave against overlapping saves; retry after error. Becomes a WP3 autosave caller later.         |
| H12      | jj-integration                       | Make scan start atomic (`SynchronizedRef.modifyEffect`).                                                  |
| H18      | preview                              | Re-check the thread entry after `await browser.newContext()` so two openers share one context.            |
| M43      | pulls-review                         | Reset scope, turn and comment draft together on Session switch (key by `sessionId`).                      |

## WP2 — Wire the machines we already have

Explicit machines exist; the parallel state beside them moves in.

| Id       | Plugin          | Machine                                                      | Fix                                                                                                           |
| -------- | --------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| H24      | thread-sidebar  | `resume-all-usage-limits-machine` (only its test imports it) | Drive resume-all through it; add a sibling for restart recoveries; delete the hand-rolled worker pools.       |
| H25      | thread-sidebar  | `restart-machine`                                            | Move restart-when-idle request, cancel and drain wait (poll actor) into the machine.                          |
| H19      | prompt-stash    | `library-migration-machine`                                  | Move the 7 module globals into machine context.                                                               |
| H27, H28 | user-questions  | new `pending-question` machine                               | Replace the 6 carrier booleans with one machine; the composer's submit becomes a `submitting{channel}` state. |
| M4, L7   | ai-accounts     | `accountSetupMachine`, `apiKeySetupMachine`                  | Verify/configure/result-unknown and the form resets become states and actions.                                |
| M66      | whiteboard      | `boardSyncMachine`                                           | Conversion, remote adopt and leave/flush as invoked actors.                                                   |
| M23      | command-palette | `paletteActionMachine`                                       | Add an `asking` state.                                                                                        |
| M24      | editor          | save + engine machines                                       | Discard confirmation and engine activation into the machines.                                                 |
| M29      | jj-integration  | `integrationQueueMachine`                                    | Notice outcome and progress poll owned by the machine.                                                        |
| M34, M35 | jujutsu         | `revisionActionMachine`, `graphNavigationMachine`            | Registration/removal and comparison state into their machines.                                                |
| M45      | rich-composer   | `SubmitMachine`                                              | Command-restore and failure-restore state into it.                                                            |
| L16      | btw             | `side-chat-machine`                                          | Retain/release in an exit action.                                                                             |
| L51      | secret-catalog  | `secret-reveal-machine`                                      | Panel flags into the machine.                                                                                 |
| L57      | settings-shell  | `welcome-notice-machine`                                     | Drop the mirrored store.                                                                                      |

## WP3 — Shared building blocks

Built once, at the narrowest owner, only for flows that already repeat. Check real callers before extracting.

| Block                                                                         | Owner                                | Callers                                                                               |
| ----------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| Device sign-in machine (Host + client)                                        | ai-accounts                          | done: H2, M8 (Host); M7, M9 (client)                                                  |
| Autosave machine (editing → debounce → saving → saved/failed, flush on leave) | `@dshfiles/plugin-ui/machine`        | done: L12, L14 (H5 obsolete); M11 already has its own autosaver                       |
| Poll actor (interval, backoff, stop on terminal)                              | `@dshfiles/plugin-ui/machine`        | obsolete: H25 and M29 own their polls inside their own machines, so no caller is left |
| Hover-intent menu (open/close delays, pinned)                                 | plugin-ui primitive or kit HoverCard | done: M59 (the kit HoverCard has no pinned open, so a machine)                        |

## WP4 — Host lifecycles

| Id                      | Plugin                  | Fix                                                                                                                                             |
| ----------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| H3                      | ai-accounts             | Connection `Operation` as a discriminated union (pending, configuring, verifying, committing, complete, discarded); the Map stays the registry. |
| H2, M8                  | ai-accounts             | Codex and Copilot sign-in on the WP3 device sign-in machine.                                                                                    |
| M6                      | ai-accounts             | Claude CLI session phase union (idle, streaming, awaitingTools, dead); clear the idle timer on exit.                                            |
| M5                      | ai-accounts             | Usage cache entry union; shared fetch gets its own signal, not the first caller's.                                                              |
| M10                     | ai-accounts             | Quota continuation transitions in one pure `transition(record, event)`.                                                                         |
| H26                     | dshx                    | Dev orchestrator as a machine with parallel regions (builds, DSH child, reload).                                                                |
| M62, M63                | dshx                    | HMR generation swap and scratch lease as explicit phase unions.                                                                                 |
| M27, M28, M30, M31, M32 | jj-integration          | Integration queue per path, `landVerified` phases, projection refresh, thread warmup and checkout sync as unions updated with `Ref.modify`.     |
| M18                     | backlog                 | Atomic backfill admission.                                                                                                                      |
| M17                     | backlog                 | Store attention with its owner instead of re-deriving it from event text.                                                                       |
| M12                     | annotations             | One status × verb transition table used by every mutator.                                                                                       |
| M36                     | mcp-servers             | One `Map<id, union>` for reconciler state.                                                                                                      |
| M42                     | pull-requests           | Watcher status union (watching, backoff, failed, terminal).                                                                                     |
| M41                     | project-checks          | Task as a union by status.                                                                                                                      |
| M53                     | subprocess-local        | Termination phase union (running, terminating, killed, exited).                                                                                 |
| M69                     | workspace-folder-picker | Clone job union with atomic start.                                                                                                              |

## WP5 — Client flows that need a machine

Three or more tangled states, timers or cancellation. Order by plugin to keep one plugin's verification together.

- **thread-sidebar:** M55 deep-link route, M56 migrations as a `migrating` state, M57 drag (one union), M59 hover menu (WP3).
- **session-controller:** H23 open/history actor and paging; M49 list refresh.
- **chat:** H6 fold batch union, M19 focus/reveal, M21 follow-tail owner, M22 fold landing.
- **editor:** H8 per-document actor, H9 per-session index machine.
- **jj-integration / jujutsu:** H11 first-send as a child of `workspaceToggle`, H13 locate machine.
- **secret-catalog:** H22 overlay modes, M47 create-and-bind steps, M48 per-requirement setup.
- **agent-preset / agents:** H1 seat actor, M3 editor clean/dirty/confirm-leave.
- **ai-accounts:** M11 editor selection + autosave (WP3).
- **backlog:** M16 reply sequence and continuation dialog.
- **queue-reorder:** H20 queued-message edit as a machine whose persisted snapshot replaces `record.status`, with
  invoked actors for remove, enqueue and place, and delayed settle transitions.
- **annotations:** M13 row action union and pairing flow.
- **Others:** M14 background-jobs stop, M25 input-trigger reducer, M37 memory bulk forget, M38 model menu,
  M44 pulls-review land card, M50 settings-shell connection indicator, M65 user-questions claim, M67 workbench facet
  follow, M68 folder picker browse/search, M70 and M72 workspace-nav dialogs and pick flow.

## WP6 — Query, mutation or union instead of hand state

Mostly mechanical: hand-rolled fetch/poll/paging becomes TanStack Query, flag pairs become one union.

- **TanStack Query:** M1 activity feed (`useInfiniteQuery`), M15 backfill poll, M33 jujutsu graph paging, M58 fan-out
  catalog + send, M64 trace lookup, M71 workspace search, M40 remote bootstrap, M54 attention poll.
- **dshx:** M60 event hub state union, M61 `useApiQuery` request state.
- **Unions:** M2 preset settings, M20 image preview/file open, M26 turn-end poll, M39 multi-host grace, M46 upload
  queue (`queued` state), M51 per-setting save, M52 SharedWorker shim mode.

## WP7 — Low-severity triage

Default is leave. Fix only these, which carry a real defect:

| Id       | Fix                                                                                      |
| -------- | ---------------------------------------------------------------------------------------- |
| L4       | agent-telemetry: close open approvals, compactions and jobs on turn and Session end.     |
| L11, L54 | `Effect.ensuring` for the background-jobs and session-search `active`/`ingesting` flags. |
| L8       | ai-accounts catalog refresh: one `Ref.modify` per account.                               |
| L18      | chat turn jump: one union for phase × landing.                                           |
| L21      | fff-search: do not evict an index in use.                                                |
| L33      | mcp-servers: prune local processes on stop.                                              |
| L36      | memory: reset warm-up flag on failure.                                                   |
| L52      | secret-catalog request card union.                                                       |
| L74      | traces receiver: whole-value status union.                                               |
| L80      | worktree-memory: handle a failed stop.                                                   |

Then walk the remaining low rows once and mark each "leave" in the catalog with a reason.

## Verification

Per fix: the new regression or transition test, then the plugin's `test`, `typecheck` and `build`
(`pnpm --dir plugins/@dshfiles/<name> test -- --run`), and `pnpm lint` at the end of each work package. User-visible
fixes add or extend a dshx E2E journey and follow the `dsh-plugin-verify` skill. When the plan is done, run the
`complete-plan` skill: the rules above move into the `plugin-state` skill and `docs/`, and this folder is deleted.
