# DSHX platform CLI: BB crosswalk and status

## Goal and research basis

Make DSHX the developer platform for DSH, with one authenticated typed client
used by the CLI and future developer tools. CLI handlers parse arguments and
format results; RPC decoding, validation, and domain behavior belong in that
client. DSHX uses DSH's supported Remote APIs and never reads session stores,
profile files, or Cordis internals directly.

The comparison used installed DSH `0.2.0-rc.2` declarations and implementations,
DSHX `0.1.4-preview.3`, and BB CLI `0.44.0`. `bb guide commands --json` lists
220 command paths in 20 groups. The matrix below compares those product areas;
BB also manages machines, projects, browsers, themes, and servers that DSH does
not own. “BB-quality” here means equally discoverable, composable, scriptable
control for DSH capabilities, not 220 imitation commands.

## Connection and authentication

DSH's Web Connection accepts the current loopback launch URL carrying its
process token on the root request, then issues an authority-bound HttpOnly
cookie. The token is not accepted by API routes or in an Authorization header.
Every API request and WebSocket stream uses that cookie.

DSHX reads `DSHX_URL` or `--url`, validates loopback HTTP, exchanges the token
in memory, and keeps the cookie only in that client instance. It never writes
either value to disk or includes them in errors or JSON. There is no second
credential store.

## Capability matrix

| BB capability                         | DSH equivalent                                           | Native DSH CLI                                                        | Native DSH API                                                                                                                  | DSHX command and difficulty                                              | Status / boundary                                                                                                                                                                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime status and diagnostics        | Local Host and authenticated API readiness               | `dsh --version`; launcher starts a named profile                      | No general health/version endpoint; Session, plugin, bundle, and settings RPCs are usable probes                                | `status`, `info`, `doctor` — medium                                      | Implemented. Doctor checks Node/DSHX/DSH CLI, API connectivity, failed or duplicate plugin entries, bundle errors, and settings. Host version, active profile identity, Client build state, and declared peer compatibility are unknown because DSH exposes no corresponding public Remote. |
| Thread list/show/search               | Sessions and projections                                 | None                                                                  | `session/list`, `session/projections`, `session/search`                                                                         | `sessions list, show, search` — low                                      | Implemented. Search uses DSH's 20-result bounded content search.                                                                                                                                                                                                                            |
| Thread messages/history/export        | Session event history                                    | None                                                                  | `session/follow` provides a cursor; `session/page` reads bounded ordered history                                                | `sessions history, export` — medium                                      | Implemented. Export pages through the API and writes versioned JSON. No storage scraping.                                                                                                                                                                                                   |
| Thread create/fork/cancel/rename      | Session lifecycle                                        | None                                                                  | `session/create`, `fork`, `cancel`, `rename`                                                                                    | `sessions create, fork, cancel, rename` — low                            | Implemented through DSH lifecycle APIs.                                                                                                                                                                                                                                                     |
| Thread prompt/send                    | A text turn admitted to a Session Agent                  | No headless command                                                   | `session/prompt` accepts a request ID, text parts, and queue/steer mode                                                         | `sessions prompt <id> <text...> [--mode queue, steer]` — medium          | Implemented. Ctrl-C requests cancellation before admission. Prompt text is not echoed in output. Attachments remain unsupported by this CLI.                                                                                                                                                |
| Thread archive/restore/delete         | Reversible Workspace archive state                       | None                                                                  | `workspace/archiveSession`, `workspace/unarchiveSession`; no `session/delete`                                                   | `sessions archive, unarchive` — low                                      | Implemented with explicit reversible names. Archive does not stop activity; DSH refuses active Sessions unless the caller opts into stopping it. DSHX does not send that opt-in and does not invent delete.                                                                                 |
| Plugins list/info/enable/disable      | Loader entries and profile plugin selection              | `dsh plugin` is for package management, not general runtime inventory | `pluginManager/listPlugins`, `setPluginEnabled`                                                                                 | `plugins list, info, enable, disable` — low                              | Implemented. Changes report application outcome, warnings, and restart requirements.                                                                                                                                                                                                        |
| Plugin spec check/install/remove      | Package specs and bundle lifecycle                       | `dsh plugin add/remove`                                               | `pluginManager/inspect`, `installBundle`, `cancelInstall`, `removeBundle`                                                       | `plugins check`; `bundles install, remove` — medium                      | Implemented. Install uses DSH's manager and request cancellation; remove targets a named profile-owned bundle. Check performs no installation.                                                                                                                                              |
| Bundles list/info/enable/disable      | Profile bundle selection and patch rows                  | No bundle inventory command                                           | `pluginManager/listBundles`, `setBundleEnabled`                                                                                 | `bundles list, info, enable, disable` — low                              | Implemented. Selection is profile-wide and DSH reports restart impact.                                                                                                                                                                                                                      |
| Agent profiles/presets                | A Session's composed Agent preset                        | No list/show command                                                  | `agentPresets/list`, `agentPresets/read`                                                                                        | `presets list, show` — low                                               | Implemented for declared Agent presets. DSHX does not enumerate filesystem profiles or silently change the default.                                                                                                                                                                         |
| Providers and models                  | Routable model catalog and Session-local selection       | No model command                                                      | `session/modelCatalog`, `session/selectModel`                                                                                   | `models list`; `models select --session ...` — medium                    | Implemented. Catalog includes provider lookup failures. Selection is Session-scoped; DSH may also persist it as the new default model.                                                                                                                                                      |
| Skills                                | User-invocable skills visible to one Session composition | No command                                                            | `skills/list` takes a Session ID and returns metadata, not skill bodies                                                         | `skills list --session <id>` — low                                       | Implemented as a Session-scoped list. No registry install or filesystem skill edits.                                                                                                                                                                                                        |
| Commands list/info/run                | User-invoked Session commands                            | None                                                                  | `commands/list`, `commands/execute`; both require a Session ID                                                                  | `commands list, info, run --session <id>` — medium                       | Implemented. Run accepts slash-prefixed input, does not start a model turn, and maps Ctrl-C to DSH's AbortSignal.                                                                                                                                                                           |
| Tools list/info/run                   | Agent tool registry and policy                           | None                                                                  | No general app-level tool catalog or standalone invocation API. DSH tools run inside an Agent turn and its policy/sandbox.      | Existing `inspect tools`; no `tools run` — medium                        | Standalone tool inventory/invocation is unavailable through the public app API. No Cordis runner RPC is treated as a general tool API.                                                                                                                                                      |
| Services list/info                    | Cordis service composition                               | None                                                                  | No public general service inventory Remote                                                                                      | Existing `inspect services` — medium                                     | The development inspector reads a project runtime composition. It is not a global Host service endpoint.                                                                                                                                                                                    |
| Events and logs                       | Declared lifecycle events and Host logs                  | None                                                                  | No generic Remote event catalogue, log feed, or follow-logs endpoint                                                            | Existing `inspect events`; no `events watch` or `logs --follow` — medium | Deferred: a developer bridge is not equivalent to a supported Host event/log API.                                                                                                                                                                                                           |
| Configuration get/set                 | Namespaced DSH settings                                  | `--dump-config` is read-only composed configuration output            | `settings/describe`, `settings/mutate` with schema validation and optimistic revision                                           | `config list, get, set, unset` — medium                                  | Implemented for API-described settings only. Values are redacted by DSH; DSHX refuses secret-path writes. No direct `cordis.yml`, patch, or arbitrary profile edits.                                                                                                                        |
| User credentials/account              | Provider credentials and DSH account                     | UI-owned                                                              | Credential set/unset and account remotes exist, but carry secret and sign-in semantics                                          | No DSHX command — high                                                   | Deliberately excluded from this control CLI. Use DSH's Settings/account surfaces; never expose credential values in process args or JSON.                                                                                                                                                   |
| Workspace/project/file operations     | Session workspaces and workspace files                   | No project or file command                                            | Workspace controller and `workspaceFiles` remotes exist; path scope and mutation semantics need an explicit DSHX boundary audit | No general file/project command — medium                                 | Deferred until Session/workspace path ownership and write constraints are fully verified. DSHX local project build commands remain separate.                                                                                                                                                |
| Terminals                             | Host-owned Session terminals                             | No terminal command                                                   | Terminal create/list/follow/write/close remotes exist                                                                           | No DSHX terminal command — high                                          | Deferred pending a process-execution security review, Session scope, output bounds, and cancellation semantics. A terminal write is arbitrary command execution.                                                                                                                            |
| Jobs                                  | DSH background jobs and retained output                  | No job command                                                        | `job/list`, `job/follow`, `job/kill` are stream/lifecycle APIs                                                                  | No DSHX job command — medium                                             | Deferred until the shared client has a bounded stream contract and job ownership/kill semantics are represented.                                                                                                                                                                            |
| Goals and schedules                   | Durable Agent goals and scheduled work                   | No matching command                                                   | `goals/*` and `schedule/*` APIs exist                                                                                           | No DSHX goal/schedule command — medium                                   | Deferred until lifecycle, profile scope, and prompt side effects are mapped to explicit CLI operations.                                                                                                                                                                                     |
| Machine/environment/server management | BB's remote machines, environments, server migration     | None                                                                  | DSH's local API does not manage BB machines or environments                                                                     | No equivalent                                                            | Different product boundary; do not invent DSH abstractions for BB features.                                                                                                                                                                                                                 |
| Marketplace/plugin discovery          | DSH bundle registries and package specs                  | `dsh plugin add` uses the configured package manager                  | Plugin inspection and install use DSH's configured registries; no marketplace catalogue Remote                                  | `plugins check`, `bundles install` — medium                              | Package install is supported. Marketplace search/catalog behavior has no corresponding DSH API.                                                                                                                                                                                             |
| Browser, theme, voice, app updates    | BB desktop/browser/preferences features                  | None                                                                  | No corresponding DSH app-level Remote surface                                                                                   | No equivalent                                                            | Outside DSH's product boundary.                                                                                                                                                                                                                                                             |
| Machine-readable interface            | JSON for scripts and agents                              | Native output varies by command                                       | Typed Remote responses and structured errors                                                                                    | `--json`, `--quiet`, `--no-color` — low                                  | Platform commands use envelope version 1 and stable exit codes. Query output includes sessions, history, plugins, bundles, presets, models, skills, commands, and settings.                                                                                                                 |
| Help/discoverability                  | BB guide and group help                                  | `dsh --help` covers native DSH CLI                                    | Remote contracts are not a discoverability interface                                                                            | `dshx --help` and group/action help — low                                | Implemented for DSHX authoring and platform commands. No one-to-one BB aliases are added.                                                                                                                                                                                                   |

## BB group inventory

This records every top-level group returned by `bb guide commands --json` and
why its DSHX coverage differs:

| BB group                         | DSHX mapping                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `status`, `diagnostics`, `guide` | Status/doctor and DSHX help are implemented; BB invocation-error history has no DSH equivalent.                               |
| `thread`                         | Mapped to the Session lifecycle and history commands above. DSH has no permanent Session delete.                              |
| `plugin`, `marketplace`          | Plugin/bundle control and configured-registry installation are mapped; marketplace catalog/search is absent.                  |
| `provider`                       | DSH model catalog and Session selection are mapped.                                                                           |
| `settings`                       | Scoped DSH settings are mapped; BB's global UI preferences and secret/account operations are not.                             |
| `skill`                          | Session-composition skill metadata is mapped; registry discovery and skill installation are absent.                           |
| `terminal`                       | DSH API exists; CLI exposure waits for process-execution security and streaming bounds.                                       |
| `project`, `environment`, `file` | DSH has Session workspaces/files but no BB-style project, branch, or environment lifecycle. File APIs await scope audit.      |
| `manager`                        | DSH Sessions and Agent presets cover some agent creation/discovery; there is no matching multi-agent Manager lifecycle.       |
| `machine`, `server`, `updates`   | BB machine/server/app updater operations have no DSH app-level equivalent. DSH plugin changes do report restart requirements. |
| `browser`, `theme`, `voice`      | No matching DSH API surface.                                                                                                  |

## JSON and exit-code contract

Successful platform output uses:

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
`0` success, `1` Host/API or inspection failure, `2` usage error, `4` target not
found, `5` a plugin/bundle change DSH did not apply, and `130` interrupted
command or cancelled Session prompt/bundle installation. `--quiet` suppresses
human-readable success only; JSON and errors remain visible.

## Implementation status

The implementation scope for this plan is complete: every reviewed DSH
application capability with a safe public contract is exposed. Matrix rows
marked deferred or unavailable require a separate API/security boundary review
or new Host support; they are recorded limits, not hidden implementation tasks.

1. The authenticated loopback client is exported as `@dshfiles/dshx/platform`.
   RPC results are decoded at the client boundary and no launch token or cookie
   is persisted.
2. Runtime diagnosis, Session list/show/search/history/export/create/fork/cancel/
   rename/prompt/archive/restore, and Session-scoped command list/info/run use
   the Remote APIs shown above.
3. Plugin and bundle list/info/check/install/remove/enable/disable use the DSH
   plugin manager and report the Host's observed application result.
4. Agent presets, routable models, Session model selection, Session-scoped
   skill metadata, and redacted settings are available through the same typed
   client and JSON envelope.
5. CLI commands call typed client capabilities; no new handler calls Cordis
   internals or DSH persistence directly.
6. API tests use synthetic Host responses. No real Session prompt, archive,
   restore, bundle installation/removal, or profile mutation is used as test
   data. Live authenticated-host proof must be reported separately from these
   tests.

## DSH contract references

- `@deepseek-ai/dsh-client-connection@0.2.0-rc.2`: launch URL exchange,
  authority/origin checks, and authenticated API access.
- `@deepseek-ai/dsh-api-gateway@0.2.0-rc.2`: unary Remote dispatch and
  `/api/remote.mux` stream contract.
- `@deepseek-ai/dsh-api-session-controller@0.2.0-rc.2`: Session list/search,
  create/fork/cancel/rename/prompt/model selection, history, and skills.
- `@deepseek-ai/dsh-api-workspace-controller@0.2.0-rc.2`: archive/restore,
  workspace lifecycle, and pin/order operations.
- `@deepseek-ai/dsh-plugin-manager@0.2.0-rc.2` and
  `@deepseek-ai/dsh-host-plugin-inventory@0.2.0-rc.2`: plugin/bundle inventory,
  installation, cancellation, removal, enablement, and restart outcomes.
- `@deepseek-ai/dsh-agent-preset-registry@0.2.0-rc.2`: preset roster/read.
- `@deepseek-ai/dsh-api-settings-controller@0.2.0-rc.2` and
  `@deepseek-ai/dsh-settings@0.2.0-rc.2`: redacted settings, schema validation,
  and optimistic revisions.
- BB CLI `0.44.0`: `bb guide commands --json` (220 paths), plus the `thread`,
  `plugin`, `settings`, and `provider` command groups.
