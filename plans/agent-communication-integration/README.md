# Agent communication + session tools integration audit

Independent audit of the two prior handoffs — `@dshfiles/agent-communication`
(peer messaging + live session observability) and
`@deepseek-ai/dsh-tool-session-query` (nine model-facing Session tools) — before
building the jj workspace lifecycle/integration plugin. The durable behavior
landed in the owning package docs; this file holds the cross-plugin contracts
and the next-handoff gates.

## Progress

| Slice | State | Evidence |
| --- | --- | --- |
| Inventory both implementations | complete | Code inspection of `plugins/@dshfiles/agent-communication/src`, `tooling/dshx/packages/dshx/src/communication`, and `packages/session-query/tool-session-query/src` in the core checkout |
| Non-interference invariant | complete | Service/tool paths audited; no Session write, `followup`/`steer`, or notification replay exists; scenarios A/B/D/G now regression-tested |
| Session-tool read-only guarantee | complete | Core audit found no read path that activates; four defects fixed (see below) with tests |
| Integration tests A–G | complete | `plugins/@dshfiles/agent-communication/src/integration.test.ts` (7 tests) |
| Shared contracts for future plugins | complete | Documented below; no new framework introduced |
| Live profile verification | not attempted | Never restart or sync the live `web` profile from this work; the plugin build and host import were verified in a scratch workspace |

## What exists

- **Agent communication** (`plugins/@dshfiles/agent-communication`): durable topic
  channels and per-Agent inboxes over `CommunicationService`; passive arrival
  only; `dshx_comm_agents`, `dshx_comm_workspace`, `dshx_comm_history`,
  `dshx_comm_topics`, `dshx_comm_subscribe`, `dshx_comm_unsubscribe`,
  `dshx_comm_publish`, `dshx_comm_send`, `dshx_comm_inbox`, `dshx_comm_ack`;
  a browser panel with channel/direct navigation, diagnostics, and bounded
  activity; a local socket bridge with CLI and MCP adapters.
- **Session tools** (`@deepseek-ai/dsh-tool-session-query`, canonical core
  checkout): `session_list`, `session_history_page`, `session_mutate`,
  `session_prompt`, `session_search`, `session_event_search`, `session_trace`,
  `session_event_trace`, `session_event_read`, with workspace-membership
  authorization and one-time approval for out-of-scope writes. **Opt-in and not
  composed in the live `web` profile.**

## Identity and lifecycle facts

- Agent id == DSH Session id; `runtime_owner_session_id` is live runtime
  ownership, not durable lineage.
- `workspace_topic` is `workspace/<sha256(resolve(cwd))[0:24]>`, an opaque
  same-cwd hash — not a DSH Workspace id, not a jj workspace/revision.
- `dshx_comm_workspace` is the only place that returns a real DSH Workspace
  id/title, via the read-only `WorkspaceRegistry.resolveByPath`.
- Communication status is only `idle | running`; completed, failed,
  interrupted, never-started, and unknown-id are indistinguishable there.
  Absence from the live registry is not completion.

## Fixed in this audit

Communication (dshfiles, this revision):

- Added `intent: notice | request` metadata so a request is distinguishable
  from a notice without any delivery change; inbox output, diagnostics, the
  browser badge, and the composer toggle surface it.
- Added optional sender-scoped `dedupeKey` (idempotent retry) and opaque
  `correlationId` (grouping) to `publish`/`send`; persisted schema is now v4
  with v1/v2/v3 migrations.
- Fixed the bridge client contract: `delivery: 'passive'` is accepted instead
  of failing `.strict()` validation (legacy `quiet|queue|steer` still normalize).
- A second DSH instance sharing one `DSH_HOME` no longer fails activation when
  another process owns the socket bridge; it logs a warning and keeps its
  in-process tools.
- `dshx_comm_send` reports whether the recipient is currently live, without
  blocking durable delivery.

Session tools (core checkout, described revision):

- `session_history_page` addresses a forked child as a session instead of a
  subagent, so reading a caller-created child no longer fails.
- `session_list` preauthorizes parent ids and omits an unauthorized
  `parent_session_id` instead of echoing it.
- `session_mutate` fails closed on an unrecognized action instead of falling
  through to reorder.
- `session_prompt` reuses the tool call id as the Host request id, so a retried
  call is admitted once.
- The rename approval reason hashes the title instead of echoing a preview.

## Shared contracts needed before the jj plugin

Keep this small; do not build a framework. Future plugins (jj workspace
management, activity timeline, task/issue coordination, sidebar) need:

1. **Session identity** — the DSH Session id is the only durable identity; jj
   workspaces and DSH Workspaces are separate. A jj plugin must publish its own
   `jj_workspace_id` / `jj_change_id` alongside the Session id, never overload
   `workspace_topic`.
2. **Structured work events** — the activity timeline must consume typed events,
   not chat text or `jj` output. The communication activity event
   (`{id, principal, operation, outcome, occurredAt, durationMs, callId,
   rootCallId, errorCode}`) is the existing shape; reuse it rather than adding a
   parallel log, and emit at the use-case boundary.
3. **Correlation** — `callId`/`rootCallId` already correlate a tool call with
   its activity; message `correlationId` groups related peer messages. A jj
   integration request should carry the same correlation id across the message,
   the inspection, and the integration action.
4. **Lifecycle vocabulary** — do not invent a new session-state enum in a
   plugin. `running | inactive` (Host), live-registry `idle | running`, and the
   durable subagent catalog are distinct facts; expose them as distinct fields
   with their source, and never infer completion from absence.
5. **Authorization** — server-side, fail-closed, derived from the acting Agent
   (never tool arguments). Reads need no write grant; writes need an explicit
   preset or one-time approval. The communication Host API
   (`setSubscription`/`unsubscribe`/`acknowledge`) is an operator surface and
   should stay documented as such.

## Scenario validation

| Scenario | Evidence |
| --- | --- |
| A two active agents | automated: `integration.test.ts` A |
| B completed recipient | automated: B (durable, unread-until-read, no replay) |
| C read-only inspection | automated: C + core read-path audit; core has no activation path |
| D explicit delegation | automated: D (intent distinguishable, no activation); core `session_prompt` write/approval gate inspected, retry test added |
| E concurrent communication | automated: E + existing concurrent-send tests; ordering, attribution, dedupe |
| F failure/recovery | automated: F (stale id, reopen, ack of unknown id) |
| G workspace handoff | partially automated: G proves the completed agent is not reopened and the inbox is durable; **the durable history read for a non-live session is not exposed by the communication plugin** — that is the core session-tools path and the missing wiring below |

## Next-handoff readiness

**Can we proceed with the jj workspace lifecycle/integration plugin? Yes, with
two prerequisites.** No blocker remains in the passive-coordination foundation.

- **Important (before or with the jj plugin):** the communication plugin still
  has no durable descendant/history path for a completed agent.
  `projectDurableSubagentDescendants` exists but is unused, and
  `dshx_comm_history`/`dshx_comm_workspace` accept live runtime-owned
  descendants only. Decide: wire the durable projection (via
  `ctx.subagents.listDescendants`) or make the core session tools the only read
  path and remove the dead projection. Scenario G depends on that decision.
- **Important:** `@deepseek-ai/dsh-tool-session-query` is not composed in the
  live profile. The orchestrator story in this audit is proven by tests and code
  inspection, not by a running profile. Compose it in a scratch profile before
  claiming the jj integration workflow end to end.
- **Later:** external CLI/MCP activity is not recorded (the activity principal
  is agent-only); the communication Host API's operator acknowledge/unsubscribe
  controls are not ownership-scoped; cross-process write serialization relies on
  a single Host instance owning the bridge.
- **Environment, not a blocker:** `@dshfiles/dshx` project typecheck and
  `oxfmt --check` already fail on untouched files in this checkout
  (`@deepseek-ai/dsh-api-session-controller/client/contracts` is missing from
  the vendored `lib/`; the formatter baseline predates this work). The changed
  communication subgraph typechecks standalone.

## Evidence

```sh
# dshfiles scratch workspace
pnpm --filter @dshfiles/agent-communication test        # 29 tests
pnpm --filter @dshfiles/dshx exec vitest run tests/communication   # 21 tests
node scripts/check-workspace-contract.ts                # passes
dshx build && node -e "import('./dist/index.js')"       # host bundle imports

# core checkout
vitest run packages/session-query/tool-session-query/tests/tool-session-query.spec.ts  # 116 tests
tsc -p packages/session-query/tool-session-query/tsconfig.json --noEmit                # passes
```
