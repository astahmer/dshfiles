# Settings Search native Editor owner

| Milestone | Status | Evidence |
|---|---|---|
| Verify live Web contract and Editor setting | complete | Live inspection shows the old row contract; `openFileLinks` has no owner route. |
| Prepare isolated source workspaces | complete | Recovery DSHFiles workspace `settings-editor-owner-route-recovery` at `b949d842`; core integration at `f273d622`; active defaults preserved. |
| Integrate core native-target API for validation | in progress | Core route `d6713de6` duplicated as `2f7232c3`; client library build stopped on missing generated API declarations before compiling its full graph. |
| Add native Editor setting row and owner route | pending | Reapplying in the clean workspace after a conflicting JJ refresh dropped the prior uncommitted edits. |
| Build and exercise in scratch Web runtime | pending | — |
| Promote Web profile if runtime can use it | pending | No profile changes; live Web does not yet expose the owner-target contract. |

## Resume here

Implement the `dshfiles-editor/openFileLinks` General-row owner in `/Users/astahmer/dev/dshfiles-settings-editor-owner-route-recovery`, then build the core client libraries with their required host-generated API declarations and validate the scratch runtime. The prior workspace `/Users/astahmer/dev/dshfiles-settings-editor-owner-route` remains preserved on a conflicted `integration-spine` parent; do not resolve its `thread-sidebar` conflict or touch dirty default workspaces. Never restart live Web.
