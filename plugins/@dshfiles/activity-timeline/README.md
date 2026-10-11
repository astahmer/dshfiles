# DSH activity timeline

One chronological activity feed across agents, sessions, communication, and jj
workspaces — a shared activity room rather than another thread list. Observation
only: it never activates, messages, or steers an Agent.

## Data flow

```
core agent events ─┐
communication ─────┼─► cordis 'dshfiles/activity/event' ─► normalize + dedupe ─► durable store ─► condense ─► page API ─► Activity panel
jj integration ────┘            (backfill on startup)
```

Sources are decoupled: the timeline listens on one cordis event name and never
reads another plugin's state file or service. `@dshfiles/jj-integration` and
`@dshfiles/agent-communication` emit their structured events; core
`agent/created|disposed|status|error|inbox/inserted` are mapped directly. When
the timeline starts it emits `dshfiles/activity/backfill`, and supporting
sources replay their recent bounded history.

## Normalized event

`{ id, at, source: session|communication|integration|system, type, level:
routine|notable|attention, sessionId, workspaceId, taskId, correlationId,
causationId, summary, detail, metadata, references[{kind,id,label}],
provenance: observed|reported }`. Ids come from the source (message id, call id,
integration event id) so duplicate delivery dedupes; revisions are referenced,
never copied. Missing optional metadata is normalized to `null`.

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
`communication.message`, all `integration.*`, `workspace.ready|missing`) are
always individual. Every group carries the ids of its members, and the
`detailed` filter expands every retained event.

## UI

Activity panel in `main` with a compact toolbar (search, source toggles,
attention-only, detailed), a chronological feed (oldest top, newest bottom),
auto-scroll only when already near the bottom, a new-events indicator, jump to
latest, "load older" cursor pagination, and a detail drawer with metadata,
references, provenance, and correlated events.

## Agent tools

`activity_timeline_page`, `activity_timeline_attention`,
`activity_timeline_stats`, `activity_timeline_related` — all read-only.

## Known limitations

- Session coverage is lifecycle-level (created/disposed/status/error/input);
  turn-level tool calls are not yet emitted by core, so the adapter boundary is
  ready but that source is deferred.
- The panel polls the newest page every 5s; a push/stream subscription is the
  next step (the page API is already incremental via cursor).
- Thread/workspace deep navigation is rendered as reference badges; wiring the
  existing sidebar routing into the panel is deferred.
- No Playwright journey yet; behavior is verified by host-side tests.
