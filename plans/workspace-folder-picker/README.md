# Add Workspace in-app folder browser

Keep the in-app folder chooser for **Add Workspace** while preserving native Finder picking for other features.

## Progress

| Milestone | Status | Evidence |
|---|---|---|
| Reproduce and choose scope | Done | Published-package scratch journeys opened the custom dialog but Host listing failed; this confirms the old native-only capability cannot serve the in-app browser. Scope remains Add Workspace only. |
| Add a hybrid Host capability | Done | Host/API and Loader-composition regressions pass; focused Host typecheck plus canonical Host/Client/Web builds pass. Three changed Core README translation pairs pass scoped verification. The default `auto` path remains unchanged. |
| Wire the owned plugin and web seed | Done | Plugin patch opts into `backend: hybrid`; README documents preserved native picking. Plugin typecheck/build/import pass; Vitest has no unit tests. Workspace `contract` passed; broad plugin build remains blocked by an unrelated missing vendored `@deepseek-ai/dsh-session-format-catalog` artifact in `@dshfiles/dsh-core-runtime`. |
| Verify isolated composition and browser journeys | Done | Local Core Client/Web builds and focused Host/API tests pass; `verify-client-packages` (64 packages) and `verify-tsconfig-paths` pass. Both scratch Playwright cases pass (2 expected, 0 unexpected): header browses/creates/selects/registers, and sidebar opens in folder mode. The Core runtime uses the static-linked `dsh-client-session-surface` facade. Broad domain-graph check still reports 82 existing violations outside changed paths. No live profile was touched. |
| Promote and report restart boundary | Pending | No live-profile sync or restart was performed. The live profile remains untouched; promotion and any later restart stay under user control. |

## Decisions

- Preserve the default `auto` behavior for profiles that do not opt in.
- Add an explicit `hybrid` interaction: native `pick` plus bounded, validated browse `list/createDirectory` on native-capable hosts; fall back to browse-only where native picking is unavailable.
- Only the owned workspace-folder-picker profile patch opts into `hybrid`; its custom UI stays scoped to Add Workspace slots.
- Do not modify the live DSH process or installed profile during the experiment.
- Hybrid reuses Browse's existing host-filesystem scope; path validation does not add a workspace-root authorization boundary. This broader browse capability stays opt-in in the plugin profile.

## Workspace handoff

- DSH Files workspace: `workspace-folder-picker-browser-latest`, `/Users/astahmer/dev/dshfiles-workspace-folder-picker-browser-latest`; feature revision `22ba671a` is based on `integration-spine`/`main` at `abcf899c`.
- DSH Core workspace: `workspace-directory-browser`, `/Users/astahmer/dev/dsh-core-directory-browser-scope`; hybrid-picker revision `e6ea3062` is based on `202ccfee`, followed by the static Client facade revision `25ecf430319afb1865c83ac3148954983263f8ee`.
- Handoff thread: `session-639492a5-cb11-4bb2-ad3f-f55a4d7a0aca`.
- The earlier DSH Files workspace `workspace-folder-picker-browser-clean` remains preserved and untouched. The separate Core `directory-picker-config` workspace also remains untouched.
- Do not edit the default DSH Files workspace, sync the live profile, or restart the live DSH process.

## Resume here

Browser acceptance is complete in isolated scratch Core: the header browse/create/select/register journey and the sidebar folder-mode journey both pass after the static-linked facade fix. Core Client/Web builds and focused Host/API tests pass. No `web` profile sync or restart was made. Next: wait for the user-controlled promotion decision; if authorized, read `docs/profile-installs.md`, sync only `@dshfiles/workspace-folder-picker`, then verify the installed profile and `dsh --profile web --dump-config`. Any restart remains the user's call. The opt-in Browse scope is process-user-wide rather than workspace-root constrained; symlinked directories remain navigable, as documented in the plugin README.
