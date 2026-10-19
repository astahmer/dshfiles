# @dshfiles/backlog

One capture feed for notes, tasks, bugs, ideas and questions, shared by the user and every agent. It
replaces a "TODO" chat channel: adding something costs one line, the feed stays ordered by activity so
idle things sink, and the tracker parts (status, actors, links, search, board) come for free.

Plan and open steps: [plans/backlog](../../../plans/backlog/README.md).

## Capture

The **Backlog** sidebar panel has one capture box (Enter adds, Shift+Enter breaks the line); agents use
`backlog_capture`. Structure comes from the text:

- `bug:`, `idea:`, `note:`, `question:`, `task:`/`todo:` set the kind; a first line ending in `?` is a
  question; anything else is a task. The first line is the title, the rest the markdown body.
- `#tag` adds a tag; `b:<n>` links another item; `jj:<rev>` a revision; `branch:<name>`, `workspace:<path>`,
  a `session-…` id and URLs become typed links.
- An agent capture links the calling thread, names the agent as owner and takes its working directory as
  the project.

New items land in `inbox`.

## Feed, board and freshness

The feed lists pinned items first, then newest activity. Freshness is derived on read and never stored:

| Item               | Leaves the feed                             |
| ------------------ | ------------------------------------------- |
| `note`             | dormant after 14 idle days                  |
| other open items   | dormant after 30 idle days                  |
| `doing`            | never; flagged **stale** after 14 idle days |
| `done` / `dropped` | archived after 7 days                       |
| pinned             | never                                       |

Dormant and archived items stay in search, filters and backlinks. Any edit, move, link or comment makes
an item fresh again. The list groups the feed like a chat history (Pinned, Today, Yesterday, This week,
Earlier). The board shows the same items by status; drag a card to another column, or use its status ring.
Status, kind and drops update the view before the Host answers. While you type, chips under the capture
box show the kind, tags and links triage will derive.

Keyboard: `J`/`K` (or arrows) move, `Enter` opens the peek, `Esc` closes it, `C` focuses capture, `/` search,
`B` toggles list and board; a status or kind menu takes `1`–`5`.

## Item peek

The peek opens beside the list (over it in a narrow pane). Edit the title and the markdown body in place, change kind and status, pin, link and unlink targets, comment, and read every event
with its actor (`user`, `system` or `agent:<sessionId>`). **Referenced by** lists the items that link to
this one. Fields the user changes by hand are recorded in `humanFields`, so later automatic moves can
leave them alone. Nothing is deleted; `dropped` closes an item.

## Agent tools

| Tool                  | Kind                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------- |
| `backlog_list`        | read: search and filter (`statuses`, `kinds`, `project`, `tag`, `actor`, `freshness`) |
| `backlog_get`         | read: one item with history and backlinks                                             |
| `backlog_referencing` | read: items linking to a thread, revision, branch, workspace, URL or item             |
| `backlog_capture`     | write                                                                                 |
| `backlog_update`      | write: edit or move                                                                   |
| `backlog_link`        | write: link or unlink                                                                 |
| `backlog_comment`     | write                                                                                 |

## Storage

Host-owned storage-domain `backlog`, table `items` keyed by id, so every browser and agent reads the same
rows. Search is an in-memory token match over title, body, tags, project and link targets.
