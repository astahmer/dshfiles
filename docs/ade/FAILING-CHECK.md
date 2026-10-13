# Failing check — registration does not reach the registry

Spine `f4940bb2`. Isolated RC runtime. Live Host untouched.

## The failing assertion

After a run of `scripts/release/rc-verify.mjs`, the scratch home's persisted
registry is `storages/workspace.json`. It contains **three** records:

| path                                      | title       | sessionIds |
| ----------------------------------------- | ----------- | ---------- |
| `<home>/project`                          | `project`   | **`[]`**   |
| `<home>/project-threads/project-68c6675b` | probe title | —          |
| `<home>/project-threads/project-ed75c4d6` | probe title | —          |

The two provisioned-directory records carry **exactly the ids my probe's
`workspace/create` calls returned** (`8818c858…`, `932dff06…`). So they were
created by the probe, **not by the resolver**.

Two assertions therefore fail:

1. **No record exists for the provisioned directories at the moment the Session
   is created.** Registration did not take effect.
2. **`sessionIds` is empty on every record** — including `project`. No Session is
   attached to anything, so nothing is discoverable through a workspace.

## What is ruled out

- The built artifact **does** carry the code: `registerWorkspace` appears 6 times
  and `workspaceRegistry` once in `plugins/@dshfiles/jj-integration/dist/index.js`.
- The scratch profile **does** load that artifact: its
  `node_modules/@dshfiles/jj-integration` symlinks to the release-candidate
  workspace.
- Provisioning **does** run: two distinct jj workspaces are created
  (`project-68c6675b`, `project-ed75c4d6`) and `session/create` returns
  `ok: true` for both.
- The controller patch **does** load: the same call against the unpatched runtime
  returns `ok: false` with `session/workspace-attach-failed`.

## The contradiction to resolve

`registerWorkspace` throws when `workspaceRegistry` is absent, and the resolver
no longer swallows that failure — so a missing service should make
`session/create` fail. It returns `ok: true` instead, and no record appears.

So one of these is true, and the next run must print which:

1. `context.get('workspaceRegistry')` returns `undefined` under a different
   service name, the throw propagates, and the session controller **catches
   resolver failures and falls back** to the requested cwd — which would explain
   `ok: true`, an empty `sessionIds`, and provisioned directories that exist but
   are unused.
2. `registerWorkspace` is not invoked at all, because the resolver that serves
   these sessions is not the one this code constructs.

## Next action — one instrumented run

Add a temporary `context.logger.info` (or `console.error`) inside
`registerWorkspace` and inside the resolver immediately after provisioning,
printing: whether the registry was found, the resolved path, and the outcome.
Re-run `scripts/release/rc-verify.mjs` and read the Host log. That distinguishes
the two cases above in a single run.

If case 1 holds, the fix is the service lookup (find the real name the deployed
generation exposes) plus making the fallback impossible: a resolver failure must
refuse the Session, never quietly place it in the shared checkout.
