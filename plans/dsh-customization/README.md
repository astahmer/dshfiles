# DSH customization needs

This is the durable product brief for rebuilding selected parts of our BB setup
inside the custom DSH setup in this repository. The original screenshots sent
with the request are preserved in [`screenshots/`](screenshots/).

The goal is to make DSH feel like a focused workbench inspired by Codex, T3 Code,
and BB. Prefer an existing DSH marketplace plugin when it covers the behavior.
For capabilities we own, use the DSH runtime contracts and the local dshx fork;
BB plugins are examples of desired behavior, not implementation specifications.
Before building any UI, confirm the Host exposes the service or event needed for
the behavior. Record clearly when a desired behavior needs a Host change.

## Requested features

### Thread sidebar and lifecycle

Create a T3 Code-like left sidebar that groups threads by project and separates
active and inactive work. Support pinning and parking threads, and settle or
auto-archive inactive threads after a configurable period. Keep the active state
visible (including work in progress), make inactive work easy to recover, and
let the user choose the project scope and sort order. See
[`01-thread-sidebar.png`](screenshots/01-thread-sidebar.png).

### Sidebar header links

Provide customizable navigation links in the sidebar header. The links can be
shown as a compact horizontal icon row or expanded into a vertical, labeled
list. Let users choose which links appear and their order. Include an MCP
Servers destination alongside the other plugin pages. See
[`02-sidebar-header-collapsed.png`](screenshots/02-sidebar-header-collapsed.png)
and [`03-sidebar-header-expanded.png`](screenshots/03-sidebar-header-expanded.png).

### MCP server management and catalog

Make MCP Servers reachable from both the sidebar header links and the `+` menu
beside the model picker. The quick panel should show server connection state,
allow enabling or disconnecting a server, refresh the list, and link to full
management and adding a server. The management page should support local and
remote server configuration, editing, enabling/disabling, and removal. Include
a searchable catalog of provider and registry listings with descriptions,
categories, documentation links, and a path to add a custom server. See
[`04-mcp-server-management.png`](screenshots/04-mcp-server-management.png),
[`05-composer-mcp-shortcut.png`](screenshots/05-composer-mcp-shortcut.png),
[`06-mcp-quick-panel.png`](screenshots/06-mcp-quick-panel.png), and
[`07-mcp-catalog.png`](screenshots/07-mcp-catalog.png).

### Secret catalog

Build a secret catalog backed by the `secret` CLI. List aliases and metadata,
filter by variable, service, or alias, and support all/project/global/local
scopes. Secret values must be hidden by default, with deliberate reveal and copy
actions. Support adding, editing, deleting, choosing the machine, and filtering
by project folder. See [`08-secret-catalog.png`](screenshots/08-secret-catalog.png).

### Reusable project and folder picker

Build a shared project/folder picker for use by multiple DSH plugins. It should
search projects, accept `/` to enter a folder path, show project names and
workspace paths, support keyboard navigation and Enter/Escape, and expose
numbered shortcuts for the visible results. See
[`09-project-folder-picker.png`](screenshots/09-project-folder-picker.png).

### Sidebar and footer customization

Make sidebar navigation easy to customize by reordering and hiding individual
links. Do the same for footer actions, retaining hidden actions in a More menu.
This is a native BB behavior to reproduce or adopt when DSH already provides an
equivalent. See
[`10-sidebar-navigation-customization.png`](screenshots/10-sidebar-navigation-customization.png)
and [`11-sidebar-footer-customization.png`](screenshots/11-sidebar-footer-customization.png).

### Settings search

Add fast search across settings pages and plugin settings. Show matching setting
names with their category and section path, then navigate directly to the
selected setting. With no query, retain the normal settings category list. See
[`12-settings-search.png`](screenshots/12-settings-search.png) and
[`13-settings-search-results.png`](screenshots/13-settings-search-results.png).

### Jujutsu plugin

Build the Jujutsu plugin inspired by VisualJJ. Include a revision graph and
source-control view, repository selection, fetch/push/refresh actions, author
and immutable filters, date and text search, and clear markers for the working
copy revision and editing state. Keep Jujutsu as the source of truth. See
[`14-jujutsu-revision-graph.png`](screenshots/14-jujutsu-revision-graph.png).

The existing BB Jujutsu plugin README adds useful behavior beyond the screenshot:
show bookmarks, tags, workspace labels, relative time, shortest unique change
IDs, evolved-revision markers, and the last recorded Git push. Search revision
descriptions and IDs as well as bookmarks and tags; group by day; let users hide
immutable history while preserving ancestry in the graph. Expand revisions to
edit their descriptions and inspect changed files with addition/deletion counts.
The Source Control view follows the working copy through configurable `@-1`
ancestor groups and supports full diffs, describe, split, and squash. Dragging a
revision or bookmark should preview the proposed move and require confirmation
before a rebase or bookmark mutation. The BB README is a behavior reference;
implement against DSH's real Host services and events.

### Thread links and delegated work

Let users right-click any sidebar thread to copy its stable thread ID or a link
that opens that thread in the same DSH Host. Show delegated threads nested
under their direct parent, with parent identity preserved at every level. The
relationship model must support an arbitrary parent chain even if the current
delegation depth setting is lower. In chat, `@` should surface recent thread
references when empty and allow searching all threads by ID, title, or project.
Keep parallel child-thread execution and parent-side orchestration available
through the DSH agent tools. See the implementation notes in
[`thread-sidebar`](../../plugins/@dshfiles/thread-sidebar/README.md).

## Status

Packaging the web UI as a native app is tracked separately in
[`desktop-shell/`](../desktop-shell/README.md); it adds no Host capability, so it
is not a customization feature.

| Feature | State | Where |
|---|---|---|
| Provider accounts (Codex, OpenCode Go, Command Code) | built with dshx | `plugins/@dshfiles/ai-accounts` |
| Queue reordering | built with dshx | `plugins/@dshfiles/queue-reorder` |
| Independent Agent communication | built with dshx; profile activation pending | `plugins/@dshfiles/agent-communication` |
| Thread sidebar and lifecycle | implemented; combined DSH boot verified | `plugins/@dshfiles/thread-sidebar` |
| Thread links and recursive delegation context | implemented; full runtime acceptance pending | `plugins/@dshfiles/thread-sidebar` and DSH standard web preset |
| Sidebar header links | implemented; combined DSH boot verified | `plugins/@dshfiles/thread-sidebar` |
| MCP server management and catalog | implemented; combined DSH boot verified | `plugins/@dshfiles/mcp-servers` |
| Secret catalog | implemented; synthetic CLI tests and combined DSH boot verified | `plugins/@dshfiles/secret-catalog` |
| Reusable project and folder picker | implemented as a shared package | `plugins/@dshfiles/project-folder-picker` |
| Sidebar and footer customization | implemented on the installed sidebar slots | `plugins/@dshfiles/thread-sidebar` |
| Settings search | implemented; combined DSH boot verified | `plugins/@dshfiles/settings-search` |
| Jujutsu plugin | implemented; safe command tests and combined DSH boot verified | `plugins/@dshfiles/jujutsu` |

All requested plugin packages and the shared picker are in this repository.
The isolated combined profile activated the Host packages and served the five
custom Client bundles. The active user profile remains unchanged. See [the
integration review](integration-review.md) for validation evidence, profile
composition steps, and remaining runtime contract limits.

## Product decisions to carry forward

- Reuse the project/folder picker instead of rebuilding project selection in
  individual plugins.
- Prefer DSH-native sidebar and footer customization wherever the Host already
  provides it; a plugin cannot add a missing Host capability.
- Treat MCP catalog entries as discoverability, not endorsement. Show provider
  documentation and make the configured endpoint clear before connecting.
- Keep secret values out of lists and logs. Reveal only on an explicit action.
- Make settle duration and the handling of pinned/parked threads configurable.
- For each feature, report whether it is adopted, forked/ported, built with
  dshx, or requires a DSH Host change, and why.

## Reference images

The PNGs in `screenshots/` are original copies of the 14 images attached to the
request. The numbered names follow the request order and the captions above map
each image to the related behavior.
