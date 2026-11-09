# Diff Viewed

Adds a **Viewed** toggle and a `2/9 viewed` progress ring and count to the toolbar of the
native changed-files review tab, so you can track which files of a turn you have
already read.

It hooks the `deliverables.review.file.actions` list slot that
`@deepseek-ai/dsh-client-ui-deliverables` renders for the selected file. The
slot hands its entries an `actionUrl` carrying the Session, the announcing
`workspace/changes` sequence and the file's summary index; the toggle reads the
same `api/changes.summary` route the review tab reads to learn the file's path
and the turn's file count. It reads each turn's summary once per page (it never
changes) and takes a 404 as "no summary": the Host keeps summaries only while
the Session's change recorder is loaded, and re-asking after a Host restart or an
unloaded Session would only add a failed request to the browser console.

A mark is keyed on Session, sequence and path. A turn's summary never changes
while its Session lives, so a mark cannot outlive the diff it reviewed: a later
turn that edits the file again is a new review and reads as not viewed. Marks
live in the Host's durable `diff_viewed` storage domain, capped at the 2,000
most recent, so every browser, plugin and CLI reads the same review progress.
The `diff-viewed` API serves the snapshot and the toggles; a browser whose Host
does not serve it yet (an older Host, or the HMR window before a restart) keeps
its own `localStorage` marks and hands them to the Host once it does. The Host
forgets summaries when a Session is disposed or the Host restarts, so a mark is
only useful as long as the review it belongs to.

## One viewed-marks store

This plugin owns the only viewed-marks store. Besides the per-turn marks above, it keeps
**revision-range marks**: one file of one workspace's diff between a base (`main`, `@-`, a fork
point) and a head commit, keyed `["range", workspacePath, base, head, path]`. The thread
**Changes** facet and the Review page ([pulls-review](../pulls-review/README.md)) read and write
them through the `@dshfiles/diff-viewed/marks-api` module:

- `rangeState({ workspacePath, base, head })` — the viewed paths of that range (agent tool
  `changes_viewed_files`, read-only).
- `set({ targets, viewed })` — mark up to 4,000 turn or range files viewed or not viewed in one
  write (agent tool `changes_mark_viewed`; `viewed: false` reverses it).

A new head commit is a new review, so its files start not viewed, the same rule as a new turn.
Range marks have their own bound (5,000, least recently written dropped first), so they never
evict turn marks; `state` still returns turn marks only, so the review tab's poll stays small.
The Review page's earlier marks (pulls-review's `reviewed` record) move here once on its first
load; see the pulls-review README.

## Port notes

Ported from the 0.1-era `/diff-viewed` command, which had no diff surface to
attach to and ran `jj diff --git` itself. DSH 0.2 ships a changed-files card and
review tab with a file-action slot, so this version is a toolbar entry plus a
Host half that owns the marks; it runs no subprocess.

The slot only adds toolbar content. These BB behaviors are not available:
collapsing a viewed file, an "only unviewed" filter in the file selector, and
auto-marking files as they scroll past. Each would need a Host change to the
review tab, not a plugin.
