# Client state ownership

Where each piece of plugin state lives, and why. The rule this audit applies:

- **Host-owned** when the fact is about the user's work rather than one window:
  it must survive a reload and a restart, and a second browser, another plugin
  or a CLI must read the same value.
- **Browser-owned** when the fact describes one window's presentation (layout,
  sorting, which panel is open) or a capability the browser itself owns
  (notification permission, sidebar width).

The [thread-sidebar attention
refactor](../plugins/@dshfiles/thread-sidebar/sidebar-state.md) is the
reference case: the "turn finished, not seen yet" fact used to live in
`UiSession`'s per-tab memory and in the sidebar's own `localStorage` blob, so two
tabs disagreed and a reload forgot it. It now lives in the Host's
`thread_attention` domain behind the `thread-sidebar-attention` API.

## Host-owned today

Most of the sidebar's own state already went this way, and is the pattern to
copy: `@dshfiles/thread-sidebar` keeps `mutedThreads`, `parkedSessionIds`,
auto-archive policy and overrides, header/footer composition, workspace filter,
row options and attention display in its Host settings namespace, and now
attention itself in a storage domain. `@dshfiles/ai-accounts`,
`@dshfiles/project-checks`, `@dshfiles/agent-questions` and
`@dshfiles/memory` keep their real records in Host domains too.

## Browser-only today

| State | Owner | Key | Verdict |
| --- | --- | --- | --- |
| Saved thread views, active view, group/filter controls | thread-sidebar | `dshfiles.thread-sidebar.view.v1` | **Done.** The whole document is now the Host-synced `threadViews` setting; the browser copy an older version wrote is handed over once on load. |
| Review progress per file and revision | jujutsu | `dshfiles.jujutsu.review-progress.v1` | **Done.** The marks are the `jujutsu_review_progress` Host domain behind the `jujutsu-review-progress` API; the browser copy is a fallback while that API is unavailable. |
| Viewed marks | diff-viewed | `dshfiles.diffViewed.v1` | **Done.** The marks are the `diff_viewed` Host domain behind the `diff-viewed` API; the browser copy is a fallback and is replayed into the Host once. |
| Prompt library and drafts | prompt-stash | `dshfiles.prompt-stash.v1` | **Done.** Both are the `prompt_stash` Host domain behind the `prompt-stash` API; the browser copy is a fallback and is adopted once. |
| Pending queue-message edits | queue-reorder | `dshfiles.queue-reorder.edits.v1` | **Candidate.** The thing being edited (`session/updateQueue`) is Host state; the edit that has not been applied yet should not be visible to only one browser. |
| Repository selection, composer bases | jujutsu | `dshfiles.jujutsu.composer-base.v1`, repo path/history keys | Browser-local is defensible (a window's working context), but a CLI that asks "what repository is the user looking at" has no answer. Low priority. |
| Command palette recency | command-palette | `dshfiles.thread-sidebar.palette-frecency.v1` | Low priority. Ranking is per-person, not per-window, but the value of syncing it is small. |
| Open tabs, pinning and preview state | main-tabs | `dshfiles.main-tabs.v1` | Keep browser-local. Tabs are a window's layout; a Host copy would need per-client keys to avoid duplicate windows fighting. |
| Workbench layout, editor placement, panel positions, explorer selection, multi-host destination | workbench, editor, usage, ai-accounts, optmem, multi-host | `dshfiles.workbench.*`, `dshfiles-editor:*`, `dshfiles-usage:view.v1`, edge-usage position, `dshfiles.optmem.explorer.project`, `dshfiles.multi-host.destination`, `dshfiles.multi-host.open-thread` | Keep browser-local: presentation. |
| Sidebar preference fallback blob | thread-sidebar | `dshfiles.thread-sidebar.v1` | Keep, but only as the copy `usePreferences` writes while the Host namespace is unavailable; it is migrated into Host settings on the next load. |
| Legacy attention blob | thread-sidebar | `dshfiles.thread-sidebar.notifications.v1` | Read once, handed to the Host, then removed. Kept as a reader for the upgrade. |
| Desktop notification opt-in | thread-sidebar | now `desktopNotificationsEnabled` in Host settings | Moved with this refactor; the browser still owns `Notification.permission`. |
| `dsh:shared-event-source` kill switch | shared-streams | `dsh:shared-event-source` | Debug lever; a Host setting would be tidier but it deliberately bypasses the plugin's own plumbing. |
| Core session status (`running`, `pendingInteraction`, `completionUnread`) | DSH core (`dsh-client-ui-session`) | none (memory) | **Upstream gap, worked around.** `completionUnread` is per-tab memory; `main-tabs` now reads the `thread-sidebar-attention` contract instead, and the missing Host fact is recorded in [`plans/dsh-host-gaps.md`](../plans/dsh-host-gaps.md). |

## What to do next

1. Cross-client freshness is polling everywhere (thread-sidebar 15s plus focus
   and running transitions, main-tabs 5s, diff-viewed 5s, prompt-stash 2s while
   its popover is open, jujutsu on its own refreshes). The dshx API has no
   change stream, so a push channel is the next lever if a slower poll ever
   becomes visible.
2. `diff-viewed` and `jujutsu` keep separate review records. Merging them would
   need one identity: a diff-viewed mark is per Session + announcing sequence +
   path, a jujutsu mark is per revision + path.
3. Core still derives `completionUnread` per tab for its own surfaces. Anything
   else that needs the shared fact should read the attention API through the
   published contract; the gap is recorded in
   [`plans/dsh-host-gaps.md`](../plans/dsh-host-gaps.md).
