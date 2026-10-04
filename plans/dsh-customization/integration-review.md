# Integration review

The product brief in [README.md](README.md) and its fourteen original screenshots
in [screenshots/](screenshots/) are the acceptance scope. This review records the
integrated implementation, verification, composition steps, and the runtime
limits that remain.

## Delivered packages and implementation choices

| Capability | Package | Choice | Installed |
|---|---|---|---|
| Thread organization, settle/archive, header links, sidebar/footer customization | [thread-sidebar](../../plugins/@dshfiles/thread-sidebar/README.md) | Build with local dshx; the audited candidates did not cover this behavior on the installed rc.2 runtime. | probe |
| MCP manager, composer quick panel and searchable catalog | [mcp-servers](../../plugins/@dshfiles/mcp-servers/README.md) | Build with local dshx; inspected marketplace candidates used weaker loopback routes, bypassed ConfigEditor, or had incompatible peers. | probe |
| Shared project/folder selection | [project-folder-picker](../../plugins/@dshfiles/project-folder-picker/README.md) | Build as a reusable local package; adjacent marketplace project managers did not provide the component/API needed here. | via secret-catalog |
| Secret CLI catalog | [secret-catalog](../../plugins/@dshfiles/secret-catalog/README.md) | Build with local dshx; no listing found manages aliases from the `secret` CLI. [`dsh-vault`](https://dshmarket.com/p/Ox0400/dsh-vault/) is a separate encrypted vault with its own storage and peer set ([source](https://github.com/Ox0400/dsh-vault)). | probe |
| Settings search | [settings-search](../../plugins/@dshfiles/settings-search/README.md) | Build with local dshx; the candidate depended on a removed runtime package and DOM selectors. | probe |
| Jujutsu graph and Source Control | [jujutsu](../../plugins/@dshfiles/jujutsu/README.md) | Build with local dshx; the inspected changes-tab candidate was read-only and built for an older runtime. | probe |

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

The sidebar now adds right-click actions to copy a thread ID or same-Host link.
Links use root/index query parameters because DSH's static frontend returns
404 for unknown pathname routes. Opening a copied link waits for the Host
session catalog, then selects the addressed thread. Child rows show their
direct parent and computed depth from the durable `parentId` chain. The DSH
standard web preset already includes parallel continuable subagents, parent
control tools, recursive descendant listing, and the native subagent catalog.
Its `subagent.maxDepth` setting defaults to 1 but remains configurable; no
plugin data shape assumes a depth-one tree. The native `@` reference source
already lists recent sessions by metadata and can search IDs, titles, labels,
and workspace paths.

The MCP manager covers local stdio and remote Streamable HTTP, CRUD,
enable/disable, reconnect/refresh, curated provider references, Registry search,
the sidebar page, and the native composer `+` action. The picker is a separate
package used by the Secret Catalog. Secret values remain absent from list
snapshots; reveal cycles through a masked preview, full value, and hidden, while
copy remains an explicit action. Settings Search indexes
`ConfigForms.describe()` metadata, ignores accents, searches finite option
labels and values, and edits the live Host-backed form at the selected schema
path. Finite choice fields use a typed select. Jujutsu mutations use argv-based
subprocess calls, state-bound one-use previews, and confirmation before
changes.

## Verification

All plugin checks below used official Node 22.23.3 and pnpm 12.0.0.

- Strict TypeScript checks passed for all six packages, including the shared
  picker.
- Focused tests passed: thread-sidebar 13, MCP 19, project-folder-picker 3,
  Secret Catalog 23, settings-search 9, and Jujutsu 12 (79 total). The new
  thread-sidebar checks cover recursive parent depth, inherited workspace
  identity, route parsing, and removal of launch/query data from copied links.
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
- The added thread menu, lineage, and query-route slice passes its focused
  TypeScript check, 13 focused tests, and six-artifact dshx build. Full DSH
  runtime/browser acceptance remains pending the separate dshx activation fix.
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
- The static frontend has no pathname routing contract, so this implementation
  uses query-based links on the root/index URL. A clean
  `/projects/:project/threads/:thread` path needs an explicit Host route and
  client route API. Links resolve only on the DSH Host that owns the session.
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

`pnpm profile:sync --profile <name>` links every owned bundle into a profile
and installs it; `docs/profile-installs.md` explains why `pnpm add <path>` and
`plugin_manager install_bundle` cannot. `dsh.profile.bundles` lists package
names (`@dshfiles/thread-sidebar`), not the Loader row ids the bundles insert
(`thread-sidebar`), which is what an earlier version of this section
said. The shared picker is a dependency of Secret Catalog, not a bundle.

The Installed column above records where each bundle runs as of 2026-10-04:
`probe` boots all ten owned bundles with no activation failure
(`pnpm profile:boot --profile probe`). `web` runs ai-accounts, queue-reorder and
shortcuts; the rest wait on reconciling the nixfiles `web` asset.

## Workstream history

| BB thread | Account | Delivered scope |
|---|---|---|
| @thread:thr_yy48qc83x2 | EM, GPT-6 Luna, max | Thread sidebar and navigation/footer customization |
| @thread:thr_ripab4dkyi | CA, GPT-6 Luna, max | MCP manager, catalog, composer action |
| @thread:thr_efh8qvw6mw | EM, GPT-6 Luna, max | Shared picker, Secret Catalog, settings search |
| @thread:thr_m2fbcp82dz | CA, GPT-6 Luna, max | Jujutsu graph and Source Control |
