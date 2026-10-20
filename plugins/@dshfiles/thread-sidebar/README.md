# Thread Sidebar

This bundle builds a full sidebar replacement with the repository's local
`@dshfiles/dshx` fork. It groups the real DSH session list by project and
activity, with pinned, active, parked, inactive, settled, and archived sections. Active
includes running or recently updated threads; the idle threshold moves older,
non-running threads to Inactive. Sections render in the saved `sectionOrder`
(preferences), shipped as pinned, active, parked, inactive, settled, archived:
drag a section header to move it, or focus one and press Alt+↑/↓. A section with
no rows folds away and keeps its saved slot while the shown ones reorder around
it. The project picker scopes rows to one workspace
or unassigned sessions.

**Project attribution.** A `jj-integration` thread workspace
(`<repository>-threads/<thread>`) is attributed to its owning repository. A
session the Host accounts to no workspace at all — for example after its thread
workspace registration was deleted, or when it was created with an explicit
`cwd` instead of a workspace — is attributed to the project its recorded `cwd`
resolves to: a registered workspace path, or the repository named by a
`<repository>-threads` directory. Truly unknown paths stay unassigned. This is
display attribution only: the Host Workspace registry is what `project_list`
and scope decisions read.

Running state comes from `SessionSummary.running`; recency uses its
`updatedAt` value. Pin and archive state come from the Host Workspace controller
stream. Pin, unpin, archive, and restore call that controller directly.

**Settled vs archived.** Archived is DSH's own hard verb: it stops the work it
names, blocks every later wake-up, and hides the thread from native navigation
until it is restored. Settled is this plugin's own status: the thread stays
listed and openable, the archive verb is never called, and the Host refuses the
model steps it proposes until it is unsettled. Auto-settle is off by default;
when enabled, the configured scan interval checks the same idle threshold and
writes `settledSessionIds`. It skips running, blank, archived, pinned, parked,
already-settled, excluded-session, excluded-project, and still-running-descendant
entries. A thread menu can inherit the global setting, explicitly settle that
thread, or exclude it; explicit per-thread enables still honor excluded projects
and other safety checks. Settling records the instant in `settledAt`, which is
what the composer banner dates and what the separate settled auto-archive delay
counts from. It also answers jj-integration's **Settle** action in its post-rebase
notice (`src/settle-request.ts`): the sidebar owns this status, so the notice asks
through the cancelable `dshfiles:thread-settle` window event instead of writing a
second copy.

Sidebar preferences live in DSH Settings under the Host-synced `thread-sidebar`
namespace (`src/settings.ts`, registered by `src/host.ts`). The plugin draws its
own **Settings › Thread sidebar** section (`src/settings-tab.tsx`, registered by
`src/client-entry.tsx`) for the preferences the generated form cannot show. The
generated Plugins page still carries the user-facing namespace fields
(header style, density, icon-row overflow, recent-thread count, inactive
threshold, auto-settle); layout state
(order, visibility,
collapsed sections, project filter, split height, chords) is hidden everywhere.
Values previously kept in browser `localStorage` (`dshfiles.thread-sidebar.v1`)
are copied once into keys the Host still holds at their default, then removed.
Browser storage is only used while the Host namespace is unavailable.

**Header navigation** follows BB's Sidebar Resize. Compact mode (and expanded
mode once its pane is dragged to 76px or less) renders one horizontal icon row
that scrolls sideways (wheel included, scrollbar hidden, faded edges) with a
pinned ⋮ button. The ⋮ menu is a filterable list ("Filter destinations…") of
every destination, followed by **Settings** and **Customize sidebar**. Overflow
can be Scroll, Overflow menu (only fitting icons, the rest in ⋮), or Scroll +
menu (default).
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

**Saved views.** The view row above the thread list is backed by validated view
presets (`src/thread-view-preferences.ts`): each preset carries a name, order,
and the grouping/status/source filters it applies. The whole document is the
Host-synced `threadViews` setting, so every browser offers the same views; the
v1 browser copy this plugin wrote migrates into it once. Stored v1 view
preferences migrate into that preset list once. **Customize views** opens
`src/thread-view-manager.tsx`, where presets are saved, renamed, reordered,
selected, and removed; the row's quick controls apply the selected preset
without opening the manager. **Not working** includes non-running threads even
after their completion was seen, and threads waiting for attention; muted,
archived, and settled threads are omitted, because all three are storage rather
than work in progress. **Group headers collapse their rows** in the Project and
Date groupings: a closed header renders no rows at all. The collapse state is the
Host-synced `collapsedGroups` preference (`src/collapsed-groups.ts` holds the
group key helper and the browser copy an earlier build wrote there, which the
sidebar hands over once and removes). Because the preference is Host-synced, a
running Host that predates the field cannot persist it until DSH restarts. For how
working, attention, read state, groups, and filters fit together, see
[Thread sidebar states](sidebar-state.md).

**Archive undo notice.** Archiving reports itself as a compact overlay anchored
to the sidebar (`data-testid="thread-sidebar-transient-notice"`), so the thread
list does not move, and the notice offers an immediate undo before it disappears.
Clicking an archived row restores it and then opens it, because DSH drops an
archived Session from the main view on every list change; a refused restore
reports the failure and leaves the thread archived. An open archived thread
blocks its composer behind a **Restore to reply** banner. Persistent warnings —
storage failures and restart requests — stay in the list flow instead.

**Settled composer.** A settled thread opens normally and reads as history: the
composer carries a **This thread is settled.** banner
(`src/settled-thread-dock.tsx`), one compact card beside the jj rebase notice
with the settle age and the archive deadline in the sidebar's own relative
buckets, an **Archive** button and **Unsettle to reply**, because the Host
rejects the next model step while the thread is settled. The rejection is a
`agent/pre-step` listener in `src/host.ts` over `src/settled-gate.ts`: a settled
Session, or a subagent descendant of one, runs no model step until it is
unsettled, so a late wake (subagent settlement, queued follow-up, reminder)
proposes a step that ends as `blocked` without a request.

**Settled auto-archive.** `settledArchiveDelay` (Never by default, otherwise
immediately, after 1 hour, 1 day or 1 week) archives a settled thread once that
delay has passed, counted from the instant recorded in `settledAt` when it was
settled. The scan lives in `src/settled-threads.ts` and archives through the
`auto-archive-machine` actor, which serializes Host archive writes and coalesces
overlapping scans; the shared `now` clock wakes at the first due instant. An
archived, pinned, running, waiting or newly changed thread is skipped, and a
thread settled before this policy existed (no recorded instant) never becomes
due. The banner shows the archive time whenever a delay will archive it.

**Command palette.** Search threads, the ⌘ button in the header, and the
keyboard all open a shadcn `CommandDialog`: fuzzy search over thread title,
project, path, and ID prefix, recent threads when the query is empty,
destinations and actions (toggle sidebar, focus composer, customize, and Restart
DSH when launched through the managed supervisor) in the full palette, ⌘1–⌘9
on the first nine rows, and Enter to open. Restart asks for confirmation, then
requests a graceful Host exit; the Nix supervisor relaunches only its own DSH
child.

**Open in side panel.** A thread row's context menu, its hover action, the
`Open in side panel` command palette action and a `@dshfiles/main-tabs` thread
tab's own context menu open that thread in the right sidebar
instead of the main column, so a second thread can be read and driven beside the
one on screen. The row action routes through a React context the entry fills
(`ThreadAsideOpenProvider`), which calls `sidebarRight.openResource` on a
`threadaside` address; the resource retains the Session and the tab hosts the same
embedded Conversation a subagent chat does, composer included. The tab menu asks
over the cancelable `dshfiles:open-thread-aside` window event, which this entry
answers by cancelling it; a request made while no thread is on screen is left
uncancelled, because there is no side panel to open an aside into. Opening the same
thread twice focuses its existing tab, and closing the tab only releases the
reference — nothing is archived. Archived rows offer no aside, and the item is
absent if no entry provided the opener. The pane is a flex column, not a block, so
the embedded Conversation is sized by the pane: a block wrapper makes it grow past
the pane's height, which cuts the composer off and leaves the transcript
unscrollable.

`threadSidebar.openInSidePanel` is the rebindable command behind those paths. It
ships **unbound**, so Settings › Shortcuts lists it without it owning a chord
until the user picks one. Which buttons a row draws on hover, and in which order,
is a preference: Customize sidebar › Hover actions lists every one (Resume,
Dismiss, Open in side panel, Pin, Park, Settle, Mute, Archive, Restore), each row
carrying the button's own icon, a grip, Move up/Move down buttons and a visibility
checkbox. Drag a row, or move it, to set the left-to-right order the buttons draw
in; `rowActionOrder` stores that order and `hiddenRowActions` the ones a row hides
— an absent id means shown, so a new action ships visible at the end of the saved
order. The shipped order puts Settle in Archive's slot and Archive just before it,
so a row that hides Archive ends on Settle. Hiding one removes only its hover
button; the context menu keeps every action.

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
  ⌘P / Ctrl+P file search (thread search has no chord by default; it stays on
  ⌥⌘K and in ⌘K). Rebind or disable them in Settings › Plugins ›
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
is recomputed from measured widths on resize. More also opens **Settings** and
lists every sidebar page as a flat list (no group heading), so the menu stays
usable at any width.

`sidebar.footer.above` (list, owner `{}`) is a full-width seat stacked above the
wide foot, for rows that must not fold into More (the AI Accounts usage strip).
Its height counts against the header/thread resize limit. The stock sidebar has
no such seat, so an occupant keeps a footer-action fallback and registers through
`ctx.slots.inject`, which waits for the declaration.

**Settings › Plugins › Thread sidebar shortcuts** records the two palette chords
(record / disable / reset, with Host-conflict and duplicate warnings), which a
generated text field cannot capture.

Every thread row also exposes **Copy thread ID**, **Copy thread link**, **Mark
unread**, per-thread auto-settle behavior, a **Settle**/**Unsettle** toggle, and a **Mute thread** menu.
Attention is Host-owned: the plugin records one durable row per unacknowledged
thread (a finished turn, a manual unread mark, or both) in the
`thread_attention` storage domain and serves it through the
`thread-sidebar-attention` API, which also exposes the current state to the
agent as the `thread_attention_state` tool. Other plugins import the contract
from `@dshfiles/thread-sidebar/attention-api` (a dshx shared module, so one
definition serves every consumer); `main-tabs` reads it for its unread dot. The turn end is recorded where it
happens — a Host listener on committed session events — so a completion
survives even when every browser was closed while the thread finished. Watching
a thread finish acknowledges that completion, and so does opening the thread
from any tab; the acknowledgement carries the record version the browser
rendered, so a turn that finishes in between stays unacknowledged, and it never
clears a manual unread mark on the same thread. A browser that still holds markers
from the older browser-local version hands them to the Host once and then drops
its copy.
Auto-settle can inherit the global auto-settle setting, explicitly enable it
for one thread, or exclude that thread; the global idle threshold and safety
exclusions still apply. A thread with a still-running descendant is never
settled, so a child turn is never rejected mid-step. **Mute thread** (row bell, context menu, and the
session header's More menu) silences a thread for 1, 8 or 24 hours, until
tomorrow morning (09:00 local), for a week, or until it is unmuted, like a
Discord channel. A muted thread raises no desktop alert, attention group,
attention label or unread dot, and keeps the activity time it had when muted,
so new activity does not lift it to the top or out of Inactive. A bell-off
marker before its title gives the time left in its tooltip; a snooze wakes on
its own, and **Unmute** is always in the same menu. The **Muted** filter lists
muted threads. Mutes follow child-thread action preferences and live in the
Host-synced `mutedThreads` setting, so every browser stays quiet; mutes saved
in this browser by older versions are copied there once. **Thread notifications**
are configured in Settings › Thread sidebar, separately for approval requests,
questions, completed turns, stopped turns, and failed turns. Each category can be
off, in-app, system, or both, with an optional sound preset and volume; settings
follow the user through Host settings. A stopped turn covers a cancellation, a
blocked turn, and one that hit its token ceiling. System permission is requested
only after an explicit action, and OS notification text stays generic (no prompt,
thread title, or raw error details). Sounds use one browser audio context,
unlocked by the first user gesture and resumed before every tone, so an alert in a
background tab still rings. Existing desktop-alert choices migrate to system
delivery.

**Park vs settle vs mute.** Park files a finished thread away: it moves to the
Parked section, is skipped by auto-settle, and stays parked until unparked, but
its alerts still fire and it still runs steps when something wakes it. Settle
goes further: the thread moves to the Settled section and runs no step at all
until it is unsettled, while staying listed and openable. Mute keeps the thread where it is and only silences it, for
a while or for good. They answer different questions ("not now" vs "not
noisy"), so they stay separate and combine freely. The sidebar separates **Approval needed**,
**Input needed**, **Turn finished**, **Interrupted**, and **Needs resume**.
Permission approvals and plan-review decisions use **Approval needed**;
structured user-question requests use **Input needed**. Open questions use the
Client's explicit Session pending-interaction status; the sidebar also checks
active native question projections for continued forms, which can remain
answerable after a timed wait lets the Agent keep working. Unknown interaction
kinds and generic unstructured questions remain unclassified. **Turn finished**
marks an eligible finished turn from the Host's attention record; selecting that
thread from any route acknowledges it. **Needs resume** contains only Sessions
the managed restart captures as running immediately before its Host exit.
Completed, already-idle, and user-cancelled Sessions are not added. **Interrupted**
contains Sessions whose turn was still open when a previous Host process stopped
without that capture — a crash, a kill, or a shutdown timeout. The Host half
records every `turn/start` in a small durable in-flight file and clears it on
`turn/end`, so whatever the next process finds there is exactly the set of turns
that never closed; it promotes those ids into the same recovery store at boot,
marked `interrupted` instead of `restart`, and clears the file so one exit is
reported once. Both groups show explicit **Resume** and dismiss actions, and each
offers **Resume all** (up to three requests at once). Resume sends a new
continuation prompt that directs the agent to inspect its transcript and
workspace before continuing; it does not replay the interrupted model/tool call.
A row leaves its group as soon as that thread runs again, and dismissing drops it
by hand. Approval, Input, and Turn finished can be configured independently as a
separate group or inline thread-row label.
Approval and Input default to groups; Turn finished defaults to an inline
label. Each status has an independently configurable semantic color in Sidebar
settings (Muted, Primary, Info, Success, Warning, or Danger); the default colors
are Warning for Approval and Input, and Success for Turn finished; generic
working indicators remain Info. Group headings stick to the top while scrolling.
Subagent attention is
excluded from groups, labels, and desktop alerts by default; enable **Include
subagent threads** in Sidebar settings to opt in. An unresolved request stays
available in its conversation composer and returns to its configured attention
display when that thread is no longer selected. The Host records attention for
turn ends that ask for something (`completed`, `error`, `aborted`, `blocked`,
`max-tokens`); `forked` and `interrupted` turn ends never raise it, because the
first closes fork bookkeeping and the second continues in the next turn.
Attention rows still require a thread that is not running, not blank, not
archived, not muted, and not already waiting on approval or input, so a later
turn can surface normally. Completion alerts are observable only while a DSH
page watching that Host is open; a completion recorded while every tab is
closed still appears when one is opened, but no desktop alert is replayed. A
failed latest turn shows a destructive dot and **Failed · time**
in its row, using its durable turn-end timestamp. The row exposes failure time,
not error details. Errors without a durable `turn/end` event are not shown.
Attention is not backfilled from history that predates the Host's attention
store; it tracks new turn endings, plus the one-time browser migration.

Child sessions render with increasing indentation and a direct “child of …”
label. The sidebar follows DSH's durable `parentId` chain, so the presentation
is not limited to parent/child pairs; a child link carries
the workspace found on the nearest ancestor when the child has no direct
workspace membership. A child list stays with its parent's row whatever the
view filters: the children follow the parent they belong to, folded while no
subagent is working and unfolded when one is, so a subagent working under a
parent shows there and child threads never appear as rows of their own.

A branch whose nearest listed ancestor is gone from the corpus (for example a
quarantined session log) never turns into a top-level row: the whole branch
groups under one “Parent thread unavailable: …” header naming the missing
session, with its children nested and the same status, source, and finished
subagent rules as a listed parent. Nothing can create that state through the
UI — DSH has no session delete — so a unit test covers the grouping and the
browser journeys cover the listed-parent case.

Finished subagents (not running and not waiting on approval or input) fold
into one “N finished” line by default so live ones stay on top; the
`finishedSubagents` setting can also list them or hide them. The open child is
always listed.

Thread links use the root/index URL with `thread` and optional `workspace`
query parameters, for example `http://127.0.0.1:3080/?workspace=ws_…&thread=thr_…`.
This matches the installed frontend-static contract: it serves the app index
at the root or configured index path and returns 404 for other paths, so a
BB-style `/projects/…/threads/…` pathname would need a Host router change. On
load, the sidebar waits for the Host session catalog and opens the addressed
thread; selection changes update the URL. Copied links drop existing query
parameters and fragments, including process launch credentials, and resolve
only on the same DSH Host/origin where the session exists.

The web app composes DSH's native subagent tools and runtime, while this plugin
owns the subagent catalog action, child-thread lineage, and `Create subagent`
tool-row presentation. A plugin-owned Host projection records the latest safe
provider/model reported by a completed assistant response; catalog rows and
child headers display it. The tool row shows an explicit requested route. The
plugin never looks up account identity, and email- or credential-like route
values are omitted. The lineage UI is adapted from DSH's MIT-licensed
implementation; see `third-party/NOTICE.md`.

Continuable children can run concurrently, and `list_agents`, `send_message`,
and `interrupt_agent` support parent-side orchestration. The catalog traverses
descendants recursively. The Host supports up to 8 live continuable children by
default, and each child persists its direct parent session ID. The configurable
`subagent.maxDepth` currently defaults to 1, but the lineage model and sidebar
do not bake in that depth. Change the native Subagent depth setting when deeper
delegation is desired.
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

## Render cost at scale

The Session Controller's `projectList` builds a **new summary object for every
session on every list projection** (its `byId` record is rebuilt, not
structurally shared). A row whose data did not change therefore still receives a
new `session` object, which defeats `memo` on the row and every memo upstream of
it. At 305 rows one "New thread" navigation published a handful of projections,
and each one re-rendered the whole list: measured on a scratch DSH, ~4,300-5,500
`ThreadRow` renders per click, 11-15 long tasks and 1.7-2.4 s of blocking work,
with the sidebar itself accounting for all of it. Nothing loops; the cost is one
full re-render per store update.

Three pieces keep the work proportional to what actually changed, all on the
client side — no Host change is involved:

- `src/snapshots.ts` is the selector thread-listing plugins pass to
  `useSessions` and `useSessionStatus` (this plugin's own components, and
  main-tabs through the `@dshfiles/thread-sidebar/snapshots` module). It reuses
  the previous summary whenever every field is equal (including `retainedBy` and
  `projectionValues`), reuses the `ids` array, the projection map and each status
  row by content, and returns the **previous state object** when a projection
  changed nothing at all, so the store notification does not re-render the
  consumer. Its cache is keyed by the raw snapshot generation, so two components
  holding different generations in one tick cannot regenerate each other's
  stable object.
- `src/stable-value.ts` keeps a derived `Set` or `Map` when its content is
  equal. The unread, waiting and attention id sets and the inline attention
  label map are row props, so without this every row re-renders although none of
  them changed.
- `src/thread-child-rows.ts` derives each parent's listed, live and finished
  child rows once and caches them under the children array the thread tree hands
  out, so an untouched parent keeps the exact arrays its row already holds. A
  parent without children shares one empty row.

After the change, the same click on the same instance costs 0-30 `ThreadRow`
renders (only rows whose `age` or selection really changed), no long task in the
navigation window on a calm machine, and about 4-9 ms of total sidebar render
time across the 8 renders the store still asks for. Click-to-composer went from
1,072-1,563 ms to 31-208 ms across runs; on the same instance with the project
filter set to a bucket with no rows it measures 28-49 ms, so what remains is
Host RPC time (`session/create`, `destination`) and the machine's load, not row
work. Those wall-clock figures come from a shared machine (load average ~28);
the render counts and the long-task count are the load-independent evidence.

To reproduce, start a scratch DSH and seed it:

```sh
node tooling/dshx/packages/dshx/dist/cli/bin.js dev up \
  --plugin @dshfiles/jj-integration --plugin @dshfiles/home \
  --plugin @dshfiles/thread-sidebar --plugin @dshfiles/ui-styles \
  --name sidebar-scale --skip-build --json
node tooling/dshx/scripts/sidebar-scale-bench.mjs "$TMPDIR/dshx-dev/sidebar-scale/state.json" --seed 305 --rounds 5
```

The benchmark reports long tasks (inside and after the navigation window),
click-to-composer and the slowest RPCs. Render counts need a temporary counter:
add `globalThis.__threadRowRenders = (globalThis.__threadRowRenders ?? 0) + 1` at
the top of `ThreadRow` and
`globalThis.__sidebarRenders = (globalThis.__sidebarRenders ?? 0) + 1` at the top
of `ThreadSidebarContent`, rebuild the plugin, and read both from
`page.evaluate`. Wall-clock numbers depend on the machine's load; the render
counts and the long-task count do not.

**What is not rendered.** A collapsed section and a closed child list already
render no rows at all (measured: collapsing Active took the list from 12 rows to
0 in the DOM, and reopening restored them). Offscreen rows are a different
problem: they must stay in the DOM so scroll height, `data-thread-id` lookups,
scroll-into-view and text assertions keep working. `src/use-near-viewport.ts`
therefore keeps every row and its content, but mounts a row's hover actions and
their tooltips only once it comes within 600px of the viewport, and leaves them
mounted afterwards. At 602 rows on a scratch DSH, loading the page cost 5,803
DOM nodes (9.6 per row), 13.8-14.2 ms layout, 60.6-62.4 ms style and 215-253 ms
script with the gate, against 15,629 nodes (26 per row), 21.2-23.9 ms layout,
167.3-175.1 ms style and 494-514 ms script with every row mounted (measured by
removing `IntersectionObserver` before load, so both runs used the same build).
Without an `IntersectionObserver` — a test environment — every row mounts.

CSS `content-visibility: auto` was measured as an alternative and is **not**
used: at 602 rows it saved nothing at load (the browser still styled every row)
and moved 19-27 ms of layout and 86-132 ms of style into the scroll frames, so
the same work happened later, in the frames where jank is most visible.

**React Compiler (measured, not enabled).** `dshx` gained an opt-in
`client.reactCompiler` option (Vite's `@vitejs/plugin-react` `compiler` path with
`{ target: '18' }`, so the compiler emits `react-compiler-runtime` calls) and
this plugin was built with it at 602 rows. It compiled the components and the
app ran, but nothing improved: page-load script went from 287-301 ms to
307-339 ms, the New-thread click from 73-103 ms to 74-164 ms of script, and the
bundle grew from 445,406 to 496,363 bytes (+11.4%) for the inlined runtime. The
hand-memoized structure described above — a `memo` row, content-stable derived
containers, cached child rows — already covers what the compiler adds, so the
experiment was reverted: the option, its two build dependencies and this
plugin's `react-compiler-runtime` dependency are gone.

## Agent tools

One dshx API (`thread-actions`, owner `@dshfiles/thread-sidebar`, defined in
`src/thread-actions-api.ts`) exposes the sidebar's thread and project actions to
the Agent as nineteen native tools: `thread_list`, `thread_archive`,
`thread_unarchive`, `thread_settle`, `thread_unsettle`, `thread_pin`,
`thread_unpin`, `thread_rename`,
`thread_fork`, `thread_create`, `thread_stop`, `thread_select_model`,
`thread_references`, `project_list`, `project_register`, `project_rename`,
`project_delete`, `project_reorder`, and `thread_move`. `src/thread-actions.ts`
holds the decoded logic over plain ids and `src/thread-actions-host.ts` resolves
the live Host services on each call (`sessionController`,
`workspaceController`, `workspaceRegistry`, `sessionQuery`, and this plugin's own
`thread-sidebar` settings scope for the settled set). `thread_settle` and
`thread_unsettle` write `settledSessionIds` through that scope, so the Agent and
every browser see one status.

`thread_references` answers which other threads point back at one thread: its
forked and subagent children (`header.parentSession`), plus the threads whose
messages pulled it in as referenced context. The second half is one bounded
full-text lookup for the thread id over `sessionQuery.searchSessions` — the
referenced-context snapshot records `"sessionId":"session-<id>"`, so the id's own
uuid is the phrase to search. That lookup needs the Host's session-content index
(the web profile's `session-query-sqlite` Loader row); a search that is still
reconciling the corpus, or a Host without the index, is attempted three times
with a 1.5 s deadline each and then reported as `degraded: true` with lineage
only. `references` therefore never holds a menu open and never claims "nothing
references this thread" when it could not look. The same rows drive the
**Referenced by** submenu of a thread row's context menu and of the conversation
header's `...` menu, which is why the client tolerates a Host that predates the
method (it shows one muted line instead of the rows).

Every write tool's description says it may run only when the user asked for that
change. `thread_archive` never stops running work on its own: without
`stopActivity` the Host refuses with `workspace/session-active` and the tool
returns the running families, so the Agent must confirm with the user before
calling again with `stopActivity: true` — the sidebar's stop-and-archive
confirmation. Actions default to the calling thread when `sessionId` is
omitted; archiving the calling thread with `stopActivity: true` ends its turn.
Because this is Host code, the tools reach a running DSH only after a restart.

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
