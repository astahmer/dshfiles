# Thread Sidebar

![All threads grouped by status: line 1 is the thread (status glyph, title, time), line 2 is where it runs (project mark and name, a branch icon for its own workspace with one state word such as "1 to land"), and a working row says what it does now ("Running sleep 1800 · 1m 15s")](docs/screenshots/status-grouped-thread-list.png)

![Group by project, one click from the Filter menu: each section shows the project mark, name and count](docs/screenshots/group-by-project.png)

![The rail of destinations beside the thread list: the default Sidebar pane](docs/screenshots/destination-rail.png)

![A folder of your own on the rail, with its panels and Add panel](docs/screenshots/sidebar-folders.png)

![Copy DSH URL for agents and Pair a phone in the rail's DSH actions, directly above Settings](docs/screenshots/rail-actions.png)

![Above the first row: one search field, the project picker and one Filter menu (presets, Group by project, Group, Status, Source, Board, settings); a changed filter marks the preset edited and offers Save changes](docs/screenshots/list-filter-menu.png)

![Filter presets: the Filter button names the active preset, and the menu's Presets section switches between them in one click](docs/screenshots/filter-presets.png)

![On a phone the rail becomes a bottom tab bar; More lists the other destinations](docs/screenshots/phone-tab-bar.png)

![On a phone the stage is a stack: a top bar names the thread or page, Back (or a swipe from the left edge) returns to the list it came from, and inside a thread the tab bar steps aside](docs/screenshots/phone-stack-navigation.png)

![On a touch screen each thread row has a ⋯ button that opens its actions menu as a bottom sheet](docs/screenshots/touch-row-menu.png)

![Where did a page go? lists each former sidebar page and opens its new home](docs/screenshots/moved-to-map.png)

![Send one prompt to multiple models](docs/screenshots/multi-model-fan-out.png)

![The Sidebar settings wheel belongs to the Threads panel, not the fixed app header](docs/screenshots/navigation-layout.png)

![The same account Preview docked as an ordinary view with its single tab row hidden](docs/screenshots/preview-as-regular-tab.png)

![Tab-controlled Navigation and Threads between fixed sidebar controls](docs/screenshots/workbench-assemblies.png)
![Thread navigation icons and a pinned More menu in the collapsed sidebar](docs/screenshots/collapsed-sidebar-navigation.png)

![Thread sidebar list, with the thread board page open beside it](docs/screenshots/thread-classification.png)
![Inbox › Waiting threads: one row per thread waiting on your answer, approval or review](docs/screenshots/waiting-threads-page.png)
![Manage saved views with Inactive and Interrupted filters](docs/screenshots/thread-list-views.png)
![Synthetic saved view retained after reload over HTTP LAN access](docs/screenshots/saved-view-http-lan.png)
![Start a chat directly from an expanded or collapsed project header](docs/screenshots/project-header-chat.png)
![Several unsent drafts in the same project](docs/screenshots/typed-project-drafts.png)

![Group remote threads with each view](docs/screenshots/section-order.png)

![Settings › About › Update DSH: What's new, what it rebuilds, then Restart when idle](docs/screenshots/update-dsh.png)

![Retained notification history with synthetic thread events](docs/screenshots/notification-history.png)

![The same history on a phone, with its row actions wrapping](docs/screenshots/notification-history-phone.png)

![A thread row's Notify submenu: the open thread hears this row's turn ends at a chosen level](docs/screenshots/thread-subscription-notify.png)

![The same Notify submenu for a batch of two selected threads](docs/screenshots/thread-subscription-notify-batch.png)

![On a 390 px phone the Notify submenu opens over its parent menu, inside the screen](docs/screenshots/thread-subscription-notify-phone.png)

This bundle builds a full sidebar replacement with the repository's local
`@dshfiles/dshx` fork. It groups the real DSH session list by project and
activity, with pinned, active, parked, inactive, settled, and archived sections. Active
includes running or recently updated threads; the idle threshold moves older,
non-running threads to Inactive. Remote threads started from this DSH join the
current view by default: status views classify them as Active or Inactive from
their live running state, while date, project, and flat views group them
alongside local threads. Enable **Show remote threads in a separate group** in
**Thread list settings** to restore a standalone Remote section; in status views its
header joins the saved `sectionOrder` and can be reordered like local sections.
Remote runtime status does not include pinned, parked, settled, archived, or
attention state, so integrated remote sessions only participate in
Active/Inactive status grouping.
A local status section with no rows folds away and keeps its saved slot while the
shown ones reorder around it. The project picker scopes rows to one workspace or
unassigned sessions.

The reusable board page is **Thread Sidebar: Board** (Threads › Board in the rail).

**Multi-model fan-out.** The model picker's shift-click gesture opens this dialog with its models preselected
(`@dshfiles/thread-sidebar/fan-out-request`). `thread_fan_out` creates two to six independent threads for one prompt. Each thread is created blank, assigned its requested provider/model (and optional reasoning effort), titled `<prompt prefix> · <model>`, then receives the prompt. Creations run at concurrency two; each result reports its thread ID or failure without cancelling sibling work. With jj-integration isolation enabled, every thread is created in its own workspace.

**Status grouping (default).** **All threads** groups rows by the ADE status vocabulary (plan `docs/ade-ux` §4.3,
§4.7; `src/thread-status.ts`): **Pinned** on top, then **Needs you**, **Working**, **Ready**, **Idle** and **Done**.
Done starts folded, and a thread nobody touched for 72 hours folds into it on its own unless it is pinned. Within a
group the newest return to you comes first: the time the thread entered its group (the inbox item's opening, the
finish, the settle), refined live while the page is open. Needs you and Failed (which shares the Needs you group) are a
projection of the inbox: an open `@dshfiles/activity-timeline/attention-api` item whose subject is the thread
(`src/inbox-signals.ts`), plus the questions, approvals, usage limits and interrupted turns this sidebar already
classifies. Each row has two lines (b:212a). Line 1 is the thread: the kit's `StatusGlyph` in its own 16 px seat
(Working spins without colour; only Needs you, Failed and Ready draw the eye), the title and the elapsed time. Line 2 is
where it runs: the project's 14 px mark under the glyph, why it needs you, the project name (left out under a project
section, whose header names it; on a very short row it hides before the mark does), and, for a thread in its own jj
workspace, a branch icon with at most one state word ("2 to land", "landed", "3 behind"). The workspace's
`thread-xxxxxx` folder is never a label: it is in that icon's tooltip ("Own workspace · thread-e4fde2 · <path>") only.
Then the agent preset and host, and and one inline verb when it needs you: **Answer** and **Approve** open the thread, where the card is answered in
place; **Retry**, **Resume** and **Land** on an inbox item run that item's own verb through the inbox's `act`. The
hover-action strip opens to the left of that verb and never over it, so the visible verb stays clickable. The Needs you
group header offers **Resume all**: every row whose verb is Resume moves at once (three requests at a time), whether it
stopped on a usage limit, on an interrupted turn or on a provider's own resumable item, and a mixed group still reports
one combined result.
Subagents stay nested one level under their parent and roll up into it ("2 subagents need you", "waiting on 1
subagent"), so a parent never looks finished while a child waits or failed. **Group › Arrange manually** brings back
the drag-to-arrange sections below; a saved view keeps whatever grouping it was saved with, so only a new profile
starts on the status list. The row uses `StatusGlyph` rather than the whole `EntityRow`: the list row is also a
native drag source, a context-menu trigger, an inline rename field and a hover-action strip, which `EntityRow` does
not compose.

**Inbox and unread agree both ways.** Opening a thread acknowledges its finished turn, which resolves its inbox item;
marking that item **Done** in the Inbox acknowledges the same turn here (the inbox emits `dshfiles/attention/done`),
so the row's unread dot clears too. Done on an older turn's item leaves a newer finish unread.

**Subagents roll up into their parent.** A subagent Session publishes no inbox item: the user acts on the parent
thread, so the parent's item carries one line instead ("3 subagent turns finished; 1 failed."), counting the children
that finished no later than the parent's turn. The lineage comes from the stored Session header only (origin and
parent, cached; `src/session-lineage.ts`). Reading the parent clears its children's records, and the first reconcile
after an upgrade clears child records whose parent was already read, so subagent items published before the roll-up
resolve into Closed once.

**New-thread cards.** The new-thread screen (rich-composer's `conversation.hero.suggestions` slot) shows up to three
flat cards from the same sources as the list: **Resume** the most recent quiet thread (or one stopped and waiting to be
resumed), **Review** a thread whose Inbox item offers Land (it opens the thread and its Changes view), and **Inbox** with
the number of threads that need you. A card with no real data is not shown, so a fresh profile sees none of these;
onboarding's first tasks fill the row until the first thread has a message.

## Notification history

**Observe › Notifications** keeps the last 500 thread events, newest first, on the Host. The history includes finished, failed, and stopped turns, approval requests, and input requests. Recording does not depend on a browser being open, notification permissions, sound settings, or toast delivery. It follows the attention rule for subagents: child Sessions are recorded only when the `includeSubagentAttention` preference is on, exactly as their toasts are.

**History** shows retained entries except dismissed ones. **Unread** filters unread entries. **Dismissed** lets you restore an entry without changing its read status. **Mark read**, **Mark unread**, and **Mark all read** affect notification history only. **Mark all read** also marks unread entries that are dismissed. They do not answer questions, resolve Inbox items, or change thread attention.

**Open thread** opens an existing thread and marks its notification read. Archived threads offer **Restore and open thread**. An unavailable thread leaves its notification readable and dismissible. **Clear history**, in the page's ⋯ menu, asks for confirmation and permanently deletes the captured retained entries, including dismissed entries. Notifications that arrive after the dialog opens remain. Threads are never deleted. The page fills its pane; each entry shows how long ago it arrived (the full date is its accessible name) and the glyph of what it asked for: Needs you for an approval or a question, Failed for a failed turn, Ready otherwise, Idle once read. Inbox › Closed links here (b:ysaj).

The versioned `thread_notification_history` storage domain holds one bounded snapshot. It stores event IDs, thread IDs, timestamps, categories, and read and dismissed flags. Finished-turn entries use a deterministic ID from the Session and turn sequence. A question request with a wait call ID uses that ID. Approval requests and unkeyed question requests have no stable occurrence ID on the Host event, so each live occurrence gets a unique ID. The history never replays old sessions, so that uniqueness cannot collide with a retained entry. Localized summaries come from fixed categories. Conversation contents, titles, approval details, question text, tool arguments, and raw errors are not stored. The UI resolves thread titles from the current session list.

Collection begins when the plugin activates. It does not replay old sessions or import previous toasts. A crash between a session event and the history write can lose that event. This is a notification history, not a lossless audit log. Entries recorded before a restart remain available afterward.

The same Host methods serve the UI and `notification_history_list`, `notification_history_set_read`, `notification_history_set_dismissed`, and `notification_history_clear`. Clearing requires explicit entry IDs and `confirm: true`.

### Design choice

The history belongs to Thread Sidebar, which already owns thread notifications. Its single-snapshot store keeps read, dismiss, clear, and retention changes in one durable write. The existing attention store cannot serve history because it keeps only the latest finish and deletes acknowledged rows. Extending Activity Timeline would couple notification retention to unrelated event payloads and require a storage migration. Browser-only persistence would miss events while no browser is open.

Actual approval and question requests are observed through prepended, transparent Host interceptors. Observers always delegate the original continuation, including when storage fails. An invoked tool or `approval/asked` event alone is not proof of a request reaching an answerer, so neither creates a notification.

Limitation: prepending places the observer ahead of automatic answerers too. A `permission` hook that answers an approval without a human still records an **Approval requested** entry. No plugin in this repository installs such a hook today. Recording after the continuation returns would drop requests that are still waiting for a person, so the observer stays first.

## Sidebar controls

**Status strip item.** With `@dshfiles/frame-layout` as the frame, the sidebar adds the strip's "N working" item
(top-level threads with a running turn; hidden while none run). The account preview moved from above the sidebar
footer into the strip's Quota item; Workbench still offers it as a movable **Sidebar previews** view.

**No foot row by default (b:4v6p).** The row under the list (Settings, More) is not drawn: the rail holds Settings,
the pages and the DSH actions below. It comes back from Customize sidebar › **Show the row under the list**, or ⌘K
**Sidebar: show the row under the list** (`showFooter`). Its entries stay mounted without tooltips.

**DSH actions on the rail (b:kgcc).** A small group at the bottom of the rail, directly above Settings (below the
folders and + New folder), expanded and collapsed alike: **Restart DSH** (only while the supervisor offers a restart;
amber with a slow pulse while updates or a restart wait, its tooltip then names them), a pending **page reload** (amber;
opens the list of updated plugins), **Copy DSH URL for agents** (the tooltip says Copied) and **Pair a phone** (only
with phone-pairing; opens the pairing dialog). Each has a tooltip and an accessible name. They are actions, not
folders, so the folder model never lists them. On a phone they are rows of a **DSH** section at the end of the More
tab. ⌘K keeps all of them. Customize sidebar › **Show DSH actions on the rail** (`showRailActions`, on by default)
turned off puts them back in the row under the list, which a pending restart or page reload then shows.

**Rail and destinations.** The left column is a labelled rail of eight destinations (plan
`docs/ade-ux` §4.2): Threads, Inbox, Land, Work, Agents, Observe, Knowledge and Settings. Threads shows this thread
list with **Search threads**, the Sidebar settings gear and an icon for each of its sections beside them (Board);
every other destination lists its sections, and choosing one opens that page in the stage. A destination with a
single page (the Inbox) opens it at once.
The former Navigation pages are sections now, labelled without their plugin name; the table lives in the
`@dshfiles/thread-sidebar/destinations` dshx module (`KNOWN_SECTIONS`), plugins add later pages through its
`DestinationSections` registry, and a page nobody mapped is listed under **Settings › Other pages**. The Inbox entry
renders the Inbox's own `attention-inbox` glyph, so its Needs you badge appears whenever activity-timeline is loaded.
**New thread** sits in the header row (in the rail when collapsed). Collapsed, only the rail stays and its labels move
into tooltips. Every load starts at Threads; the list then follows the page the stage shows.

**Where did a page go?** (a palette command; the sidebar no longer carries a link to it, b:hbtt) lists each former left-nav entry from
the migration map (`src/moved-to.generated.ts`, written by `pnpm ade:migration-map`) with an Open button. Palette rows
read `Observe › Usage` and still match the old names.

**One sidebar layout (b:952m).** There is one left column, not a Fixed and a Free docking one. Workbench's left docking
region is always mounted behind the rail, and its default arrangement is the rail and its list as one **Sidebar** pane
whose tab row is hidden. That pane moves, splits and floats like any pane (⌘K **Show tab rows**, then drag its tab);
it cannot be closed, and ⌘K **Reset layout** (also found as "fixed layout" or "free
docking") brings the default back. The sidebar root still renders the column and portals it into the element the
visible Sidebar pane lends (`src/sidebar-dock-host.ts`), so moving it never remounts the list. Collapsed, on a phone and
without the Workbench the rail and list stay inline. The palette's former **Layout: fixed / free docking** commands
and the Settings › Layout switch are gone; `showMainTabs` alone decides the main tab rows.

The merge ran once per Host (marker `layoutMerge`): a former Fixed user starts from the default, and a left layout a
browser still kept from an earlier docking session is saved as the named layout **Free docking (before merge)**; a
former Free docking user keeps their left layout verbatim, with the row under the list and the main tab rows on. The
retired `layoutMode` stays decodable, hidden, for one release. Named layouts survive.

**Sidebar folders (b:952m).** The rail is a list of folders. The eight destinations are built-in folders (⋯ › **Hide
folder**; shown again from the New folder dialog), and **+** at the rail's foot (⌘K **New sidebar folder**) adds one
of your own with a title and an icon. A folder lists its panels: a page opens in the stage, a thread facet in the thread
panel, any other view through the Workbench. Each row's ⋯ menu offers **Keep in sidebar** (docks it as a stacked pane
under the Sidebar pane, then movable like any pane), **Move to folder…** and **Remove from folder**; rows also drag onto
another row or a rail folder. **+ Add panel** lists the pages, thread panels and views this browser can show. Deleting a
folder moves its panels to **Settings › Other pages**; every change shows an **Undo**. Collapsed, a folder opens a
flyout of its rows. A pane's tab menu offers **Add to sidebar ▸ ‹folder›**, and ⌘K **Add ‹panel› to ‹folder›** files a
panel in one of your folders. Threads stays first with its project groups; there are no folders of threads.

Only your changes are stored, as `sidebarTree` in this namespace's Host settings: an empty tree is the default, so a
page a plugin adds later still lands in its mapped folder. Every verb is a method of the `threadSidebarTreeApi` dshx
API and an agent tool: `sidebar_tree_get`, `sidebar_panels_available` (the panels the open pages reported; it says when
none did), `sidebar_folder_create`, `sidebar_folder_rename` (title, icon, hide or show), `sidebar_folder_move`,
`sidebar_folder_delete` (`confirm: true`; restorable for 30 days), `sidebar_folder_restore`, `sidebar_panel_add`,
`sidebar_panel_move`, `sidebar_panel_remove` and `sidebar_tree_reset` (`confirm: true`). Writes are serialized and
recomputed on a settings conflict (`src/sidebar-tree-host.ts`).

**Phone (below 640px).** The rail becomes a bottom tab bar: Threads, Inbox, Land and More. Threads opens the list full
screen and opening a thread closes it again (the stage is pushed); a second tap on the open tab goes back; More lists
the other folders, yours included, each expanding in place to its rows. The sidebar marks the document with `data-shell-phone-nav`, and frame-layout then gives the
stage the full width and reserves the bar's height. Inside a thread the tab bar steps aside (`data-phone-in-thread`;
the stage keeps only the home-indicator inset) and Back, or a swipe from the left screen edge, returns to the list.
Pushing a thread or page over the list, and Back, slide through a View Transition (`data-phone-stack-motion`, rules in
the kit stylesheet); without the API or with reduced motion they are instant. A turn that finishes while a page or the
full-screen list covers the thread is not "watched": it stays in the Inbox until the thread is opened.

**Navigation counter.** Each destination or section open (rail, tab bar, list, palette, moved-to) adds one to a private
counter in this Host's runtime folder: ids and counts only, never a thread or its content. Agents read it with
`shell_navigation_counts`; `shell_navigation_reset` clears it only with `confirm: true`.

**Docked sidebar panes.** Workbench tabs fill the left column's docking region (its `shell.left` slot) behind the rail:
**Navigation** and **Threads** are reusable panels, not fixed sidebar furniture. Each group's **+**, named **New tab**, opens an actual chooser tab with **Choose a view**, **Search views**, **Rich Composer: Current conversation**, one **Settings Shell: Settings** hub and plugin views. **Pane options** sits at the group's far-right edge; there is no persistent Workbench toolbar. Threads retains **New thread**, **Search threads**, project creation,
filters, row actions and keyboard navigation. Its **Sidebar settings** gear opens
**Customize sidebar** inside that same panel, including after moving it or hiding
its tab row. The existing Root controller and preferences stay authoritative;
only the editor's owned React portal seat moves. The fixed header has no duplicate
customization button. The separate sliders control is **Thread list settings**
for list-specific options. The logo, Back/Forward and command palette remain
fixed at the top; native Settings/footer controls remain at the bottom.
[Settings ownership and verification](docs/panel-settings.md). Without a
Workbench occupant, the installed slot renderer falls back to the original
navigation/thread assembly. Collapsing reports the hidden geometry without
unmounting the live left docking region. That fallback is package compatibility,
not a user-selectable native layout. The fullheight right Workbench pane likewise
keeps its tabs and real Session resources mounted while collapsed; the conversation
main group's Pane options opener, pane-local Close pane icon and original sidebar shortcut address that pane,
not old native chrome. The bottom row occupies only left and centre.

![The same customization editor follows Threads into the right pane with its tab row hidden and the left sidebar collapsed](docs/screenshots/navigation-layout-editor.png)

**New chat from a project header.** With **Group: Project**, each registered local
project has an always-visible **+** beside its collapse chevron. It opens a fresh
chat in that project without changing whether the group is collapsed. The selected
blank chat appears as **New chat** in **All threads**, but stays local: leaving it
empty does not create a saved Host conversation. Typing meaningful text (or adding
an attachment) saves its identity before sending and changes its row to **Draft:
…**. Reopen drafts from their rows. You can keep several independent unsent chats
in the same project; **+** and global **New thread** never overwrite them.

The tooltip and accessible name say **New chat in &lt;project&gt;**; Enter and Space
activate it. Draft text uses the existing per-Session composer storage, including
page-reload restoration in the same browser origin; it is not synced between
devices or between localhost and LAN addresses. No separate project text cache is
introduced. Workspace isolation and error feedback remain with the existing
creation flow. Unassigned, remote and unavailable project groups, and date/status
groups, have no **+**.

The draft lifecycle uses the paired owned `session-controller`, `workspace-nav`
and `rich-composer` bundles. The native `model-selection` and `agent-preset` row
forks stage choices without addressing a nonexistent Host identity. Include both
in the profile; replacing only the visible model picker cannot adapt the native
preset controller or `/model` owner. These are supported plugin replacements,
not DSH core patches. Old saved blank sessions are not deleted automatically.

The project-header browser journeys cover selected blanks without a create RPC,
whitespace-only input, independent same-project drafts, reload and first send,
global New thread, pretyping model/preset choices, and the compact model picker:

```sh
pnpm --dir tooling/dshx run test:e2e:gen
pnpm --dir tooling/dshx exec playwright test --config=playwright.e2e.config.ts project-header-chat --workers=1
```

Use the scratch executable/browser overrides described by `verify-dsh` when the
personal launcher rewrites the scratch home or bundled Chromium is unavailable.
The six affected packages pass focused tests/typechecks and Host bundle imports.
The four scratch journeys pass without a provider response or live-instance restart.
The live `web` profile was checked after its restart (2026-11-10): an empty New
thread adds no Host Session, two typed drafts in one project reopen with their own
text from their **Draft: …** rows, and both survive a page reload. In a project
that isolates new threads, the first typed text also provisions that draft's
thread workspace, so an abandoned typed draft leaves a blank Session and an empty
workspace to archive. This does not establish cross-device draft sync or
arbitrary plugin compatibility. New profile rows require user-controlled
activation/restart; merely building an isolated worktree does not update the GUI.

**Moving a row between sections.** Drag a thread row onto another section header
(or anywhere inside that section) to put it there; while a row is in flight every
section shows, including the empty ones, and the target highlights. The section
it lands in opens if it was folded, so the moved row stays visible. A section is
a status, so entering one sets that status and clears the ones that outrank it:
Pinned pins, Parked parks, Settled settles, and Active/Inactive unpin, unpark and
unsettle. Dragging a settled thread out unsettles it and dragging an archived
thread out restores it. Active and Inactive are otherwise derived from the idle
threshold, so a drop there records `idleSectionOverrides` (with its instant) and
keeps the row in that section until the thread's next turn; Archived keeps the
thread's other statuses, so restoring brings it back where it was. Pin, settle
and archive keep their usual refusals (a running thread cannot be parked, settled
or archived), and every move honors Apply actions to child threads. The row
context menu's Move to group submenu performs the same moves from the keyboard.

**The thread board page.** The sidebar only ever shows the list; the board is a
full-width page opened from the thread board row in the sidebar's panel list (or
the "Thread board" command in the palette). It renders the same thread rows with
each section as a column: it defaults to the six status lanes (including empty
ones), and can also group its columns by project, date, or no grouping. The board
shows only columns: the list's Interrupted, Needs resume, Usage limit and attention
groups stay sidebar-only, and their threads sit in their status column with the
same attention label inline; remote threads join their columns even when the
list keeps them in a separate Remote group; branches whose parent is gone get a
column of their own; empty drafts stay in the sidebar. The board
has independent grouping, status/source filters, project scope, and collapsed
groups from the list, and keeps them in this browser across reloads; the sidebar
list keeps its own saved views. Thread row actions are unchanged, and dragging
between lanes uses the same section move behavior. The page reads the same Host
state as the sidebar but never runs the sidebar's background work (auto-archive,
auto-settle, notifications or attention polling), so both surfaces can be open
without doing that work twice.

**Keyboard and multi-select.** ↑/↓ move focus and open the focused thread (or
only move focus when **Thread list settings** says Move focus only); Shift+↑/↓ extends a
range without opening, Home/End jump to the ends of the list, and Ctrl/Cmd+A
selects every visible row. Shift+click and Ctrl/Cmd+click do the same from the
pointer, ←/→ fold the containing group section or the row's subagent children,
and Escape or a plain click clears the selection. A selected row paints in the
info tone, and an "N selected" bar above the list offers Pin, Settle, Archive
and Clear. Rows read their selected state from a small store on the shared row
actions (`src/thread-multi-selection.ts`), so a toggle re-renders only the rows
whose state changed; nothing writes the rendered rows' attributes.

The context menu of a row inside a multi-selection applies the whole batch:
pin/unpin, park/unpark, settle/unsettle, mute/unmute, mark unread, copy thread
links and archive/restore, plus Clear selection. Right-clicking outside the
selection resets it to that row, so the single-thread menu still works. Park,
settle and mute write one preference update for the batch, pin and archive call
the Host once per row, archive refuses while a selected thread is running, and
every verb honors the Apply actions to child threads preference. Archive keeps
its undo notice and clears the selection when it succeeds.

**Project attribution.** A thread workspace is attributed to its owning
repository. Its folder comes from the VCS providers (jj-integration,
git-worktrees) through `@dshfiles/vcs-provider-port`'s `threadsDirectories`,
so a custom `threadsDirectory` setting (`<dir>/<repository name>/<thread>`)
groups correctly; with no provider answering, the default
`<repository>-threads/<thread>` layout applies. A
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
when enabled, the Host checks the same idle threshold on the configured scan
interval (`src/auto-settle-host.ts`, first scan 30 s after boot, again at once
when the policy settings change) and writes `settledSessionIds`, so threads
settle with no browser open. It skips running, blank, archived, pinned, parked,
already-settled, excluded-session, excluded-project, waiting-for-an-answer and
still-running-descendant entries. The same scan settles rebased threads once
`rebasedThreadSettleDelay` passes, reading jj-integration's thread workspaces
through its Host API.

**Finished subagents settle on their own.** Independently of the idle switch, the
same Host scan settles a subagent thread (one with a parent) that stayed idle for
`subagentSettleHours` (24 by default, 0 turns it off) and stops every background
job it still owns through the job registry's owner fence, so a finished subagent
keeps neither a live row nor a running dev server or watcher. It keeps the same
safety rules as a settle trigger: running, waiting, blank, archived, pinned,
parked, excluded and opted-out threads stay. `thread_auto_settle_status` reports
them with the `subagent` source, and the last scan counts the settled subagents
and the jobs stopped. Unsettle reverses it; stopped jobs are not restarted.
A browser runs its own scan only against a Host from before
this one (the `thread-sidebar-auto-settle` API answers owner-missing); otherwise
it never scans, so a thread is never settled twice. `thread_auto_settle_status`
(read-only) shows the last and next scan and the newest automatic settles. A
thread menu can inherit the global setting, explicitly settle that thread, or
exclude it; explicit per-thread enables still honor excluded projects and other
safety checks. Settling records the instant in `settledAt`, which is what the
composer banner dates and what the separate settled auto-archive delay counts
from. It also answers jj-integration's **Settle** action in its post-rebase
notice (`src/settle-request.ts`): the sidebar owns this status, so the notice asks
through the cancelable `dshfiles:thread-settle` window event instead of writing a
second copy.

**Settle triggers from other plugins.** A plugin with its own reason to settle a
thread (a pull request merged or closed, say) imports the
`@dshfiles/thread-sidebar/auto-settle-api` contract and calls
`createHostApiClient(ctx, threadSidebarAutoSettleApi, '<its package>').requestSettle({ sessionIds, reason, source })`
from its Host. The sidebar applies the scan's safety rules (running, waiting,
blank, archived, pinned, opted-out and running-subagent threads are skipped and
reported per id), writes the settled status once, and lists the settle with its
source and reason in `thread_auto_settle_status`. Callers that run without the
sidebar treat `isApiOwnerMissing(error)` as "nothing settles".

Settled exists because auto-archive used to push idle threads into the native
archived state, and native navigation drops an archived Session from the main
view right after it opens, so clicking an idle thread fought that cleanup.
Threads already natively archived stay archived; there is no migration sweep.
The Host no-wake gate (`src/settled-gate.ts`) walks the subagent lineage through
live agents' headers plus the child's recorded `parentSession`, so a settled
grandparent whose intermediate subagent is no longer live is not detected; the
client refuses to settle a thread with a running descendant, which covers the
case that matters. Every preference decoder field needs the same default as the
Host schema: Schemastery drops a null-valued union field from its resolved
output, and one field without a default once made the strict decoder reject
every Host document, silently falling back to browser storage.

Sidebar preferences live in DSH Settings under the Host-synced `thread-sidebar`
namespace (`src/settings.ts`, registered by `src/host.ts`). The plugin draws its
own **Settings › Thread list** and **Settings › Thread notifications** sections (`src/settings-tab.tsx`, registered by
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

![An acknowledged recent idle thread remains in the date-grouped Done view.](docs/screenshots/thread-list-views-done.png)

**Filter presets** (b:xpvk). The saved views are the Filter menu's presets: its
**Presets** section comes first, one radio per enabled view, the active one
checked, and the Filter button names it (`Filter: Needs you`). Changing a group,
status or source filter afterwards never rewrites the preset: the change is a
Host-synced `threadViews.draft`, the button reads `Filter: Needs you (edited)`
with a dot, and the section offers **Save changes to “Needs you”** and **Discard
changes**; changing the filters back drops the draft. **Save current filters as
preset…** names a new preset (a dialog, pinned to the top on a phone so the
keyboard never covers it) that stores the
grouping, filters and the current project scope (`projectFilter`: an id, `''` for
Unassigned, `null` for All projects), and applies it. **Preset options** holds
**Rename…**, **Update with current filters**, **Delete…** (a confirmation, then an
Undo notice that puts the preset back where it was), Mark all read / unread and
**Manage presets…** (the view manager, where a built-in can be hidden). A built-in
names no project scope, so applying it leaves the project picker alone. ⌘K lists
one **Filter: ‹preset›** row per preset; in the thread list `[` and `]` step to the
previous and next preset, wrapping (`1`–`9` answer in the peek and `G` starts the
destination chord). Thread list settings › **Use filter presets** (on by default)
turns the section, the trigger name, the keys and the ⌘K rows off; **Show filter
presets as chips** (off by default) adds a row of preset chips under the header.
Both are fields of the same `threadViews` document, so every browser and device
sees the same presets.

**Saved views.** The view row above the thread list is backed by validated view
presets (`src/thread-view-preferences.ts`): each preset carries a name, order,
its grouping/status/source filters, and whether its tab shows a count. The whole document is the
Host-synced `threadViews` setting, so every browser offers the same views; the
v1 browser copy this plugin wrote migrates into it once. Stored v1 view
preferences migrate into that preset list once. **Customize views** opens
`src/thread-view-manager.tsx`, where presets are saved, renamed, reordered,
selected, and removed; the row's quick controls apply the selected preset
without opening the manager. The three shipped views are **All threads** (status grouping,
all sources), **Working** (status grouping, all sources, running own turns or
parents with running descendants), and the initially selected **Done** (date
grouping, main threads, **Not running** OR **Needs attention**). Not running
includes recent, pinned and parked idle rows, but excludes muted, settled and
archived rows; Inactive still uses the idle threshold. Explicit storage selectors
remain available. Legacy **Not working** decodes to **Not running**, retaining
any other selected filters. Custom view IDs, order, grouping, source, enabled
state and active selection survive migration; removed Inbox/Gone tabs are not
restored. Earlier unedited built-in Working/Done filter sets upgrade without
rewriting custom views. A preset that is not All threads shows `(N)` beside its name by default:
Working shows the running-thread count, while every other view counts unread
threads it lists, showing how many listed threads still hold an unacknowledged
finish on the Host (opening one clears it everywhere). Edit any view and uncheck
**Show count on tab** to hide that tab's count without affecting other tabs. The colored dot signals only attention labels matched by that
view's selected statuses; it is not itself an unread-finish count. When the
sidebar is too narrow for every full tab (`src/thread-view-tabs.ts` measures the
row), built-in views show their icon and custom views their initial beside the
count; the full name stays the tooltip and accessible name, so every tab fits
without scrolling. A row wide enough keeps the full names. A status filter names a state the row already
shows, and several combine as OR: **Working**, **Not running**, **Needs attention** (any label),
**Unread**, one filter per attention label (**Approval needed**, **Input
needed**, **Turn finished**, **Needs resume**, **Interrupted**), **Inactive**,
and the storage states **Muted**, **Settled** and **Archived**. Unread leaves archived and
settled rows out, and the attention filters see the label a root row shows for
itself or a child. A saved view from an earlier build that still asks for **Not
working** decodes to **Not running** without removing its other selectors. Muted,
archived, and settled threads are omitted from attention and unread filters,
because all three are storage rather than work in progress. **Group headers
collapse their rows** in the Project and
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
blocks its composer behind an **Archived** banner whose **Restore** action
reopens it. Persistent warnings — storage failures and restart requests — stay
in the list flow instead.

**Settled composer.** A settled thread opens normally and reads as history: the
composer carries a **Settled** status strip
(`src/settled-thread-dock.tsx`), one compact line beside the jj rebase notice
titled with the settle age once it stops reading "now", the archive deadline
in the sidebar's own relative buckets beside it, and an **Archive** button next
to the primary **Unsettle** that lifts the block, because the Host
rejects the next model step while the thread is settled. The
rejection is a `agent/pre-step` listener in `src/host.ts` over
`src/settled-gate.ts`: a settled
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
reference — nothing is archived. Dropping a `@dshfiles/main-tabs` thread tab on the
open side panel moves it here the same way: the strip asks through
`dshfiles:open-thread-aside` and closes its tab once this entry answered. The
reverse is an aside tab menu item, _Move to main area_: it dispatches the
cancelable `dshfiles:open-thread` event that `@dshfiles/main-tabs` answers, then
closes the aside tab, so the thread lives in exactly one place. Archived rows
offer no aside, and the item is
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
started before this plugin version report nothing.

**Updating DSH.** Settings › About › **Update DSH** checks `main@origin` for the checkout DSH runs from, lists What's
new with what it would rebuild and whether a restart follows, and runs jj-integration's update job after a confirm
(`dsh_update_check` / `dsh_update_apply` for agents). It ends where this plugin's restart verbs begin: when a Host
bundle changed it offers **Restart when idle**, never a restart by itself. The status strip's **Update · N** item
appears only while new revisions wait (or an update runs) and opens that section.

**Restarting.** Restart now and Restart when idle exist only under the managed
launcher (`scripts/supervise-dsh.mjs`). The Host writes the supervisor's request
file, records running threads, asks DSH to exit with code 75 and then arms an
exit guard: DSH 0.2.1-rc.2 can finish its shutdown without exiting (it skips
some plugin disposers, so a leftover timer keeps a Host whose web server is
already closed alive). Ten seconds later the guard logs what still holds the
process (`[thread-sidebar] restart: …`) and exits with 75. The supervisor logs
every step (`[dsh-supervisor] …`) and stops a Host that asked for a restart but
is still running 30 s later. Meanwhile the dialog says DSH is restarting and
closes when a Host with a new run id answers; the page's cookie survives the
restart, so it reconnects without a new launch URL. After two minutes without
a new Host the dialog says so, points at those log lines and offers Keep waiting
and Reload page.

**Restarting by itself (`autoRestartWhenIdle`, off by default).** It acts on
its own, so this fork ships it off (upstream ships it on). When on, a pending
Host update restarts DSH without anyone asking: a plugin whose Host
files changed since boot (the same set hmr-gate holds back) or a changed
booted-profile manifest (`package.json` or `.dshfiles-profile-sync.json`, what
`profile:sync` and `dshx checkout sync` rewrite; listed as `profile`). Every 5 s
the Host checks that no Agent turn runs (subagents are Agents too), no
background job is running or stopping, and no thread has an open user question.
Once that held for `autoRestartQuietSeconds` (default 60, 30–3600), it reads
everything again and hands off through the managed restart above, which records
any turn that still started so `resumeAfterRestart` can pick it up. The last
30 s show **Restarting to apply updates in N s** on the rail's **Restart**
(amber, pulsing; the same row under More › DSH on a phone), whose confirmation
dialog offers **Postpone** (60 min) and, once postponed, **Resume automatic
restart**. With **Show DSH actions on the rail** off, the status strip item
shows the countdown and Postpone instead: one restart control either way; work that starts during the countdown cancels it and the
quiet period starts over. A page that saw the countdown reloads once the new
Host answers. Without the supervisor hand-off nothing restarts: the status strip item's
popover shows the launcher command (`$DSHFILES_DIR/scripts/dsh-launcher`) with
**Copy command** and **Turn off automatic restart**.
Agent tools: `auto_restart_status` (read), `auto_restart_postpone` and
`auto_restart_resume` (only when the user asked). The policy runs in the Host:
a Host started before this version needs one restart to load it. Turn the
setting off to keep restarts manual.

Keyboard entry points:

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
- Any bundle opens the palette through the `CommandPalette` contract of
  `@dshfiles/command-palette/palette-contract`.

**Footer** entries render on one row and never shrink or wrap. Entries that do
not fit move into More (⋯) together with entries hidden in Customize; overflow
is recomputed from measured widths on resize. More also opens **Settings** and
lists every sidebar page as a flat list (no group heading), so the menu stays
usable at any width.

`sidebar.footer.above` (list, owner `{}`) remains the genuine full-width contributor seat for the AI Accounts usage strip. With the supported `shell.left` Workbench override, its existing Preview assembly is a regular docked tab group instead of a duplicate fixed strip. The actual public slot entries/subscription select this mode; there is no guessed global bridge or extra SDK field. A standalone Sidebar retains the fixed full-width fallback above its native foot; removing the override restores that fallback. The stock sidebar has no such seat, so an occupant retains its footer-action fallback and registers through `ctx.slots.inject`.

**Workbench sidebar assemblies** are available through the **New tab** chooser while this sidebar root is mounted:
**Threads** hosts the actual `sidebar.workspaces` occupant in wide mode; **Navigation** renders the actual
`sidebar.panellist` glyphs inside live navigation buttons; **Quota** hosts the current AI Accounts-only `sidebar.footer.above` contribution;
A footer aggregate with one labeled contributor takes that contributor's label (a legacy **Plugin: View** label shows as its view name); several or unlabeled contributors use **Sidebar previews** or **Sidebar controls**, so the sidebar never claims another plugin owns a mixed assembly and no pane title carries a plugin name. Each uses this root's authorized renderer,
original owner props and normal query/settings/sidebar contexts. Its declared seats remain present, but the Preview is not mounted twice. The account-only Preview is initially seated below the existing left groups; prior saved placements win, and explicit closes remain closed. It has the same move/close/single-tab **Hide tab row** controls as any other view. Hover/focus the content's **Show tab row** control or use **Show tab rows** to recover it; adding a second tab reveals the row and clears the hidden preference.
These are content assemblies, not fake independent copies of contextual message/turn/menu slots. The Settings
launcher, brand and reopen badge remain sidebar chrome; Settings already has its own main/section panel adapters.

**Settings › Plugins › Thread sidebar shortcuts** records the two palette chords
(record / disable / reset, with Host-conflict and duplicate warnings), which a
generated text field cannot capture.

Every thread row also exposes **Copy thread ID**, **Copy thread link**, **Mark
unread**, per-thread auto-settle behavior, a **Settle**/**Unsettle** toggle, and a **Mute thread** menu. The session header's **More thread actions** menu also lets you settle or unsettle the open thread. **Follow-up in a new thread** opens a blank composer in the source thread's registered workspace with `Follow-up after` and a structured session-reference chip prefilled, labeled with the source thread title, and the caret on the next line; normal workspace isolation applies.

**Continue in project** (row menu and thread header menu) fixes a thread that
started in the wrong folder, or whose work moved to another repository. It lists
the registered projects; picking one forks the conversation into a new thread
whose own working directory is that project's workspace — its isolated jj
workspace when jj-integration isolates new threads — settles the original, and
opens the new thread. The new thread is told which thread it continues and both
directories. A DSH Session's project, session-log location and sandbox root all
follow its immutable header cwd, so a fork whose header already names the
destination is the only move every surface agrees on; the original id stays
reachable through the fork's parent link. The Host half is the
`session-continuation` API of `@dshfiles/session-controller`. The original's
running shells and background jobs keep running in its own folder, where their
work still belongs; a running thread must be stopped first.
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
its copy. A page reads the whole state once, then follows each `changed` event
and its 30 s poll with `changesSince`, which returns only the records written
or dropped after the revision the page holds (a drop takes a revision too).
When the Host cannot name every drop since then (it restarted, or more than
2000 drops passed) it answers `complete: false` and the page reads the whole
state; a Host without the method makes the page read the whole state as before.
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
are configured in Settings › Notifications › Thread notifications, separately for approval requests,
questions, agent messages (`notify_user`), completed turns, stopped turns, and failed turns. Each category can be
off, in-app, system, or both, with an optional sound preset and volume. Agent
messages default to in-app and system; every other category starts off. Settings
saved before a category existed decode with its default. In-app
notifications can be placed at any corner or center edge of the sidebar, dismissed
with the close button, and timed out after 3, 5, 10, 15, 30 or 60 seconds; choose
Never to leave them until dismissed. These settings follow the user through Host
settings. A stopped turn covers a cancellation, a blocked turn, and one that hit
its token ceiling. System permission is requested
only after an explicit action, and OS notification text stays generic (no prompt,
thread title, or raw error details). Sounds use one browser audio context,
unlocked by the first user gesture and resumed before every tone, so an alert in a
background tab still rings. Existing desktop-alert choices migrate to system
delivery.

A thread open in a visible, focused window raises no toast, system notification
or sound: you are already looking at it. The event is still claimed, so another
tab stays quiet too, and Notification history still records it. The same thread
in a hidden tab or an unfocused window notifies as usual.

**Agent notifications.** `notify_user` (API `thread-user-notifications.send`)
lets an agent send a title and an optional body, linked to its own thread by
default (`sessionId: null` for none, or another thread's id). Its description
limits it to when the user asked to be notified or a long task or routine needs
their attention. Every open page routes it through its own **Agent messages**
notification category, independent of **Input needed**: on by default (in-app,
plus system once permission is granted; no sound), because it fires only when an
agent decides you need to know and is rate-limited. Switch it off or change its
delivery and sound in Settings › Notifications › Thread notifications › Agent
messages; the global snooze and the thread's mute still apply,
and skips a thread you are watching, as above; a click opens the linked thread.
Each page reports back what it did, and the tool waits up to
1.5 s for that: it returns `delivered: true` once a page showed it, or
`delivered: false` with a `reason` (`category-off`, `snoozed`, `thread-muted`,
`watched-thread`, `system-permission`, `subagent-hidden`, `no-open-page`) and a
`recovery` naming the setting that turns it on, so the agent tells the user in
chat instead. Unlike the generic thread alerts, the agent's own text is shown, so it must
not carry secrets. Sends are limited to 3 per thread and 12 in total per 10
minutes; a refused send returns `rate-limited` with the seconds to wait. Nothing
is queued for pages that open later, and it adds no history entry. Each send
leaves a `thread-sidebar user notification send` span.

**Park vs settle vs mute.** Park files a finished thread away: it moves to the
Parked section, is skipped by auto-settle, and stays parked until unparked, but
its alerts still fire and it still runs steps when something wakes it. Settle
goes further: the thread moves to the Settled section and runs no step at all
until it is unsettled, while staying listed and openable. Mute keeps the thread where it is and only silences it, for
a while or for good. They answer different questions ("not now" vs "not
noisy"), so they stay separate: settling a parked thread drops its parked
mark, and unsettling does not bring that mark back. The sidebar separates **Approval needed**,
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
offers **Resume all** (up to three requests at once). The status-grouped **Needs you** group and the **Usage limit**
group offer the same verb, so every list of blocked threads can resume them together. Resume sends a new
continuation prompt that directs the agent to inspect its transcript and
workspace before continuing; it does not replay the interrupted model/tool call.
A row leaves its group as soon as that thread runs again, and dismissing drops it
by hand.

**Automatic resume after a restart** is opt-in (`resumeAfterRestart`, off by default: each resume is one turn nobody
asked for). When on, after a managed restart the new Host waits `resumeAfterRestartDelaySeconds` (default 10) and for
the Session controller to answer, then sends each **Needs resume** row of that restart its continuation prompt once,
newest first, at most `resumeAfterRestartMaxThreads` (default 5), three at a time. The restart capture also records
the tool calls each thread had started and not finished, so the prompt says what was cut off, including a background
command the agent was waiting on. It never resumes **Interrupted** rows (a crash has no such capture), a thread that ran
again since boot (the user continued or stopped it), or rows over the limit; those wait for **Resume** or **Resume
all**. Each resumed thread, and each one left over the limit, gets a line in the Activity log, and `thread_recoveries`
reports what the automatic resume did after this boot.

Approval, Input, and Turn finished can be configured independently as a
separate group or inline thread-row label.
Approval and Input default to groups; Turn finished defaults to an inline
label. Each status has an independently configurable semantic color in Sidebar
settings (Muted, Primary, Info, Success, Warning, or Danger); the default colors
are Warning for Approval and Input, and Success for Turn finished; generic
working indicators remain Info. Group headings stick to the top while scrolling.
Subagent attention is
excluded from groups, labels, and desktop alerts by default; enable **Include
subagent threads** in **Thread list settings** to opt in. An unresolved request stays
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
subagent rules as a listed parent. The header carries one archive action for the
whole branch, because those child rows have no menu of their own and there is no
parent row to cascade from; with the Archived filter on, the same button restores
the branch. An archived branch leaves the unfiltered list instead of sitting
there forever — the Archived section can only list root rows, so the archived
filter is where it comes back. Nothing can create that state through the
UI — DSH has no session delete — so a unit test covers the grouping and the
branch action, and the browser journeys cover the listed-parent case.

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

Prompt links open a new thread with its composer already filled in:
`http://127.0.0.1:3080/?prompt=<text>`, optionally with `&project=<project id or folder path>`
and `&model=<provider>/<model>`. The sidebar reads them once at load, removes the
three parameters from the address so a reload or a copied URL never reopens the
draft, creates the thread in that project (else the current or first project),
selects the model when one is given, and opens it. Nothing is sent: the text waits
in the composer. An unknown project or a refused model leaves a console warning
and still opens the draft in the default project with the default model. The link
needs a browser already signed in to that DSH; a tokenized launch URL redirects
and drops the extra parameters.

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
**Mention a thread.** A row's context menu, a `@dshfiles/main-tabs` thread
tab's menu, and a drag from either source all insert that thread as the same
native reference chip in the composer on screen: the menus send an unaddressed
request, which the composer of the Session `uiSession`'s current binding shows
takes (never an aside's composer, and nothing when no thread is on stage). The
drag carries only
`application/x-dshfiles-thread-mention` (`{ "sessionId": … }`), never plain text,
so the rich editor cannot paste a stray title: the composer under the pointer
outlines, a _Drop to mention thread_ hint follows it, and only the composer whose
own seat received the drop inserts. A drop on a right-panel aside inserts there,
never in a main composer showing the same thread. The row menu item is
`@Mention thread`; resolution, unavailable-target and draft-changed outcomes
notify through the composer instead of touching the draft.

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
  --plugin @dshfiles/jj-integration --plugin @dshfiles/workspace-nav \
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

Saved views use the `thread-sidebar-views` API over the same `thread-sidebar.threadViews` Host settings the GUI edits. `thread_views_list` and `thread_view_get` return the actual view definitions, order, selection and revision. `thread_view_create`, `thread_view_update`, `thread_view_delete`, `thread_view_move` and `thread_view_select` create, rename, enable, filter, reorder, remove and select views; select also changes group/filter control visibility. Delete requires explicit `confirm: true` and returns the removed view with its `position`; `thread_view_create` with those fields restores it in place. As filter presets (b:xpvk): `thread_views_list` also reports `edited` (unsaved filters in `settings.draft`) and the list's `projectFilter`; `thread_view_create` with only `{ id, name }` saves the list's current filters, and `select: true` applies it; `thread_view_update { id, fromCurrent: true }` is **Save changes**; `thread_view_select` applies a preset (dropping the draft, setting its project scope) and switches `showPresets` / `showPresetChips`. Invalid or missing targets, duplicate names or ids, the twelve-view limit and removing the last enabled view are rejected. Writes update only the view document and use the settings revision to refuse concurrent edits instead of overwriting them.

One dshx API (`thread-actions`, owner `@dshfiles/thread-sidebar`, defined in
`src/thread-actions-api.ts`) exposes the sidebar's thread and project actions to
the Agent as twenty-three native tools: `thread_list`, `thread_archive`,
`thread_unarchive`, `thread_settle`, `thread_unsettle`, `thread_pin`,
`thread_unpin`, `thread_rename`,
`thread_fork`, `thread_continue_in`, `thread_fan_out`, `thread_create`, `thread_prompt`, `thread_stop`,
`thread_select_model`, `thread_status`, `thread_references`, `project_list`,
`project_register`, `project_rename`, `project_delete`, `project_reorder`, and
`thread_move` (a reorder within the project that already holds the thread;
`thread_continue_in` is the cross-project move). `src/thread-actions.ts`
holds the decoded logic over plain ids and `src/thread-actions-host.ts` resolves
the live Host services on each call (`sessionController`,
`workspaceController`, `workspaceRegistry`, `sessionQuery`, and this plugin's own
`thread-sidebar` settings scope for the settled set). `thread_settle` and
`thread_unsettle` write `settledSessionIds` through that scope, so the Agent and
every browser see one status.

`thread_create` starts the thread's turn when it is given `text`: the same call
creates, names and briefs a new thread, so an Agent never leaves one idle
between a create and a prompt. `title` stays optional — with only `text` the
Host's automatic title stands, derived from that first message — and a refused
first message still returns the new id, reporting `prompt: 'refused'` and the
reason. `thread_prompt` is the follow-up verb over the same
`sessionController.prompt` the composer uses: `mode: 'queue'` (the default)
starts the thread's next turn or appends to a running one, `mode: 'steer'`
folds the text into the live turn, which the Host refuses when the thread is
idle. Both take an explicit `sessionId` to reach another thread and default to
the calling one.

`thread_continue_in` is the menu's **Continue in project**: `projectId` from
`project_list`, an optional `sessionId` (the calling thread by default) and an
optional `text` queued as the new thread's first message. Called by the thread
it moves, it keeps the running turn in the copy, and the settle stops the
original after the call; another thread must be idle. A refused settle or first
message still returns the new thread id.

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

`thread_subscribe`, `thread_unsubscribe` and `thread_subscriptions` (API
`thread-subscriptions`, `src/subscriptions-api.ts`) are the opt-in completion
notices b:eqtb asked for. A thread that intends to end its turn while it waits on
another thread — typically one it started with `thread_create` / `thread_fork`,
which is a root thread and never resumes its creator — calls
`thread_subscribe { sessionId }` first: the edge is stored durably in the
`thread_subscriptions` storage domain (`src/subscriptions-store.ts`), and from
then on that target's `turn/end` sends ONE compact notice into the subscriber.
The notice carries the status (`finished`, `landed` when the thread's workspace
landed on the trunk during that turn, `failed`, `blocked`, `stopped`,
`truncated`, or `waiting-on-question` when the target stopped on a question,
which outranks its finish reason) plus a 320-character preview of the answer of
the turn that ended — taken from that turn's own `assistant/message` events, so
it never quotes an earlier or later turn, and never the transcript or tool
output — and says that quoted text is data, not instructions. A turn that only
compacted (a `compaction/*` bracket and no answer) sends nothing unless it
failed.

Delivery (`src/subscription-notices.ts`, `src/subscription-notices-host.ts`) is
session-controller's `sessions.message` with `wake: true`, the same inbox path a
native subagent settlement uses; the watcher only listens to the public
`session/event` stream.

| Subscriber is…                       | `subscriptionDelivery: steer` (default)                                                | `queue`                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------ |
| idle                                 | woken at once with the notice (`next-turn`)                                            | same                                             |
| running                              | held, then steered into its live turn at its next `step/end` (`next-step`)             | held until its `turn/end`, then queued and woken |
| woken, turn not started yet (≤ 60 s) | held and steered into that turn at its first step end, instead of a second queued item | held until that turn ends                        |

Everything held for one subscriber leaves as ONE message: several targets become
one line each (`- “title” (id) — status: preview`), and a target that ended
twice keeps only its latest status. A steer the Host refuses (no live turn,
compacting, a race) stays held and leaves queued at the subscriber's turn end,
merged with whatever arrived meanwhile. Held notices live in Host memory only:
a Host restart drops them.

Each subscription has a level: `all` (every turn end), `outcomes` (landed,
failed or a question), `stuck` (failed, a question, blocked or truncated) or
`never` (kept but silent). A subscription without its own level follows the
`subscriptionNoticeLevel` setting (default `all`). `thread_subscribe { sessionId,
level }` sets it (`default` clears it); subscribing an existing pair changes its
level. Native subagent settlement notices do not pass through this filter: the
subagent manager calls `parent.inject` / `sendWaking` directly, with no hook a
plugin can register (see `plans/dsh-host-gaps.md`). Nothing is delivered
without an edge, so the default stays silent: a created thread does not wake its
creator. A thread cannot watch itself and a pair cannot watch itself in both
directions (two threads that wake each other would keep each other running); an
archived subscriber or target ends the edge — at once through this plugin's own
archive path, and on the next notice pass for an archive made elsewhere — and a
subscriber the Host no longer resolves loses its edge instead of retrying. The
same state is the **Notify…** submenu in a thread row's context menu (also the
phone action sheet a long press opens) — headed "When this thread finishes,
notify “…”", with **Use default (Every turn)** (naming the current default
level), Every turn, Landed, failed or a question, Only when stuck, and Off for
the open thread watching that row (a pair stored at upstream's Never level shows
as Off: it notifies as little); with several
rows selected it sets that choice for all of them at once — and the
`N notified` badge on a row that has subscribers; both read the one Host
snapshot, refreshed by the API's `changed` event.

`thread_queue_remove`, `thread_queue_steer` and `thread_queue_edit` act on one
queued message through the Session controller's `updateQueue`, the verb the queue
dock uses. `thread_queue_edit` is the native in-place edit: the message keeps its
id and its place in the queue and gets the new `text`; the Host refuses a message
that carries images or files (queue-reorder's **Edit** button handles those by
moving the message through the composer). `queue_describe` lists the ids.

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

## Subagent row in the transcript

![Live subagent preview in the transcript and above the composer](docs/screenshots/subagent-live-preview.png)

The row of a `subagent` or `subagent_fork` call reports the child rather than the call: Working, Finished, Interrupted or Idle, from the session status and the child's timing projection. These are agent states, deliberately not the job lifecycle: a child that went idle can be followed up. Opened, the row holds a client reference to the child and folds its event window into the current tool and the tail of its latest answer; collapsing releases it, and the window repaints on a timer rather than per token, so the parent transcript never re-renders for it. The row links to the child's thread, opens it beside the chat, and offers Stop behind a confirmation. Stop is the session's own cancel, which `interrupt_agent` also reaches; an interrupted child can be messaged again.

A parent commonly ends its turn to wait for its children, which folds these rows, so working subagents also list above the composer (`conversation.input.dock`) with the same preview, and leave as they go idle. Two or more fold into one row, **N subagents working**, closed by default like the background-jobs dock's; opening it lists each child, and the choice holds while children start and finish. A child that failed or needs you is not working, so it never hides in the fold.

With `subagentRunCards` on (the default), a working child whose open turn, route and current tool are known renders as the kit's compact `AgentRunStatus` card instead of the one-line row: current tool, route, elapsed time from the turn's own start, the tool-call count as “Step n”, Stop behind the same confirmation and **Open thread**. There is no Pause: DSH has no Host verb that pauses a session. Pause, Stop and Open render only when the caller passes their handler, so the card never shows a disabled stand-in. A child missing any of those parts (no open turn yet, no route projection, no tool in flight) keeps the one-line row, and turning the setting off is that row for every child. The card fits a 390 px pane and every action is a kit button, so the coarse-pointer rules give it a 44 px hit area and it stays keyboard-operable.
