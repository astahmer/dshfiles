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

|                                             | dockview-react 8.4.1                                                                                                                         | flexlayout-react 0.11.1                                                                   | rc-dock 4.1.0                                          | golden-layout 2.6.0                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| Licence                                     | MIT                                                                                                                                          | MIT                                                                                       | Apache-2.0                                             | MIT                                                       |
| React 18                                    | peer 16–19                                                                                                                                   | peer 18–19                                                                                | peer ≥ 18                                              | none (DOM only, portals by hand)                          |
| Runtime deps                                | `dockview` → `dockview-core` (no third-party)                                                                                                | none                                                                                      | lodash, classnames, rc-new-window, 3 `@rc-component/*` | none                                                      |
| Weight (esbuild min / gzip, React external) | 407 KB / 95 KB + 45 KB structural CSS                                                                                                        | 195 KB / 50 KB                                                                            | 197 KB / 62 KB                                         | —                                                         |
| Tabs / split / float / popout               | yes / yes / floating groups / popout windows; edge groups, maximize                                                                          | yes / yes / float + popout / yes                                                          | yes / yes / float box / new window                     | yes / yes / no / popout                                   |
| Keeps panels mounted on move                | yes: one React portal per panel; with `renderer: 'always'` content lives in an overlay and is never reparented (proved in this probe, below) | yes: tabs render in one flat layer (README: content stays intact across `Model.fromJson`) | `cached` tabs                                          | no: content is torn down unless you keep your own portals |
| Saved layouts                               | `api.toJSON()` / `fromJSON()`                                                                                                                | `model.toJson()` / `Model.fromJson()`                                                     | `saveLayout` / `loadLayout`                            | `saveLayout` / `loadLayout`                               |
| Maintenance                                 | 8.4.1 on 2026-10-05, frequent releases                                                                                                       | 0.11.1 on 2026-09-26                                                                      | 4.1.0 on 2026-10-09                                    | last release 2023-02-21                                   |

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
- **Recovery**: a saved panel whose plugin is gone renders a placeholder with _Close panel_. If the plugin registers
  again, the same panel renders its content again with no layout change.
- **Header**: _Add panel_ (registered but closed panels) and _Reset layout_ (clears storage, applies the default).
- **Styles**: Dockview's 150 KB sheet is cut at build time to its structural half (45 KB, everything before the first
  `.dockview-theme-*` rule, see `dockview-css-vite.ts`). A token theme (`src/dockview-theme.css`, `--dv-*` →
  `--dsw-alias-*`) is appended. The workbench injects the result as `style[data-dshfiles-workbench-sheet]` on first
  mount and removes it on dispose. It stays out of `client.css` so the shared Tailwind sheet keeps one content hash
  and the "exactly one shared plugin stylesheet" e2e budget still holds.
- Demo panels: _Scratchpad_ (textarea draft plus mount and render counters) and _Ticker_ (seconds since mount,
  which a remount resets to 0).

### Proven (jsdom, `src/workbench-view.test.tsx`)

- Tab into another group, split left, float, then dock back: mount count stays 1 and the textarea draft is kept.
- A saved layout is restored after unmount and remount (reload).
- Reset restores the default and saves it.
- Unknown panel: a placeholder appears, re-registration recovers it, and _Close panel_ removes it.
- A layout Dockview rejects falls back to the default.
- `open(id)` works before and after the view mounts.
- Registry: ordering, a stale disposer cannot remove a replacement, snapshot stability, the open-request queue, and
  the global singleton.

### Proven in a browser (probe profile, `dsh --profile probe --port 3197`, headless Chromium, real mouse drags)

- Dragging _Scratchpad_ into _Ticker_'s group (tab), then to its bottom edge (split), then shift-dragging it out
  (floating group) leaves both mount counters unchanged. The draft stays, and the ticker keeps counting.
- The saved layout, including the floating group, is restored after a page reload. _Reset layout_ returns to the
  side-by-side default.
- _Reset layout_ recreates panels by design, so their state resets. No console errors. The injected dockview sheet is
  about 47 KB.

### Gaps

- Moves are driven through the API in jsdom tests. Drag-and-drop was checked once in a browser and has no committed
  e2e. Scroll-position preservation is not asserted.
- Real panels: jujutsu, explorer and editor do not register yet. Each needs a one-line `workbenchPanels().register`
  in its own client (not done here: shared working copy, other owners).
- Native DSH views (conversation, terminal) do not dock yet: the workbench lives inside one `main` panel (and one
  right-panel tab). The [Dock everything](#dock-everything-feasibility-2026-10-10) section below shows a no-fork path
  that does not reparent DOM nodes.
- No named layouts yet (one saved layout). Add a `layouts: Record<name, SerializedDockview>` store when needed.
- If the workbench mounts before any contributor registers and the user never changes the layout, the panels that
  register later are not added automatically: use _Add panel_, or reload.
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

## Dock everything: feasibility (2026-10-10)

Question: can every surface dock anywhere? That covers the Host panes (thread list, conversation, right panel and
its tabs such as terminal and files) and every plugin's slot contributions, not only panels registered in the
workbench. Every plugin's declared slots must keep working.

**Verdict: mostly realistic, without a fork.** The three Host columns and every `main` panel can become dockview
panels. Everything nested inside them keeps working because their owners still declare and render those slots.
Single right-panel tabs (terminal, files, browser) stay inside the Host's own right-panel dock, which moves as one
panel; pulling each one out would mean rewriting the Host's tab host. Evidence below is from DSH 0.2.0-rc.2 client
sources (read-only, global pnpm store) and one in-memory `SlotCore` probe. No live profile was run.

### What the Host layout is made of

- `dsh-client-ui-layout` registers **`AppFrame` into the built-in `root` slot** and declares five children:
  `sidebar` (single), `main` (keyed by `activePanelId`, `conversation` reserved), `rightbar` (single),
  `shell.overlay` (list) and `shell.leading` (single). AppFrame is a CSS grid
  (`sidebar | center | rightbar`) that measures its own width, solves column widths, draws the resize handles and
  sets the document title. It also registers ⌘B (`sidebar.left.toggle` → `ctx.layout.toggleSidebar`).
- Occupants: `sidebar` = ui-sidebar `SidebarRoot` (declares `sidebar.panellist` and the other inner seats). `main` =
  the conversation (`main.conversation` → `ConversationRoot` → factory `conversation.content`) plus plugin keys
  (workbench, secret-catalog…). `rightbar` = ui-sidebar-right, which is **already a dock**: it uses
  `@deepseek-ai/dsh-client-ui-dockkit` (panes, splits, floats, duplicate tab, undo). Its tabs are the session-scoped
  keyed slot `sidebar.right.pane.tab` (terminal, files, browser, document preview, jujutsu, the workbench side panel).
- Slot rules (`dsh-client-ui-slots` `SlotCore.register`; renderer `boundRenderSlot`):
  - Single, keyed and list cells **shadow by priority**: the lowest priority renders. A plugin can register
    `root` at `priority: -1` and replace AppFrame.
  - `renderSlot(key)` is allowed only for keys in the calling entry's own `children` object, and each key has
    exactly one declarer. So a replacement root cannot simply redeclare `sidebar` or `main`.
  - `renderFactorySlot(name)` has no owner check. An entry that declares a session-scoped child also receives
    `SessionProvider`, which accepts an explicit `session` prop. Both are ordinary public seams.
- Shared modules handed to plugins by the shell (`dsh-web-frontend` `rM()`): react, react-dom, cordis,
  client-store, ui-slots, ui-primitives, **ui-dockkit**. The Host client packages (layout, sidebar-right…) are
  separate `lib/client.js` modules, and the loader resolves them from the Host's global pnpm tree.

### What moves without a fork

1. **Workbench as the app shell (full-dock mode).** Register a `root` entry at `priority: -1` with
   `children: borrowed`, where `borrowed` starts as `{}`. Then `Object.assign(borrowed, appFrameEntry.children)`,
   reading the AppFrame entry from `ctx.slots.entries('root')`. The core keeps the caller's `children` object by
   reference (`SlotRegistry._register` spreads options shallowly, `SlotCore.register` stores `options.children`), so
   our `renderSlot` may then render `sidebar`, `main:<key>`, `rightbar`, `shell.overlay` and `shell.leading`.
   Probe: `SlotCore` in node, shadow entry wins, the children object is shared, `main` stays declared, all true.
   AppFrame's registration stays on the ledger (shadowed, not rendered), so its declarations and ⌘B stay alive. Our
   root component renders one `DockviewReact` (`renderer: 'always'`). Each Host outlet becomes one dockview panel:
   `host.sidebar` (owner props `{ collapsed: false, width }` from the panel size), `host.main:<key>` (one panel per
   `main` key, so conversation and workbench panels can sit side by side), and `host.rightbar` (owner props
   `{ width, viewportWidth, canShow: true }`). `shell.overlay` and `shell.leading` render once, outside the dock.
   Workbench-registry panels become ordinary panels of the same dock.
   - **This relies on an implementation detail, not a contract.** Guard it at startup: if the borrowed keys do not
     authorize (`renderSlot` throws `SlotOwnershipError`) or AppFrame's entry has no `children`, dispose the shadow
     and fall back to workbench-only mode with a console warning. An upgrade then degrades the feature instead of
     breaking the app.
2. **Plugin slot contributions keep working.** Nested seats (`sidebar.panellist`,
   `conversation.session.header.utilities`, `sidebar.right.*`, `conversation.input.dock`…) are declared and rendered
   by their owners inside the moved subtrees, so nothing changes for contributors. A plugin `main` key or a
   right-panel tab moves with its outlet.
3. **Several conversations at once (probe needed).** Declare a private session-scoped child to obtain
   `SessionProvider`. Then render `<SessionProvider session={id}>` around
   `renderFactorySlot('conversation.content', { variant: 'main', phase, hero }, { slots })`. This is a public seam,
   but `phase`, `hero` and the local `slots` table are ConversationRoot internals that we would have to rebuild. Main
   view retention (`retainedBy.mainView`) and the foreground-session controller assume one main conversation.
   Treat this as a separate probe, not part of the first step.
4. **Right-panel tabs as separate dock panels: only our own.** For a plugin we own (jujutsu, editor, explorer),
   register the same body twice: as a right-panel tab and as a workbench kind. Host tabs (terminal, files, browser,
   preview) need the session scope, a `TabHookContext` (`tabInfo`, `retainTab`, tab actions) and the right panel's
   view retention, all internal to ui-sidebar-right. Rendering them elsewhere means rewriting that tab host (L+, and
   it breaks on every upgrade). They stay inside `host.rightbar`, which already offers split, float and tabs.

### What needs a fork, and how small

Nothing, for steps 1, 2 and 4. If an upgrade breaks the borrowed-children trick, the fallback is a single-package
patch to `dsh-client-ui-layout` (`lib/client.js` and its `.d.ts`, about 40 lines). It adds an optional `shell.frame`
single slot that AppFrame declares itself. When the slot is occupied, AppFrame renders it in place of the grid and
passes `{ renderSidebar(owner), renderMain(key), renderRightbar(owner), renderOverlay(), renderLeading() }` as
closures over its own `renderSlot`. AppFrame keeps measuring, the title and ⌘B. Activation caveat (roadmap
2026-10-05): a profile `link:` is not enough, because the loader resolves Host packages from the global pnpm tree.
The patch would have to be a `pnpm patch` on a separate Host install, never the user's global or web profile. It
would be documented in `tooling/dsh-core/FORK.md` as a rebase-per-release patch (decisions.md item 3). Keep it
prepared but unapplied.

### Hard parts and blockers

- **Remounts.** Moving panels inside the dock keeps state (`renderer: 'always'`, no reparenting). Switching between
  full-dock and workbench-only mode swaps the `root` occupant, so the whole app remounts. Make the mode switch
  apply on reload. A _Reset layout_ also recreates Host panes. Host state that lives in stores survives; draft text
  is unverified, so a probe must check it.
- **Layout store and commands.** `ctx.layout.toggleSidebar/openRightbar/closeRightbar` write AppFrame's layout
  store, and nothing renders that store any more. The shell must read it (the shadowed AppFrame entry's `store`
  handle, hack-level, or an `ILayout.panelInfo` subscription) and map it to panel visibility: ⌘B shows or hides
  `host.sidebar`, and the conversation's expand button shows `host.rightbar`. Likewise
  `ctx.layout.selectPanel(key)` (sidebar panel list) must focus or open `host.main:<key>` instead of swapping the
  centre.
- **Focus and shortcuts.** Host shortcuts resolve by region (`page`/`editable`). Right-panel focus helpers query
  `[data-dockkit-pane]` and skip `[hidden]`/`[aria-hidden]` ancestors. Dockview's own keyboard handling and its
  hidden-tab styling must not collide with either; check ⌘K/⌘P, ⌘B, terminal focus and right-panel shortcuts in a
  browser.
- **Host CSS assumptions.** AppFrame CSS-module rules (`.frame` grid, column backgrounds, `data-sidebar-collapsed`,
  `data-rightbar-*`) disappear, along with the frame variables (`--dsh-frame-leading-clearance`, top clearance,
  Windows titlebar). The macOS traffic-light inset and the Windows drag region need re-creating on the dock's top
  edge. The sidebar expects a collapsed rail below 1024 px and widths of 264–420 px; in a dock panel it gets
  whatever width the user drags it to. The right panel's fullscreen mode covers the viewport, which is fine.
- **Popout windows.** Out of scope: a second `document` breaks Host stylesheets, portals, shortcut listeners and
  `document.querySelector` focus code.
- **Upgrades.** The borrowed-children trick and the `main`/`rightbar` owner props are unversioned. Pin a smoke e2e
  (full-dock boots, every Host outlet renders, a fallback is logged rather than crashing) and rerun it on each DSH
  bump.

### Two user-selectable modes

Setting `@dshfiles/workbench.mode`: `workbench` (default, today's behaviour: workbench in one `main` panel plus the
right-panel tab) or `full-dock` (root shadow above). Applied at startup, with a reload prompt when changed. Each
mode keeps its own saved layout (`dshfiles.workbench.layout.v1`, new `dshfiles.workbench.shell-layout.v1`).
`full-dock` falls back to `workbench` automatically when the startup guard fails, and the settings page says so.
In `full-dock`, the workbench's own `main` key and side-panel tab are not shown (no nested dock in the dock).

### Real panel kinds and multiple instances (registry v2)

Today `register({ id, title, component })` makes one panel per id, and only the demo panels use it. Replace it
with kinds, modelled on `sidebarRightTabs` so a plugin can register one body in both places:

- `registerKind({ kind, title: (params) => string, component, params?: StandardSchema, multiple?, keepMounted? })
→ dispose`. The component receives `{ instanceId, params, setParams, setTitle, close }`.
- `open(kind, { params?, instanceKey?, reveal? = true })`: with `multiple`, each open makes an instance
  `kind:<instanceKey ?? random>`. `instanceKey` (for example a file path) deduplicates, so opening a file that is
  already open reveals its tab. Without `multiple`, the instance id is the kind. Requests stay queued until the view
  mounts, as now.
- Persistence: `{ kind, params }` lives in the dockview panel `params`, saved by `toJSON` with the layout. On restore,
  params are decoded with the kind's schema. Bad params or an unknown kind render the existing placeholder with
  _Close panel_, and the panel recovers when the kind registers again. Large state (Monaco view state, scroll) stays
  in the owner's store keyed by `instanceId`, and the layout keeps only geometry plus small params.
- Global key becomes `dshfilesWorkbenchPanelsV2`. Migrate the demo panels and drop v1, with no alias, because no
  other caller exists. _Add panel_ lists kinds; a `multiple` kind always offers a new instance. Named layouts
  (`layouts: Record<name, SerializedDockview>`) come in the same step.
- Host outlets in full-dock mode are built-in kinds of this registry: `host.sidebar`, `host.rightbar` (single) and
  `host.main` with params `{ key }`. Later, `host.conversation` with params `{ sessionId }` (multiple) once probe 3
  succeeds.

### Staged plan

| Step                                 | Size   | Deliverable                                                                                                                                                                                                                                  | Acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D0 shell probe                       | S      | Throwaway branch of `@dshfiles/workbench` behind `mode: full-dock`, run in a scratch profile (`dsh --profile probe --port 3198`), never :3080 or the web profile                                                                             | Root shadow renders sidebar, conversation, rightbar and one plugin `main` key as dockview panels. `sidebar.panellist`, conversation header utilities and right-panel tabs from plugins all render. Moving the conversation and right-panel panels keeps the composer draft, terminal session and scroll position. ⌘K, ⌘P, ⌘B and the terminal take focus. No console errors. Disabling the trick logs the fallback and boots workbench-only. |
| D1 registry v2                       | M      | Kinds, instances, params, named layouts; demo panels migrated                                                                                                                                                                                | Two instances of one kind with different params survive move and reload. A duplicate `instanceKey` reveals the existing tab. Schema-invalid params give the placeholder. jsdom tests extend `workbench-view.test.tsx`. Independent of D0, so it can ship first.                                                                                                                                                                              |
| D2 full-dock mode                    | M      | Mode setting, guard and fallback, shell-layout store, default layout mirroring the three columns, overlay and leading seats, document title, mapping ⌘B / `selectPanel` / rightbar open and close to panels, macOS and Windows chrome insets | Default full-dock layout looks like today's frame. Every D0 check passes after reload. Switching mode prompts a reload and restores each mode's own layout. Smoke e2e committed.                                                                                                                                                                                                                                                             |
| D3 multi-main and multi-conversation | M–L    | `host.main` instances side by side; `host.conversation` per session via `SessionProvider` + `conversation.content` (probe first)                                                                                                             | Two sessions stream into two panels at the same time, each with its own composer. The sidebar selection marks the focused panel. Stop at side-by-side `main` keys if the factory needs too much of ConversationRoot.                                                                                                                                                                                                                         |
| D4 own right-panel tabs as kinds     | S each | jujutsu, editor and explorer register the body as a kind too                                                                                                                                                                                 | Each opens as a right-panel tab or as a dock panel, and its state is keyed by instance.                                                                                                                                                                                                                                                                                                                                                      |
| — Host right-panel tabs one by one   | —      | Not planned                                                                                                                                                                                                                                  | Would need a rewrite of ui-sidebar-right's tab host; revisit only if DSH exposes a tab-body seam.                                                                                                                                                                                                                                                                                                                                            |

**Recommended first step: D0** (half a day). It is the only step that can prove the idea wrong. It needs no fork,
and its result decides whether D2 and D3 happen. D1 is safe to do in parallel whenever editor work needs
multi-file panels.
