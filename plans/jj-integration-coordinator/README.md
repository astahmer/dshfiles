# Jujutsu workspace lifecycle + integration coordinator

Implementation of the ADE integration coordinator: independent agent workspaces
feed a durable, serialized integration queue that advances one canonical jj
bookmark. The plugin is `@dshfiles/jj-integration`; durable behavior lives in
its [README](../../plugins/@dshfiles/jj-integration/README.md).

## Progress

| Slice | State | Evidence |
| --- | --- | --- |
| Recon: jj plugin, workspace provisioning, session/communication surface | complete | `plugins/@dshfiles/jujutsu` (subprocess + workspace provisioner), agent-communication, core session tools |
| Verify jj 0.45 primitives for non-rewriting integration | complete | `jj duplicate --onto` + `--ignore-working-copy`; source workspace `@` unchanged; conflict template + `jj resolve --list` |
| Coordinator plugin (state, queue, lock, events) | complete | `plugins/@dshfiles/jj-integration/src/service.ts` |
| Agent tools + browser API + panel | complete | `src/host.ts`, `src/api.ts`, `src/panel.tsx` |
| Real-jj integration tests | complete | 13 tests in `src/jj.integration.test.ts`, all passing |
| Scratch-profile browser journey | not attempted | Panel is built and host bundle imports; no profile composition or Playwright scenario yet |
| Live profile promotion | deliberately not done | Nothing added to `profiles/web`; promotion is the user's decision |

## Architecture decisions

- **New plugin, not an extension of `jujutsu`.** `jujutsu` owns the revision
  graph and human Source Control actions; the coordinator has a different
  lifecycle (durable queue, single writer, events). A new bundle keeps the
  graph UI stable and the coordinator independently testable. The jj runner is
  a compact fixed-argv wrapper over the same DSH subprocess service rather than
  a second registry of repositories.
- **Canonical target is a jj bookmark** (default `integration-spine`), the
  repository's existing convention. A coordinator-owned workspace was rejected
  because it would add a permanent slot and make "accepted state" a working-copy
  fact; a bookmark is the native pointer and is never inferred from activity.
- **`jj duplicate --onto`, not `jj rebase` on the source.** Rebasing the source
  change rewrites the object every workspace shares, which would modify the
  agent's active workspace. Duplicating first and rebasing the copy keeps the
  source revision byte-identical (verified in tests).
- **Single writer**: in-process mutation queue + pid-checked lock file. The
  second coordinator process is refused with `integration-busy` rather than
  racing the bookmark.
- **Separate dimensions**: workspace lifecycle and candidate integration state
  are distinct fields; readiness is explicit and never inferred from `idle`.
- **No new infrastructure**: state is private JSON under `$DSH_HOME`, written
  atomically; no Redis/Postgres, no event bus (events are a bounded in-state
  log shaped for the future activity timeline).

## Verified jj behavior (jj 0.45.1)

- `jj duplicate <src> --onto <target> --ignore-working-copy` reports the new
  change and leaves the source workspace `@` unchanged.
- A conflicting duplicate is flagged `conflict=true`; `jj resolve --list -r`
  names the files; the bookmark does not move.
- Ancestry (`<rev> & ::<bookmark>`) distinguishes already-integrated work.
- A source revision that changed after queueing is detectable by comparing the
  recorded immutable commit id with the workspace's current `@`.

## Evidence

```sh
# scratch workspace, plugin @dshfiles/jj-integration
pnpm test        # 13 real-jj tests
pnpm typecheck   # passes
dshx build       # host + client bundles; host bundle imports
node scripts/check-workspace-contract.ts   # passes (plugins workspace)
```

Scenario coverage: sequential integration, older canonical base, overlapping
clean merge, conflict blocked with spine unchanged and source workspace
unchanged, stale source, already-integrated, failed validation with unchanged
spine, concurrent requests serialized, explicit dependency ordering, restart
recovery, missing workspace, second-process lock refusal.

## Known limitations and next steps

- One source revision per candidate; a multi-commit stack is not duplicated as
  a unit.
- Conflict resolution is manual (fix the source workspace, then retry);
  delegating resolution to a new Session is intentionally not implemented here
  and should use the opt-in `@deepseek-ai/dsh-tool-session-query` tools.
- The overlap preview is a file-level heuristic, not a merge prediction.
- No Playwright journey; compose the plugin in a scratch profile and add an E2E
  scenario before promoting it to `web`.
- Automatic queueing/advancing is configuration-gated and off by default;
  start manual and enable automation deliberately.
