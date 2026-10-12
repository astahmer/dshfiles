# Add Workspace in-app folder browser

Keep the in-app folder chooser for **Add Workspace** while preserving native Finder picking for other features.

## Progress

| Milestone | Status | Evidence |
|---|---|---|
| Reproduce and choose scope | Done | Published-package scratch journeys opened the custom dialog but Host listing failed; this confirms the old native-only capability cannot serve the in-app browser. Scope remains Add Workspace only. |
| Add a hybrid Host capability | Done | Host/API and Loader-composition regressions pass; focused Host typecheck plus canonical Host/Client/Web builds pass. Three changed Core README translation pairs pass scoped verification. The default `auto` path remains unchanged. |
| Wire the owned plugin and web seed | Done | Plugin patch opts into `backend: hybrid`; README documents preserved native picking. Plugin typecheck/build/import pass; Vitest has no unit tests. Workspace `contract` passed; broad plugin build remains blocked by an unrelated missing vendored `@deepseek-ai/dsh-session-format-catalog` artifact in `@dshfiles/dsh-core-runtime`. |
| Verify isolated composition and browser journeys | Done | Local Core Client/Web builds and focused Host/API tests pass; `verify-client-packages` (64 packages) and `verify-tsconfig-paths` pass. Both scratch Playwright cases pass (2 expected, 0 unexpected): header browses/creates/selects/registers, and sidebar opens in folder mode. The Core runtime uses the static-linked `dsh-client-session-surface` facade. Broad domain-graph check still reports 82 violations in unrelated, unchanged paths; they remain outside this feature's scope. No live profile was touched. |
| Promote after isolated success | Done | Added the bundle to the web seed and ran the scoped `profile:sync`; the installed profile dump shows the bundle, its Loader row, and `backend: hybrid`. The installed link points to this named workspace. `pnpm peers check` reports only unresolved peers for existing dshmarket/commandcode-provider packages, not this bundle. No live restart occurred. |
| Deploy Core Host/API and activate | Pending | The installed CLI is `0.2.0-rc.2`, which predates the hybrid Host/API change. Do not restart the live instance until a Core build containing `e6ea3062` and `25ecf430` is installed; restart remains user-controlled. |

## Decisions

- Preserve the default `auto` behavior for profiles that do not opt in.
- Add an explicit `hybrid` interaction: native `pick` plus bounded, validated browse `list/createDirectory` on native-capable hosts; fall back to browse-only where native picking is unavailable.
- Only the owned workspace-folder-picker profile patch opts into `hybrid`; its custom UI stays scoped to Add Workspace slots.
- Keep the live DSH process untouched; only after isolated browser acceptance passes, sync the single owned bundle. Restart remains user-controlled.
- Hybrid reuses Browse's existing host-filesystem scope; path validation does not add a workspace-root authorization boundary. This broader browse capability stays opt-in in the plugin profile.

## Workspace handoff

- DSH Files workspace: `workspace-folder-picker-browser-latest`, `/Users/astahmer/dev/dshfiles-workspace-folder-picker-browser-latest`; feature revision `22ba671a` is based on `integration-spine`/`main` at `abcf899c`, with web-seed promotion revision `fbdfb542`.
- DSH Core workspace: `workspace-directory-browser`, `/Users/astahmer/dev/dsh-core-directory-browser-scope`; hybrid-picker revision `e6ea3062` is based on `202ccfee`, followed by the static Client facade revision `25ecf430319afb1865c83ac3148954983263f8ee`.
- Handoff thread: `session-639492a5-cb11-4bb2-ad3f-f55a4d7a0aca`.
- The earlier DSH Files workspace `workspace-folder-picker-browser-clean` remains preserved and untouched. The separate Core `directory-picker-config` workspace also remains untouched.
- The canonical DSH Files `default` workspace is untouched and has unrelated in-progress OptMem edits. The installed web profile currently links to this named workspace; integrate the feature and seed into canonical before a Nix apply. Do not restart live DSH.

## Resume here

Scratch acceptance and web-profile promotion are complete: both browser journeys pass; the seed is committed in this workspace; scoped `profile:sync` ran; and `dsh --profile web --dump-config` confirms the plugin and `backend: hybrid`. The installed link points to `/Users/astahmer/dev/dshfiles-workspace-folder-picker-browser-latest/plugins/@dshfiles/workspace-folder-picker`. The installed CLI is still `0.2.0-rc.2`, predating the Core Host/API change, so the live DSH remains on its old runtime and must not be restarted until a compatible Core build is installed. The canonical `../dshfiles` workspace has unrelated uncommitted OptMem edits; do not rewrite it. Integrate the feature and seed there when that writer is clear; until then, a Nix apply may remove the installed bundle. Restart remains user-controlled. The opt-in Browse scope is process-user-wide rather than workspace-root constrained; symlinked directories remain navigable, as documented in the plugin README.
