# DSHX platform CLI plan

## Product goal

Make DSHX a developer platform for DSH, with a reusable typed client beneath
the CLI. CLI handlers parse input and present results; DSH API calls, wire
validation, and domain behavior live in the platform client. The CLI must use
DSH's authenticated local API and must not read session stores or edit profile
files behind DSH's back.

This plan is grounded in the installed DSH `0.2.0-rc.2` package contracts and
BB CLI `0.44.0`. BB terminology is mapped to DSH terminology; command parity is
not a goal.

## Connection and authentication

DSH's web Connection accepts an application launch URL carrying its process
token on the root/index request. The Host exchanges it for an authority-bound,
HttpOnly, SameSite cookie. Every `/api` RPC and WebSocket stream then requires
that cookie. The token is not accepted on API routes or in an Authorization
header. The Host trust fence also checks the request authority and any browser
origin markers.

DSHX will accept the current local launch URL through `DSHX_URL` (and an
explicit `--url` override). It will exchange the token in memory, keep the
cookie only in the client instance, and restrict the first implementation to
loopback HTTP. It will redact the launch URL and cookie from errors and JSON,
and never persist either value. A headless caller therefore uses the same DSH
authentication flow as the served client without a second credential store.

## Capability matrix

| BB capability | DSH equivalent | Native DSH CLI | Native DSH API | DSHX command and difficulty |
| --- | --- | --- | --- | --- |
| Runtime status | Running local Host and API readiness | `dsh --version`; launcher boots named profiles | No general version/health endpoint. API Gateway and session/plugin APIs provide connectivity probes. | `dshx status`, `dshx info`, `dshx doctor` — medium. Report local DSH CLI version separately from facts the Host API confirms. |
| Threads list/show | Sessions and session projections | None | `session/list`; projections are included as hints and can be read through `session/projections` | `dshx sessions list`, `show <id>` — low. |
| Thread messages/log | Session history | None | `session/follow` supplies the exact opening cursor; `session/page` reads bounded, ordered history | `dshx sessions history <id>` — medium; use follow cursor plus page API. No storage scraping. |
| Thread create/fork/cancel | Session lifecycle | None | `session/create`, `session/fork`, `session/cancel` | `dshx sessions create`, `fork`, `cancel` — low. |
| Thread delete | No Session deletion operation | None | No `session/delete`. Workspace API can archive a Session, which is reversible and is not deletion. | Do not add `sessions delete`; consider a clearly named archive command separately. |
| Thread export | Session history records | None | `session/follow` plus paged `session/page`; no native export endpoint | `dshx sessions export <id>` — medium. Write a versioned DSHX JSON export from API records. |
| Plugins list/info | Loader entries and profile plugin manager | `dsh plugin --profile <name>` manages packages; no general runtime query command | `pluginInventory/list`, `pluginManager/listPlugins`, `pluginManager/listBundles` | `dshx plugins list`, `info <id>` — low. Preserve Host entry IDs and load phase. |
| Plugins enable/disable | Persistent plugin-entry selection | `dsh plugin` does not expose this as a runtime command | `pluginManager/setPluginEnabled` | `dshx plugins enable/disable <id>` — low. Show `application`, warnings, and restart impact from `ChangeResult`. |
| Bundles list/info/enable/disable | Profile bundle selection and patch rows | `dsh plugin` manages installation; no dedicated bundle runtime CLI | `pluginManager/listBundles`, `setBundleEnabled` | `dshx bundles list`, `info`, `enable`, `disable` — low. Keep bundle/profile ownership in DSH. |
| Tools list/info/run | Model tool registry and per-session tool policy | None | No general tool list or standalone invocation endpoint. `dsh-tools` runs tools through an Agent turn and its policy/sandbox boundary. | Keep `dshx inspect tools` for the existing live development inspector. Do not add standalone `tools run`. |
| Commands list/info/run | User-invoked Session commands | None | `commands/list` and `commands/execute`; both are scoped to a Session ID. Execute runs a registered handler without sending the command to the model. | `dshx commands list/info/run --session <id>` — medium. Preserve slash syntax and pass caller cancellation. |
| Services list/info | Cordis services in a plugin composition | None | No general application Remote inventory endpoint | Keep `dshx inspect services` on the existing DSHX runtime inspection bridge. No raw Cordis access from new handlers. |
| Events list/watch and logs | Declared Cordis events and runtime logs | None | Existing DSHX inspector can list events. Gateway streams are for declared Remote endpoints/events, not a generic log feed. | Keep `dshx inspect events`; defer `events watch` and `logs --follow`. |
| Configuration get/set | DSH settings namespaces for profile plugin entries | `--dump-config` reads composed configuration; profile startup can prepare state | `settings/describe` returns schema, redacted values, write availability, and revision; `settings/mutate` validates path edits with optimistic revision | `dshx config list/get/set/unset` for one settings namespace — medium. Do not claim to edit `cordis.yml`, patches, or arbitrary profile config. Never use credential-value endpoints. |
| Profiles list/show | Named profile directories and shipped templates | Launcher accepts `--profile`; no profile list/show subcommand | No profile enumeration/details Remote endpoint | Defer. Do not enumerate directories or scrape profile files. |
| Machine output | Structured DSH state for scripts and agents | Native launcher output is command-specific | API results are typed; transport failures and Remote errors are distinct | New platform commands support `--json`, `--quiet`, and `--no-color`, stable envelopes, and stable exit codes. |

### Runtime diagnosis boundaries

`doctor` can verify the local DSHX process version and Node version, exchange
the DSH launch URL, call session/plugin APIs, inspect bundle errors, identify
failed Loader entries, and report restart-required changes. DSH does not expose
its runtime version, selected profile identity, browser Client build state, or
a generic dependency/configuration diagnostic endpoint through the inspected
Remote contracts. The CLI must label those facts as unavailable rather than
guess from files or from the locally installed `dsh` executable.

## Implementation order

1. Add loopback launch-token exchange and a shared typed DSH platform client.
2. Add machine-readable runtime status/doctor, sessions list/show/history,
   plugins list/info, and scoped settings reads.
3. Add supported lifecycle changes: session create/fork/cancel; plugin/bundle
   enable/disable; schema-validated settings set/unset with expected revision.
4. Add session-scoped commands and complete history export.
5. Update help and CLI docs; retain existing build/check/dev/inspect/add JSON
   payloads while documenting the versioned platform-command JSON contract.
6. Validate the package with focused typecheck, tests, build, and help/output
   checks. Do not use user profile mutations for validation.

## DSH contract references

- `@deepseek-ai/dsh-client-connection@0.2.0-rc.2`: `BrowserAuth`, request
  trust, `/api` RPC, and cookie requirements.
- `@deepseek-ai/dsh-api-gateway@0.2.0-rc.2`: unary Remote dispatch and
  `/api/remote.mux` stream contract.
- `@deepseek-ai/dsh-api-session-controller@0.2.0-rc.2`: session list,
  create, fork, cancel, follow, and page contracts.
- `@deepseek-ai/dsh-plugin-manager@0.2.0-rc.2` and
  `@deepseek-ai/dsh-host-plugin-inventory@0.2.0-rc.2`: plugin/bundle
  inventory, enablement, failures, and application/restart outcomes.
- `@deepseek-ai/dsh-commands@0.2.0-rc.2`: Session-scoped command list and
  execution semantics.
- `@deepseek-ai/dsh-api-settings-controller@0.2.0-rc.2` and
  `@deepseek-ai/dsh-settings@0.2.0-rc.2`: redacted namespace views, schema
  validation, and optimistic revisions.
- `bb guide json`, `bb guide commands thread`, and
  `bb guide commands plugin`: BB JSON, thread, and plugin CLI capabilities.
