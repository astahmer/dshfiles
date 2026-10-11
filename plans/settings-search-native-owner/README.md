# Settings Search native Editor owner

| Milestone | Status | Evidence |
|---|---|---|
| Verify live Web contract and Editor setting | complete | Live inspection shows the old row contract; `openFileLinks` has no owner route. |
| Prepare isolated source workspaces | complete | DSHFiles base `b949d842`; core integration base `f273d622`; active default worktrees preserved. |
| Integrate core native-target API for validation | in progress | Core `d6713de6` duplicated as `2f7232c3` in `settings-native-integration`; no conflicts reported. |
| Add native Editor setting row and owner route | pending | — |
| Build and exercise in scratch Web runtime | pending | — |
| Promote Web profile if runtime can use it | pending | No profile changes yet. |

## Resume here

Implement the `dshfiles-editor/openFileLinks` General-row owner in the named DSHFiles workspace, then validate it against the isolated core integration workspace. Do not touch the dirty DSHFiles default `@`, the dirty DSH-core default `@`, or the live Web process. The DSHFiles `integration-spine` bookmark currently has conflicting targets; leave it unchanged.
