# What we still lack from opencode v2

Compared against opencode's v2 plugin docs (`/v2/docs/build/plugins/*`) and source
(`anomalyco/opencode`, `packages/plugin`, 2026-10-27). Already landed: the dshx plugin
context (`tooling/dshx/docs/guides/plugin-context.md`): registries, contracts with
`Live<T>`, dialogs/toasts, stores, `keyed`, English-fallback locales, settings search
entries, `dshx add`, failure isolation, and the command palette on dshx contracts.

Resume here: pick the next item.

## A. Browser plugin context

| #   | Gap                                                                                                                                                                                                       | Today                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A1  | Composer API: read/write/insert prompt text, attach file/note/quote chips, set model and variant, `focused()`                                                                                             | Private to the `rich-composer` fork                                         |
| A2  | Session screen API: current/mounted session, workspace files (state, tree, search), line comments attached to the next prompt                                                                             | None                                                                        |
| A3  | Panel/tab model: tab groups, pinned/closable/preview tabs, reopen closed (⌘⇧T), mobile views, `layout.open/toggle/hide/state` per session side region                                                     | `Panel` = main view + sidebar row; `main-tabs` owns tabs privately          |
| A4  | Registries: `MenuItem` (side panel "+" launcher, server menus), `TitlebarItem`, `ComposerPill` (pill above composer with a row menu), `LinkHandler` (custom link schemes in messages/chips), `FileViewer` | Only `ComposerAction`, `HeaderAction`, `Overlay`, …                         |
| A5  | App contracts: `Files` (tree, "Open in"), `Changes` (review a session's changes), `Browser` (embedded pane)                                                                                               | None                                                                        |
| A6  | Host-provided UI components on the context: Icon, Button, Menu, Tooltip, Dialog, Switch, TextInput, Keybind, Markdown, Code                                                                               | plugin-ui kit; no shared Markdown/Code renderer                             |
| A7  | Notifications: OS-level notify                                                                                                                                                                            | thread-sidebar has its own                                                  |
| A8  | Tabs API: list/open/focus/move/close shell tabs                                                                                                                                                           | `main-tabs`, no contract                                                    |
| A9  | Commands: user-rebindable keys listed in Settings › Shortcuts, effective keybind display, `/` menu, `scope` selector, `editable`, `suggested`/`featured`, Shortcuts section                               | `Command` has default `keys` only                                           |
| A10 | System helpers: copy, save file, open external URL; desktop launch/reveal/pick                                                                                                                            | Done: `api.system.copy`, `save`, `openExternal` (web only; desktop launch/reveal/pick wait for a desktop Host) |
| A11 | Environment accessors: locale + text direction, appearance (font, light/dark), router path, workspace-removed events                                                                                      | Done: `api.environment.locale` (`id`, `direction`) and `appearance` (`colorScheme`, `fonts`). No router path (the Host has no router; thread-sidebar owns the URL through `replaceState`) and no workspace-removed event (the Host emits none) |
| A12 | Store scopes: per server or directory, in-memory store surviving plugin reload, Host-backed stores shared across browsers                                                                                 | localStorage, global/session/project                                        |
| A13 | Plugin metadata: options passed to the browser half, `os` restriction, GUI-only on/off switch, automatic id prefixing (`<plugin>.<cmd>`, `plugin.<id>.<key>`)                                             | Convention only                                                             |
| A14 | Requests that wait for their receiver: calls made before a contract's provider is active queue and run once it starts                                                                                     | Done: `api.whenActive(contract, { signal, timeoutMs })`. Workbench open-requests and chat-focus keep page globals: they wait for a view to mount, not a provider |
| A15 | Settings placement: a section inside a host page, or rows in General                                                                                                                                      | Own section only                                                            |
| A16 | Desktop main process: typed Ipc, native menu bar items, embedded web views                                                                                                                                | Not applicable while web-first                                              |

## B. Host side

| #   | Gap                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B17 | Hooks that rewrite behaviour: prompt admission (text, files, queue/steer), per-request model hooks by kind (agent, compaction, title…: system, messages, tools, provider options), raw HTTP/WebSocket, retry policy, permission checks, shell, tool before/after. Check which DSH already exposes. |
| B18 | Tool list editing: update/remove/namespace other plugins' tools, code mode (dshx only adds tools)                                                                                                                                                                                                  |
| B19 | Registering agents, providers, models, commands, skills, MCP servers, references, integrations, credentials from a plugin                                                                                                                                                                          |
| B20 | VCS provider + worktree strategy interface, so jj-integration plugs in as a provider                                                                                                                                                                                                               |
| B21 | Typed session API: create, prompt, generate, command, synthetic message, compact, interrupt, wait, switch agent/model, keyed instruction entries                                                                                                                                                   |
| B22 | `generate`: one-off model call with structured questions                                                                                                                                                                                                                                           |
| B23 | Plugin key-value storage with prefix scan and pagination through dshx                                                                                                                                                                                                                              |
| B24 | Done: `event({ schema })` on a contract, `publishApiEvent` on the Host, `useApiEvent`/`subscribeApiEvent` in the browser over one authenticated SSE route (`tooling/dshx/docs/guides/api.md#host-events`); background-jobs' board migrated with a polling fallback |

## C. Platform and tooling

| #   | Gap                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C25 | Effect-native API: plugin, RPC and client return Effects/Streams; plugin lifetime is an Effect Scope                                                                                     |
| C26 | SDKs: JS client for the HTTP API, embeddable in-process host, Cloudflare Durable Object runtime                                                                                          |
| C27 | One package with server/TUI/GUI/RPC parts installed from one config line (versions, local paths, options); `plugin update/remove`; npm publishing. `dshx add` covers only install        |
| C28 | Done: `DSHX1209` fails a Client bundle that keeps a platform, injected or shared-runtime package ([build guide](../tooling/dshx/docs/guides/build.md#modules-the-page-already-provides)) |
| C29 | TUI plugin surface (no terminal UI in DSH)                                                                                                                                               |

## D. Core product features (not plugin API)

| #   | Gap                                                                      |
| --- | ------------------------------------------------------------------------ |
| D30 | Undo/redo snapshots rolling back conversation and files together         |
| D31 | Session warming to keep provider prompt caches alive between prompts     |
| D32 | Policies: binary denies layered on permissions                           |
| D33 | References: named outside directories or git repos attached to a session |
