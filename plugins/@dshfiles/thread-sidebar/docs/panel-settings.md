# Panel-owned sidebar settings

The **Sidebar settings** wheel belongs to the Threads view, not fixed application chrome. It opens the existing **Customize sidebar** editor inside that view. Moving Threads, hiding its sole tab row, or collapsing the old left column does not relocate the editor back to app chrome. **Done** closes it; existing preference writes and their persistence are unchanged. The separate list-only sliders control is named **Thread list settings**. Native DSH Settings remains separate.

## Ownership

SidebarRoot retains the one customization controller, editor tree and preference callbacks. The registered Threads view supplies only its toolbar trigger and an owned DOM seat. A local action ref and public Workbench panel visibility connect them; React `createPortal` moves the rendering seat without cloning the preference model or reparenting native DOM. Seat cleanup checks identity so a late release cannot remove a newly moved seat. No Host API, stored visibility key, SDK augmentation or core patch is added.

The leading toolbar position leaves Workbench's top-right **Show tab row** affordance clear. The fixed customization copy is suppressed only when the real `shell.left` slot is overridden. Standalone/global recovery keeps the existing root fallback when there is no visible Threads seat.

## Verification

- 96 focused owner, seat, state, organization and preference tests pass, with strict package types.
- The real browser case `thread-sidebar.panel-settings-wheel` proves one gear/no fixed duplicate, the original Search threads preference write/reload/reverse, actual drag to the right pane, hidden tab row, collapsed left column and editor bounds inside its owning view.
- The default sidebar is explicitly reopened at 360, 480, 768 and 1024 px before checking its editor. The existing frame collapses/does not expose columns at narrow widths; desktop moved-right behavior is checked separately rather than asserting that an unavailable mobile column is on screen.
- Three affected Workbench assembly/recovery/picker cases pass. Standalone navigation customization/reload, footer/header menus and saved views pass with declared cooperating Session providers.
- Two broader legacy cases (`view-controls` and `open-in-side-panel`) remain unverified: they stop before the changed controls because their `startBlankThread` fixture assumes a saved initial thread selection while the fresh owned session controller presents a local blank draft. The concrete seed/selection repair is retained as a tooling papercut; no readiness or row assertions are weakened.
- The named scratch doctor, Preview/gear reach, customization reach, screenshots and cleanup pass. Console/page/request/HTTP errors are zero; non-error warning counts are retained separately (one for the gear shot, two for the editor shot). Scoped lint has no errors; existing warnings remain. Native-fork inventory still reports pre-existing added Chat/Rich Composer files, not changes to vendored paths here.

From `tooling/dshx`, using the official-core/Chromium scratch environment described by `verify-dsh`:

```sh
node node_modules/playwright-bdd/dist/cli/index.js --config=playwright.e2e.config.ts
node node_modules/@playwright/test/cli.js test --config=playwright.e2e.config.ts --workers=1 --grep '@scenario:thread-sidebar.panel-settings-wheel'
```

Generated BDD consumers must be refreshed after feature/fixture edits; the direct Playwright runner and PREBUILT flag do not do that. Canonical Sidebar/shared-style artifacts are rebuilt after landing. The live GUI is not refreshed or restarted by verification.
