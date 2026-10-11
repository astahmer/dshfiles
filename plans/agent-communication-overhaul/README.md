# Agent communication overhaul

| Phase | Status | Evidence / outcome |
| --- | --- | --- |
| A. Audit lifecycle and storage | in progress | Confirmed `queueNotice` manufactures a user-role message and calls `followup()`/`steer()`; `initializeAgent` replays pending notifications. Host bridge unavailable from the source shell, so screenshots remain the only live report evidence. |
| A. Repair passive delivery and topic initialization | pending | Add regressions for durable messages without execution, workspace auto-subscription, reconnect, and legacy-state migration. |
| B. Collaboration browser | pending | Replace telemetry-first page with channel/message browsing; keep diagnostics secondary. |
| C. Coordination and resource context | pending | Add only bounded, advisory coordination that existing host contracts support; no destructive workspace actions. |
| D. Verify | pending | Focused tests, plugin build/typecheck/import, isolated E2E; never restart the live Host. |

## Confirmed findings

- `plugins/@dshfiles/agent-communication/src/host.ts` injects communication notices as `source: { kind: 'user' }`, then calls `Agent.followup()` or `Agent.steer()`. DSH's Agent contract explicitly says followup wakes an idle driver and idle steer starts a turn.
- New messages invoke notification delivery immediately; agent initialization replays pending notices. This can wake a completed/idle conversation and replay after restart.
- Workspace subscriptions are intended to be created for current and newly created Agents. The prior screenshots show live Agents with workspace topics but zero stored topics/subscriptions; that is a reproducible expectation mismatch, but no current Host bridge endpoint was available from this shell to establish the live root cause.
- Service writes are serialized per service instance and atomic; durable messages remain available until acknowledgement. Existing plugin E2E journeys exercise only empty Host states.
- Agent status is only `idle | running`; it does not prove whether a task is complete or whether background work is still active. The UI must not infer completion from `idle`.

## Workspace handoff

- DSH session/thread: `session-d6c9af29-2cdf-4a9c-b8fa-111a59f0629d`
- JJ workspace: `agent-communication-overhaul`
- Workspace path: `/Users/astahmer/dev/dshfiles-agent-comm-overhaul`
- Base commit: `4ebf4a81192c9a3e9ce04781c1d6575e5782b17e` (snapshot of the shared working copy; other workspace changes preserved)

## Resume here

Remove the implicit execution-triggering notification path first. Then add a host-level integration regression and diagnose why startup auto-subscriptions were absent before beginning the browser redesign.
