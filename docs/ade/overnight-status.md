# Overnight autonomous run — status

Canonical spine: `main` = `integration-spine` = `7ea06a0b`. Linear, no conflicts.
Live `:3080` untouched throughout (pid 73645). No `nixapply`. Cleanup still
`dryRun: true`. LKG store intact and independent.

## Verified this run

| Area                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADE provisioning + resume** | `scripts/ade-scratch-verify.mjs` boots a real Host in a scratch home and drives it through the authenticated API. Two sessions produced two **distinct** provisioned jj workspaces (`project-70261f53`, `project-75022ece`); resuming a thread kept its workspace rather than creating another; zero activation failures. Ground truth is `jj workspace list`, not the plugin's own report. |
| **LKG promotion gate**        | Strengthened from 3 checks to 5. `verify current` passes: node, activation, authenticated-index 303, **session-api 200**, and a thread **created then loaded**.                                                                                                                                                                                                                             |
| **LKG recovery**              | `dsh-recover` boots from the store alone, issues a cookie, answers `session/list` 200, creates a session; live `~/.dsh/sessions` untouched.                                                                                                                                                                                                                                                 |
| **Combined regression**       | jj-integration 90/90, optmem 56/56, optmem-core, optmem-sqlite, plugin-ui — all green **in the combined run that previously reproduced both flakes**.                                                                                                                                                                                                                                       |
| **Flake fixes**               | See below.                                                                                                                                                                                                                                                                                                                                                                                  |

## Flakes fixed (both were real defects, not noise)

1. **jj-integration** — `integrates two independent workspaces sequentially` was
   failing with `Test timed out in 5000ms`. The test adds two workspaces,
   commits, submits and runs two full integrations against real `jj` processes;
   5s is a timeout, not a failure signal. Added `vitest.config.ts` with a
   timeout suited to real `jj`.
2. **optmem** — `resolves workspace and historical path identities` failed under
   load because `settle()` awaited a single flush. `scheduleFlush` is a no-op
   while a flush is in flight or before the runtime is ready, so an event queued
   by the caller could land after the awaited flush took its batch. `settle` now
   drains until the queue is empty and nothing is scheduled.

## LKG defects fixed

- The verify and recovery states **inherited the snapshot's `uchg` flags**, so
  the Host could not maintain its own profile and the state could not be removed
  (`EPERM` on unlink). Both now thaw the cloned profile; the snapshot payload
  stays frozen.
- The `session-api` check initially failed because the RPC envelope is
  `{ result: { ok, value } }`; parsing now unwraps it.

## BLOCKED — OptMem full mode (the one substantive blocker)

The narrow two-row agent swap is implemented and **activates cleanly** in a
scratch Host (no `did not activate`), with the fork markers present in `dist`.
Session creation then fails:

```
DshPlatformError: failed to create session "...":
  Error: Agent preset binding requires a scoped context
```

`@deepseek-ai/dsh-agent-preset-registry`'s `bind(ctx, generation)` calls
`scopeOf(ctx)` (from `dsh-scope`) and throws when the context is unscoped.

Measured this run:

- Both the published and the fork agent loop call `createScope(loopCtx, this)`
  **identically**, so the scope creation itself is not the difference.
- The **full five-row bridge is worse**: it fails earlier with
  `HTTP 404 for session/create` — the route does not exist at all. So the narrow
  swap is the right approach and the bridge is not a fallback.
- The loop cannot be swapped alone: it imports **30 names** from the fork agent,
  **19 absent** from the published one, including two runtime values.

**Next recommended action:** instrument `@deepseek-ai/dsh-agent-preset-registry`'s
`bind` call site to print the calling context's scope chain (who calls `bind`,
and with which fiber), then compare that call against the same call under the
published agent. The fork agent is a different development generation from the
deployed preset stack; the fix is either to give the fork agent the scope the
preset stack expects, or to upstream the `agent/request-messages` waterfall so
no swap is needed.

## RELEASE BLOCKER — thread creation from a project (root-caused, fix landed in source)

**Symptom** (live UI): `New session failed: session/workspace-attach-failed ...
cannot attach session to workspace '/Users/astahmer/dev/dshfiles': its cwd
resolves to '/Users/astahmer/dev/dshfiles-threads/dshfiles-707ac8ac'`.

**Root cause, by file and line.** `session.create` resolves the Session's
directory through the awaited resolver and _then_ attaches it to the workspace
the caller named:

```js
const cwd = await resolveSessionWorkspaceCwd(this.ctx, { sessionId, requestedCwd: workspace?.path ?? ... })
...
if (workspace !== undefined) await workspace.attachSession(sessionId)
```

`@deepseek-ai/dsh-workspace`'s `WorkspaceEntity.attachSession` validates
`cwd === this.record.path` (`lib/index.js:122`) and throws otherwise. The
resolver deliberately places the Session in its own provisioned directory, so
the attach targets a workspace that by construction does not own that cwd.

This is why the earlier scratch verification passed while the UI failed: the
verification created sessions **without** a `workspaceId`, so `workspace` was
`undefined` and the attach never ran. The UI always passes the project.

**The intended contract.** `workspace-resolution.ts` states the resolver decides
"the directory the Session actually owns" and runs "before the Agent exists, so
the first tool call already executes inside the resolved directory". The attach
step is therefore the layer at fault, not the resolver.

**Fix landed** in `tooling/dsh-core/api-session-controller/src/commands.ts`
(both `create` and `fork`): attach the workspace that owns the **resolved**
directory, resolving it through `workspaceRegistry.resolveByPath(cwd)`, and
attach none when the resolved directory is not a registered workspace. Creation
no longer fails for a Session the deployment deliberately placed elsewhere;
ownership and isolation are unchanged.

**Deployment is blocked by two constraints, both deliberate:**

1. The live Host loads the controller from the **global install**, built from
   the canonical ADE checkout — whose working copy carries **uncommitted foreign
   changes** in `commands.ts` and `index.ts`. I did not touch it.
2. Making the fix live needs a Host restart, which is excluded.

So the fix is in the repo's source of truth and needs the canonical checkout to
carry the same change, a rebuild, and a user-controlled restart.

**Still to do on this blocker:** find the correct RPC for a workspace id in the
scratch Host so `scripts/ade-scratch-verify.mjs` exercises the attach path (it
now sends `workspaceId` when one resolves), then confirm creation succeeds with
the patched controller linked into the scratch profile.

## NOT verified

- **Browser acceptance** for the composer control, integration panel, settings
  persistence, activity timeline, and the Cleanup tab. Not run — no browser
  session this run.
- **Cleanup UI and accelerated sweep** — the eligibility rules are covered by
  unit and real-jj tests (including dry-run and pin), but the panel and a
  shortened-interval sweep were not exercised in a browser.
- **`profiles/web` profile:sync into `~/.dsh`** and a boot from it.
- **The pnpm consolidation** is in its own workspace (`c179411a`), still off the
  spine as instructed, with `thread-sidebar` as its one failing package.

## Promotion readiness

Not ready. Two gates remain: OptMem full mode (blocked above) and browser
acceptance. The spine is consistent and every suite that runs is green; the
rollback path is the LKG snapshot store, whose current version passes the
strengthened gate.
