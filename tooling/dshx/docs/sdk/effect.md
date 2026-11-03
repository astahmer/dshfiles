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
waits for it, a call after unload is refused as `unavailable`. A definition has one activation at a time, so the same
definition object cannot be active on two Cordis Hosts at once (a second activation fails until the first unloads):
static tool definitions and API registrations carry no owning `ctx` to pick a runtime by. A test that mounts one
plugin on two Hosts exports a factory that calls `DshxPlugin.make` once per Host.

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

### `HostEvents.intercept(name, handler)` and `HostEvents.answer(name, handler)`

Cordis `waterfall` and `bail` events return a value to the emitter synchronously, so their handlers run with
`Effect.runSyncExitWith` and must not suspend (a suspending handler is logged like a defect). Both are scoped.

- `intercept` wraps a waterfall such as `llm/stream`: `handler({ args, next })` gets the arguments without the trailing
  continuation and `next`, the rest of the chain as an Effect that runs at most once. Return `next` (or map it) to pass
  through, anything else to veto. A failing handler is logged and the chain continues with `next`'s result; an error
  thrown by the rest of the chain itself still reaches the emitter.
- `answer` answers a bail event such as `request-messages/status`: the handler's value goes back to the emitter and
  `undefined` lets the next listener answer. A failing handler is logged and answers `undefined`.

- `interceptAsync` is `intercept` for a waterfall whose result is a Promise (`agent/pre-step`,
  `system-prompt/assemble`): the handler may suspend, `next` awaits the rest of the chain, and the handler's value
  resolves the emitter's Promise.

```ts
const hooks = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* HostEvents.intercept('llm/stream', ({ args: [options], next }) => Effect.andThen(Queue.offer(requests, options), next))
    yield* HostEvents.interceptAsync('agent/pre-step', ({ args: [payload], next }) => (isSettled(payload) ? Effect.succeed({ kind: 'reject' }) : next))
    yield* HostEvents.answer('request-messages/status', () => Effect.succeed(status))
  }),
)
```

### `HostCommands.register(command)`, `HostPrompt.section(section)` and `HostPrompt.context(context)`

From `@dshfiles/dshx/effect/host-commands` and `@dshfiles/dshx/effect/host-prompt`; the plugin declares
`@deepseek-ai/dsh-commands` / `@deepseek-ai/dsh-system-prompt` and injects `commands` / `systemPrompt`. Each registers
for the current Scope, so put it in a `Layer.effectDiscard` and the plugin's unload removes it.

- `HostCommands.register` takes the native `CommandDefinition` with an Effect handler
  `(invocation) => Effect<CommandResult, never, R>` that runs in the plugin's services. The invocation's abort
  interrupts it; a defect is logged under `dshx:commands` and answered as `/<name> failed. See Host diagnostics.`.
  Answer user errors as `{ kind: 'error', text }`.
- `HostPrompt.section` / `HostPrompt.context` take the native `PromptSection` / `PromptContext`; `text` is a string or
  `(assembly) => Effect<string, never, R>`. Assembly is synchronous, so that Effect must not suspend; a failing text
  is logged under `dshx:prompt` and contributes nothing.

```ts
const referenceCommand = Layer.effectDiscard(
  HostCommands.register({ name: 'reference', description: 'Attach references to this thread.', handler: invocation => runCommand(invocation) }),
)
const attachedContext = Layer.effectDiscard(
  HostPrompt.context({ name: 'dshfiles-references:attached', order: 200, interpolate: false, text: assembly => attachedText(assembly) }),
)
```

### `DshxPlugin.callback(fn)`

Captures the current services and returns `(...args) => Promise`, for a callback API that must stay Promise (a
polyfill, a native hook). Capture it once in a layer or `main`, not per call.

`DshxPlugin.callbackWithSignal(fn)` is the same for a caller that can abort: the returned function is
`({ signal }, ...args) => Promise`, an abort interrupts the fiber, and the interrupted call rejects with
`signal.reason`, as an aborted Promise API does. context-compaction passes the engine's summary signal this way, so
the model lookup stops with the compaction.

`callback`, every `HostEvents` listener, `HostCommands.register`, `HostPrompt` texts and `Tool.register` capture their
context without the current span, so each later run starts its own trace instead of hanging under `plugin activate`. A
plugin edge that captures context itself (an SDK adapter calling `Effect.runPromiseWith`) uses
`DshxPlugin.detachedContext()` for the same reason.

### `DshxPlugin.worker(effect)`

Forks a background loop from a layer for the plugin's lifetime (`Effect.forkScoped`), detached from the activation
span. Use it instead of a bare `forkScoped` in `Layer.effectDiscard`.

### `HostContext`, `hostService(name)`

`HostContext` holds the Cordis `ctx` and `packageId` of the activation. `hostService('tools')` reads one Cordis service
and fails with `HostServiceMissing` when the Host does not provide it. `hostServiceChanges('jobs')` yields a Stream of an
optional service as it comes and goes (`None`, `Some(service)`, `None` …), for a plugin that works without it; pair
it with `Stream.switchMap` so the work bound to one service instance stops when it goes. Only dshx edge layers use
them; domain services depend on typed services instead.

### `Config` and `DshxPlugin.processEnvConfig`

`DshxPlugin.make` (and the deprecated `DshxEffect.plugin` / `setup`) provide `DshxPlugin.processEnvConfig`, so
`Config.String('DSH_HOME')` reads `process.env` as it is at each lookup. Effect's default provider merges
`import.meta.env` over `process.env`, and under Vitest that is a startup snapshot: a test that sets `DSH_HOME` to a
scratch folder would read the shell's real home and write live state.

### `DshChildProcessSpawner.layer`

From `@dshfiles/dshx/effect/child-process-spawner`: Effect's standard `ChildProcessSpawner` over the DSH `subprocess`
service, so `ChildProcess.make(...)` keeps DSH environment scrubbing and process-range termination. A bare program
name (`git`, `secret`) is resolved first with the provider's `resolveExecutable` (its scrubbed `PATH` plus the
command's explicit `env` entries); absolute and relative paths are spawned as given. A missing program fails with a
`PlatformError` whose reason is `NotFound`. Shells, extra file descriptors and inherited stdin are refused as
`BadArgument`.

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
`HostContext.layer({ ctx: host.ctx, packageId })`. A test that reads `Config` without going through
`DshxPlugin.make` (a domain service under `it.layer`) provides the same provider:
`Effect.provide(DshxPlugin.processEnvConfig)`. To assert a span, provide `tracerLayer` (exported from
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

## Verifying a Host migration

Migration is behaviour-preserving, so the checks compare behaviour instead of reading code. Run the narrow ones while
iterating and the whole gate before landing.

| Check                                                                                           | Proves                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run check:effect-native`                                                                  | the per-package debt scorecard did not grow: no `Layer.empty`, `tryPromise` facade, module `let`/`WeakMap`, timer, `node:fs`/`node:child_process`/`fetch`, causeless `TaggedError` or Host-test mock creeps back in    |
| `pnpm run lint`                                                                                 | oxlint + ast-grep ratchets plus `check:effect-antislop` and the zod-import gate; the Effect rules flag cause-dropping catches, `Effect.fn(…)(() => Effect.gen…)`, global timers, span-name format                      |
| `pnpm --dir tooling/dshx run features:check`                                                    | each feature still names the test that asserts its span and its behaviour                                                                                                                                              |
| `pnpm --dir tooling/dshx/packages/dshx exec vitest run tests/host-tool-schema-snapshot.spec.ts` | no published tool schema changed; a deliberate change means regenerating the fixture and saying so                                                                                                                     |
| `node scripts/check-api-spans.mjs`                                                              | live shape in a scratch DSH: exactly one `<api>/<method>` server span per call, the handler's `Effect.fn` under it, no orphans, no SQL spans, and a `traces/stats` control call stores nothing (no traces→traces loop) |
| `pnpm run check`                                                                                | the local gate: scripts typecheck, cycles, native-fork diff, script tests, profile contract, dshx, screenshots, plugins, repo, effect-native audit, knip                                                               |
| `pnpm run check:e2e <owner>`                                                                    | the journeys whose owner you touched. The full catalogue (`pnpm run check:e2e --all`, 30–50 min) belongs to CI                                                                                                         |

CI runs the same building blocks as parallel jobs behind one `gate` job, so the required-check name survives reshards:
lint, types, three `units` shards of plugin build+typecheck+test, `dshx`, repo checks, three `boot` shards and
`e2e-smoke`. Wire codes stay compatible by annotating each failure kind (`dshxWireCode`); the tool-schema snapshot is
the contract for tool parameters.

Measured cost of the migration, method and spread: [`docs/performance.md`](../../../../docs/performance.md).

## Known follow-ups

These are understood and deliberately open, not forgotten:

- `@dshfiles/fff-search`'s real-Host suite executes `grep`/`glob`, which spawns the native index worker inside the
  vitest child; on the CI Linux runner that child exits mid-run, so the mount is skipped on CI while the unit file and
  the plugin boot gate still run there. Reproduce on a Linux runner and check whether executing an fff tool in a real
  Linux Host also kills the process.
- The session-search index still opens its own `DatabaseSync`; moving it onto `@dshfiles/sqlite-store` needs a
  copy-based proof on the multi-gigabyte live index.
- memory's `bench/host-loop-freezes.ts` has no clean before/after: the "before" run spends its time in the stock
  session-query engine indexing a large backlog rather than in memory's own code.
- `@dshfiles/optmem-core` still owns a `createMemoryEngine` that no Host imports; it is dead from the Host side, which is
  why it was not ported.

## Reference plugins

Copy these two Host halves before writing a new one; each file is one pattern.

| File                                                                                                                                               | Shows                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`background-jobs/src/host.ts`](../../../../plugins/@dshfiles/background-jobs/src/host.ts)                                                         | `DshxPlugin.make` with one layer graph and `Api.bind`; background loops as `Layer.effectDiscard(… Effect.forkScoped)` (use `DshxPlugin.worker` where the edge provides it); a `Schedule` whose delay reads its input; `Stream.groupedWithin` + `Api.publish` to rate-limit an event |
| [`background-jobs/src/history.ts`](../../../../plugins/@dshfiles/background-jobs/src/history.ts)                                                   | a service on `FileSystem`/`Path` with its config as a service; `Semaphore` instead of a busy flag; state in a `SubscriptionRef`; `Effect.cached` for a one-time load; a span annotated with counts                                                                                  |
| [`background-jobs/src/live.ts`](../../../../plugins/@dshfiles/background-jobs/src/live.ts)                                                         | an optional Host service through `hostServiceChanges` + `Stream.switchMap`; a callback API as `Stream.callback` with `acquireRelease`                                                                                                                                               |
| [`background-jobs/src/service.ts`](../../../../plugins/@dshfiles/background-jobs/src/service.ts)                                                   | waiting on state changes with `SubscriptionRef.changes` + `Effect.timeoutOption` instead of polling; annotated errors (`errors.ts`)                                                                                                                                                 |
| [`usage/src/store.ts`](../../../../plugins/@dshfiles/usage/src/store.ts), [`migrations.ts`](../../../../plugins/@dshfiles/usage/src/migrations.ts) | a repo over `SqlClient` from `@dshfiles/sqlite-store` (legacy `user_version` adoption), hoisted row decoders, `sql.withTransaction`, one tagged error per operation                                                                                                                 |
| [`usage/src/indexing.ts`](../../../../plugins/@dshfiles/usage/src/indexing.ts)                                                                     | in-flight dedupe with `FiberHandle.run(…, { onlyIfMissing: true })` so a caller's abort never cuts shared work short; a failed step as a tagged error recorded in state                                                                                                             |
| [`usage/src/otel-exporter.ts`](../../../../plugins/@dshfiles/usage/src/otel-exporter.ts)                                                           | `HttpClient` with `Effect.retry(Schedule.exponential …)` inside `Effect.repeat(Schedule.spaced …)`                                                                                                                                                                                  |
| `*.test.ts` in both                                                                                                                                | `it.layer`/`it.effect` over real layers (temp dirs, `:memory:` SQLite), `TestClock` for every schedule, stand-ins only for external systems (`JobRegistry`, `HttpClient`)                                                                                                           |

An exposed error's `details` carry its fields without `cause`: keep `cause` on the error for the Host log, never
assert it on the client.

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
