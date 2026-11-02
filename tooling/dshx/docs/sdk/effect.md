# Effect in dshx

DSH core stays Promise-based: Cordis activation, agent tools, hooks and the Connection protocol take and return
Promises. A Host plugin written in Effect is one layer graph built from a single `HostContext`, and dshx owns the only
Promise edge: `DshxPlugin.make`. Plugins never call `Effect.runPromise`, `runFork` or `runSync` themselves.

Import everything from `@dshfiles/dshx/effect`; `effect` is pinned to exactly `4.1.0` (and `@effect/vitest` to the
same release). Effect 4.1 has no `effect/unstable/*`, `Layer.scoped`, `Effect.forkDaemon` or `Effect.catchAll`: use
`effect/process`, `effect/http`, `effect/sql`, `Layer.effect`, `Effect.forkDetach`, `Effect.catch` / `catchCause`.

## Standards

| Area        | Rule                                                                                                                                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Imports     | Named imports from `effect`, `effect/process`, `effect/http`, `effect/sql`; no star or aliased imports.                                                                                                                                                  |
| Service     | `class X extends Context.Service<X, {…}>()('@dshfiles/<plugin>/X')` with `static readonly layer = Layer.effect(X, make)`; `make` is an `Effect.gen` that `yield*`s its dependencies; methods are `Effect.fn('<subject> <verb>')`. No deps as parameters. |
| Edge        | `HostContext` is the only holder of the Cordis `ctx`; `ctx.get` / `ctx.on` appear only in dshx edge layers. `DshxPlugin.make` runs effects; plugins do not.                                                                                              |
| Lifetime    | One `Scope` per plugin activation, closed by the one Cordis disposer. Background work is `main`, or `Effect.forkScoped` inside a layer (`Layer.effectDiscard`). No `ctx.effect` disposers beside it, no `void p.then`.                                   |
| Errors      | One `Schema.TaggedError` per failure kind with bounded attributes, `cause: Schema.optional(Schema.Defect())` when wrapping, a message built from attributes. Wire exposure is opt-in with `dshxWireCode`. Handle with `Effect.catchTags`.                |
| Concurrency | `Semaphore`, `Queue`, `PubSub`, `FiberMap`, `FiberSet`, `Cache`, `SubscriptionRef`, `Deferred`, `Schedule`. No `setTimeout`, promise chains, AbortController plumbing or polling in Host code.                                                           |
| Tracing     | One server span per API call (the dispatch span); `Effect.fn` spans for work units; attributes are identities and counts.                                                                                                                                |
| Schema      | Decode once at the boundary with `decodeUnknownEffect`; hoist compiled codecs; `Schema.Class` for domain records; no per-plugin wrapper modules.                                                                                                         |
| Tests       | `@effect/vitest` `it.effect` / `it.layer` over real layers; `TestClock` for every schedule; no mocks, fake timers or sleeps.                                                                                                                             |

## A plugin

```ts
import { defineApi, method } from '@dshfiles/dshx/api'
import { Api, DshxPlugin, Tool } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Ref, Schema } from 'effect'

class NoteNotFound extends Schema.TaggedError<NoteNotFound>()('NoteNotFound', { id: Schema.String }, { dshxWireCode: 'note-not-found' }) {
  override get message(): string {
    return `No note ${this.id}.`
  }
}

class Notes extends Context.Service<Notes, { readonly get: (id: string) => Effect.Effect<string, NoteNotFound> }>()('@dshfiles/notes/Notes') {
  static readonly layer = Layer.effect(
    Notes,
    Effect.gen(function* () {
      const notes = yield* Ref.make(new Map<string, string>())
      return Notes.of({
        get: Effect.fn('notes get')(function* (id) {
          const text = (yield* Ref.get(notes)).get(id)
          if (text === undefined) return yield* new NoteNotFound({ id })
          return text
        }),
      })
    }),
  )
}

const notesApi = defineApi({
  id: 'notes',
  version: 1,
  methods: { get: method({ input: Schema.Struct({ id: Schema.String }), output: Schema.String }) },
})

export default DshxPlugin.make({
  name: '@dshfiles/notes',
  layer: Notes.layer,
  apis: [Api.bind(notesApi, { get: input => Notes.use(notes => notes.get(input.id)) })],
  tools: [
    Tool.make({
      name: 'notes_get',
      description: 'Read one note. Read-only.',
      input: Schema.Struct({ id: Schema.String }),
      readOnly: true,
      execute: input => Notes.use(notes => notes.get(input.id)),
    }),
  ],
})
```

### `DshxPlugin.make({ name, inject?, Config?, settings?, layer, main?, apis?, tools? })`

Returns a `defineHost` definition: default-export it. On activation it builds
`Layer.provideMerge(layer, Layer.mergeAll(HostContext.layer, tracerLayer))` with `Layer.buildWithScope` into one
`Scope`, so the dshx tracer also covers layer construction. `layer` may be a function of the decoded `Config` (an
Effect Schema, validated by the Loader and decoded again here). `main` is forked into the Scope after the build and
interrupted on unload. The Cordis disposer closes the Scope; finalizers run in reverse order.

A failing build closes the Scope, logs `Cause.pretty` under `dshx:plugin` and rejects activation with a
`PluginActivationError` whose `cause` is the Cause. The type checker refuses handlers, tools and a `main` that need a
service the layer does not build.

`apis` and `tools` stay in the definition, so the registry, the tool-schema snapshot and `inject` see them. Each call
runs with `Effect.runPromiseExitWith(services)` of the active plugin: a call that arrives before activation finishes
waits for it, a call after unload is refused as `unavailable`. A definition has one activation at a time.

### `Api.bind(contract, handlers)` and `Api.handlers(contract, handlers)`

Handlers are `(input, call) => Effect`. `input` is the decoded contract input; `call` carries `caller` and `peer`.
There is no AbortSignal: an aborted call interrupts the handler fiber. `Api.handlers` types a handler map declared
apart from `bind`.

### `Api.publish({ contract, event, payload })`

Publishes one contract event from the Host and needs `HostContext`; a payload the event schema refuses, or an event the
contract does not declare, fails with `PublishEventError`. Rate-limit a noisy source with a Stream before it, e.g.
`Stream.runForEach(Stream.throttle(changes, …), () => Api.publish(…))`.

### `Tool.make({ name, description, input, output?, readOnly?, render?, execute })` and `Tool.register`

`input` is an Effect Schema, published to the model as a closed JSON Schema and decoded strictly before `execute`
(`Schema.Void` means no arguments). `output`, when given, encodes the result to JSON. An abort interrupts the fiber.
The agent reads an exposed failure's message (invalid arguments included); any other failure reads
`<tool> failed. See Host diagnostics.` and its Cause is logged under `dshx:tool`. `Tool.register(tool, { tools? })`
registers a tool for the current Scope, e.g. into one agent's scoped tool runtime while that agent runs.

### `HostEvents.on(name, handler)` and `HostEvents.stream(name)`

`on` listens to a Cordis event while the current Scope lives and runs each event in a fiber of a scoped `FiberSet`;
a defect is logged, never thrown into the emitter. `stream` is the same listener as a `Stream`.

### `DshxPlugin.callback(fn)`

Captures the current services and returns `(...args) => Promise`, for a callback API that must stay Promise (a
polyfill, a native hook). Capture it once in a layer or `main`, not per call.

`callback`, `HostEvents.on` and `Tool.register` capture their context without the current span, so each later run
starts its own trace instead of hanging under `plugin activate`. A plugin edge that captures context itself (an
SDK adapter calling `Effect.runPromiseWith`) uses `DshxPlugin.detachedContext()` for the same reason.

### `DshxPlugin.worker(effect)`

Forks a background loop from a layer for the plugin's lifetime (`Effect.forkScoped`), detached from the activation
span. Use it instead of a bare `forkScoped` in `Layer.effectDiscard`.

### `HostContext`, `hostService(name)`

`HostContext` holds the Cordis `ctx` and `packageId` of the activation. `hostService('tools')` reads one Cordis service
and fails with `HostServiceMissing` when the Host does not provide it. `hostServiceChanges('jobs')` yields a Stream of an
optional service as it comes and goes (`None`, `Some(service)`, `None` …), for a plugin that works without it; pair
it with `Stream.switchMap` so the work bound to one service instance stops when it goes. Only dshx edge layers use
them; domain services depend on typed services instead.

## Errors on the wire

| Handler outcome                                                                          | Caller sees                                                                                         |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Interruption only (the caller aborted, or the plugin unloaded mid-call)                  | `aborted`                                                                                           |
| A failure whose class has `{ dshxWireCode: 'code' }`, or a `PluginApiError`              | `remote` with that code, the error's message and its JSON-encoded fields as `remoteDetails`         |
| An unannotated `TaggedError` failure                                                     | its kebab-case tag as the code, for compatibility only; the Host warns once per tag to annotate it  |
| A defect (`Effect.die`, `orDie` on a `SchemaError`, a thrown exception) or anything else | `internal` with `API handler failed. See Host diagnostics.`; the Host logs `Cause.pretty`, redacted |

`remoteDetails` never includes a wrapped `cause`: it stays in the Host log, because it can carry provider text, paths
or stderr.

Annotate the error class, not the handler: `Schema.TaggedError<X>()('X', fields, { dshxWireCode: 'x' })`, as
`effect/http-api` annotates `httpApiStatus`. The codes `aborted`, `bad-request`, `contract` and `internal` are reserved.

## Calling an API

`Api.client({ contract, api, errors? })` wraps a Promise client (`createHostApiClient` on the Host, the Client's
`createApiClient`). Every call fails with one of `ApiTransportError`, `ApiUnavailableError` (`ownerMissing` when the
owner is not loaded), `ApiContractError` or `ApiRemoteError` (`code`, message, `details`). A remote failure whose
details decode into one of `errors` fails with that class instead. Interrupting the fiber aborts the call, an aborted
call interrupts the fiber, and a non-ApiError throw is a defect.

## Schemas

An Effect Schema passed to `method` or `event` becomes a strict Standard Schema without any import: decoding rejects
unknown keys (`onExcessProperty: 'error'`) and the published JSON Schema closes every object
(`additionalProperties: false`). An empty Struct publishes the closed empty object; `Schema.Void` publishes
`type: null`, which agent tools read as "no arguments". A Standard Schema adapter you pass yourself is used as is.

## Tracing

dshx bridges Effect spans into its own tracer, recorder and exporter (`tracerLayer`); do not add
`@effect/opentelemetry`. `DshxPlugin.make` provides the tracer once, under the layer build. Every API call has exactly
one server span, the dispatch span `<api id>/<method>`; handler and service `Effect.fn` spans are its descendants.

`Effect.log*` in a plugin writes to the Host's Cordis logger of the activating package, with `Cause.pretty` appended
when the entry carries a cause; `DshxPlugin.make` installs that logger for every fiber of the plugin.

## Testing

Use `@effect/vitest` and real layers. A domain service that needs no Host is tested with `it.layer(Service.layer)`.
Test the edge (`DshxPlugin.make`, `Api.bind`, `Tool.make`) against a real in-memory Host: build `createTestHost()`
from `@dshfiles/dshx/testing` inside `Layer.effect` with `Effect.acquireRelease`, mount the definition, and call it
through `createHostApiClient` or `host.tools.execute`. A layer that reads `HostContext` gets
`HostContext.layer({ ctx: host.ctx, packageId })`. To assert a span, provide `tracerLayer` (exported from
`@dshfiles/dshx/effect`) and read it with `recordSpans()` from `@dshfiles/dshx/tracing`. Never mock the service under
test.

```ts
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

describe('Notes', () => {
  it.layer(Notes.layer)(it => {
    it.effect('fails with NoteNotFound', () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(Notes.use(notes => notes.get('missing')))
        expect(error.id).toBe('missing')
      }),
    )
  })
})
```

`create-dshx --template effect-host` scaffolds this shape: `DshxPlugin.make`, one service, one annotated error and an
`it.layer` test, with `effect` and `@effect/vitest` pinned to `4.1.0`.

## The deprecated `DshxEffect` namespace

`DshxEffect.plugin`, `host`, `setup`, `client`, `events`, `publish` and `tracerLayer` keep working while plugins move.
They run on the same activation edge, wire mapping and tracer, with no runtime registry. Replace them as follows and
delete the namespace when its callers reach zero.

| Deprecated                                        | Replacement                                                     |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `DshxEffect.plugin({ layer, setup })` + `hostApi` | `DshxPlugin.make({ layer, main, apis: [Api.bind(...)] })`       |
| `DshxEffect.host(contract, handlers)`             | `Api.bind(contract, handlers)` inside `DshxPlugin.make`         |
| `DshxEffect.setup(program)`                       | `DshxPlugin.make({ layer, main })`                              |
| `DshxEffect.client(api)` (`ApiCallError`)         | `Api.client({ contract, api })`                                 |
| `Effect.runPromise` at a tool `execute`           | `Tool.make` in `DshxPlugin.make({ tools })`, or `Tool.register` |
