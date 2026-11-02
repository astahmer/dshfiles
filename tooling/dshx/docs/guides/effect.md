# Effect-native API

**Entry: `@dshfiles/dshx/effect`** (needs `effect` 4.1.0, an optional peer dependency of `@dshfiles/dshx`)

A Host plugin written in Effect is one layer graph that `DshxPlugin.make` builds and owns; contracts still come from
`defineApi`, so callers, agent tools and the registry cannot tell an Effect handler from a Promise one. The full
reference, standards and error mapping are in [Effect in dshx](../sdk/effect.md).

## Serve a contract

```ts
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Schema } from 'effect'
import { notesApi } from './notes-api.js'

class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }, { dshxWireCode: 'not-found' }) {
  override get message(): string {
    return `No note ${this.id}.`
  }
}

class NotesStore extends Context.Service<NotesStore, { readonly get: (id: string) => Effect.Effect<string, NotFound> }>()('@acme/notes/NotesStore') {
  static readonly layer = Layer.succeed(NotesStore, NotesStore.of({ get: id => (id === 'a' ? Effect.succeed('first') : Effect.fail(new NotFound({ id }))) }))
}

export default DshxPlugin.make({
  name: '@acme/notes',
  layer: NotesStore.layer,
  apis: [Api.bind(notesApi, { get: input => NotesStore.use(store => store.get(input.id)) })],
})
```

- Each call runs in the plugin's services under the one `<api>/<method>` dispatch span. An aborted call interrupts
  the handler fiber, so finalizers and `Effect.onInterrupt` run.
- `NotFound` reaches the caller as `kind: 'remote'`, `remoteCode: 'not-found'`, its message and `remoteDetails`
  (`{ _tag, id }`) because its class carries `dshxWireCode`. A defect stays internal and is logged on the Host.

## The plugin lifetime is a Scope

```ts
export default DshxPlugin.make({
  name: '@acme/watcher',
  layer: Watcher.layer, // acquires with Effect.acquireRelease inside Layer.effect
  main: Watcher.use(watcher => watcher.pollForever), // forked into the plugin Scope
})
```

The layer is built once per activation into one Scope that the Cordis disposer closes when the plugin unloads or
reloads. A failing build closes the Scope and fails activation with `PluginActivationError`, so a half-started plugin
never stays loaded.

## Clients that return Effects

```ts
const notes = Api.client({ contract: notesApi, api: createHostApiClient(ctx, notesApi, '@acme/caller'), errors: [NotFound] })
const note = notes.get({ id: 'a' }) // Effect<string, NotFound | ApiTransportError | ApiUnavailableError | ApiContractError | ApiRemoteError>
```

Interrupting the Effect aborts the call; a call the Host reports as aborted interrupts the fiber.

## Events

`HostEvents.on(name, handler)` listens to a Cordis event while the current Scope lives. Contract events are published
with `DshxEffect.publish` (deprecated, kept until a scoped publisher replaces it) and read in the browser with
`useApiEvent`.
