# DSH Jujutsu integration coordinator

Owned DSH bundle that turns many independent jj workspaces into one coordinated
development environment. Each Agent keeps its own workspace; the coordinator
serializes completed work into one canonical bookmark.

## Architecture

```
independent agent workspaces ──► durable integration queue ──► canonical bookmark
        (jj workspace add)          (this plugin, single writer)     (integration-spine)
```

- **Workspace identity** is coordinator-owned and distinct from the Session id,
  Agent id, filesystem path, communication `workspace/<hash>` topic, and jj
  change/commit ids. One workspace can have several owning Sessions over time.
- **Canonical target** is an existing jj bookmark (default `integration-spine`).
  It is read explicitly and never inferred from recent activity.
- **Integration** uses `jj duplicate <source> --onto <target>`: the source
  revision is never rewritten, so the agent's workspace is untouched.
- **Single writer**: an in-process mutation queue plus a token-checked lock file
  in the Jujutsu **store** (`<store>/.dshfiles-jj-integration.lock`, where the
  store is what `<workspace>/.jj/repo` names). Two coordinators sharing one store
  are mutually exclusive whatever `DSH_HOME` each was started with; a lock left by
  a dead pid or older than ten minutes is reclaimed, and a process only releases a
  lock whose on-disk token is still its own. A second coordinator is refused with
  `integration-busy`.
- **Crash-safe staging, no leaked duplicates**: the staging workspace is
  journalled in the store before `jj workspace add`, so a crash between create and
  cleanup is reaped on the next run (`integration.staging_reaped`). The canonical
  bookmark is re-read before it advances and the run is refused with
  `spine-moved` if another writer moved it, and a duplicate created for a run that
  then fails is abandoned, with `duplicateAbandoned` / `leakedRevision` recorded
  on the attempt.

## State model

Workspace lifecycle (`created`, `active`, `idle`, `ready`, `integrating`,
`integrated`, `blocked`, `abandoned`, `archived`, `missing`) is a separate
dimension from candidate integration state (`queued`, `running`, `blocked`,
`failed`, `integrated`, `already-integrated`, `stale`, `cancelled`). Readiness
is explicit; an idle or absent Session never implies completion or readiness.

A candidate records the source workspace, source Session, immutable source
change/commit ids, the spine at submit time, explicit dependencies, a
correlation id, attempts, validation, conflict files, and the result revision.

## Integration algorithm

1. Resolve the candidate's source revision and refresh the canonical bookmark.
2. Reject stale candidates (source commit changed) and already-integrated work
   (source is an ancestor of the bookmark, or a recorded integration matches).
3. Refuse to run while an explicit dependency is not integrated.
4. `jj duplicate <source> --onto <target>` with `--ignore-working-copy`.
5. If jj reports a conflict, record `jj resolve --list` files and block; the
   bookmark does not move.
6. If a validation command is configured, run it in an ephemeral staging
   workspace at the duplicated revision, then forget and remove the staging
   workspace.
7. Only on success, `jj bookmark set <spine> -r <duplicate>` and record the
   resulting revision. Nothing is pushed, and no source workspace is modified.

## Agent tools

Read-only: `jj_workspace_list`, `jj_workspace_inspect`, `jj_integration_list`,
`jj_integration_inspect`, `jj_integration_events`.

Mutating: `jj_workspace_register`, `jj_workspace_ready`, `jj_integration_submit`,
`jj_integration_run`, `jj_integration_retry`, `jj_integration_cancel`,
`jj_integration_move`.

`jj_integration_run`, `retry`, and `cancel` require the candidate owner Session,
a configured coordinator Session, or `allowAnyAgentIntegration`. The browser API
acts as the human operator. No tool exposes arbitrary shell execution; jj runs
with fixed argv through the DSH subprocess service, and the optional validation
command is operator configuration only.

## Structured events

`workspace.created`, `workspace.attached`, `workspace.detached`,
`workspace.refreshed`, `workspace.ready`, `workspace.missing`,
`integration.queued`, `integration.started`, `integration.blocked`,
`integration.validation_failed`, `integration.completed`,
`integration.already_integrated`, `integration.stale`, `integration.cancelled`,
`integration.failed` — each with event id, timestamp, workspace/Session/candidate
ids, correlation id, and immutable revisions. Events never contain conversation
content and are bounded to 2,000 entries.

## UI

A `main` panel with **Integration queue** (primary), **Workspaces**, and
**History** tabs. The queue shows source workspace, revision, state, conflict
and validation indicators, and serialized actions; the workspaces tab shows
lifecycle, current revision, and owners.

## Configuration

`spineBookmark` (default `integration-spine`), optional `validationCommand`,
`allowAnyAgentIntegration` (default false), `coordinatorSessions`, and
`autoDiscoverWorkspaces` (default true, best-effort registration of an Agent's
working directory on `agent/created`).

## Known limitations

- One source revision per candidate; a stack of commits is not yet duplicated as
  a unit.
- The overlap preview is a file-level heuristic; only jj's duplicate result is
  authoritative.
- Conflict resolution is manual: fix the source workspace and retry. Delegation
  to a new Session is not implemented here and should use the opt-in session
  tools when they are composed.
- The panel has no Playwright journey yet; behavior is verified by the real-jj
  host tests in `src/jj.integration.test.ts`.
