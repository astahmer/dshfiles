# Thread Sidebar

This bundle builds a full sidebar replacement with the repository's local
`@dshfiles/dshx` fork. It groups the real DSH session list by project and
status, with pinned, active, parked, inactive, and archived sections. The
project picker scopes those rows to one workspace or unassigned sessions.

Running state comes from `SessionSummary.running`. Pin and archive state come
from the Host Workspace controller stream. Pin, unpin, archive, and restore
call that controller directly. Auto-archive is off by default; when enabled,
the configured scan interval checks idle age and only calls
`archiveSession(sessionId, { stopActivity: false })`. It skips running, blank,
archived, pinned, parked, excluded-session, and excluded-project entries.

Sidebar preferences live in DSH Settings under the Host-synced `thread-sidebar`
namespace (`src/settings.ts`, registered by `src/host.ts`). User-facing fields
(header style, density, icon-row overflow, recent-thread count, auto-archive)
appear in the generated settings form; layout state (order, visibility,
collapsed sections, project filter, split height, chords) is hidden there.
Values previously kept in browser `localStorage` (`dshfiles.thread-sidebar.v1`)
are copied once into keys the Host still holds at their default, then removed.
Browser storage is only used while the Host namespace is unavailable.

**Header navigation** follows BB's Sidebar Resize. Compact mode (and expanded
mode once its pane is dragged to 76px or less) renders one horizontal icon row
that scrolls sideways (wheel included, scrollbar hidden, faded edges) with a
pinned ⋮ button. The ⋮ menu is a filterable list ("Filter destinations…") of
every destination plus **Customize sidebar**. Overflow can be Scroll, Overflow
menu (only fitting icons, the rest in ⋮), or Scroll + menu (default).
Expanded mode is a labelled list with a trailing Customize row; density is
Compact (30px rows) or Comfortable (34px). Dragging the splitter past 76px from
the icon row switches to expanded.

**Brand logo.** Customize › Show brand logo (setting `hideBrandLogo`, off by
default) drops the Host brand mark and name from the header to make room; the
collapse button stays, drawn as a panel icon. With the setting off the header
renders the Host's `sidebar.brand.*` slots unchanged.

**Back / Forward.** The header ← → walk visited threads and panels (⌘[ / ⌘]).
Right-click or hold either arrow, or click the ▾ beside them, for the recent
history menu (newest first, current entry marked); picking an entry jumps there
and keeps the rest for Back and Forward.

**Command palette.** Search threads, the ⌘ button in the header, and the
keyboard all open a shadcn `CommandDialog`: fuzzy search over thread title,
project, path, and ID prefix, recent threads when the query is empty,
destinations and actions (toggle sidebar, focus composer, customize, and Restart
DSH when launched through the managed supervisor) in the full palette, ⌘1–⌘9
on the first nine rows, and Enter to open. Restart asks for confirmation, then
requests a graceful Host exit; the Nix supervisor relaunches only its own DSH
child.

**Pending restarts.** Client bundles hot-reload; Host code, `package.json` and
`cordis.patch.yml` load only at boot. The Host half remembers a content hash of
those files for every plugin package the Host's client module registry lists
(at boot, or when a package joins the graph) and the shell checks again on
window focus and every minute. When any differ, a subtle "Restart DSH to apply
updates (N plugins)" row sits above the foot (a ↻ icon on the rail) listing the
packages; it opens the restart confirmation, and the `>` palette entry carries
the same label. Identical rebuilds flag nothing. Host-only packages without a
client bundle are not listed by that registry and are not tracked. Hosts
started before this plugin version report nothing. Keyboard entry
points:

- Capture-phase chords claimed before the browser: ⌘K / Ctrl+K palette,
  ⌘P / Ctrl+P thread search. Rebind or disable them in Settings › Plugins ›
  Thread sidebar shortcuts. A chord the Host shortcut catalog already binds is left to
  the Host (so desktop ⌘K stays native Search sessions).
- Host shortcut `threadSidebar.commandPalette` (⇧⌘P by default), editable in
  Settings › Shortcuts.
- Host `session.search` (⌥⌘K on the web, ⌘K on desktop) opens thread search:
  the native browser stays registered under this one, and its request store is
  followed through the slot ledger.
- Any bundle can dispatch the cancelable `dshfiles:command-palette` window
  event with `{ mode: 'all' | 'threads' }`; a `{ probe: true }` detail is only
  acknowledged (`/goto` uses it).

**Footer** entries render on one row and never shrink or wrap. Entries that do
not fit move into More (⋯) together with entries hidden in Customize; overflow
is recomputed from measured widths on resize.

`sidebar.footer.above` (list, owner `{}`) is a full-width seat stacked above the
wide foot, for rows that must not fold into More (the AI Accounts usage strip).
Its height counts against the header/thread resize limit. The stock sidebar has
no such seat, so an occupant keeps a footer-action fallback and registers through
`ctx.slots.inject`, which waits for the declaration.

**Settings › Plugins › Thread sidebar shortcuts** records the two palette chords
(record / disable / reset, with Host-conflict and duplicate warnings), which a
generated text field cannot capture.

Every thread row also exposes **Copy thread ID** and **Copy thread link** in
its right-click menu. Child sessions render with increasing indentation and a
direct “child of …” label. The sidebar follows DSH's durable `parentId` chain,
so the presentation is not limited to parent/child pairs; a child link carries
the workspace found on the nearest ancestor when the child has no direct
workspace membership.

Thread links use the root/index URL with `thread` and optional `workspace`
query parameters, for example `http://127.0.0.1:3080/?workspace=ws_…&thread=thr_…`.
This matches the installed frontend-static contract: it serves the app index
at the root or configured index path and returns 404 for other paths, so a
BB-style `/projects/…/threads/…` pathname would need a Host router change. On
load, the sidebar waits for the Host session catalog and opens the addressed
thread; selection changes update the URL. Copied links drop existing query
parameters and fragments, including process launch credentials, and resolve
only on the same DSH Host/origin where the session exists.

The web app already composes DSH's native subagent tools and presentation:
continuable children can run concurrently, and `list_agents`, `send_message`,
and `interrupt_agent` support parent-side orchestration. The native subagent
catalog traverses descendants recursively. The Host supports up to 8 live
continuable children by default, and each child persists its direct parent
session ID. The configurable `subagent.maxDepth` currently defaults to 1, but
the lineage model and sidebar do not bake in that depth. Change the native
Subagent depth setting when deeper delegation is desired.
The native `@` reference source already offers recent sessions and searches by
session ID, title, display label, or workspace path. An empty `@` query is
limited to the configured recent candidate count (default 50), with
same-workspace sessions ranked first. The menu also contains file and folder
references; session discovery searches metadata, not message bodies.

The full shell uses the public `sidebar` root slot and Host `ctx.layout` state
and actions for width, collapse, and panel selection.

Its root declaration owns the same seven child slots declared by the native
shell, plus `sidebar.footer.above`. The package patch disables `ui-sidebar` first: SlotCore refuses to redeclare an existing child
slot, and retained native declarations do not transfer render authorization.
The custom root and workspace browser both register at priority `-1000`, below
the Host's default priority `0`; lower priority wins the live single slot.

The shell has a horizontal drag handle between its navigation header and the
project/thread region. It adjusts the header's height while preserving at least
120px for the thread list. The height is saved with the other browser
preferences; double-clicking the handle restores the content-sized default.
Arrow keys resize in 24px steps, Home/End move to the smallest/largest
available header size, and the 0 key restores the content-sized default. The handle
is hidden when the Host collapses the sidebar to its narrow rail, where the
thread region is not rendered.

## Installed DSH 0.2.0-rc.2 sidebar contract

The installed `@deepseek-ai/dsh-client-ui-sidebar` contract exposes a
replaceable `sidebar` root with declared children for `sidebar.panellist`,
`sidebar.workspaces`, `sidebar.settings`, and `sidebar.footer.action`. Its
native `SidebarRoot` renders those same child slots, and the settings/footer
owners receive `{ wide }`. The installed slot renderer accepts an `only`
ID filter; the slot registry exposes live entries and change subscriptions.
This bundle reads those registrations and renders each one through the
declared child slot, including hidden footer entries from More.

The native root renders the settings trigger and footer action slots, but its
layout does not provide user-managed link order or visibility. Those controls
are plugin-owned state stored with the other sidebar preferences. The root
slot and child-slot contracts are sufficient; no Host change is needed for
compact/expanded header links, ordering, visibility, or footer More recovery.

## Marketplace decision

**Build with the local dshx fork.** No candidate covers the requested Host
semantics and full navigation customization together, so this bundle does not
adopt or vendor candidate code.

- [`@michengai/dsh-codex-ui` manifest](https://raw.githubusercontent.com/MichengAI/dsh-codex-ui/main/package.json)
  explicitly admits DSH 0.2.0-rc.2 for its imported client packages. Its
  [composition patch](https://github.com/MichengAI/dsh-codex-ui/blob/main/cordis.patch.yml)
  disables `ui-sidebar`, and its
  [sidebar implementation](https://github.com/MichengAI/dsh-codex-ui/blob/main/src/client/CodexSidebar.tsx)
  proves the public root-slot takeover path. It does not supply idle
  settlement, parked state, or user-managed compact/expanded ordering and
  visibility for header and footer entries.
- [WenhongPan/dsh-projects manifest](https://raw.githubusercontent.com/WenhongPan/dsh-projects/main/package.json)
  caps its client peers at the 0.1.0-rc.6 line and imports the removed
  `dsh-client-runtime`; its project/archive UI is not a DSH 0.2.0-rc.2 bundle.
  Its attention density modes describe project summaries, not header-link
  presentation or footer customization.
- [TOBYCAI/dsh-sessions-manager manifest](https://raw.githubusercontent.com/TOBYCAI/dsh-sessions-manager/main/package.json)
  also imports legacy `dsh-client-runtime` and depends on legacy archive/star
  routes. Its active/archive and auto-archive concepts do not provide the
  requested customizable root shell.
- [wzn16/dsh-auto-archive manifest](https://raw.githubusercontent.com/wzn16/dsh-auto-archive/main/package.json)
  does not declare DSH 0.2 peer compatibility. Its older implementation uses
  private workspace persistence fallbacks when an archive service is missing,
  so its idle guard is not safe to reuse against this Host.
- [`dsh-better-sidebar@0.24.1` manifest](https://raw.githubusercontent.com/omdsh-dev/DSH-better-sidebar/main/package.json)
  does admit DSH 0.2.0-rc.2, but its implementation uses the separate native
  right-sidebar API and a bottom workbench; it does not replace this main left
  sidebar or provide the requested header/footer link controls. The current
  [maintainer README](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/README_EN.md)
  describes that right-column scope.
- [`@anionex/dsh-pinned-sessions`](https://dshmarket.com) does not admit the
  installed DSH 0.2 peer line.

## Host contract gaps

- Host has archive/unarchive and pin/unpin verbs and projections. It has no
  parked-session verb or projection, so park is browser-local and does not
  sync across profiles or devices.
- Session exposes `updatedAt`, not a dedicated last-activity timestamp with
  inactivity semantics. Settlement uses that field and can therefore treat a
  metadata update as recent activity. A reliable idle policy needs a Host
  activity timestamp.
- The public root slot supports shell replacement; no Host change is needed
  for compact/expanded links, ordering, visibility, or More. The bundle keeps
  shell geometry and panel selection in the Host layout service.
- The installed static frontend server has no pathname router: unknown paths
  return 404. Thread links therefore use query-based root/index URLs; clean
  `/projects/:project/threads/:thread` paths need an explicit Host route and
  client route contract.

## Verification and composition

Focused tests use the installed rc.2 `SlotCore`: a live native sidebar's child
declarations reject a competing full root; after the native entry is disposed
as `ui-sidebar` is by the package patch, the custom root registers and wins at
`-1000`. The same test confirms the custom workspace browser wins its slot.
These are runtime-core checks, not a boot of the user's active DSH profile.

The parent workstream must add this package to its composed plugin list. This
child does not edit the active profile or root workspace manifests/lockfiles.
