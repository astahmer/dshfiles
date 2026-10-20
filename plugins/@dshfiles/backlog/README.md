# @dshfiles/backlog

One capture feed for notes, tasks, bugs, ideas and questions, shared by the user and every agent. It
replaces a "TODO" chat channel: adding something costs one line, the feed stays ordered by activity so
idle things sink, and the tracker parts (status, actors, links, search, board) come for free.

Plan and open steps: [plans/backlog](../../../plans/backlog/README.md).

## Capture

The **Backlog** sidebar panel has one capture box pinned to the bottom of every view (Enter adds,
Shift+Enter breaks the line); agents use `backlog_capture`. It is a chat-sized card with a Linear-style
toolbar:

- `+` picks images or any files, links a backlog item or a thread, or sets a project by searching the same
  index the panel uses. Picked references land in the text as `b:<n>` or a `session-…` id; a project becomes
  a chip.
- Status and kind chips are editable before sending; the kind chip otherwise follows the text prefix.
- Files can be picked, pasted or dropped. Images are scaled to 1600 px and re-encoded as WebP; other files
  keep their bytes. The Host keeps the bytes in their own storage domain, never in the item row. An item
  shows images as a thumbnail grid and other files as download rows; a feed row shows a paperclip count.
  At most eight files, 16 MB each (20 MB before an image is shrunk).
- The microphone records a 16 kHz mono WAV and transcribes it through the Host voice-input bundle
  (`@deepseek-ai/dsh-experimental-voice-input-bundle`), so the selected SenseVoice provider prepares and
  recognizes audio on the Host machine. The button is disabled with the setup reason until that bundle is
  loaded and its recognizer is ready.

Structure comes from the text:

- `bug:`, `idea:`, `note:`, `question:`, `task:`/`todo:` set the kind; a first line ending in `?` is a
  question; anything else is a task. The first line is the title, the rest the markdown body.
- `#tag` adds a tag; `b:<n>` links another item; `jj:<rev>` a revision; `branch:<name>`, `workspace:<path>`,
  a `session-…` id and URLs become typed links.
- An agent capture links the calling thread, names the agent as owner and takes its working directory as
  the project.

New items land in `inbox`.

## Feed, board and freshness

The feed lists pinned items first, then newest activity. A chip row above the feed and the Items list
narrows both to one status or several at once; the picks persist across reloads and `All` clears them.
Freshness is derived on read and never stored:

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

## Starting a thread from an item

Right-click a feed entry, an Items row or a board card (or press **Start thread** in the peek header) to open
the start-thread dialog. It prefills the item's own project when that path is a registered project, offers the
other projects plus a bare folder for a project path the registry does not know, and lists every routable
account/model from the Host catalog with the model's reasoning efforts. The first message is prefilled from
the item (title plus preview) and can be cleared to open an empty draft instead.

Starting creates the thread, selects the account/model on it, names it after the item, sends the first message
when one is left (Settings → `dshfiles-backlog` → _Send the prefilled first message_; off opens it as an editable
draft, and the dialog's _Send this message now_ box overrides the setting for one thread), links the item to the
thread (provenance `user`) and opens it. A thread with no project joins
the first registered workspace, the way the composer's New thread does. Failures after creation keep the thread
and open it: a refused model switch leaves the Host default model, and a failed link is logged rather than
losing the thread.

## Automatic triage

Off by default (Settings → `dshfiles-backlog`). With `autoTriage` on, every capture is triaged in the
background, so adding an item never waits:

- **Jev** (`jevEnabled`) answers two cheap yes/no questions:
  is this work to do (otherwise a plain capture becomes a `note`), and is it the same work as the closest
  open item (a suspected duplicate). Its key comes from `jevSecret` — a Secret Catalog reference such as
  `secret:TYPESAFE_KEY` or `secret:TYPESAFE_KEY@dev` — and falls back to `TYPESAFE_API_KEY` in the Host
  environment when that setting is empty. The value is resolved on the Host and never stored in settings.
- **A cheap model** (`triageProvider` + `triageModel`) proposes kind, status, title, tags and a duplicate
  among the similar items it is shown. Items whose applied triage you later corrected by hand are given
  to it as examples; they are read from the event log, not stored separately.

Agreement between the two raises the confidence, disagreement lowers it. At or above `applyThreshold`
(0.8) the proposal applies as `system` and leaves every field you set by hand alone; a duplicate is only
linked, never closed. Below it, the item shows a **Triage suggests** card (and a wand on its row) with
**Accept** and **Dismiss**; accepting makes those values yours. The wand in the peek header runs triage
on demand. A missing key, model or failing call is skipped and the item simply stays in the Inbox.

## Lifecycle signals

On by default (`lifecycleSignals`). Items move without anyone filing them:

- A user message that mentions `b:12` links that thread to the item and moves it to In progress.
- A revision on `main` whose description says `Closes b:12` (also `Fixes`, `Resolves`, `Completes`,
  `Implements`; several ids with commas or `and`) links that revision and moves the item to Done. A bare
  mention such as `part of b:12` closes nothing.

Signals only move forward (never Done back to In progress, never out of Dropped) and never over a status
you set by hand; the link is recorded either way. Revisions are read with `jj log --ignore-working-copy`
on `main` every `revisionPollMinutes` (5) in each repository an open item names, plus
`revisionRepositories`; an unchanged `main` costs one call.

## `@` mentions

In any composer, `@b:` (or `@backlog:`) searches the backlog, and plain `@` shows up to five matching
items next to threads and files. The chip is sent as `b:12 "title"`, so the thread signal above links the
thread and starts the item, just as typing `b:12` does.

## Agent tools

| Tool                       | Kind                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `backlog_list`             | read: search and filter (`statuses`, `kinds`, `project`, `tag`, `actor`, `freshness`) |
| `backlog_get`              | read: one item with history and backlinks                                             |
| `backlog_referencing`      | read: items linking to a thread, revision, branch, workspace, URL or item             |
| `backlog_capture`          | write                                                                                 |
| `backlog_update`           | write: edit or move                                                                   |
| `backlog_link`             | write: link or unlink                                                                 |
| `backlog_comment`          | write                                                                                 |
| `backlog_attach_file`      | write: keep one base64 image or file with an item                                     |
| `backlog_read_file`        | read: one image or file as a data URL                                                 |
| `backlog_remove_file`      | write: remove one image or file                                                       |
| `backlog_triage`           | write: run triage on one item now                                                     |
| `backlog_projects`         | read: per-project counts, who needs you, people                                       |
| `backlog_accept_proposal`  | write                                                                                 |
| `backlog_dismiss_proposal` | write                                                                                 |

## Search and saved views

The header search ranks by relevance and says where each result matched (title, tag, description, comment,
original capture, project, link), with the matching words highlighted. It covers dormant and archived
items. Words must all match; `"quoted phrases"` stay whole. Operators combine freely:

| Operator                | Example                                                  |
| ----------------------- | -------------------------------------------------------- |
| kind, status, attention | `kind:bug`, `status:doing`, `is:blocked`, `is:needs-you` |
| tag, project            | `#composer`, `project:welii`                             |
| who touched it          | `by:agent`, `by:me`                                      |
| what it links           | `has:thread`, `has:revision`, `has:url`                  |
| activity                | `updated:<7d`, `updated:>30d`                            |

**Views** saves the current view and search under a name in the plugin's settings (`savedViews`), so every
browser lists the same views.

## Inbox and the rest of the ADE

The Inbox holds items whose `attention` is set (`needs-input`, `blocked`, `waiting`, set by agents with
`backlog_update` or by you) and items with a triage suggestion. With `inboxThreads` (`failures` by default)
it also lists threads from the sidebar's unread list that are linked to an item and whose last turn was
blocked or errored (`all` adds finished turns waiting for review); acknowledging one clears it in the
sidebar too. Native `ask_user_question` forms stay in their threads: listing them across sessions is the
expensive scan recorded as a Host gap.

In the inspector, thread links show the thread's title and whether it is running, and a running linked
thread shows as an **Execution** strip at the top.

With `publishActivity` (on by default) item creation, moves, links, comments, triage and requests for
input are reported to `@dshfiles/activity-timeline` as `backlog.*` events (requests for input at
attention level), so the shared Activity room shows backlog work. The item's own event log stays the
source of truth: the timeline keeps a bounded, observation-only copy.

## Lifecycle and retention

`dormantAfterDays` sets, per kind, how many idle days an open item stays in the default views (0 keeps a
kind visible forever). Items asking for attention, pinned items and work in progress never go dormant; done
and dropped items archive after 7 days. Snoozing hides an item until a chosen time, then it resurfaces.

## Scale

Lists poll a revision number and refetch only when it changes. Items is virtualized, the Feed mounts the
newest 150 entries with older pages on request, Board columns mount 30 cards at a time, and project progress
is counted on the Host over every item. Measured on 2,017 items (headless Chromium, warm): Items 104–313 ms,
Board 208–269 ms, Feed 243–405 ms, search 82–550 ms, Projects 458–775 ms, first open 1.0–1.6 s.

## Storage

Host-owned storage-domain `backlog`, table `items` keyed by id, so every browser and agent reads the same
rows. Search is an in-memory token match over title, body, tags, project and link targets.

## Secret references

An item may name a credential without holding one: `secret:ALIAS` or
`secret:ALIAS@env` in the title or body becomes a `secret` link (the target is
`ALIAS` or `ALIAS@env`). Nothing is resolved there — the Secret Catalog owns the
value, and its own reveal covers the read. The capture composer carries
`data-secret-input="reference"`, so the Catalog's picker can write a reference
into it.
