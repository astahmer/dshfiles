# Diff Viewed

Adds a **Viewed** toggle and a `2/9 viewed` progress ring and count to the toolbar of the
native changed-files review tab, so you can track which files of a turn you have
already read.

It hooks the `deliverables.review.file.actions` list slot that
`@deepseek-ai/dsh-client-ui-deliverables` renders for the selected file. The
slot hands its entries an `actionUrl` carrying the Session, the announcing
`workspace/changes` sequence and the file's summary index; the toggle reads the
same `api/changes.summary` route the review tab reads to learn the file's path
and the turn's file count.

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

## Port notes

Ported from the 0.1-era `/diff-viewed` command, which had no diff surface to
attach to and ran `jj diff --git` itself. DSH 0.2 ships a changed-files card and
review tab with a file-action slot, so this version is a toolbar entry plus a
Host half that owns the marks; it runs no subprocess.

The slot only adds toolbar content. These BB behaviors are not available:
collapsing a viewed file, an "only unviewed" filter in the file selector, and
auto-marking files as they scroll past. Each would need a Host change to the
review tab, not a plugin.
