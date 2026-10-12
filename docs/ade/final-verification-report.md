# Final verification report — adversarial end-to-end pass

Canonical spine: `main` = `integration-spine` = `68689bc3`. Linear, no conflicts.
Live `:3080` untouched throughout. No `nixapply`. Cleanup still `dryRun: true`.
LKG store not mutated.

## Recommendation

**NOT READY.**

Two release-blocking gaps, both stated with evidence below:

1. **Thread creation from a project is broken in the deployed runtime.** Root
   cause found and fixed in source, but the fix is not deployed and the attach
   path could not be exercised end-to-end in this pass.
2. **No browser journey was run at all.** Every UI-level item is UNVERIFIED.

## Final canonical revision

`68689bc3` — 20 commits linear from `494d7ce1`, no conflicts. Revisions added
during the overnight runs: settings migration and panel/composer UX, the
cross-workspace write guard, LKG snapshots and recovery, OptMem provider
routing, workspace cleanup, the dependency-hygiene migration, the narrow agent
runtime bundle, the importer root-cause record, two flake fixes, the ADE
provisioning/resume acceptance test, and the workspace-attach fix.

## Features implemented and activated

| Feature                                            | State                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| ADE per-thread jj workspace provisioning           | **Activated**, verified end-to-end in a scratch Host               |
| Session resume reusing its workspace               | **Activated**, verified                                            |
| Workspace cleanup eligibility, dry-run, pinning    | **Activated** (`dryRun: true`), verified by unit and real-jj tests |
| LKG snapshots + `dsh-recover`                      | **Activated**, verified independently                              |
| OptMem provider routing, quarantine, usage capture | **Activated**, verified by tests                                   |
| OptMem full mode                                   | **NOT ACTIVATED** — fork agent blocked (see below)                 |
| Narrow agent runtime bundle                        | **Implemented, activates, then blocks at session creation**        |
| Workspace-attach fix                               | **In source, NOT deployed**                                        |

## Tests executed and exact results

| Suite                                    | Result        |
| ---------------------------------------- | ------------- |
| jj-integration (unit + real jj)          | **90/90**     |
| optmem                                   | **56/56**     |
| optmem-core                              | pass          |
| optmem-sqlite                            | pass          |
| plugin-ui                                | pass          |
| dsh-lkg tool tests                       | **3/3**       |
| dsh-core-agent-loop patch-scope          | **4/4**       |
| Combined run (all of the above together) | **all green** |

Two flakes were root-caused and fixed rather than retried: a 5s vitest timeout on
tests that run two full real-`jj` integrations, and an OptMem `settle()` that
awaited one flush when `scheduleFlush` is a no-op while a flush is in flight.

## Browser scenarios actually exercised

**None.** No browser session was run in any overnight pass. Therefore every
UI-level acceptance item — composer control, integration panel, settings
persistence, activity timeline, sidebar, thread visibility, multi-tab shared
streams, Cleanup tab, and the step-1..15 user journey — is **UNVERIFIED**.

## Evidence for workspace isolation and integration correctness

- `scripts/ade-scratch-verify.mjs` boots a real Host in a disposable scratch home
  and drives the authenticated API. Ground truth is the repository itself:
  two sessions produced two **distinct** provisioned workspaces
  (`project-70261f53`, `project-75022ece`); resuming a thread kept its workspace;
  zero activation failures.
- Ownership, leases, fencing, observers and serialized integration are covered by
  the 90 real-jj jj-integration tests.
- Resolution audit: 85 internal dependencies resolve inside this checkout — none
  to a published copy, none to another checkout.
- **Isolation disabled** and **integration disabled** were NOT exercised
  end-to-end. UNVERIFIED.

## Evidence for OptMem full-mode injection

**UNVERIFIED — the feature is not activated.** Capability detection correctly
reports it as unsupported. The narrow two-row swap activates cleanly with the
fork markers in `dist`, then session creation fails with `Agent preset binding
requires a scoped context` from `dsh-agent-preset-registry`. Measured: both the
published and fork loops call `createScope(loopCtx, this)` identically; the
five-row bridge is _worse_ (it 404s `session/create`); the loop cannot be swapped
alone because 19 of the 30 names it imports from the fork agent are absent from
the published one.

## Evidence for LKG recovery

- `verify current` passes all five checks: node, activation, authenticated index
  303, **`session-api` 200**, and a thread **created then loaded**.
- `dsh-recover` boots from the store alone, issues a cookie, answers
  `session/list` 200, creates a session; live `~/.dsh/sessions` untouched.
- Fixed a real defect: verify and recovery states inherited the snapshot's `uchg`
  flags, so the Host could not maintain its profile and the state could not be
  removed (`EPERM`).
- **Recovery after a deliberately broken scratch deployment** was NOT run.
  UNVERIFIED.

## The release blocker, precisely

`session.create` resolves the Session's directory through the awaited resolver
and _then_ attaches it to the workspace the caller named.
`WorkspaceEntity.attachSession` validates `cwd === record.path`
(`@deepseek-ai/dsh-workspace` `lib/index.js:122`) and throws otherwise. The
resolver deliberately places the Session in its own provisioned directory, so the
attach targets a workspace that by construction cannot own that cwd.

Fixed in `tooling/dsh-core/api-session-controller/src/commands.ts` (`create` and
`fork`): attach the workspace owning the **resolved** directory via
`workspaceRegistry.resolveByPath(cwd)`, and attach none when that directory is not
a registered workspace.

**Why it is not verified:** exercising the path needs a `workspaceId`, and no RPC
that lists workspaces was found (`workspace/list` returns 404). A harness was
built that patches a **copy** of the deployed controller with the fix and links it
into a scratch profile — it confirms the patched controller activates and that
sessions create with provisioning (`project-82a41b1e`), but without a
`workspaceId` the attach still never runs. That is the exact false-positive the
handoff warns about: _"Sessions are created, but cannot attach to workspaces."_

**Why it is not deployed:** the live Host loads the controller from the global
install, built from the canonical ADE checkout whose working copy carries
**uncommitted foreign changes** in `commands.ts` and `index.ts`. I did not touch
it. Making the fix live also needs a restart, which is excluded.

## Remaining failures and limitations

- Thread creation from a project: **broken in the deployed runtime**; fix in
  source only.
- OptMem full mode: **blocked**.
- `thread-sidebar` does not build under the consolidated pnpm workspace (22 type
  errors); that migration stays in its own workspace, off the spine.
- No browser verification of anything.
- The failure matrix (concurrent creation, duplicate provisioning, interrupted
  `jj workspace add`, stale mappings, moved directories, dirty workspaces,
  concurrent integration, cleanup against attached/leased/unique workspaces,
  reload while streaming, multi-tab) is **entirely UNVERIFIED**.
- Fresh-checkout re-verification of the final revision was NOT run.

## Production deployment and rollback procedure

Deployment is **not authorised** at this revision.

Rollback path: the LKG store. `dsh-recover` starts the last known-good snapshot
independently on port 3099 with its own state; the current snapshot passes the
strengthened five-check gate. Take a fresh snapshot before any promotion
(`dsh-lkg snapshot`), keep `dsh-recover` on PATH, and promote only after the
candidate passes its gate.

## Explicit verdict

**NOT READY.** A user-visible release blocker is fixed in source but neither
verified end-to-end nor deployed, and no browser acceptance was performed. The
honest next step is to find the workspace-listing RPC, confirm the attach path
with the patched controller, then port the same change to the canonical checkout
and re-run the full journey in a browser.
