# DSH as an ADE (agent development environment) — roadmap, performance first

Goal: one app for agent work, built out from the harness: browse any file or folder, open files in a real editor,
fuzzy ⌘P file open, many more ⌘K actions, same BB-like shadcn UI (`@dshfiles/plugin-ui`). Performance comes first
because the ⌘P palette and other panels already lag.

Sizes: S ≤ ½ day, M ≈ 1–2 days, L ≈ 3+ days. Each step lists its dependencies, acceptance criteria and a prompt
to paste into an agent. Related plans: [plugin-ui-handoff](../plugin-ui-handoff.md),
[plugin-state-audit](../plugin-state-audit.md) (`#n` and `Ln` ids below), [remaining-work](../remaining-work.md),
[dsh-host-gaps](../dsh-host-gaps.md).

## What the Host gives us today (0.2.0-rc.2 types)

- `workspaceFiles` remote namespace (`@deepseek-ai/dsh-api-workspace-files`): `list`, `read(range)` (text),
  `readBytes`, `stat`, `changes` (watch stream). It is **scoped to a SessionId** and **read-only**: no write, no
  rename, no delete, no search/glob.
- `uiWorkspace.pickDirectory()` / `listDirectory(path)` (jujutsu already uses them for the directory picker).
- `@deepseek-ai/dsh-client-ui-sidebar-files` (Host file tree, `filesFace(list, watch)`) and
  `dsh-client-ui-sidebar-documentpreview` (read-only preview, office → PDF).
- `sidebarRightTabs.register({ id, kind, title, guide })` (jujutsu right pane), `slots`, `sessions`, `workspaces`.
- Host `useCodeHighlighter`, `relativeTime`, `writeClipboard`, `rankByName`.
- dshx constraint: one Host ESM chunk + one lazy-CJS Client chunk; **additional chunks, assets, workers and WASM
  are rejected** ([architecture.md](../../tooling/dshx/docs/architecture.md) step 6). CSS is folded into the factory
  as one `style[data-plugin]` per plugin.
- Current client bundles (15 plugins): jujutsu 1.88 MB, ai-accounts 686 KB, multi-host 614 KB, secret-catalog
  611 KB, mcp-servers 562 KB, thread-sidebar 516 KB; each one inlines React deps and its own Tailwind sheet.

## Phase 0 — Performance first

Targets (measured in the live web UI, production build, 4× CPU throttle off, M-series laptop):

| Metric | Target |
|---|---|
| ⌘P / ⌘K palette open → first results painted | < 50 ms |
| Keystroke in palette → results painted (INP) | < 16 ms p95, no long task > 50 ms |
| Thread-sidebar commits on one unrelated session update | ≤ 1 commit, only changed rows re-render |
| Style recalculation on palette open | < 5 ms |
| Idle CPU with sidebar + jujutsu pane open | no recurring task > 5 ms more often than once per 2 s |
| Total injected plugin CSS | 1 Tailwind sheet, not ~15 |

### [x] P0.1 Profile and baseline (S) — deps: none

How: start the web profile, open it in the built-in Browser pane (or Chrome with React DevTools). Record a
Performance trace of: open ⌘P, type 6 chars, close; open ⌘K; scroll the thread list; idle 10 s with the jujutsu
pane open. React Profiler "Record why each component rendered" on the same flows. Count
`document.querySelectorAll('style[data-plugin]')` and their total length. Save numbers in `plans/ade/perf-baseline.md`.

Acceptance: baseline table with every metric above, the top 5 long tasks by owner, render counts per component.

> Prompt: "Profile the DSH web UI (dshfiles repo). Start the `web` profile, open it in the Browser pane, and measure
> palette open, keystroke latency, thread-sidebar render counts, style recalc and idle CPU per plans/ade/README.md
> P0.1. Count `style[data-plugin]` elements and their bytes. Write plans/ade/perf-baseline.md with the numbers and the
> top 5 long tasks with their source plugin/component. No code changes."

### [x] P0.2 One shared Tailwind sheet (M) — deps: P0.1

Every plugin injects the same ~115 KB sheet (README "Shared stylesheet and stacking" makes them identical on
purpose). ~15 copies multiply style-recalc and selector-matching cost. Options:
1. plugin-ui singleton: the kit's style entry checks a well-known id (`dshfiles-ui-sheet` + content hash) and injects
   once; later plugins skip. Needs dshx to let a plugin opt out of its folded CSS asset, or the kit inlines CSS as a
   string and builds no Vite CSS asset.
2. A tiny `@dshfiles/theme` plugin that only ships the sheet and loads first; other plugins build with no CSS.

Recommend 2 if dshx load order is controllable (`dependencies` in the plugin manifest), else 1. Keep the dshx
ownership/HMR removal working (one owner for the sheet).

Acceptance: 1 sheet in the DOM; no visual diff on each plugin panel (screenshot pass); style recalc on palette open
under target; plugin uninstall/HMR still clean.

> Prompt: "In dshfiles, make all @dshfiles plugins share ONE Tailwind sheet instead of each injecting a copy. Read
> tooling/dshx/DECISIONS.md (client CSS) and docs/guides/build.md, plugins/@dshfiles/plugin-ui/README.md. Prefer a
> first-loading `@dshfiles/theme` plugin if dshx supports load order; otherwise a plugin-ui singleton keyed by a
> hashed style id. Verify in the web UI that exactly one sheet exists and panels look unchanged. One jj revision."

### [x] P0.3 Palette: debounce-free fast filter + virtualization (M) — deps: P0.1

Check in `thread-sidebar/src/palette.ts` + `thread-palette.tsx`: cmdk's built-in `filter` runs on every item per
keystroke and mounts every row. Fix: `shouldFilter={false}`, rank once with the existing weighted `rankThreads`
(+ Host `rankByName`, L6), cap rendered rows (~50) or virtualize with `@tanstack/react-virtual`, memoize the item
list on stable inputs, `useDeferredValue` for the query. Precompute lowercase/search keys once per thread list.

Acceptance: palette targets met with 2,000 synthetic threads; palette.test.ts still green; new perf test (P0.6).

> Prompt: "Speed up the thread-sidebar ⌘P/⌘K palette (plugins/@dshfiles/thread-sidebar/src/palette.ts,
> thread-palette.tsx). Disable cmdk internal filtering, rank once per query with rankThreads, precompute search
> keys, cap/virtualize rows, useDeferredValue for input. Target: open < 50 ms, keystroke < 16 ms with 2,000
> threads. Keep tests green; add a render-count/perf regression test."

### [x] P0.4 Sidebar re-render storms (M) — deps: P0.1

Check `sidebar-state.tsx` provider (one context value object → every consumer re-renders), unstable callbacks/props
into row components, `useSyncExternalStore` snapshots that return new objects each call (must be cached by
version), session-list selectors that rebuild arrays. Fix: split contexts (state vs actions), stable selectors,
`memo` rows keyed by session id, snapshot caching.

Acceptance: ≤ 1 commit per unrelated session update; only changed rows in the Profiler flamegraph.

> Prompt: "Fix re-render storms in plugins/@dshfiles/thread-sidebar (sidebar-state.tsx, sidebar-shell.tsx,
> client.tsx). Use React Profiler in the live UI to confirm the cause first. Split state/action contexts, cache
> useSyncExternalStore snapshots, memoize rows. Acceptance per plans/ade/README.md P0.4."

### [~] P0.5 Bundle and polling diet (M) — deps: P0.1

- Minify client bundles if dshx builds unminified; report gz before/after.
- jujutsu 1.88 MB: keep `@pierre/diffs` but lazy-materialize the diff view (render only when opened), check the
  slim Shiki alias still applies, drop duplicate deps (`pnpm why`).
- Polling: `jujutsu/auto-refresh.ts`, `multi-host/client.tsx` lease poll (#14), `thread-sidebar/client.tsx`
  interval, ai-accounts `refetchInterval`s: pause when `document.hidden` or the pane is closed; prefer Host
  `changes` streams over polling where they exist.

Acceptance: idle-CPU target met; total client JS down ≥ 25 %; no feature regressions in smoke e2e.

> Prompt: "Reduce DSH plugin bundle size and idle CPU in dshfiles: check dshx minification, analyze
> jujutsu/dist/client.js composition, dedupe deps, and pause every setInterval/refetchInterval when the tab is
> hidden or the pane is closed (jujutsu auto-refresh, multi-host lease, thread-sidebar, ai-accounts). Report
> before/after sizes and idle trace."

### [~] P0.6 Perf regression check (S) — deps: P0.3, P0.4

A Playwright journey in the existing e2e harness ([dsh-e2e-testing](../dsh-e2e-testing.md)): seed 2,000 threads,
open the palette, type, assert `performance.measure` durations and a React render counter exposed only in test
builds; assert one `style[data-plugin]` Tailwind sheet. Fails CI on regression beyond 2× target.

> Prompt: "Add a perf regression e2e to dshfiles: seed 2,000 threads, measure palette open and keystroke latency
> with performance marks, count sidebar renders, assert a single shared Tailwind sheet. Thresholds from
> plans/ade/README.md Phase 0."

## Phase 1 — Finish the remaining cleanups

| Step | Audit ids | Size | Deps | Acceptance |
|---|---|---|---|---|
| [x] P1.1 xstate pilot: `@dshfiles/plugin-ui/machine` + jujutsu workspace restore | #7 | M | — | restore flow is one machine; tests drive states, not effects |
| [x] P1.2 jujutsu drag → preview → confirm machine | #16 (+ optional L9) | M | P1.1 | same machine shape as #7; drag cancel/escape covered |
| [x] P1.3 ai-accounts auto-save machine (both editors), then draft out of useState | #13, finishes #1 | M | P1.1 | one auto-saver; no lost edits on fast typing |
| [x] P1.4 multi-host lease actor per runtime view | #14, #19 | M | P1.1 | no global error mirror; lease poll stops when view closes |
| [x] P1.5 Host utility swaps | L4, L5, L6 | S | — | one relative-time fn, Host clipboard, `rankByName` for label filter |
| [x] P1.6 `createStoredValue(key, zodSchema)` in plugin-ui + 5 stores | L7 | S | — | storage-event sync across tabs; invalid JSON falls back |
| [x] P1.7 Query/Form leftovers (#17 #18 #21 #22 skipped, see audit) | #9, #10, #15, #17, #18, #20, #21, #22, #23 | M | — | no hand-rolled loading/error state left in those files |
| [x] P1.8 Customize: move up/down buttons | L8 | S | — | keyboard-only reorder works |
| [x] P1.9 yaml parseDocument check | L10 | S | — | malformed provider patch rejected on host side |
| P1.10 jujutsu revision list VirtualList | L3 | M | P0.5 | 500 rows scroll at 60 fps |

> Prompt (P1.1): "Implement the xstate pilot from plans/plugin-state-audit.md #7: add `@dshfiles/plugin-ui/machine`
> (thin xstate v5 + React helpers, pinned in plugin-ui) and rewrite jujutsu/src/workspace-restore-panel.tsx as a
> select→prepare→confirm→receipt machine. Tests over machine transitions. Tick #7 in the audit."
>
> Prompt (P1.5–P1.6): "Do plans/plugin-state-audit.md L4, L5, L6, L7 in dshfiles: swap to Host relativeTime,
> writeClipboard, rankByName; add plugin-ui `createStoredValue(key, zodSchema)` and migrate the 5 listed stores.
> One jj revision per id."
>
> Prompt (P1.7): "Finish plans/plugin-state-audit.md items #9 #10 #15 #17 #18 #20 #21 #22 #23 with TanStack
> Query/useAppForm via @dshfiles/plugin-ui. One jj revision per plugin; tick each in the audit."

## Phase 2 — ADE foundations (files, editor)

New plugin `@dshfiles/explorer` (client + small host part for anything the Host lacks).

### [x] P2.0 Docking probe (M) — deps: none

Decision 2 in [decisions.md](decisions.md): a move-anything layer under the editor. Trellis is non-commercial or
sponsor-only, so it is out. The probe uses dockview-react 8.4.1 (MIT) in `@dshfiles/workbench`: a `main`-slot
workbench, a page-wide panel registry (`workbenchPanels()` from `@dshfiles/workbench/registry`), persisted layout,
reset, and unknown-panel recovery. Licence check, alternatives table, gaps, and how the editor docks in:
[docking.md](docking.md).

Acceptance (met): moving, tabbing, splitting and floating a panel does not remount it (jsdom tests, plus real mouse
drags in a probe instance on :3197: mount count unchanged, textarea draft and ticker kept). The layout survives a
reload. Reset and unknown-panel recovery are tested. One shared plugin sheet once every UI plugin is rebuilt.

### P2.1 Decide tree component (S, spike) — deps: P0.2

Criteria: virtualization for 10k+ nodes, keyboard nav (arrows, type-ahead, Home/End), lazy children from
`workspaceFiles.list`, live updates from `changes`, drag/drop (later), a11y tree roles, bundle cost, theming via
plugin-ui tokens.
- `@pierre/trees` 1.0.0-beta.6: virtualized, keyboard, same vendor as `@pierre/diffs` (shared Shiki/theming); cost:
  Preact 11 **beta** runtime inside a React plugin (~10 KB gz, but beta + two renderers + bridging).
- Own tree on plugin-ui: `@tanstack/react-virtual` (already used) + flat visible-row list + roving tabindex; ~300
  lines; no new runtime.
- Host `dsh-client-ui-sidebar-files`: reuse if it can be mounted from a plugin (check exports); zero bundle cost.

Recommendation: try Host reuse first; else own tree on plugin-ui. Adopt `@pierre/trees` only if the spike shows it
gives keyboard + virtualization + DnD that would cost > M to build, and its beta API is stable enough.

Acceptance: decision note in this file with measured bundle delta and a 10k-node scroll trace.

> Prompt: "Spike the file tree for a new @dshfiles/explorer plugin. Compare (a) mounting the Host
> dsh-client-ui-sidebar-files tree, (b) an own virtualized tree on @dshfiles/plugin-ui + @tanstack/react-virtual,
> (c) @pierre/trees 1.0.0-beta.6 (Preact 11 beta runtime). Measure bundle delta and 10k-node scroll; check
> keyboard nav and live updates via workspaceFiles.changes. Record the decision in plans/ade/README.md P2.1."

### P2.2 Explorer panel (M) — deps: P2.1

Right-panel tab (`sidebarRightTabs.register`) + optional left slot: workspace root per active session, lazy
`list`, `changes` watch per expanded dir (abort on collapse), reveal-active-file, copy path, open in editor.
"Browse any folder" outside workspaces needs `uiWorkspace.listDirectory` (read-only listing) — reading content
outside a session scope is a Host gap.

Acceptance: 10k-file repo expands without jank; external file create shows up < 1 s; works with no session (pick
workspace).

### [x] P2.3 Editor: Monaco vs CodeMirror 6 (S, decision) — deps: P0.5

Done: Monaco (decisions.md #1), built in `@dshfiles/editor`; workers/CSS approach and numbers in [editor.md](editor.md).

| | Monaco (`monaco-editor` ESM) | CodeMirror 6 |
|---|---|---|
| Size | ~2.5–4 MB min (core + languages), +CSS | ~150–400 KB min with a few languages |
| Workers | needs editor/TS/JSON/CSS workers; dshx rejects workers → blob-URL from inlined source string, or run without workers (no TS intellisense, sync tokenization) | none required |
| VS Code feel | exact (keybindings, minimap, diff editor, multi-cursor) | close; via extensions |
| Theming | own theme JSON, map from `--dsw-*` | CSS vars directly |
| Highlighting shared with `@pierre/diffs` Shiki | possible via `shikiToMonaco` | via Shiki/Lezer bridge or Lezer grammars |

Recommendation: **CodeMirror 6** for v1 (fits the single-chunk budget, no workers, Tailwind/CSS-var theming), lazily
materialized only when an editor tab opens. Revisit Monaco only if users need the VS Code diff editor/intellisense
and dshx gains worker support or blob workers prove reliable. If the user insists on Monaco: own plugin
`@dshfiles/editor` so only it pays the size; `@monaco-editor/react` is out (CDN loader = extra chunk).

Budget: editor plugin ≤ 600 KB min client.js; first editor open < 150 ms.

### [~] P2.4 File viewer/editor tab, read-only first (M) — deps: P2.2, P2.3

Editable from the start (`@dshfiles/editor`: right-panel tab + workbench panel, own tree, tabs, live reload). Not yet:
ranged reads for files > 5 MB, binary/image preview fallback. See [editor.md](editor.md).

Open `workspaceFiles.read` (ranged for big files, `readBytes` for binary → preview), language from extension,
Shiki theme shared with `/diff`, live reload on `changes`, go-to-line, find. Tabs in the right panel with a
small in-plugin tab strip until Host multi-pane exists.

Acceptance: 5 MB file opens (ranged) without freezing; binary/image falls back to preview; theme follows Host.

### [~] P2.5 Open-from-anywhere (S) — deps: P2.4

`dshfiles:open-file` window event (`{ path, line?, cwd? }`, cancelable); wired from jujutsu file rows. `/diff`, thread
tool-call paths and the palette are still to wire.

A plugin-ui event/service `openFile({ sessionId, path, line? })`: from `/diff` file header, jujutsu file rows,
search results, thread tool-call file paths, palette (P3).

### [x] P2.6 Save (M, Host-gated) — deps: P2.4, Host write API

Host part of `@dshfiles/editor` (`editor.write`): session-root confinement, symlink checks, 8 MB cap, atomic
rename, sha256 conflict detection; UI confirmation instead of `ctx.approval` (needs an Agent turn). Gaps in
[editor.md](editor.md).

`workspaceFiles` has no write. Options: host part of `@dshfiles/explorer` exposing `write(sessionId, path, text,
expectedMtime)` with workspace-root confinement, symlink check, size cap and conflict detection; or upstream write.
Permissions: confirm before writing outside the session workspace; never write while an agent turn edits the same
file (check session busy state). Acceptance: conflict detected on concurrent edit; path traversal tests.

### P2.7 jj/git gutter (M, later) — deps: P2.6, jujutsu core

Line change markers from `jj diff` for the open file; click → hunk in `/diff`.

> Prompt (P2.2–P2.5): "Build @dshfiles/explorer per plans/ade/README.md P2.2–P2.5: right-panel tab file tree
> (component chosen in P2.1) over workspaceFiles.list/changes, read-only CodeMirror 6 viewer lazily materialized,
> Shiki theme shared with @dshfiles/plugin-ui/diff, and an `openFile` plugin-ui service wired from /diff and
> jujutsu file rows. Respect dshx single-chunk (no workers/assets). Report bundle size."

## Phase 3 — Command palette as the hub

### P3.1 Action registry (M) — deps: P0.3

plugin-ui service `commands.register({ id, title, category, keywords, shortcut?, when?, run })` returning a
disposer; cross-plugin transport via a typed `window` CustomEvent or a dshx-shared service if available. Palette
(thread-sidebar) renders categories: Threads, Files (⌘P fuzzy open), jj actions, Plugin pages, Settings
(settings-search), MCP, Explorer. Absorb `sidebar-commands/go-to.ts`.

### P3.2 Fuzzy file open ⌘P (M) — deps: P3.1, P2.5

File index per session: walk `workspaceFiles.list` (respect .gitignore — needs Host or host-part `rg --files`),
incremental via `changes`; fuzzy rank in a time-sliced loop (no worker); ≤ 50 ms for 50k paths.

### P3.3 Frecency + keyboard-first (S) — deps: P3.1

Recent/frecent items per category stored with `createStoredValue` (P1.6); every action reachable without the
mouse; virtualized result list (from P0.3).

Acceptance (phase): any plugin can add an action in ≤ 10 lines; palette targets from Phase 0 still met with 500
actions + 50k files.

> Prompt: "Turn the thread-sidebar palette into a hub per plans/ade/README.md Phase 3: a plugin-ui command registry
> other plugins contribute to, categories, ⌘P fuzzy file open over workspaceFiles, frecency via createStoredValue.
> Keep Phase 0 latency targets; extend the perf e2e."

## Phase 4 — Later

- Terminal pane (xterm.js; needs a Host PTY stream — gap).
- Search in files (ripgrep via a host part or Host API; results open via `openFile`).
- LSP (Host-side language server process + JSON-RPC stream; Monaco or CodeMirror LSP client) — Host gap.
- Multi-pane layout, drag tabs between panes (software-additions P2 panel movement — Host gap).
- Symbols in palette (needs LSP or ctags).

## Host capabilities missing (candidates for dsh-host-gaps.md — not edited here)

| Capability | Needed by | Possible route |
|---|---|---|
| `workspaceFiles.write/rename/delete/mkdir` with mtime conflict check | P2.6 | upstream or host part of explorer |
| File access outside a session scope (browse any folder) | P2.2 | `uiWorkspace` read API, or session-less scope id |
| Ignore-aware file listing / search (`rg --files`, `rg` content) | P3.2, Phase 4 | Host API or host part |
| Workers / extra assets in dshx client bundles | Monaco, fuzzy index | dshx option for inlined blob workers |
| Shared CSS/runtime across plugins (one sheet, one React) | P0.2, P0.5 | dshx shared-asset or plugin load order |
| Cross-plugin service/command registry | P3.1 | dshx-provided service channel |
| PTY stream | terminal | Host terminal service |
| LSP process + stream | Phase 4 | Host process service |
| Multi-pane / movable panels, editor tabs in main area | P2.4, Phase 4 | Host layout slots |
| Main-area slot (open a file in the center, not only right panel) | P2.4 | Host workspace slot |

## Order

P0.1 → P0.2 ∥ P0.3 ∥ P0.4 → P0.5 → P0.6 → Phase 1 (parallel, any order; P1.1 before P1.2–P1.4) → P2.1 → P2.3 →
P2.2 → P2.4 → P2.5 → P3.1 → P3.2/P3.3 → P2.6 (when write lands) → Phase 4.

## Open questions

1. Monaco is the stated wish; is CodeMirror 6 acceptable for v1 given the single-chunk/no-worker constraint?
2. Should the editor live in the right panel (works today) or wait for a Host main-area slot?
3. Save: build a host-part write API in dshfiles, or push upstream DSH for `workspaceFiles.write`?
4. "Browse any folder": limited to registered workspaces, or anywhere on disk (security trade-off)?
5. Shared Tailwind sheet: acceptable to add a `@dshfiles/theme` plugin that every other plugin depends on?
6. Preact runtime: only if `@pierre/trees` clearly wins the P2.1 spike — agreed?
7. Perf targets: are 50 ms open / 16 ms keystroke the right bar, and on which machine?
8. Should xstate (Phase 1) wait until Phase 0 lands, or run in parallel by another agent?
