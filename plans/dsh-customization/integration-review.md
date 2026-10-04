# Integration review

The product brief in [README.md](README.md) and its fourteen original screenshots
in [screenshots/](screenshots/) are the acceptance scope. This review records the
integrated implementation, verification, composition steps, and the runtime
limits that remain.

## Delivered packages and implementation choices

| Capability | Package | Choice |
|---|---|---|
| Thread organization, settle/archive, header links, sidebar/footer customization | [thread-sidebar](../../plugins/@dshfiles/thread-sidebar/README.md) | Build with local dshx; the audited candidates did not cover this behavior on the installed rc.2 runtime. |
| MCP manager, composer quick panel and searchable catalog | [mcp-servers](../../plugins/@dshfiles/mcp-servers/README.md) | Build with local dshx; inspected marketplace candidates used weaker loopback routes, bypassed ConfigEditor, or had incompatible peers. |
| Shared project/folder selection | [project-folder-picker](../../plugins/@dshfiles/project-folder-picker/README.md) | Build as a reusable local package; adjacent marketplace project managers did not provide the component/API needed here. |
| Secret CLI catalog | [secret-catalog](../../plugins/@dshfiles/secret-catalog/README.md) | Build with local dshx; no listing found manages aliases from the `secret` CLI. [`dsh-vault`](https://dshmarket.com/p/Ox0400/dsh-vault/) is a separate encrypted vault with its own storage and peer set ([source](https://github.com/Ox0400/dsh-vault)). |
| Settings search | [settings-search](../../plugins/@dshfiles/settings-search/README.md) | Build with local dshx; the candidate depended on a removed runtime package and DOM selectors. |
| Jujutsu graph and Source Control | [jujutsu](../../plugins/@dshfiles/jujutsu/README.md) | Build with local dshx; the inspected changes-tab candidate was read-only and built for an older runtime. |

The implementations use DSH 0.2.0-rc.2 contracts rather than carrying over BB
plugin architecture. The local dshx fork now supports authenticated exact Fetch
routes and a validated Host `Config` beside API contributions. MCP uses those
additions for its profile configuration and Connection-backed management API.
The MCP patch inserts only its own bundle row; the standard web base already
provides `dsh-subprocess-local`, so it must not be inserted a second time.

The sidebar package disables the native `ui-sidebar` row before taking over its
slots. It groups threads as pinned, active, parked, inactive, or archived;
provides project scope and sort controls; and exposes configurable auto-settle
with exclusions for active, pinned, parked, blank, excluded, or already
archived sessions. Header links and footer actions have independent order and
visibility controls, with hidden footer actions retained in More. The installed
slot contracts support this shell without a Host change.

The MCP manager covers local stdio and remote Streamable HTTP, CRUD,
enable/disable, reconnect/refresh, curated provider references, Registry search,
the sidebar page, and the native composer `+` action. The picker is a separate
package used by the Secret Catalog. Secret values remain absent from list
snapshots; reveal and copy are explicit actions. Settings Search indexes
`ConfigForms.describe()` metadata and edits the live Host-backed form value at
the selected schema path. Jujutsu mutations use argv-based subprocess calls,
state-bound one-use previews, and confirmation before changes.

## Verification

All plugin checks below used official Node 22.23.3 and pnpm 12.0.0.

- Strict TypeScript checks passed for all six packages, including the shared
  picker.
- Focused tests passed: thread-sidebar 9, MCP 19, project-folder-picker 3,
  Secret Catalog 21, settings-search 7, and Jujutsu 12 (71 total).
- Security review replaced Secret Catalog's direct `child_process.spawn` with
  DSH's managed subprocess service. The runner forwards only optional
  `BW_SESSION` and `SECRET_SESSION_FILE`, bounds output, discards stderr, and
  terminates the managed process range on timeout. Three focused runner tests
  cover argv/stdin, environment filtering, output bounds, and failure cleanup.
- dshx production builds passed for all five bundle packages. The shared picker
  is a source dependency and has no separate bundle output.
- dshx API tests passed 16/16. Host build tests passed 13, with two watcher
  tests excluded because they time out in this environment. The dshx production
  build passed. The broader test TypeScript check still has an unrelated stale
  `@deepseek-ai/dsh-client-runtime/client` import in
  `tests/conversation-assembly.spec.ts` and its derived implicit-any error.
- A temporary profile composed from `@deepseek-ai/dsh-base`,
  `@deepseek-ai/dsh-web-app`, and all five custom bundles dumped successfully.
  Its composed tree contained one subprocess provider, disabled the native
  sidebar row, and registered the five requested bundle rows.
- The combined profile booted on an OS-assigned loopback port. DSH reported no
  plugin activation failures. The authenticated token-to-cookie page exchange
  returned HTTP 200; all 10 same-origin page assets returned success and
  contained the five custom Client package identities. The server was stopped
  and its temporary home, including the private launch URL, was removed.

The runner has no Chromium or Playwright executable/package, so this acceptance
did not include browser-driven clicking through each page or control. Component
logic and contracts are covered by the focused tests, and the combined host and
client bundles were served successfully, but that is not a substitute for a
visual/manual interaction pass.

## Known DSH contract limits

- The sidebar Host has no park/unpark projection. Parked thread IDs are stored
  in browser storage. There is no dedicated last-activity timestamp, so settle
  age uses `SessionSummary.updatedAt`, which metadata edits can refresh. Archive
  is requested with `stopActivity: false`.
- MCP configuration persists in the active profile, not in one DSH-wide catalog
  shared by profiles. Native MCP has no remote health signal, so the UI reports
  lifecycle and registered tools without claiming a health probe. OAuth and
  credential creation/editing are unsupported; entries use existing credential
  references. The native composer ActionSpec consumes selected text before
  opening the quick panel; a collapsed caret preserves the draft. Registry
  search is by name and offers only safe HTTPS Streamable HTTP endpoints.
- The Secret Catalog targets the current Host because DSH exposes no remote
  machine inventory or CLI routing. If the same alias/environment exists in
  multiple scopes, ambiguous value/mutation actions are disabled because the
  CLI cannot target one merged row by scope identity. Alias removal follows the
  CLI's behavior across environments.

  Secret Catalog's `secret` child receives only the explicitly needed
  Bitwarden session inputs from the Host environment. Values are sent over
  stdin or captured only for list/reveal responses; stderr and mutation output
  are discarded. The fixed executable is resolved by DSH and runs without a
  shell. Tests use synthetic session strings and never invoke the real CLI.
- DSH has no API to route settings search to a native category and focus one
  native row. A selected result opens the owning live ConfigForm value in the
  search section and writes that exact path with revision checking.
- Jujutsu has no native repository picker or opened-directory subprocess
  capability; registered repository IDs and root validation constrain the
  remaining path-to-process race. A push marker proves a recorded `jj git push`
  invocation, not remote acceptance. Fetch cannot preview exact incoming
  changes before JJ performs the fetch.

Secret Catalog validation used synthetic CLI fixtures; no real aliases or
secret values were read. No active DSH profile was changed. No credentials or
secrets were copied into the isolated profile.

## Local profile composition

The five DSH bundles are `@dshfiles/thread-sidebar`,
`@dshfiles/mcp-servers`, `@dshfiles/secret-catalog`,
`@dshfiles/settings-search`, and `@dshfiles/jujutsu`. Add each package to
the profile's `dependencies` using a `link:<repo-path>/plugins/@dshfiles/<name>`
specifier, add the corresponding bundle IDs
(`thread-sidebar`, `mcp-servers`, `secret-catalog`,
`settings-search`, and `dshfiles-jujutsu`) to
`dsh.profile.bundles`, then run `pnpm install` in that profile. Build the five
bundles with `pnpm run build` in their package directories before starting
DSH. The shared picker is linked as a dependency of Secret Catalog and does not
get its own bundle row. The standard web base already supplies the MCP
subprocess provider.

This uses the local-path workflow documented in the repository instructions;
do not use `plugin_manager install_bundle`/ `pnpm add <path>` for these local
bundles. The active profile is intentionally not composed by this work.

## Workstream history

| BB thread | Account | Delivered scope |
|---|---|---|
| @thread:thr_yy48qc83x2 | EM, GPT-6 Luna, max | Thread sidebar and navigation/footer customization |
| @thread:thr_ripab4dkyi | CA, GPT-6 Luna, max | MCP manager, catalog, composer action |
| @thread:thr_efh8qvw6mw | EM, GPT-6 Luna, max | Shared picker, Secret Catalog, settings search |
| @thread:thr_m2fbcp82dz | CA, GPT-6 Luna, max | Jujutsu graph and Source Control |
