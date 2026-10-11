# Settings Search native Editor owner

| Milestone | Status | Evidence |
|---|---|---|
| Verify live Web contract and Editor setting | complete | Live inspection shows the old row contract; `openFileLinks` has no owner route. |
| Prepare isolated source workspaces | complete | Recovery DSHFiles workspace `settings-editor-owner-route-recovery` at `b949d842`; core integration at `f273d622`; active defaults preserved. |
| Integrate core native-target API for validation | in progress | Core route `d6713de6` duplicated as `2f7232c3`; Host TypeScript declaration build passed, client library build is being retried with those generated declarations. |
| Add native Editor setting row and owner route | in progress | Localized General row, optional core target registration, exact field matcher, cache sync, feature catalog, route unit test, and composed browser journey added; execution pending. |
| Build and exercise in scratch Web runtime | pending | — |
| Promote Web profile if runtime can use it | pending | No profile changes; live Web does not yet expose the owner-target contract. |

## Resume here

Run focused Editor tests and typecheck against the integrated core types, finish the core client build/tests, then verify the composed Web runtime in scratch. The prior workspace `/Users/astahmer/dev/dshfiles-settings-editor-owner-route` remains preserved on a conflicted `integration-spine` parent; do not resolve its `thread-sidebar` conflict or touch dirty default workspaces. Never restart live Web or promote while it lacks native-target support.
