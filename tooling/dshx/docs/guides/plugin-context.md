# Plugin context: registries, contracts, services

**Entry: `@dshfiles/dshx/client`**

Every Client plugin gets one plugin context. It is how a plugin contributes to
the app and to other plugins, follows what other plugins provide, and asks the
user something. Everything registered through it ends with the plugin: disposal,
reload and HMR withdraw it.

Where to get it:

| Where | How |
| --- | --- |
| `defineClientPlugin({ setup(api) })` | `api` is the context (plus `uses` capabilities) |
| `defineClient({ setup(ctx, decorate, metadata) })` | `metadata.plugin` |
| A component registered through dshx | `usePlugin()` |

## Contribute: `add`

```ts
import { Command, Panel, defineClientPlugin } from '@dshfiles/dshx/client'

export default defineClientPlugin({
  id: 'acme',
  setup(api) {
    api.add(Panel, { id: 'acme', title: 'Acme', component: AcmePanel })
    api.add(Command, track => ({
      id: '@acme/plugin.open',
      title: 'Open Acme',
      enabled: track(api.layout.panel) !== 'acme',
      run: () => void api.layout.openPanel('acme'),
    }))
  },
})
```

- Pass a fixed item, or a function of `track`. `track(source)` reads a
  `Subscribable` (a store, `api.use(...)`, `api.list(...)`, `api.layout.panel`, `api.environment.locale`)
  and recomputes the item when it changes. Return `undefined` to withdraw the
  item until the function returns one again.
- `add` returns a function that withdraws the item early.
- A function that throws withdraws only that item and records a failure.

### Typed registries dshx renders natively

| Registry | Native place |
| --- | --- |
| `Panel` | main view + sidebar navigation row |
| `ComposerAction` | composer tool row (`placement: 'left' \| 'right'`) |
| `HeaderAction` | session header actions |
| `SessionRowAccessory` | leading content of each sidebar thread row |
| `Overlay` | frame-wide floating layer (`shell.overlay`) |
| `SettingsSection` | a Settings section, with search `entries` |
| `PluginDetailBadge` | a tag beside a Settings › Plugins detail title |
| `PluginDetailSection` | a section under a Settings › Plugins detail page |

### Registries owned plugins render

| Registry | Owner |
| --- | --- |
| `Command` | `@dshfiles/command-palette` lists it and binds its `keys` |

## Your own registry: `defineRegistry`

```ts
// src/exporters.ts — publish it as a dshx `modules` entry so others import the token only
export const Exporter = defineRegistry<{ readonly id: string; readonly title: string; run(text: string): void }>('@acme/plugin.exporter')

// another plugin
api.add(Exporter, { id: 'gist', title: 'Gist', run: upload })

// the owner
const exporters = api.list(Exporter) // Subscribable; useRegistry(Exporter) in React
```

## Share an API: `defineContract`, `provide`, `use`

```ts
export const AcmeBadge = defineContract<{ count(): number; Badge: ComponentType<{ label: string }> }>('@acme/plugin.badge', { owner: '@acme/plugin' })

// provider
api.provide(AcmeBadge, { count: () => 42, Badge: api.bind(Badge) })

// consumer
const badge = api.use(AcmeBadge)
const live = badge.get() // or useContract(AcmeBadge) in React
if (live.status === 'active') live.value.count()
```

`Live<T>` is one of:

- `pending`: never provided yet (its plugin loads or is absent).
- `active`: `value`, `generation` (a restart comes back with a new one) and `owner`.
- `inactive` with `reason: 'disabled'` (withdrawn) or `'failed'`.

To call a provider that may not have started yet, wait for it instead of reading `get()`:

```ts
const badge = await api.whenActive(AcmeBadge, { timeoutMs: 10_000 })
badge.count()
```

`whenActive(contract, { signal?, timeoutMs? })` resolves at once with an active provider's value, else when one
starts; callers waiting together resolve in the order they asked. It waits through `pending` and `inactive` (a
failed or withdrawn provider may come back), and rejects with the signal's reason, a `TimeoutError` after
`timeoutMs`, or an `AbortError` when the calling scope ends. Nothing waits by default: `use` and `get()` still
report `pending` right away.

One provider at a time; a second one throws. `owner` on the token restricts who
may provide it. `bind(component)` makes `usePlugin()` inside a shared component
return the provider's context, not the consumer's.

## Lifetimes: `keyed`, `signal`, `onDispose`

```ts
api.keyed(api.use(AcmeBadge), (live, scope) => {
  if (live.status !== 'active') return
  scope.add(Command, { id: '@me/plugin.badge', title: 'Badge', run: () => live.value.count() })
})
```

`keyed(source, fn)` runs `fn` in a fresh scope per value; registrations made
through that scope end when the value changes. `api.signal` aborts when the
plugin ends. In React use `useKeyed(key, (key, signal) => …)` and
`useLatest(key, (key, signal) => promise)`, which drops a result for a key that
is no longer current.

## App services

| Service | What |
| --- | --- |
| `api.dialogs` | `confirm`, `alert`, `prompt`, `select` in the app's dialogs (`Dialogs` contract); plain browser dialogs while no provider runs |
| `api.toast.show(input)` | a toast through the `Toasts` contract; logged while no provider runs |
| `api.commands.run(id)` | run a contributed `Command`, else a Host command; false when none can run |
| `api.layout` | `panel` (selected main panel), `openPanel(id)`, `toggleSidebar()` |
| `api.system` | `copy(text)` through the Host clipboard, `save({ name, content, type? })` as a download, `openExternal(url)` for http(s) and mailto URLs in a new tab; each resolves or returns false when the browser cannot |
| `api.notifications` | `notify({ title, body?, tag?, onClick? })` shows an OS notification and returns false without permission or Notification API (it never prompts); `permission()` and `requestPermission()` (call it from a click) report `default`, `granted`, `denied` or `unsupported` |
| `api.environment` | `locale` (`{ id, direction }`) and `appearance` (`{ colorScheme, fonts? }`) as live values to `track` or `useSubscribable`; the page language and the system color scheme while the Host has no locale or theme service |

`@dshfiles/dialogs` provides `Dialogs` and `Toasts` with plugin-ui components.

## Stored state: `defineStore`

```ts
const prefs = defineStore({ key: '@acme/plugin.prefs', scope: 'global', schema: z.object({ enabled: z.boolean() }), initial: { enabled: true } })
prefs.update(current => ({ enabled: !current.enabled }))

const drafts = defineStore({ key: '@acme/plugin.draft', scope: 'session', schema: z.string(), initial: '' })
drafts(sessionId).set('…')
```

- `global` keeps one value; `session` and `project` return a function of the id.
- Every read decodes with `schema` (any synchronous Standard Schema); an invalid
  stored value reads as `initial`.
- `from` imports the value once from earlier keys, newest first.
- Values live in browser storage, are ready before setup and follow other tabs.
- `storage: 'memory'` keeps the value on the page instead: it survives a plugin reload or HMR but not a page
  reload, and other tabs do not see it (an expanded tree, a scroll position).

## Failures

A contribution that throws (a component render, a reactive item, a native
mount, `setup`) renders nothing in its place and is recorded under its owner,
kind and id. Read them with `contributionFailures` or
`useContributionFailures()`.

## Implementation notes

- The broker lives on the page (`globalThis.__dshxBrokerV1`) because every plugin
  bundles its own dshx copy. Tokens hold kind + id only.
- React is touched lazily (the `usePlugin` context, the failure boundary): a
  bundle evaluates before the Host hands it React.
- The bundled `@dshfiles/dshx/client` is a hand-listed virtual module
  (`src/compiler/client/build.ts`); `tests/client-public-exports.spec.ts` fails
  when an entry export is missing from it.
- The native slot ledger drops `metadata`, so settings search entries travel
  through the `__dshxSettingsSearchEntriesV1` seat.
- Contribution failures are browser-only; an agent tool would need a Host relay.
- The command palette publishes `PaletteActions` and `CommandPalette` this way
  (`@dshfiles/command-palette/palette-contract`). Workbench panels and regions
  and the chat-focus mailbox still keep their own page globals: their requests
  wait for a view to mount (a workbench region, one thread's Chat view, with a
  TTL), not for a provider to start, so `whenActive` does not replace them.
