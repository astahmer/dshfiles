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

| #   | Slice                                                                                                                                                                                                                                                                  | Acceptance                                                                                                                                                                  | Status    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 0   | Hosts panel works again: no-argument methods take `undefined`                                                                                                                                                                                                          | `jj:57018c09`; regression test; live Hosts page lists hosts after a Host restart                                                                                            | code done |
| 0b  | Quick wins: Copy diagnostics after Test connection; version-drift line on each Hosts row; README comparison refreshed                                                                                                                                                  | `jj:b1ab8405`, `jj:7051d9e1`; unit tests; browser check pending                                                                                                             | code done |
| 1   | **Fleet update dialog** (b:462): per-host DSH version and checkout revision, one "Update all" that runs `checkoutSync` → rebuild → runtime restart per host, live per-row state (waiting / updating / restarting / done / failed + Retry), threads on that host resume | A two-runtime scratch fleet updates from the dialog; a failing host shows its error and Retry; the version-drift line clears; agent tool `multi_host_update_all` mirrors it | partial   |
| 2   | **Version-mismatch banner** in a remote thread's composer, with an Update button feeding milestone 1                                                                                                                                                                   | Banner appears only when versions differ; Update starts the single-host flow                                                                                                | partial   |
| 3   | **Remote subagents** (b:482): `subagent` / `backlog_start_thread` accept a host (or Auto) and run the child as a mirrored thread there; the parent receives its result                                                                                                 | Scratch: a parent thread on A starts a child on B through Auto; the child result arrives in A; stopping the parent stops the child                                          | partial   |
| 4   | **Per-step diagnosis on failure**: `testConnection` returns the steps it ran even when one fails; the host row and picker show which hop failed (SSH, runtime, identity) with its recovery                                                                             | Unit test per failing hop; dialog lists failed hop; Copy diagnostics includes it                                                                                            | partial   |
| 5   | **Unreachable host polish**: a short disconnect grace delay before turning a host red; "Hide this host's threads" from the offline banner                                                                                                                              | No red flicker on a 2 s blip; hiding reuses the existing hidden-host flag                                                                                                   | partial   |
| 6   | **Open the exact thread on the host**: `runtimeOpenView` takes an optional Session id and opens `?thread=` on the remote UI                                                                                                                                            | Host UI opens on the mirrored thread, not the home screen                                                                                                                   | done      |
| 7   | **Native remote questions and approvals** (b:117, b:183): answer them from the local thread                                                                                                                                                                            | Tracked as milestone 6 of [remote-thread-composer](../remote-thread-composer/README.md)                                                                                     | external  |
| 8   | **Auto placement weights** and **same repo across hosts**: a per-host weight on the Hosts page used by the resource pool score; projects with the same origin URL grouped with a host badge                                                                            | Weighted pick unit-tested; a repo cloned on two hosts shows one project with two hosts                                                                                      | partial   |
| 9   | **Keep jj in sync across hosts** (b:184): fetch + rebase the remote checkout before a remote thread starts, opt-in per host                                                                                                                                            | Remote thread starts on the bookmark tip it would have locally                                                                                                              | partial   |

Deliberately skipped: SSH password prompts (BatchMode stays), pairing codes,
Tailscale routes and a cloud relay, and a mobile app. Revisit only if a host
cannot be reached with keys over SSH.

## Order

0 → land and restart; then 4 and 6 (small, unblock debugging); 1 → 2 (fleet
update); 3 (remote subagents); 5, 8, 9 as polish. 7 follows its own plan.

## Resume here

Done: 0, 0b, 6. Partial: 1, 2, 3, 4, 5, 8, 9.

- **4**: `testConnection` keeps its hops on failure and the Add host dialog shows
  them; the Hosts row and Run-on picker still show only the runtime's last error
  (`runtimeStatus`/`runtimePing` record one `lastError`, not hops).
- **6**: DSH's sign-in answers the token link with a 303 to `./` and drops every
  other parameter, so `runtimeOpenView` returns a token-free `threadUrl`; the
  client fetches the launch URL to set the host's cookie, then opens the thread.
  Proven in Chromium against a scratch DSH from another 127.0.0.1 origin. When the
  page and the host have different machine names the tab opens the host home.
- **1**: **Update hosts** and `multi_host_update` sync and rebuild each host and
  report whether it needs a restart. Not done: restarting a host from here
  (deliberately left to the user) and updating the DSH core version. Only commits
  on `main@origin` reach a host.
- **2**: a remote thread's header warns when its host runs another DSH core
  version. No Update button: the core version is not something Update hosts
  changes. Not seen in a browser yet (needs a mirrored thread from a second
  runtime).

- **3**: `multi_host_delegate` starts a task as a thread on a named host or on
  Auto, polls its transcript every 3 s and returns the final answer, `failed`,
  `waiting` (question on the host) or `running` with the thread id after
  `waitSeconds`; cancelling the call stops the remote turn. Proven against two
  scratch DSHs (B registered on A as a local runtime). Not done: the core
  `subagent` tool and `backlog_start_thread` cannot take a host (core tools), and
  the parent thread does not show the remote child in its subagent list.

Scratch: a full-profile `dshx dev up` now builds through Turbo, boots, creates
threads and opens thread links (fixed: subprocess inject, session-controller's
setup-time service snapshot, build order). `dshx dev doctor` accepts DSH's boot
"entries did not activate" warning when every entry it names is active by the
time doctor runs (session-search registers `sessionQuery` after an async start).

- **5**: a host that answered in the last 10 s reads as Reconnecting… on the
  chip and Hosts page; hiding a host also hides its threads in the sidebar, and
  an unreachable remote thread offers Hide this host. Not done: the chip menu's
  per-host rows still show a failed ping at once (they are an explicit check).
- **8**: per-host Auto weight (×1, ×2, ×4) in Edit host and
  `multi_host_set_host_settings`; Auto divides pressure by it. Not done: grouping
  the same repository across hosts into one project (thread-sidebar owns project
  grouping; needs remote origin URLs it does not read today).
- **9**: per-host "Fetch jj before new threads" runs `jj git fetch` in the
  thread's folder before a thread starts there (60 s cap; failure never blocks).
  Not done: rebasing anything on the host, which stays the user's call, and a
  real SSH run (only the command shape is unit-tested).

Next: the not-done halves above, then 7 in its own plan.

The [host-pool plan](../host-pool/README.md) still shows every milestone
pending although Auto placement and the resource view shipped (b:346, b:356):
retire it with `complete-plan`.
