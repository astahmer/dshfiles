# Add Workspace in-app folder browser

Keep the in-app folder chooser for **Add Workspace** while preserving native Finder picking for other features.

## Progress

| Milestone | Status | Evidence |
|---|---|---|
| Reproduce and choose scope | Done | Published-package scratch journeys opened the custom dialog but Host listing failed; this confirms the old native-only capability cannot serve the in-app browser. Scope remains Add Workspace only. |
| Add a hybrid Host capability | Done | Host/API and Loader-composition regressions pass; focused Host typecheck plus canonical Host/Client/Web builds pass. Three changed Core README translation pairs pass scoped verification. The default `auto` path remains unchanged. |
| Wire the owned plugin and web seed | Done | Plugin patch opts into `backend: hybrid`; README documents preserved native picking. Plugin typecheck/build/import pass; Vitest has no unit tests. Workspace `contract` passed; broad plugin build remains blocked by an unrelated missing vendored `@deepseek-ai/dsh-session-format-catalog` artifact in `@dshfiles/dsh-core-runtime`. |
| Verify isolated composition and browser journeys | In progress | Published-package journeys reach Add Workspace but the Host list request fails (`This folder could not be opened`) because rc.2 lacks the hybrid capability. Full local-Core scratch returns HTTP 200 but client boot fails on missing `@deepseek-ai/dsh-session/surface`; 27 dependent client entries remain pending. Core Web E2E cannot start: missing `native/system/.../system.node` and Session Controller import. No live profile was touched. |
| Promote and report restart boundary | Pending | Do not sync or restart the live profile; Core Host/profile composition changes require a user-controlled restart. |

## Decisions

- Preserve the default `auto` behavior for profiles that do not opt in.
- Add an explicit `hybrid` interaction: native `pick` plus bounded, validated browse `list/createDirectory` on native-capable hosts; fall back to browse-only where native picking is unavailable.
- Only the owned workspace-folder-picker profile patch opts into `hybrid`; its custom UI stays scoped to Add Workspace slots.
- Do not modify the live DSH process or installed profile during the experiment.

## Workspace handoff

- DSH Files workspace: `workspace-folder-picker-browser-latest`, `/Users/astahmer/dev/dshfiles-workspace-folder-picker-browser-latest`; feature revision `22ba671a` is based on `integration-spine`/`main` at `abcf899c`.
- DSH Core workspace: `workspace-directory-browser`, `/Users/astahmer/dev/dsh-core-directory-browser-scope`; hybrid-picker revision `e6ea3062` is based on `202ccfee`.
- The earlier DSH Files workspace `workspace-folder-picker-browser-clean` remains preserved and untouched. The separate Core `directory-picker-config` workspace also remains untouched.
- Do not edit the default DSH Files workspace, sync the live profile, or restart the live DSH process.

## Resume here

Close out focused Core/plugin checks and the path-scope security review, then split only owned JJ paths. Browser acceptance remains open: the published runtime lacks this unshipped hybrid contract, while the scratch source runtime has unrelated Client module and native-binding failures. Re-run the two Add Workspace journeys plus create/select/registration after a package-coherent Core runtime is available; do not promote or restart live DSH.
