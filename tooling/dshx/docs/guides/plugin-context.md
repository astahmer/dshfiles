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

## Definition options

`defineClient` and `defineClientPlugin` take two opt-in fields; leaving them out changes nothing.

- `os: ['macos', 'windows']` registers nothing in a browser on another OS (User-Agent Client Hints, else
  `navigator.platform`). It restricts the browser half only.
- `prefixIds: true` prefixes registry item ids with the package id: `api.add(Command, { id: 'open', … })` becomes
  `@acme/plugin.open`. An id that already starts with `@` is kept, so a plugin can switch it on without renaming.

The browser half gets no row options: the browser Loader creates each Client entry as `{ name }`
(`@deepseek-ai/dsh-client-modules`), so a row's `config` never reaches it; pass options through `defineSettings` and
`useSettings`. A GUI on/off switch already exists: the Plugins page toggles each bundle and component.

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
| `ComposerPill` | a pill above each session's composer (`conversation.input.dock`) with an optional row menu |
| `HeaderAction` | session header actions |
| `SessionRowAccessory` | leading content of each sidebar thread row |
| `Overlay` | frame-wide floating layer (`shell.overlay`) |
| `SettingsSection` | a Settings section with search `entries`; `placement: 'plugins'` makes it a tab inside Settings › Plugins, `'general'` a row in General |
| `PluginDetailBadge` | a tag beside a Settings › Plugins detail title |
| `PluginDetailSection` | a section under a Settings › Plugins detail page |

`ComposerPill.usePill({ sessionId })` runs as a React hook in each composer and returns `{ label, icon?, menu? }`
or undefined to hide the pill there; a click opens `menu` rows (`{ id, title, disabled?, danger?, run }`) in the
Host menu above the pill:

```ts
api.add(ComposerPill, {
  id: '@acme/plugin.pending',
  usePill: ({ sessionId }) => {
    const pending = usePending(sessionId)
    return pending ? { label: 'Waiting for upload', menu: [{ id: 'cancel', title: 'Cancel', run: pending.cancel }] } : undefined
  },
})
```

### Registries owned plugins render

| Registry | Owner |
| --- | --- |
| `Command` | `@dshfiles/command-palette` lists it; `@dshfiles/shortcuts` binds its keys and lists `editable` ones in Keyboard shortcuts; `@dshfiles/input-trigger` adds its `slash` entry |
| `MenuItem` | `@dshfiles/workbench` lists rows with `menu: 'workbench.new-view'` as Actions in its New tab chooser; a row runs and the chooser closes |
| `FileViewer` | `@dshfiles/editor` offers a matching viewer as a toggle beside Save and renders it over the text with `{ sessionId, path, text }` (unsaved edits included); the editor's own Markdown preview is one |
| `LinkHandler` | Markdown renderers: the chat fork's assistant messages and plugin-ui `Markdown` open `[label](scheme:target)` and `<scheme:target>` links through it |

### Custom link schemes: `LinkHandler`

```ts
api.add(LinkHandler, { id: '@acme/plugin.ticket', scheme: 'ticket', open: link => openTicket(link.target) })
api.system.openLink('ticket:42') // true: the handler ran
```

- The first handler added for a scheme wins; `http`, `https`, `mailto`, `file`, `javascript`, `data`, `vbscript`,
  `blob` and `about` cannot be claimed.
- The Host `MarkdownText` keeps only http(s) and mailto hrefs, so a renderer passes its source through
  `MarkdownLinks.rewrite(text, schemes)` (claimed links become `https://dshx-link.invalid/<scheme>/<target>`) and
  puts `MarkdownLinks.openFromClick` on its root's `onClickCapture` and `onAuxClickCapture`, so plain, modified and
  middle clicks all reach the handler instead of the placeholder URL. Code spans and fenced blocks stay as written.
- A scheme without a handler renders as it always did: its text, not a link.

### Commands

A `Command` takes optional fields past `id`, `title`, `keys` and `run`; leaving them out keeps today's behaviour.

```ts
api.add(Command, {
  id: '@acme/plugin.open',
  title: 'Open Acme',
  keys: ['Mod+Shift+A'],
  editable: true, // listed in Keyboard shortcuts (Mod+/), where the user can rebind it
  scope: 'page', // its keys stay off while a text field has focus
  slash: 'acme', // `/acme` in the composer runs it
  suggested: true, // shown in the palette before anything is typed
  run: openAcme,
})
api.commands.keys.get().get('@acme/plugin.open') // ['Mod+Shift+A'], or the user's binding
```

An editable command's Host row carries no default binding: the Host refuses overlapping defaults in whichever plugin
registers second, so a default could stop a core plugin's setup. Until the user binds one, its own `keys` apply and the
row reads "No shortcut". Settings › General › Keyboard shortcuts (or Mod+/) lists it. Its id must map to a Host shortcut id (`CommandChords.shortcutId`); the capture-phase listener
binds only Mod (+ Shift) chords. `CommandChords` converts `Mod+Shift+K` to and from Host bindings.

### Contracts owned plugins provide

Import the token from the owner's dshx module (the owner as a workspace dependency) and follow it with `api.use` or
`useContract`; it is `pending` while the owner is absent.

| Contract | Module | What |
| --- | --- | --- |
| `CommandPalette` | `@dshfiles/command-palette/palette-contract` | `open(mode)`, `close()`, `setRecentLimit(n)`, live `state` |
| `MainTabs` | `@dshfiles/main-tabs/tabs-contract` | live `tabs` of the current strip, `open(target, { newTab?, title? })` returning the tab id, `focus(tabId)`, `close(tabId)`, `pin(tabId, pinned)`, `reopenClosed()` |

App contracts are declared by dshx itself, so a consumer needs no dependency on whichever plugin provides them:

| Contract | Provider | What |
| --- | --- | --- |
| `Files` | `@dshfiles/editor` | for the session on screen: `watch(listener, { signal? })` follows the workspace file list (`no-session`, then `indexing`/`ready` replies), `open({ path, line?, cwd? })` opens a file in the editor, `openIn({ path, application?, reveal? })` hands an absolute Host path to another app or the file manager (desktop Hosts) |
| `Changes` | `@dshfiles/pulls-review` | `review({ workspacePath, sessionId? })` opens the review page on a workspace's changes |
| `Browser` | `@dshfiles/chat` | live `available` and `open(url)` for an http(s) URL in the embedded browser pane beside the session on screen |

```ts
const files = api.use(Files).get()
if (files.status === 'active') files.value.open({ path: 'src/index.ts', line: 12 })
```

```ts
const tabs = api.use(MainTabs).get()
if (tabs.status === 'active') tabs.value.open({ kind: 'panel', panelId: 'traces' }, { newTab: true })
```

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
| `api.commands.run(id)` | run a contributed `Command`, else a Host command; false when none can run; `api.commands.keys` is the live map of each command's effective keys |
| `api.layout` | `panel` (selected main panel), `openPanel(id)`, `toggleSidebar()`; `side` is the right region of the session on screen (its native right pane, or the Workbench dock): live `expanded`, `open()`, `hide()`, `toggle()`, each false without a side region or a session on screen |
| `api.system` | `copy(text)` through the Host clipboard, `save({ name, content, type? })` as a download, `openExternal(url)` for http(s) and mailto URLs in a new tab, `openLink(href)` through a `LinkHandler` and else as `openExternal`; each resolves or returns false when the browser cannot |
| `api.notifications` | `notify({ title, body?, tag?, onClick? })` shows an OS notification and returns false without permission or Notification API (it never prompts); `permission()` and `requestPermission()` (call it from a click) report `default`, `granted`, `denied` or `unsupported` |
| `api.storage` | key-value storage and stores kept on the Host under this plugin's package id (see [Host-backed state](#host-backed-state-apistorage)) |
| `api.environment` | `locale` (`{ id, direction }`) and `appearance` (`{ colorScheme, fonts? }`) as live values to `track` or `useSubscribable`; the page language and the system color scheme while the Host has no locale or theme service |

`@dshfiles/dialogs` provides `Dialogs` and `Toasts` with plugin-ui components.

### Composer

`Composer` (from `@dshfiles/dshx/client`, provided by `@dshfiles/rich-composer`) reads and edits the conversation
composer. Each verb addresses the composer on screen, or `sessionId`, and returns false when that composer is absent or
locked by a send in flight.

```ts
const composer = await api.whenActive(Composer)
composer.insert({ text: 'Fix the failing test' })
composer.attach({ attachment: { kind: 'quote', text: selection } })
await composer.setModel({ selection: { provider: 'deepseek', model: 'deepseek-chat', variant: 'high' } })
```

| Member | What |
| --- | --- |
| `current`, `focused` | live session id of the composer on screen, and whether it holds keyboard focus |
| `text()`, `setText({ text })`, `insert({ text })` | the draft with chips in clipboard form; replace it; insert at the caret |
| `attach({ attachment })` | a chip: `{ kind: 'file', path }`; `{ kind: 'quote' \| 'note', text, label? }` sent as a block quote or inside `<note>`; `{ kind: 'comment', path, line, endLine?, text }`, a comment on file lines sent with the next message inside `<comment path lines>` |
| `setModel({ selection })` | `provider`, `model` and `variant` (reasoning effort) for the next message |
| `focus()` | give the composer keyboard focus |

### Session screen

`SessionScreen` (from `@dshfiles/dshx/client`, provided by `@dshfiles/editor`) says which session shows and reads its
workspace files. `files` verbs address the `mounted` session unless given `sessionId`.

```ts
const screen = await api.whenActive(SessionScreen)
const stop = screen.files.index.subscribe(() => render(screen.files.index.get()))
const hits = await screen.files.search({ query: 'retry' })
```

| Member | What |
| --- | --- |
| `current` | the session the main view shows; undefined while a panel takes it |
| `mounted` | the session side panels follow: the last one shown |
| `files.index` | `{ status: 'no-session' }`, or `indexing`/`ready` with workspace-relative `files` and `truncated`; walked and watched only while subscribed |
| `files.list({ path })` | one tree level (`''` is the root) as `{ name, path, type }`, undefined when the Host refuses |
| `files.search({ query })` | the Host's file search as `@` mentions rank it |

Line comments ride the composer: `Composer.attach({ attachment: { kind: 'comment', … } })` puts a chip in the draft, so the
user sees and can remove it before it goes with the next message.

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

## Host-backed state: `api.storage`

`defineStore` keeps a value in this browser. `api.storage` keeps it on the Host, under the plugin's package id, so
every browser connected to that Host and the plugin's Host half (`pluginStorage(ctx, '@acme/plugin')`) see one value.
Values are JSON, at most 256 KiB each.

```ts
const layout = api.storage.store({ key: 'layout', scope: 'global', schema: z.object({ columns: z.number() }), initial: { columns: 1 } })
await layout.ready // reads `initial` until the Host answered
layout.set({ columns: 3 }) // optimistic; reverts with a console warning if the Host refuses
const draft = api.storage.store({ key: 'draft', scope: 'session', schema: z.string(), initial: '' })
draft(sessionId).get()

await api.storage.set('exports/2026-10', rows)
const page = await api.storage.list({ prefix: 'exports/', limit: 50 }) // { entries: [{ key, value, updatedAt }], cursor }
await api.storage.list({ prefix: 'exports/', cursor: page.cursor ?? undefined })
```

- A store is a `PersistedStore` plus `ready`; it follows writes from other browsers and the Host half through the
  storage API's `changed` event, and reads every loaded key again when that event stream comes back.
- Scopes: `global`, `session` and `project` like `defineStore`. A store is per server by construction: it lives on
  the Host the page is connected to. A directory fits the `project` scope id.
- `ready` rejects when the Host serves no plugin storage (the profile lacks the `@deepseek-ai/dsh-storage-domain` row,
  or no dshx Host with an API is loaded); the store keeps reading `initial`.
- Host keys of a store are `store/<key>` (global) or `store/<key>/<scope>/<id>`, so the Host half can read them.

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
