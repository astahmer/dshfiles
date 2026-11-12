# OpenCode v2 plugin compatibility

An opt-in Host-only adapter for OpenCode v2 Promise server plugins. It loads configured plugins, reports their status and records calls to unsupported APIs. It is not included in `profiles/web`.

## Security

A configured plugin executes arbitrary code inside the DSH Host with the Host user's permissions. Only load code you trust. The agent can inspect status with `opencode_plugins_status` but has no tool to add, enable or change a plugin: allowing that would let the model load arbitrary Host code. Configure the Loader row and settings yourself.

## Settings

Namespace: `dshfiles-opencode-compat`.

| Setting         | Default  | Effect                                                                                                                                                                    |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins`       | `[]`     | Entries `{ specifier, options, enabled }`; the specifier is an absolute file or directory path, and options is JSON **object text**. Package names are not yet supported. |
| `onUnsupported` | `report` | `report` records calls and returns a no-op registration for registration APIs, or rejects other calls; `fail` throws from the call so uncaught use fails setup.           |

Settings changes dispose loaded plugins and reload the list. Source edits alone do not reload; toggle a setting. Invalid options, duplicate IDs, import and setup errors appear in status with recovery guidance.

## Module contract

A module's default export, or named `server` or `plugin` export, is `{ id: string, setup(ctx) }`. Setup may return an async or synchronous cleanup function. Files and directories with `package.json` exports/main or `index.js` are accepted. Plugin dependencies must resolve from the plugin's own installation; this adapter does not import or vendor OpenCode.

## Supported

| OpenCode contract                                                                                 | DSH mapping                                                       | Status                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Plugin.define({ id, setup })`, setup cleanup                                                     | Host lifecycle; cleanup on unload or settings change              | Implemented; registrations tracked by adapter, Cordis child scopes planned                                                                                                                                                                                                                                                                                                   |
| `Registration.dispose()`                                                                          | Idempotent adapter registration                                   | Implemented for adapter registrations                                                                                                                                                                                                                                                                                                                                        |
| `ctx.options`                                                                                     | Frozen parsed JSON object                                         | Implemented                                                                                                                                                                                                                                                                                                                                                                  |
| `ctx.app`                                                                                         | `{ name: 'dsh', version: 'unknown', channel: 'opencode-compat' }` | Implemented                                                                                                                                                                                                                                                                                                                                                                  |
| `ctx.tool.transform`, editor, `reload`, `list`, `hook('execute.before')`, `hook('execute.after')` | `ctx.tools.register`, `tools/pre-execute`, `tools/post-execute`   | Implemented. Input schemas: Effect `Schema` or object JSON Schema; others fail that tool and are listed. `execute.before` throwing denies the call; changing `input` or `tool` denies it (DSH freezes arguments, Host gap 112). `execute.after` may replace `result.content`; other edits are listed and ignored. `codemode`, `pinned`, `permission` are ignored and listed. |
| `ctx.skill.transform`, editor and `reload`                                                        | DSH skill registry                                                | Planned (slice C)                                                                                                                                                                                                                                                                                                                                                            |
| `ctx.session.hook('context')`                                                                     | System prompt assembly                                            | Planned (slice C)                                                                                                                                                                                                                                                                                                                                                            |
| `ctx.storage.get/set/remove/scan`                                                                 | Plugin-owned JSON storage                                         | Planned (slice C)                                                                                                                                                                                                                                                                                                                                                            |
| `ctx.event.subscribe`                                                                             | No mapping yet                                                    | Unsupported; phase 2 candidate                                                                                                                                                                                                                                                                                                                                               |

## Unsupported

All other documented context domains and members are unsupported. Calls are recorded by plugin ID and API path with first-seen time and count; **property reads alone are not recorded**. Under `report`, registration-style calls return an idempotent no-op registration; other calls reject with `OpenCodeUnsupportedError`. Under `fail`, unsupported calls throw. Status includes load state, errors, contribution lists and recorded calls.

| Contract                                                                                             | Status                                         |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `provider`, `model`, `aisdk`, `credential`                                                           | Unsupported: DSH owns model routing.           |
| `mcp`                                                                                                | Unsupported; possible future bridge.           |
| `command`, `agent`, `reference`, `integration`, `websearch`, `vcs`, `worktree`, `rpc`, `plugin.list` | Unsupported.                                   |
| Session verbs and hooks other than planned `context`                                                 | Unsupported.                                   |
| `permission`, `shell`, `location`, `experimental`, `generate`                                        | Unsupported.                                   |
| TUI/GUI entrypoints and Effect plugin API                                                            | Unsupported: only Promise server plugins load. |
| Source-change hot reload                                                                             | Unsupported; change settings to reload.        |

## Verify

From the repository root:

```sh
pnpm --dir plugins/@dshfiles/opencode-compat build
pnpm --dir plugins/@dshfiles/opencode-compat test
pnpm --dir plugins/@dshfiles/opencode-compat typecheck
pnpm --dir plugins run contract
pnpm --dir tooling/dshx run features:check
```

Host changes require the user's decision to restart the running DSH instance; these checks do not restart it.
