# Global dock — persistent, movable panels across the shell

**Resume here:** M1–M3 work end to end and the browser journey `workbench.global-dock` passes
(the `feat(dock)` and `test(workbench)` revisions on this line). Next: the UI switch (rail entry,
header toggle, agent tool), then M2's bottom region and cross-region moves.

## Objective

Turn DSH's right side panel into a **global, persistent docking surface**: one panel set that
survives thread switches, whose panels can be moved between regions (right column ⇄ bottom
row ⇄ main view) the way VS Code dock views move, with persisted layouts and named saved
layouts. Configurable: the user picks whether the right column is the native per-thread
surface or the global dock.

## Progress

| Task                                                         | State       | Evidence                                                                                                                                                       |
| ------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Investigation of the native right sidebar and the workbench  | done        | this document's _Today_ section                                                                                                                                |
| M1 frame seat + dock occupant behind a setting               | landed      | the `feat(dock)` revision — frame `shell.dock` seat + `ctx.rightPanel`, workbench `rightPanel` setting and dock surface                                        |
| M1 Jujutsu panel contributed to the dock                     | landed      | same revision — `dshfiles-jujutsu.dock` with `dockDefault`                                                                                                     |
| M1 journey + catalog                                         | landed      | the `test(workbench)` revision — `workbench.global-dock` passes in Chromium; both catalogs carry their feature entry                                           |
| M1 switch from the UI (header button, command, Settings row) | landed      | the UI-switch revision — the header button and `workbench.toggleSidePanel` write the setting                                                                   |
| M2 bottom region + cross-region moves                        | landed      | the `feat(frame)` + `feat(workbench)` revisions — full-width bottom row, region registry, Move menu, `workbench.bottom-panel` journey                          |
| M3 saved layouts                                             | landed      | the named-layouts revisions — one dialog to save, apply, rename and delete; `workbench.saved-layouts` journey                                                  |
| Drag a panel between regions                                 | partial     | Dockview's drop protocol is wired through the api's `onUnhandledDragOver`; a scripted tab drag left the panel in the dock, so the journeys cover the menu path |
| M4 native right-sidebar content in the dock                  | not started | today the column falls back to the native surface while a native tab (preview, diff, terminal) is open                                                         |

## Today (evidence)

1. **The right panel is per-session in core.** `@deepseek-ai/dsh-client-ui-sidebar-right`
   holds "one docking surface per session", "One `SurfaceState` per session id", saved under
   `dsh.sidebar-right.v1.<sessionId>`; its `rightbar.session` slot is `scope: 'session'` and
   its README states "Without a session there is no button and no panel". `ctx.sidebarRight`
   commands act on the on-screen Session's store and throw with no Session on screen.
2. **The `rightbar` column is a single root-scoped slot** declared by the frame and occupied
   by that same package (`root` children: `sidebar`, `main`, `rightbar`, `shell.bottom`,
   `shell.overlay`, `shell.leading`). Declaring a slot claims it, so a second owner cannot
   share the column.
3. **The workbench's "side panel" is a tab type inside that per-session surface**
   (`plugins/@dshfiles/workbench/src/client.tsx` registers `@dshfiles/workbench/side-panel`
   through `sidebarRightTabs.register` + `sidebar.right.pane.tab`). That is why it is
   per-thread. Its _main_ surface is global, but `main` panels replace the conversation.
4. **The workbench already owns the pieces a global dock needs**: a page-global panel registry
   on `globalThis.dshfilesWorkbenchPanelsV1`, Dockview, and browser-persisted layouts
   (`dshfiles.workbench.layout.v1`, `dshfiles.workbench.side-panel-layout.v1`).
5. **Jujutsu content is already shell-global**: the selected repository lives in browser
   storage (`storedRepoPath`), not in the Session; a Session only pushes a path in through the
   toggle request bus.
6. **The frame is already ours.** `@dshfiles/frame-layout` ports `ui-layout` and owns
   `ctx.layout` + `root` live (`dshx plugins list`: `include:ui-layout` disabled,
   `include:dshfiles-frame-layout` active). Its delta is the persisted geometry in
   `src/frame-widths.ts` plus `stores.ts`/`index.ts`.
7. **The fork is behind upstream**: it is pinned to `0.2.0-rc.2` and declares five `root`
   children, while the installed `0.2.1-rc.2` declares six, adding
   `shell.bottom: { kind: 'single', scope: 'root' }`. Re-pinning is due before the bottom
   region exists.
8. **`@deepseek-ai/dsh-client-ui-dockkit` is published** (through `0.2.1-rc.2`) and is
   DSH's own docking engine — recursive split tree, invertible ops with a linear history,
   floats, `DockSurface`/`DockLayout`, `FloatLayer`. Its README calls it an internal engine
   whose API "may change in any release" and it offers no cross-surface moves either.

## Decisions

- **D1 — the frame decides what fills the right column.** The column and its drag/collapse
  geometry already belong to our fork, so the mode switch lives there: render the native
  `rightbar` occupant (default) or a new global dock seat. No second right column, no new
  column math, and the native package stays loaded so its slot declarations survive.
- **D2 — the dock is the workbench, evolved in place.** Reuse its registry, Dockview surface
  and persistence instead of forking `ui-sidebar-right` (~3.9k lines) + `ui-dockkit`
  (~4.1k lines) or adopting dockkit as a second engine. The registry stays the page-global
  contract existing contributors (editor, Jujutsu) already use.
- **D3 — the mode is a user setting, live-applied, reported to the frame.** The workbench owns
  the `rightPanel` setting and reports it through the frame's `ctx.rightPanel` seat
  (`setMode('dock' | 'native')`), guarded by `ctx.get` so the plugin still loads on a frame
  without the seat. Reporting beats making slot occupancy the switch: the dock entry registers
  statically, so no ordering race exists between a component effect and the frame's
  declaration, and the setting survives a reload because it lives in DSH settings.
- **D4 — "move to X" uses the surfaces that already exist.** Within the dock, Dockview already
  moves, splits, tabs and floats a panel. Moving a panel to the **main view** is
  `ctx.layout.selectPanel` on the panel's global `main` entry (the workbench and Jujutsu both
  have one). Moving to a **bottom row** arrives with M2 on the upstream `shell.bottom` seat.
- **D5 — native right-sidebar content (files, terminal, previews, diff) is M4.** Those bodies
  are rendered only by sidebar-right's session-scoped tab domain, so a foreign host cannot
  adopt them; M4 decides between an owned panel set and a port, from evidence gathered in M1.

## Phases

### M1 — a global right-column dock (the ask)

1. Frame: add a `shell.dock` root child slot (single, root scope) and render it in the right
   column when occupied, otherwise the native `rightbar`. Reuse the existing width, drag,
   collapse and fullscreen machinery; report the same `RightbarOwnerProps`. Keep the native
   column's `openRightbar/closeRightbar` reporting path intact for the case where it is the
   occupant.
2. Workbench: setting `rightPanel: 'native' | 'dock'` (default `native`), registering a
   `shell.dock` entry that renders the Dockview surface while `dock` is selected.
3. Workbench: give the dock surface its own persisted layout key and its own default layout,
   and render the registry's panels with the existing `WORKBENCH_COMPONENT` dispatch.
4. Jujutsu: register its panel into the workbench registry (its `surface` prop gains `dock`),
   so a persistent Jujutsu panel is docked by default in dock mode.
5. Controls: a way to switch mode from the UI (workbench header toggle + Settings row) and a
   rail entry in the left sidebar, with agent tools for the settings row per the repo's
   capability-parity rule.
6. Verify: workbench unit tests for registration/layout, `pnpm check:e2e workbench`, and a
   scratch DSH run proving the panel survives a thread switch and a reload.

### M2 — bottom region and cross-region moves

Re-pin `frame-layout` to `0.2.1-rc.2` (picking up `shell.bottom`), mount a second dock region
there, and add one page-global dock model that routes a drag between regions (remove from the
source layout, add to the target) plus main-view moves through `ctx.layout.selectPanel`.

### M3 — saved layouts

Named layout presets (save, apply, rename, delete) stored browser-side beside the live layout,
listing the regions and their serialized trees, with a settings-backed UI.

### M4 — native right-sidebar content

Decide from M1 evidence between owned panels for files/terminal/previews and a port of
`ui-sidebar-right`; record the concrete gap in `plans/dsh-host-gaps.md` if neither is honest.

## Verification notes (M2/M3)

- `workbench.global-dock`, `workbench.bottom-panel` and `workbench.saved-layouts` pass in
  Chromium; `pnpm check:e2e workbench` is 6 passed, 1 failed, and the failure is the
  pre-existing `workbench.surface-layouts` journey (it fails on `main` in the same place).
- `workbench.saved-layouts` is timing-sensitive in a long run (it fails once in a while in the
  full suite and passes alone: two consecutive clean runs), so treat a red full run there as a
  flake first.
- `@dshfiles/frame-layout` 17 and `@dshfiles/workbench` 30 unit tests pass; boot checks are green
  for frame-layout, workbench and jujutsu.
- A new Tailwind utility only exists after `@dshfiles/ui-styles` is rebuilt — a missing
  `dshx:flex-1` silently collapsed the workbench panel and swallowed tab clicks.

## Verification notes (M1)

- `node --run check:e2e workbench` runs the feature: `workbench.global-dock` passes in Chromium
  (25–45 s), and the only failure is the pre-existing `workbench.surface-layouts` journey. That
  one fails in the same `sendMessage` assertion on a checkout of the pre-feature state (main plus
  this plan's revision only) in a separate workspace, so the global dock did not introduce it.
- `@dshfiles/frame-layout` 15 unit tests, `@dshfiles/workbench` 19 unit tests, and the per-plugin
  boot check for frame-layout, workbench and jujutsu are green.
- The dock surface saves the layout it restored or applied on ready: Dockview reports layout
  changes only for later gestures, so a freshly applied default stayed unsaved and a reload
  rebuilt the default instead of restoring what the user saw.

## Risks

- **Resource opens in dock mode.** File links and previews open through `ctx.sidebarRight` into
  the per-session surface; with the native column not rendered they would have nowhere to show.
  Mitigation to validate in M1: observe `sidebarRight.openTabs` and show the native column when
  it holds open tabs, or keep both seats and let the dock yield.
- **Frame re-pin drift.** The fork is one release behind upstream; adding a delta on top of an
  old pin makes the next re-pin harder. Re-pin first if M2 starts before M1 lands.
- **Dockview is a third-party engine.** It stays MIT and in-workspace, but it means the dock's
  chrome does not match dockkit's native right sidebar. Accept for M1; revisit only if the
  visual mismatch is a product problem.
