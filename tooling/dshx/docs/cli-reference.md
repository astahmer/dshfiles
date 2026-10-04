# CLI reference

## `dshx check`

Plain `check` is offline. It validates:

- `dshx.config.ts` and enabled face entries;
- package exports, types/bin paths, DSH manifest fields, provider edges, and protocol range;
- `0.1.1` migration patterns in TypeScript source;
- TypeScript with `noEmit`;
- installed/development DSH compatibility when package metadata is locally available.

It does not require a Profile, Composition, bridge, browser, or running DSH process.

```bash
dshx check
dshx check --json
dshx check --fix --dry-run
dshx check --fix
```

`--fix` applies only deterministic manifest repairs, re-resolves the project, and rolls back when post-write validation fails. It does not rewrite migration diagnostics, source, dependencies, or Profile state.

Use runtime mode explicitly:

```bash
dshx check --runtime
dshx check --runtime --json
```

Runtime mode additionally requires a supported DSH installation, the configured Profile link, Composition/runtime readiness, optional runtime plugin state, and Inspect bridge state. JSON output always separates `static`, `typecheck`, and `runtime` status; offline output reports runtime as `skipped`.

## `dshx build`

```bash
dshx build [--cwd <project>] [--verbose]
```

Build runs the offline manifest, migration, compatibility, and TypeScript checks before compiling. It builds enabled Host and Client faces through the bounded Vite kernel, emits declarations by default, and verifies the artifact shape. Its only writes are build outputs.

## `dshx dev`

```bash
dshx dev [--cwd <project>] [--port <0-65535>] [--open] [--verbose]
```

Dev uses Vite build-watch with `command: 'build'` in development mode, links the package through the official DSH Profile CLI when needed, and launches DSH only after required initial builds succeed. It is not a Vite dev server.

Successful Host rebuilds restart the Host automatically by default. Set `dev.hostRestart: 'manual'` to require an explicit restart instead. Interactive input maps `r` to one explicit Host restart under either policy and `q`/Ctrl-C to bounded shutdown. Client rebuilds use official DSH HMR. Config/dependency reloads keep the last-good session until replacement watchers resolve and build successfully.

`--port 0` asks DSH to allocate an available Web port. Use a concrete port when browser state or an external test must keep the same address across automatic Host restarts. If omitted, DSHX follows the configured/default DSH Web port.

## `dshx inspect`

```bash
dshx inspect slots [--root <slot>] [--json]
dshx inspect tools [--json]
dshx inspect services [--json]
dshx inspect events [--json]
```

Inspect is read-only and runtime-only. It queries only adapter-supported official providers in the active Composition. An unsupported or unavailable provider returns a diagnostic rather than an offline/fabricated catalog.

## `dshx add`

```bash
dshx add ui --slot <slot> [--provider <package>] [--id <id>] [--order <n>]
dshx add tool --name <name> [--description <text>]
dshx add command --name <name> [--description <text>]
dshx add hook --event <event>
```

All add commands accept `--file`, `--dry-run`, and `--json`. They generate source transactionally and roll back on validation failure. They do not install packages, change Profiles, or start DSH. There are no `add api`, `add settings`, `add prompt`, or `add conversation` commands.

## Shared options

| Option                | Commands                                   | Effect                                                             |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `--cwd <path>`        | project commands; sessions create          | Resolve another project or create a Session in a working directory |
| `--verbose`           | all                                        | Include underlying provider/process causes                         |
| `--json`              | check, inspect, add, DSH platform commands | Stable machine-readable output                                     |
| `--quiet`             | all                                        | Suppress human success output; preserve JSON and errors            |
| `--no-color`          | all                                        | Disable terminal styling                                           |
| `--url <launch-url>`  | DSH platform commands                      | Override `DSHX_URL` for this invocation                            |
| `--runtime`           | check                                      | Enable Profile/Composition/runtime validation                      |
| `--fix`               | check                                      | Apply deterministic manifest repairs                               |
| `--dry-run`           | check --fix, add                           | Produce a plan/diff without writing                                |
| `--open`              | dev                                        | Open the development URL                                           |
| `--port <0-65535>`    | dev                                        | Select the DSH Web port; `0` allocates one                         |
| `--help`, `--version` | all                                        | Print CLI metadata                                                 |

## DSH platform control plane

These commands use DSH's authenticated local Remote APIs through the reusable
typed client in `packages/dshx/src/platform/`. They do not read session storage,
edit profile files, or call Cordis internals directly.

```bash
dshx status [--url <launch-url>] [--json]
dshx info [--json]
dshx doctor [--url <launch-url>] [--json]

dshx sessions list
dshx sessions search <query...>
dshx sessions show <session-id>
dshx sessions history <session-id> [--max <count>]
dshx sessions create [--cwd <path>] [--agent-preset <id>]
dshx sessions fork <session-id> [--at-seq <sequence>]
dshx sessions cancel <session-id>
dshx sessions rename <session-id> <title...>
dshx sessions archive <session-id>
dshx sessions unarchive <session-id>
dshx sessions prompt <session-id> <message...> [--mode queue|steer]
dshx sessions export <session-id> [--output <path>]

dshx plugins list
dshx plugins info <entry-id>
dshx plugins check <package-spec>
dshx plugins enable <entry-id>
dshx plugins disable <entry-id>
dshx bundles list
dshx bundles info <name>
dshx bundles install <package-spec>
dshx bundles remove <name>
dshx bundles enable <name>
dshx bundles disable <name>
dshx presets list
dshx presets show <id>
dshx models list
dshx models select --session <session-id> <provider> <model> [--reasoning-effort <id>]
dshx skills list --session <session-id>

dshx commands list --session <session-id>
dshx commands info <name> --session <session-id>
dshx commands run '/command args' --session <session-id>
dshx commands run --line '/command args' --session <session-id>

dshx config list
dshx config get <namespace> [path]
dshx config set <namespace> <path> <json-value>
dshx config unset <namespace> <path>
```

Add `--json` to get the versioned platform result envelope:

```json
{
  "schemaVersion": 1,
  "command": "plugins list",
  "ok": true,
  "data": { "items": [] }
}
```

Errors use `{ "schemaVersion": 1, "command": "...", "ok": false,
"error": { "code": "...", "message": "..." } }`. Exit codes are stable:
`0` success, `1` Host/API or operation failure, `2` usage error, `4` target not
found, `5` a plugin/bundle change that DSH did not apply, and `130` an
interrupted command or cancelled Session prompt/bundle installation. `--quiet`
only suppresses human-readable success output; JSON and errors remain visible.
Platform commands also accept `--no-color`.

Set `DSHX_URL` to the current tokenized loopback launch URL printed by `dsh`, or
pass `--url`. DSHX exchanges it for a Host cookie in memory and only permits
loopback HTTP in this first client. The token is not sent to API endpoints,
written to disk, or included in output.

`status` checks Host connectivity and reports API-visible Session/plugin/bundle
counts. `info` reports local DSHX and Node versions without connecting. `doctor`
also checks local DSH, failed/duplicate plugin entries, bundle errors, settings
availability, and RPC connectivity. DSH does not expose the selected profile,
Host version, Client build state, or declared plugin compatibility through the
inspected Remote APIs; `doctor` labels those facts unknown.

`sessions show` preserves Session metadata and projection hints returned by DSH.
Search uses DSH's bounded content search and returns at most 20 snippets.
History reads a cursor-bounded page through `session/follow` and `session/page`;
export walks all pages in event order. Rename uses DSH's durable Session API.
Archive and unarchive call the reversible Workspace API. Archive does not stop
active work; DSH refuses an active Session unless asked to stop it, and DSHX
does not opt into stopping.

Plugin and bundle changes use the Host's mutation APIs and report whether the
change applied immediately, requires restart, failed, or was overridden. Their
selection is profile-wide. Settings operations only target a namespace from
`settings/describe`; writes are schema-validated by DSH and include the current
revision. Secret values are redacted by DSH, and `config set` refuses secret
paths because command arguments are visible to local process inspection and
shell history. Change secrets in DSH Settings.

`commands list/info/run` require a Session because the native API is
Session-scoped. Info includes the command's optional input hint and attachment
support. Run accepts only slash-prefixed lines and invokes a registered handler
without a model turn; Ctrl-C aborts the command request through DSH's native
`AbortSignal` support and exits 130. `sessions cancel` separately cancels
active Agent work. The CLI currently sends no command attachments. Session
export reads the bounded paging API and writes a versioned JSON file when
`--output` is supplied.

`sessions prompt` sends text to DSH and does not echo it in output. It defaults
to queue mode; `--mode steer` asks DSH to steer the active turn. Ctrl-C asks
DSH to cancel prompt admission. `plugins check` asks the plugin manager what a
package spec names without installing it. `bundles install/remove` use DSH's
package manager; Ctrl-C sends its cancellation request, and a cancelled install
restores the profile manifest and lockfile. `models list` shows currently
routable models and provider lookup failures. `models select` selects a model
for a Session; DSH may also persist it as the new default. `presets list/show`
reads Agent preset declarations. `skills list --session` returns only the
user-invocable skill metadata visible to that Session, never skill bodies.

Standalone tool invocation, general service enumeration, profile enumeration,
arbitrary profile/config-file edits, generic event watching, and log following
are not exposed: the inspected DSH APIs have no safe matching boundary. The
existing `dshx inspect tools|services|events` remains the project development
introspection surface. DSH exposes workspace-file, terminal, job, goal,
schedule, and credential remotes; DSHX defers them until path scope, process
execution, stream bounds, lifecycle side effects, or secret handling have an
explicit safe contract. See [the full BB-to-DSH crosswalk](./platform-cli-plan.md).

Focused validation passed with Node 22.23.3 and pnpm 12.5.1: the DSHX package
build and typecheck, 17 focused Vitest tests, targeted ESLint, and Prettier
checks for the changed source and docs. Tests use synthetic Host responses. No
live authenticated DSH call or user-profile mutation was used for validation.

## `create-dshx`

```bash
pnpm create dshx@preview <name> \
  [--template starter|showcase] \
  [--style css-modules|tailwind|none] \
  [--cwd <path>] \
  [--install|--no-install] \
  [--yes] \
  [--package-manager pnpm|yarn|npm]
```

`--yes` defaults to `starter + css-modules`. Interactive mode asks for template and style independently, follows the invoking package manager, and shows animated progress while dependencies install. The initializer refuses an existing target directory and writes the selected provider edges plus runtime packages required by the compiled Host. See [Creator](./guides/creator.md).

## `dshx-hub`

The Hub CLI is a stateless, JSON-first client for Agent-operated catalog maintenance. The Agent chooses what to inspect and how to combine operations; the Hub owns validation, field precedence, revisions, concurrency, visibility, and audit records. Credentials stay in the operating-system keyring, and `--all` pagination state exists only for the lifetime of the current process.

| Command                    | Purpose                                                               | Hub write |
| -------------------------- | --------------------------------------------------------------------- | --------- |
| `auth login/status/logout` | Manage the local Hub credential                                       | Auth only |
| `status`                   | Read reachability, authentication, plugin counts, and submission load | No        |
| `source discover`          | Search public GitHub/npm metadata with time windows and cursors       | No        |
| `source inspect`           | Normalize public GitHub/npm facts into `PluginObservationV1`          | No        |
| `plugin list/get`          | Query summary or complete operational plugin views                    | No        |
| `plugin upsert`            | Merge one or more source observations                                 | Yes       |
| `plugin curate`            | Change only curated names, copy, categories, tags, and derivation     | Yes       |
| `plugin hide/restore`      | Change public visibility with an audited reason                       | Yes       |
| `submission list/get`      | Read user submissions                                                 | No        |
| `submission resolve`       | Mark a submission accepted, duplicate, or ignored                     | Yes       |
| `report latest`            | Read the previous immutable daily operations report                   | No        |
| `report publish`           | Publish one bilingual completed or partial run report                 | Yes       |
| `media upload`             | Store validated plugin media and metadata                             | Yes       |
| `audit`                    | Read catalog, storage, or community consistency findings              | No        |

`source inspect` accepts `github:owner/repository`, `npm:package-name`, GitHub repository URLs, and npm package URLs. It may discover several workspace packages, but its scan is bounded and reports truncation. Each observation preserves the exact public README collection result, its content hash and source location, plus public GitHub publisher identity and avatar facts when available. It never installs a package, executes package scripts, launches DSH, or tests third-party behavior.

The inspect result can be saved or piped into an upsert:

```bash
dshx-hub source inspect https://github.com/foo/bar --output /tmp/plugin.json
dshx-hub plugin upsert --input /tmp/plugin.json

dshx-hub source inspect npm:foo \
  | dshx-hub plugin upsert --input -
```

All output uses one envelope. Success contains `ok: true`, `data`, `warnings`, and `meta.requestId`; failure contains `ok: false`, one error with stable `code`, `retryable`, optional `repairHint`, details, and the request ID. Exit code `0` includes warnings and unchanged writes, `1` is a command-level failure, and `2` means a batch had partial failure.

For a guarded content edit, read the current revision and send it back with the mutation:

```bash
dshx-hub plugin get PLUGIN_ID
dshx-hub plugin curate PLUGIN_ID --if-revision 5 --input content.json
```

On `revision_conflict`, fetch the current plugin, merge the intended content, and retry with the new revision. For batch results, keep successful items and inspect each rejected item's error independently.

`status`, filtered `plugin list`, and scoped `audit` are planning inputs; they do not prescribe another command. Examples are compositions, not a required state machine. Use `dshx-hub <command> --help` for the exact flags and read/write contract, and see [Framework Hub Operations](../apps/framework-hub/OPERATIONS.md) for the server API and merge rules.

### `dshx inspect slots --explain`

Explains a Client slot from the static reference, without a project or a running
Host. A slot's declaration lives in the package that owns it, so a plugin cannot
see the slot in its own typed union until it imports that owner — invisible from
the plugin side, because it reads as "the slot does not exist".

```bash
dshx inspect slots --explain                          # every known Client slot
dshx inspect slots --explain --root sidebar.panellist  # one slot in detail
dshx inspect slots --explain --json                   # machine-readable
```

Each entry reports the declaring package, the type-only imports that make the
slot typecheck, the owner props the occupant receives, and — where it matters —
the shipped id whose reuse replaces the existing occupant instead of adding a
second copy of a surface the Host already owns.

`dshx add ui --slot <name>` reads the same table and writes those imports, so the
generated entry compiles as written.

### `dshx add panel` / `dshx add api`

Scaffold the two contributions that follow a slot in every real plugin.

```bash
dshx add panel --id usage      # panel component, its stylesheet, the client entry shape
dshx add api   --id usage      # zod contract plus the Host handler that serves it
dshx add tool  --name report   # a tool with the fields it needs to be offered
```

`add ui` covers one slot. These cover the rest: a panel is a sidebar row **and** a
main view, and emitting only the row leaves a button that goes nowhere; an API is a
contract **and** the handler, and emitting only one leaves the other uncalled. The
generated panel includes the type-only imports that make `sidebar.panellist` and
`main` typecheck, and the generated tool declares `output.schema` and
`output.render`, without which a registered tool is never offered to the model with a
usable shape.

Presets refuse to overwrite an existing file, and `--dry-run` reports the paths.
