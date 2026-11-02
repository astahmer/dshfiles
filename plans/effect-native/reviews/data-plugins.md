# Effect review — data/IO plugins (Host halves)

Repo: `/Users/astahmer/dev/dshfiles-threads/thread-72c437` (read-only). Paths below are relative to `plugins/@dshfiles/` unless absolute.
Effect reference: `~/.references/effect-4.1.0/packages`. opencode: `~/.references/opencode/packages/core/src/database`.

**API-name correction for the whole plan.** Effect 4.1.0 has no `effect/unstable/*` entry points. The package exports `effect/sql`, `effect/http`, `effect/process`, `effect/rpc`, `effect/workers` (`effect/package.json:43-57`), and the core modules (`Cache`, `FiberMap`, `FiberHandle`, `RcMap`, `ScopedRef`, `Semaphore`, `SubscriptionRef`, `PubSub`, `Schedule`) live at the top level (`effect/src/*.ts`). The Node SQLite driver is the separate `@effect/sql-sqlite-node@4.1.0`. It is built on **`node:sqlite`**, the driver every unit already uses (`sql/sqlite-node/src/SqliteClient.ts:1-16,36`). The Node HTTP server, worker and filesystem layers are in `@effect/platform-node@4.1.0` (`NodeHttpServer.ts:801`, `NodeWorker.ts:118`). Neither package is installed in the repo yet (only `effect` and `@effect/vitest` are present in `~/dev/dshfiles/node_modules/.pnpm`).

## 1. Summary

| Unit (Host)           | Verdict                                                       | Effect-native % | Top 3 problems                                                                                                                                                                               | Effort |
| --------------------- | ------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| backlog               | **schema-only** (worse than facade: no Effect runtime at all) | ~2%             | module singletons + promise write chain; setInterval loops plus fire-and-forget `void …catch`; a hand-rolled backfill job registry `Map`                                                     | L      |
| memory                | **facade**                                                    | ~10%            | `liftHandler` turns every Promise handler into an Effect (26×); `Effect.sync(() => setup(ctx, services))` over module lets; the 1.0k-line runtime uses timers and Maps of in-flight promises | L      |
| traces                | **schema-only**                                               | ~0% runtime     | `node:http` receiver state machine (generation counter, retry timer); 2 hand-rolled SQLite stores; setInterval prune and alert loops                                                         | L      |
| usage                 | **partial**                                                   | ~30%            | a mutable service record holding a `pass: Promise` lock; errors drop `cause`; a dead imperative twin of the OTLP exporter kept only for tests                                                | M      |
| session-search        | **partial** (best of set)                                     | ~45%            | a hand-rolled worker RPC (pending Map, setTimeout timeouts); `ctx.on` registered in `Effect.sync` with no release; a debounce loop built on a mutable `lastNudgeAt`                          | M      |
| thread-sidebar (Host) | **schema-only**                                               | ~3%             | 6 module singletons (restart timer, attention store, scanner, plugin-update watch…); `void …catch(() => undefined)` swallowing; raw `child_process`/`fs`                                     | L      |
| settings-shell (Host) | **schema-only**                                               | 0%              | hand-rolled TTL cache plus in-flight dedupe for the release check; raw `fetch` with a streamed size cap; sync `fs` in a handler                                                              | S      |
| worktree-memory       | **schema-only**                                               | 0%              | TTL probe cache keyed by a promise; a detached `setTimeout` SIGKILL escalation; raw `ctx.subprocess` and `fs`                                                                                | S/M    |
| prompt-stash (Host)   | **schema-only**                                               | 0%              | the same `let opening` storage-domain singleton as backlog and attention                                                                                                                     | S      |
| agent-telemetry       | **partial** (shell is reasonable)                             | ~50%            | `catch: () =>` drops cause; mutable closure state in the layer; settings singleton. The coordinator stays sync by design                                                                     | S      |

The previous wave was mostly a zod→Schema conversion for these units. Only usage, session-search, agent-telemetry and (as a facade) memory gained an Effect runtime. Backlog, traces, thread-sidebar Host, settings-shell, worktree-memory and prompt-stash import `effect` only for `Schema`/`Option`/`Result`. Examples: `traces/src/*` imports only `effect/Schema*`, `effect/Option` and `effect/JsonSchema`; `backlog/src/host.ts` has no `effect` import. **None of the 10 units uses `@effect/vitest`; 25 test files use `vi.fn/mock/spyOn`.**

---

## 2. Per unit

### 2.1 backlog (`backlog/src/host.ts` 1077 L, `store.ts` 919, `triage.ts` 290, `jev-client.ts` 89)

Findings

- **R1** Module singletons: `host.ts:84` `let opening: Promise<OpenedBacklog>`, `:85` `aiActivity`, `:129` `let settingsScope`, `:265` `backfillJobs = new Map`, `:508` `seenMain = new Map`, `:890` `activeTweetContextImports = new Set`. The comment at `:57-61` (one store per process because handler and setup contexts differ) is exactly what a plugin-scoped Layer solves.
- **R1** Fire-and-forget: `void triageItem(...).catch(logFailure)` `:401`, `:433`, `:465`, `:476`, `:498`, `:1056`, `:1066`, `:1071`; detached backfill IIFE `void (async () => {...})()` `:302-344`.
- **R2** No services. Every function takes `ctx: Context` and calls `ctx.get('storageDomain'|'llm'|'secretCatalogValues')` inline: `:88`, `:159`, `:188`, `:194`.
- **R4** Errors are plain `throw new Error(...)` (`:89`, `:160`, `:175`, `:293`, `:300`). `logFailure` flattens to `message.slice(0,200)` (`:348`). Store failures are reported via `console.error` (`store.ts:290`).
- **R5** `setInterval` 60 s ticks gated by mutable `lastPoll`/`lastNudge` (`:1049-1069`). A promise write chain is used as a lock (`store.ts:311-318` `writes = result.catch(...)`, `flush: () => writes` `:913`). Backfill concurrency and retention are handled by a hand-rolled `MAX_BACKFILL_JOBS` eviction (`:292-300`). `AbortSignal.timeout(30_000)` handles LLM timeouts (`:169`).
- **R6** Raw `fetch` in `jev-client.ts:66`; jj is run through a helper (`:501`).
- **R7** Promise `withSpan('jev classify')` (`jev-client.ts:52`).
- **R8** Schemas are idiomatic (`item.ts:108` `withDecodingDefaultKey`). The storage-domain edge still needs `zodSchemaFromEffect` (`store.ts:30-36`), a native-forced boundary. `jev-client.ts` duplicates `memory/src/jev.ts` (same endpoint, schema and span).
- **R9** 68 test files, 2 with mocks, 0 `@effect/vitest`.

TARGET DESIGN

```
BacklogSettings  (PluginSettings<BacklogSettings>: get, changes: Stream)          ← shared dshx (§3 C)
BacklogItems     (KvTable<BacklogItem>, KvTable<File>)  make: StorageDomain.open  ← shared dshx (§3 B)
BacklogStore     { list, get, capture, applyProposal, propose, markTriaged, triageCandidates, … : Effect<_, BacklogError> }
                 make: yield* BacklogItems, BacklogSettings, ActivityPublisher; SynchronizedRef<HashMap<id,item>> mirror
ActivityPublisher{ publish(item,event): Effect<void> }          make: yield* CordisEvents (edge)
Triage           { item(id), resolveThread(session) }           make: yield* BacklogStore, Jev, Llm, BacklogSettings
Jev              { classify(question,text): Effect<number, JevError> }  ← shared lib (§3 E); HttpClient + UsageRecorder
Llm              { complete(req): Effect<string, LlmError> }            make: ctx.get('llm') at edge; Stream from llm.stream
TriageBackfill   { start(req): Effect<JobSnapshot, BackfillBusy>, status(id) }  make: FiberMap<JobId>, Ref<HashMap<JobId,Snapshot>>
LifecycleSignals { pollRevisions, nudgeIdle } → forkScoped Effect.repeat(Schedule.spaced('1 minute')) reading settings each tick
ThreadStart      { start(items, input, caller) }                make: yield* BacklogStore, VcsProvider (port), SessionController(edge)

Layer graph:
BacklogLive = Layer.mergeAll(BacklogStore.layer, Triage.layer, TriageBackfill.layer, ThreadStart.layer)
  .pipe(Layer.provide(Jev.layer), Layer.provide(Llm.layer), Layer.provide(BacklogItems.layer),
        Layer.provide(PluginSettings.layer(backlogSettings)), Layer.provide(CordisEdge.layer(ctx)))
```

Cordis edge: `DshxEffect.plugin({ layer: ctx => BacklogLive.pipe(Layer.provide(CordisEdge.layer(ctx))), setup })`. `setup` does `forkScoped` for the 2 signal loops and registers `ctx.on('session/event')` through one `acquireRelease` (the agent-telemetry pattern, `agent-telemetry/src/host.ts:105-117`) into a `Queue`, drained by a forked consumer. `hostApi(backlogApi, { list: Effect.fn('backlog list')(function* ({ input }) { return yield* (yield* BacklogStore).list(input) }) })`.
Errors: `BacklogStorageUnavailable`, `BacklogItemNotFound{id}`, `BackfillAlreadyRunning`, `TriageUnconfigured{reason}`, `JevRequestFailed{status, cause: Schema.Defect()}`, `LlmCompletionFailed{cause}`, `RevisionPollFailed{repository, cause}`.
Deleted: `opening`/`backlogFor`/`closeBacklog` (`:84-127`), `currentSettings`/`ownedSettings` singleton (`:129-147`), `backfillJobs` + IIFE (`:250-346`), `logFailure`, the 3 `ctx.effect` blocks (`:1049-1076`), the `writes` chain in `store.ts`, and `jev-client.ts` (it becomes the shared Jev client).

Before → after (backfill job):

```ts
// before host.ts:301-344
backfillJobs.set(jobId, job); void (async () => { try { job.state = 'running'; … } catch (e) { job.state = 'failed' } })()
// after
start: Effect.fn('backlog backfill start')(function* (request) {
  if (yield* FiberMap.has(fibers, 'backfill')) return yield* new BackfillAlreadyRunning()
  const jobId = JobId.make(crypto.randomUUID())
  yield* Ref.update(jobs, HashMap.set(jobId, Snapshot.queued(jobId)))
  yield* FiberMap.run(fibers, 'backfill', runBackfill(jobId, request).pipe(
    Effect.tapCause(cause => Ref.update(jobs, HashMap.modify(jobId, Snapshot.failed))), Effect.withSpan('backlog backfill')))
  return Snapshot.queued(jobId)
})
```

### 2.2 memory (`host.ts` 881, `runtime.ts` 1002, `store.ts` 1325, `thread-finder.ts` 637)

Findings

- **R1 facade (central)**: `liftHandler` `host.ts:522-528` wraps each Promise handler with `Effect.tryPromise` (26 handlers, `:847-874`). `setup` runs the imperative function via `yield* Effect.sync(() => setup(ctx, services))` (`:791`), which mutates module `let runtime/store/projectNormalization/failure/settingsScope` (`:40-44`). It then reads them back into `initialized` (`:792-795`). The `MemoryHostServices` layer is `Layer.succeed(…, hostServices(ctx))`, a closure bag over `ctx` (`:785-788`).
- **R1** Finalizer with `Effect.promise(async () => { … .finally(...).catch(...) })` (`:806-818`).
- **R2** `createMemoryRuntime` (`runtime.ts:101`) is a closure object over `services`; `openMemoryStore` (`store.ts:276`) is a closure over `DatabaseSync`.
- **R4** `MemoryOperationError{operation,message}` (`host.ts:514-520`) flattens `String(error)`, has no cause, and gets one tag for every failure. Handlers `throw new Error` (`:510`, `:577`, `:638`, `:659`). 30+ `.catch(() => undefined|null|[])` swallow sites (e.g. `host.ts:78,108,127,149,155,172`; `runtime.ts:443,444,510,534,601,662,850,947`).
- **R5** Debounce by `idleTimers = new Map<string, Timeout>` (`runtime.ts:110,318-327`); in-flight dedupe `digesting = new Map<string, Promise>` (`:111,329-340`); `projects` promise cache (`:112`); `embedders` Map with self-eviction (`host.ts:71,253`); `pricingLoaded ??=` (`:272-282`). The daily retention loop is `Effect.repeat(Effect.sleep(day).pipe(andThen(maintain)), Schedule.forever)` (`:839`); it should be `Effect.repeat(maintain, Schedule.spaced('1 day'))` or `Effect.schedule`.
- **R6** `mkdirSync` (`store.ts:277`); `dshHomePath` paths.
- **R7** Triple span per API call: dshx `api-dispatch`, then `dshx-effect memory.<m>` (`tooling/dshx/packages/dshx/src/effect/index.ts:123`), then `Effect.fn('memory <op>')` (`host.ts:523`).
- **R8** Rows are mapped by hand: `String(row['id'])` appears 51× in `store.ts` (e.g. `:340-345`) instead of a row `Schema.Struct` decoded once.
- **Storage** `store.ts:276-325`: `new DatabaseSync`, `pragma journal_mode=wal; busy_timeout=5000`, schema by `create … if not exists` plus ad-hoc `hasColumn`→`ALTER` (`:282-288`) with **no version table**, a statement cache `Map` (`:294-301`), and a hand-rolled `transaction()` with `begin immediate/commit/rollback` (`:313-323`, used 10×). `bench/host-loop-freezes.ts` exists to measure event-loop stalls; reuse it.

TARGET DESIGN

```
MemoryDb        = SqliteStore.layer({ filename: memory.db, migrations: MemoryMigrations })      ← shared (§3 A)
MemoryRepo      { putThread, addNote, updateNote, listNotes, search, prune, rekeyProjects, … }  make: yield* SqlClient; SqlSchema.findAll/findOne with row Schemas
MemorySettings  = PluginSettings.layer(memorySettings)
SessionLogs     { read(id): Effect<Option<SessionLog>>, list }      make: ctx.get('sessionQuery'|'sessionController') at edge; Cache(capacity N) replaces logCache array
ProjectPaths    { of(cwd) }                                         make: Cache.make({ lookup: projectPathFor }) replaces `projects` Map
Embedder        { embed(texts) }                                    make: RcMap.make({ lookup: loadEmbedder }) replaces `embedders` Map
Digester        { schedule(sessionId), digest(sessionId) }          make: FiberMap<SessionId> — schedule = FiberMap.run(map, id, Effect.sleep(idle).pipe(andThen(digest(id))))  (re-run interrupts = debounce);
                                                                    digest dedupe = FiberMap.run(..., { onlyIfMissing: true })
Recall          { startBlock(agent), search, findThreads, related } make: yield* MemoryRepo, SessionLogs, Embedder, Jev
Maintenance     forkScoped: Effect.schedule(retention, Schedule.spaced('1 day')); catchUp(25) after Effect.sleep('30 seconds')

MemoryLive = Layer.mergeAll(Recall.layer, Digester.layer, Maintenance.layer)
  .pipe(Layer.provideMerge(MemoryRepo.layer), Layer.provide(MemoryDb), Layer.provide(Embedder.layer),
        Layer.provide(SessionLogs.layer), Layer.provide(ProjectPaths.layer), Layer.provide(PluginSettings.layer(...)))
```

Cordis edge: `DshxEffect.plugin({ layer: ctx => MemoryLive.pipe(Layer.provide(CordisEdge.layer(ctx))) })`. The `system-prompt/assemble` hook is registered once in setup via `acquireRelease(Effect.sync(() => ctx.on(...)), Effect.sync)`. Its body is `runtime.runPromise(Recall.startBlock(agent).pipe(Effect.catchTag(...)))`, and that `runPromise` is the only legitimate edge. If the store open fails, the layer fails; the plugin then reports "memory is off" through `Layer.catchAll`, which yields a `MemoryDisabled` service.
Errors: `MemoryStoreOpenFailed{path,cause}`, `NoteNotFound{id}`, `NoteNoLongerValid{id}`, `InvalidDateFilter{value}` (replaces the throw at `:510`), `MemoryInactive`, `DigestFailed{sessionId,cause}`, `SqlError` (from effect/sql, passed through).
Deleted: `liftHandler`, `panelHandlers` Promise map, `setup()` (`:727-783`), module lets `:40-44`, `idleTimers`/`digesting`/`projects`/`embedders`/`pricingLoaded` Maps, the store's statement cache, the `transaction()` helper and the hasColumn/ALTER block (these become migrations `0002_message_excerpt` and `0003_note_archive`).

Before → after:

```ts
// before host.ts:522-528, :847-874
const liftHandler = (op, handler) => Effect.fn(`memory ${op}`)(ctx => Effect.tryPromise({ try: () => Promise.resolve(handler(ctx)), catch: e => memoryOperationError(op, e) }))
hostApi(memoryApi, { notes: liftHandler('notes', panelHandlers.notes), … })
// after
hostApi(memoryApi, {
  notes: ({ input }) => MemoryRepo.use(repo => repo.listNotes(NoteFilter.fromInput(input))),  // span comes from dshx-effect wrapper only
  createNote: ({ input }) => Effect.gen(function* () { const repo = yield* MemoryRepo; const note = yield* repo.addNote(input); yield* Embedder.queueMissing; return note }),
})
```

### 2.3 traces (`store.ts` 1177, `receiver.ts` 365, `host.ts` 201, `alerts/*` ~700, `otlp/*` ~1100)

Findings

- **R1** Module state: `host.ts:21-22` `let runtime`, `let settingsScope`, `:72` `let withdrawEndpoint`; `alerts/alerts-host.ts:14` `let runtime`. Setup returns a hand-made async iterator disposer (`host.ts:177-193`) instead of a Scope.
- **R2** `openTraceStore`, `OtlpReceiver.create`, `createAlertEngine` and `openAlertStore` are closure factories. `requireRuntime()` appears in every handler (`host.ts:100-151`, `alerts-host.ts:33-38`).
- **R4** `RequestRejection` class plus `status` (`receiver.ts:60-86`); `AlertStoreError` is translated with try/catch (`alerts-host.ts:22-29`); `describeError` gives `String(error).slice(0,300)` (`receiver.ts:126`).
- **R5** Receiver lifecycle is a hand-written state machine: a `generation` counter, `retryTimer` with `setTimeout(listen, PORT_RETRY_MS)` on `EADDRINUSE` (`receiver.ts:134-145,262-280`), and `void apply()` on settings change (`host.ts:84-86`). Forwarding is `void send(...).then.catch.finally` with a `forwardsInFlight` counter (`receiver.ts:166-199`); that is a `Semaphore.withPermitsIfAvailable(1)` with `MAX_FORWARDS_IN_FLIGHT` permits. Prune runs on `setInterval` (`host.ts:176`); alerts use `setTimeout` + `setInterval` (`alerts-host.ts:71-72`).
- **R6** `node:http createServer` (`receiver.ts:1,266`), raw `fetch` forward, `zlib` callbacks.
- **R7** A per-request span is intentionally skipped for `/v1/traces` (`receiver.ts:230-233`); keep that invariant. **Danger:** `effect/sql` emits one span per statement (`effect/src/sql/Statement.ts:589-624`). Through the dshx tracer bridge those spans would be exported to this same receiver, so traces' SQL must run under `Effect.withTracerEnabled(false)` (`effect/src/Effect.ts:8332`). Otherwise there is a feedback loop.
- **R8** `TracesSchema` (`schema.ts:10-32`) is a bespoke wrapper restating `Schema.decodeUnknownSync`/`decodeUnknownResult`. Use `Schema.decodeUnknownSync(s, { onExcessProperty: 'error' })` directly (`SchemaAST.ts:539`).
- **Storage** `store.ts:385-424` and `alerts/alert-store.ts:64-80` are two copies of the same opener: `mkdirSync 0o700`, 3 pragmas, a `user_version` migration loop with `BEGIN IMMEDIATE`, a chmod 0600 loop over the main/wal/shm files, a statement cache `Map`, and a `transaction()` helper. The same code appears in `usage/src/store.ts:413-455`.

TARGET DESIGN

```
TraceDb   = SqliteStore.layer({ filename: traces.db, migrations: TraceMigrations, legacyUserVersion: true, statementSpans: false })
AlertDb   = SqliteStore.layer({ filename: alerts.db, migrations: AlertMigrations, legacyUserVersion: true, statementSpans: false })
           (two SqlClient instances → tag them: `TraceSql`/`AlertSql` via Context.Service wrapping SqlClient, or Layer.fresh + provide per repo)
TraceRepo   { ingestSpans, ingestLogs, ingestMetrics, list, trace, stats, errorGroups, searchLogs, metricSeries, serviceMap, sessionSummary, prune, clear }
AlertRepo   { rules, save, mute, remove, history }
TracesSettings = PluginSettings.layer(tracesSettings) (changes: Stream)
OtlpIngest  { traces(body,wire), logs, metrics }  pure normalize + TraceRepo; Effect.fn spans only for logs/metrics (never traces)
Forwarder   { forward(signal, body, headers) }  HttpClient (FetchHttpClient.layer) + Semaphore(MAX_FORWARDS_IN_FLIGHT).withPermitsIfAvailable → counters in Ref
Receiver    { status: Effect<ReceiverStatus>, changes: Stream<ReceiverStatus> }
            make: SubscriptionRef<ReceiverStatus>; FiberHandle; Stream.runForEach(settings.changes (dedup by listen config),
                  cfg => FiberHandle.run(handle, serve(cfg)))      // run interrupts previous server = old `generation`
            serve(cfg) = Effect.scoped(acquireRelease(listen(cfg), close)).pipe(Effect.retry({ while: isAddrInUse, schedule: Schedule.spaced(PORT_RETRY) }), Effect.andThen(Effect.never))
            listen via @effect/platform-node NodeHttpServer.layer(() => createServer(...), {host,port}) + HttpRouter for /v1/{traces,logs,metrics},
            or (no new dep) Effect.callback over node:http — both scoped
LocalEndpoint  forkScoped Stream.runForEach(Receiver.changes, publish/withdraw) with acquireRelease for the publish handle
AlertEngine { evaluate, snapshot, feed }  forkScoped Effect.schedule(evaluate, Schedule.spaced(ALERT_INTERVAL)) after Effect.sleep(15s)
Retention   forkScoped Effect.schedule(TraceRepo.prune, Schedule.spaced('10 minutes'))

TracesLive = Layer.mergeAll(Receiver.layer, AlertEngine.layer, Retention.layer, LocalEndpoint.layer)
  .pipe(Layer.provideMerge(TraceRepo.layer), Layer.provide(OtlpIngest.layer), Layer.provide(Forwarder.layer),
        Layer.provide(TraceDb), Layer.provide(AlertRepo.layer.pipe(Layer.provide(AlertDb))),
        Layer.provide(FetchHttpClient.layer), Layer.provide(PluginSettings.layer(tracesSettings)), Layer.provide(ThreadAttention.layer /* HostApiClient */))
```

Errors: `ReceiverListenFailed{host,port,cause}`, `PortInUse{host,port}`, `NonLoopbackRefused{host}`, `OtlpRequestRejected{status: 400|413|415, reason}` (an HttpServerResponse at the router edge), `ForwardFailed{target,status?,cause?}`, `AlertRuleInvalid{code,message}` (replaces `AlertStoreError` + `userFacing`), `TraceNotFound{traceId}`.
Deleted: `createReceiver` state machine (`receiver.ts:126-330`), `host.ts:19-193` module state and the iterator disposer, `alerts-host.ts:14-81` timers, `TracesSchema`, both store openers.
Risk: the OTLP ingest is the hottest write path (every export batch). Bench SqlClient vs raw `DatabaseSync` per batch; keep one transaction per batch (`sql.withTransaction`). If per-statement overhead shows, write the batch with one multi-row `sql.unsafe` insert.

Before → after:

```ts
// before receiver.ts:262-280
const listen = (attempt) => new Promise(settle => { … if (error.code === 'EADDRINUSE') { retryTimer = setTimeout(() => void listen(attempt), PORT_RETRY_MS) } … })
// after
const serve = Effect.fn('otlp receiver serve')(function* (config: ListenConfig) {
  yield* Effect.scoped(Layer.launch(HttpRouter.serve(otlpRoutes).pipe(Layer.provide(NodeHttpServer.layer(createServer, config)))))
}, Effect.retry({ while: e => e._tag === 'ServeError' && isAddrInUse(e.cause), schedule: Schedule.spaced(PORT_RETRY) }))
yield* settings.changes.pipe(Stream.map(listenConfigOf), Stream.changesWith(ListenConfig.equivalence),
  Stream.runForEach(config => FiberHandle.run(server, serve(config))), Effect.forkScoped)
```

### 2.4 usage (`host.ts` 254, `store.ts` 1668, `indexer.ts` 139, `otel-exporter.ts` 322)

Findings

- **R1** The service value is a mutable record: `syncedToolSources`, `pass: Promise|null`, `lastIndexedAt` and `lastError` are mutated in place (`host.ts:39-48`, `:59-84`). Its layer is `Effect.acquireRelease(Effect.sync(() => { open store; build Promise clients }))` (`:100-134`), which is an imperative construction lifted into Effect. Release uses `Effect.promise(async () => { await active.pass; close })` (`:130-133`).
- **R1** `OtlpMetricsExporter.start` (`otel-exporter.ts:213-322`) is a full setTimeout/AbortController implementation. The host uses only `.effect` (`host.ts:220`); `.start` survives for 8 tests (`otel-exporter.test.ts:155-311`). That is a dead twin and must be deleted, with its tests ported to `it.effect` + `TestClock`.
- **R4** `catch: () => new UsageStoreFailure({message:'…'})` drops cause (`:57`, `:194`); `catch: error => error` puts `unknown` in E (`:237`); `Cause.squash` is pushed to a string (`:240`).
- **R5** `runPass` uses a promise lock for in-flight dedupe (`:59-84`); it should be a `Semaphore(1)` + `withPermitsIfAvailable`, or an `Effect.cached`-per-pass via `FiberHandle.run(…, { onlyIfMissing: true })`. `indexLoop` is `Effect.forever(… sleep)` (`:234-246`), which is `Effect.schedule(Schedule.spaced('30 seconds'))`. The indexer yields to the event loop with `setImmediate` promises (`indexer.ts:22`); use `Effect.yieldNow`.
- **R6** `readdir/stat` from `node:fs/promises` are injected manually (`host.ts:1,25`); use `FileSystem`. `fetch` is used in the exporter.
- **R7** `Effect.fn('usage requests read')(({input}) => Effect.gen(function* () {…}))` (`:158-210`) is a double wrapper; use `Effect.fn('…')(function* ({ input }) {…})`. It is also a triple span with dshx-effect + api-dispatch. `withSpan('usage index')` Promise spans in `indexer.ts:123`.
- **R8** `decodeStoreValue` wrapper (`store.ts:162`).
- **Storage** opener `store.ts:413-455` is identical to traces (user_version loop, chmod, statement cache, transaction).

TARGET DESIGN

```
UsageDb       = SqliteStore.layer({ filename: usage.db, migrations: UsageMigrations, legacyUserVersion: true, statementSpans: false })
UsageRepo     { requests, charts, activity, jevUsage, recordJevUsage, otelMetrics, counts, syncToolSources, reconcileLiveCalls, pruneTelemetry, insertLiveCall }
SessionLogFiles { discover(root): Stream<Path>, readFrom(path, offset, size) }  make: yield* FileSystem
Pricing       { update, fetchedAt }       make: yield* UsageRepo, AiAccounts (HostApiClient), HttpClient
Indexer       { pass: Effect<void, IndexFailed>, status: Effect<IndexStatus> }
              make: SubscriptionRef<IndexStatus>, Semaphore(1); pass = sem.withPermitsIfAvailable(1)(doPass) — refresh API awaits a running pass via Deferred
ToolRegistry  { snapshot: Effect<Option<ToolSources>> }  make: HostApiClient(dshxRegistryApi)
OtlpExporter  forkScoped Effect.schedule(exportOnce, backoffSchedule) — backoff as Schedule.exponential(...).pipe(Schedule.either(Schedule.spaced(interval))) instead of modifyDelay over mutable counters (otel-exporter.ts:155-211)
LiveCalls     acquireRelease(Effect.sync(() => ctx.on('llm/stream', …)), dispose)  — interceptor body stays sync (hot path)
```

Errors: `UsageStoreFailed{operation, cause}`, `IndexPassFailed{cause}`, `JevCallerRejected{caller}` (a tagged error, not `PluginApiError` constructed inside Effect at `:167`), `OtlpExportFailed{status?,cause}`.
Deleted: the `UsageRuntimeState` mutable record, `runPass`, `indexLoop`, `OtlpMetricsExporter.start` + tests, `storeOperation`, `decodeStoreValue`, the store opener.

### 2.5 session-search (`host.ts` 162, `worker-client.ts` 192, `index-db.ts` 672 (worker side), `search-worker.ts` 166)

Findings

- **R1** `ctx.on('session/event', …)` is registered inside `Effect.sync` with the disposer discarded (`host.ts:138`), so no release is tied to the plugin Scope (compare agent-telemetry `host.ts:105-117`). `engine: () => engineOf(ctx)` is a closure over `ctx` in the service (`:87`). `ctx.logger.warn` is called inside effects (`:81,103,120,127,133`).
- **R4** `catch: error => error` puts `unknown` in E 4× (`:102,115,132,156`); `String(error)` (`:103,133`). `SearchWorkerError extends Error` with a `code` (`worker-client.ts:26-33`) should be a `Schema.TaggedError` union.
- **R5** Hand-rolled worker RPC: a `#pending = new Map<number, PendingRequest>` with a per-request `setTimeout` timeout and `postMessage` (`worker-client.ts:76,138-150`). `effect/rpc` has `RpcClient.layerProtocolWorker` / `RpcServer.layerProtocolWorkerRunner` (`effect/src/rpc/RpcClient.ts:1701`, `RpcServer.ts:1696`) plus `NodeWorker.layer` (`platform/node/src/NodeWorker.ts:118`), with schema'd requests, interruption and timeouts. The debounce is a mutable `lastNudgeAt` loop (`host.ts:92-107`); use `Stream.fromQueue(nudges).pipe(Stream.debounce('500 millis'), Stream.runForEach(nudge))` (`Stream.ts:8296`).
- **R6** `new Worker` from `node:worker_threads`.
- **R7** `Effect.fn('session search health')(() => Effect.gen(...))` double wrapper (`:150-151`).
- **R9** `host-effect.test.ts` uses plain vitest + `createTestHost`; 2 files with mocks.
- **Storage** `index-db.ts:249-257`: worker-owned `DatabaseSync`, WAL, `exec(SCHEMA)`, no versioning. The worker split is the right answer to `node:sqlite` blocking (see §3 A caveat). Keep the worker, but make the worker side an Effect `WorkerRunner` using the same `SqliteStore` layer.

TARGET DESIGN

```
SearchRpcs = RpcGroup.make(Rpc.make('Nudge'), Rpc.make('StartIngest',{payload:{root}}), Rpc.make('Search',{…}), Rpc.make('Health',{success: IndexHealth}), …)
SearchClient  make: RpcClient.make(SearchRpcs) over RpcClient.layerProtocolWorker({ size: 1 }) + NodeWorker.layer(spawn)
Worker side   RpcServer.layer(SearchRpcs, handlers) + RpcServer.layerProtocolWorkerRunner + NodeWorkerRunner.layer, handlers over IndexRepo(SqliteStore)
Nudger        forkScoped Stream.fromQueue(q).pipe(Stream.debounce('500 millis'), Stream.runForEach(() => client.Nudge()))
EngineRegistration acquireRelease(ctx.plugin(SessionSearchEngine,…), dispose)  (edge, unchanged)
```

Errors: `WorkerClosed`, `WorkerTimeout{ms}`, `WorkerCrashed{exitCode}`, `IngestStartFailed{cause}`, `ServiceOwnedElsewhere` (replaces the logger.error branch).
Deleted: `SearchWorkerClient` class (192 L), the nudge loop, the protocol framing in `protocol.ts`.

### 2.6 thread-sidebar — Host part (`host.ts` 434, `attention-host.ts` 58, `attention-store.ts` 230, `auto-settle-host.ts` 178, `restart*.ts`, `plugin-updates.ts` 211, `thread-actions-host.ts` 215, `thread-views-host.ts` 136, `json-file.ts` 37)

Findings

- **R1** Singletons: `host.ts:70` `pendingRestart` (with its `setInterval` `:81`; the plan claims "restart timer scoped", but it is still a module `let` cleared by `ctx.effect` `:339-346`), `:209` `machineName`, `:214-216` `pluginUpdates`/`servedClientRevisions`, `:273` `autoSettleScanner`; `attention-host.ts:17` `opening`; `thread-actions-host.ts:15` `hostContext`; `thread-views-host.ts:119` `WeakMap<ThreadViewsSettingsPort, Controller>`.
- **R1** `void opening.then(...).catch(() => undefined)` (`host.ts:351,355,384,392,396`) silently drops attention and inflight-turn write failures.
- **R4** Errors are thrown as `Error`; failures are swallowed to `undefined`.
- **R5** Restart drain polling via `setInterval` + `idlePolls` (`:74-96`) is `Effect.repeat(check, Schedule.spaced('2 seconds')).pipe(Effect.timeout('30 minutes'))` in a `FiberHandle`. The resume `setTimeout` (`:383`) should be `Effect.sleep` + forkScoped. `attention-store.ts:106-119` is the same Map-mirror + `enqueue` write chain as backlog.
- **R6** `execFile('scutil')` via promisify (`:191-201`); `fs/promises` in `restart.ts`, `plugin-updates.ts`, `json-file.ts` (atomic write = `FileSystem.writeFileString` to a temp file + `rename`).
- **R8** `SchemaHelpers.strictStruct` (`schema-helpers.ts`) reimplements `onExcessProperty: 'error'` with a filter plus an `as` cast. Delete it.

TARGET DESIGN

```
ThreadAttention   KvTable via StorageDomain (§3 B) + SynchronizedRef mirror; API = Effect handlers
InflightTurns     { start, end, promote }  make: FileSystem (json-file) — writes serialized by Semaphore(1)
RestartDrain      { request, cancel, availability }  make: FiberHandle; request = FiberHandle.run(h, drainThenRestart, { onlyIfMissing: true })
AutoSettle        forkScoped Effect.schedule(scan, Schedule.spaced(interval from settings.changes)) — scheduleOutsideReload stays an edge adapter
PluginUpdateWatch acquired inside ctx.inject(['clientModules']) via a scoped Layer (LayerMap keyed by registry presence) — or keep ctx.inject edge, but
                  hold watch in a ScopedRef instead of module lets
MachineName       Effect.cached(ChildProcess scutil | os.hostname) (effect/process ChildProcess or dshx Subprocess)
SessionEvents     one acquireRelease(ctx.on('session/event')) → PubSub; ThreadAttention, InflightTurns subscribe (Stream.fromPubSub)
```

Errors: `AttentionStorageUnavailable`, `RestartUnavailable`, `RestartAlreadyPending`, `InflightMarkerWriteFailed{sessionId,cause}`.
Deleted: `attention-host.ts` `opening`/`attentionFor`/`closeAttention`, `pendingRestart` + interval, 3 `ctx.effect` blocks, the `void …catch` sites, `SchemaHelpers.strictStruct`.
Note: `hooks.promptAdmission` is synchronous and Cordis-owned; it must stay sync. Read settled ids from a `SubscriptionRef` snapshot (`SubscriptionRef.get` via `runSync` at the edge, or keep a plain read-only getter fed by the ref).

### 2.7 settings-shell — Host part (`host.ts` 117, `release-status.ts` 158, `settings-tools.ts` 182)

Findings: **R1** `let publishedSearchEntries` (`host.ts:30`), `releaseStatusCache` + `releaseStatusRequest` (`:56-57`). **R5** A hand-rolled TTL plus in-flight dedupe (`:59-78`) is exactly `Effect.cachedWithTTL(check, '1 hour')` (`Effect.ts:7505`), or `Cache.make({ capacity: 1, timeToLive: '1 hour', lookup })` (`Cache.ts:297`). **R6** Raw `fetch` with a manual reader loop and size cap (`release-status.ts:120-157`); use `HttpClient.get` + `HttpClientResponse.schemaBodyJson` with a body-size guard in the stream (`response.stream.pipe(Stream.take…)`). `readFileSync`/`realpathSync`/`existsSync` run in a handler (`host.ts:42-49,95-99`). **R4** `throw writeFailure(error, ns)` inside try/catch (`settings-tools.ts:158-178`).
TARGET: `ReleaseCheck { status: Effect<DshReleaseStatus, ReleaseCheckFailed> }` (HttpClient + cachedWithTTL); `SearchEntries` = `Ref<ReadonlyArray<SectionEntryRow>>`; `SettingsTools` service over a `NativeSettings` edge service (ctx.get('settings')); `InstalledVersions` over FileSystem + `Effect.cached`. Errors: `SettingsUnavailable`, `SettingsReadOnly{namespace}`, `NamespaceUnknown{namespace}`, `SettingsWriteConflict{namespace,cause}`, `ReleaseCheckFailed{status?,cause}`. Effort S.

### 2.8 worktree-memory (`host.ts` 309)

Findings: **R1** `let runtime` (`:47`), a mutable `MemoryRuntime{registry, cached}` (`:39-45`), and an async-iterator disposer (`:295-301`). **R5** `currentProbe` TTL cache keyed by a promise with self-eviction (`:187-196`); use `Effect.cachedInvalidateWithTTL(probe, SNAPSHOT_TTL)` (`Effect.ts:7578`), where `fresh=true` calls the invalidate. A detached SIGKILL escalation `setTimeout` (`:238-248`) belongs in a `FiberSet` forked in the plugin scope (`FiberSet.run(set, Effect.sleep(KILL_GRACE).pipe(andThen(escalate)))`), so unload interrupts it. `Promise.all` readlink fan-out has no concurrency bound (`:94-101`); use `Effect.forEach(..., { concurrency: 8 })`. **R6** `ctx.subprocess.spawn` directly (`:73-83`), although the dshx `Subprocess.spawnScoped` service already exists (`tooling/dshx/packages/dshx/src/effect/services.ts:69-103`); `fs.readlink/readFile` (`:96,127`). **R4** `catch { return 'unknown' }` (`:131`); `process.kill` try/catch (`:198-205`).
TARGET: `ProcessProbe{ snapshot(fresh), pressure }` (Subprocess + FileSystem + cachedInvalidateWithTTL); `JobTracker` (acquireRelease subscription to `jobs` events → `Ref<HashMap>`; still behind `ctx.inject(['jobs'])` at the edge); `ProcessStopper{ stop(targets) }` (FiberSet escalation). Errors: `ProbeFailed{command,cause}`, `UnsupportedPlatform`. Effort S/M.

### 2.9 prompt-stash — Host part (`host.ts` 72, `store.ts` 103)

Findings: **R1** the third copy of the storage-domain `let opening` singleton (`host.ts:17-35`) plus `ctx.effect(() => { void started.catch(...) })` (`:64-66`). **R8** `effect-stored-value.ts` re-exports `zodSchemaFromEffect` as `boundaryZodSchema` (a pure alias, `:10`); delete the alias and import from dshx. TARGET: `PromptLibrary` service over `StorageDomain.table(promptStashDomain,'prompts')` (§3 B). The whole Host becomes ~30 lines. Effort S.

### 2.10 agent-telemetry (`host.ts` 126, `coordinator.ts` 893, `telemetry-effect.ts` 13)

Findings: The shell is the most idiomatic in the set: `Layer.effect` + `acquireRelease` (`host.ts:53-87`), `Queue.dropping` + forked `Effect.forever(take)` (`:97-104`), `Effect.repeat(…, Schedule.spaced)` (`:96`), and `ctx.on` disposers in one `acquireRelease` (`:105-117`). Remaining issues:

- **R4** `catch: () => new AgentTelemetryPricingError({ message: 'Pricing catalog reload failed.' })` drops cause (`telemetry-effect.ts:9-12`); `accounts.safe.read().catch(() => undefined)` (`host.ts:63`).
- **R1/R5** Mutable closure state in the layer: `let kinds`, `let lastMissReloadAt` (`:59-60`) should be `Ref`s. The miss-retry throttle (`:68-74`) is `Queue.offer` + a consumer with `Stream.throttle` (`Stream.ts:8576`). `let settingsScope` singleton (`:16-39`).
- **R7** `Effect.fn('agent telemetry pricing reload')` wrapping a single `tryPromise` is fine. `telemetry-effect.ts` is a 13-line module for one function; fold it into a `PricingCatalog` service.
- `coordinator.ts` (span-tree bookkeeping on `llm/stream`, `tools/execute`, `session/event`) is a **synchronous hot-path interceptor**. Keeping it imperative is correct; wrapping each event in a fiber would add cost to every model chunk. Document this as an intentional sync core, not a facade.
  TARGET: `PricingCatalog{ current, reload }` (Ref + Effect.fn reload with `cause`), `AccountKinds` (`Ref<ReadonlyMap>` refreshed with pricing), `TelemetrySettings` (shared §3 C). Effort S.

---

## 3. Cross-cutting patterns (solve once)

**A. Hand-rolled SQLite stores ×7 → one `SqliteStore` layer on `@effect/sql-sqlite-node`.**
Openers: `traces/src/store.ts:385`, `traces/src/alerts/alert-store.ts:64`, `usage/src/store.ts:413`, `memory/src/store.ts:276`, `session-search/src/index-db.ts:249` (worker). Outside these units: `resource-packs/src/store.ts:55` and `project-checks/src/durable-task-store.ts:73`. Each repeats: `mkdirSync(dir, 0o700)`; `new DatabaseSync`; pragmas `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL`; a migration loop over `PRAGMA user_version` with `BEGIN IMMEDIATE` (traces, alerts, usage) or `create if not exists` + `ALTER` probes (memory, session-search); chmod 0600 over the main/`-wal`/`-shm` files; a `Map<string, StatementSync>` cache; a `transaction()` with begin/commit/rollback; and rows decoded by hand.
`@effect/sql-sqlite-node` already provides WAL by default, `busyTimeout` (default 5 s), a prepared-statement `Cache`, a single serialized connection and `BEGIN IMMEDIATE` transactions (`SqliteClient.ts:1-16,106-121`). `effect/sql/Migrator` + `SqliteMigrator.run` handle versioning (`Migrator.ts:106,423` `fromRecord`), and `SqlSchema.findAll/findOne/findOneOption` decode rows with Schema (`SqlSchema.ts:35-157`).
Target: a new library package `@dshfiles/sqlite-store` (kind: library, like `optmem-core`; plugins list it in `host.bundleDependencies`). Precedent: `credential-port`/`vcs-provider-port`. Do not put it in dshx core, which would force the dependency on every plugin, and do not import it across plugins.

```ts
export class SqliteStore {
  static layer(options: {
    readonly filename: string // dshHomePath(...) resolved by caller
    readonly migrations: Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>> // "0001_init", …
    readonly legacyUserVersion?: boolean // adopt PRAGMA user_version N → mark migrations 1..N applied once
    readonly statementSpans?: boolean // default false → Effect.withTracerEnabled(false) around queries
  }): Layer.Layer<SqlClient.SqlClient, SqliteStoreOpenFailed, FileSystem.FileSystem>
}
// make: fs.makeDirectory(dir, { recursive: true, mode: 0o700 }) → SqliteClient.layer({ filename, busyTimeout: '5 seconds' })
//       → sql`PRAGMA synchronous = NORMAL` → adopt user_version (opencode precedent: seeds its journal from __drizzle_migrations, database/migration.ts:52-96)
//       → SqliteMigrator.run({ loader: Migrator.fromRecord(migrations) }) → chmod 0600 on main/wal/shm (opencode database.ts restrictToOwner)
```

The opencode shape to copy is `database.ts:44-97`: `Layer.effect` with pragmas, then a per-file `Semaphore` around migrations, then `Layer.provide(sqliteLayer({filename}))`; plus `sqlite.node.ts:12` (`Layer.orDie(SqliteClient.layer(config))`). Differences: opencode uses Drizzle on top; here plain `effect/sql` tagged templates suffice, because every store is hand-written SQL.
Caveats, stated plainly:

1. `node:sqlite` stays synchronous, so busy waits and long queries still block the Host event loop (`SqliteClient.ts:6-12`). Moving to SqlClient fixes lifecycle, migrations and typing, not loop stalls. Session-search's worker remains the pattern for heavy indexing; measure memory with `memory/bench/host-loop-freezes.ts` and traces ingest before and after.
2. Per-statement spans must be off by default (§2.3 feedback loop; usage/memory volume).
3. Two databases in one plugin (traces + alerts) need distinct tags (wrap each `SqlClient` in its own `Context.Service`).

**B. Storage-domain KV singleton ×3 → dshx `StorageDomain` Effect service.**
Copies: `backlog/src/host.ts:84-127`, `thread-sidebar/src/attention-host.ts:17-46`, `prompt-stash/src/host.ts:17-35`. Each holds the same `let opening: Promise` with the same "one store per process" comment, a `Map` mirror, a promise write chain (`backlog/src/store.ts:311-318`, `thread-sidebar/src/attention-store.ts:106-119`) and `flush()`. dshx already wraps `PluginStorage` (`services.ts:27-48`); add `StorageDomain.open(domain)`, a scoped `acquireRelease(storage.open, close)` exposing `table(name): KvTable` with `entries`, `put` and `delete` as Effects serialized by `Semaphore.make(1)`. The mirror becomes a `SynchronizedRef<HashMap>` owned by each plugin's store service. Ownership moves to the plugin Layer (one per plugin runtime), so the module singleton and its comment go away. The zod bridge (`zodSchemaFromEffect`) stays confined to `defineDomain` calls.

**C. Settings singleton ×4 → `PluginSettings` service with `changes`.**
`let settingsScope` + `currentSettings()` try/catch fallback appears in `backlog/src/host.ts:129-147`, `traces/src/host.ts:22-31,88-98` (plus `scope.watch`), `agent-telemetry/src/host.ts:16-39` and `memory/src/host.ts:44`. dshx `SettingsRead` (`services.ts:167-191`) exists but none of these units uses it, and it lacks change notification. Extend it to `PluginSettings.layer(ownedSettings)`: a `SubscriptionRef<Value>` fed by `scope.watch` inside `acquireRelease`, exposing `get` and `changes: Stream<Value>` (`SubscriptionRef.ts:116,166`). Decode failure falls back to defaults and logs once.

**D. Background work idioms (repeated, no shared code needed — a rule + lint).**

| Hand-rolled                                                            | Effect 4.1                                                                                                                          | Sites                                                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `setInterval` tick + `lastX` gate                                      | `Effect.schedule(work, Schedule.spaced(d))` + `forkScoped`                                                                          | backlog `:1052,:1062`; traces `host.ts:176`, `alerts-host.ts:72`; thread-sidebar `host.ts:81` |
| `Effect.forever(… Effect.sleep)`                                       | `Effect.repeat(work, Schedule.spaced(d))`                                                                                           | usage `host.ts:235`; memory `host.ts:839`                                                     |
| Map of in-flight promises                                              | `FiberMap.run(m, key, eff, { onlyIfMissing: true })` (`FiberMap.ts:783`) or `Semaphore.withPermitsIfAvailable` (`Semaphore.ts:531`) | memory `runtime.ts:111`; usage `host.ts:59`; settings-shell `host.ts:57`                      |
| per-key debounce timers                                                | `FiberMap.run(m, key, Effect.sleep(d).pipe(andThen(eff)))` (re-run interrupts)                                                      | memory `runtime.ts:110,318`                                                                   |
| debounce loop on a queue                                               | `Stream.fromQueue(q).pipe(Stream.debounce(d))`                                                                                      | session-search `host.ts:92`                                                                   |
| TTL cache + promise                                                    | `Effect.cachedInvalidateWithTTL` / `Cache.make({ timeToLive })`                                                                     | settings-shell `:56`; worktree-memory `:187`                                                  |
| detached `setTimeout`                                                  | `FiberSet.run` in the plugin scope                                                                                                  | worktree-memory `:238`; thread-sidebar `:383`                                                 |
| job registry `Map` + IIFE                                              | `FiberMap<JobId>` + `Ref<HashMap<JobId,Snapshot>>`                                                                                  | backlog `:265-346`                                                                            |
| Extend `scripts/check-effect-antislop.mjs` with rules for `setInterval | setTimeout`and`void <expr>.catch(`in`src/host*.ts`and`*-host.ts` files of migrated plugins.                                         |

**E. Duplicate Jev client ×2.** `backlog/src/jev-client.ts` and `memory/src/jev.ts` share the endpoint (`https://api.typesafe.ai/v1/systemone`), answer schema, span attributes and usage recording into `@dshfiles/usage`. Both packages already depend on `@dshfiles/usage`. Share a `Jev` Effect service (HttpClient + `UsageRecorder` via `HostApiClient(usageApi)`), either as a library package (`@dshfiles/jev-client`) or as a dshx module published by usage (`@dshfiles/usage/jev`), since usage owns the Jev usage contract. Backlog's `complete()` (`host.ts:149-180`) and memory's model digest both wrap `ctx.get('llm').stream`; an `Llm.complete` edge service in dshx would serve both.

**F. Errors lose cause everywhere — including the foundation.** dshx `services.ts:41-44,61,83-99,153-161,186` uses `catch: () => failed(service, op)`, so every `PluginStorage`/`Subprocess`/`Communication` failure drops its cause. The same happens in usage `host.ts:57,194`, agent-telemetry `telemetry-effect.ts:11`, memory `host.ts:519-520` (`String(error)`) and session-search (`catch: error => error`). Fix the foundation first: `EffectHostServiceError` gets `cause: Schema.Defect()` (`Schema.ts:9390`), and plugins follow.

**G. Triple spans.** dshx `registerEffectHost` already wraps every handler in `Effect.withSpan('dshx-effect <api>.<method>')` (`effect/index.ts:123`) under the Promise `api-dispatch` span. Plugins then add `Effect.fn('<plugin> <op>')` per handler (memory 26×, usage 8×, session-search 1×). Decide on one: either dshx drops its wrapper span, or handlers use `Effect.fnUntraced`/plain generators. Reserve `Effect.fn` spans for work units below the handler (index pass, digest, ingest batch).

**H. `Effect.fn(name)((args) => Effect.gen(function* () {…}))` double wrapper** in usage `host.ts:158-210` and session-search `host.ts:150`; the form should be `Effect.fn(name)(function* (args) {…})`.

**I. Bespoke Schema wrappers.** `TracesSchema` (`traces/src/schema.ts:10-32`), `decodeStoreValue` (`usage/src/store.ts:162`), `SchemaHelpers.strictStruct` (`thread-sidebar/src/schema-helpers.ts`, with an `as` cast), `boundaryZodSchema` alias (`prompt-stash/src/effect-stored-value.ts:10`). Replace them with direct `Schema.decodeUnknown*` calls, using `{ onExcessProperty: 'error' }` where strictness is needed, and `SqlSchema.*` for rows.

**J. Tests.** 0/10 units use `@effect/vitest`. Migrate per service: `it.layer(Service.layer.pipe(Layer.provide(SqliteStore.layer({ filename: ':memory:', … }))))` with a real in-memory SQLite (no mocks); use `TestClock` for every Schedule/debounce/TTL case, which replaces the ad-hoc fake timers. Effect.fn spans can be verified through dshx `recordSpans()`.

---

## 4. Ordered migration steps (with dependencies and verification)

0. **Foundation fixes (dshx), blocking everything.** (a) `EffectHostServiceError` + `cause`; (b) decide the span policy (G); (c) add `PluginSettings` with `changes` (C); (d) add `StorageDomain` scoped service (B); (e) verify the claim in `backlog/src/host.ts:57-61` that handler contexts differ from setup contexts, by checking that `pluginRuntimes.get(handler ctx)` resolves (memory and usage rely on it today). Verify with `pnpm --dir tooling/dshx/packages/dshx test --run src/effect` plus a new spec asserting the cause round-trip and one span per handler.
1. **`@dshfiles/sqlite-store` library (A).** Add `@effect/sql-sqlite-node@4.1.0` (and `@effect/platform-node@4.1.0` for `NodeFileSystem` and `NodeHttpServer`) to the `pnpm-workspace.yaml` catalog. Implement the layer, the legacy `user_version` adoption and `statementSpans: false`. Verify with `it.layer` tests: a fresh DB, a DB at `user_version=N` that is adopted without re-running migrations, the 0600 mode on sidecars, rollback on a failing migration, and an assertion that no spans are recorded.
2. **usage** (smallest SQLite store with user_version, partial already; Wave C). Port the store to `UsageRepo` over SqlClient (same SQL), then the Indexer with Semaphore and SubscriptionRef, then FileSystem. Delete `OtlpMetricsExporter.start` and port its tests to `TestClock`. Verify: package tests, a copy of a live `~/.dsh/plugins/usage/usage.db` opens and migrates with no row diff (`sqlite3 .dump` before/after), the `usage_status` tool, one span per pass.
3. **traces** (depends on 1 and 2's patterns). Do it in order: (a) TraceRepo/AlertRepo on SqliteStore with tracing off; (b) the Receiver as FiberHandle + scoped server (choose `NodeHttpServer`+`HttpRouter`, or `Effect.callback` over `node:http` without the new dep); (c) Forwarder on HttpClient + Semaphore; (d) Alert/Retention schedules. Verify: `receiver.test.ts`, an SDK fixture export round trip (`otlp/sdk-fixture.test-support.ts`), EADDRINUSE retry under `TestClock`, settings port change rebinding, `traces_status`, and an ingest benchmark compared with the current store (the hot path).
4. **memory** (depends on 1, C, E). Order: Repo/migrations (fold the ALTER probes into migrations 0002/0003 with adoption), then Digester (FiberMap), then Recall, then handlers without `liftHandler`. Verify: `store.test.ts`, `thread-finder.integration.test.ts`, `search-latency.scale.test.ts` (no regression), `bench/host-loop-freezes.ts` before/after, `memory_search` and `memory_start_block` tools in a scratch DSH.
5. **session-search** (depends on 1). Replace the worker RPC with `effect/rpc` over `NodeWorker`; the worker runner uses SqliteStore; the nudger uses `Stream.debounce`; `ctx.on` goes through acquireRelease. Verify: `tests/owned-search.spec.ts`, `conversation-table.spec.ts`, `host-effect.test.ts`, `session_search_health`.
6. **backlog** (depends on B, C, E; Wave B). Order: BacklogStore over StorageDomain, then Triage/Jev, then TriageBackfill, then LifecycleSignals, then ThreadStart, then API. Verify: the 314 package tests, the backfill job lifecycle with `TestClock`, and the `backlog_triage_backfill` plus `_status` tools; the scratch E2E previously timed out, so run `pnpm check:e2e backlog`.
7. **thread-sidebar Host** (depends on B). Order: ThreadAttention, then InflightTurns/FileSystem, then RestartDrain FiberHandle, then AutoSettle schedule. Keep `promptAdmission` sync. Verify: the 546 package tests and the restart drain plus cancel under `TestClock`.
8. **Small Hosts, in parallel after step 0:** prompt-stash (B), settings-shell (Cache + HttpClient), worktree-memory (Subprocess + cachedInvalidateWithTTL + FiberSet), agent-telemetry (cause, Refs, settings). Verify package tests plus each plugin's E2E journey.
9. **Gate.** Extend `check-effect-antislop` with D's rules for Host files of migrated plugins (`setInterval`, `setTimeout`, `void …catch`, module-level `let` in `host.ts`, `catch: () =>`, and `Effect.fn(...)(() => Effect.gen`). Run a trace check (`traces_search` with `sessionId`) to confirm one span per API call, no SQL statement spans and no traces→traces loop.
