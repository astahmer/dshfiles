# @dshfiles/jujutsu

A DSH sidebar plugin for browsing and changing a Jujutsu repository. It is built
with this repository's local `@dshfiles/dshx` fork and DSH 0.2 client/host
contracts.

## What it provides

- A revision graph with change IDs, author and relative time, bookmarks, tags,
  workspace labels, working-copy marker, immutable (diamond), empty (hollow),
  conflict, divergent, and evolved markers, collapsible day groups, and
  author-name, text, mine, immutable, and date filters.
- Expanded revisions show the description, Describe / Full diff / Edit This
  Change / Squash into parent, and changed files as a Flat or Tree list with
  M/A/D status, +/- counts, folder counts, and per-file review marks.
- Full diff opens every file of a revision with numbered rows and collapsed
  "N unmodified lines" separators, rendered from `jj diff --git`.
- Right-click a revision for full diff, describe, edit, new change, squash,
  duplicate, revert onto @, rebase onto main, create bookmark, copy IDs, and
  abandon; right-click a local bookmark to push or delete it.
- A Source Control view modelled on jj-view: a message box that describes or
  commits @, then Working Copy and `@-1 … @-N` groups with per-file open diff,
  discard (`jj restore`), move to parent/child (`jj squash` with literal
  filesets), split by selected files, and group describe/new/edit/squash.
- Repository selection through the shared project/folder command palette
  (registered DSH projects, recent repositories, `/` folder browsing).
- Dragging a local bookmark or revision onto a revision (main page and side
  panel) prepares a move/rebase preview while the moving branch is dimmed.
  Every mutation, fetch, and push needs a second explicit confirmation.
- View settings (default tab, ancestor groups, file layout, raw patch expanded,
  day grouping, hide immutable, mine only, revisions loaded) are saved in this
  browser and shared live by the main page and side panel.
- Create an isolated JJ workspace at a listed revision, then explicitly open a
  DSH Session in that directory.
- Browse durable event sequence boundaries for a listed Session, load older
  history, and fork/open a child at the selected boundary through the native
  Session Controller. This history control does not display message contents
  or transient stream chunks.

## Host and command boundary

The Host injects both `subprocess` and `webServer`: DSH's ConnectionService
registers API routes through the Host owner's `webServer` context. It uses the
DSH 0.2 `ctx.subprocess` service, resolves the literal `jj` executable once,
then invokes it only as an argv array with the registered repository root as
`cwd`; it never builds a shell command or forwards ambient environment
variables. Output is byte bounded, requests are cancellable, and commands have
fixed timeouts. Stderr is not returned to the browser because a remote helper
may put credentials in it.

The browser supplies an absolute path only when registering a repository. The
Host canonicalizes it, verifies it with `jj root`, and stores an opaque,
process-local repository id. Later API calls accept only that id. Before and
after commands, the Host checks the canonical directory and its device/inode;
before confirmation it recomputes the revision/status/path and remote-config
fingerprint. Remote configuration is hashed in memory and never sent to the
client. Remote preview and command output is redacted before it crosses the
API.

Confirmation tokens are one-use, expire after five minutes, and bind the
action to the repository identity and current state. Fetch cannot provide an
exact incoming-change preview through the supported JJ command used here, so
its preview explains that remote changes depend on the fetch response. Push
uses `jj git push --dry-run` when available; a failed dry run is disclosed in
the preview and never starts the real push.

The subprocess contract accepts `cwd` as a path string and has no opened-
directory handle or Host-issued repository capability. Canonicalization and
device/inode checks substantially constrain symlink replacement, but a narrow
TOCTOU window remains between the final path check and process launch. Closing
that last race requires a Host/subprocess contract that binds process launch to
an already-open directory handle. Repository registration still uses a typed
path field because the Host contract exposes no repository picker.

Workspace provisioning uses the Client `uiWorkspace.pickDirectory` picker.
The Host treats its result as untrusted: it canonicalizes an existing parent,
rejects destinations inside or above the registered repository tree and any
existing destination, and binds the preview to the parent directory's device
and inode before repeating the checks at confirmation. `jj workspace add`
receives the validated path and name as separate argv values. The final path
check and process launch still have a narrow TOCTOU window because the Host
subprocess API has no opened-directory handle. Opening a Session in the created
directory is a separate user action through the native Session and UI
Workspace services.

Revision details show file counts, diff line counts, evolution history, and the
selected revision's full diff. Description drafts are keyed by revision, so
switching revisions or moving between the detail and working-copy panels does
not reuse text from a different change. After a rewrite, the detail selection
follows the stable change ID to its current commit.

Split passes every selected listed path as its own `root-file:"..."` fileset
argument. The encoder escapes JJ string-literal quotes, backslashes, tabs, and
control bytes, so spaces, Unicode, and glob/fileset metacharacters remain part
of one exact workspace-relative filename. Absolute paths, traversal segments,
NUL, CR, and LF are rejected. CR/LF cannot be represented unambiguously by the
current line-delimited `jj diff --name-only` path response; supporting those
filenames requires a NUL-delimited Host query.
The last-push marker matches the recorded `args: jj git push` command invocation
(plus the fixed `--color=never --no-pager` flags this plugin adds), then shows
that operation's JJ end time. It excludes `--dry-run` commands so preparing a
preview cannot advance the marker. The timestamp identifies a recorded command
invocation; JJ operation data does not prove the remote accepted it. It never
treats an unrelated recent operation as a push. The scan is bounded to the
latest 1,000 operations and 512 KB of output. Direct `git push` commands, JJ
push invocations created with `--no-integrate-operation`, older operations
outside that scan, and unavailable or truncated operation history cannot be
identified from this query; the UI reports when the scan is incomplete and
when no marker was found in its window.

## Runtime compatibility and composition

The package peer ranges target `@deepseek-ai/* >=0.2.0-rc.1 <0.3.0-0`, which
includes the installed DSH `0.2.0-rc.2`. Its source imports the installed
`@deepseek-ai/dsh-subprocess` contract and DSH 0.2 client layout/sidebar/slots
contracts; it does not use BB APIs or direct `child_process` calls.

The package's `cordis.patch.yml` inserts the `@dshfiles/jujutsu` loader row.
To enable it in a chosen profile, the parent composition must add the local
package to that profile's bundle dependencies and bundle list. This child
workstream does not edit the active DSH profile or the root workspace
manifests/lockfiles.

## Marketplace decision

Decision: **build with local dshx**. The marketplace survey did not find a
Jujutsu/VisualJJ-like DSH UI that covers this workflow. The closest catalog
candidate inspected, `changestab@0.3.0`, has no declared DSH peer range, and its
published code imports older client runtime/primitives and uses direct
`child_process` execution. It is a read-only changes sidebar, so its package
metadata and actual imports do not establish compatibility with installed DSH
0.2 or cover the requested graph and confirmed Source Control actions. A port
would carry obsolete runtime assumptions without providing the needed
capability.
