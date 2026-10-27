# dshx: opencode-style plugin context

Port the best ideas of opencode v2's GUI plugin SDK into `@dshfiles/dshx/client`,
additively: every existing API (`defineClient`, `defineSlot`, `defineClientPlugin`,
`uses`) keeps working.

Resume here: core runtime (C1) first; A/B/C run in parallel workspaces.

| # | Item | Owner | Status |
|---|------|-------|--------|
| C1 | Browser broker: `defineContract`, `defineRegistry`, `Live<T>`, `bindPlugin` (item 2) | main thread | todo |
| C2 | `api.add/list/provide/use`, reactive items via `track`, `api.signal` (items 1, 5) | main thread | todo |
| C3 | Typed registries: `Command`, `Panel`, `ComposerAction`, `SettingsPage`, `HeaderAction`, `Toast` slots (item 1) | main thread | todo |
| C4 | Per-contribution failure isolation + `dshx.contributions` status (item 9) | main thread | todo |
| C5 | `api.dialogs` / `api.toast` / `api.layout` / `api.commands.run` (item 3) | main thread | todo |
| C6 | `defineStore` global/session/project, `from` migration (item 4) | main thread | todo |
| C7 | React hooks: `useContract`, `useRegistry`, `useKeyed`, `useLatest`, `usePlugin` (item 5) | main thread | todo |
| C8 | Owners: command-palette lists `Command`; palette global → dshx registry | main thread | todo |
| A | `defineLocale`: English fallback, optional locales, `plural` (item 6) | subagent | todo |
| B | `dshx add <pkg>`: Cordis row + inject + options (item 8) | subagent | todo |
| C | Settings search entries with deep-link `target` (item 7) | subagent | todo |

## Design

- One versioned window broker (`window.__dshxBroker_v1`) keyed by token id. Tokens hold
  kind + id only, so other plugins import them without runtime code.
- A provider/registrant is tied to the Cordis `ctx` scope: disposing the plugin withdraws it.
- `Live<T>`: `pending` (never provided), `active` (`value`, `generation`),
  `inactive` (`disabled` after withdrawal, `failed` when the provider threw).
- Item functions take `track(source)`; a tracked `Subscribable` change recomputes the item.
- dshx owns registries that map to native slots (Panel, ComposerAction, SettingsPage,
  HeaderAction, Toast). Owned plugins own the rest (command-palette owns `Command`).
- Dialogs: dshx contract with a `window.confirm/prompt` fallback while no provider is active.
