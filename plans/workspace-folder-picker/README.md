# Add Workspace in-app folder browser

Keep the in-app folder chooser for **Add Workspace** while preserving native Finder picking for other features.

## Progress

| Milestone | Status | Evidence |
|---|---|---|
| Reproduce and choose scope | Done | Header and sidebar scratch journeys opened the custom dialog; Host listing failed on macOS native backend. Scope is Add Workspace only. |
| Add a hybrid Host capability | In progress | Compose native `pick` with bounded browse `list/createDirectory`; add Host/API and real Loader-composition regression tests. |
| Wire the owned plugin and web seed | Pending | Opt this plugin into `backend: hybrid`; preserve the default auto mode and include the plugin only after core behavior passes. |
| Verify isolated composition and browser journeys | Pending | Run both focused journeys against local Core packages and a disposable DSH home. |
| Promote and report restart boundary | Pending | No live server restart; Host/profile composition changes require a user-controlled restart. |

## Decisions

- Preserve the default `auto` behavior for profiles that do not opt in.
- Add an explicit `hybrid` interaction: native `pick` plus bounded, validated browse `list/createDirectory` on native-capable hosts; fall back to browse-only where native picking is unavailable.
- Only the owned workspace-folder-picker profile patch opts into `hybrid`; its custom UI stays scoped to Add Workspace slots.
- Do not modify the live DSH process or installed profile during the experiment.

## Workspace handoff

- DSH Files thread: `session-639492a5-cb11-4bb2-ad3f-f55a4d7a0aca`
- DSH Files workspace: `workspace-folder-picker-browser-clean`, `/Users/astahmer/dev/dshfiles-workspace-folder-picker-browser-clean`; base `d475f6da36e8ede31e60d0cd541dd1a550e26e47`.
- DSH Core workspace: `workspace-directory-browser`, `/Users/astahmer/dev/dsh-core-directory-browser-scope`; base `202ccfee2205a18f30d65f2bb4e46eb2fe5a8180`.
- The default DSH Files workspace has unresolved shared conflicts and an unrelated lockfile edit; it remains untouched. An accidental empty workspace on that conflicted base was forgotten; its directory was preserved. Use only the clean workspace above.
- The separate `directory-picker-config` DSH Core workspace remains untouched.

## Resume here

Implement the hybrid capability provider and opt-in Auto composition in `workspace-directory-browser`; test native/browse dispatch and real Loader composition before changing the plugin seed.
