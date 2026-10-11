# Add Workspace in-app folder browser

Keep the in-app folder chooser for **Add Workspace** while preserving native Finder picking for other features.

## Progress

| Milestone | Status | Evidence |
|---|---|---|
| Reproduce and choose scope | Done | Published-package scratch journeys opened the custom dialog but Host listing failed; this confirms the old native-only capability cannot serve the in-app browser. Scope remains Add Workspace only. |
| Add a hybrid Host capability | Done | Host/API and Loader-composition regressions pass; focused Host typecheck plus canonical Host/Client/Web builds pass. Three changed Core README translation pairs pass scoped verification. The default `auto` path remains unchanged. |
| Wire the owned plugin and web seed | Done | Plugin patch opts into `backend: hybrid`; README documents preserved native picking. Plugin typecheck/build/import pass; Vitest has no unit tests. Workspace `contract` passed; broad plugin build remains blocked by an unrelated missing vendored `@deepseek-ai/dsh-session-format-catalog` artifact in `@dshfiles/dsh-core-runtime`. |
| Verify isolated composition and browser journeys | In progress | Latest scratch Playwright run renders Add Workspace, but shows `Reconnecting`; the initial folder list is replaced by `This folder could not be opened`, so the expected host-home path is absent. Sanitized diagnostics captured no console/page/request-failure/HTTP-error events and no Host API log files; this does not prove whether the call reached Host. The published rc.2 runtime lacks hybrid capability. Header E2E includes temp-only browse/create/select/registration; step discovery passes. Prior local-Core boot still reported missing `@deepseek-ai/dsh-session/surface` (27 entries pending) and Core Web E2E lacked `native/system/.../system.node` plus a Session Controller import. No live profile was touched. |
| Promote and report restart boundary | Pending | Do not sync or restart the live profile; Core Host/profile composition changes require a user-controlled restart. |

## Decisions

- Preserve the default `auto` behavior for profiles that do not opt in.
- Add an explicit `hybrid` interaction: native `pick` plus bounded, validated browse `list/createDirectory` on native-capable hosts; fall back to browse-only where native picking is unavailable.
- Only the owned workspace-folder-picker profile patch opts into `hybrid`; its custom UI stays scoped to Add Workspace slots.
- Do not modify the live DSH process or installed profile during the experiment.
- Hybrid reuses Browse's existing host-filesystem scope; path validation does not add a workspace-root authorization boundary. This broader browse capability stays opt-in in the plugin profile.

## Workspace handoff

- DSH Files workspace: `workspace-folder-picker-browser-latest`, `/Users/astahmer/dev/dshfiles-workspace-folder-picker-browser-latest`; feature revision `22ba671a` is based on `integration-spine`/`main` at `abcf899c`.
- DSH Core workspace: `workspace-directory-browser`, `/Users/astahmer/dev/dsh-core-directory-browser-scope`; hybrid-picker revision `e6ea3062` is based on `202ccfee`.
- The earlier DSH Files workspace `workspace-folder-picker-browser-clean` remains preserved and untouched. The separate Core `directory-picker-config` workspace also remains untouched.
- Do not edit the default DSH Files workspace, sync the live profile, or restart the live DSH process.

## Resume here

Browser acceptance remains open. Current published rc.2 E2E renders the chooser but the shell reconnects and no Host API logs appear; do not infer the picker works. Next, assemble a package-coherent scratch Core runtime and trace the prior Client module failure. Core's loader resolves its local `darwin-arm64` workspace package without `system.node`; a trusted published prebuilt `@deepseek-ai/node-addon-system-darwin-arm64@0.1.2` is already available in the DSH Files dependency tree, so prefer that over native compilation. Once scratch boot is coherent, run both entry-point journeys plus temp-only create/select/registration. Source changes are split on the DSH Files spine and Core feature revision is recorded above; no live profile promotion or restart.
