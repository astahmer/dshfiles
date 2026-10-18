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

Successful Host rebuilds restart the Host automatically by default. Set `dev.hostRestart: 'manual'` to require an explicit restart instead. Set `dev.hostHmr: { hostContractVersion: 'v1' }` to replace the Host inside the running DSH instead of restarting it; DSH stays up, and a Loader-contract change is refused with a restart instruction. Interactive input maps `r` to one explicit Host restart under either policy and `q`/Ctrl-C to bounded shutdown. Client rebuilds use official DSH HMR. Config/dependency reloads keep the last-good session until replacement watchers resolve and build successfully.

`--port 0` asks DSH to allocate an available Web port. Use a concrete port when browser state or an external test must keep the same address across automatic Host restarts. If omitted, DSHX follows the configured/default DSH Web port.

### Scratch DSH for verification: `dshx dev up|doctor|open|shot|down`

```bash
dshx dev up [--plugin @dshfiles/<name>]... [--project <dir>] [--port <n>] [--skip-build] [--json]
dshx dev doctor [--json]
dshx dev open <feature> [--timeout <ms>] [--json]
dshx dev shot [--label <label>] [--out <dir>] [--json]
dshx dev down [--dry-run] [--json]
```

These drive a disposable DSH from this checkout (they need the dshfiles repository and Node from `.node-version`). `up` builds the owned bundles under test, installs a scratch profile in a temp `DSH_HOME`, seeds a jj project with a `main` bookmark (or registers `--project`) in the scratch workspace storage, starts `dsh` on a free port and a headless Chromium, and records pids and paths in `$TMPDIR/dshx-dev/<name>/state.json` (mode 600; it is the only place the tokenized launch URL is written). `open` walks a feature's `reach` steps from its `dshx.features.json` catalog in that browser; `shot` saves a screenshot and a grouped console/network error summary; `down` stops the recorded process groups only while their command lines still match, deletes the scratch home and state, and keeps the evidence directory. `--name` runs several side by side; every action has `--help`, and failures print a `fix` (`error.hint` with `--json`).

## `dshx inspect`

```bash
dshx inspect slots [--root <slot>] [--explain] [--json]
dshx inspect tools [--json]
dshx inspect services [--json]
dshx inspect events [--json]
dshx inspect capabilities [--json]
```

Inspect is read-only and runtime-only. It queries only adapter-supported official providers in the active Composition. An unsupported or unavailable provider returns a diagnostic rather than an offline/fabricated catalog.

`inspect capabilities` is the offline exception: it prints the verified protocol-2 service owners, typed SDK requirements, provider packages, native slot contracts, and known unavailable seams from the same catalog used by injection, checks, repair, templates, and slot occupancy diagnostics. JSON output uses `schemaVersion: 1`. A dynamic `uses` expression receives a warning because its dependencies cannot be proven statically.

`inspect slots --explain --root <slot>` prints the installed native declaration's mode, scope, registration identity and options, owner props, known shipped IDs, and replacement child obligations. `inspect slots --root <slot>` queries active metadata; only runtime inspection can prove current occupants and children. Both JSON reports are versioned and retain declaration metadata.

## `dshx add`

```bash
dshx add ui --slot <slot> [--provider <package>] [--id <id>] [--order <n>]
dshx add tool --name <name> [--description <text>]
dshx add command --name <name> [--description <text>]
dshx add hook --event <event>
```

All add commands accept `--file`, `--dry-run`, and `--json`. They generate source transactionally and roll back on validation failure. They do not install packages, change Profiles, or start DSH. There are no `add settings`, `add prompt`, or `add conversation` commands.

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
edit profile files, or call Cordis internals directly. `sessions list` also reads
archive state from a registered DSHX archive-status API when available; its
human-readable `ARCHIVED` column says `unknown` when that API is unavailable,
and JSON rows omit `archived` in that case.

```bash
dshx status [--url <launch-url>] [--json]
dshx info [--json]
dshx doctor [--url <launch-url>] [--json]

dshx sessions list
dshx sessions search <query...> [--limit <count>]
dshx sessions show <session-id>
dshx sessions history <session-id> [--max <count>]
dshx sessions create [--cwd <path>] [--agent-preset <id>]
dshx sessions fork <session-id> [--at-seq <sequence>]
dshx sessions cancel <session-id>
dshx sessions rename <session-id> <title...>
dshx sessions archive <session-id>
dshx sessions unarchive <session-id>
dshx sessions prompt <session-id> <message...> [--mode queue|steer]
dshx sessions export <session-id> [--output <path>] [--since-seq <seq>] [--tail <count>] [--types <type,...>]
dshx sessions digest <session-id> [--limit <actions>]
dshx sessions tail <session-id> [--since-seq <seq>] [--tail <count>] [--types <type,...>] [--follow]

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
counts, and describes the live instance behind the launch URL: its pid, port and
profile, its launch time, the checkout revision it was launched on, whether that
checkout moved since, how many plugin bundles were rebuilt after launch, and
which owned bundles have sources newer than their `dist/`. Those facts come from
the process table and, when a checkout is present, from the jj operation log at
the launch time (`--ignore-working-copy`, so inspecting never snapshots the
checkout); they are reported even when the Host does not answer. `--json` adds
`instance` (with every stale bundle, and the reason for each) and
`pluginActivation` (total, active, enabled but inactive).
`info` reports local DSHX and Node versions without connecting. `doctor`
also checks local DSH, failed/duplicate plugin entries, bundle errors, settings
availability, and RPC connectivity. DSH does not expose the selected profile,
Host version, Client build state, or declared plugin compatibility through the
inspected Remote APIs; `status` and `doctor` read the profile from the process
command line and label the rest unknown.

`sessions show` preserves Session metadata and projection hints returned by DSH.
Search prefers the composed finder from `@dshfiles/memory` when the installed
Host serves it: titles, Session ids, cwd/workspace paths, message text, digests
and notes in one ranked page with per-hit provenance (`[session-title+session-content:
title-match, text-match]`), plus `--limit` (1–20) and a cursor line when more
results exist. Without that plugin it falls back to DSH's bounded content search
and returns at most 20 snippets.

Both paths stay honest about an unavailable index. DSH's SQLite backend raises
`SESSION_QUERY_PERSISTENCE_FAILED` while the corpus is still moving, so the
fallback retries the transient failure and then prints a labeled
title/metadata page instead of "No matching Sessions"; when that page is empty
the command exits non-zero with `session-search-unavailable` and a retry hint.
The finder path reports the same code, and its degraded pages say which source
failed and after how many attempts.

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

### Supervising a Session

Use `sessions digest` to answer "what is this agent doing, is it stuck, and what
did it change?" in one call. It reads the Session's events and its summary
projections and prints about 50 lines:

- state: running or idle, time since the last event, model, turns, steps, tool
  calls, compactions, token totals, and context use (DSH reports no prices);
- `Attention`: a tool call pending for over two minutes, a running Session
  with no events for ten minutes, a failed last turn (usage limits included),
  three or more trailing tool failures, an identical tool call repeated three
  times in the last twelve, three or more turns without a tool call (a goal
  loop), and an idle Session that left todos open;
- the working directory, plus the directories its shell calls really ran in
  (`workdir` arguments and leading `cd`), which often differ from the Session
  cwd;
- the goal, the latest todo list, and the latest reasoning headlines (reasoning
  bodies are usually encrypted; the headlines are not);
- the last user prompt, the last message from another agent, and the last
  assistant text;
- the last actions as one line each (`--limit`, default 15), with `ok`, `ERR`,
  or `...` for a call still running;
- the files edited, grouped by directory with edit counts; the `jj` commands
  that describe, commit, create, squash, push, or move revisions with their
  message title; and edits made since the last describe;
- tool errors and failed commands with their error line, and LLM retry counts.

`--json` returns the same digest under `data`: `sessionId`, `title`, `running`,
`cwd`, `model`, `lastSeq`, `lastEventAt`, `idleMs`, `eventCount`, `turns`,
`steps`, `compactions`, `lastTurnEnd`, `attention[]`, `goal`, `todos[]`,
`intents[]`, `lastUserPrompt`, `lastAgentMessage`, `lastAssistantText`,
`actions[]` (`seq`, `time`, `tool`, `summary`, `status`, `error`),
`toolCallCount`, `workDirectories[]`, `filesChanged[]`, `revisions[]`,
`undescribedEdits`, `failures`, `tokens`, and `subagents[]`. Absent facts are
omitted rather than null.

`sessions tail` prints one line per event: sequence, local time, type, and a
summary (`bash: pnpm test`, `↳ bash ERR exit 1 2.1s: Error: …`, `thinks: …`,
`2/5 done; now: …`). It shows the newest 40 events unless `--since-seq` or
`--tail` says otherwise. Without `--types` it hides per-step bookkeeping
(`step/*`, `request/*`, system prompts, inbox splices, prune markers) and the
runtime context DSH injects as user messages. `--follow` polls every two seconds
and prints new events until Ctrl-C; with `--json` it prints one JSON object per
line. A tool result names its tool when the call is in the same window.

Filters on `sessions export` and `sessions tail`: `--since-seq N` keeps events after
sequence N, `--types` keeps exact types or every type under a prefix (`tool`
matches `tool/call` and `tool/result`), and `--tail N` keeps the newest N
matching events. Paging walks backwards from the newest event and stops once
the filter is satisfied, so a tail of a large Session does not read its whole
history.

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

### `dshx comm`

Communication uses the DSHX Host's authenticated local socket and one typed
service shared with the Agent plugin and MCP adapter. It does not read DSH
session storage or open a network listener.

```bash
dshx comm agents [--json]
dshx comm topics [--json]
dshx comm report [--limit <count>] [--json]
dshx comm subscribe <topic> [--delivery quiet|queue] [--principal <name>]
dshx comm unsubscribe <topic> [--principal <name>]
dshx comm publish <topic> <message...> [--priority normal|urgent]
dshx comm send <agent-session-id> <message...> [--priority normal|urgent]
dshx comm inbox [--topic <topic>] [--limit <count>] [--principal <name>] [--json]
dshx comm ack <message-id> [--principal <name>]
dshx comm mcp [--principal <name>]
```

The CLI's default external inbox identity is `cli`; MCP defaults to
`mcp.default`. Named principals separate external clients and persist their
subscriptions. External clients may subscribe with `quiet` or `queue` delivery.
DSH Agents automatically join a hashed topic for their working directory and
their direct inbox. Queue delivery adds a content-free notice and does not
interrupt a running turn. `comm report` returns bounded message and activity
metadata only; it never includes message bodies and never changes state. Agent
tool history begins when the first tool-call event is recorded, so absence of
older events does not prove non-use. Steering is available only through DSH
Agent tools when the recipient has opted in, allowlisted the sender, and the
message is urgent. See [Agent communication](./agent-communication.md) for the service,
security boundary, candidate decision, and profile activation.

Standalone tool invocation, general service enumeration, profile enumeration,
arbitrary profile/config-file edits, generic event watching, and log following
are not exposed: the inspected DSH APIs have no safe matching boundary. The
existing `dshx inspect tools|services|events` remains the project development
introspection surface. DSH exposes workspace-file, terminal, job, goal,
schedule, and credential remotes; DSHX defers them until path scope, process
execution, stream bounds, lifecycle side effects, or secret handling have an
explicit safe contract.

## `dshx create`

```bash
dshx create <name> \
  [--template starter|showcase] \
  [--style css-modules|tailwind|none] \
  [--cwd <path>] \
  [--install|--no-install] \
  [--yes] \
  [--package-manager pnpm|yarn|npm]
```

`--yes` defaults to `starter + css-modules`. Interactive mode asks for template and style independently, follows the invoking package manager, and shows animated progress while dependencies install. The initializer refuses an existing target directory and writes the selected provider edges plus runtime packages required by the compiled Host. See [Creator](./guides/creator.md).

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
dshx add panel --id usage      # component + stylesheet + registration test, wired into src/client.tsx
dshx add api   --id usage      # contract + Host handler + Client usage example, wired into src/host.ts
dshx add tool  --name report   # a tool with the fields it needs to be offered
```

`add ui` covers one slot. These cover the rest, as one transaction: a panel is a
sidebar row **and** a main view, and emitting only the row leaves a button that
goes nowhere; an API is a contract **and** the handler, and emitting only one
leaves the other uncalled. Both presets write their new files only after the
target entry is proven wireable, then patch the existing entry with the
registration — `api.panels.register` into the `defineClientPlugin` setup (adding
the `panels` capability and the type-only layout import), or the handler symbol
into `definePlugin`'s `apis` list. The API contract lives in its own
`src/api/<id>.ts`, so a second `add api` never collides with the first. A refusal
— missing entry, source that does not parse, an id that already exists, or a
shape the parser cannot safely extend — leaves zero writes and names the stage
that stopped it. Each preset also emits a mount/unmount test (panel) or a
Host-channel test (API) that exercises the contribution instead of snapshotting
it, and `--dry-run` previews the full diff without touching anything.

Presets refuse to overwrite an existing file, and `--dry-run` reports the paths.
