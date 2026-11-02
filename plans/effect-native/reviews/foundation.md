# Effect foundation review — dshx `effect/*`, API schema path, shared ports

Repo: `/Users/astahmer/dev/dshfiles-threads/thread-72c437` (read-only). Paths below are relative to it unless prefixed.
`DX = tooling/dshx/packages/dshx`, `E4 = ~/.references/effect-4.1.0/packages/effect/src`, `OC = ~/.references/opencode/packages`.

## 0. Headline facts (verified)

1. **`@dshfiles/dshx/effect/services` has zero plugin consumers.** `grep -rn "effect/services\|SettingsRead.make\|PluginStorage.layer|…" plugins` → 0 hits; `EffectHostServiceError` → 0 hits in plugins. `DshxEffect.setup`, `DshxEffect.client`, `DshxEffect.events` → 0 plugin callers. Actual usage: `DshxEffect.plugin` ×38, `DshxEffect.host` ×10, `DshxEffect.tracerLayer` ×17 (mostly hand-provided at tool edges), `DshxEffect.publish` ×1. The foundation's "standard services" are dead surface; every plugin re-wraps `ctx.get(...)` itself.
2. **No agent-tool edge exists**, so plugins hand-roll `Effect.runPromise` at tool `execute` (17 non-test sites, e.g. `plugins/@dshfiles/goal-stall-guard/src/goal-continuation.ts:129,148` — no plugin runtime, no dshx tracer; `tool-search/src/host.ts:246` provides `tracerLayer` by hand; `html-render/src/host.ts:21-22` captures `Effect.context` and re-provides it, the only hit of upstream `no-effect-context-reprovide`).
3. **The plugin runtime can't compose with a Promise `setup`**, producing `void effect.setup(ctx).then(...)` + `ctx.effect` disposer races (`ai-accounts/src/host.ts:110-141`, plus a `WeakMap<Context,…>` at :108) and the inverted `Effect.tryPromise({ try: () => effectPlugin.setup(ctx, config) })` (`shared-streams/src/host.ts:72`). 4 plugins pass `layer: Layer.empty`.
4. **Effect Schema JSON-schema publication depends on import order.** `DX/src/api/schema.ts:13,16` holds a module-global converter set by a side-effect in `DX/src/effect/index.ts:61-75`; without it `schema.ts:30-35` returns a Standard Schema _without_ `jsonSchema`, `json-schema.ts:15` returns `undefined`, and the tool schema silently becomes `{}`. Results are cached in a WeakMap (`schema.ts:14,22`), so a schema resolved before the import is poisoned for the process. Workaround is a bare `import '@dshfiles/dshx/effect'` (`plugins/@dshfiles/vcs-provider-port/src/index.ts:1-2`, scaffold `DX/src/scaffold/presets.ts:204`). `schema.ts:2` already imports `effect/Schema`, so the indirection buys nothing.
5. **Defects leak as remote codes.** `settle` (`DX/src/effect/index.ts:97-100`) throws `Cause.squash(cause)`; squash returns the first `Fail`, else the first `Die` defect (`E4/internal/effect.ts:290-299`). `thrownFailure` (:89-95) duck-types any `{ _tag: string }`. So `Effect.orDie` on a `SchemaError` (`E4/Schema.ts:1219`, `Data.TaggedError("SchemaError")`, message = issue text incl. input values), `NoSuchElementError` (`E4/internal/core.ts:732`), `TimeoutError` (`E4/Cause.ts:1447`) all reach the browser as `remoteCode: 'schema-error'|'no-such-element-error'|…` with their internal message. Interruption becomes `Error("All fibers interrupted without error")` (:297) → logged as "API handler failed" internal error instead of `aborted`. Conversely **every** typed failure is public (no opt-in), e.g. a typed `PlatformError` message is sent to the client.
6. **Tracer bridge exports span ids Effect never sees.** `DX/src/effect/tracer.ts:22-29`: the dshx span is created first, then a `NativeSpan` with its own random `spanId` (`E4/Tracer.ts:705-745`) whose _parent_ is an `externalSpan` of the dshx span itself (`dshxContext = dshxSpan.context`, :26). Effect-side `span.spanId` (used by `Effect.currentSpan`, log span annotations, traceparent propagation from `effect/http`) ≠ exported id (`DX/src/tracing/tracer.ts:118`). Events (:53-55) and links (:56-58) dropped; Effect's start/end times ignored (:44-47); interruption recorded as error via `Cause.squash` (:46).
7. **Layer construction is untraced.** `ManagedRuntime.make(Layer.merge(layer, tracerLayer))` (`index.ts:171`): `merge` does not provide the tracer _to_ `layer`'s construction, so `Effect.fn` spans inside `Layer.effect` builders run on the default native tracer and are never exported. Must be `Layer.provideMerge(layer, tracerLayer)`.
8. **Duplicate span per API call.** `api-dispatch` already opens `${contract.id}/${endpoint}` (`DX/src/api/host-runtime.ts:116-140`); the Effect adapter adds `dshx-effect ${contract.id}.${name}` (`index.ts:123`) around the same unit. Neither follows the repo's `<subject> <verb>` rule; plugins then add their own `Effect.fn` span → 3 spans/unit.
9. **Lint is effectively off for Effect.** Root `.oxlintrc.json` enables 1 of 8 upstream `effect-antislop` rules (`no-domain-effect-run`) and scopes it to `DX/src/effect` _excluding_ `index.ts` and `tracer.ts` — the only two files that run effects. The 7 repo `effect-migration` rules are on but none detects the dominant smells (cause-dropping catch, `Layer.empty`, raw `ctx` params, `void p.then`, WeakMap registries). Running all 8 upstream rules over plugins: 54 `no-domain-effect-run`, 1 `no-effect-context-reprovide`, 0 others.
10. **ALS context hook cost measured.** The `context` hook (`tracer.ts:66-70`) is invoked for **every primitive** (`E4/internal/effect.ts:692-694`, cache set :792). Same design as `@effect/opentelemetry` (`effect-4.1.0/packages/opentelemetry/src/OtelTracer.ts:112-123`), so not wrong, but: Node 22.23.3, 300k `flatMap` steps (600,889 hook calls), min of 10 runs: no hook 68 ms; ALS `run` per op 158 ms (**+~150 ns/op, 2.3×**); guarded (`storage.getStore() === parent ? evaluate : run`) 113 ms. Negligible for I/O handlers, real for CPU-bound Effect loops/Streams (traces receiver, search ingest, Stream pipelines). Bench: `/private/tmp/claude-501/-private-var-folders--p-mx79mqqn6ss8755q205k8-340000gn-T-dsh-claude-cli-1dEbE1/f8e0210b-065f-4cd5-aebb-d8f18fef8f0c/scratchpad/bench3.mjs`.

## 1. Summary table

| Unit                                                                                                        | Verdict       | Native % | Top 3 problems                                                                                                                                                            | Effort |
| ----------------------------------------------------------------------------------------------------------- | ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U1 `effect/index.ts` (runtime + API edge)                                                                   | facade        | 30%      | WeakMap<Context,ManagedRuntime> registry; `settle` via `Cause.squash` leaks defects/drops interruption; three overlapping entrypoints, no tool edge, layer built untraced | L      |
| U2 `effect/services.ts`                                                                                     | facade (dead) | 10%      | 0 callers; `Layer.succeed` w/ side effects + raw ctx params; one causeless `EffectHostServiceError`                                                                       | M      |
| U3 `effect/tracer.ts`                                                                                       | partial       | 50%      | Effect span ids ≠ exported ids; events/links/times dropped, interrupt=error; per-op ALS cost w/o guard                                                                    | M      |
| U4 `effect/client.ts`                                                                                       | facade        | 40%      | `Schema.decodeUnknownSync` to check `typeof function`; unknown errors → retryable `transport`; one error class for 5 kinds, abort as failure                              | S      |
| U5 API schema adapter (`api/schema.ts`, `json-schema.ts`, `define.ts`, host registration, `PluginApiError`) | partial       | 40%      | import-order-dependent global converter + poisoned cache; duck-typed `_tag`→code with no opt-in; wire `details` unused, no typed client errors                            | M      |
| U6 tests                                                                                                    | partial       | 25%      | 1 `it.effect` (wrapping nested `runPromise`), no `it.layer`; no tests for defect leak/interrupt/span ids; fake subprocess handle; test asserts cause is absent            | M      |
| U7 docs + scaffold                                                                                          | facade        | 20%      | docs claim "defects remain internal" (false); scaffold uses `Layer.empty` + `DshxEffect.host` (bypasses plugin runtime); exact-pin vs `^4.1.0` peer                       | S      |
| U8 lint (effect-antislop / effect-migration)                                                                | facade        | 10%      | 7/8 upstream rules off; enabled one scoped to files that never run; no rule for cause-dropping catch/Layer.empty/raw ctx                                                  | S      |
| U9 shared ports (credential, vcs-provider, session-source)                                                  | facade        | 30%      | Effect services are `Layer.succeed` wrappers over Promise logic taking raw deps; causeless errors; bespoke `wirePayload` declare-wrapper; side-effect import              | M      |

## 2. Per unit findings + target design

### U1 — `DX/src/effect/index.ts`

**R1 Facade**

- `:41-42` module-level `WeakMap<Context, AnyManagedRuntime>`; looked up per call (`:140,168`). Two `DshxEffect.plugin` on one Cordis ctx overwrite each other; a handler arriving before `setup` resolves (or after a failed `setup` deleted it, `:177`) throws a plain `Error` (`:112`) → client sees `internal`.
- `:174` runtime registered **before** `setup` program completes; handlers can run concurrently with setup.
- `:61-75` side-effect registration of the schema converter at import (see U5).
- `:149-159` `DshxEffect.setup` — `Effect.runSync(Scope.make())` (v4 has `Scope.makeUnsafe`, `E4/Scope.ts:282`), 0 callers.
- `:225-233` `class DshxEffect { static … }` — a class of statics (exists to dodge `antislop/no-export-bag`, whose `excludePaths` already exempts `**/src/**/index.ts` in `.oxlintrc.json`). Use `export * as DshxEffect from './dshx-effect.js'` (tree-shakeable, idiomatic; matches `OC/core/src/plugin/service.ts:1` `export * as Plugin`).
  **R2/R3**
- `:162` `layer: Layer | ((ctx, config) => Layer)` — raw Cordis ctx threaded into layer factories (11 plugins use the function form). No `HostContext` service, so `ctx.get` lives in arbitrary closures.
- `:171` `Layer.merge(layer, tracerLayer)` — layer construction not traced (fact 7).
- `:163` `setup: (ctx, config) => Effect<void, E, R|Scope>` — same `E` for layer and setup; no requirement that setup errors are handled (opencode forces `E = never`, `OC/plugin/src/effect/plugin.ts:62-65`).
  **R4**
- `:97-100,:156,:180` `Cause.squash` everywhere → loses multi-failure, conflates defect/interrupt (fact 5).
- `:33-35` handler error type `E` is unconstrained: nothing forces wire-safe errors at compile time.
- `:216-218` `publish` maps to `PublishEventError({ message: String(error) })`, cause dropped, takes raw ctx.
  **R7** `:123` duplicate, misnamed span (fact 8). `:153` `'dshx-effect setup'` also off-convention.
  **R10** OK-ish: runs live only here — but because there is no tool/hook/fork edge, 17 plugin sites run effects themselves.
  Casts: `:53,:114,:117,:127,:140,:174`.

**TARGET DESIGN (U1+U5 foundation)** — modelled on opencode's scoped-registration plugin (`OC/plugin/src/effect/plugin.ts:62-68`, `registration.ts:12-17` registrations are `Effect<Registration, never, Scope.Scope>`; `OC/plugin/src/promise/adapter.ts:79-81,244-253` captures `Effect.context<R>()` and edges with `Effect.runPromiseWith(context)` — no registry).

Services (all `Context.Service` classes with effectful `make` + `static layer`):

| Service                                  | Shape                                                                                                                                     | Depends on                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `HostContext`                            | `{ ctx: CordisContext; config: unknown; packageId: string; get<K>(name): Effect<Context[K], HostServiceMissing> }`                        | provided once by `DshxPlugin.make` edge (the only `ctx.get` site)                     |
| `PluginScope`                            | the plugin-lifetime `Scope` (re-export `Scope.Scope` provided at root) + `addDisposer(fn)` bridging Cordis disposers                      | HostContext                                                                           |
| `HostTracer`                             | `Layer<never>` = `Layer.succeed(Tracer.Tracer, dshxTracer)` provided _under_ everything                                                   | —                                                                                     |
| `ApiServer`                              | `serve(contract, handlers): Effect<void, never, Scope \| R>` — registers via Cordis, unregisters on scope close                           | HostContext                                                                           |
| `AgentTools`                             | `register(tool: EffectTool<R>): Effect<void, never, Scope \| R>`                                                                          | HostContext                                                                           |
| `PluginStorage`                          | `get/set/delete/list` + `changes(prefix): Stream`                                                                                         | HostContext (`Layer.effect`, opens domain inside `make`)                              |
| `SecretValues`                           | `resolve(input): Effect<string, SecretCatalogUnavailable \| SecretResolutionFailed>` (absence is a per-call failure, not a layer failure) | HostContext; **replace** with credential-port's `SecretReferenceResolver` (one owner) |
| `HostSubprocess` → `ChildProcessSpawner` | standard `effect/process` `ChildProcessSpawner` (`E4/process/ChildProcessSpawner.ts:237-276`) backed by `ctx.subprocess`                  | HostContext                                                                           |
| `HostApis`                               | `client(contract, callerPackageId?): EffectApiClient`                                                                                     | HostContext                                                                           |
| `Communication`                          | native Effect service (generated from `CommunicationClient` via one generic lifter) + `inbox: Stream`                                     | HostContext                                                                           |
| `Settings.Tag<V>(namespace)`             | `{ get: Effect<V>; changes: Stream<V>; update(patch, rev?): Effect<void, SettingsConflict>; ref: SubscriptionRef<V> }`                    | HostContext                                                                           |

Layer graph:

```
           DshxPlugin.make({ layer: AppLayer, … })          (Cordis edge: setup(ctx, config))
                         │ provides
   ┌─────────────────────┴───────────────────────┐
   │ HostContextLive(ctx, config)  +  HostTracer │   ← only place ctx.get / Cordis ctx enters
   └───────┬───────────────┬───────────────┬─────┘
   PluginStorage.layer  ChildProcessSpawner.layer(DSH)  Settings.layer(ns) … HostApis.layer
           └───────────────┴──────┬────────┘
                    AppLayer (plugin domain services, Layer.effect + yield*)
                                  │
                ApiServer.serve / AgentTools.register  (scoped registrations inside `main`)
```

Cordis edge (the only Promise code):

```ts
export const make = <ROut, E>(definition: {
  readonly name: string
  readonly layer: Layer.Layer<ROut, E, HostContext | Scope.Scope> // requires HostContext, never raw ctx
  readonly main?: Effect.Effect<void, never, ROut | HostContext | Scope.Scope>
  readonly apis?: ReadonlyArray<ApiBinding<ROut>>
  readonly tools?: ReadonlyArray<ToolBinding<ROut>>
}) =>
  definePlugin({
    name: definition.name,
    setup: async api => {
      const scope = Scope.makeUnsafe()
      const base = Layer.mergeAll(HostContext.layer(api), HostTracer.layer)
      const services = await Effect.runPromise(
        Layer.buildWithScope(Layer.provideMerge(definition.layer, base), scope).pipe(
          Effect.withSpan('plugin activate', { attributes: { 'dshx.plugin.package': api.packageId } }),
        ),
      ) // failure: Scope.close(scope, exit) then rethrow Cause as PluginActivationError (cause kept)
      const run = Effect.runPromiseExitWith(services)
      for (const binding of definition.apis ?? []) binding.mount(api, run) // Promise handlers, registered once
      for (const binding of definition.tools ?? []) binding.mount(api, run)
      if (definition.main) Effect.runForkWith(services)(Effect.forkIn(definition.main, scope))
      api.raw.ctx.effect(() => () => Effect.runPromise(Scope.close(scope, Exit.void)))
    },
  })
```

(`Effect.runPromiseExitWith` `E4/Effect.ts:9530`, `runForkWith` :9264, `Effect.context` :6050, `Scope.makeUnsafe` `E4/Scope.ts:282` — all verified in 4.1.0.) No registry: the handler closure holds `services`.

Error taxonomy (wire mapping by annotation, precedent: HttpApi's `httpApiStatus` augmentation `E4/http-api/HttpApiSchema.ts:29-36`, used as `Schema.Error(...)(fields, { httpApiStatus: 400 })` in `E4/http-api/HttpApiError.ts:49-53`, read via `SchemaAST.resolveAt` `E4/SchemaAST.ts:5160`):

```ts
declare module 'effect/Schema' {
  namespace Annotations {
    interface Augment {
      readonly dshxWireCode?: string | undefined
    }
  }
}
class NoteNotFound extends Schema.TaggedError<NoteNotFound>()('NoteNotFound', { id: Schema.String }, { dshxWireCode: 'note-not-found' }) {}
```

`toWire(cause)`: `Cause.hasInterruptsOnly` → `aborted`; `Cause.findError` → if its constructor is a Schema class with `dshxWireCode` → `{ code, message, details: encode(error) }`; any other `Fail` or `Die` → `internal` + `Cause.pretty` logged on Host (never sent). `method({ …, errors: [NoteNotFound] })` makes client failures decode `details` back into `NoteNotFound` (the wire already has an unused `details: {}` field, `host-runtime.ts:108-112`).
Typed handler signature:

```ts
type EffectHandler<M, R> = (input: ApiHostInput<M>, call: ApiCall) => Effect.Effect<ApiHostOutput<M>, ApiDeclaredErrors<M>, R>
// ApiCall = Context.Service with { caller, peer } — signal is replaced by fiber interruption.
```

Deleted: `pluginRuntimes` WeakMap, `HostOptions` variadic trick, `DshxEffect.host`/`setup`/`plugin().hostApi` trio (one `make` + `Api.bind`), `taggedFailure`/`remoteCode` duck typing, `registerEffectApiSchemaConverter`, `dshx-effect …` span.

Before/after (most important change):

```ts
// before (ai-accounts/src/host.ts:110-141)
const accountHostEffect = DshxEffect.plugin({ layer: Layer.empty, setup: ctx => Effect.asVoid(Effect.forkScoped(Effect.repeat(Effect.sync(() => refreshStalePricing.get(ctx)?.()), Schedule.spaced(…)))) })
export default definePlugin({ setup: api => { let release; ctx.effect(() => () => { void release?.() }); void accountHostEffect.setup(ctx, undefined).then(r => { release = r }, …) … } })
// after
export default DshxPlugin.make({
  name: 'llm-ai-accounts',
  layer: AccountsLive,                                  // Layer.effect(Accounts, make) — yield* HostContext/PluginStorage inside
  main: Accounts.use(accounts => accounts.refreshStalePricing.pipe(Effect.repeat(Schedule.spaced('30 minutes')))),
  apis: [Api.bind(accountsApi, AccountsHandlers)],      // AccountsHandlers: { [method]: Effect.fn('accounts list')(function* (input) { … }) }
  tools: [Tool.fromApi(accountsApi, 'list')],
})
```

### U2 — `DX/src/effect/services.ts`

- R1/R2: every `static layer(raw)` takes the Promise object or raw `CordisContext` (`:36,56,78,115,148,183`) — dependency threading, not `yield*`. `PluginStorage.layer` performs `PluginStorageModel.open(ctx, ns)` **when `layer()` is called** (`:37`), outside any Effect, i.e. a side effect at module/composition time wrapped by `Layer.succeed` (`:38`).
- R4: `EffectHostServiceError` (`:20-23`) has only `service`+`operation`; all 15 catch sites are `catch: () => failed(...)` (`:41-44,61,83,85,87,89,97,99,153-161,186`) — cause **deliberately** dropped; the test pins this (`DX/tests/effect-services.spec.ts:227-229` "not.toHaveProperty('cause')"). Redaction should be done by not _logging_ values, not by discarding the cause (secret values never enter the error since `resolve` returns them, not throws them).
- `SecretValues.layer(undefined)` → `Layer.effect(SecretValues, Effect.fail(...))` (`:57`): an optional dependency fails the whole plugin runtime build. Overlaps credential-port's `SecretReferenceResolverService` (two services for one port).
- Subprocess (`:78-104`): finalizer uses `Effect.orDie` (`:89,:99`) → a reaping failure becomes a defect in scope close; `AbortSignal.any` plumbing (`:96`) instead of interruption. DSH subprocess **does** need wrapping: it scrubs ambient credentials/`DSH_*` env, owns process-range termination, and may execute remotely (dsh-subprocess README lines 12, 84, 149). But wrap it _as the standard spawner_ so plugins use `ChildProcess.make(...)` (`effect/process`, note: 4.1 path is `effect/process`, not `effect/unstable/process` — `effect/package.json` exports `"./process"`): 20 plugin files import `node:child_process`, 11 use `ctx.subprocess`, 0 use `effect/process`.
- Communication (`:125-165`): 9 hand-written lifts typed with `Awaited<ReturnType<…>>`; `principal` copied eagerly.
- SettingsRead (`:167-191`): a fresh `Context.Service` class per namespace call (`:179`) — two `make('x')` calls yield two _different_ tags (identity bug if called in two modules); only sync `get` wrapped in `Effect.try`; `SettingsScope.watch/update/replace` exist (`DX/src/settings/protocol-2.ts:11-14`) but aren't exposed — no change stream, no writes.

**Target**: services listed in U1 table, each `Layer.effect(X, make)` where `make` does `const host = yield* HostContext`. Communication: one generic `liftPromiseService<S>(name, client, map)` _or_ better, Effect-native implementation over the bridge. Settings (t3code precedent `~/.references/t3code/apps/server/src/serverSettings.ts:216-228,288-290` — `streamChanges: Stream`, `subscribeChanges`, `layerTest(overrides)`):

```ts
export const Settings = <V extends object>(namespace: string) => SettingsTags.get(namespace) // memoized tag
class SettingsService<V> {
  get: Effect<V>
  changes: Stream<V>
  update(patch: Partial<V>, revision?: number): Effect<void, SettingsConflict | SettingsWriteFailed>
}
// layer: const scope = (yield* HostContext).settings(namespace); changes = Stream.callback(q => Effect.acquireRelease(Effect.sync(() => scope.watch(v => Queue.offerUnsafe(q, v))), Effect.sync))
```

`ChildProcessSpawner` backed by DSH:

```ts
export const DshChildProcessSpawner = Layer.effect(ChildProcessSpawner, Effect.gen(function* () {
  const subprocess = yield* (yield* HostContext).get('subprocess')
  return ChildProcessSpawner.make(command => Effect.acquireRelease(
    Effect.try({ try: () => subprocess.spawn(toSpec(command)), catch: cause => PlatformError.systemError({ module: 'ChildProcess', method: 'spawn', cause }) }),
    handle => Effect.promise(() => (handle.terminate(), handle.waitForExit())).pipe(Effect.ignore),
  ).pipe(Effect.map(handle => ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(-1),                       // DSH handle exposes no pid (types.d.ts SubprocessHandle) — document
    exitCode: Effect.promise(() => handle.done).pipe(Effect.map(o => ChildProcessSpawner.ExitCode(o.exitCode ?? 128))),
    stdout: NodeStream.fromReadable(() => handle.stdout!), stderr: …, stdin: NodeSink.fromWritable(() => handle.stdin!),
    kill: () => Effect.promise(() => (handle.terminate(), handle.waitForExit())), isRunning: …,
  }))))
}))
```

(`ChildProcessSpawner.make` `E4/process/ChildProcessSpawner.ts:237`, `makeHandle` :226, handle shape :86-93. `NodeStream.fromReadable` is in `@effect/platform-node-shared` (`effect-4.1.0/packages/platform/node-shared/src/NodeStream.ts:59`) — pin it at 4.1.0 or use `Stream.fromAsyncIterable(handle.stdout, …)` to avoid the dep. `Layer.buildWithScope` `E4/Layer.ts:781`, `Effect.forkIn` `E4/Effect.ts:8979`, annotation `Augment` `E4/Schema.ts:18807`.) Gap to record: `pid`, per-signal `kill` and `toSpec` env-merge semantics differ from Node; terminal (`spawnTerminal`) stays a DSH-specific `HostTerminal` service.

### U3 — `DX/src/effect/tracer.ts`

- R7/R1: reimplements `Span` by delegating to a `NativeSpan` (`:29-59`) — ids diverge (fact 6), `event` (`:53-55`) and `addLinks` (`:56-58`) never reach dshx, `end(endTime)` ignored (`:44-47`), interruption → error (`:46`).
- Allocates `NativeSpan` + WeakMap entry even when dshx export is disabled (`DX/src/tracing/tracer.ts:177` returns `NOOP_SPAN`), and `options.sampled` is ignored.
- `:66-70` per-primitive `runWithParent` → `storage.run` (fact 10). Add the `getStore() === parent` guard (−30% of overhead measured) and skip when export disabled.
- `provideDshxTracer` (`:75`) exists only for the runtime-less `DshxEffect.host` path.

**Target**: `class DshxEffectSpan implements Tracer.Span` owning a `RecordingSpan` directly: `spanId/traceId` = the exported ids; `parent` = real Effect parent; `event()` → new `RecordingSpan.addEvent` (+ OTLP exporter `events`, bounded); `end(endTime, exit)` → `Exit.isFailure && !Cause.hasInterruptsOnly` → `recordFailure(Cause.findError…)`, interrupt → status `unset` + `dshx.interrupted=true`; `sampled=false` + no-op span when `!tracer.enabled`. Context hook: `if (parent === undefined || storage.getStore() === parent) return evaluate(fiber)`. Optionally provide `Tracer.TracerEnabled=false` when export off so Effect skips span creation entirely.

### U4 — `DX/src/effect/client.ts`

- `:15-16,32` `Schema.declare` + `Schema.decodeUnknownSync` just to assert the method is a function; a throw here is classified as transport.
- `:44` any non-`ApiError` → `ApiCallError{ kind:'transport', retryable:true, apiId:'' }`: a bug in the Promise client becomes a retryable failure. Should be `Effect.die`.
- `:6-13` one class for 5 kinds; `aborted` is a failure, not interruption.
- `:46` filters `'safe'` by string; `:48` cast.
  **Target**: build from `contract.methods` keys (not runtime object scan); `Effect.callback`/`tryPromise` with `signal`; errors `ApiTransportError | ApiUnavailableError | ApiContractError | ApiRemoteError<DeclaredErrors>`; abort → `Effect.interrupt`; declared errors decoded from `details` into their classes. `Effect.fn('<api> <method>')` client span with `rpc.*` attributes only.

### U5 — API schema adapter path

- `DX/src/api/schema.ts:13-41` global converter + cache poisoning + 5 casts (fact 4). Fix: in `resolveApiSchema`, `Schema.isSchema(s)` → `Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(s))` directly (both in `E4/Schema.ts:1397,1418`); delete `registerEffectApiSchemaConverter` and the side-effect import contract.
- `DX/src/effect/index.ts:44-59` `omitDefaultAdditionalProperties` mutates a `structuredClone` with a cast; acceptable but belongs in `json-schema.ts` projection, not the adapter.
- `DX/src/api/define.ts:95-101` swallowing `try/catch` rethrows without `cause` (Promise code; minor).
- `DX/src/api/common.ts:22-33` `PluginApiError` with `code`; `host-runtime.ts:108-112` mapping. Effect path should produce `PluginApiError` only from annotated errors and fill `details`.
- `DX/src/host/plugin-storage.ts:32` `recordSchema = { parse: … decodeUnknownSync }` wrapper restates a zod-shaped API over Effect Schema; `:46-57` process-global `globalThis` registry keyed by Cordis root (justified by per-plugin dshx copies; keep, but behind `PluginStorage.layer`).
- `DX/tests/host-tool-schema-snapshot.spec.ts:10,44-49,241-253` hides 4 changed tools from equality instead of regenerating the fixture from source: the Effect deltas are excluded, not pinned.

### U6 — tests (`DX/tests/effect*.spec.ts`)

- 1 `effectIt.effect` (`effect.spec.ts:184-200`) that wraps `Effect.promise(async () => { … Effect.runPromise … })`; zero `it.layer`; everything else `async` + `Effect.runPromise`.
- Missing: defect with `_tag` not leaking (would currently fail), interrupt → `aborted` (only checks rejection kind, `:130-156`), Effect span id == exported id (would fail), layer-construction span exported (would fail), two plugins on one ctx, schema JSON without the side-effect import (would fail).
- `effect-services.spec.ts:184-219` fake `SubprocessHandle` (mock) instead of a real `ctx.subprocess`; `:17` imports credential-port by relative path across packages; `:227-229` asserts cause absence.
  **Target**: `@effect/vitest` `layer(DshxTest.layer({ packageId }))` that boots `createTestHost()` inside `Layer.effect` (acquireRelease dispose) and provides `HostContext` + real storage/subprocess; every service ships `layerTest` (t3code precedent above); regression tests for facts 5-8.

### U7 — docs + scaffold

- `tooling/dshx/docs/sdk/effect.md:13` "defects remain internal" — false (fact 5). `:10` "No process-global runtime" vs module WeakMap. `:56` documents the import-order hazard as a usage rule. `:80` "named Host service adapters pending" while `services.ts` ships unused.
- `docs/observability.md:123` claims full parentage; omits duplicate span and id mismatch.
- Scaffold `tooling/dshx/packages/create-dshx/src/templates.ts:451-475`: `DshxEffect.plugin({ layer: Layer.empty, setup: () => Effect.void })` then serves via `DshxEffect.host` — the plugin runtime is unused; no service, no TaggedError, no test; `:512` peer `effect: '^4.1.0'` vs exact pin decision. `DX/src/scaffold/presets.ts:203-241` api preset: side-effect import + `async` Promise handler.

### U8 — lint

- `.oxlintrc.json` (rules block) + `tooling/antislop/effect/project-oxlint.config.json:12-18`: only `no-domain-effect-run`, `domainPaths: ['…/src/effect']`, `excludePaths: [index.ts, tracer.ts]` → applies to `services.ts`/`client.ts`, which never run effects. Disabled upstream: `no-effect-context-reprovide`, `no-catch-if-tagged-error`, `no-silent-error-swallow`, `no-service-flat-map-facade`, `no-fallible-database-promise`, `no-untyped-readable-stream-error`, `no-sequential-effect-yield-in-loop` (`tooling/antislop/effect/oxlint/index.mjs:91-257`). They pass today except reprovide (1 hit), so enabling them all is free.
- Repo rules (`tooling/antislop/effect/repo-rules/index.mjs:268-343`) are reasonable but miss: (a) `Effect.try/tryPromise` whose `catch` ignores its parameter (≥20 hits in units reviewed); (b) `layer: Layer.empty` in `DshxEffect.plugin`; (c) a Layer factory/`static layer(x)` taking `CordisContext`; (d) `void <expr>.then(` in files importing `effect`; (e) `new WeakMap<Context` in plugin hosts; (f) span-name literal format for `Effect.fn`/`withSpan` (`/^[a-z][a-z0-9-]* [a-z]+/`).
- `no-domain-effect-run` should instead target `plugins/@dshfiles/*/src/**` excluding the edge module (`host.ts`), i.e. once the edge exists, every other run is a finding (54 today).

### U9 — shared ports

- **credential-port** `src/effect.ts`: good 3-error taxonomy (`:40-46`) but fieldless and causeless (`:73`); `static layer(values)` raw param (`:62`); the Effect service wraps the Promise `SecretReferenceResolver` (`:72`) — logic stays Promise. `*SchemaEffect` names (`:10-38`) are dual-stack residue. Duplicates dshx `SecretValues`.
- **vcs-provider-port**: `src/index.ts:1-2` side-effect import (fact 4); `:51` module `Map` cache of contracts; `:75-89` `Promise.all` fan-out; `src/effect.ts:24` raw `CordisContext`; `:30-39` constant messages, dropped cause; `resolve` returns a Promise `ApiClient` (`:21`) not `EffectApiClient`. Span names `vcs providers list` / `vcs provider resolve` are good.
- **session-source-port** `src/index.ts`: `SessionSources` (`:69-95`) is a pure sync facade over the Promise registry; `wirePayload` (`:140-141`) is a bespoke `Schema.declare` re-validating with `decodeUnknownOption` — discards the decoded value and every issue (failures read "Expected <declaration>"), i.e. restates Schema; `SessionSourcePayload` class of statics with `decodeUnknownSync` throws (`:181-238`). The `MirroredSessionSource` interface (`:31-49`) must stay Promise/AsyncIterable (Cordis port consumed by native-fork session-controller) — correct as a port.

**Target (ports)**: a port package exports (1) the Cordis Promise interface (unchanged), (2) Effect Schema wire schemas as the single source (types derived with `typeof X.Type`; for passthrough keep `StructWithRest` and decode with `Schema.decodeUnknownEffect` → typed `SessionPayloadError{ issue }`), (3) one `Context.Service` whose `layer` is `Layer.effect` reading the port through `HostContext.get('sessionSources')` and whose `fromEffect(service): MirroredSessionSource` adapter turns an Effect implementation into the Promise port (so providers like multi-host implement in Effect). credential-port: make grammar + resolution Effect-native; derive the Promise `SecretReferenceResolver` via `Effect.runPromise` in one adapter; drop dshx `SecretValues`. vcs-provider-port: `owners` and `resolve` as `Effect.forEach(owners, detect, { concurrency: 'unbounded' })` over `HostApis.client`, errors carry `cause`; remove side-effect import once U5 lands.

## 3. Cross-cutting patterns (fix once)

1. **`Effect.tryPromise({ try, catch: () => new X() })`** — cause dropped; ≥20 sites in these units, systemic in plugins. Fix: errors get `cause: Schema.Defect` (+ bounded identity fields); add lint (U8 a).
2. **`static layer(rawDep)` + `Layer.succeed(X, X.of({ …tryPromise }))`** — Promise logic behind a typed shell, deps threaded as params. Fix: `HostContext` + `Layer.effect` + `yield*`.
3. **Edge runs scattered** (17 `runPromise` sites, 4 `Layer.empty`, `void .then`, `Effect.context` reprovide). Fix: one `DshxPlugin.make` edge with `apis`/`tools`/`main` bindings; `no-domain-effect-run` everywhere else.
4. **Module-global registries** (`pluginRuntimes`, schema converter, `contracts` Map, `refreshStalePricing` WeakMap). Fix: state lives in the plugin `Layer`; closures over `services` replace lookups.
5. **Class-of-statics namespaces** (`DshxEffect`, `ApiDefinitionModel`, `VcsProviders`, `SessionSourcePayload`). Fix: `export * as Name from`.
6. **Span naming/duplication** (`dshx-effect …`, `${id}/${endpoint}`). Fix: one server span per API unit named `<api> <method>` in host-runtime; Effect handlers get _no_ extra span (the dispatch span is the parent via the bridge); `Effect.fn('<subject> <verb>')` only on inner work units; lint the literal.
7. **Duck-typed `_tag` error mapping**. Fix: annotation opt-in (`dshxWireCode`) + `Cause`-aware mapping.

## 4. Ordered migration steps (Promise API untouched throughout)

| #   | Step                                                                                                                                                                                                                             | Depends | Verification                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | U5: inline Effect→Standard JSON Schema conversion in `schema.ts`; delete converter registration; keep `@dshfiles/dshx/effect` import harmless                                                                                    | —       | new test: Effect-schema tool JSON without importing `effect/index`; regenerate `host-tool-schema-snapshot` fixture from source and drop the exclusion set; `pnpm --dir tooling/dshx/packages/dshx test -- --run tests/host-tool-schema-snapshot.spec.ts` |
| 2   | Wire error mapping: `dshxWireCode` annotation, `toWire(cause)` with interrupt→aborted, defect→internal, unannotated Fail→internal (compat flag: unannotated TaggedError still mapped for one release, warn-logged)               | —       | regression tests: `Effect.die(new SchemaError(...))` → `internal`; interrupt → `aborted`; annotated → code + decoded `details`                                                                                                                           |
| 3   | Tracer: `DshxEffectSpan` (exported ids, events, links, interrupt status), `provideMerge` for layer build, ALS guard                                                                                                              | —       | `recordSpans()` asserts `Effect.currentSpan.spanId === recorded.spanId`, layer-build span exported, event present; rerun bench (target ≤ +90 ns/op)                                                                                                      |
| 4   | Remove duplicate `dshx-effect` span; rename dispatch span `<api> <method>` (attributes unchanged)                                                                                                                                | 3       | span-count test per API call = 1 server span; check `traces` plugin boards still group by `rpc.method`                                                                                                                                                   |
| 5   | Foundation core: `HostContext`, `PluginScope`, `DshxPlugin.make({ layer, main, apis, tools })`, `Api.bind`, `Tool.fromApi`/`Tool.make` edges via `Effect.runPromiseExitWith(services)`                                           | 2,3     | `@effect/vitest` `it.layer(DshxTest.layer)`; mount/unmount releases scope; two plugins on one ctx; tool execute interrupts on abort                                                                                                                      |
| 6   | Keep `DshxEffect.plugin/host` as thin deprecated shims over step 5 (no WeakMap: `plugin()` returns bindings closed over its own services)                                                                                        | 5       | existing `tests/effect.spec.ts` stays green unchanged                                                                                                                                                                                                    |
| 7   | Services as `Layer.effect` over `HostContext`: PluginStorage(+changes), Settings(get/changes/update), HostApis, Communication, DshChildProcessSpawner, HostTerminal; each with `layerTest`; errors with cause                    | 5       | real-implementation tests (scratch storage domain, real `ctx.subprocess` spawning `node -e`), no fakes                                                                                                                                                   |
| 8   | Ports: credential-port Effect-native + single `SecretReferenceResolver`; vcs-provider-port Effect `resolve`; session-source-port schema-first decoders + `fromEffect` adapter                                                    | 1,5,7   | port unit tests via `it.effect`; `pnpm check:cycles`                                                                                                                                                                                                     |
| 9   | Lint: enable all 8 upstream rules; re-scope `no-domain-effect-run` to plugin sources minus edge modules (ratchet baseline 54); add repo rules a–f with fixtures                                                                  | 5       | `pnpm check:effect-antislop`; ratchet counts recorded                                                                                                                                                                                                    |
| 10  | Docs/scaffold: rewrite `effect.md` (edge, errors, services, testing), `observability.md` Effect section; `effect-host` template = `DshxPlugin.make` + one service + one annotated error + `it.layer` test; exact `effect: 4.1.0` | 5,7     | `create-dshx` test generates, builds and runs the template test                                                                                                                                                                                          |
| 11  | Plugin migrations (other units) onto `DshxPlugin.make`; delete shims when callers reach 0                                                                                                                                        | 6–9     | per-plugin `dsh-plugin-verify`; grep `DshxEffect.plugin` = 0                                                                                                                                                                                             |

Unverified: did not build/run the dshx test suite (thread workspace has no `node_modules`); the bench used the canonical checkout's `effect@4.1.0`. Statements "would fail" in U6 are inferred from source, not executed.
