# Secret Catalog

Secret Catalog is a DSH 0.2 client/Host plugin backed by the installed
`secret` CLI contract. It uses `secret print --all --json` only when a project
folder is selected. Without one it calls `secret print global --json`, so the
Host process working directory cannot leak an unrelated project alias list.
The parser copies an explicit metadata allowlist (`alias`, `scope`, `env`,
`envKey`, `item`, and `field`, plus documented descriptive fields) and drops
unexpected properties such as `value` before data crosses to the Client.

The filter offers **All**, **Project**, **Global**, and **Local**. All includes
the three CLI scopes when a project folder is selected; without a folder the
Catalog shows global aliases and prompts for a folder to include project or
machine-local aliases. Selecting a folder retains its canonical path and,
when it is registered, its workspace id.

## Value actions and mutations

- Reveal calls the Host only when the exact row's masked value is clicked;
  hovering it says "Click to reveal". The revealed value is focused and stays in
  component state until the reveal timeout (15 seconds by default), Esc, a
  second click, focus leaving it or the window (when hide-on-blur is on),
  document hiding, a filter/scope/folder change, refresh, or unmount.
- Copy calls `secret get <alias> --copy` only after the exact row's Copy button
  is pressed, without revealing. The Host discards both output streams.
- **Add secret** under the list appends an editable row: an env-var style name
  (typed text is upper-cased, separators become `_`) and a masked value. The
  row menu offers Generate on this Host, Copy (the typed value) and Delete.
  Enter, or focus leaving the row, saves it to the viewed scope (the selected
  project under All, otherwise global) and the default environment. An empty
  draft asks for a value or Generate instead of saving: the Host refuses empty
  manual values and `secret set` documents no empty-value mode. The CLI has no
  bulk import command, so there is no Import entry.
- The arrow beside Add secret opens **Add with details…**: alias first, then
  where it lives (the selected project by default), environment (default
  `prod`), and where the value comes from. Generate asks the CLI to create the
  value on the Host; a typed value goes once to the Host and reaches the CLI on
  stdin. Item name, source, tags, type and field (`password`, or `notes` for a
  Secure Note) sit behind Advanced. Values never appear in arguments or
  captured output. Global uses the CLI's `--global`; project uses the selected
  working directory; local uses the selected folder's `.secret.local.json`
  through the CLI's `--config`. Both paths check metadata for an existing alias
  in the selected environment and refuse a duplicate before writing.
- Edit supports item name, source, tags, and a two-step masked value
  replacement. Value replacement is passed through stdin with an explicit
  overwrite flag after user confirmation. The CLI's `edit --field` also
  requests a new field value, so field changes are not offered as a metadata
  only edit.
- Remove alias and delete Bitwarden item are separate choices, each followed
  by confirmation. The CLI's `unset` removes that alias across every
  environment in the owning config; the confirmation says so. The CLI's `rm`
  requires `--force` and may fall back to unsetting if the vault item is
  already missing.

Project value actions resolve through the selected folder's merged CLI view;
global and local reads and vault deletion pass their exact config files. If the
same alias and environment appears in more than one scope, value and mutation
actions are disabled because the CLI cannot target the merged row by scope
identity. Search and metadata display remain available.

No live aliases or values were read during implementation or tests. Fixtures
use synthetic metadata and a fake CLI runner only. The Catalog never logs CLI
stdout/stderr or mutation stdin. Reveal responses are held only in transient
component state.

The Host runs the fixed `secret` executable through DSH's managed subprocess
service. It passes only the optional `BW_SESSION` and `SECRET_SESSION_FILE`
inputs to the CLI wrapper, caps captured stdout at 1 MB, keeps stderr out of the
UI and logs, and terminates the managed process range when the 15-second
command deadline expires.

## Rename, agent tools, and settings

Edit can rename an alias inside its owning config with `secret mv`; it refuses
a name that already exists. The Host registers two agent tools bound to the
calling Session's workspace (`session.header.cwd`): `secret_list` returns
metadata only, and `secret_get` returns one plaintext value, so it should be
called only when the task needs it. Arrow keys, Home, and End move between
table rows; the table header stays visible while rows scroll.

The `secret-catalog` Settings namespace (DSH Settings page) sets the default
scope filter, the environment prefilled for new secrets, how long a revealed
value stays visible, whether blur/hidden pages hide it, and how long success
notices stay.

## AI Accounts credential import

When both plugins are active, AI Accounts can browse value-free Secret Catalog
metadata: global entries without a folder, and project/local entries only after
the user chooses a Host folder. The Host omits unknown scopes and ambiguous
alias/environment/scope rows. Import is an explicit action: it rechecks the
source metadata, verifies the target `*_API_KEY` reference is writable and
empty, reveals only on the Host, and writes directly to DSH credentials. No key
value crosses to the Client or enters the account JSON. Manual entry through
DSH's write-only credential controller remains available when Secret Catalog is
not installed.

## Machine and Host boundary

The machine control identifies the current DSH Host using its OS hostname and
is disabled. The secret CLI and installed DSH rc.2 contracts expose no remote
machine inventory or selector, so selecting another machine requires a Host
service that routes a CLI call to a chosen machine. Machine-local aliases can
be listed, edited, removed, and added for the current Host when a project
folder is selected.

## Reusable folder picker

The picker is the separate `@dshfiles/project-folder-picker` workspace
package. Secret Catalog supplies registered workspaces and adapts the DSH 0.2
Host ports: `ctx.remote.directoryPicker.pick(signal)`,
`list(path, signal)`, `createDirectory(path, name)`, and
`ctx.remote.workspace.create({ path })`. Selection keeps workspace identity
and the Host-canonical path explicit.

## Compatibility and composition

The peer ranges target `@deepseek-ai/dsh@0.2.0-rc.2`,
`@deepseek-ai/dsh-api-workspace-controller@0.2.0-rc.2`, and
`@deepseek-ai/dsh-subprocess@0.2.0-rc.2`; actual Host and Client imports use the
installed workspace-controller entry points. Host API registration injects
`connection`, `webServer`, and `subprocess`. The standard web base provides
`dsh-subprocess-local`; this bundle does not insert a second provider. This
package contributes its own sidebar and main slots; profile composition
remains a parent registration step.
