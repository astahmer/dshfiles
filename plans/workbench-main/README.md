# Workbench as the main view — dockable panels for anything, slot-compatible

> **Status: proposed (2026-10-25).** No code yet. Successor to [`plans/global-dock`](../global-dock/README.md):
> that plan's M1–M3 and cross-region drag landed; its open M4 (native right-sidebar resources) is M5 here.
> **Resume here:** **M0** — inventory every slot domain and panel source, then start **M1** (the frame seat that puts the
> workbench in the centre column and hosts the conversation as its first panel). Read [Decisions](#decisions) first;
> they are answered and binding.

## Objective

Make the workbench DSH's main view: the centre column becomes one workbench layout in which the conversation and every
global panel are dockable panels, any content can be added as a panel, panels resize, tab, float and drag anywhere, and
existing DSH slot contributions keep working — as panels, or inside panels.

Four clauses, all mandatory (100 % completion, no phase silently dropped):

- **G1 — the main view is the workbench.** The centre column is a workbench layout. The conversation (a thread) and every
  global main panel (Plugins, Jujutsu, Backlog, AI Accounts, Memory, Editor, Settings, …) are panels inside it, arranged
  by the user rather than replacing each other.
- **G2 — anything becomes a panel.** One Add-panel source covers every registered `main` entry, every plugin workbench
  panel, every slot a declarer we own can host, and the native resources people use (file preview, diff, terminal,
  editor, chat, settings). Community plugins that render into a standard DSH slot keep working without changes.
- **G3 — free layout.** Split, tab, float, resize, and drag panels anywhere between the centre, the right column and the
  bottom row; nested surfaces inside panels; each region and each nested surface persists its layout; named layouts
  capture and restore everything.
- **G4 — slot compatibility.** Slot contributions render where they render today. A contribution can be shown as a
  workbench panel when its declarer is ours; when it is not, the route is an opt-in panel registration or a recorded
  Host gap. Inside a panel, the panel may declare and render its own slots as usual.

## Decisions

Each was put to the user on 2026-10-25; the answers are recorded here and are not reopened by later phases.

- **W1 — the frame owns the centre seat.** `@dshfiles/frame-layout` declares a new root seat for the main surface and a
  `ctx.mainSurface` face (`mode(): 'native' | 'workbench'`, `setMode`), exactly like `ctx.rightPanel`. The workbench
  occupies that seat; the native `main` rendering stays the fallback. Rationale: the frame already declares `main` and
  thus already holds the only legal render function for keyed main entries; a `workspace-nav` fork would have to
  re-declare it. _("whatever is best" — user.)_
- **W2 — the end game has no separate tab strip.** Dockview tabs become the main view's tabs, carrying the behaviour
  `@dshfiles/main-tabs` has today (preview/pin, thread indicators, close semantics, thread open/move). Until that parity
  exists the strip stays above the centre as an adapter. _("if it is option B in the end; then option B" — user.)_
- **W3 — the workbench becomes the default once functional.** A `mainSurface: 'workbench' | 'native'` setting ships; the
  default flips to `workbench` when the workbench main view is fully functional, and users can opt out explicitly.
  _("whenever the workbench is enabled & fully functional then it becomes the default unless explicitly disabled" — user.)_
- **W4 — community compatibility through the same slots.** If a community plugin renders into a slot, the workbench offers
  that slot as a panel. Achievable where the declarer is ours (frame, sidebar-right, conversation/chat forks,
  settings-shell, workspace-nav, thread-sidebar); for a foreign declarer the entry point is the documented panel
  contract plus a Host-gap row, never a fake. _("we should have the same slot as a workbench panel" — user.)_
- **W5 — nested surfaces, arbitrary depth.** A panel may contain another Dockview, and that inner surface supports the
  same operations, as far as Dockview allows. Each nested surface persists under a key scoped by its panel path.
  _("infinitely nestable; like w/e the lib that we use allow" — user.)_

## The end game (what "100 %" looks like)

1. Open DSH. The centre column is the workbench. The current thread's conversation is a panel; the tab row above it is
   Dockview's, with the same preview, pin and unread indicators the old strip had.
2. **Add panel** lists: every global main panel by its registered label, every plugin workbench panel, resource panels
   (files, diffs, terminals), and settings pages. Picking one docks it; it does not navigate away.
3. Drag a panel's tab to the right column or the bottom row, drop it there, or drop it onto another panel's edge to
   split. Drag it into a panel that hosts a nested surface to nest it deeper. Reload: everything returns.
4. Any slot contribution that used to appear inside the conversation or the sidebars still appears — either in place, or
   as a panel with the same content, depending on where its declarer renders.
5. `main-tabs` is retired; its semantics live in the workbench. Settings, shortcuts, the command palette and agent tools
   all agree on the same panel set.

## Today (evidence, 2026-10-25, `main`)

Landed and reused by this plan:

| Piece                                                                                                                                           | Where                                                                                                         | State                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------- |
| Frame fork owning `root` and its children (`sidebar`, `main` keyed, `rightbar`, `shell.dock`, `shell.bottom`, `shell.overlay`, `shell.leading`) | `plugins/@dshfiles/frame-layout`                                                                              | landed                |
| `ctx.layout` (`selectPanel`), `ctx.rightPanel` (`setMode`/`mode`), `ctx.frameBottom` (`open`/`close`/`height`)                                  | same                                                                                                          | landed                |
| Workbench surfaces: `main` entry (`dshfiles-workbench`), `shell.dock`, `shell.bottom`, per-thread right-pane tab                                | `plugins/@dshfiles/workbench`                                                                                 | landed                |
| Page-global panel registry (`workbenchPanels()`, `dshfilesWorkbenchPanelsV1`) with preferences and queued opens                                 | `workbench/src/registry.ts`                                                                                   | landed                |
| Region registry + cross-region drag, including a drop over an empty region                                                                      | `workbench/src/dock-regions.ts`, `workbench-view.tsx`                                                         | landed (`8a3c5f25`)   |
| Per-surface layout stores and named layouts                                                                                                     | `workbench/src/layout-store.ts`, `saved-layouts.ts`                                                           | landed                |
| Tab strip with preview/pin/indicator/thread semantics                                                                                           | `plugins/@dshfiles/main-tabs`                                                                                 | landed (portal mount) |
| Settings as a real main panel                                                                                                                   | `plugins/@dshfiles/settings-shell`                                                                            | landed (port)         |
| Plugin panel contributions                                                                                                                      | `editor`, `jujutsu`, `backlog` register workbench panels; thread-sidebar and main-tabs read the same registry | landed                |
| Panel ↔ native side panel bridge                                                                                                                | `dshfiles:move-panel-aside`, `dshfiles:open-panel-tab`, `dshfiles:panel-scope`                                | landed                |

Verified facts the design depends on:

- `AppFrame` renders the centre as `renderSlot('main', {}, { entryKey: activePanelId ?? 'conversation' })`; the `main`
  slot is `keyed`, `root` scope, declared by the frame.
- Declaring a slot is claiming it: only the declaring entry may render it, its props are composed privately, and
  re-declaring a declared child throws (`@deepseek-ai/dsh-client-ui-slots` README). Packages that declare slots today:
  `dsh-client-ui-layout` (frame), `dsh-client-ui-sidebar`, `dsh-client-ui-sidebar-right`,
  `dsh-client-ui-conversation`, `dsh-client-ui-settings`, plus our forks/ports (`frame-layout`, `chat`, `rich-composer`,
  `settings-shell`, `workspace-nav`, `thread-sidebar`, `user-questions`).
- About fifteen plugins already register global `main` panels (`activity-timeline`, `agent-communication`,
  `agent-toolkit`, `agents`, `ai-accounts` ×3, `background-jobs`, `backlog`, `jj-integration`, `jujutsu`,
  `mcp-servers`, `workbench`, …) with key/label/locale visible to `ctx.slots.entriesOfSlot('main')`. Their components
  are private to the renderer; the frame can render them, a plugin cannot.
- `main-tabs` portals its strip in front of `[data-slot="main"]` and records the missing seat above the main panel as a
  Host gap; that mount breaks when the centre becomes a seat.
- Native right-sidebar resources (preview, diff, terminal) render only inside the session-scoped tab domain of
  `dsh-client-ui-sidebar-right`; today the dock yields the right column back to native while such a tab is open
  (`workbench/src/right-panel-mode.ts`), and the addressable-resource-renderer route is recorded in
  [`plans/dsh-host-gaps.md`](../dsh-host-gaps.md).

## Slot compatibility matrix (W4)

| Declarer                                            | Representative slots                                                                                  | Workbench panel form                                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Frame (`frame-layout`)                              | `main` (keyed), `sidebar`, `rightbar`, `shell.dock`, `shell.bottom`, `shell.overlay`, `shell.leading` | direct: the frame hands the render function for a keyed main entry to a workbench panel (M1/M2)              |
| Sidebar-right (native)                              | `sidebar.right.pane.tab`, and its resource tabs                                                       | resource panels via the addressable renderer (M5), or a fork of the package if the renderer route is refused |
| Conversation / chat (ours: `rich-composer`, `chat`) | `conversation.view`, turn tail, message nodes                                                         | panel hosts the conversation surface; sub-views stay inside it (M1), deeper hosting in M2                    |
| Settings (`settings-shell` port)                    | `settings.section`, `settings.page` seats                                                             | each section can become a panel once the port exposes it (M2)                                                |
| Sidebar (native)                                    | `sidebar.panellist` and the workspace seats                                                           | needs a fork of `ui-sidebar` or an opt-in registration; decide in M0, record the gate                        |
| Any foreign plugin                                  | any slot it declares                                                                                  | only through the documented panel contract; otherwise a `plans/dsh-host-gaps.md` row                         |
| Any plugin (no slot at all)                         | —                                                                                                     | `workbenchPanels().register(...)`, today's contract, unchanged                                               |

M0 completes this table: enumerate the live ledger (`dshx inspect slots --root main`, `--root sidebar`, and the
runtime's slot inspection), name every slot's declarer, and mark each row `hostable`, `needs-cooperation` or `host-gap`.

## Phases

| Phase  | Task                                                                                                                                                                                                                                             | Acceptance                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M0** | Inventory: every slot domain and its declarer, every panel source, the layout keys in use; write the matrix above and the Host-gap rows; confirm the nested-surface question on Dockview 8.5.1 (spike, no product code)                          | the matrix is filled with verified declarers; a written answer on nested Dockview and per-path persistence; gaps recorded                                                |
| **M1** | Frame seat: `shell.main` + `ctx.mainSurface`; frame passes a keyed-main renderer to the occupant; workbench occupies the seat, renders the conversation as its first panel, guards recursion on `dshfiles-workbench`; native remains the default | journey `workbench.main-hosts-the-conversation` (thread visible as a panel, switching threads works, no slot crash); native mode untouched; main-tabs strip still mounts |
| **M2** | Panel source: one Add-panel list over registered `main` entries, workbench registrations and hostable slots; panel identity/labels from the entry options; palette, tab lists and agent tools read the same source                               | journey `workbench.add-a-main-panel`; every registered main entry appears once and opens as a panel; the old plugin-panel path still works                               |
| **M3** | Regions unified: the centre joins the region registry; drag centre ⇄ right column ⇄ bottom row; adopt the empty-target drop-zone pattern; layout migration from the existing keys                                                                | journey `workbench.drag-across-all-regions` (real pointer input, lay-out persisted per target); old saved layouts restore                                                |
| **M4** | Tab parity and strip retirement: Dockview tab chrome carries preview/pin/unread/close/move-to-side-panel; `main-tabs` reduces to a semantics provider or is removed; strip removed above the centre                                              | journeys for preview/pin/indicator/close plus the thread-open path; `main-tabs` docs and catalog updated or the plugin retired; screenshot refreshed                     |
| **M5** | Native resources as panels: addressable resource renderer for file preview, diff and terminal (or the fork route if the renderer is refused); the right-column native fallback rule retires                                                      | journey `workbench.slots-stay-compatible`: a file preview, a diff and a terminal each open as panels; the right column no longer yields to the native surface            |
| **M6** | Nesting (W5): a panel may host a nested Dockview; each nested surface persists per panel path; dragging into and out of a nested surface works                                                                                                   | journey with a nested surface: split inside a panel, drag a panel into it and back out, reload restores both levels                                                      |
| **M7** | Default flip and finish: `mainSurface` default `workbench`; docs (plugin READMEs, this plan retired via the `complete-plan` skill), screenshots, telemetry catalog entries, tool parity; live audit on `:3080` before claiming the win           | all journeys green on `main`; live GUI measured (no regression beyond the agreed budget); user restarts `web` and confirms                                               |

Each phase lands as described revisions on `main` (one logical change each), with its journey and its docs in the same
landing where that is small enough to keep the phase honest.

## Risks

- **Slot render authorization is the whole compatibility story.** Anything not covered by the matrix needs a fork or an
  opt-in; inventing a client-side mirror of another package's state is the failure mode to avoid.
- **The conversation is not a naive panel.** It owns scroll anchoring, viewport virtualization, keyboard and focus
  behaviour, and the chat fork exists to mount only visible rows. Hosting it inside a Dockview must not remount it on
  every layout change (`renderer: 'always'` semantics) and must keep its scroll contract.
- **main-tabs' portal mount breaks the moment the centre becomes a seat.** M1 must keep the strip working or land with a
  frame seat for it; the `main-tabs.strip-mount` journey is the tripwire.
- **Layout migration.** Users already have `dshfiles.workbench.layout.v1`, `…dock-layout.v1`, `…bottom-layout.v1`,
  `…side-panel-layout.v1` and named layouts. Read them, migrate, never silently revert to defaults.
- **Dockview cross-instance drops.** Its layout-edge target refuses a foreign transfer (memory `n:59`), so every empty
  region needs the embedder's drop zone; nested surfaces multiply the cases.
- **Performance.** One large surface with many panels: measure on the live `:3080` with the `live-performance-audit`
  skill before and after, and keep hidden panels from re-rendering the world.

## Verification notes

- Checks: `pnpm --dir plugins run contract`, `pnpm exec turbo run build/typecheck/test --filter=@dshfiles/…`,
  `pnpm run check:e2e workbench`, `node --run check:diff -- --from main --to @`,
  `pnpm --dir tooling/dshx run features:check`, `node tooling/dshx/scripts/browser-tasks.mjs`,
  `node --run check:screenshots`.
- `bddgen test --config=playwright.e2e.config.ts` must run after any `.feature` edit; otherwise Playwright runs stale
  specs and a new step silently does not exist.
- `node --run <script> <arg>` drops the argument (memory `n:44`): use `pnpm run check:e2e <plugin>`.
- A new Tailwind utility exists only after `@dshfiles/ui-styles` is rebuilt.
- `workbench.surface-layouts` is red on a clean `main`; fix it here rather than inheriting it as a known failure.
