# Settings Search native Editor owner

| Milestone | Status | Evidence |
|---|---|---|
| Verify live Web contract and Editor setting | complete | Live inspection shows the old row contract; `openFileLinks` has no owner route. |
| Prepare isolated source workspaces | complete | Recovery DSHFiles workspace `settings-editor-owner-route-recovery` at `b949d842`; core integration at `f273d622`; active defaults preserved. |
| Integrate core native-target API for validation | in progress | Core route `2f7232c3`; targeted Host checks and 48 route tests passed, but Core client build still fails in TSDOWN on an unrelated `dsh-client-ui-chat/client` external declaration. |
| Add native Editor setting row and owner route | source complete; runtime unverified | General-row Switch, optional native route, exact field matcher, save/cache sync, unit regression test, and E2E scenario are present; 28 Editor tests passed. Client-entry typecheck/build and Host import passed with a temporary focused tsconfig, then that config was restored. Full typecheck still fails because DSHX Client `ISessions` augmentation hides Host `SessionStore.get` in `src/host.ts`. |
| Catalog and plugin-ui rebuild gates | in progress | Editor catalog boolean default is corrected and its new scenario is no longer orphaned. `features:check` still reports 81 repo-wide issues, including five stale Editor scenario references. Rebuild passed for 14/21 UI consumers; seven unrelated packages failed on missing artifacts or existing type errors. |
| Build and exercise in scratch Web runtime | pending | No compatible Core Client bundle or browser journey yet; do not treat bundle import as runtime proof. |
| Promote Web profile if runtime can use it | deferred | No profile changes. Live Web still lacks the owner-target contract; promotion is unsafe until scratch behavior is proven. |

## Resume here

Resolve the Core Client build and DSHX Host/Client Context type collision, then rebuild all UI consumers and run the native-row browser journey on an isolated scratch runtime. The prior workspace `/Users/astahmer/dev/dshfiles-settings-editor-owner-route` remains preserved on a conflicted `integration-spine` parent; do not resolve its `thread-sidebar` conflict or touch dirty default workspaces. Never restart live Web or promote while it lacks native-target support.
