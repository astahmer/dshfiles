# Agent communication overhaul

| Phase | Status | Evidence / outcome |
| --- | --- | --- |
| A. Audit lifecycle and storage | completed (source + isolated E2E) | Removed user-role message synthesis, Agent followup/steer calls, and notification replay. Isolated E2E exposed the startup event-registration race; corrected and verified. The live Host remains untouched. |
| A. Repair passive delivery and topic initialization | completed (source/tests + isolated E2E) | Schema v3 migrates v1/v2 to passive delivery and drops notification replay state. Existing and newly created Agents use the same idempotent workspace/inbox helper; the event listener now registers before the bridge's asynchronous startup. Service, lifecycle, and workspace-health E2E cover reads, acknowledgements, pagination, migration, shared workspaces, and startup subscription. |
| B. Collaboration browser | completed (source + isolated E2E) | Replaced the telemetry-first inspector with channel/direct-message browsing, server-side search, cursor pagination, human posts (including offline Agent IDs), recipient context, untrusted-text labeling, truthful runtime status, and secondary diagnostics/activity. |
| C. Coordination and resource context | completed (source + isolated E2E) | Diagnostics compare live Agents' derived workspace topics with stored subscriptions, distinguish opt-outs and unknown (old Host) status, and preserve offline inboxes without treating `idle` or absence as completion. |
| D. Verify | completed for target gates; repository-wide gates remain blocked | Plugin typecheck, 11 plugin tests, 7 DSHX communication service tests, build/import, and all 4 isolated browser scenarios pass. `features:check` reports 83 pre-existing issues outside this plugin. DSHX package build is blocked by missing `@deepseek-ai/dsh-api-session-controller/client`; rebuilding some other plugin-ui consumers hits the same missing DSH core artifact. Live Host is intentionally unverified and untouched. |

## Confirmed findings

- The old `host.ts` notification path synthesized a user-role message and called `Agent.followup()` or `Agent.steer()`. New messages also invoked notification delivery immediately, and Agent initialization replayed pending notices. Those execution-triggering paths are removed; peer arrivals are durable records only.
- The isolated E2E initially reproduced a real startup race: an Agent appeared live with a derived workspace topic but zero subscriptions. The Host registered `agent/created` only after awaiting bridge startup, so an Agent created during that wait could miss both initialization paths. Registering the handler synchronously before bridge startup, then idempotently initializing the current Agent snapshot, made all four isolated scenarios pass. Do not restart the live Host; its state remains unverified.
- Service writes remain serialized and atomic. Inbox reads set `readAt` but do not acknowledge; only explicit recipient acknowledgement hides the message from later inbox reads. Legacy delivery modes are accepted only at compatibility boundaries and normalize to `passive`.
- Agent status is only `idle | running`; it does not prove whether a task is complete or whether background work is still active. The browser labels this uncertainty and does not infer completion.
- New-client diagnostics schemas accept known old-Host delivery and notification fields. The new browser reports a restart hint when the old Host lacks its browse API, and unknown old-Host workspace subscription state is not presented as a confirmed miss.

## Workspace handoff

- DSH session/thread: `session-d6c9af29-2cdf-4a9c-b8fa-111a59f0629d`
- JJ workspace: `agent-communication-overhaul`
- Workspace path: `/Users/astahmer/dev/dshfiles-agent-comm-overhaul`
- Recovered source base: `5f3016a43dbed68ff8f08277bf7c696b044c20e9` (parent `640c15275a4ca68293affb4fbdde07624c2dcfbb`); workspace is the named JJ workspace. Preserve both revisions and all sibling workspaces.

## Resume here

Review the owned-path diff and create focused JJ checkpoints. Plugin source/build, migration/API tests, and isolated browser E2E are verified; report the 83 unrelated feature-catalog issues, missing DSH core build artifact, and partial UI-consumer rebuild separately. Live Host verification remains intentionally unperformed; do not restart or deploy it.
