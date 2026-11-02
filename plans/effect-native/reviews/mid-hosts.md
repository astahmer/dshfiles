# Effect review — "mid" Host units (dshfiles thread-72c437)

Scope: Host halves of project-checks, mcp-servers, mcp-endpoint, annotations, agent-questions, secret-catalog,
background-jobs, agent-communication, activity-timeline, editor, plus session-controller/src/effect-runtime.ts.
Paths below are relative to `plugins/@dshfiles/` unless prefixed. Effect = 4.1.0 (`~/.references/effect-4.1.0`).
All APIs recommended were checked in `packages/effect/src` (Semaphore.ts:424/501, Cache.ts:297/430/1284, FiberMap.ts:168/783,
Queue.ts:533/608/1439, Stream.ts:8679 `groupedWithin`, SubscriptionRef.ts:116/166, Schedule.ts:1240 `spaced`,
Effect.ts:2859/3398 `catchTag`/`catchCause`, `effect/process` = `src/process/*` exported as `"./process"` — NOT `unstable/process` in 4.1.0).

## 0. Census (non-test, non-client `.ts`)

| unit                | Effect.fn | Effect.gen | run* | `try {` | tryPromise | `async`/`await` lines | Context.Service |
| ------------------- | --------- | ---------- | ---- | ------- | ---------- | --------------------- | --------------- |
| project-checks      | 2         | 1          | 0    | 27      | 4          | 172                   | 1               |
| mcp-servers         | 1         | 1          | 0    | 19      | 3          | 108                   | 0               |
| mcp-endpoint        | 6         | 8          | 2    | 1       | 6          | 21                    | 1               |
| annotations         | 18        | 16         | 0    | 23      | 1          | 122                   | 1               |
| agent-questions     | 20        | 4          | 4    | 18      | 9          | 135                   | 2               |
| secret-catalog      | 2         | 11         | 0    | 12      | 1          | 59                    | 1               |
| background-jobs     | 5         | 10         | 0    | 4       | 2          | 14                    | 1               |
| agent-communication | 9         | 0          | 0    | 12      | 10         | 74                    | 0               |
| activity-timeline   | 6         | 1          | 0    | 5       | 6          | 20                    | 1               |
| editor              | 2         | 2          | 0    | 10      | 2          | 47                    | 1               |

The "more Effect.fn" count is mostly _edge decoration_: one `Effect.fn` per API method wrapping `Effect.tryPromise(() => asyncImpl())`.
Zero `@effect/vitest` `it.effect` in any of these units (only credential-port uses it).

## 1. Summary table

| unit                              | verdict                           | native % | top 3 problems                                                                                                                                                                   | effort |
| --------------------------------- | --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **background-jobs**               | partial (best)                    | ~55      | HistoryIndex is a Promise class on node:fs with a boolean "lock"; `wait` is a 250 ms poll loop; `catch: e => e` untyped errors                                                   | S/M    |
| activity-timeline                 | partial                           | ~35      | good `Context.Service`+`static layer`+acquireRelease shape, but the service it wraps is a Promise class with setTimeout batching + promise-chain lock; cause dropped; `as` casts | S/M    |
| mcp-endpoint                      | partial                           | ~40      | store is Promise; `storageOperation` drops cause; per-request `Effect.runPromise(...provide(tracerLayer))` outside plugin runtime; fn+gen double wrap                            | S      |
| editor                            | partial                           | ~30      | `Effect<string, unknown>` error channel; `catch: e => e`; redundant manual PluginApiError mapping; `as SessionId`                                                                | S      |
| session-controller effect-runtime | partial (by design, fork rule OK) | ~25      | catch passes any `_tag`-shaped object through untyped; service exposes raw Cordis `ctx`; empty traced setup                                                                      | S      |
| agent-questions                   | facade + 1 native island          | ~25      | Promise service + hand-rolled keyed lock run via `Effect.runPromise`; Effect→Promise→Effect round trips; module singleton + WeakMap registry                                     | M/L    |
| annotations                       | facade                            | ~20      | `Context.Service` whose methods return Promises; lazy promise memo instead of scoped layer; `unwrap` throws inside gen                                                           | M      |
| secret-catalog                    | facade                            | ~15      | hand-rolled shared in-flight list w/ refcount+AbortController (= `Cache`); subprocess with setTimeout/AbortController; module-level host state for tools                         | M      |
| agent-communication               | facade                            | ~15      | **bug**: `Effect.repeat(tryPromise)` loop dies on first failure; 5 module-level `let`s; async-iterator setup adapter                                                             | M      |
| mcp-servers                       | facade                            | ~10      | `Layer.empty`; `ManagerRuntime` class + promise-chain reconciler (with a stale-targets race); `Effect.forever(sleep)`                                                            | L      |
| project-checks                    | facade                            | ~10      | 6 `WeakMap<Context,…>` registries; DurableTaskRunner = hand-rolled queue/lock/poll; `catch: () => new X()` drops every cause                                                     | L      |

**Exemplar:** `background-jobs/src/host.ts` is the closest to native for the _plugin wiring_ (Layer.effect build, `Queue.dropping` debounce,
`Schedule.spaced`+`modifyDelay`, `forkScoped` fibers, `catchCause`). `activity-timeline/src/activity-timeline-effect.ts:17-57` is the best
_service-access_ shape (`Context.Service` with `static layer`, module `Effect.fn('…')(function* () { const s = yield* Service })`).
Neither is an exemplar as-is: both wrap Promise classes. Recommendation: finish background-jobs first (≈2 kLOC, exercises Queue/Schedule/
FiberSet/SubscriptionRef/FileSystem/Semaphore) and make it the reference implementation the other units copy.

## 2. Per unit

### 2.1 background-jobs (partial, ~55%)

Findings

- R3/R5 good: `host.ts:31-50` `Layer.effect` builds the runtime with `Queue.dropping<void>(1)`; `:62-65` `Schedule.spaced(...).pipe(Schedule.modifyDelay(...))`;
  `:76-85` debounce via `Queue.take`→`sleep`→publish; `:102-106` `Effect.forkScoped` loops. This is the right skeleton.
- R1/R2: `HistoryIndex` (`history.ts:85-297`) and `JobsBoard` (`service.ts`) are classes with async methods; the layer just `new`s them (`host.ts:38-47`).
  `onChange: () => Queue.offerUnsafe(...)` (`:46`) is an unsafe bridge from imperative code.
- R5: `history.ts:140-165` `pass()` uses a boolean `this.active` guard — a concurrent `refresh` API call (`host.ts:142-148`) returns immediately without
  indexing and then reports stale `indexing()`. Should be `Semaphore.withPermit` (or join the in-flight pass).
- R5: `service.ts:286-331` `wait` is a `while` + `Effect.sleep(WAIT_POLL_MS)` poll; should observe a `SubscriptionRef<rows>` via `SubscriptionRef.changes`
  - `Stream.takeUntil(settled)` + `Effect.timeoutOption`.
- R4: `host.ts:56-60,69` `catch: error => error` (error channel `unknown`); `:52-54` `String(error)` logging; `:110-111` `missingJob` converts any thrown error into `JobNotFound`
  (a genuine bug in `kill` becomes "not found"). `history.ts:43-56,109,143-163` try/catch + `lastError = String(error).slice`.
- R6: `history.ts:1` `node:fs/promises` (mkdir/readFile/readdir/rename/stat/writeFile) → `FileSystem`/`Path`.
- R7: `history.ts:144` imperative `withSpan('background-jobs history pass')` _inside_ an Effect-run pass; and each API handler gets `Effect.fn('background-jobs board')`
  **plus** the dshx adapter's `dshx-effect <api>.<method>` span (`tooling/dshx/.../effect/index.ts` registerEffectHost `Effect.withSpan(handler(...))`) — two spans per call.
- R8: `history.ts:43-56` `decodeJsonSafe` hand-rolls `Schema.decodeUnknownOption(Schema.fromJsonString(...))`.
- R10: OK — no run* in domain code. `context.inject(['jobs'], scoped => scoped.effect(...))` inside `Effect.sync` (`host.ts:92-101`) is an acceptable edge but its disposer lives outside the Effect scope (R1 "ctx.effect next to Scope").
- R9: tests (`service.test.ts`, `history.test.ts`) are plain vitest over the classes.

Target design

```
JobsLive (Cordis edge: context.get('jobs'), sessionPersistence)  ── Layer.succeed(JobsSource, {...})
HistoryIndex  : Context.Service { pass: Effect<void, HistoryIndexError>, indexing: Effect<JobIndexing>, jobs: Effect<ReadonlyArray<HistoryJob>> }
                deps: FileSystem, Path, HistoryConfig ; state: Ref ; lock: Semaphore(1)
JobsBoard     : Context.Service { board, output, kill, wait, invalidate } ; deps: HistoryIndex, JobsSource ; rows: SubscriptionRef
ChangeEvents  : layer-scoped fiber: SubscriptionRef.changes(rows) |> Stream.debounce(1s) |> runForEach(publish)
IndexingLoop  : Layer.effectDiscard(HistoryIndex.pass |> catchCause(log) |> repeat(schedule) |> forkScoped)

AppLayer = Layer.mergeAll(JobsBoard.layer, IndexingLoop, ChangeEvents)
             |> Layer.provide(HistoryIndex.layer) |> Layer.provide(NodeFileSystem.layer, JobsSourceLive(ctx))
```

Errors: `HistoryReadError{path, cause: Schema.Defect}`, `HistoryPersistError{cause}`, `JobNotFound{jobId}` (only from a lookup miss), `JobKillRefused{jobId, cause}`.
Deleted: `active` flag, poll loop, `decodeJsonSafe`, `lastError` string, `offerUnsafe` callback, imperative `withSpan`.

Before/after (`wait`)

```ts
// before service.ts:314-321
while (targets.length > 0 && !settled(jobs)) { yield* Effect.sleep(Duration.millis(Math.min(WAIT_POLL_MS, remaining))); jobs = snapshot() }
// after
const wait = Effect.fn('background-jobs wait')(function* (input: JobWaitInput) {
  const rows = yield* JobsRows                        // SubscriptionRef<ReadonlyArray<JobRow>>
  const final = yield* SubscriptionRef.changes(rows).pipe(
    Stream.map(snapshotOf(targets)), Stream.takeUntil(settled(until)), Stream.runLast,
    Effect.timeoutOption(input.timeoutMs ?? WAIT_DEFAULT_TIMEOUT_MS))
  ...
})
```

### 2.2 activity-timeline (partial, ~35%)

Findings

- R2/R3 good: `activity-timeline-effect.ts:17-27` `class ActivityTimeline extends Context.Service<...>() { static layer = Layer.effect(acquireRelease(make, drain)) }`;
  `:29-57` module-level `Effect.fn('activity timeline page')(function* (filter) { const service = yield* ActivityTimeline ... })` — correct shape, no fn+gen double wrap.
- R1: the service _type_ is the Promise class `ActivityTimelineService` (`service.ts`); every method is `Effect.tryPromise` over it.
- R5: `service.ts:96` `#writes: Promise<void>` promise-chain lock (`#serialize`); `:101-147` hand-rolled batch queue with `setTimeout`, `INGEST_BATCH_LIMIT`, per-item resolve/reject
  → `Queue.unbounded<Pending>` + `Stream.fromQueue |> Stream.groupedWithin(LIMIT, DELAY)` consumer fiber + `Deferred` per item; write lock → `Semaphore(1)`.
  `:110-113` hand-rolled listener `Set` → `PubSub`.
- R4: `activity-timeline-effect.ts:10-15` cause dropped; non-`code` errors flattened to a constant message. `host.ts:38-46` try/catch + `void active.enqueue(...).catch(...)`.
- R6: state file via node:fs (service.ts `#readState/#writeState`) → `FileSystem`.
- R8: `host.ts:81,83` `event.value as Parameters<typeof communicationActivity>[0]` — the union member decodes `value: Schema.Unknown` (`:122-126`), so the cast hides an undecoded boundary;
  `:136-150` an inline `decodeUnknownSync` (throws) instead of a union member schema.
- R1: `host.ts:47-94` `context.on(...)` listeners registered in an `Effect.gen` with no scope release (Cordis disposes them, but Effect does not know).
- R10: OK.

Target: `ActivityStore` (FileSystem, Semaphore, Ref cache) → `ActivityIngestQueue` (Queue + groupedWithin fiber + Deferred) → `ActivityTimeline` (page/attention/stats/event/related as Effects, `PubSub<ActivityEvent>`).
Edge: one `Layer.effectDiscard` that registers `context.on` listeners with `Effect.acquireRelease(sync(on), dispose)` and offers decoded events via `Queue.offer` (runFork through a captured `Runtime` only in the listener). Errors: `ActivityDecodeError{kind, cause}`, `ActivityStoreError{operation, cause}`, `ActivityEventNotFound{eventId}`.

### 2.3 mcp-endpoint (partial, ~40%)

Findings

- R2: `host.ts:20-23` `Layer.succeed(EndpointRuntime, { store: createEndpointStore(ctx) })` — Promise store (`endpoint-store.ts:19-50`) built from `pluginStorage(ctx)`; should use dshx `PluginStorage` service + `Effect.fn` methods.
- R4: `host.ts:40-41` `catch: () => new EndpointStorageFailure({ message: '...' })` — cause dropped. `endpoint-store.ts:23-24` decode failure silently = "no token".
- R7: `host.ts:51-56` `statusOf` is `Effect.gen` without `Effect.fn` (no span, fine) but `:61-87` every handler is `Effect.fn('x')(({ctx}) => Effect.gen(function* () {...}))` — use `Effect.fn('x')(function* ({ ctx }) {...})`.
- R10: `mcp-route.ts:88-187` runs `Effect.runPromise(Effect.provide(Effect.fn('mcp request',{kind:'server'})(...)(), DshxEffect.tracerLayer))` per HTTP request; `mcp-server.ts:37-45` the same per MCP tool call. These are legitimate edges, but they bypass the plugin `ManagedRuntime`, so `EndpointRuntime` must be passed by closure (`createMcpRoute({ store })`). Capture `const services = yield* Effect.context<EndpointRuntime>()` in setup and run each request with `Effect.runPromiseWith(services)(...)` (Effect.ts:6050, 9448) instead.
- R5: register/unregister with `acquireRelease` (`host.ts:33-36`) — good.

Target: `EndpointTokens` service {status, rotate, revoke, setLan, verify} deps `PluginStorage`, `Clock`; `McpRoute` layer-scoped registration capturing the runtime. Errors: `EndpointStorageError{operation, cause}`, `McpRequestFailure{kind}` kept.

### 2.4 editor (partial, ~30%)

- R4: `host.ts:41` service contract `Effect.Effect<string, unknown>`; `:59` `catch: error => error`; `:95` `catch: e => e instanceof WorkspaceWriteError ? new X(...) : e` → error union contains `unknown`.
  `:97-102` manual `mapError` to `PluginApiError` duplicates what the dshx adapter already does for tagged errors (`index.ts` `thrownFailure`: `_tag`→`code`) — delete it and give tagged errors a `code` via `_tag`.
- R8: `:54` `sessionId as SessionId` → decode with the branded `SessionId` schema. `:25-27` `Schema.declare` guard is OK as an edge decoder.
- R6: `write-file.ts:2` node:fs (lstat/open/realpath/rename/unlink) inside a Promise function wrapped by tryPromise → `FileSystem` (atomic write via `fs.writeFile` temp + `fs.rename`).
- R1: `:57` mutable `let storedRoot`; `:69` `setup: () => Effect.void`.
  Target: `SessionWorkspaces` {root(sessionId): Effect<AbsolutePath, SessionWorkspaceMissing | SessionLookupError>} (deps: `LiveSessions`, `StoredSessions` from one edge layer); `WorkspaceFiles` {write(...): Effect<WriteResult, WriteConflict | PathOutsideWorkspace | WriteTooLarge | WriteIoError>} deps `FileSystem`, `Path`.

### 2.5 session-controller/src/effect-runtime.ts (partial, fork rule respected)

- Fork rule: `node scripts/native-fork-diff.mjs session-controller` (read-only; only prints JSON and sets exitCode) → `undeclared: [], staleDelta: [], missing: [], added: []`, exit 0.
  No file under `src/native/` imports `effect`, `@dshfiles/dshx/effect` or `effect-runtime` (grep). The owned `*-host.ts` files call native Promise APIs through
  `trySessionControllerOperation` (`effect-runtime.ts:41-48`) = the "Promise adapter" the rule allows. **Verdict: compliant.**
- R4: `:44-46` passes through _any_ object matching `{_tag: string}` (`Schema.is(taggedFailure)`) — the error type is effectively `unknown`; non-tagged errors become `message: String(error)` with no `cause`.
- R2: `:50-63` the service exposes raw `ctx` plus `ctx.get(...)` handles; owned handlers (`sessions-host.ts:207-240`) put the whole use case in one `async` closure inside `tryPromise` (14×). That's acceptable for a fork boundary but means the owned code isn't Effect-native either.
- R7: `:67` `Effect.fn('session controller setup')(() => Effect.void)` — a span for nothing.
  Target: keep the adapter, type it: `nativeCall = <A>(operation: NativeOperation, f: (signal) => Promise<A>) => Effect.tryPromise({ try: f, catch: cause => new NativeSessionControllerError({ operation, cause }) })`, map known native error codes to the existing tagged classes with `catchIf`; expose `SessionController`, `Commands`, `WorkspaceRegistry`… as separate `Context.Service`s from one edge layer instead of a bag with `ctx`.

### 2.6 agent-questions (facade with one native island, ~25%)

Findings

- R5 hand-rolled lock: `keyed-effect-lock.ts:8-31` takes `operation: () => Promise<Value>` and returns `Effect.runPromise(semaphore.withPermit(Effect.tryPromise({ try, catch: error => error })))`.
  The gold standard is opencode `packages/core/src/effect/keyed-mutex.ts:20-42`: identical map+refcount but `withLock(key)(effect)` is an Effect combinator inside `Effect.suspend` — no runPromise, typed errors preserved, interruption propagates.
  (Effect 4.1 has no keyed mutex: `PartitionedSemaphore` is a _shared_ permit pool partitioned for fairness — PartitionedSemaphore.ts:1-10 — not a per-key mutex; `RcMap` would cancel in-flight work when the last waiter leaves, per opencode `workspace.ts:359` note.)
  Recommendation: promote a `KeyedMutex` (opencode shape) into `@dshfiles/dshx/effect` once; delete `keyed-effect-lock.ts`.
- R10: `service.ts:483` `wait: waitRequest => Effect.runPromise(waitEffect(waitRequest))` inside domain code; `host.ts:86-87` `runHostEffect` = `Effect.runPromise(Effect.provide(effect, tracerLayer))` used at `host.ts:325,346,359` _inside_ tool `execute` bodies that `effectTool` (`:69-84`) already wraps in another `Effect.runPromise`. Round trip: Effect → Promise → Effect → Promise → Effect.
- R1: `service.ts:192-531` the real service is a Promise object with `let closed` (`:200`), waiter `Map<string, Set<...>>` (`:198`); `:533-551` "Effect service" = `Effect.fn(...)(req => promiseEffect(() => service.request(req)))`;
  `:142,529,539-540` a module `WeakMap<ParentQuestionService, wait>` smuggles the one native method out. `host.ts:63` module singleton `activeHostServices`; `revisioned-feedback.ts:131-133` same pattern.
- R5 native island: `service.ts:305-345` `waitEffect` — `Effect.callback` + `Effect.raceFirst(completion, Effect.sleep(expiry))` is genuinely idiomatic, but `:320-326` still plumbs `AbortSignal` (`addEventListener('abort')` → `void settle(...)` fire-and-forget at `:321`) instead of `Effect.onInterrupt`.
  `tool-flow.ts:5-47` passes `service` and `signal` as parameters (R2) and is a static class of `Effect.fn`s.
- R4: `service.ts:144-148` `message: error instanceof Error ? error.message : String(error)` (cause lost); `:157,162,182,231,250,253,260,361,381,395,398,461,465,467,474,476,479,501,504,513` ~20 `throw new Error('...')` that become one `ParentQuestionServiceError{operation,message}` — the API cannot distinguish NotFound / Forbidden / LimitReached / Conflict.
  `host.ts:783-788` `close().pipe(Effect.catch(error => Effect.die(error)))` and `catch: error => error`.
- R2/R3: `host.ts:757-774` `Layer.succeed(ParentQuestionServiceEffect, createParentQuestionEffectService({ table: async () => (await storageFor(context)).table(...), runtime: createParentQuestionRuntime(context) }))` — closures over `ctx`, lazy `WeakMap<Context, Promise<Domain>>` (`host.ts:167`).
  `:793-794` `context.provide('parentQuestions', …)` publishes an Effect-API object as a Cordis service; grep finds **no consumer** — delete.
- R8: `service.ts:16-17` `decodeStrict` = `decodeUnknownSync` (throws inside Promise code); `:377` `JSON.stringify(a) !== JSON.stringify(b)` equality → `Equal`/schema equivalence.

Target design

```
QuestionStore   : Context.Service { get, findByQuestionId, put, update, delete, entries } deps: PluginStorage/StorageDomain (scoped open via acquireRelease)
QuestionRuntime : Context.Service { isLive, parentSessionId, isDirectChild, sendToParent: Effect<MessageId, DeliveryFailed> }   ← only edge that touches ctx.agents/ctx.subagents
ParentQuestions : Context.Service { request, listForParent, answer, wait, cancel, recordDeferredFile }
                  deps: QuestionStore, QuestionRuntime, Clock ; state: KeyedMutex<string>, admission: Semaphore(1), waiters: PubSub<ParentQuestionRecord>
                  close = layer finalizer (PubSub.shutdown ⇒ waiters observe interruption → 'interrupted')
ParentFeedback  : same pattern
Layer: Layer.mergeAll(ParentQuestions.layer, ParentFeedback.layer) |> provide(QuestionStore.layer, QuestionRuntime.layer(ctx))
Edge: tools = ToolAdapter.fromEffect(runtime)(name, decode, effect) — one runPromise per tool call with the plugin runtime + execution.signal
```

Errors: `QuestionNotFound{questionId}`, `QuestionForbidden{reason}`, `QuestionLimitReached{scope:'parent'|'retained'}`, `OperationIdReused{operationId}`, `AnswerConflict{questionId}`, `QuestionNotPending{status}`, `DeliveryFailed{cause}`, `QuestionStoreError{operation, cause}`, `ServiceClosed`.
Deleted: `keyed-effect-lock.ts`, `promiseEffect`, `questionWaitEffects` WeakMap, `activeHostServices`, `runHostEffect`, `assertOpen`/`closed`, `waiters` Map, `context.provide(...)`, AbortSignal parameters.

Before/after

```ts
// before keyed-effect-lock.ts:12-27 + service.ts:365-367
return operationLocks.run({ key, operation: async () => { assertOpen(); const table = await input.table(); ... } })
// after
const request = Effect.fn('parent question request')(function* (input: QuestionRequest) {
  const store = yield* QuestionStore
  const key = operationKeyFor(...)
  return yield* locks.withLock(key)(Effect.gen(function* () {
    const existing = yield* store.get(key)
    if (Option.isSome(existing)) return yield* resume(existing.value, input)
    const created = yield* admission.withPermit(admit(input))
    return yield* deliver(created)                         // interruption ⇒ settle 'cancelled' via Effect.onInterrupt
  }))
})
```

### 2.7 annotations (facade, ~20%)

- R1/R2: `host.ts:29-35` `Context.Service<AnnotationsHost, { annotationsFor: () => Promise<OpenedAnnotations>; closeAnnotations: () => Promise<void>; registerRoutes: () => (() => void)[] }>` — an Effect tag over a Promise API.
  `:89-141` layer builds a lazy `let opening: Promise<...>` memo with `void started.catch(...)` reset (`:93-103`) → `Layer.effect` + `Effect.acquireRelease(open, close)` (or `Effect.cached` if lazy open is required).
- R1: `:43` module `let settingsScope`; `:45-51` try/catch read → `SettingsRead` service.
- R4: `:143-146` `unwrap` throws `new Error('annotations ...')` _inside_ `Effect.gen` → defect, not failure; `:179-183` `message: String(error)`; `store.ts:82`.
- R6: `:61` direct `fetch(.../json/version)` → `HttpClient`; `chrome-launch.ts:161` `await new Promise(r => setTimeout(r, 250))` poll; `chrome-cdp.ts:64-69,216` hand-rolled RPC map + timers over WebSocket (→ `effect/socket`? keep imperative but wrap one Effect boundary with `acquireRelease` + `timeout`).
- R5: `ingest.ts:104` module `windows` Map rate limiter (→ `RateLimiter` or a `Ref`); `source.ts:131-132` hand caches (→ `Cache`).
- R7: `:203-375` 18× `Effect.fn('x')(({input}) => Effect.gen(function* () {...}))` double wrap.
  Target: `AnnotationStore` (scoped domain open, Effect methods, tagged `AnnotationNotFound`/`AnnotationConflict`), `SourceResolver` (Cache-backed), `ChromeController` (Subprocess.spawnScoped + HttpClient), `Pairing`, `IngestRoutes` (layer-scoped `webServer.register` with acquireRelease). Errors per store outcome instead of `StoreResult` → throw.

### 2.8 secret-catalog (facade, ~15%)

- R5: `secret-operations.ts:121-170` hand-rolled shared in-flight list: `Map<key, {promise, controller, consumers, settled}>`, manual refcount, abort-when-last-consumer-leaves, `pendingLists.clear()` around writes.
  This is precisely `Cache` semantics in 4.1 (Cache.ts:450-500: the shared lookup fiber is interrupted when its last awaiter is interrupted; `Cache.invalidateAll` Cache.ts:1284). → `Cache.make({ capacity, timeToLive: 0-ish, lookup: (cwd) => cli.list(cwd) })` + `invalidateAll` after writes, writes serialized by `Semaphore(1)`.
- R5/R6: `secret-cli-runner.ts:55-117` AbortController + `setTimeout` deadline + try/catch/finally cleanup → `Subprocess.spawnScoped` (dshx) + `Effect.timeoutOrElse` + `Effect.scoped`; `SecretCliError` is thrown from a Promise (`:113`).
- R4: `secret-catalog-effect.ts:7-10` `catch` _throws_ unknown failures (`throw failure`) → becomes a defect via tryPromise's catch; better `Effect.catchIf`/`catchTags`. `SecretCatalogOperationError` thrown synchronously in `host.ts:60` (`cwdForScope`) inside a handler → defect, not typed failure.
- R1: `host.ts:26-27` `WeakMap<Context, Ops>` + module `let hostContext` solely so `createSecretTools` (`:144-149`) can reach operations — fix with tools built from the runtime.
- R2: `host.ts:30-35` layer `Layer.succeed` from Promise factories; `:66-142` 11× `Effect.gen` without fn (span provided by `secretCatalogQuery/Change` — OK).
- R9: has `@effect/vitest` in package.json but no `it.effect` tests.
  Target: `SecretCli` {run(request): Effect<string, SecretCliMissing|SecretCliFailed|SecretCliTimeout, Scope?>} deps `Subprocess`; `SecretCatalog` {list (Cache), reveal, copy, create, update, removeAlias, deleteItem} deps `SecretCli`, writes `Semaphore`; `SecretValues`/`CredentialBridge` built from `SecretCatalog`; edge `ctx.provide('secretCatalogValues', promiseAdapter(runtime))` (other plugins are Promise consumers — keep that adapter, one place).

### 2.9 agent-communication (facade, ~15%) — contains a real bug

- **R5 bug**: `host.ts:816-817` `recurring = (run, ms) => Effect.repeat(Effect.tryPromise({ try: run, catch: () => undefined }), Schedule.spaced(...))`.
  `Effect.repeat` repeats on _success_ only; the first failure fails the forked fiber and the loop stops forever, silently. `refreshUnreadCounts` swallows errors itself, but `runMaintenance` (`:837`, `Promise.resolve(setup.runMaintenance())`) does not: one maintenance throw = workspace-topic cleanup never runs again until restart.
  Fix: `run.pipe(Effect.catchCause(logCause), Effect.repeat(Schedule.spaced(...)))` (background-jobs does it right at host.ts:70-73).
- R1: module state `host.ts:506-507` (`hostContext`, `communicationService`), `:527` `durableSessionIds` TTL cache, `:560-561` `unreadCounts` + `unreadRefresh` promise memo (`:571-583`). → `Ref`s inside a service; `durableSessionIds` → `Cache` with `timeToLive: '60 seconds'`; `unreadRefresh` → `Effect.cached`/Semaphore.withPermitsIfAvailable.
- R1: `:819-835` setup adapts an **async iterator** (`setupHostIterator(context)[Symbol.asyncIterator]().next()`) into acquireRelease — an imperative lifecycle hidden behind Effect.
  `:840` `DshxEffect.plugin({ layer: Layer.empty, ... })`; `:622` the API uses `DshxEffect.host` (no runtime) and reaches state through module globals.
- R4: `:616-620` `operationError` stringifies; R7 good shape `Effect.fn('...')(function* ({input}) {...})` (`:623-646`) — the right syntax, wrong body (tryPromise over Promise ops).
- R10 OK.
  Target: `CommunicationBridge` (scoped acquire of the comm service; owns maintenance fiber), `RecipientDirectory` (live agents + `Cache` of durable ids), `UnreadCounts` (`SubscriptionRef<Map>` refreshed by a `Schedule` fiber; prompt context reads `SubscriptionRef.get` via runSync at the Cordis prompt edge), `CommunicationOps` (Effect methods). Errors: `UnknownRecipient{requestedId, suggestions}`, `CommunicationStoreError{operation, cause}`, `NotAuthorized`.

### 2.10 mcp-servers (facade, ~10%) — MCP client lifecycle

- R1/R3: `host.ts:531-532` `layer: Layer.empty`; `:351-352` `WeakMap<Context, ManagerRuntime>` + `WeakMap<root, Set<string>>`; `:475` module `pendingAuthorizations` Map with lazy TTL sweep (`:477-483`).
- R5 lifecycle: `ManagerRuntime` (`:354-450`) + `ClientReconciler` (`reconcile.ts:12-79`) — a promise-chain mutex (`pending = run.catch(...)`, `:15,20-21`), `active` Map of disposers, `lifecycle` Map; native client = `scoped.plugin(nativeMcpClient, config)` fiber disposed by hand (`:382-398`), local process start/stop with nested try/finally (`:366-407`).
  **Race**: `reconcile()` (`:417-440`) awaits `desiredTargets(...)` (credential resolution, `:296-297`) _before_ enqueueing into the reconciler chain. Two concurrent reconciles (credential event `:560-573`, token refresh `:575-589`, `setConnection` `:442-447`) can resolve out of order, so an older target list is applied after a newer one. Fix by serializing target computation and application under one `Semaphore`/`KeyedMutex`.
- R5: `:575-589` `Effect.forever(Effect.sleep(INTERVAL).pipe(andThen(...)))` → `Effect.repeat(Schedule.spaced(INTERVAL))`; `:564-571` `void runtime.reconcile(...).catch(...)` from a Cordis event.
- R4: `:45-55` `operation()` stringifies; `:544-547` `catch: () => new McpManagerOperationError(...)` then `Effect.catch(() => warn)` — cause lost twice; `:370,377,407` `throw new Error` with the original logged only as `%s`.
- R6: `local-process.ts` start/stop via raw `SubprocessRuntime` with `stopping: Promise` memo (`:16,56-67`) → dshx `Subprocess.spawnScoped`.
- OAuth (`oauth.ts`, 298 lines) is fetch-based → `HttpClient`.
  Gold standard: opencode `packages/core/src/mcp/index.ts:114,207-209` (`KeyedMutex` per server), `:196,232` per-server `Scope.fork(root)` with `registration.dispose = Scope.close(scope)`, `:524-547` `acquireRelease(Scope.fork(root), close)` + `Scope.addFinalizer(scope, transport.close)`, `:579` `acquireRelease(register.pipe(attachedLocks.withLock(name)), …)`.
  Target

```
McpServerConfig : SubscriptionRef<ReadonlyArray<StoredServer>> (fed by Cordis config/credential events at the edge)
LocalCommands   : { start(id, cmd): Effect<LocalProcess, LocalStartFailed, Scope> }  deps Subprocess
NativeClients   : { attach(target): Effect<void, ClientStartFailed, Scope> }  (acquireRelease(ctx.plugin(...), fiber.dispose))  ← only Cordis-touching layer
McpManager      : { reconcile, setConnection, snapshot, status(id) } deps all above; state: Ref<Map<id,{fingerprint, scope: Scope.Closeable}>>,
                  lock: Semaphore(1) around compute+apply; per-server child Scope (Scope.fork(layerScope)); lifecycle: SubscriptionRef<Map<id, ClientLifecycle>>
Fibers (layer-scoped): config changes |> Stream.debounce |> runForEach(reconcile); token refresh repeat(Schedule.spaced(5 min)); pending OAuth: Ref<HashMap> + expiry
```

Errors: `McpServerNotFound{id}`, `OAuthNotSupported{id}`, `OAuthStateUnknown`, `LocalStartFailed{id, cause}`, `ClientStartFailed{id, cause}`, `CredentialUnresolved{id, ref}`.
Before/after

```ts
// before host.ts:381-398
const fiber = await scoped.plugin(nativeMcpClient, native.config); localProcess?.markRunning()
return async () => { try { await fiber.dispose() } finally { if (localProcess) { try { await localProcess.stop() } finally { ... } } } }
// after
const attach = Effect.fn('mcp server attach')(function* (target: NativeTarget) {
  const scope = yield* Scope.fork(managerScope)
  yield* Effect.gen(function* () {
    if (target.localCommand) yield* LocalCommands.start(target.id, target.localCommand)      // acquireRelease inside
    yield* NativeClients.attach(target)                                                        // acquireRelease(plugin, dispose)
  }).pipe(Scope.provide(scope), Effect.onError(() => Scope.close(scope, Exit.void)))
  yield* Ref.update(active, HashMap.set(target.id, { fingerprint: target.fingerprint, scope }))
})
```

### 2.11 project-checks (facade, ~10%) — durable job queue

- R1: six context registries: `host.ts:103` completionPermits, `:155` storageServices, `:165` storageDomains, `:185-187` durableTaskDomains/Stores/Runners, `:408` endpointBudgets — all `WeakMap<Context, …>` with lazy `Promise` memos (`:251-311` `durableTaskRunnerFor`, `void opening.catch(...)`).
  `:940-944` the "layer" is `Layer.succeed(ProjectChecksRuntime, { context: ctx })` and _mutates_ `storageServices.set(ctx, …)` as a side effect.
- R4: `:931-938` `projectChecksEffect` = `Effect.fn(...)(function* () { ... Effect.tryPromise({ try: signal => work(ctx, signal), catch: () => new ProjectChecksOperationError({ operation }) }) })` — **every** API failure loses its cause and message
  (e.g. "Project action is not configured" `:980` reaches the client as a bare `ProjectChecksOperationError`); `:950,962,967` same in setup; `:955-960` try/finally inside tryPromise; `:994-998` try/catch for freshness.
- R5 durable queue, `durable-task-runner.ts`:
  - `:29-34` `active: Map<string, AbortController>`, `workers: Map<string, Promise>`, `pending: Set`, `admission: Promise` chain;
  - `:113-130` `launch` = single-worker queue (`workers.size >= 1 ⇒ pending.add`), recursion in `.finally`;
  - `:217-226` `watchCancellation` = 200 ms DB poll per running task;
  - `:234-246` `withAdmission` = hand-rolled mutex;
  - `:100-111` close aborts controllers then `waitForIdle` busy `while`.
  - store `durable-task-store.ts:250-272` `withWorkerClaim` = SQLite `BEGIN IMMEDIATE` busy-retry loop with `delay(50)`.
    → `Queue.unbounded<TaskId>` + one consumer fiber (`Effect.forever(Queue.take >>= runTask)` forkScoped) or `FiberMap<TaskId>` + `Semaphore(1)` for concurrency 1; cancel = `FiberMap.remove(taskId)` (interrupts) + store update; cancel-requested polling across processes → `Effect.repeat(Schedule.spaced('200 millis'))` race with the task (`Effect.raceFirst`), or better a store-change `PubSub` for in-process requests; admission → `Semaphore.withPermit`; claim → `Effect.acquireRelease(open DatabaseSync + BEGIN IMMEDIATE, ROLLBACK+close)` with `Effect.retry({ while: isBusy, schedule: Schedule.spaced('50 millis') })`; close = layer scope (FiberMap is scoped; mark claimed tasks `unknown` in a finalizer).
- R5/R6 subprocess: `managed-process.ts:40-91` AbortController + `setTimeout` + manual `stopAndConfirm` → dshx `Subprocess.spawnScoped` + `Effect.timeoutOption` + `Effect.onInterrupt` (the scoped release already terminates + waits).
- R6: store/secure dir via `node:fs/promises` (`durable-task-store.ts:4`) → `FileSystem` (chmod exists on FileSystem).
- R5 endpoint budgets `host.ts:403-436` Map + cool-down timestamps → `SynchronizedRef<HashMap<endpoint, Budget>>` or `RateLimiter`-like per endpoint.
  Target

```
ProjectChecksEdge   : Layer from ctx (config SubscriptionRef, sessionPaths, storageDomain, subprocess, emit)       ← only ctx.get
ReceiptStore        : { persist, list, listAfter } deps StorageDomain (scoped open)
ActionRunner        : { run(action, paths, opts): Effect<AttemptRun, ActionRunError, Scope> } deps Subprocess, RemotePeers, Clock
RemotePeers         : { attempt(...) } deps Subprocess, EndpointBudgets(SynchronizedRef)
DurableTaskStore    : { createIfAbsent, update, get, claim: Effect<void, ClaimBusy, Scope> } (SQLite, Semaphore-guarded tx)
DurableTasks        : { enqueue, list, cancel, retry } deps DurableTaskStore, ActionRunner ; Queue + worker fiber + FiberMap
CompletionGate      : { permit, verify } Ref<Map>
Layer: mergeAll(DurableTasks.layer, CompletionGate.layer, Hooks.layer) |> provide(ActionRunner.layer, ReceiptStore.layer, DurableTaskStore.layer) |> provide(ProjectChecksEdge.layer(ctx))
```

Errors: `ActionNotConfigured{actionId}`, `ActionNotVisible{actionId, sessionId}`, `SessionPathUnavailable{sessionId, cause}`, `RevisionCaptureFailed{cwd, cause}`, `ReceiptPersistFailed{cause}`, `TaskNotFound{taskId}`, `DuplicateRetryRequiresConfirmation`, `ClaimBusy`, `PeerFailed{code, cause}`.
Before/after

```ts
// before durable-task-runner.ts:113-130 + 234-246
if (this.workers.size >= 1) { this.pending.add(taskId); return }
const worker = this.runTask(taskId).catch(...).finally(() => { ...; this.launch(next) })
// after (inside DurableTasks.make)
const queue = yield* Queue.unbounded<TaskId>()
const running = yield* FiberMap.make<TaskId>()
yield* Effect.forever(Effect.gen(function* () {
  const taskId = yield* Queue.take(queue)
  yield* FiberMap.run(running, taskId, runTask(taskId)).pipe(Effect.flatMap(Fiber.await))   // concurrency 1
})).pipe(Effect.forkScoped)
const cancel = Effect.fn('project checks task cancel')(function* (taskId: TaskId) {
  yield* store.update(taskId, DurableTaskModel.cancelRequested)
  yield* FiberMap.remove(running, taskId)                                                     // interrupt ⇒ scoped process terminate
})
```

## 3. Cross-cutting patterns (fix once)

1. **Edge-only Effect ("tryPromise sandwich")** — `Effect.fn(name)(() => Effect.tryPromise({ try: () => asyncImpl(ctx), catch }))` in every unit
   (project-checks host.ts:931, mcp-servers host.ts:49, annotations host.ts:179, agent-questions service.ts:147, agent-communication host.ts:624-645, activity-timeline-effect.ts:31-56, secret-catalog-effect.ts:12, session-controller effect-runtime.ts:41).
   Fix: migrate the _service implementation_, not the API table; ban `tryPromise` outside a small set of edge adapter files (lint).
2. **Cause loss** — `message: error instanceof Error ? error.message : String(error)` or `catch: () => new X()` appears in ≥10 places; the dshx foundation does it too (`tooling/dshx/.../effect/services.ts:25,41-44,61,83-99,153-161,186` all `catch: () => failed(service, op)`).
   Fix in dshx first: `EffectHostServiceError` gets `cause: Schema.Defect`, and add a lint rule "tryPromise catch must reference its argument".
3. **Context registries & module singletons** — `WeakMap<Context,…>` (project-checks ×6, mcp-servers ×2, secret-catalog, agent-questions, and dshx's own `pluginRuntimes` index.ts:43) and module `let` (agent-communication ×5, agent-questions, secret-catalog, annotations).
   Root cause: Cordis `tools`/`prompts` are declared statically in `defineHost` and executed outside the plugin runtime. Fix in dshx: `DshxEffect.plugin` should also accept `tools` and `prompts` built from Effects and run them with the plugin `ManagedRuntime` (same as `hostApi`). That deletes every "requireService()" global.
4. **Effect.fn + Effect.gen double wrap** — `Effect.fn('x')((args) => Effect.gen(function* () {...}))` (annotations ×18, mcp-endpoint ×4, background-jobs ×5, editor). Use `Effect.fn('x')(function* (args) {...})` (agent-communication host.ts:623 already does).
5. **Duplicate spans** — dshx `registerEffectHost` wraps every handler in `Effect.withSpan('dshx-effect <api>.<method>')` and handlers add `Effect.fn('<subject> <verb>')`, plus the automatic `api-dispatch` span. Pick one: keep the handler's `Effect.fn` name and make the adapter span opt-in, or name the adapter span and require handlers to use `Effect.fnUntraced`.
   Mixed tracing stacks: imperative `withSpan`/`traced` inside Effect-run code (background-jobs history.ts:144, secret-cli-runner, mcp-servers local-process, annotations ×4).
6. **Hand-rolled concurrency primitives** — promise-chain mutexes (reconcile.ts:15, durable-task-runner.ts:34, activity service.ts:96), boolean guards (history.ts:141), refcounted in-flight maps (secret-operations.ts:121-170, keyed-effect-lock.ts), poll loops (service.ts:316, durable-task-runner.ts:218, durable-task-store.ts:255, chrome-launch.ts:161), `setTimeout` batching/deadlines (activity service.ts:141, managed-process.ts:46, secret-cli-runner.ts:61).
   Map: mutex→`Semaphore`; keyed mutex→shared `KeyedMutex` (opencode shape) in dshx; in-flight dedupe→`Cache`; batching→`Queue`+`Stream.groupedWithin`; polls→`SubscriptionRef.changes`/`Schedule`; deadlines→`Effect.timeout*`.
7. **AbortSignal plumbing through Effect APIs** — agent-questions (`signal` in every request type), secret-catalog (`(signal) => Promise`), project-checks (`signal` in ReceiptOptions). Use fiber interruption; convert to/from `AbortSignal` only at the Promise edge (tryPromise's `signal` arg).
8. **`Layer.empty` / `Layer.succeed({ context: ctx })`** — the layer graph is fake in mcp-servers, agent-communication, project-checks, session-controller. Each unit needs one `*Edge.layer(ctx)` that does all `ctx.get` and the domain layers depend on typed edge services.
9. **Platform** — node:fs in background-jobs, activity-timeline, editor, project-checks store, annotations; `fetch` in annotations + mcp-servers oauth; raw `SubprocessRuntime` in project-checks, secret-catalog, mcp-servers. dshx already ships `Subprocess.spawnScoped` (services.ts:86-92) that **no unit uses**.
10. **Repeat-on-failure** — any `Effect.repeat` over a fallible effect must `catchCause` first (agent-communication bug). Add a lint/ast-grep rule: `Effect.repeat(Effect.tryPromise(` / `.pipe(Effect.repeat` without preceding catch.
11. **Tests** — no `it.effect`/`it.layer`; tests exercise Promise classes. After each service migration, add `@effect/vitest` layer tests with real implementations over a temp dir / in-memory storage layer.

## 4. Ordered migration steps

| #   | step                                                                                                                                                                                                                                                               | depends on     | verify                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | dshx: add `cause: Schema.Defect` to `EffectHostServiceError`; add `KeyedMutex` (opencode keyed-mutex.ts shape) + `ToolAdapter`/prompt support to `DshxEffect.plugin` so tools/prompts run on the plugin runtime; make the adapter span configurable (dedupe spans) | —              | `pnpm --dir tooling/dshx/packages/dshx test --run`; `it.effect` tests for KeyedMutex (same key queues, different keys parallel, entry removed when idle, interruption releases) |
| 2   | **agent-communication repeat fix** (one-line `catchCause` before `repeat`) — ship independently, it's a bug                                                                                                                                                        | —              | `it.effect` with a failing maintenance effect + `TestClock.adjust` proves the loop survives                                                                                     |
| 3   | background-jobs → exemplar: HistoryIndex as service on `FileSystem` with `Semaphore`; `SubscriptionRef` rows; wait via `changes`; change events via `Stream.debounce`; tagged errors with cause                                                                    | 1              | `pnpm --dir plugins/@dshfiles/background-jobs test --run` + new `it.layer` tests on a temp sessions dir; `background_jobs_wait` live smoke                                      |
| 4   | agent-questions: replace keyed-effect-lock with dshx KeyedMutex; make ParentQuestions/ParentFeedback native services on QuestionStore/QuestionRuntime; tools via plugin runtime; delete WeakMap/singleton/`context.provide`                                        | 1              | existing service/storage tests ported to `it.effect`; interruption test (cancel while waiting ⇒ `cancelled`)                                                                    |
| 5   | activity-timeline: store on FileSystem + Semaphore; ingest Queue+groupedWithin+Deferred; PubSub listeners; decode union members (no casts)                                                                                                                         | 1              | service.test.ts ported; batch flush on scope close test                                                                                                                         |
| 6   | mcp-endpoint + editor (small): Effect stores on `PluginStorage`/`FileSystem`, typed errors, drop manual PluginApiError mapping, runtime-captured edges                                                                                                             | 1              | unit tests + `mcp_endpoint_status`, `editor_write` conflict path                                                                                                                |
| 7   | secret-catalog: `SecretCli` on `Subprocess.spawnScoped` + timeout; `Cache` for list; writes under Semaphore; tools from runtime                                                                                                                                    | 1              | cli-runner + operations tests as `it.effect` (shared list interrupted when all callers interrupted; write invalidates)                                                          |
| 8   | annotations: scoped store layer, Cache-backed source resolver, HttpClient for CDP probe, store outcomes as tagged errors                                                                                                                                           | 1              | store/ingest tests; Chrome launch smoke in scratch DSH                                                                                                                          |
| 9   | agent-communication full: services + Refs/Cache for module state; setup without async iterator                                                                                                                                                                     | 1,2            | integration.test.ts ported; unread nudge live check                                                                                                                             |
| 10  | mcp-servers: McpManager with per-server child Scopes + Semaphore around compute+apply (fixes stale-target race), LocalCommands on spawnScoped, token refresh Schedule, OAuth HttpClient                                                                            | 1              | core.test.ts + new race test (two reconciles, slower first ⇒ newest wins); live connect/disconnect                                                                              |
| 11  | project-checks: edge layer, ReceiptStore, ActionRunner on spawnScoped, DurableTasks on Queue/FiberMap/Semaphore, claim via acquireRelease+retry; delete 6 WeakMaps                                                                                                 | 1, 3 (pattern) | durable-task-* tests ported; kill-during-run test proves process group terminated + task `cancelled`; Host-restart recovery test                                                |
| 12  | session-controller: type the native adapter error (`NativeSessionControllerError{operation, cause}` + code mapping), split the ctx bag into services; re-run `node scripts/native-fork-diff.mjs session-controller`                                                | 1              | fork diff clean; sessions-host tests                                                                                                                                            |

Verification note: evidence above is static (source + grep + `native-fork-diff.mjs`, exit 0). No tests were run; no repo files were edited.
