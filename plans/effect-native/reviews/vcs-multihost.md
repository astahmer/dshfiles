# Effect review — VCS + multi-host Host halves

Repo: `/Users/astahmer/dev/dshfiles-threads/thread-72c437` (read-only). Paths below are relative to `plugins/@dshfiles/` unless prefixed.
Effect refs verified in `~/.references/effect-4.1.0/packages/effect/src` (abbrev. `E:`), opencode `~/.references/opencode/packages` (`OC:`), t3code `~/.references/t3code` (`T3:`).

Important version correction for the plan: in effect 4.1.0 the process module is **`effect/process`** (`E:../package.json:48` `"./process"`; `E:process/ChildProcessSpawner.ts:276` `class ChildProcessSpawner`), not `effect/unstable/process`. There is no `unstable/` directory in 4.1.0 src. Node impl: `effect-4.1.0/packages/platform/node/src/NodeChildProcessSpawner.ts`.

## 1. Summary

| Unit                  | Verdict                  | Effect-native                                                                   | Top 3 problems                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Effort |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| jj-integration (9.1k) | **facade**               | ~3% (Schema decoders + an `acquireRelease(Effect.sync(imperativeSetup))` shell) | (1) all 24 API handlers are `effectify(Effect.tryPromise(promiseHandler))` with one flattened error (host.ts:1563-1580, 1740-1765); (2) ~15 module-level mutable singletons + `requireThreads()/registryOf()` service locators (host.ts:120,142-176,193-207,367,458-459,884); (3) hand-rolled concurrency: promise-chain repo lock (threads.ts:377-386), promise-chain sync queue (host.ts:717-759), single-flight drain (deferred-integrations.ts:40-86), cleanup job queue (cleanup-jobs.ts:236-290), 4 ad-hoc TTL caches, `mapBounded`, `setTimeout/setInterval` schedulers (host.ts:886-893, 2101-2143; auto-fetch.ts:~123) | L      |
| jujutsu (7.3k)        | **facade**               | ~5%                                                                             | (1) `effectHandler` = `Effect.tryPromise` over async handlers + `JujutsuHandlerFailure` tagged **`'Plugin'`** with only `message` (host.ts:795-814); (2) jj runner is AbortController+setTimeout+try/catch with regex error classification (host.ts:112-174), `ctx` threaded through every function; (3) module singletons outside the Layer (`fixedJjExecutable` host.ts:66, `opening` review-progress-host.ts:18, `workspaceRoots` composer-context-host.ts:54, `pendingInits` repository-init.ts:32) and a mutable `Map` disguised as a service (host.ts:59-64, 817)                                                         | M      |
| multi-host (7.1k)     | **facade** (purest form) | ~2%                                                                             | (1) `DshxEffect.plugin({ layer: Layer.empty, setup: Effect.sync(() => setupHost(ctx, config)) })` (host.ts:1472-1475) + 49 `effectHandler` wrappers (1410-1470); (2) SSH via raw `node:child_process.spawn` + `new Promise` + timers, bypassing DSH's subprocess runtime (connectors/ssh.ts:110, 145-171, 220-232, 248-286); (3) runtime pool / status cache / probe limiter / view leases / store write lock all hand-rolled module state (gateway-pool.ts:13-123, runtime-status-snapshot-cache.ts:7-60, resource-snapshot.ts:5-20, host.ts:203-214,1376, store.ts:102,196)                                                   | L      |

Shared foundation issues that block "native" in all three (fix once in dshx, §3): `pluginRuntimes` WeakMap edge (dshx effect/index.ts:42), `dshx-effect <api>.<name>` span added on top of every `Effect.fn` span (index.ts:123), dshx `Subprocess` service exists but is unused and drops cause (services.ts:67-104), `VcsProviderService` exists but only its own test uses it (vcs-provider-port/src/effect.ts:13-44; index.test.ts:58).

---

## 2. Per unit

### 2.1 jj-integration

**R1 Facade**

- `effectify(name, promiseHandler)` → `Effect.fn(...)(ctx => Effect.tryPromise({ try: signal => handler({...ctx, signal}), catch: e => e instanceof PluginApiError ? e : new JjIntegrationOperationFailure({operation, message: String(...)}) }))` (host.ts:1568-1580); applied to all 24 methods (1740-1765). Business logic stays in `promiseApiHandlers` (1594-1738).
- Layer is `Layer.succeed(JjIntegrationHostServices, makeJjHostServices(context))` where the "service" is an object of **getters re-reading `context.get(...)` on every access** (host.ts:143-169, 1554-1561). The only consumer yields it to call imperative `setupHost` (1557-1559), which immediately writes it into a module `let hostServices` (2169) so the rest of the module can use `requireHostServices()` (193).
- `setupHost` = `Effect.acquireRelease(Effect.sync(() => setupHostLifecycle(...)), lifecycle => Effect.tryPromise(for await dispose...))` (2166-2180); real lifecycle is an async-iterator of disposers (2144-2163) clearing 3 timers, 2 intervals, schedulers, module maps — a Scope re-implemented by hand next to the Effect Scope.
- Module singletons: `integrationProgressByPath` (120), `settingsScope` (142), `hostServices`, `threads`, `isolatedSessionWorkspaces`, `workspaceSync`, `workspaceSyncQueued`, `pendingWorkspaceSyncs`, `workspaceSyncQueue` (170-176), `forkCuts` (367), `locationCache`, `threadStatusCache` (458-459), `sessionActivity` (355), `repositoryViewsCache` (544), `deferredIntegrations` (863), `deferredIntegrationWake` (884), `cleanupRunner` (1236). Teardown resets them conditionally (`if (hostServices === services)` 2154).
- Fire-and-forget: `void deferredIntegrations.drain().catch(...)` (890), `void sweepFinishedThreads().catch` (2106), `void cleanupSettledWorkspaces(...).catch` (2130), `void done.catch(() => undefined)` (1734), `void refresh()` (session-activity-cache.ts:~142).
- vcs-provider-port served as a **Promise** contract (`VcsProviders.contract(...).host({ detect: async ... })` host.ts:1538-1552), not via `VcsProviderService`.

**R2 Services** — none. Domain is `createThreads({ filesystem, executor, bookmark, threadsDirectory, gitWorktree })` closure factory (threads.ts:370-376) + free functions closing over module state. `JjFilesystem` is a re-export of `node:fs` (jj-filesystem.ts:1-18) injected as a "port".

**R3 Layer graph** — single `Layer.succeed` of a getter bag; no provide/merge; no test layers.

**R4 Errors**

- `JjIntegrationOperationFailure{operation, message: String(error)}` drops cause (1563-1578).
- Domain failures thrown as `PluginApiError` with string codes inside async code: `thread-activity-unknown`, `integration-queued`, `thread-active`, `integration-cancelled`, `not-a-thread`, `no-path`, `agent-only`, `not-a-repository`, `workspace-not-found` (790-819, 897, 1450-1468, 1616). `ThreadError extends PluginApiError` with `ThreadErrorCode` union (threads.ts:27-38); `jj` throws `ThreadError('jj-failed', stderr.slice(0,400))` (402-406).
- Control flow via errors: `landThread` _throws_ `integration-queued` after successfully queueing (809-810); `isWaitingForIdleThread` matches `error.code` (860-861).
- ≥41 `try` blocks; swallow patterns `.catch(() => undefined)` (319, 924, 996), `catch { return undefined }` (395-397), `catch { return defaultSettings }` (178-184), activity emit try/catch (237-255).
- Note: dshx edge already maps tagged errors to wire codes via `remoteCode(_tag)` (`ThreadActive` → `thread-active`; tooling/dshx/packages/dshx/src/effect/index.ts:81-95). So a `Schema.TaggedError` per kind can keep **every existing client code** — no wire change.

**R5 Resources/concurrency**

- Per-repo mutation lock = promise chain map (threads.ts:377-386) used by land/discard/provision (678, 976, 1019, 1062, 1426, 1492, 1511, 1624, 1687, 1729) → `KeyedMutex` over `Semaphore` (OC:core/src/effect/keyed-mutex.ts:20-42; used OC:core/src/git.ts:209-212).
- Sync queue: `workspaceSyncQueue = workspaceSyncQueue.then(...)` with coalescing Map + boolean flag (host.ts:717-759) → a `Queue.sliding`/coalescing `Ref<Map>` + one `forkScoped` worker.
- Deferred integrations: Map + `draining` promise + `drainAgain` flag (deferred-integrations.ts:40-86) + debounced `setTimeout` wake (host.ts:886-893) + 30s `setInterval` fallback (2101-2104) → worker fiber draining on a `Queue<Wake>`; debounce = `Stream.debounce`; fallback = `Schedule.spaced('30 seconds')` (`E:Schedule.ts:1240`).
- Cleanup job runner: `queue: Promise<void>` chain + `results` Map of in-flight promises (cleanup-jobs.ts:236-290) → `Semaphore(1)` + `FiberMap` keyed by job id, trail in `SubscriptionRef`.
- Caches: `locationCache`/`threadStatusCache` TTL maps (host.ts:456-511), `repositoryViewsCache` with generation counters (repository-views-cache.ts:10-78), `createSessionActivityCache` with 3 in-flight maps + `AbortSignal.timeout` + `Promise.race` budgets (session-activity-cache.ts:~95-202), `JjReadCache` op-heads memo + in-flight map (jj-read-cache.ts:15-79), `forkCuts` LRU (367-398) → `Cache.make({ lookup, capacity, timeToLive })` (`E:Cache.ts:297`, `invalidate` 994, `invalidateAll` 1284, `refresh` 1196) and `Effect.cachedInvalidateWithTTL` (`E:Effect.ts:7578`); budgets → `Effect.timeout` (`E:Effect.ts:4783`) on a forked shared fiber (`Fiber.join` with timeout keeps the read alive).
- `mapBounded` worker pool (host.ts:483-496) → `Effect.forEach(items, f, { concurrency: 8 })` (`E:Effect.ts:798`).
- Pollers: auto-fetch `arm()` self-rescheduling `setTimeout` (auto-fetch.ts:~103-140), auto-cleanup scheduler (auto-cleanup.ts), sweep `setTimeout`+`setInterval` (host.ts:2140-2143), `ThreadStatusWarmup` timers → `Effect.repeat(Schedule.spaced(...))` forked into the plugin Scope.
- 66 `AbortController/AbortSignal` uses; jj spawn uses `AbortSignal.any([signal, AbortSignal.timeout(120s)])` (host.ts:274).

**R6 Platform** — `node:fs` sync calls in hot paths (`existsSync` on every workspace per scan host.ts:478; `statSync` 1256; `readdirSync` op-heads per read jj-read-cache.ts:39); `node:path`, `node:os` direct. Subprocess via `context.subprocess.spawn` (host.ts:273-289, 691-698, 1410-1419, 1823-1826) — correct runtime (env scrubbing) but no Effect service.

**R7 Tracing** — spans via `withSpan` from `@dshfiles/dshx/tracing` (host.ts:666-681; threads.ts:6) **plus** `Effect.fn('jj-integration <name>')` (1569) **plus** dshx edge `dshx-effect <api>.<name>` (dshx index.ts:123) **plus** automatic `api-dispatch` → 3 nested spans per API call. jj spans: `traceJjExecutor` (jj-span.ts) — fine shape, but duplicated verbatim in jujutsu/src/jj-span.ts (identical `JJ_VALUE_FLAGS`, 4-18).

**R8 Schema** — Effect Schema used for api decoding (api-effect-schemas.ts, schema.ts, json-text.ts); OK. `JsonText.decodeEffect` returns ad-hoc `{success,data}` (host.ts:700-705). zod residue: multi-host publishes `zodSchemaFromEffect` views that jj-integration composes with zod (multi-host/src/api.ts:282-295).

**R9 Tests** — 46 test files, none use `@effect/vitest` (catalog has `@effect/vitest: 4.1.0`, pnpm-workspace.yaml:98). No host-level test of handlers.

**R10 Edges** — `Effect.runPromise*` only in dshx (good), but the plugin's own code never runs inside Effect, so the "edge" is everywhere.

**TARGET DESIGN — jj-integration**

Services (all `Context.Service` + `static layer = Layer.effect(this, make)`):

| Service                                                | Shape (Effect methods)                                                                                                            | Deps (`yield*` in make)                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Jj` (shared, §2.4)                                    | `run(JjCommand) → JjOutput`, `exec(cmd) → string` (fails `JjCommandFailed`)                                                       | `Subprocess` (dshx)                                                                    |
| `JjViewReads` (shared)                                 | `read(cmd)` — op-heads-keyed `Cache`                                                                                              | `Jj`, `FileSystem`                                                                     |
| `RepoLocks`                                            | `withRepo(root)(eff)` (KeyedMutex)                                                                                                | —                                                                                      |
| `ThreadWorkspaces` (today `createThreads`)             | `locate, status, list, bookmarks, provision, landAt, landVerified, discard, discardMany, restore, snapshotFiles, restoreFiles, …` | `Jj`, `JjViewReads`, `RepoLocks`, `FileSystem`, `Path`, `JjSettings`                   |
| `JjSettings`                                           | `get: Effect<Settings>`, `changes: Stream` (SubscriptionRef)                                                                      | `SettingsRead` (dshx)                                                                  |
| `WorkspaceRegistry` / `SessionReads` / `SessionPrompt` | thin Effect ports over `workspaceRegistry`, `sessionController`, `sessionQuery`, `sessionPersistence`, `agents`                   | `CordisHost` (edge only)                                                               |
| `SessionActivity`                                      | `display`, `guard(sessionIds?)`                                                                                                   | `SessionReads`                                                                         |
| `RepositoryViews`                                      | `snapshot`, `refresh`, `invalidate` (`Cache` + `SubscriptionRef<Snapshot>`)                                                       | `ThreadWorkspaces`, `WorkspaceRegistry`, `SessionActivity`                             |
| `IntegrationQueue`                                     | `queue, cancel, progress, history` + worker fiber                                                                                 | `Landing`, `SessionEvents`                                                             |
| `Landing`                                              | `land(input)` (guard → rebase → sync → notify)                                                                                    | `ThreadWorkspaces`, `SessionActivity`, `WorkspaceSync`, `ActivityLog`, `SessionPrompt` |
| `WorkspaceSync`                                        | `enqueue(input)`, `current: Effect<View\|null>` + worker                                                                          | `Subprocess`, `ActivityLog`                                                            |
| `Cleanup`                                              | `preview, start, jobs` (Semaphore(1), trail in SubscriptionRef)                                                                   | `ThreadWorkspaces`, `RepositoryViews`, `SessionActivity`, `WorkspaceRegistry`          |
| `Maintenance` (scoped layer)                           | forks auto-fetch, auto-cleanup, sweep, deferred fallback via `Schedule`                                                           | `Cleanup`, `ThreadWorkspaces`, `JjSettings`, `IntegrationQueue`                        |
| `ActivityLog`                                          | `emit(event)` (never fails)                                                                                                       | `CordisHost`                                                                           |
| `AutoIntegration` (scoped layer)                       | subscribes `project-checks/verified`                                                                                              | `Landing`, `ProjectChecksClient` (HostApiClient)                                       |
| `VcsProvider` impl                                     | Effect handlers for the port                                                                                                      | `ThreadWorkspaces`                                                                     |

Layer graph:

```
CordisHostLive(ctx) ── Subprocess.layer ── SettingsRead ── HostApiClient(project-checks, memory)
        │                   │
        ▼                   ▼
 WorkspaceRegistry   Jj ─► JjViewReads ─► RepoLocks
 SessionReads           \       |          /
 SessionPrompt           ▼      ▼         ▼
 ActivityLog          ThreadWorkspaces (FileSystem, Path from NodeServices)
        \                 │
         ▼                ▼
     SessionActivity ─► RepositoryViews
                \         │
                 ▼        ▼
     WorkspaceSync ─► Landing ─► IntegrationQueue (scoped: worker fiber)
                          │            │
                          ▼            ▼
                       Cleanup ─► Maintenance (scoped: Schedule fibers)
                                 AutoIntegration (scoped: event subscription)
JjIntegrationLive = Layer.mergeAll(Maintenance, AutoIntegration, IntegrationQueue, Cleanup, RepositoryViews, VcsProviderLive)
                      .pipe(Layer.provideMerge(DomainLayers), Layer.provide(CordisHostLive(ctx)))
```

Cordis edge: one `CordisHost` service (`Layer.succeed` of `{ ctx }` + `ctx.get(...)` reads) built in `DshxEffect.plugin({ layer: (ctx) => JjIntegrationLive(ctx) })`; Cordis `ctx.on(...)` subscriptions are acquired as `Effect.acquireRelease(Effect.sync(() => ctx.on(...)), off => Effect.sync(off))` inside scoped layers and push into a `Queue`/`PubSub` (`SessionEvents`). Handlers become `Effect.fn('jj-integration land')(function* ({input}) { const landing = yield* Landing; return yield* landing.land(input) })` — no Promise layer.

Error taxonomy (`Schema.TaggedError`, tag → existing wire code via `remoteCode`): `NotARepository`, `NotAThread`, `UnsafePath`, `JjCommandFailed{args,exitCode,stderr(redacted),cause:Schema.Defect()}`, `JjOutputTruncated`, `ThreadActive{blockers}`, `ThreadActivityUnknown`, `IntegrationCancelled`, `WorkspaceNotFound`, `NoPath`, `AgentOnly`, `WorkspaceSyncFailed{cause}`. `IntegrationQueued` becomes a **success variant** of `land` (`{status:'queued'}`) only if the client contract can change; otherwise keep it as a tagged failure (compat). Activity-read failures stay `Option.none()` values (they are not errors).

Deleted: `effectify`, `promiseApiHandlers`, `makeJjHostServices`, `requireHostServices/requireThreads/registryOf`, all module `let`/`Map` state, `mapBounded`, `serialized`, `repository-views-cache.ts`, `session-activity-cache.ts` (as hand-rolled), `jj-read-cache.ts` (moves to shared `JjViewReads`), `deferred-integrations.ts` drain machinery, `cleanup-jobs.ts` runner queue, `auto-fetch`/`auto-cleanup` scheduler shells, `thread-status-warmup.ts` timers, async-iterator disposer, `jj-filesystem.ts`, local `jj-span.ts`.

Before/after (the most important change — repo lock + land):

```ts
// before: threads.ts:377-386 + host.ts:773-858
const locks = new Map<string, Promise<unknown>>()
const serialized = (repoRoot, op) => {
  const next = (locks.get(repoRoot) ?? Promise.resolve()).then(op, op)
  locks.set(
    repoRoot,
    next.catch(() => undefined),
  )
  return next
}
// landThread throws PluginApiError('…', { code: 'thread-active' }) from inside validate()

// after
export class Landing extends Context.Service<Landing, { land: (i: LandInput) => Effect.Effect<LandResult, LandError> }>()('@dshfiles/jj-integration/Landing') {
  static readonly layer = Layer.effect(
    Landing,
    Effect.gen(function* () {
      const threads = yield* ThreadWorkspaces
      const locks = yield* RepoLocks
      const activity = yield* SessionActivity
      const sync = yield* WorkspaceSync
      const log = yield* ActivityLog
      const land = Effect.fn('jj-integration land')(function* (input: LandInput) {
        const location = yield* threads.locate(input.path)
        const thread = yield* requireThread(location) // fails NotAThread
        const outcome = yield* locks.withRepo(location.repoRoot)(
          Effect.gen(function* () {
            yield* activity.requireIdle(location, input.caller) // fails ThreadActive | ThreadActivityUnknown
            return yield* threads.rebase(thread, input.bookmark)
          }),
        )
        if (outcome.status === 'landed') yield* sync.enqueue({ repoRoot: location.repoRoot, revision: outcome.head.commitId })
        yield* log.emit(landedActivity(outcome, input))
        return toLandResult(outcome)
      })
      return Landing.of({ land })
    }),
  )
}
```

### 2.2 jujutsu

**R1** `effectHandler(method, async ({..., state}) => …)` → `Effect.tryPromise({ try: () => handler({...args, state}), catch: e => new JujutsuHandlerFailure({ message: RevisionReads.publicError(e).message }) })` (host.ts:804-814) for 15 methods (828-977). `JujutsuHostState` is a mutable `Map` + `PreviewStore` provided by `Layer.sync` (59-64, 817) — a service holding no behaviour. Setup: `acquireRelease(Effect.sync(() => { void reviewProgressFor(ctx).catch(() => undefined) }), () => Effect.promise(closeReviewProgress))` (819-824) around a **module** singleton (`let opening` review-progress-host.ts:18-49). `DshxEffect.host` handlers use `Effect.tryPromise({ catch: error => error })` (review-progress-host.ts:53-62; composer-context-host.ts:237-253) → `unknown` error channel. `ComposerContextHost.create(runAt)` closure passes `ctx` per call (host.ts:1000; composer-context-host.ts:228-255).

**R2** No services; `ctx` + `repo` + `signal` + `state` threaded as positional params through every function (`runAt(ctx, cwd, identity, args, signal, options)` host.ts:101-110; `readWorkspaces(ctx, repo, signal)` 177; `registerRepo(ctx, path, signal, state)` 190).

**R4** Errors are `new Error('<user message>')` everywhere; the public/private split is a **regex on message prefixes** (`/^(Choose |Invalid |Registered |Selected |Split |Jujutsu |Repository )/` host.ts:167; `RevisionReads.publicError` revision-reads.ts:212). Read handlers convert failures to values `{ failure: { message } }` via try/catch (`load`, `graphPage`, … host.ts:856-907). TaggedError tag is literally `'Plugin'` (795) → wire code `plugin` for every failure. Cause always dropped. 46 `try` blocks.

**R5** `runJjAt`: AbortController + forwarded abort listener + `setTimeout` + `timedOut` flag + `handle.terminate()` in two places + `waitForManagedExit` (host.ts:112-174) → `Effect.timeout` + scoped spawn (interruption terminates). `fixedJjExecutable` single-flight promise (66, 86-99) → `Effect.cached` in `Jj.make`. `state.repos` FIFO eviction at 32 (222-227) → `Cache`/bounded `Ref<HashMap>`. Composer caches: `workspaceRoots` TTL map (composer-context-host.ts:54-83), `composerReads` op-heads + 2s TTL + in-flight map (100-134) — **same idea as jj-integration `JjReadCache`** and with a bug jj-integration explicitly avoided: the shared in-flight read runs under the _first caller's_ signal (124 vs jj-integration threads.ts:390-392). `pendingInits` map (repository-init.ts:32), `writes` promise chain (review-progress-store.ts:49).

**R6** `node:fs/promises` `realpath`/`stat` for identity (host.ts:68-84), sync `statSync/readFileSync/readdirSync` (composer-context-host.ts:100-110).

**R7** `withJjSpan` (jujutsu/src/jj-span.ts) duplicate of jj-integration's; plus `Effect.fn('jujutsu …')` + `dshx-effect …` span.

**R8** `SchemaHelpers` wrapper (schema-helpers.ts:1-31) restates `Schema.withDecodingDefaultType`; `JujutsuOutputModel.parseJsonLines(text, value => value)` decodes jj JSON-lines without a Schema in places (composer-context.integration.test.ts:60, host.ts evolution rows use `Schema.Struct` 37-40 — inconsistent).

**R9** 48 test files incl. real-jj integration tests (fileset/composer/graph-navigation/revision-reads/bookmark-set/repository-init `.integration.test.ts`) — excellent characterization base; none `it.effect`.

**TARGET DESIGN — jujutsu**

| Service                | Shape                                                                                                               | Deps                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `Jj` (shared)          | as §2.4                                                                                                             | `Subprocess`                           |
| `JjViewReads` (shared) | op-heads cache                                                                                                      | `Jj`, `FileSystem`                     |
| `RepositoryIdentity`   | `of(path) → Identity`, `guard(repo)(eff)` (check before+after)                                                      | `FileSystem`, `Path`                   |
| `Repositories`         | `register(path)`, `resolve(repoId)`, `open(path)` (Cache capacity 32)                                               | `Jj`, `RepositoryIdentity`             |
| `RevisionReader`       | `load, graphPage, graphNavigation, relationship, slice, referenceGraph, details, fileStats, editTimes, workingDiff` | `Repositories`, `JjViewReads`          |
| `Mutations`            | `prepare(repoId, action)`, `confirm(repoId, previewId)`; previews in `Cache` (TTL 5 min)                            | `Repositories`, `RevisionReader`, `Jj` |
| `ComposerContext`      | `context(cwd, base)`, `diff(cwd, base)`; workspace-root `Cache` TTL 60s                                             | `Jj`, `JjViewReads`                    |
| `ReviewProgress`       | `snapshot`, `toggle`; scoped layer opens storage domain, `acquireRelease(open, flush+close)`                        | `StorageDomain` (edge)                 |

```
CordisHost(ctx) ─ Subprocess ─ StorageDomain
      Jj ─► JjViewReads
      RepositoryIdentity(FileSystem,Path)
        └─► Repositories ─► RevisionReader ─► Mutations
      ComposerContext (Jj, JjViewReads)
      ReviewProgress (scoped)
JujutsuLive = Layer.mergeAll(Mutations, RevisionReader, ComposerContext, ReviewProgress).pipe(Layer.provide(Shared), Layer.provide(CordisHost(ctx)))
```

Errors: `RepositoryNotFound` (registration expired), `RepositoryMoved` (identity changed), `NotAJujutsuRepository`, `PreviewExpired`, `WorkspaceChanged`, `JjCommandFailed{exitCode, cause}` (**stderr never exposed**: keep redaction as a field-level policy, not by regex), `JjTimedOut`, `JjOutputTruncated`. Public message = the error's own `message` getter; read endpoints that return `{failure}` values use `Effect.catchTags({...})` → value at the handler. Deleted: `effectHandler`, `JujutsuHostState`, `fixedJjExecutable`, `runJjAt` plumbing, regex classification, `withJjSpan`, `composerReads`, module `opening`, `pendingInits`.

### 2.3 multi-host

**R1** Canonical facade: `layer: Layer.empty, setup: (ctx, config) => Effect.sync(() => setupHost(ctx, config))` (host.ts:1472-1475); `setupHost` is a `function` (1494) writing module `configuredProfile` (187, 1495), registering `ctx.inject` callbacks with `scoped.effect(() => { void (async () => {...})().catch(() => undefined); return () => {...} })` IIFE (1500-1517), `process.once('exit', removeLaunchFileSync)` (1511, never removed → listener leak per reload), `ctx.effect(() => async () => { closeLease…; pool.close() })` (1554-1557) — a Cordis disposer beside the Effect Scope that DshxEffect already owns. 49 `effectHandler(name, multiHostPromiseHandlers.x)` (1410-1470). Module state: `activeSessionSources` (188), `viewLeases` + `setTimeout` per lease (203, 1376), `connectionErrors` (206), two status caches (207-213), `resourceProbeLimiter` (214), `pool` (316).

**R4** `MultiHostHandlerError{operation, code, message}` (1391-1395) built by `safeFailure` — an `instanceof` chain over 5 bespoke `Error` subclasses with `.code` (298-312: `DirectoryStoreError`, `RuntimeIdentityError`, `GatewayUnavailableError`, `GatewayRequestError`, `IdentityMismatchError`); cause dropped; unknown errors masked to `runtime-unavailable`. `transportFailures` is a string-code `Set` (163-170) used to decide pool eviction — should be a tag union. ~95 `try` blocks.

**R5** `createGatewayPool` (gateway-pool.ts:13-123): Map of `Promise<Gateway>` + manual lease counts + idle `setTimeout` + generation counters + retry-once loop → **`RcMap.make({ lookup: runtimeId => connectAndVerify, idleTimeToLive: '5 minutes' })`** (`E:RcMap.ts:248`, `get` 345, `invalidate` 632): leases = `RcMap.get` in a Scope; idle eviction built in; transport-drop eviction = fork `gateway.closed` → `RcMap.invalidate`. Retry-once for reads = `Effect.retry({ times: 1, while: isTransportFailure })`. `createRuntimeStatusCache` (runtime-status-snapshot-cache.ts:7-60) → `Cache.make({ capacity: 128, timeToLive: exit => Exit.isSuccess(exit) && exit.value.ok ? 30s : 45s })` (stale-while-revalidate via `SubscriptionRef` snapshot + forked `Cache.refresh`). `createResourceProbeLimiter` (resource-snapshot.ts:5-20) → `Semaphore.make(4)` (`E:Semaphore.ts:424`, `withPermits` 475). View leases (host.ts:1360-1378) → `FiberMap`/`ScopedCache` of `RcMap.get` scopes with TTL. Store `writeTail` promise lock (store.ts:102, 196) → `Semaphore(1)` in a `HostDirectory` service.

- SSH: `spawn('ssh', …)` from `node:child_process` (ssh.ts:110, 248) with stdout/stderr string accumulation, byte limits, `new Promise` settle-once flags, `setTimeout`, abort listeners, SIGTERM→SIGKILL `stopChild` (91-177, 220-232, 246-292). Bypasses DSH `ctx.subprocess` (env scrubbing, process-group termination) used by both jj plugins. Tunnel child outlives `openTunnel` with `child.on('error', () => undefined)` (316) and is disposed by a closure in the gateway transport (327-333) → `acquireRelease(spawnTunnel, kill)` inside the RcMap lookup scope.
- Gateway: global `fetch` (gateway.ts:102, 417) and `ws` `WebSocket` with 2–3 `setTimeout`s per stream (190-223, 296-310) → `HttpClient` + `Socket`/`Stream` with `Effect.timeout`.

**R6** `node:fs/promises` in store.ts (3) and launch-file.ts (45-84: tmp-file+rename atomic write, owner-pid check, try/catch swallow); `process.env.DSH_HOME ?? join(homedir(), '.dsh')` (1508).

**R7** `withSpan('ssh command' …)`, `'ssh tunnel open'`, `'multi-host runtime status refresh'` (ssh.ts:80, 244; runtime-status-snapshot-cache.ts:32) — good names; again + `Effect.fn` + `dshx-effect` span.

**R8** `MultiHostSchema` wrapper module restates Schema (`decode`, `safeDecode` returning `{success,data}`, `passthrough`, `strictStandardSchema`, `decodeStrict` — schema.ts:5-48); `parseRuntimeLaunch` does `JSON.parse` in try/catch then decode (launch-file.ts:28-43) → `Schema.fromJsonString(launchRecordSchema)` + `Schema.Union`. zod residue `zodSchemaFromEffect` (api.ts:282-295) kept only because jj-integration composes with zod.

**R9** 34 test files incl. `ssh.integration.test.ts`, `gateway-pool.test.ts`, `remote.live.test.ts`; none `it.effect`.

**TARGET DESIGN — multi-host**

| Service                                    | Shape                                                                                                                                                                                                                 | Deps                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Ssh`                                      | `run({target, command, stdin?, timeout, maxOutput}) → SshResult` (non-zero exit is a value), `exec(...) → string` (fails `SshCommandFailed`), `tunnel({target, remotePort, local}) : Effect<Tunnel, SshError, Scope>` | `Subprocess` (dshx; or `ChildProcessSpawner` if DSH subprocess cannot stream stderr for readiness — verify) |
| `LaunchFile`                               | `publish(launchUrl): Effect<void, never, Scope>` (acquireRelease write/remove-if-ours), `read(home)`                                                                                                                  | `FileSystem`, `Path`, `HostConfig`                                                                          |
| `HostDirectory`                            | hosts/runtimes CRUD with `Semaphore(1)` transactions                                                                                                                                                                  | `FileSystem`, `Path`                                                                                        |
| `RuntimeIdentity`                          | `current`, `verifyPinned(gateway, runtime)`                                                                                                                                                                           | `FileSystem`, `HostConfig`                                                                                  |
| `Connectors`                               | `connect(host, runtime): Effect<Gateway, ConnectError, Scope>` (local \| ssh)                                                                                                                                         | `Ssh`, `HttpClient`, `Socket`                                                                               |
| `RuntimePool`                              | `use(runtimeId, f, {mutation})`, `acquire(runtimeId): Effect<Gateway, E, Scope>`, `invalidate`, `status` — **`RcMap`**                                                                                                | `Connectors`, `HostDirectory`, `RuntimeIdentity`, `ConnectionErrors`                                        |
| `RuntimeStatus` / `ResourcePool`           | `Cache` + `Semaphore(4)`                                                                                                                                                                                              | `RuntimePool`, `Ssh`                                                                                        |
| `ViewLeases`                               | `open`, `close` (TTL via `Effect.sleep` fiber in `FiberMap`)                                                                                                                                                          | `RuntimePool`                                                                                               |
| `RemoteSessions` (scoped)                  | registers session source + reference middleware with acquireRelease                                                                                                                                                   | `RuntimePool`, `ThreadStore`, `CordisHost`                                                                  |
| `Provisioning`, `Doctor`, `RemoteCheckout` | Effect.fn programs over `Ssh`                                                                                                                                                                                         | `Ssh`                                                                                                       |

```
CordisHost(ctx, config) ─► HostConfig(profile) ─ Subprocess ─ NodeServices(FileSystem, Path) ─ FetchHttpClient
  Ssh ─► Connectors ─► RuntimePool(RcMap) ─► RuntimeStatus, ResourcePool(Semaphore 4), ViewLeases
  HostDirectory, RuntimeIdentity ───────────┘
  LaunchFile (scoped: publish on connection+webServer)   RemoteSessions (scoped)
MultiHostLive = Layer.mergeAll(LaunchFilePublisher, RemoteSessions, ViewLeases, RuntimeStatus, ResourcePool, Provisioning).pipe(Layer.provide(...))
```

Errors (tags preserve existing codes via `remoteCode`): `SshUnavailable`, `SshUnreachable`, `SshTimeout`, `SshOutputTooLarge`, `SshCommandFailed{exitCode, stderrTail(redacted), cause}`, `TunnelFailed`, `RuntimeNotRunning`, `GatewayUnreachable`, `AuthenticationExpired`, `StreamClosed`, `IdentityMismatch`, `RuntimeIncompatible`, `RuntimeNotFound`, `HostNotFound`, `OriginPortExhausted`. `type TransportFailure = GatewayUnreachable | AuthenticationExpired | StreamClosed | …` replaces the string `Set` (host.ts:163-170).

Deleted: `effectHandler`/`multiHostPromiseHandlers` split, `setupHost` function, `configuredProfile`, `activeSessionSources` (→ scoped service), `process.once('exit')` (replace with one `process` exit finalizer registered once in LaunchFile layer, removed on release), `ctx.effect` disposer, `gateway-pool.ts`, `runtime-status-snapshot-cache.ts`, `createResourceProbeLimiter`, `stopChild`, `runUntracedSshProcess`/`openUntracedTunnel` promise plumbing, `MultiHostSchema` wrapper, `safeFailure` instanceof chain.

Before/after (most important — pool):

```ts
// before: gateway-pool.ts:13-123 (Map<string, {gateway: Promise, leases, idleTimer, generation}>) + host.ts:316-350
// after
export class RuntimePool extends Context.Service<
  RuntimePool,
  {
    readonly use: <A, E>(runtimeId: RuntimeId, f: (g: Gateway) => Effect.Effect<A, E>, o: { mutation: boolean }) => Effect.Effect<A, E | PoolError>
    readonly invalidate: (runtimeId: RuntimeId) => Effect.Effect<void>
  }
>()('@dshfiles/multi-host/RuntimePool') {
  static readonly layer = Layer.effect(
    RuntimePool,
    Effect.gen(function* () {
      const connectors = yield* Connectors
      const directory = yield* HostDirectory
      const identity = yield* RuntimeIdentity
      const gateways = yield* RcMap.make({
        lookup: (runtimeId: RuntimeId) =>
          Effect.gen(function* () {
            const { host, runtime } = yield* directory.runtimeWithHost(runtimeId)
            const gateway = yield* connectors.connect(host, runtime) // acquireRelease inside: tunnel + dispose
            yield* identity.verifyPinned(gateway, runtime)
            yield* Effect.forkScoped(gateway.closed.pipe(Effect.andThen(RcMap.invalidate(gateways, runtimeId))))
            return gateway
          }),
        idleTimeToLive: '5 minutes',
      })
      const use = Effect.fn('multi-host runtime use')(function* (runtimeId, f, o) {
        const once = Effect.scoped(Effect.flatMap(RcMap.get(gateways, runtimeId), f)).pipe(
          Effect.tapError(error => (isTransportFailure(error) ? RcMap.invalidate(gateways, runtimeId) : Effect.void)),
        )
        return yield* o.mutation ? once : once.pipe(Effect.retry({ times: 1, while: isTransportFailure }))
      })
      return RuntimePool.of({ use, invalidate: id => RcMap.invalidate(gateways, id) })
    }),
  )
}
```

### 2.4 Shared `Jj` CLI service — real overlap and placement

Checked callers, not assumed:

| Concern                                                       | jj-integration                                                       | jujutsu                                            | Shared?                                                                                             |
| ------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| resolve `jj` executable                                       | per call (host.ts:273)                                               | single-flight, absolute-path check (host.ts:86-99) | **yes** (cache once, validate)                                                                      |
| argv prefix `--color=never --no-pager`                        | host.ts:276                                                          | host.ts:135                                        | **yes**                                                                                             |
| bounded collect stdout/stderr, `graceMs: 1_500`, stdin ignore | host.ts:278-279 (512K/64K)                                           | host.ts:137-142 (1.16M/64K)                        | **yes** (limits as options)                                                                         |
| timeout                                                       | 120s via AbortSignal.timeout (274)                                   | 30s / 120s network (30-31, 125)                    | **yes** (option)                                                                                    |
| span `jj <verb>` with identical `JJ_VALUE_FLAGS`              | jj-span.ts                                                           | jj-span.ts (verbatim copy)                         | **yes**                                                                                             |
| op-heads keyed `--ignore-working-copy` read cache             | jj-read-cache.ts:15-79                                               | composer-context-host.ts:100-134                   | **yes** (and fixes jujutsu's signal-sharing bug)                                                    |
| non-zero exit                                                 | returned as value, stderr inspected (threads.ts:402-406, auto-fetch) | thrown, stderr hidden (host.ts:159,168)            | expose both: `run` (value) + `exec` (fails `JjCommandFailed`, stderr kept only in a redacted field) |
| repo identity dev:ino before/after                            | —                                                                    | host.ts:68-84,132-133,160-161                      | **no** → jujutsu `RepositoryIdentity.guard`                                                         |
| per-repo mutation lock, thread semantics                      | threads.ts:377-386                                                   | —                                                  | **no** → jj-integration `RepoLocks`                                                                 |

Placement (respect `jujutsu → jj-integration → multi-host`): put `Jj`, `JjCommand`, `JjOutput`, `JjCommandFailed`, `JjViewReads`, span helper in a **plain workspace package `@dshfiles/jj-cli`** (like `vcs-provider-port`/`credential-port`), bundled into both Host entries (`host.bundleDependencies`). Not a dshx module of jj-integration: it is a runtime implementation both need, and hanging it on jj-integration would deepen jujutsu's coupling to a plugin it only uses for cleanup-job types. Depends only on `effect` + dshx `Subprocess` service.

```ts
export class Jj extends Context.Service<Jj, {
  readonly run: (cmd: JjCommand) => Effect.Effect<JjOutput, JjSpawnFailed | JjTimedOut>
  readonly exec: (cmd: JjCommand) => Effect.Effect<string, JjSpawnFailed | JjTimedOut | JjCommandFailed | JjOutputTruncated>
}>()('@dshfiles/jj-cli/Jj') {
  static readonly layer = Layer.effect(Jj, Effect.gen(function* () {
    const subprocess = yield* Subprocess
    const executable = yield* Effect.cached(subprocess.resolveExecutable('jj').pipe(Effect.filterOrFail(isAbsolute, …)))
    const run = Effect.fn('jj run')(function* (cmd: JjCommand) {           // span named `jj <verb>` via attributes
      const handle = yield* subprocess.spawnScoped({ argv: [yield* executable, '--color=never', '--no-pager', ...cmd.args], cwd: cmd.cwd, stdio: …, graceMs: 1_500 })
      const outcome = yield* subprocess.awaitExit(handle)                 // interruption → finalizer terminate + waitForExit
      return JjOutput.fromHandle(handle, outcome)
    }, Effect.scoped, (eff, cmd) => Effect.timeoutOrElse(eff, { duration: cmd.timeout, onTimeout: () => new JjTimedOut({ args: cmd.verb }) }))
    …
  }))
}
```

(Verify `Effect.fn` pipeable-args form and `Effect.timeoutOrElse` signature in `E:Effect.ts:14869`, `:4862` before writing.)

### 2.5 `Ssh` / runtime pool — see §2.3. Key decision: **run ssh through DSH's subprocess runtime** (same scrubbing/process-group guarantees as jj). Needs check: does `SubprocessSpawnSpec` support stdin bytes and an observed (streamed) stderr for the tunnel readiness line? If not, either (a) add an observe mode via dshx `Subprocess.spawnStreaming` or (b) use `effect/process` `ChildProcessSpawner` with `NodeChildProcessSpawner` (platform/node/src/NodeChildProcessSpawner.ts) — documented as a deliberate exception.

---

## 3. Cross-cutting patterns (fix once)

1. **Promise→Effect handler adapters** (`effectify` jj-integration host.ts:1568; `effectHandler` jujutsu host.ts:804, multi-host host.ts:1410). Fix: delete; handlers are `Effect.fn` over services. Add an antislop rule: `Effect.tryPromise` whose `try` calls a local async function defined in the same package = facade.
2. **Flattened errors**: `message: String(error)` / `catch: error => error` / tag `'Plugin'` / `instanceof` chains. Fix: per-kind `Schema.TaggedError` with `cause: Schema.optional(Schema.Defect())` (OC:util/src/process.ts:8-13; OC:core/src/git.ts:65-100); rely on dshx `remoteCode(_tag)` (dshx effect/index.ts:81-95) to keep wire codes. Also fix dshx's own `EffectHostServiceError` / `VcsProvider*Error` to keep cause (services.ts:20-25; vcs-provider-port/src/effect.ts:5-11,32,38).
3. **Module singletons + service locators** (`requireX()`, `let opening`, `configuredProfile`, `pool`). Fix: state lives in `Layer.effect` `make` closures; one `CordisHost` edge layer per plugin owns every `ctx.get`.
4. **Hand-rolled concurrency primitives** — promise-chain locks (threads.ts:377, store.ts:102, review-progress-store.ts:49, cleanup-jobs.ts:243, host.ts:731), counting limiters (resource-snapshot.ts:5), `mapBounded` (host.ts:483). Fix: `Semaphore` / KeyedMutex (copy OC keyed-mutex.ts:20-42 into dshx effect, ~20 lines) / `Effect.forEach({concurrency})`.
5. **Hand-rolled caches** — 10+ TTL/single-flight/generation maps across the three. Fix: `Cache.make` (`E:Cache.ts:297`), `RcMap.make` (`E:RcMap.ts:248`) for leased resources, `Effect.cachedInvalidateWithTTL` (`E:Effect.ts:7578`) for one-value caches; "stale-while-revalidate snapshot" = `SubscriptionRef` + forked refresh — build one small `SnapshotCache` helper in dshx effect (needed by jj RepositoryViews, multi-host RuntimeStatus, SessionActivity).
6. **Timers as schedulers** — `setTimeout`/`setInterval` self-arming loops (29 occurrences). Fix: `Effect.repeat(Schedule.spaced(...))`/`Effect.schedule` forked with `Effect.forkScoped` (`E:Effect.ts:9023`) in scoped layers; settings-driven intervals read per iteration.
7. **AbortSignal plumbing** (141 uses). Fix: fiber interruption; only the dshx edge converts the API call signal (already done in dshx index.ts:117).
8. **Triple spans** per API call: `api-dispatch` + `dshx-effect <api>.<name>` (dshx index.ts:123) + plugin `Effect.fn('<plugin> <verb>')`. Fix in dshx: drop the `dshx-effect` wrapper span or make handlers use `Effect.fnUntraced` — pick one owner (recommend: plugin `Effect.fn('<subject> <verb>')`, dshx adds attributes to the current span).
9. **Duplicated jj runner/span/view cache** (jj-integration ↔ jujutsu) → `@dshfiles/jj-cli` (§2.4).
10. **Subprocess outside DSH runtime** (multi-host ssh.ts:110,248; also thread-sidebar, tweet-context, references per grep) — standardize on dshx `Subprocess` with a new interruption-safe `run(spec)`.
11. **Schema wrapper modules** (`MultiHostSchema` schema.ts:5-48, jujutsu `SchemaHelpers`, jj-integration `JsonText`) returning `{success,data}`. Fix: `Schema.decodeUnknownEffect` / `Schema.fromJsonString` at boundaries; delete wrappers except the genuinely missing StandardSchema strict export (move to dshx).
12. **Effect service ports that nobody consumes** (`VcsProviderService`, dshx `Subprocess`). Fix: make consumers use them; vcs-provider-port should also offer an Effect _host_ builder (`VcsProviders.contract(...).hostEffect({...})`) so jj-integration's provider side is Effect too.
13. **No `@effect/vitest`** anywhere in these units despite catalog pin. Fix: `it.effect`/`it.layer` with real layers (`Jj.layer` over a test `Subprocess.layer(realLocalRuntime)` + temp jj repo), `TestClock` for schedules/TTLs.

---

## 4. Ordered migration steps

0. **Characterization tests first** (no prod change). Keep existing real-jj integration tests green; add:
   - jj-integration: (a) per-repo serialization — two concurrent `landAt` on one repo never interleave, different repos run in parallel (threads.integration.test.ts style, real jj); (b) deferred integration: queued while busy, retried after settle, cancel before guard → `cancelled`, cancel after guard → `integrating`, waiting errors keep entry (deferred-integrations.test.ts exists — extend to the host wiring incl. 1.5s debounce + 30s fallback); (c) workspace-sync coalescing: N lands in one repo during a running sync → exactly one more sync with the last revision; (d) cleanup runner: same-scope request attaches to live job, jobs strictly serial, trail transitions; (e) `JjReadCache`: cached per op-head, invalidated by a new operation, in-flight shared but not aborted by one caller's signal; (f) session-activity budgets: guard waits across attempts on one read, ceiling; (g) **wire error codes** of every API method (snapshot `code` for each failure path: thread-active, thread-activity-unknown, integration-queued, not-a-thread, no-path, agent-only, not-a-repository, workspace-not-found, jj-failed); (h) land outcome matrix → activity events + agent prompt text (landed/conflicted/needs-description/patch-equivalent…).
   - jujutsu: (a) identity guard — dir swapped under a registered repo → "Registered repository directory changed"; symlink path rejected; (b) stderr never surfaces in errors/outputs (push/fetch with credential URL in stderr); (c) timeout vs cancel messages; (d) preview TTL/fingerprint invalidation on confirm; (e) composer read cache per op-head; (f) public vs generic failure messages per handler (current regex list).
   - multi-host: (a) pool — one connection per runtime shared by concurrent callers; idle eviction at 5 min; transport drop evicts; read retried once on transport failure, mutation never; generation guard on invalidate (gateway-pool.test.ts exists — keep as spec); (b) ssh run — non-zero exit is a value, timeout/outputExceeded flags, cancel kills child (SIGTERM→SIGKILL), stdin limit; tunnel readiness line, tunnel-timeout, process gone → `tunnel-failed`; (c) launch file — atomic write 0600/dir 0700, removed only if pid matches, removed on dispose and on process exit; (d) status cache TTL 30s ok / 45s failure + invalidate-during-refresh discard; (e) `MultiHostHandlerError` codes per failure class.
     Verify: `pnpm --dir plugins/@dshfiles/<unit> test -- --run <file>`.
1. **dshx foundation** (blocks all): `Subprocess.run` (scoped, interruption = terminate+waitForExit, cause kept), `KeyedMutex`, `SnapshotCache`, `CordisHost` helper, single-owner span policy, TaggedError↔wire-code doc + test. Verify: dshx unit tests + one plugin boot via `bootPluginProfile`.
2. **`@dshfiles/jj-cli` package**: `Jj`, `JjViewReads`, errors, span; tests `it.effect` against real jj in tmp repo (port jj-read-cache.integration.test.ts + jj-span tests). Verify: package tests; `pnpm check:cycles`.
3. **jujutsu** (smallest, best tests): services per §2.2, delete adapters/singletons; ReviewProgress scoped layer. Verify: all `*.integration.test.ts` + host.test.ts + api-tools.test.ts; import-check built Host bundle; scratch DSH open panel (dsh-plugin-verify).
4. **jj-integration bottom-up**: (4a) `ThreadWorkspaces` over `Jj`+`RepoLocks` (threads.ts) — run threads.integration.test.ts; (4b) Cordis ports + `JjSettings` + `ActivityLog`; (4c) caches → `RepositoryViews`, `SessionActivity`; (4d) `Landing` + `IntegrationQueue` + `WorkspaceSync` workers; (4e) `Cleanup` + `Maintenance` schedules (TestClock tests); (4f) handlers native, delete `effectify`; (4g) vcs-provider-port Effect host builder. Verify after each: characterization suite from step 0 + wire-code snapshot unchanged.
5. **multi-host**: (5a) `Ssh` over dshx Subprocess (resolve stdin/stream-stderr question first; fallback ChildProcessSpawner) — ssh.integration.test.ts; (5b) `HostDirectory`, `LaunchFile`, `RuntimeIdentity` on `FileSystem`; (5c) `Connectors` with `HttpClient`/Socket; (5d) `RuntimePool` RcMap (port gateway-pool.test.ts to `it.effect` + TestClock); (5e) status/resource caches, view leases; (5f) scoped `RemoteSessions` + launch publisher; delete `setupHost`/`Layer.empty`. Verify: unit suite + `remote.live.test.ts` against a scratch remote + scratch DSH two-runtime check.
6. **Schema cleanup**: drop `MultiHostSchema`/`SchemaHelpers`/`JsonText` wrappers; remove zod views once jj-integration's contract composes Effect schemas (api.ts:282-295). Verify: `effect-schema-parity`/`api-schema-parity`/`legacy-zod-schema-exports` tests updated deliberately.
7. **Lint gate**: antislop rules — `Effect.tryPromise` over same-package async fn; module-level `let` in Host files; `setTimeout/setInterval` in Host code; `node:child_process` in plugins; `catch: () => new X()` without cause.

Unverified in this review: DSH `SubprocessSpawnSpec` stdin/streaming capabilities (types not resolvable from the thread workspace); exact `Effect.fn` pipeline-argument typing for the `Jj.run` sketch.
