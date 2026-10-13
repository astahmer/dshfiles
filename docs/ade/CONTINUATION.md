# Continuation checkpoint — release candidate

Spine `17700f98`. Live `:3080` untouched. OptMem full mode disabled. pnpm
consolidation separate.

## Done and verified

- **Isolated RC runtime**: `/private/tmp/dsh-rc-runtime`, an APFS clone of the
  install with the controller patched in place. The live install is untouched.
  Delivery mechanism proven: in-box bundles resolve installation-first, so the
  fix cannot come from a profile.
- **Attach fix**: `commands.ts` create + fork attach the workspace owning the
  **resolved** directory.
- **Before/after**: unpatched → `ok: false` + `session/workspace-attach-failed`;
  patched → `ok: true`, two distinct provisioned workspaces, resume reuses.
- **Registration implemented** (this revision): the resolver registers the
  provisioned directory via `workspaceRegistry.create`, idempotently, before the
  Session attaches, so the native contract is satisfied without relaxing
  `WorkspaceEntity`.

## Immediate next step — one command each

```sh
# 1. Rebuild the plugin in the RC workspace, then run the gate.
cd /Users/astahmer/dev/dshfiles-release-candidate
fnm exec --using=22.23.3 pnpm --dir plugins/@dshfiles/jj-integration build
node scripts/release/rc-verify.mjs            # extend it to assert the workspace list first

# 2. Playwright smoke against the isolated runtime (Playwright is installed in
#    tooling/dshx; see tooling/dshx/e2e and playwright.e2e.config.ts).
```

**The gate to add to `rc-verify.mjs`**: after `session/create`, call
`workspace/list` — no, that 404s; instead assert through the registry by
re-running `workspace/create` for the same path and confirming it returns the
**same** workspace id (proves idempotent registration), and assert the session
appears in that workspace's `sessionIds`.

## Known environment gap

`pnpm --dir plugins/@dshfiles/jj-integration typecheck` in the RC workspace
reports `{}`-typed errors in `panel.tsx` and `workspace-chip.tsx` — a
toolchain/dependency-resolution gap in that fresh workspace, **not** from this
change. Build and verify in a workspace with the toolchain set up (for example
`dshfiles-core-narrow`), or install the RC workspace's `tooling/dshx` first.

## Remaining gates (unchanged from the handoff)

1. Browser journeys against the RC runtime: create from project → appears under
   the project in our **existing** sidebar → real agent response → second thread
   → switch → refresh → resume → composer/panel/timeline/settings → multi-tab SSE.
2. LKG rollback drill against a deliberately broken disposable deployment.
3. Fresh-checkout build, typecheck, combined tests, real-jj regressions.
4. `default` workspace sync (section 4 of the handoff) — investigate its state and
   the jj guards; relocate only when idle, clean and free of unique work, or
   report the exact blocker and expose a pending-sync state. Add the folded-default
   regression test.
5. Freeze the production upgrade and rollback commands.

## Explicitly not done

- No Playwright run, no real agent request, no multi-tab test, no LKG rollback
  drill, no fresh-checkout re-verification. All UNVERIFIED.
- The existing sidebar has not been inspected for its project/thread model — that
  is the first thing to read before touching grouping.
