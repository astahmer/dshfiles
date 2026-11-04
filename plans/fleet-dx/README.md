# Fleet DX: t3code parity for remote machines

Close the gaps found on 2026-11-04 against t3code `origin/main` 9e8553853 (the
comparison table lives in the
[multi-host README](../../plugins/@dshfiles/multi-host/README.md#compared-with-bb-and-t3code)).
Remote-thread rendering (native questions, approvals, terminals) is owned by
[Remote threads as real threads](../remote-thread-composer/README.md); this plan
only links to it.

Backlog: b:544 (Hosts panel broken), b:462 (fleet update), b:481 (MCP fleet
control), b:482 (one thread across machines), b:117 and b:183 (remote thread
feels different), b:184 (keep jj in sync across hosts).

## Milestones

| #   | Slice                                                                                                                                                                                                                                                                  | Acceptance                                                                                                                                                                  | Status      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 0   | Hosts panel works again: no-argument methods take `undefined`                                                                                                                                                                                                          | `jj:57018c09`; regression test; live Hosts page lists hosts after a Host restart                                                                                            | code done   |
| 0b  | Quick wins: Copy diagnostics after Test connection; version-drift line on each Hosts row; README comparison refreshed                                                                                                                                                  | `jj:b1ab8405`, `jj:7051d9e1`; unit tests; browser check pending                                                                                                             | code done   |
| 1   | **Fleet update dialog** (b:462): per-host DSH version and checkout revision, one "Update all" that runs `checkoutSync` → rebuild → runtime restart per host, live per-row state (waiting / updating / restarting / done / failed + Retry), threads on that host resume | A two-runtime scratch fleet updates from the dialog; a failing host shows its error and Retry; the version-drift line clears; agent tool `multi_host_update_all` mirrors it | not started |
| 2   | **Version-mismatch banner** in a remote thread's composer, with an Update button feeding milestone 1                                                                                                                                                                   | Banner appears only when versions differ; Update starts the single-host flow                                                                                                | not started |
| 3   | **Remote subagents** (b:482): `subagent` / `backlog_start_thread` accept a host (or Auto) and run the child as a mirrored thread there; the parent receives its result                                                                                                 | Scratch: a parent thread on A starts a child on B through Auto; the child result arrives in A; stopping the parent stops the child                                          | not started |
| 4   | **Per-step diagnosis on failure**: `testConnection` returns the steps it ran even when one fails; the host row and picker show which hop failed (SSH, runtime, identity) with its recovery                                                                             | Unit test per failing hop; dialog lists failed hop; Copy diagnostics includes it                                                                                            | partial     |
| 5   | **Unreachable host polish**: a short disconnect grace delay before turning a host red; "Hide this host's threads" from the offline banner                                                                                                                              | No red flicker on a 2 s blip; hiding reuses the existing hidden-host flag                                                                                                   | not started |
| 6   | **Open the exact thread on the host**: `runtimeOpenView` takes an optional Session id and opens `?thread=` on the remote UI                                                                                                                                            | Host UI opens on the mirrored thread, not the home screen                                                                                                                   | code done   |
| 7   | **Native remote questions and approvals** (b:117, b:183): answer them from the local thread                                                                                                                                                                            | Tracked as milestone 6 of [remote-thread-composer](../remote-thread-composer/README.md)                                                                                     | external    |
| 8   | **Auto placement weights** and **same repo across hosts**: a per-host weight on the Hosts page used by the resource pool score; projects with the same origin URL grouped with a host badge                                                                            | Weighted pick unit-tested; a repo cloned on two hosts shows one project with two hosts                                                                                      | not started |
| 9   | **Keep jj in sync across hosts** (b:184): fetch + rebase the remote checkout before a remote thread starts, opt-in per host                                                                                                                                            | Remote thread starts on the bookmark tip it would have locally                                                                                                              | not started |

Deliberately skipped: SSH password prompts (BatchMode stays), pairing codes,
Tailscale routes and a cloud relay, and a mobile app. Revisit only if a host
cannot be reached with keys over SSH.

## Order

0 → land and restart; then 4 and 6 (small, unblock debugging); 1 → 2 (fleet
update); 3 (remote subagents); 5, 8, 9 as polish. 7 follows its own plan.

## Resume here

Milestones 0 and 0b are code-complete. Milestone 4 is partial: `testConnection`
keeps its hops on failure and the Add host dialog shows them (Host test in
`tests/host-wire-errors.characterization.test.ts`); the Hosts row and Run-on
picker still show only the last error, because the runtime status path
(`runtimeStatus`/`runtimePing`) records one `lastError`, not hops. After landing,
build `@dshfiles/multi-host` in the canonical checkout, ask the user to restart
the DSH host process, then confirm the Hosts page and the Run-on picker list
hosts (confirmed after the 2026-11-04 restart: no new `multi-host/list` or
`threadList` contract errors). Milestone 6 adds `sessionId` to `runtimeOpenView`
and sets `?thread=`, which thread-sidebar opens on page load; an end-to-end check
against a real host is still pending. A full-profile scratch DSH (`dshx dev up`
with no `--plugin`) fails to boot here: multi-host stops with
`HostServiceMissing: subprocess`; the live profile and a multi-host-only scratch
boot fine. Next: milestone 1.

The [host-pool plan](../host-pool/README.md) still shows every milestone
pending although Auto placement and the resource view shipped (b:346, b:356):
retire it with `complete-plan`.
