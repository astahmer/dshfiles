# ADE docking layer — P2.0 probe (2026-10-09)

Decision 2 in [decisions.md](decisions.md) asks for a "move anything anywhere" layer under the editor. This note
records the licence check, the library choice and what the probe plugin `@dshfiles/workbench` proves.

## Trellis licence verdict: not usable as-is

`@danfessler/trellis` 0.3.0 (published 2026-09-28; 0.1.0 and 0.2.0 two days earlier). No dependencies or peers; it is a
framework-agnostic DOM core (`createWorkspace(element, { types: { mount(el) } })`), 192 KB unminified JS plus 28 KB
CSS. `license: "SEE LICENSE IN LICENSE.md"`, three tiers, read from the published tarball:

- **Non-commercial** (`LicenseRef-Danfessler-NonCommercial-1.0`): excludes any tool "developed within a for-profit
  organization (including side projects done as part of employment)" and use "at a company with more than one employee
  or developer". This harness is used for paid work, so this tier does not cover it.
- **Commercial**: only while an active GitHub Sponsor ($10/month individual, $100/month studio of 10 members or
  fewer). It lapses when the sponsorship stops, and forks may not be redistributed under another licence.
- **Enterprise** (more than 10 members): negotiated by email.

Verdict: not open source, and it cannot be vendored or forked into this repo. Adopting it means a paid sponsorship
that the user has to choose; until then it is out. It is also young: 0.1.0 to 0.3.0 in three days. A React binding,
`@danfessler/trellis-react` 0.3.0 (peers React ≥ 18.3), carries the same licence.

## Alternatives

| | dockview-react 8.4.1 | flexlayout-react 0.11.1 | rc-dock 4.1.0 | golden-layout 2.6.0 |
|---|---|---|---|---|
| Licence | MIT | MIT | Apache-2.0 | MIT |
| React 18 | peer 16–19 | peer 18–19 | peer ≥ 18 | none (DOM only, portals by hand) |
| Runtime deps | `dockview` → `dockview-core` (no third-party) | none | lodash, classnames, rc-new-window, 3 `@rc-component/*` | none |
| Weight (esbuild min / gzip, React external) | 407 KB / 95 KB + 45 KB structural CSS | 195 KB / 50 KB | 197 KB / 62 KB | — |
| Tabs / split / float / popout | yes / yes / floating groups / popout windows; edge groups, maximize | yes / yes / float + popout / yes | yes / yes / float box / new window | yes / yes / no / popout |
| Keeps panels mounted on move | yes: one React portal per panel; with `renderer: 'always'` content lives in an overlay and is never reparented (proved in this probe, below) | yes: tabs render in one flat layer (README: content stays intact across `Model.fromJson`) | `cached` tabs | no: content is torn down unless you keep your own portals |
| Saved layouts | `api.toJSON()` / `fromJSON()` | `model.toJson()` / `Model.fromJson()` | `saveLayout` / `loadLayout` | `saveLayout` / `loadLayout` |
| Maintenance | 8.4.1 on 2026-10-05, frequent releases | 0.11.1 on 2026-09-26 | 4.1.0 on 2026-10-09 | last release 2023-02-21 |

**Chosen: dockview-react.** It has an imperative per-panel API (`addPanel`, `getPanel(id)`,
`panel.api.moveTo/close/setActive`, `addFloatingGroup`). That fits a registry where other plugins name panels by id
and ask to open them. The `'always'` renderer avoids DOM reparenting entirely, which matters for Monaco (focus,
scroll and IME state are lost when its node moves). It also ships a11y live regions and keyboard handling, and it has
no third-party dependencies. The cost is weight: about twice flexlayout's. It is paid only by the workbench plugin,
because the editor and other contributors need just the registry module, which has no runtime dependencies.
**Fallback:** flexlayout-react, if bundle weight ever outranks the imperative API. The registry contract below does not
expose dockview types, so a swap stays inside the workbench.

Rejected: Trellis (licence), golden-layout (unmaintained, no React integration), rc-dock (lodash plus rc-component
dependency chain, older class-component API, no advantage over the two above).

## Probe: `plugins/@dshfiles/workbench`

- The `main` slot has key `dshfiles-workbench`, and a `sidebar.panellist` entry (order 3, grid icon) opens it, the same
  pattern secret-catalog and mcp-servers use.
- `DockviewReact` uses `defaultRenderer: 'always'` and one Dockview component (`workbench-panel`). Each Dockview
  panel id is a registry id, and the component looks the definition up reactively.
- **Registry** (`@dshfiles/workbench/registry`, source export): `workbenchPanels()` returns one page-wide instance stored
  on `globalThis.dshfilesWorkbenchPanelsV1` (the name carries the contract version). Every bundle inlines the module, the first loader creates
  the instance, and contributors may register before the workbench loads. API: `register({ id, title, component })
  → dispose`, `get`, `list`, `subscribe`, `open(id)`. Open requests are queued until the view takes them, and the
  workbench client brings its main panel to front.
- **Persistence**: `createStoredValue` key `dshfiles.workbench.layout.v1`, saved on `onDidLayoutChange`. Dockview
  buffers that event to the next task. A zod guard checks the outer shape, and every panel must use
  `workbench-panel`. Unreadable data, or a layout `fromJSON` rejects, is cleared and replaced by the default layout
  (first two panels side by side, the rest as tabs). An untouched default is not saved, so a reload rebuilds it from
  whatever is registered then.
- **Recovery**: a saved panel whose plugin is gone renders a placeholder with *Close panel*. If the plugin registers
  again, the same panel renders its content again with no layout change.
- **Header**: *Add panel* (registered but closed panels) and *Reset layout* (clears storage, applies the default).
- **Styles**: Dockview's 150 KB sheet is cut at build time to its structural half (45 KB, everything before the first
  `.dockview-theme-*` rule, see `dockview-css-vite.ts`). A token theme (`src/dockview-theme.css`, `--dv-*` →
  `--dsw-alias-*`) is appended. The workbench injects the result as `style[data-dshfiles-workbench-sheet]` on first
  mount and removes it on dispose. It stays out of `client.css` so the shared Tailwind sheet keeps one content hash
  and the "exactly one shared plugin stylesheet" e2e budget still holds.
- Demo panels: *Scratchpad* (textarea draft plus mount and render counters) and *Ticker* (seconds since mount,
  which a remount resets to 0).

### Proven (jsdom, `src/workbench-view.test.tsx`)

- Tab into another group, split left, float, then dock back: mount count stays 1 and the textarea draft is kept.
- A saved layout is restored after unmount and remount (reload).
- Reset restores the default and saves it.
- Unknown panel: a placeholder appears, re-registration recovers it, and *Close panel* removes it.
- A layout Dockview rejects falls back to the default.
- `open(id)` works before and after the view mounts.
- Registry: ordering, a stale disposer cannot remove a replacement, snapshot stability, the open-request queue, and
  the global singleton.

### Proven in a browser (probe profile, `dsh --profile probe --port 3197`, headless Chromium, real mouse drags)

- Dragging *Scratchpad* into *Ticker*'s group (tab), then to its bottom edge (split), then shift-dragging it out
  (floating group) leaves both mount counters unchanged. The draft stays, and the ticker keeps counting.
- The saved layout, including the floating group, is restored after a page reload. *Reset layout* returns to the
  side-by-side default.
- *Reset layout* recreates panels by design, so their state resets. No console errors. The injected dockview sheet is
  about 47 KB.

### Gaps

- Moves are driven through the API in jsdom tests. Drag-and-drop was checked once in a browser and has no committed
  e2e. Scroll-position preservation is not asserted.
- Real panels: jujutsu, explorer and editor do not register yet. Each needs a one-line `workbenchPanels().register`
  in its own client (not done here: shared working copy, other owners).
- Native DSH views (conversation, terminal) cannot dock: the Host exposes no layout ownership or reparent contract
  ([software-additions-roadmap](../software-additions-roadmap.md) 2026-10-05 gate). The workbench lives inside one
  `main` panel.
- No named layouts yet (one saved layout). Add a `layouts: Record<name, SerializedDockview>` store when needed.
- If the workbench mounts before any contributor registers and the user never changes the layout, the panels that
  register later are not added automatically: use *Add panel*, or reload.
- Popout windows: available in Dockview but untested. Our sheet is injected only into the main document, so popouts
  would render unstyled.
- Bundle: `dist/client.js` is 793 KB min (186 KB gzip), including plugin-ui (radix) and Dockview.

## Docking the editor into it (next steps for `@dshfiles/editor`)

1. Add `"@dshfiles/workbench": "link:../workbench"` and, in the editor client setup:
   `ctx.effect(() => workbenchPanels().register({ id: 'dshfiles-editor.main', title, component: EditorPanel }))`.
   Use one id per open file (`dshfiles-editor.file:<path>`) if each file should be its own dockable tab.
2. `openFile(path)` → register the panel if needed, then `workbenchPanels().open(id)`.
3. Monaco: keep `automaticLayout: true`, or call `editor.layout()` from a `ResizeObserver`. Panels keep their DOM
   node (`renderer: 'always'`), so models, view state and focus persist across moves.
4. Persist editor state such as open files and view state in the editor's own store keyed by panel id. The workbench
   persists only geometry.
