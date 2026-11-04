# Effect 4.1 patterns cookbook — target standard for dshfiles

Grounded in real code. Abbreviations for citation roots:

- `EF` = `~/.references/effect-4.1.0` (effect **4.1.0**, `packages/effect/package.json:4`)
- `OC` = `~/.references/opencode` (catalog `effect: 4.1.0`, `package.json:83`)
- `T3` = `~/.references/t3code` (catalog `effect: 4.0.2`, `pnpm-workspace.yaml:56` — one minor behind; APIs used here exist in 4.1)

All APIs below were checked against `EF/packages/effect/src`.

---

## 0. Version facts that invalidate common assumptions

| Fact                                                                                                                                                                                                                   | Evidence                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **No `effect/unstable/*` paths in 4.1.** Process, HTTP, SQL, RPC, AI, CLI live at `effect/process`, `effect/http`, `effect/sql`, `effect/rpc`, `effect/ai`, `effect/cli`; their docs are tagged `@stability unstable`. | `EF/MIGRATION.md:42-44`; `EF/packages/effect/package.json:43,48` (`"./http"`, `"./process"`); no `src/unstable` dir. Both OC and T3 import `effect/process`, `effect/http` (e.g. `T3/apps/server/src/processRunner.ts:10-11`). |
| `~/.references/effect` is **4.0.0-rc.111** with an `unstable` folder — stale. Use `effect-4.1.0`. In one week migration threads still read the RC 170 times against 65 for 4.1.0.                                      | `~/.references/effect/packages/effect/package.json:4`                                                                                                                                                                          |
| No `Layer.scoped`: `Layer.effect` already strips `Scope` (resources acquired in `make` live as long as the layer).                                                                                                     | `EF/packages/effect/src/Layer.ts:1039-1046` (`Layer<I, E, Exclude<R, Scope.Scope>>`); no `export const scoped` in Layer.ts                                                                                                     |
| No `Effect.forkDaemon` → `Effect.forkDetach`; no `catchAll`/`catchAllCause` → `Effect.catch` / `Effect.catchCause`.                                                                                                    | `EF/.../Effect.ts:9069` (forkDetach), grep shows 0 `forkDaemon`, `catchAll`                                                                                                                                                    |
| `Semaphore.make` (Effect) and `Semaphore.makeUnsafe` (sync) both exist.                                                                                                                                                | `EF/.../Semaphore.ts:234,424`                                                                                                                                                                                                  |
| `ChildProcessSpawner.spawn` returns a handle **requiring `Scope`**; closing the scope terminates the process (group).                                                                                                  | `EF/.../process/ChildProcessSpawner.ts:282`; `EF/packages/platform/node-shared/src/NodeChildProcessSpawner.ts:677-695`                                                                                                         |

---

## 1. Defining a service

### Canonical (Effect docs)

```ts
export class Database extends Context.Service<Database, {
  query(sql: string): Effect.Effect<Array<unknown>, DatabaseError>
}>()("myapp/db/Database") {
  static readonly layer = Layer.effect(Database, Effect.gen(function*() {
    const query = Effect.fn("Database.query")(function*(sql: string) { ... })
    return Database.of({ query })
  }))
}
export type DatabaseService = Database["Service"]
```

`EF/LLMS.md:128-172`. Key string = package + subdirectory path (`LLMS.md:142-144`). Interface inline as 2nd type param; `Foo.of({...})` to construct; `Foo["Service"]` for the type.

Variants in the same docs:

- `layerNoDeps` (requirements open) + `layer = layerNoDeps.pipe(Layer.provide(Dep.layer))` + `layerWith<Dep>` via `provideMerge` — `EF/ai-docs/src/01_effect/03_services/20_layer-composition.ts:32-69`; `05_resources/10_acquire-release.ts:80-104`.
- `layerTest` built over a test-ref service — `EF/ai-docs/src/09_testing/20_layer-tests.ts:16-49,84-89`.
- `layerInMemory` / `layerRemote(url)` + `layer = Layer.unwrap(config-driven choice)` — `20_layer-unwrap.ts:16-65`.
- `Context.Reference<T>(key, { defaultValue })` for config/flags with a default (no layer required) — `03_services/10_reference.ts:8-10`; used by T3 for host process facts (`T3/packages/shared/src/HostProcess.ts:7-72`, e.g. `HomeDirectory` consumed at `T3/apps/server/src/workspace/WorkspacePaths.ts:157`).
- Accessor: `Foo.use((foo) => foo.method(...))` — `EF/ai-docs/src/04_integration/10_managed-runtime.ts:75`; `OC/packages/core/src/plugin/service.ts:42` (`export const awaitActivation = Service.use((plugins) => plugins.awaitActivation)`).

### opencode variant (module-as-namespace)

```ts
export * as KV from "./kv.js"                // self-export namespace, line 1
export interface Interface { readonly get: (key: string) => Effect.Effect<Value | undefined> ... }
export class Service extends Context.Service<Service, Interface>()("@opencode/KV") {}
const layer = Layer.effect(Service, Effect.gen(function* () {
  const db = (yield* Database.Service).db
  return Service.of({ get: Effect.fn("KV.get")(function* (key) { ... }) })
}))
```

`OC/packages/core/src/kv.ts:1,27-34,36-83`. Consumers write `KV.Service`, `KV.Interface`. Tag split from layer when needed to break import cycles: `OC/packages/core/src/plugin/service.ts:3-4,35`.

### t3code variant (class tag, module-level `make` + `layer`)

```ts
export class WorkspacePaths extends Context.Service<WorkspacePaths, { readonly normalizeWorkspaceRoot: (...) => Effect.Effect<...> }>()("t3/workspace/WorkspacePaths") {}
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  ...
  return WorkspacePaths.of({ normalizeWorkspaceRoot, resolveRelativePathWithinRoot })
})
export const layer = Layer.effect(WorkspacePaths, make)
```

`T3/apps/server/src/workspace/WorkspacePaths.ts:93-120,126-222`. Rules: one module per service in order imports → errors/schemas → tag → `make` → `layer`; no standalone `FooShape`, use `Foo["Service"]`; deps from environment (`yield*`), never params to `make`; no `make = Effect.succeed(...)` just to force `Layer.effect` (`T3/docs/internals/effect-services.md:38-91`).

### Recommendation for dshfiles

Use the **Effect-docs class form with statics** (`EF/LLMS.md:139-164`) because each plugin is small and imports one class:

```ts
export class JjRepository extends Context.Service<JjRepository, {
  readonly status: (input: { readonly path: string }) => Effect.Effect<JjStatus, JjCommandError>
}>()("@dshfiles/jj-integration/JjRepository") {
  static readonly layer = Layer.effect(this, make)       // make is a private module const
  static readonly layerTest = ...                         // only when a real external dep must be faked
}
```

- Key = `@dshfiles/<plugin>/<Service>`.
- Inline interface; `JjRepository["Service"]` when a type is needed.
- `make` = `Effect.gen` that `yield*`s every dependency; methods are `Effect.fn("JjRepository.status")`.
- Expose accessors only through `JjRepository.use(...)` at edges.
- Pick **one** import style repo-wide: `import { Context, Effect, Layer } from "effect"` (OC + LLMS style, matches current dshx code) and `import { ChildProcess } from "effect/process"`. T3's `import * as Effect from "effect/Effect"` is equally valid but OC forbids star imports (`OC/AGENTS.md:91-94`); do not mix.

**Anti-patterns replaced:** `FooShape` interfaces + `const makeFoo = (deps) => ...` factories; closures over `ctx`; `Layer.succeed(Foo, imperativeObject)` whose methods call runtime-backed APIs (`T3/docs/internals/effect-services.md:76-81`); nested yields `yield* (yield* Foo).bar()` (`OC/AGENTS.md:63`); helpers that return `Effect` without doing effectful work (`OC/AGENTS.md:148`); functions that only wrap `Effect.gen` (`EF/LLMS.md:60`).

---

## 2. Layer composition, root layer, external host handle

### Composition operators

- `Layer.provide` (hide dep), `Layer.provideMerge` (expose dep too), `Layer.mergeAll` (siblings) — `EF/ai-docs/src/01_effect/03_services/20_layer-composition.ts:53-69`.
- Real app graph built as named `layerX` consts composed bottom-up, ending in one `Layer.launch` — `T3/apps/server/src/server.ts:196-400` (e.g. `layerServerSettings = ServerSettings.layer.pipe(Layer.provide(ServerSecretStore.layer), Layer.provideMerge(SqlitePersistence.layerConfig))` :228-231), tail :1095-1125 (`export const runServer = Layer.launch(layerMakeServer)`). Platform layer at the bottom: `Layer.provideMerge(layerPlatformServices)` :1121 with `layerPlatformServices = NodeServices.layer` :304.
- `Layer.unwrap(Effect.gen(...))` when the layer choice depends on config/services — `20_layer-unwrap.ts:51-65`; `OC/packages/core/src/database/database.ts:67-81`; `T3/apps/server/src/observability/Observability.ts:18-102`.
- `Layer.effectDiscard(... Effect.forkScoped)` for background-only layers (no service) — `EF/ai-docs/src/01_effect/05_resources/20_layer-side-effects.ts:11-23`; `OC/packages/core/src/project.ts:524-534` (sweep).
- `Layer.suspend` to defer module-scope I/O — `OC/packages/util/src/observability.ts:54-59`.
- `Layer.catchCause(() => fallback)` / `Layer.orDie` for optional infra — `OC/packages/util/src/observability.ts:31-51`.

### Memoization

- Within one `Layer.build`, the same layer **value** is built once (reference identity). Define each layer once as a `const`/`static`; don't call a layer factory twice.
- Across several `ManagedRuntime`s: share a memo map — `export const appMemoMap = Layer.makeMemoMapUnsafe(); ManagedRuntime.make(layer, { memoMap: appMemoMap })` (`EF/ai-docs/src/04_integration/10_managed-runtime.ts:60-69`; `EF/.../Layer.ts:504`).
- Opt out with `Layer.fresh` (`Layer.ts:2207`).
- Keyed dynamic sub-graphs (per tenant/location): `LayerMap.make(key => layer, { idleTimeToLive })` over `RcMap`, built with the parent `memoMap` via `Layer.fromBuild((memoMap, scope) => Layer.buildWithMemoMap(...))` — `OC/packages/core/src/location-services.ts:14-59`; service exposing the map + `Layer.unwrap(Effect.map(Service, m => m.get(ref)))` — `OC/packages/core/src/location-service-map.ts:9-16`. Also `EF/ai-docs/src/01_effect/05_resources/30_layer-map.ts`.

### Injecting an external host handle once (Cordis `ctx`)

No reference uses Cordis, but both show the shape: **the host handle is a value placed in the context exactly once at the edge; every adapter service is a `Layer.effect` that reads it**.

- opencode builds a per-plugin host handle _from services_ in one `Effect.fn` (`OC/packages/core/src/plugin/host.ts:53-80`: `const app = yield* App.Metadata; const agents = yield* Agent.Service; ...`) and passes it to the plugin's `effect(host)` which runs in a forked per-plugin `Scope` (`OC/packages/core/src/plugin.ts:62-94`; plugin contract `OC/packages/plugin/src/effect/plugin.ts:62-68`: `effect: (context) => Effect.Effect<void, never, Scope.Scope>`).
- t3code puts host-process facts in `Context.Reference`s provided once (`T3/packages/shared/src/HostProcess.ts:7-72`) and lints direct `process.platform` reads (`T3/oxlint-plugin-t3code/rules/no-global-process-runtime.ts:21-36`).

Recommended dshfiles edge:

```ts
// dshx: the only place that knows Cordis
export class CordisContext extends Context.Service<CordisContext, Context>()("@dshfiles/dshx/CordisContext") {}

export class PluginStorage extends Context.Service<PluginStorage, {...}>()("@dshfiles/dshx/PluginStorage") {
  static readonly layer = Layer.effect(this, Effect.gen(function* () {
    const ctx = yield* CordisContext
    const storage = ctx.get("storage")                    // ctx.get exactly here, once
    return PluginStorage.of({ read: Effect.fn("PluginStorage.read")(function* (key) {
      return yield* Effect.tryPromise({ try: (signal) => storage.read(key, { signal }), catch: (cause) => new StorageReadError({ key, cause }) })
    }) })
  }))
}
const hostLayer = (ctx: Context) => Layer.mergeAll(PluginStorage.layer, Subprocess.layer, ...).pipe(Layer.provide(Layer.succeed(CordisContext, ctx)))
```

Then each plugin: `PluginLayer = Layer.mergeAll(DomainA.layer, DomainB.layer).pipe(Layer.provide(hostLayer(ctx)), Layer.provide(NodeServices.layer))`.

**Anti-patterns replaced:** `Layer.empty` plugins whose work happens in `Effect.sync(() => imperativeSetup(ctx))`; threading `ctx` through function params; `WeakMap<Context, Runtime>` registries (current `dshx/src/effect/index.ts:42`); manual wiring objects instead of `Layer.provide`.

---

## 3. Runtime boundaries

### Rules (T3)

`ManagedRuntime.make`, `runPromise`, `runPromiseExit` only at application/framework boundaries; never in domain services, repositories, or constructors; a named adapter may bridge to Promise but no Effect service depends on it; don't create a runtime per feature to hand out a shared resource — compose it once (`T3/docs/internals/effect-services.md:93-103`; mirrored in `T3/.macroscope/check-run-agents/effect-service-conventions.md:47-53`).

### ManagedRuntime per embedded host

```ts
const runtime = ManagedRuntime.make(rootLayer)
return yield* Effect.gen(function* () {
  const services = yield* runtime.contextEffect             // build eagerly, surface failures
  runtime.runFork(Context.get(services, SessionRestart.Service).resumeSuspendedSessions) // background owned by runtime
  ...
  return { runtime, fetch, close: transport.close }          // close → runtime.dispose
}).pipe(Effect.onError(() => runtime.disposeEffect))
```

`OC/packages/sdk/src/internal/host.ts:36-70`. API: `ManagedRuntime.ts:120-247` (`contextEffect`, `runPromise(effect, options?: RunOptions)`, `dispose`, `disposeEffect`). Shutdown: `void runtime.dispose()` on SIGINT/SIGTERM (`EF/ai-docs/src/04_integration/10_managed-runtime.ts:124-129`).

**For dshfiles:** one `ManagedRuntime` per plugin activation (the Cordis plugin instance _is_ the app boundary), built from the plugin root layer, held in the Cordis plugin closure (not a module/WeakMap), `await runtime.contextEffect` during Cordis `apply` so boot failures reject activation, and `ctx.on("dispose", () => runtime.dispose())` as the single disposer — no extra `ctx.effect` disposers next to Effect scopes. Share one `Layer.makeMemoMapUnsafe()` across plugins only if they share a resource layer (rare; otherwise per-plugin isolation is the point).

Process entrypoints (CLI tools under `tooling/`): `NodeRuntime.runMain` / `Layer.launch` (`OC/packages/cli/src/index.ts:124-166`; `T3/apps/server/src/server.ts:1125`; `EF/ai-docs/src/01_effect/06_running/*`).

### AbortSignal ↔ interruption

- Promise caller → Effect: `runtime.runPromise(effect, { signal })` interrupts the fiber when the signal aborts (`EF/.../Effect.ts:9186` `RunOptions.signal`; `ManagedRuntime.ts:193`). Used: `OC/packages/plugin/src/promise/adapter.ts:97` (`run(method(input), { signal: options?.signal })`), :258-264 (tool execute with `{ signal: context.signal }`).
- Effect → Promise callee: `Effect.tryPromise({ try: (signal) => api(input, { signal }), catch })` — signal aborts when the fiber is interrupted (`adapter.ts:131-146`, :674-676 `attempt`, :690-699).
- Run inside a captured context instead of a global runtime: `const run = Effect.runPromiseWith(yield* Effect.context<Scope.Scope>())` (`adapter.ts:80-81,244-253`; `Effect.ts:9448`).
- Stream → AsyncIterable for Promise consumers: `Stream.toAsyncIterableWith(stream, context)`, closed on signal abort and on plugin scope close via `Effect.addFinalizer` (`adapter.ts:47-77`).

### Promise facade for consumers that must stay Promise

opencode keeps one Effect plugin runtime and wraps Promise plugins: `fromPromise(plugin)` returns an Effect plugin whose setup/cleanup is `Effect.acquireRelease(Effect.promise(() => plugin.setup(ctx)), cleanup => Effect.promise(cleanup))` (`OC/packages/plugin/src/promise/adapter.ts:209-219,666-669`). Promise methods = `(input) => effect.pipe(Effect.runPromiseWith(runtime))` (:266-282). Registrations return `{ dispose: () => run(registration.dispose) }` (:248-251).

For dshfiles the direction is reversed (Promise host, Effect plugin) but the facade is the same file-shaped thing: **one** `toPromiseApi(runtime, handlers)` adapter in dshx mapping each Host API method to `(input, { signal }) => runtime.runPromise(handler(input), { signal })`, decoding input once with a hoisted `Schema.decodeUnknownEffect`.

**Anti-patterns replaced:** `void promise.then(...)`; manual `AbortController` → `Fiber.interrupt` glue; `runPromise` inside services; per-call `ManagedRuntime.make`.

---

## 4. Errors

### Taxonomy

- One `Schema.TaggedError` per failure kind, structured attributes, **fixed message built from attributes** (override `get message`), `cause: Schema.Defect()` when wrapping — `T3/apps/server/src/workspace/WorkspacePaths.ts:20-81` (5 classes + `Schema.Union` of them :83-90); `T3/apps/server/src/processRunner.ts:68-139` (`ProcessSpawnError`, `ProcessTimeoutError`, ... union `ProcessRunError`).
- Namespaced tags `"Session.NotFoundError"` — `OC/packages/core/src/session/error.ts:9-58`.
- Rules (`T3/docs/internals/effect-services.md:105-132`): message never derived from `cause`/`cause.message`; no `detail` copying cause; attributes bounded (no payloads, args, URLs, credentials); construct where failure happens, translate only in the transport; don't encode the same distinction as a tag _and_ a single-value `reason/phase` literal; no `(...a) => new E(a)` mapper helpers; `export const isFoo = Schema.is(Foo)`.
- Nested reasons: `AiError { reason: Union[RateLimitError, ...] }` with `Effect.catchReason`, `catchReasons`, `unwrapReason` — `EF/ai-docs/src/01_effect/04_errors/20_reason-errors.ts:11-63`.

### Cause preservation

```ts
yield *
  fileSystem
    .makeDirectory(root, { recursive: true })
    .pipe(Effect.mapError(cause => new WorkspaceRootCreateFailedError({ workspaceRoot, normalizedWorkspaceRoot, cause })))
```

`WorkspacePaths.ts:165-174`. Platform errors are inspected structurally (`cause.reason._tag === "NotFound"`) before wrapping (:135-149).

### Catching

- `Effect.catchTags({ ... })` at boundaries — T3 requires it even for one tag (`effect-services.md:130-132`; lint `T3/oxlint-plugin-t3code/rules/prefer-catch-tags.ts:10`). OC uses both `catchTag` and `catchTags` (`OC/packages/server/src/handlers/schedule.ts:26,37-43`). Pick `catchTags` for dshfiles (one style).
- `Effect.catch` handles whole channel; `catchIf` for structural predicates only.
- opencode lints manual `_tag` branching (`OC/script/oxlint/anti-slop/effect/rules/no-manual-effect-error-tag.ts`, `no-manual-tag-comparison.ts`, `no-manual-tagged-construction.ts`).

### Mapping to wire errors

Handler = decode → call one service method → map typed errors (`T3/docs/internals/effect-services.md:13-30`):

```ts
schedules.create(input).pipe(
  Effect.catchTags({
    'Schedule.InvalidError': error => Effect.fail(new InvalidRequestError({ message: error.message, kind: 'schedule' })),
    'Session.NotFoundError': error => Effect.fail(missingSession(error)),
  }),
)
```

`OC/packages/server/src/handlers/schedule.ts:32-44`; reusable mappers `persistent-pty.ts:258-275`. Domain → user-facing union translator: `OC/packages/core/src/session/to-session-error.ts:33-50`.

### Defects / `orDie` policy

- `Effect.orDie` for infrastructure that "cannot fail" in practice (DB writes into own SQLite): `OC/packages/core/src/kv.ts:47,55,58,76`, `bus.ts:31,48`, `database.ts:52`. 78 files in OC core use it.
- Invariant violations → `Effect.die(new XError(...))` (`OC/packages/core/src/bus.ts:74-78`; duplicate plugin id `plugin.ts:110`).
- Expected domain failures stay typed. `Layer.orDie` for optional infra layers (`OC/packages/util/src/observability.ts:33,46`).
- dshfiles policy: typed error for anything a user/agent can trigger or recover from (missing file, bad input, subprocess exit≠0, network); `orDie` only for own-storage corruption/programmer error; never `catch: () => new X()` without `cause`.

### Annotations

`Schema.TaggedError<Self>()(tag, fields, annotations?)` — `EF/.../Schema.ts:17792-17800`. `Schema.Defect(options?)` — `Schema.ts:9390`.

**Anti-patterns replaced:** single `EffectHostServiceError`; `message: String(error)`; try/catch inside `Effect.gen`; `Effect.mapError(() => new X())` dropping cause; one generic error wrapping a multi-step pipeline (`effect-services.md:117-120`).

---

## 5. Resources & background work

| Need                                   | Pattern                                                                                                              | Evidence                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Resource with cleanup inside a service | `yield* Effect.acquireRelease(acquire, release)` in `make`; lives for the layer                                      | `EF/ai-docs/src/01_effect/05_resources/10_acquire-release.ts:34-44`                                                     |
| Background loop owned by service       | `loop.pipe(Effect.forever / Effect.repeat(Schedule.spaced(d)), Effect.forkScoped)` inside `make`                     | `OC/packages/core/src/plugin.ts:194-248` (queue worker), `project.ts:528-531`, `workspace.ts:219`                       |
| Background-only layer                  | `Layer.effectDiscard(... Effect.forkScoped)`                                                                         | `EF/.../20_layer-side-effects.ts:11-23`                                                                                 |
| Child scopes per unit (plugin, job)    | `Scope.fork(parent)` → close with `Scope.close(scope, exit)`                                                         | `OC/packages/core/src/plugin.ts:22,63,147,257`                                                                          |
| Fork into a specific scope             | `Effect.forkIn(owner, { startImmediately: true })`                                                                   | `OC/packages/core/src/location-services.ts:50,104`                                                                      |
| Detached fiber (truly unowned)         | `Effect.forkDetach` (rare)                                                                                           | `OC/packages/core/src/database/v1-migration.bun.ts:772`                                                                 |
| Keyed fibers (watch per key)           | `FiberMap.make<string>()`                                                                                            | `OC/packages/core/src/config/plugin/skill.ts:33`                                                                        |
| Mutex                                  | `Semaphore.makeUnsafe(1)` / `yield* Semaphore.make(1)` + `.withPermit(eff)`                                          | `OC/packages/core/src/plugin.ts:26,117`; `database.ts:106`                                                              |
| Keyed mutex                            | `KeyedMutex.makeUnsafe<Key>()` over Semaphore with refcount cleanup                                                  | `OC/packages/core/src/effect/keyed-mutex.ts:20-45`                                                                      |
| Readiness gate                         | `Latch.make(true)` + `closeUnsafe/openUnsafe/await`                                                                  | `OC/packages/core/src/plugin.ts:27-39,265`                                                                              |
| Work queue                             | `Queue.unbounded<T>()` + `Queue.take` worker forked scoped                                                           | `OC/packages/core/src/plugin.ts:40,194-248`                                                                             |
| State with effectful updates           | `SynchronizedRef.make(new Map())` + `SynchronizedRef.update`                                                         | `OC/packages/core/src/job.ts:203-221` (durable job registry)                                                            |
| Observable state                       | `SubscriptionRef.make(init)` (`.changes` stream)                                                                     | `T3/apps/server/src/pullRequest/PullRequestService.ts:711`; `storageCleanup.ts:686`                                     |
| Fan-out events                         | `PubSub.bounded({ capacity, replay })` + `Effect.addFinalizer(() => PubSub.shutdown(p))` + `Stream.fromPubSub`       | `EF/ai-docs/src/01_effect/07_pubsub/10_pubsub.ts:23-47`                                                                 |
| Lookup cache                           | `Cache.make({ capacity, lookup, timeToLive })`; `Cache.invalidate`                                                   | `OC/packages/core/src/project.ts:385-389`; `pty/ticket.ts:58`; `T3/apps/server/src/serverSettings.ts:1107`              |
| Shared refcounted resource per key     | `RcMap.make({ lookup })` + `RcMap.get(map, key)` (scoped)                                                            | `OC/packages/core/src/filesystem/watcher.ts:91-123,136`                                                                 |
| Memoize one effect                     | `Effect.cached` / `Effect.cachedInvalidateWithTTL`                                                                   | `OC/packages/core/src/snapshot.ts:90`; `models-dev.ts:656`                                                              |
| One-shot signals between fibers        | `Deferred.make` / `Deferred.succeed` / `Deferred.await`                                                              | `T3/apps/server/src/server.ts:1066,1071-1082`                                                                           |
| File watcher                           | `fileSystem.watch(dir)` → `Stream` filtered; shared per path via `RcMap` + `PubSub`                                  | `T3/apps/server/src/serverSettings.ts:1114-1128`; `OC/.../filesystem/watcher.ts:91-140`; API `EF/.../FileSystem.ts:415` |
| Durable job queue                      | durable row + in-memory `SynchronizedRef` registry; scoped per process                                               | `OC/packages/core/src/job.ts:200-240`; prompt admission vs execution split `OC/AGENTS.md:199-200`                       |
| Retry/backoff                          | `Schedule.exponential("1 second").pipe(Schedule.modifyDelay(...cap 30s), Schedule.upTo({ duration: "10 minutes" }))` | `T3/apps/server/src/server.ts:1040-1045`                                                                                |
| Timeout                                | `Effect.timeoutOption(d)` → typed `ProcessTimeoutError`                                                              | `T3/apps/server/src/processRunner.ts:229-266`                                                                           |

Snippet — refcounted watcher per key (OC):

```ts
const watchers = yield* RcMap.make({ lookup: (key: Target) => Effect.gen(function* () {
  const pubsub = yield* Effect.acquireRelease(PubSub.unbounded<Update>(), PubSub.shutdown)
  yield* Effect.acquireRelease(native.subscribe({ ...key, publish: (u) => PubSub.publishUnsafe(pubsub, u) }),
    (s) => Effect.promise(() => s.unsubscribe()), { interruptible: true })
  return pubsub
}) })
const subscribe = (input) => Stream.unwrap(Effect.gen(function* () {
  const pubsub = yield* RcMap.get(watchers, key); ... }))
```

`OC/packages/core/src/filesystem/watcher.ts:91-140`.

**Anti-patterns replaced:** `setInterval`/`setTimeout` (T3 lints `globalTimers*`, `T3/tsconfig.base.json:53-54`); `Map<string, Promise>` in-flight dedupe (→ `Cache`/`RcMap`); promise-chain locks (→ `Semaphore`/`KeyedMutex`); hand-rolled event emitters (→ `PubSub`/`SubscriptionRef`); AbortController per job (→ fiber interruption + scope).

---

## 6. Platform

- **FileSystem/Path**: `const fileSystem = yield* FileSystem.FileSystem; const path = yield* Path.Path` in `make`; errors are `PlatformError` with `reason._tag` — `T3/apps/server/src/workspace/WorkspacePaths.ts:127-149`. Provided by `NodeServices.layer` (`T3/apps/server/src/server.ts:304`; `EF/ai-docs/src/60_child-process/10_working-with-child-processes.ts:103-105`). Test fakes: `FileSystem.layerNoop(partial)` (`EF/.../FileSystem.ts:848`).
- **ChildProcess** (`effect/process`):
  - collect: `spawner.string(ChildProcess.make("node", ["--version"]))`, `spawner.lines(...)`, pipes via `ChildProcess.pipeTo` — `EF/ai-docs/src/60_child-process/10_working-with-child-processes.ts:24-58`.
  - stream: `const handle = yield* spawner.spawn(cmd)` (needs `Scope`), `handle.all/stdout/stderr` streams → `Stream.decodeText(), Stream.splitLines`, `handle.exitCode`, wrap in `Effect.scoped` — same file :60-93.
  - **kill on interrupt**: closing the scope runs the spawner's `acquireRelease` release which terminates the process group (`NodeChildProcessSpawner.ts:677-695`); tune with `killSignal`, `forceKillAfter` (`process/ChildProcess.ts:258-275`); handle also exposes `kill(options)` (`ChildProcessSpawner.ts:109`).
  - production runner with output caps, stdin, concurrent stdout/stderr, timeout, typed errors, span attribute `process.command`: `T3/apps/server/src/processRunner.ts:229-403`.
  - opencode git/hg via `proc.run(ChildProcess.make("hg", [...], { cwd, env, extendEnv: true, stdin: "ignore" }))` — `OC/packages/core/src/project.ts:393-400`.
- **HttpClient** (`effect/http`): `(yield* HttpClient.HttpClient).pipe(HttpClient.mapRequest(flow(prependUrl, acceptJson)), HttpClient.filterStatusOk, HttpClient.retryTransient({ schedule: Schedule.exponential(100), times: 3 }))`; decode with `HttpClientResponse.schemaBodyJson(Schema)`; provide `FetchHttpClient.layer` — `EF/ai-docs/src/50_http-client/10_basics.ts:23-97`. Tests refuse network by providing `FetchHttpClient.Fetch` — `OC/packages/core/test/lib/effect.ts:18-41`.
- **Config**: `Config.String("X").pipe(Config.option)` / `Config.withDefault` / `Config.Redacted("SMTP_PASS")` / `Config.URL` — `T3/apps/server/src/cli/app.ts:177-178`; `EF/ai-docs/src/01_effect/05_resources/10_acquire-release.ts:25-26`; `20_layer-unwrap.ts:54-62`. Override source with `ConfigProvider.layer(ConfigProvider.fromUnknown({...}))` / `fromEnv` (`EF/.../ConfigProvider.ts:682,797,945`). For dshfiles, Cordis settings are the config source: read them once in an edge layer into a `Context.Reference`/service, don't call `ctx.get('settings')` in domain code.

**Anti-patterns replaced:** `node:fs`, `node:child_process`, global `fetch`, `process.env` reads in domain code (T3 language-service `nodeBuiltinImport`, `globalFetch*`, `T3/tsconfig.base.json:46-55`).

---

## 7. Tracing & logging

- `Effect.fn("Service.method")(function* ...)` names the span; name should match the function (`EF/LLMS.md:65-70`). Extra combinators go as **additional args**, never `.pipe` on `Effect.fn` (`LLMS.md:80-86`): `Effect.fn("UserRepository.findById")(function*(id){...}, Effect.mapError((reason) => new UserRespositoryError({ reason })))` (`20_layer-composition.ts:41-47`).
- `Effect.fnUntraced` for hot paths/library internals (`LLMS.md:56-58,88-96`; OC `plugin.ts:62`, `watcher.ts:130`; T3 `processRunner.ts:154`).
- `Effect.fn.Return<A, E, R>` to pin return types (`LLMS.md:71-73`; T3 `processRunner.ts:274`).
- Per-call identities: `yield* Effect.annotateCurrentSpan({ baseRef })` (`60_child-process/...:37`; T3 `processRunner.ts:275`; `ws.ts:764-766`). Transport handlers add no spans of their own; middleware instruments the RPC group (`T3/docs/internals/effect-services.md:32-36`).
- Explicit `Effect.withSpan("Plugin.load", { attributes: { "plugin.id": id } })` for a unit with no function boundary (`OC/packages/core/src/plugin.ts:89`).
- Logs: `Effect.logInfo/logWarning/logError(message, { structured })`, `Effect.annotateLogs`, `Effect.withLogSpan` (`EF/ai-docs/src/08_observability/10_logging.ts:52-66`; OC `plugin.ts:96-99` logs `cause` as a field, not interpolated).
- Replace loggers: `Logger.layer([...], { mergeWithExisting: false })` + `Layer.succeed(References.MinimumLogLevel, ...)`; batching with `Logger.batched(Logger.formatStructured, { window, flush })` (`10_logging.ts:10-49`; `OC/packages/util/src/observability.ts:31-51`; `EF/.../Logger.ts:1056-1060`). Per-plugin logger inheritance: OC copies `Logger.CurrentLoggers` and `References.MinimumLogLevel` into the plugin's fresh context (`plugin.ts:83-88`).

### Custom Tracer / bridging an external tracer

- `Tracer.make({ span, context? })` (`EF/.../Tracer.ts:31-45,479`).
- **The `context` hook runs on every evaluated primitive** of every fiber whose context carries that tracer: the run loop does `current = cache.tracerContext ? cache.tracerContext(current, this) : current[evaluate](this)` per op (`EF/packages/effect/src/internal/effect.ts:692-694`), cached per fiber context (`internal/effect.ts:788-792`). It is not per span; it is per op (thousands per request). It must be O(1) and allocation-free on the fast path.
- Reference bridges:
  - `@effect/opentelemetry` `OtelTracer.make`: `context(primitive, fiber)` returns `primitive["~effect/Effect/evaluate"](fiber)` **directly when there is no current span**, otherwise `Otel.context.with(populated, () => evaluate)` (`EF/packages/opentelemetry/src/OtelTracer.ts:100-126`).
  - `OtlpTracer.make` only installs a `context` when the user passes one, and short-circuits when `fiber.cache.span === undefined` (`EF/packages/effect/src/observability/OtlpTracer.ts:107-119`).
  - **t3code wraps another tracer** (`delegate`, e.g. OtlpTracer) with a span decorator that mirrors `attribute/event/addLinks/end` to the delegate and to a local file sink, and forwards the delegate's `context` unchanged: `Tracer.make({ span: o => new LocalFileSpan(o, delegate.span(o), sink.push), ...(delegate.context ? { context: delegate.context } : {}) })` (`T3/packages/shared/src/observability.ts:495-588`; wired at `T3/apps/server/src/observability/Observability.ts:36-76`). It also drops success payloads from span exits (`observability.ts:530-537`).
  - Tracing knobs: `Tracer.MinimumTraceLevel`, `References.TracerTimingEnabled` (`Observability.ts:30-34`).
- **Perf implication for dshfiles**: current `dshx/src/effect/tracer.ts:64-71` calls `TracerModel.process().runWithParent(parent, () => evaluate)` for **every primitive**, including when `fiber.cache.span` is undefined and when the parent hasn't changed. Target: (1) return `primitive["~effect/Effect/evaluate"](fiber)` immediately when no span (OtelTracer pattern); (2) skip re-entering the ALS when the active external context already equals `parent`; (3) resolve `TracerModel.process()` once at layer build, not per op; (4) provide the tracer once in the plugin root layer (`Layer.succeed(Tracer.Tracer, tracer)`), never via per-call `Effect.provideService` (`tracer.ts:75`).

**Anti-patterns replaced:** handler-level `withSpan` duplicating `Effect.fn` spans; payloads/args in span attributes; `console.*` (T3 `globalConsole*` error); string-interpolated cause in log messages.

---

## 8. Schema

- Domain records with behaviour/identity: `Schema.Class<Todo>("Todo")({...})` (`EF/ai-docs/src/04_integration/10_managed-runtime.ts:9-17`; `50_http-client/10_basics.ts:9-14`).
- Plain wire shapes: `Schema.Struct`; tagged unions of wire variants: `Schema.TaggedStruct("pasted-text", {...})` + `Schema.Union` (`T3/packages/contracts/src/assets.ts`, `chatAttachment.ts`, `preview.ts` — 20+ uses). `Schema.TaggedClass` exists (`EF/.../Schema.ts:17671`) for class-shaped tagged domain events.
- Brands: `TrimmedNonEmptyString.pipe(Schema.brand("ThreadId"))` via one `makeEntityId` helper; export `const X` + `type X = typeof X.Type` (`T3/packages/contracts/src/baseSchemas.ts:310-337`); OC uses `Plugin.ID.make(...)` constructors (`OC/packages/core/src/plugin.ts:107`). Use `X.make(...)` instead of `as X`.
- Refinements: `Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))`, `Schema.isBetween` (`baseSchemas.ts:29-31`).
- JSON string parsing: `Schema.UnknownFromJsonString` / `Schema.fromJsonString(S)` + `decodeUnknownOption` instead of `JSON.parse` in `Effect.try` (`OC/AGENTS.md:149`; `EF/.../Schema.ts:9886`; used `OC/packages/plugin/src/promise/adapter.ts:31`).
- Decode once at the boundary and pass typed values inward; don't re-validate (`OC/AGENTS.md:54`; `EF/LLMS.md:112-114`). **Hoist compiled decoders to module scope** (`T3/oxlint-plugin-t3code/rules/no-inline-schema-compile.ts:99-111`); OC caches compiled endpoint codecs in a `WeakMap` keyed by endpoint (`adapter.ts:30,171-207`). In Effect code use `Schema.decodeUnknownEffect` (T3 language-service `schemaSyncInEffect: error`, `T3/tsconfig.base.json:44`).
- JSON Schema for tools/RPC: `Schema.toJsonSchemaDocument(schema, options?)` (draft-2020-12) (`EF/.../Schema.ts:18089-18098`). For agent tools, T3 uses `effect/ai` `Tool.make(name, { description, parameters, success, failure, failureMode: "return" }).annotate(Tool.Readonly, false).annotate(Tool.Destructive, true)` (`T3/apps/server/src/mcp/toolkits/worktree/tools.ts:29-43`) and notes `Schema.Struct({})` serializes to `anyOf: [object, array]` — omit `parameters` for no-arg tools (:47-50). Custom JSON-schema per check: `toJsonSchema: () => [{ minLength: 1 }, true]` annotation (`baseSchemas.ts:24`).
- Predicates: `Predicate.isObject` etc., never hand-written `isRecord` (`EF/LLMS.md:317-343`).

### zod → Effect 4.1 Schema

`scripts/effect-schema-codemod.mjs --write` rewrites the mechanical cases (`z.string().min/max/regex`, number bounds, `z.object`, `z.array`, `z.enum`, `z.union`, `z.nullable`); `--residuals` lists what it left. The residuals are the lookups migration threads kept repeating in the reference, checked here against `EF/packages/effect/src`:

| zod                                     | Effect 4.1                                                                                                                                                                                                                      | Evidence                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `.parse(x)` / `.safeParse(x)`           | `Schema.decodeUnknownSync(S)(x)` outside Effect; `decodeUnknownOption` / `decodeUnknownResult` / `decodeUnknownExit` for a non-throwing result; `decodeUnknownEffect` inside Effect. Hoist the decoder to module scope.         | `Schema.ts:1535,1604,1672,1736,1883`            |
| `.strict()`                             | No schema method: pass `{ onExcessProperty: 'error' }` to the decoder **and** to `toJsonSchemaDocument` (which then emits `additionalProperties: false`). Default `'ignore'` strips unknown keys.                               | `SchemaAST.ts:490,539`; `Schema.ts:17949-17967` |
| `.passthrough()`                        | Not supported: `onExcessProperty` is only `'ignore' \| 'error'`. Model the open keys with `Schema.StructWithRest(Struct, [Schema.Record(Schema.String, Schema.Unknown)])`.                                                      | `SchemaAST.ts:539`; `Schema.ts:4251`            |
| `.optional()` (field)                   | `Schema.optional(S)` (`key?: T \| undefined`); `Schema.optionalKey(S)` when `undefined` must be rejected (exact optional).                                                                                                      | `Schema.ts:2406,2471`                           |
| `.default(v)` (field)                   | `S.pipe(Schema.withDecodingDefaultKey(Effect.succeed(v)))` — it already makes the key optional; `withDecodingDefault` also defaults `undefined`. The default is an `Encoded` value.                                             | `Schema.ts:6027,6134`                           |
| `.refine(fn, message)` / `.superRefine` | `S.check(Schema.makeFilter(value => (fn(value) ? true : message)))`                                                                                                                                                             | `Schema.ts:6761`                                |
| `.trim()` (transform)                   | `Schema.Trim` transforms; `Schema.Trimmed` / `isTrimmed()` only checks.                                                                                                                                                         | `Schema.ts:10379,10405,6850`                    |
| `.nonempty()` / `.min(1)`               | `Schema.NonEmptyString` or `.check(Schema.isNonEmpty())`; ranges `isBetweenLength(min, max)`                                                                                                                                    | `Schema.ts:8546,8623,9206`                      |
| `z.literal(a)` / `z.enum([...])`        | `Schema.Literal(a)` / `Schema.Literals([...])`                                                                                                                                                                                  | `Schema.ts:2743,5040`                           |
| `z.record(K, V)`                        | `Schema.Record(K, V)`                                                                                                                                                                                                           | `Schema.ts:4024`                                |
| `.describe(text)`                       | `.annotate({ description: text })`                                                                                                                                                                                              | `Schema.ts:684`                                 |
| `z.infer<typeof S>`                     | `typeof S.Type` (`typeof S.Encoded` for the wire side)                                                                                                                                                                          | —                                               |
| `zodToJsonSchema(S)`                    | `Schema.toJsonSchemaDocument(S, options)`; a Standard Schema consumer takes `Schema.toStandardSchemaV1(S)` / `toStandardJSONSchemaV1(S)`. Diff the emitted bytes against the zod output before landing a tool-schema migration. | `Schema.ts:1397,1418,18089`                     |

**Running a migration.** One plugin per thread or subagent, in its own JJ workspace: the single-thread multi-plugin runs compacted 19–36 times and re-read the same Schema APIs after each compaction. Migrate a plugin before the plugins that import it, and land each only after `turbo run typecheck test --filter='...@dshfiles/<plugin>'` passes (skill `dsh-plugin-verify`).

**Anti-patterns replaced:** zod residue; bespoke wrapper modules restating Schema APIs; `as` casts after `JSON.parse`; per-call `Schema.decodeUnknown(...)` construction; manual `typeof x === "object"` checks.

---

## 9. Testing

- `@effect/vitest`: `it.effect(name, () => Effect.gen(...))` (TestClock/TestConsole provided), `it.live` (real clock), `it.effect.each`, `it.effect.prop` with Schema arbitraries, `TestClock.adjust` (`EF/ai-docs/src/09_testing/10_effect-tests.ts:6-55`).
- Shared layer per block: `layer(Repo.layerTest)("Repo", (it) => { it.effect(...) })` or `it.layer(NodeServices.layer)("...", (it) => ...)` — `EF/ai-docs/src/09_testing/20_layer-tests.ts:94-120`; `T3/apps/server/src/serviceLauncher.test.ts:100-117` (real filesystem via `NodeServices.layer`).
- Per-test: `.pipe(Effect.provide(Service.layerTest))` (`20_layer-tests.ts:122-137`).
- Test layers over real implementations: test-ref service (`TodoRepoTestRef` as `Context.Service<..., Ref.Ref<...>>`) exposed with `Layer.provideMerge` so tests can assert underlying state (`20_layer-tests.ts:16-49`).
- Test layers only for external dependencies; don't mock logic under test (`T3/docs/internals/effect-services.md:90-91`; `OC/AGENTS.md:185-186`). Side effects run after commit → await the `Deferred`/drain worker, never sleep/poll (`T3/AGENTS.md:102`).
- OC's harness (bun:test, same idea): `testEffect(layer)` merges `TestClock.layer()` + `TestConsole.layer`, runs scoped, prints `Cause.prettyErrors`, and refuses non-loopback network (`OC/packages/core/test/lib/effect.ts:18-82`).
- Lint: `no-manual-effect-runtime-in-tests` — "Do not use `runPromise` in tests. Use @effect/vitest with it.effect(...) and test layers" (`T3/oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.ts:95`).

dshfiles: Cordis-free unit tests: provide domain services with `Layer.succeed(CordisContext, fakeCtx)` only for the edge adapters, or better test domain services over `PluginStorage.layerTest` (in-memory `Ref`) and real `NodeServices.layer` + temp dir.

---

## 10. Code organization & lint

| Convention           | OC                                                                                      | T3                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| File per service     | yes, kebab-case `kv.ts`, `bus.ts`                                                       | yes, PascalCase `WorkspacePaths.ts`, `ProcessRunner` in `processRunner.ts`                                                            |
| Namespace            | `export * as KV from "./kv.js"` at line 1 (`kv.ts:1`; config modules `OC/AGENTS.md:62`) | consumer `import * as Foo from "./Foo.ts"`; barrels `export * as TokenStore from` (`effect-services.md:69-75`)                        |
| Names inside         | `Service`, `Interface`, `layer`, `node`                                                 | class named after service, `make`, `layer`; port modules `makeCloudflaredRelayClient`/`layerCloudflared` (`effect-services.md:85-87`) |
| Effect imports       | named from `"effect"` (362 files)                                                       | namespace per subpath `effect/Effect` (`effect-services.md:69-71`)                                                                    |
| Aliased/star imports | forbidden (`OC/AGENTS.md:91-94`)                                                        | aliases like `import { layer as fooLayer }` forbidden                                                                                 |
| Moves                | —                                                                                       | delete old files, no re-export shims (`effect-services.md:88-89`)                                                                     |
| Unused exports       | —                                                                                       | knip fails CI (`effect-services.md:82-84`)                                                                                            |

Lint/diagnostics:

- T3 `@effect/language-service` (`T3/tsconfig.base.json:21-62`): errors on `anyUnknownInErrorContext`, `unsafeEffectTypeAssertion`, `missingEffectServiceDependency`, `leakingRequirements`, `globalErrorInEffectCatch/Failure`, `unknownInEffectCatch`, `preferSchemaOverJson`, `schemaSyncInEffect`, `cryptoRandomUUID*`, `nodeBuiltinImport`, `globalDate*`, `globalConsole*`, `globalRandom*`, `globalTimers*`, `globalFetch*`.
- T3 oxlint plugin (`T3/oxlint-plugin-t3code/rules/`): `prefer-catch-tags`, `no-inline-schema-compile`, `no-manual-effect-runtime-in-tests`, `no-global-process-runtime`, `require-suppression-reason`.
- OC oxlint `anti-slop-effect` (`OC/.oxlintrc.json:5,66-70`; rules in `OC/script/oxlint/anti-slop/effect/rules/`): `no-manual-effect-error-tag`, `no-manual-tag-comparison`, `no-manual-tagged-construction`, `no-service-constructor-imports` (no `make<Capability>` imports outside tests), `prefer-effect-match` (Match over chained ternaries).

### dshfiles conventions (recommended)

- kebab-case files (repo rule), one service per file, class named after the service with `static layer`/`layerTest`; `export * as` only for multi-export modules (schemas+errors).
- Named imports from `"effect"`, `"effect/process"`, `"effect/http"`; no aliases, no `effect/unstable/*`.
- Adopt via `effect-antislop`: `prefer-catch-tags`, `no-inline-schema-compile`, `no-manual-effect-runtime-in-tests`, `no-manual-tag-comparison`, `no-manual-tagged-construction`; enable `@effect/language-service` diagnostics listed above (at least `missingEffectServiceDependency`, `leakingRequirements`, `globalTimersInEffect`, `globalFetchInEffect`, `nodeBuiltinImport`, `schemaSyncInEffect`, `unknownInEffectCatch`).

---

## 11. Explicitly forbidden in the references

- Nested service yields `yield* (yield* Foo.Service).bar()` — `OC/AGENTS.md:63`.
- Aliased imports, star imports, type-position `import("...")` — `OC/AGENTS.md:91-94` (T3 _requires_ namespace imports for effect modules — conflict; pick one).
- try/catch where avoidable; `any` — `OC/AGENTS.md:57-58`.
- Returning `Effect` from non-effectful helpers; manual `JSON.parse` in `Effect.try` — `OC/AGENTS.md:148-149`.
- Mocks / `globalThis.*` in tests — `OC/AGENTS.md:185`.
- Feature logic in transport handlers; `FooShape` interfaces; deps as `make` params; module-global/closure-hidden deps; `Layer.succeed` over imperative/runtime-backed APIs; `make = Effect.succeed(...)`; re-export shims; `ManagedRuntime`/`runPromise` in services/constructors; per-feature runtimes; messages derived from `cause`; `detail` copying `cause.message`; raw payloads/args/URLs/credentials in error attributes or log annotations; duplicate tag + single-value discriminator; trivial error-constructor helpers; `catchTag`/`catchIf(Schema.is)` for known tags — `T3/docs/internals/effect-services.md:13-132`, `T3/.macroscope/check-run-agents/effect-service-conventions.md:27-70`.
- Lint-disable without a reason — `effect-services.md:140-141`; `require-suppression-reason` rule.
- Tests waiting on sleeps/polling — `T3/AGENTS.md:102`.
- `.pipe` on `Effect.fn`; functions that only wrap `Effect.gen`; hand-written type-guard helpers — `EF/LLMS.md:60,81,321-322`.
- Use `DateTime`/`Clock` not `Date.now` in Effect code — `EF/LLMS.md:290-292`.

---

## 12. Target shape for a dshfiles plugin (synthesis)

```ts
// plugins/@dshfiles/foo/src/foo-index.ts  (Host entry)
export const apply = (ctx: Context) => {
  const runtime = ManagedRuntime.make(FooPluginLayer.pipe(Layer.provide(DshxHost.layer(ctx))))
  ctx.on('dispose', () => runtime.dispose())
  ctx.on('ready', () => runtime.runPromise(runtime.contextEffect.pipe(Effect.asVoid))) // boot failures surface
  DshxHost.serveApi(ctx, runtime, FooApi, {
    // one Promise facade
    list: input => FooRepository.use(repo => repo.list(input)), // decode → 1 call → catchTags
  })
}
// FooPluginLayer = Layer.mergeAll(FooRepository.layer, FooWatcher.layer /* effectDiscard + forkScoped */)
//   .pipe(Layer.provide(NodeServices.layer), Layer.provide(DshxTracer.layer))
```

- Background work = scoped fibers in layers; disposal = `runtime.dispose()` only.
- Every service: `Context.Service` + `Effect.fn` methods + `Schema.TaggedError` with `cause`.
- Platform via `FileSystem`/`Path`/`ChildProcessSpawner`/`HttpClient`, never `node:*`.
- One tracer, provided once, with a fast-path `context` hook.
