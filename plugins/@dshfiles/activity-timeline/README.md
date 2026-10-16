# DSH activity timeline

One chronological activity feed across agents, sessions, communication, and jj
workspaces — a shared activity room rather than another thread list. Observation
only: it never activates, messages, or steers an Agent.

## Data flow

```
core agent events ──────┐
communication ───────────┤
jj integration + workspaces ─┤
Project Checks receipt ─────┴─► cordis 'dshfiles/activity/event' ─► validate + dedupe ─► durable store ─► condense ─► page API ─► Activity panel
Project Checks startup replay ◄── bounded receipt backfill
```

Sources are decoupled: the timeline listens on Cordis events and never reads
another plugin's state file or service. `@dshfiles/jj-integration` and
`@dshfiles/agent-communication` emit structured events; core
`agent/created|disposed|status|error|inbox/inserted` are mapped directly.
Project Checks emits only a strict v1 receipt summary after persistence and
answers a bounded backfill from its own receipt store. Timeline requests replay
on startup and after `dshfiles/activity/source-ready`, so either plugin boot
order works; receipt-derived event IDs dedupe overlapping replay.

## Normalized event

`{ id, at, source: session|communication|integration|system, type, level:
routine|notable|attention, sessionId, workspaceId, taskId, correlationId,
causationId, summary, detail, metadata, references[{kind,id,label}],
provenance: observed|reported }`. IDs come from the source (message ID, call ID,
integration event ID, or receipt-derived ID) so duplicate delivery dedupes.
Verification metadata carries only recorded before/after revision facts; current
freshness is not inferred from a historical event. Missing optional metadata is
normalized to `null`.

## Persistence and replay

Private JSON under `$DSH_HOME/runtime/dshfiles/activity-timeline/state.json`
(mode 0600, atomic rename, bounded to 5,000 events). The store is the replay
source across restarts; adapters can be re-fed historical payloads into the same
model. Schema version 1 is validated on read; malformed payloads are rejected,
unknown state shapes fail closed without being overwritten.

## Condensation

Deterministic, no LLM. Routine runs of the same type and session within ten
minutes collapse into a traceable group (`N× label for <session>`); consecutive
notable events sharing a correlation id collapse into a related group. Attention
events and named milestones (`session.error`, `session.input`,
`communication.message`, all `integration.*`, `verification.cancelled`, and
`workspace.ready|missing`) are always individual. Every group carries the ids of its members, and the
`detailed` filter expands every retained event.

## UI

Activity panel in `main` with a compact toolbar (search, source toggles,
attention-only, detailed), a chronological feed (oldest top, newest bottom),
auto-scroll only when already near the bottom, a new-events indicator, jump to
latest, "load older" cursor pagination, and a detail drawer with metadata,
references, provenance, and correlated events. When an event names a Session,
"Open Session" navigates through the public Client workspace API only if that
Session is in the current Host list. Missing or archived Sessions show an
unavailable message without being revived or changed. Verification detail is a
historical summary; open Project Checks for live source freshness and the full
bounded receipt. Configuration equivalence is explicitly unknown.

## Agent tools

`activity_timeline_page`, `activity_timeline_attention`,
`activity_timeline_stats`, `activity_timeline_related` — all read-only.

## Known limitations

- Session coverage is lifecycle-level (created/disposed/status/error/input);
  turn-level tool calls are not yet emitted by core, so the adapter boundary is
  ready but that source is deferred.
- The panel polls the newest page every 5s; a push/stream subscription is the
  next step (the page API is already incremental via cursor).
- Thread/workspace references remain badges. Session navigation checks current
  Host-list membership before calling `uiWorkspace.openSession`; archived/missing
  Session feedback remains a final acceptance check.
- Scratch journeys cover the feed, condensation, manual and automatic verification
  projection, retry attempts, cancellation as notable/non-failure, revision
  privacy, Session navigation, restart/backfill dedupe, and Project Checks
  operation without Timeline. Manual and retry/cancellation journeys exercise
  both plugin boot orders.
- Run `pnpm check:e2e @dshfiles/activity-timeline` and
  `pnpm check:e2e @dshfiles/project-checks` from the repository root.
