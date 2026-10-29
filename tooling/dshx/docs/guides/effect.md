# Effect-native API

**Status: API Candidate**

**Entry: `@dshfiles/dshx/effect`** (needs `effect` 4, an optional peer dependency of `@dshfiles/dshx`)

The entry layers [Effect](https://effect.website) over the Promise API; it is not a second plugin model. Plugins still register through `defineHost` and contracts still come from `defineApi`, so an Effect handler and a Promise handler are indistinguishable to callers, agent tools and the registry. Nothing changes for a plugin that does not import it.

Everything lives on one namespace class, `DshxEffect`.

## Handlers that return Effects

```ts
import { Effect, Schema } from "effect";
import { defineHost } from "@dshfiles/dshx/host";
import { DshxEffect } from "@dshfiles/dshx/effect";
import { notesApi } from "./notes-api.js";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { message: Schema.String }) {}

export default defineHost({
  apis: [
    DshxEffect.host(notesApi, {
      get: ({ input }) => (input.id === "a" ? Effect.succeed({ id: "a", text: "first" }) : Effect.fail(new NotFound({ message: `No note ${input.id}.` }))),
    }),
  ],
});
```

- Each call runs in its own fiber under a `dshx-effect <api>.<method>` span. The call's `AbortSignal` interrupts it, so finalizers and `Effect.onInterrupt` run when the browser or caller gives up.
- A failure with a `_tag` (a `Schema.TaggedError`) reaches the caller as a `PluginApiError`: `kind: 'remote'`, its `message`, and `remoteCode` in kebab case (`NotFound` → `not-found`). A `PluginApiError` passes through unchanged; a defect stays an internal error that is only logged on the Host, as with a thrown value.
- Handlers that need services take a `ManagedRuntime` as the third argument; the type requires one exactly when a handler's `R` is not `never`:

```ts
const runtime = ManagedRuntime.make(NotesStore.layer);
DshxEffect.host(
  notesApi,
  {
    get: ({ input }) =>
      Effect.gen(function* () {
        const store = yield* NotesStore;
        return yield* store.get(input.id);
      }),
  },
  { runtime },
);
```

Dispose the runtime from the plugin's lifetime (below) when the plugin owns it.

Handlers return single results. A method stays request/response; an ongoing stream of values goes through a contract event (`DshxEffect.publish` on the Host, `DshxEffect.events` in the browser).

## The plugin lifetime is a Scope

```ts
export default defineHost({
  setup: DshxEffect.setup((ctx, config) =>
    Effect.gen(function* () {
      const watcher = yield* Effect.acquireRelease(openWatcher(), (watcher) => Effect.promise(() => watcher.close()));
      yield* Effect.forkScoped(pollForever(watcher));
    }),
  ),
});
```

`DshxEffect.setup(program)` returns a `setup` for `defineHost`. Activation waits for `program` to finish; everything it acquired, every finalizer and every `Effect.forkScoped` fiber lives in one Scope that closes when the plugin unloads, reloads or its fiber is disposed. A failure closes the Scope with that failure and fails activation, so a half-started plugin never stays loaded.

## Clients that return Effects

```ts
const notes = DshxEffect.client(createHostApiClient(ctx, notesApi, "@acme/caller")); // or a browser client from useApi()
const note = notes.get({ id: "a" }); // Effect<Note, ApiCallError>
```

`ApiCallError` is a `Schema.TaggedError` carrying the `ApiError` fields (`kind`, `apiId`, `method`, `retryable`, `remoteCode`). Interrupting the Effect aborts the call.

## Events as Streams

```ts
// Host
const forwarding = Stream.runForEach(changes, (payload) => DshxEffect.publish(ctx, notesApi, "changed", payload));
// Browser
const changed = DshxEffect.events(useApi(notesApi), "changed"); // Stream<{ id: string }>
```

`publish` fails with `PublishEventError` when the contract declares no such event, the payload fails its schema, or the API is not served. `events` opens the shared event subscription when the Stream is first pulled and closes it when the Stream ends or is interrupted; delivery is the same as `subscribeApiEvent` (schema-checked, current contract version only).
