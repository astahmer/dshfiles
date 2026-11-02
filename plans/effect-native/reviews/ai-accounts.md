# Effect review — `plugins/@dshfiles/ai-accounts` (Host half)

Repo: `/Users/astahmer/dev/dshfiles-threads/thread-72c437`. All paths below are relative to `plugins/@dshfiles/ai-accounts/src/` unless stated. Read-only review; nothing edited.

## 1. Summary

| Unit                                                        | Verdict    | Effect-native %               | Top 3 problems                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Effort                                                                    |
| ----------------------------------------------------------- | ---------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| ai-accounts Host (~18.7k LOC non-test, 7 host APIs, 1 tool) | **facade** | **~3% runtime / ~60% schema** | (1) `host.ts` is a 1,100-line imperative closure; the only Effect is `Layer.empty` + a `Schedule` that calls a `WeakMap`-stored callback; (2) all 43+ API handlers are `effectHandler` = `Effect.tryPromise({ catch: error => error })` around unchanged Promise code, reaching state via a `WeakMap<Context, AccountRuntime>` bag of optional fields; (3) every resource (timers, in-flight maps, promise-chain locks, AbortControllers, child processes, storage domains, module singletons) is hand-rolled, so the error channel is `unknown` and nothing is testable with `TestClock`. | **L** (the fail-over/quota hook block needs characterization tests first) |

"53 files import effect" comes almost entirely from `effect/Schema` (the zod→Effect Schema port). Only **2** files import from `'effect'` itself (`host.ts`, `host-effect.ts`). There is exactly **one** `Effect.fn` (`host-effect.ts:9`), **zero** `Context.Service`, **zero** `Schema.TaggedError`, **zero** `Layer` beyond `Layer.empty`.

## 2. Findings by rubric

### R1 Facade — FAIL (every item on the list is present)

- `host.ts:108` `const refreshStalePricing = new WeakMap<Context, () => void>()`; `host.ts:110-121` `DshxEffect.plugin({ layer: Layer.empty, setup: ctx => Effect.forkScoped(Effect.repeat(Effect.sync(() => refreshStalePricing.get(ctx)?.()), Schedule.spaced(...))) })`. The fiber's only job is to call an imperative closure set at `host.ts:263`.
- `host.ts:136-141` `void accountHostEffect.setup(ctx, undefined).then(release => { releaseAccountHostEffect = release }, …)` inside a Promise `definePlugin`; release via `ctx.effect(() => () => void releaseAccountHostEffect?.())` (`host.ts:132-135`). The Effect scope is a side-car; it does not own any of the ~15 other `ctx.effect` disposers (`host.ts:146,237,257,266,281,340,506,558,853`).
- `host-effect.ts:4-14` `effectHandler` = `Effect.fn(name)(ctx => Effect.tryPromise({ try: signal => Promise.resolve(handler({...context, signal})), catch: error => error }))`. All 7 registrations use it: `accounts-host-api.ts:98` (43 handlers), `model-fallback-host.ts:60`, `model-fast-mode-host.ts:35`, `serving-account-host.ts:18`, `account-login-host.ts:53`, `account-session-host.ts:91`, `thread-account-host.ts:78`. Handlers are `async ({ ctx }) => …` Promise code; the `E` channel is `unknown`.
- `DshxEffect.host(...)` is used instead of `accountHostEffect.hostApi(...)`, so handlers run **without** the plugin runtime (`tooling/dshx/packages/dshx/src/effect/index.ts:109-115`: missing runtime → `Effect.runPromiseExit` with R=never). Handlers cannot `yield*` any service even if one existed.
- WeakMap/module registries: `account-runtime.ts:62` `runtimes = new WeakMap<Context, AccountRuntime>()` with 17 optional fields (`account-runtime.ts:17-38`) mutated from `host.ts` (`runtime.servingAccount = …`, `delete runtime.pricing`, `if (runtime.x === x) delete runtime.x` ×8); `account-runtime.ts:42` `locks = new WeakMap<Context, Set<string>>()`; `model-fallback-host.ts:18` module `let opening: Promise<OpenedModelFallbacks> | undefined` (process-global singleton, not per ctx); `account-credential-home-work.ts:17,32` module `homes = new Map`, `let accessKeyOrder: Promise<unknown>`; `settings.ts:123` module `let readHostSettings`; `usage-recorder.ts:51`, `fast-mode-usage-history.ts`, `provider-profile.ts`, `pricing-catalog.ts`, `native-providers.ts`, `account-session-host.ts` also hold `WeakMap<…>` registries (10 occurrences). `accountStoreService` is an imported module singleton (`account-store.ts`, used at `host.ts:155,197,249,292,698,818`).
- `void promise.then/catch`: `host.ts:136,148,240-241,258,267-273,286,848,959` — fire-and-forget with log-only recovery.

### R2 Services — FAIL

No `Context.Service`. Domain lives in `createXService(deps)` factories with callback dependency injection (`createAccountSetupService({ store, resolveCredential, observeExisting, verify, saveKey, adoptCredential, cancelLogin, settleLogin, cleanupCandidate, onCommit })` at `host.ts:151-221`, a 70-line inline object of closures over `runtime` and `ctx`). Cross-service calls go through the optional runtime bag (`runtime.accountLogin?.commitPending`, `runtime.copilotLogin?.cancel`, `runtime.usageCache?.invalidate()` — 33 `accountRuntime(` call sites). `ctx.get(...)` is spread over 10 files (32 sites: `accounts-host-api.ts`, `serving-account.ts`, `account-session-host.ts`, `model-fallback-host.ts:21,74`, `thread-account-host.ts`, `native-providers.ts`, `usage-recorder.ts`, `credentials.ts`, `fast-mode-usage-history.ts`, `host.ts:478,571,595,631,632`). `*Model` classes with static methods (`AccountsHostApiModel`, `AccountSessionWorkModel`, `AccountLoginIntentModel`) are namespaces that take `ctx` as first arg — the opposite of `yield*`.

### R3 Layer graph — FAIL

`Layer.empty` (`host.ts:111`). Wiring is the setup closure in `host.ts:129-1102`: ordering-dependent (`runtime.accountSetup` must exist before `installAccountLogin(ctx)` at `host.ts:222`, which reads `runtime.accountSetup` lazily; `runtime.usageCache` is read by `copilotLogin.onChange` before it is assigned at `host.ts:243`). No test layers.

### R4 Errors — FAIL

- 159 `throw new Error(...)` sites (host + client). No tagged errors. User-facing failure kinds that deserve tags: `AccountOperationBusy` (`account-runtime.ts:52`), `LoginIntentInactive` (`account-login-host.ts:59`), `ServiceUnavailable` (`accounts-host-api.ts:74,80,88,94`, `account-login-host.ts:49`), `CallerForbidden` (`serving-account-host.ts:10-15`, `accounts-host-api.ts:158`), `SecretCatalogInactive` (`accounts-host-api.ts:120,166`), `MissingCredential` (`host.ts:617,627`), `CodexLoginUnsupported` (`codex-login-process.ts:8`, extends `Error`), `CodexHomeError`, `CommandCodeConfigError`.
- Cause flattening: `host.ts:617` `cause instanceof Error ? cause.message : …`; `host.ts:960` `String(error)`; `quota-continuation.ts:195,236,431` `String(error)` into logs; `pricing-catalog.ts:318` `lastError: string`.
- Swallowing: `accounts-host-api.ts:108-112` `catch { return { available: false } }`; `account-runtime.ts:70-76` `try … catch { return false }`; `account-login-host.ts:17-21`; `quota-continuation.ts:468` `.catch(() => null)`.
- `effectHandler`'s `catch: error => error` makes the error type `unknown`; `dshx settle` then `Cause.squash`es it (`index.ts:97-100`).
- `try {` in 43 non-test host files (account-session-service ×8, quota-continuation ×7, codex-home ×6, account-store ×5 …).

### R5 Resources / concurrency — FAIL (every primitive hand-rolled)

| Hand-rolled                                   | Where                                                                                                                                                                         | Effect replacement                                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| promise-chain mutex                           | `account-write-queue.ts:1-9`; `host.ts:816-823` `refreshQueue`; `quota-continuation.ts:126,144-155` `sessionChains`; `account-credential-home-work.ts:32-40` `accessKeyOrder` | `Semaphore.make(1)` + `withPermit`; per-key: `RcMap<key, Semaphore>` (`RcMap.ts` `idleTimeToLive`)                                                        |
| fail-fast key lock                            | `account-runtime.ts:44-59` `Set<string>`                                                                                                                                      | `Ref.modify` on `HashSet` (atomic check-and-add) → `AccountOperationBusy`                                                                                 |
| in-flight dedupe + TTL + timeout + generation | `account-usage.ts:66-112` `createUsageCache`                                                                                                                                  | `Cache.make({ capacity: 1, timeToLive: '30 seconds', lookup: readAll.pipe(Effect.timeout('30 seconds')) })` + `Cache.invalidateAll` (`Cache.ts:297,1284`) |
| in-flight dedupe                              | `pricing-catalog.ts:319,359`, `usage-recorder.ts:227-253`                                                                                                                     | `FiberHandle.run(handle, eff, { onlyIfMissing: true })` (`FiberHandle.ts:205`) or `Effect.cached`                                                         |
| `setInterval` sweep                           | `usage-recorder.ts:265`                                                                                                                                                       | `Effect.repeat(collect, Schedule.spaced(...)).pipe(Effect.forkScoped)`                                                                                    |
| `setTimeout` expiry per op                    | `account-setup-service.ts:70,235`; `account-login-service.ts:46,130`; `claude-cli.ts:171,559` idle kill; `request-retry-wait.ts:19`                                           | `FiberMap<id>` + `Effect.sleep`; Claude sessions → `RcMap` with `idleTimeToLive: '30 minutes'`                                                            |
| AbortController plumbing                      | 16 sites; `host.ts:357,828-834` `modelCatalogRefreshes`                                                                                                                       | `FiberMap<instanceId>.run` (replacing a key interrupts the previous fiber) + `Effect.timeout('15 seconds')`                                               |
| deferred with release                         | `request-retry-wait.ts:2-35` (`Map<string, resolve>`)                                                                                                                         | `FiberMap`/`Deferred` per session: `Effect.raceFirst(Effect.sleep(delay).as(true), Deferred.await(release))`                                              |
| `AsyncLocalStorage` reentrancy                | `account-credential-home-work.ts:18`                                                                                                                                          | `Context.Reference<HeldHomes>` + `Effect.provideService`                                                                                                  |
| ad-hoc fan-out                                | `rolling-concurrency.ts:91-136` (53 LOC)                                                                                                                                      | `Effect.forEach(items, f, { concurrency: n })`                                                                                                            |
| storage open/close singletons                 | `model-fallback-host.ts:18-49`, `quota-continuation.ts:124,134`, `usage-recorder.ts:51`, `serving-account.ts`, `fast-mode-usage-history.ts`                                   | `Effect.acquireRelease(open, d => d.close())` inside each service's scoped `Layer.effect`                                                                 |
| listener disposers array                      | `host.ts:851-1101` `disposers`, `perAgent` Map                                                                                                                                | `Effect.acquireRelease(Effect.sync(() => ctx.on(...)), off => Effect.sync(off))`; per agent `FiberMap`/child `Scope`                                      |

### R6 Platform — FAIL

- `node:fs` in 17 files (`account-store.ts:1-2` incl. `readFileSync/renameSync`; `host.ts` `realpathSync/lstatSync/rmSync` at 211-212; `codex-home.ts`, `codex-login-files.ts`, `pricing-catalog.ts:1`…). → `effect/FileSystem`, `effect/Path` (+ `@effect/platform-node` `NodeServices`, not yet in `pnpm-workspace.yaml` catalog).
- `node:child_process` in 5 files: `codex-login-process.ts:27` (detached group kill), `claude-cli.ts:458`, `claude-auth-status.ts`, `account-session-service.ts`, `keychain.ts`. → `effect/process` `ChildProcess` (has `detached`, `killSignal`, `forceKillAfter`, `cwd`, `env` — `process/ChildProcess.ts:262,274,447,466,535`) via `ChildProcessSpawner`.
- Raw `fetch`: `provider-request.ts:80` (`providerFetch`, already the one choke point), `pricing-catalog.ts:316-340`, `opencode-go-catalog.ts`, `commandcode-provider.ts`, `copilot-login.ts`. → `effect/http` `HttpClient` (+ `FetchHttpClient.layer`, core, no new dep). opencode's `packages/core/src/models-dev.ts:530-590` is the exact same models.dev fetcher done right (`HttpClient.retryTransient` with `Schedule.exponential(200).pipe(Schedule.jittered)` at :539-542, `Effect.fn("ModelsDev.fetchApi")` at :586, ETag).

### R7 Tracing — PARTIAL

`effectHandler` derives span names from method keys (`host-effect.ts:9` → "ai accounts read secret catalog keys"), **and** `dshx registerEffectHost` adds `dshx-effect <api>.<method>` (`index.ts:123`) → two spans per call. IO spans exist via `@dshfiles/dshx/tracing` `withSpan` (`provider-request.ts:70`, `codex-login-process.ts:2`) — keep the names (`ai-accounts provider request`) but produce them with `Effect.fn` / `Effect.withSpan`. No span for route refresh, quota recovery, failover decision, pricing refresh.

### R8 Schema — PARTIAL (the strongest part)

Schemas are real Effect Schema (`api.ts`, `account-store.ts`, `quota-continuation-model.ts`…). Problems:

- `effect-schema.ts:12-54` `AiAccountsSchema` restates `decodeUnknownSync`/`decodeUnknownResult` (`decode`, `decodeResult`, `accepts`, `acceptsStrict`) — a bespoke wrapper module; used in ~30 files. Keep only the genuine codecs (`trimmedString`, `intBetween`) as plain exported schemas.
- `effect-zod-schema.ts:9-16` `asZodSchema` bridge (zod residue) for storage-domain `valueSchema`. Legit edge shim, but it belongs in dshx (`PluginStorage`), not per plugin.
- `api-schema.ts:12-45` `strictStandardSchema` patches JSON-Schema output (`not: null` → empty object); that is a dshx contract concern.
- Decode-at-boundary is applied unevenly: `host.ts:560` `threadModelPolicySchema.safeParse(...)` (zod, from session-controller); `host.ts:470-472` `JSON.stringify` equality for model compatibility (use `Equal`/`Schema.equivalence`).

### R9 Tests — FAIL

104 test files, **0** import `@effect/vitest` (it is in the catalog at `pnpm-workspace.yaml:98`, used by `credential-port`, `secret-catalog`, dshx). 0 `it.effect`/`it.layer`. `vi.fn` 129× in 18 files; `vi.mock` of `node:child_process`/`node:fs`/`node:os`/`./keychain.js` in `account-connection-verification.test.ts:17-24`, `claude-auth-status.test.ts:7-9`, `codex-login-spawn.test.ts:6` (exactly what `ChildProcessSpawner`/`FileSystem` test layers replace); `useFakeTimers` in 13 files (→ `TestClock`). `host-effect.test.ts` only proves the facade forwards abort. **No test exercises `host.ts`'s agent hooks** (`agent/request`, `agent/request-error`, `agent/turn-stopping`, `llm/stream`) — `grep agent/request-error *.test.ts` = 0. `host-boot.test.ts` (3 tests) covers store→routes only. `account-pool.ts:107` uses `Math.random()` and `Date.now()` inline; balanced distribution has no deterministic test.

### R10 Edges — PARTIAL

`runPromise*` only in dshx (`index.ts:114,117,153,175`) — fine. But the real edge is not drawn: the Cordis hooks call imperative code directly, and `void ….then` fire-and-forgets act as unmanaged forks (R1).

## 3. Module classification

**Pure domain (keep as pure functions/schemas; ~45%)**: `account-config`, `account-draft`, `account-home-policy`, `account-model-settings`, `account-connection-method`, `account-pool` (state machine; inject Clock/Random), `request-account-routing`, `failure-policy`, `failure-recovery` (decide logic), `model-fallback`, `model-fallback-router` (state), `provider-routes`, `provider-profile` (`ProviderProfileModel`), `commandcode-capabilities`, `cost-estimate`, `cost-projection` (model part), `quota-reset`, `quota-continuation-message`, `quota-continuation-model`, `retry-notice`, `silent-rejection`, `empty-response`, `codex-luna-reserve`, `usage-history`, `usage-history-model`, `account-login-api`, `api`, `*-api.ts` contracts, `effect-schema` (codecs only), `settings` (decoders), `pricing-catalog` (`PricingCatalogModel`, index/quote fns), `codex-fast-mode` (`isCodexFastModeModel`, decorate fns).

**IO adapters**: `account-store` (fs), `codex-home`, `codex-credential`, `codex-login-files`, `codex-login-process` (spawn), `claude-cli` (spawn+stdio protocol), `claude-auth-status` (spawn), `claude-account` (fs+http), `keychain` (spawn), `account-session-service` (spawn+fs), `usage` / `copilot-quota` / `cursor-account` / `commandcode-usage` / `codex-reset-credits` / `opencode-go-catalog` / `commandcode-provider` catalog (http), `provider-request` (http span), `pricing-catalog` (fetch+fs), `copilot-credentials` / `credentials` (Cordis credentials), `model-fallback-store`, `quota-continuation-store`, `usage-recorder`, `fast-mode-usage-history`, `serving-account` (storage domains), `native-providers` / `native-provider-patch` (profile patch file), `keychain`.

**Orchestration**: `host.ts:142-1102`, `account-setup-service`, `account-login-service`, `copilot-login`, `account-connection-verification`, `quota-continuation` (705 LOC), `account-usage` (`readAccountUsage` dispatch + cache), `usage-recorder` scheduler, `account-credential-home-work`, `request-retry-wait`, `thread-request-policy`, `FastModeService`, `EffortPinnedAdapter` (pi-ai adapter subclass — must stay a class for `llm.registerAdapter`).

**Cordis edge**: `host.ts:123-141` (definePlugin), the 7 `*-host.ts` files, `accounts-tool.ts`, `account-runtime.ts`, `host-effect.ts`, `cost-projection.installCostProjection`, the `ctx.on('llm/stream'|'agent/*')` listeners.

## 4. Target design

### Services (all `Context.Service` classes with `static layer = Layer.effect(this, make)`; `make` is `Effect.gen` that `yield*`s deps; methods are `Effect.fn('ai-accounts <subject> <verb>')`)

Edge ports (built once from `ctx` in the `layer: (ctx) => …` overload that `DshxEffect.plugin` already supports — `index.ts:162,170`):

- `CordisHost` — the only `ctx.get`/`ctx.on` owner: `llm`, `credentials`, `storageDomain`, `sessionController`, `agents`, `sessionProjections`, `schedule`, `logger`, `on(event, handler)` returning a scoped registration. Test layer = in-memory fakes of the same interface (not `vi.mock`).
- `LlmRegistry` — `registerAdapter/replace`, `registerConfigurableProviders/replace`, `registerModelDiscovery`, `discoverModels`, `listProviders`; scoped (`acquireRelease` → handle disposal).
- `CredentialVault` — `resolve(ref)`, `describe`, `set`, Copilot credential read/modify/remove; wraps `ctx.credentials` + `secretCatalogValues`. Errors: `CredentialUnavailable`.
- `SessionModelControl` — `selectModel` (legacy) and guarded `threadModelApi.select`; `AutomaticSelectionRefused`.
- dshx `PluginStorage` (exists in `services.ts`) — storage domains, replacing 5 hand-rolled open/close singletons and `asZodSchema`.
- Platform: `FileSystem`, `Path`, `ChildProcessSpawner` (`@effect/platform-node` `NodeServices.layer`), `HttpClient` (`FetchHttpClient.layer`), `Clock`, `Random`.

Domain/application services:

| Service                           | Shape                                                                                                                                                         | Deps                                                                                                      | Replaces                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `AccountStore`                    | `snapshot: SubscriptionRef<AccountStoreFile>`, `read`, `update(f)`, `publish(op)`                                                                             | FileSystem, Path                                                                                          | `account-store.ts` cache/`prime`/`readAccountFileSync`, `AccountWriteQueue` (→ `Semaphore(1)`)             |
| `AccountRoutes`                   | `current: SubscriptionRef<RouteSnapshot{config,routes,profiles,reasoningDefaults,rejected}>`, `refresh`, `modelFor`, `compatible`                             | AccountStore, LlmRegistry, ModelCatalogs                                                                  | `host.ts:294-296,397-445,751-824` mutable `let config/routes/profiles`, `refreshQueue`                     |
| `ModelCatalogs`                   | `refresh(instanceId)`, `discovered(id)`, discovery registration reconcile                                                                                     | LlmRegistry, CredentialVault, HttpClient; `FiberMap<instanceId>`                                          | `host.ts:356-357,724-748,786-803,825-849`                                                                  |
| `AccountPool`                     | `acquire`, `noteServed`, `noteRateLimited`, `bindRoute`, `isHealthy`, `distribution` — `Ref<PoolState>` + pure transitions                                    | Clock, Random                                                                                             | `account-pool.ts` closure state (keep transitions pure, export them for tests)                             |
| `ProviderUsage`                   | `read(account)` per kind                                                                                                                                      | HttpClient, CredentialVault, FileSystem                                                                   | `usage.ts`, `copilot-quota`, `cursor-account`, `commandcode-usage`, `codex-reset-credits`, `providerFetch` |
| `UsageSnapshot`                   | `get`, `refresh`, `latest`, `invalidate`                                                                                                                      | ProviderUsage, AccountStore; `Cache`                                                                      | `account-usage.ts:createUsageCache`, `runtime.usageCache`                                                  |
| `LunaReserve`                     | `held(id)`, `engage(id)` (`Ref<HashMap>`), `shouldUse(id)`                                                                                                    | UsageSnapshot, Settings, Clock                                                                            | `host.ts:354-355,414-420,525-538`                                                                          |
| `UsageHistory`                    | storage, `collectNow`, scheduled sweep (`forkScoped` `Schedule.spaced`)                                                                                       | PluginStorage, UsageSnapshot                                                                              | `usage-recorder.ts` (`setInterval`, `inFlight`)                                                            |
| `FastModeUsage`, `ServingAccount` | storage-backed recorders                                                                                                                                      | PluginStorage                                                                                             | `fast-mode-usage-history.ts`, `serving-account.ts`                                                         |
| `PricingCatalog`                  | `quote`, `status`, `ensureFresh`; refresh fiber                                                                                                               | HttpClient, FileSystem, Settings                                                                          | `pricing-catalog.ts` fetch/`inFlight`, `host.ts:108-121,251-263` WeakMap+Schedule facade                   |
| `ModelFallbacks`                  | store + router state                                                                                                                                          | PluginStorage, AccountPool                                                                                | `model-fallback-host.ts:12-49` module singleton, `runtime.modelFallbackRouter`                             |
| `FailureRecovery`                 | `recover(input)`, `noteServed`, `forget`                                                                                                                      | AccountPool, AccountRoutes, LunaReserve, ModelFallbacks, Settings, Random(uuid)                           | `FailureRecoveryModel.create` wiring at `host.ts:509-544`                                                  |
| `RetryWait`                       | `wait(sessionId, delay)`, `release(sessionId)`                                                                                                                | `FiberMap`/`Deferred`, Clock                                                                              | `request-retry-wait.ts`                                                                                    |
| `QuotaContinuations`              | `recordFailure`, `list`, `resume`, `dismiss`, `snooze`, agent attach                                                                                          | PluginStorage, CordisHost(schedule, agents), UsageSnapshot; per-session `RcMap<Semaphore>`                | `quota-continuation.ts` `sessionChains`, `domainOpening`, `perAgent`                                       |
| `AccountLocks`                    | `withAccounts(ids, eff)` fail-fast; `withHome(home, eff)` exclusive/reentrant                                                                                 | `Ref<HashSet>`, `RcMap<home, Semaphore>`, `Context.Reference<HeldHomes>`                                  | `AccountSessionWorkModel`, `AccountCredentialHomeWork`                                                     |
| `CodexLogin`                      | `begin`, `state` (`SubscriptionRef<HashMap<id,LoginState>>`), `cancel`, `commitPending`, `reconcile`                                                          | ChildProcessSpawner, FileSystem, AccountStore, AccountLocks; `FiberMap<id>`                               | `account-login-service.ts` 6 Maps + timers, `codex-login-process.ts`, `installAccountLogin`                |
| `CopilotLogin`                    | device flow, poll via `Schedule`                                                                                                                              | HttpClient, CredentialVault                                                                               | `copilot-login.ts`                                                                                         |
| `AccountSetup`                    | prepare/configure/verify/commit/discard; expiry `FiberMap<operationId>` + `Effect.sleep(ttl)`                                                                 | AccountStore, CodexLogin, CopilotLogin, CredentialVault, ConnectionVerifier, AccountRoutes, UsageSnapshot | `account-setup-service.ts` + the 70-line callback object at `host.ts:151-221`                              |
| `ConnectionVerifier`              | `verify(request)`                                                                                                                                             | ProviderUsage, ChildProcessSpawner (claude status), FileSystem                                            | `account-connection-verification.ts`, `claude-auth-status.ts`                                              |
| `ClaudeCli`                       | `stream(model, ctx, opts): Stream<Event>`; sessions in `RcMap` (`idleTimeToLive: '30 minutes'`)                                                               | ChildProcessSpawner                                                                                       | `claude-cli.ts` `sessions` Map + `idleTimer`                                                               |
| `FastMode`                        | `status/set/delete/withRequest` (`Ref`)                                                                                                                       | Settings, AccountRoutes                                                                                   | `FastModeService`                                                                                          |
| `RequestRouting` (application)    | `onAgentRequest`, `onRequestError`, `onTurnStopping`, `onRequestMessages`, `onStream` (all `Effect.fn`), `activeRoutes: Ref<HashMap<sessionId, ActiveRoute>>` | everything above                                                                                          | `host.ts:545-593, 853-1101`                                                                                |
| `ProviderAdapter`                 | builds the `EffortPinnedAdapter` from `AccountRoutes`, credential callbacks run via `Runtime`                                                                 | AccountRoutes, CredentialVault, FastMode, RequestRouting                                                  | `host.ts:599-720`                                                                                          |
| `Settings`                        | typed reads of `AccountSettingsModel`                                                                                                                         | dshx `SettingsRead`                                                                                       | `settings.ts:123` module `let`                                                                             |

### Layer graph

```
                         CordisEdgeLive(ctx)  ── CordisHost, LlmRegistry, CredentialVault, SessionModelControl
                                │               dshx PluginStorage, SettingsRead
PlatformLive ── NodeServices(FileSystem, Path, ChildProcessSpawner) + FetchHttpClient.layer + tracer
                                │
 ┌──────────── Layer.provideMerge ────────────────────────────────────────────────────┐
 │ AccountStore ─► AccountRoutes ◄─ ModelCatalogs                                       │
 │ AccountLocks   AccountPool(Clock,Random)   Settings                                  │
 │ ProviderUsage ─► UsageSnapshot ─► LunaReserve, UsageHistory                          │
 │ PricingCatalog   ServingAccount   FastModeUsage   FastMode                           │
 │ ModelFallbacks ─► FailureRecovery ◄─ AccountPool, AccountRoutes, LunaReserve          │
 │ RetryWait   QuotaContinuations(◄ UsageSnapshot)                                      │
 │ ClaudeCli   CodexLogin ◄ AccountLocks   CopilotLogin   ConnectionVerifier             │
 │ AccountSetup ◄ CodexLogin, CopilotLogin, ConnectionVerifier, AccountRoutes            │
 │ ProviderAdapter ◄ AccountRoutes, CredentialVault, FastMode, ClaudeCli                 │
 │ RequestRouting ◄ (all routing/recovery services)                                    │
 └────────────────────────────────────────────────────────────────────────────────────┘
                                │
           AiAccountsLive = Layer.mergeAll(...).pipe(Layer.provide(CordisEdgeLive(ctx)), Layer.provide(PlatformLive))
                                │
   DshxEffect.plugin({ layer: ctx => AiAccountsLive(ctx), setup: installHooks })   // one runtime, one scope
   plugin.hostApi(contract, { method: Effect.fn(...)(function* ({input,caller}) { const s = yield* X; ... }) })
```

Test layers: `AccountStore.layerMemory(file)`, `CordisHost.layerTest` (records `on` registrations; lets a test fire `agent/request-error`), `ChildProcessSpawner` test layer returning scripted processes, `HttpClient` from a `HttpClient.make` handler, `TestClock`, `Random` seeded.

### Cordis edge (after)

- `definePlugin` stays (Cordis requires it) but `setup` becomes `accountsPlugin.setup(ctx, config)` only; the returned release is wired once via `ctx.effect`. No `WeakMap`, no runtime bag.
- `installHooks` (the plugin `setup` Effect) registers each Cordis listener with `Effect.acquireRelease`; each listener body is `runtime.runPromise(routing.onAgentRequest(...))` with the Cordis `signal` (or `runSync` for the synchronous `llm/stream` attribution choice, then `Stream.toAsyncIterable` for chunk observation). Per-agent listeners live in a child `Scope` keyed in a `FiberMap`/`ScopedRef` by agent id, closed on `agent/disposed`.
- All 7 APIs use `accountsPlugin.hostApi(...)` (runtime-aware), deleting `host-effect.ts` and every `accountRuntime(ctx)?.x` lookup.

### Error taxonomy (`Schema.TaggedError`, `cause: Schema.optional(Schema.Defect)` where wrapping)

`AccountNotFound{instanceId}`, `AccountOperationBusy{instanceIds}`, `LoginIntentInactive{instanceId,operationId}`, `CallerForbidden{reason}`, `ServiceUnavailable{service}` (should disappear once services are layers), `SecretCatalogInactive`, `MissingCredential{provider,keyEnv}`, `CredentialStoreError{cause}`, `ProviderRequestError{provider,operation,status?,cause}` (from `HttpClientError`), `ProviderRateLimited{provider,retryAfter}`, `CodexLoginUnsupported`, `CodexLoginFailed{phase,cause}`, `CodexHomeUnsafe{path}`, `AccountStoreCorrupt{cause}`, `AccountStoreWriteError{cause}`, `StorageDomainError{domain,cause}`, `PricingFetchError{cause}`, `AutomaticSelectionRefused{sessionId}`, `UnservedProvider{provider}`, `ConnectionVerificationFailed{kind,reason}`. At the edge: `LlmError` mapping for adapter callbacks (`MissingCredential` → `LlmError('…','MISSING_CREDENTIAL')`), and a `catchTags` → actionable message mapper for API callers.

### Deleted imperative code (approx.)

`host-effect.ts` (15), `account-runtime.ts` (93), `account-write-queue.ts` (14), `request-retry-wait.ts` (36), `rolling-concurrency.ts` (53), `effect-zod-schema.ts` (16, moves to dshx), `AiAccountsSchema.decode*` helpers, `createUsageCache` (~50), `model-fallback-host.ts:12-49`, `usage-recorder` scheduler (~60), `account-credential-home-work` lock plumbing (~90), timer/AbortController/Map bookkeeping in `account-login-service`, `account-setup-service`, `claude-cli`, `quota-continuation` (~250 combined), `host.ts` shrinks from 1,105 to ~150 (edge + hook registration). Roughly **‑900 to ‑1,200 LOC** of plumbing.

### Before/after sketch — the usage cache (+ runtime bag) is the pattern every other change follows

Before (`account-usage.ts:66-112`, `host.ts:243-250`, `account-runtime.ts:27`):

```ts
runtime.usageCache = createUsageCache({ ttlMs: 30_000, timeoutMs: 30_000,
  read: signal => AccountsHostApiModel.readAccountsUsage(ctx, signal) })   // generation counter, inFlight, setTimeout race
ctx.on('credentials/reference-updated', ref => { if (...) runtime.usageCache?.invalidate() })
// elsewhere: accountRuntime(ctx)?.usageCache?.latest()?.cards.find(...)
```

After:

```ts
export class UsageSnapshot extends Context.Service<
  UsageSnapshot,
  {
    readonly get: Effect.Effect<AccountsUsage, ProviderRequestError>
    readonly latest: Effect.Effect<Option.Option<AccountsUsage>>
    readonly invalidate: Effect.Effect<void>
  }
>()('@dshfiles/ai-accounts/UsageSnapshot') {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const usage = yield* ProviderUsage
      const store = yield* AccountStore
      const host = yield* CordisHost
      const last = yield* Ref.make(Option.none<AccountsUsage>())
      const readAll = Effect.fn('ai-accounts usage sweep')(function* () {
        const file = yield* store.read
        const cards = yield* Effect.forEach(file.accounts, usage.read, { concurrency: 4 })
        const result = { cards }
        yield* Ref.set(last, Option.some(result))
        return result
      })
      const cache = yield* Cache.make({ capacity: 1, timeToLive: '30 seconds', lookup: (_: 'all') => readAll().pipe(Effect.timeout('30 seconds')) })
      const invalidate = Cache.invalidateAll(cache)
      yield* host.on('credentials/reference-updated', ref => store.usesKeyRef(ref).pipe(Effect.flatMap(uses => (uses ? invalidate : Effect.void))))
      return UsageSnapshot.of({ get: Cache.get(cache, 'all'), latest: Ref.get(last), invalidate })
    }),
  )
}
```

(Verify v4 `Cache.make` option names against `Cache.ts:297`; `timeout` adds `TimeoutError` — map it into `ProviderRequestError` or keep it in the union.)

## 5. Risky behaviour — characterization tests BEFORE refactor

1. **Fail-over hook ordering (`host.ts:892-952`, `969-1060`)**: `prepend: true` on `agent/request` and `agent/request-error` so account policy runs before DSH's provider retry; fallback-route substitution drops the proposed effort; `selectionPreflight` rewrite; `pool.bindRoute` only when distribution ≠ sticky; `active.accountId` mutated in place on failover; `userSelectedSinceRequest` checked **both before and after** the retry wait; `llm/retry` then `llm/retry-started` appended in that order. Zero tests today. Write a `CordisHost` fake that fires these events against today's `host.ts` and records `session.append` rows, `selectModel` calls and returned decisions.
2. **Pool routing (`account-pool.ts:107-190`)**: sticky affinity LRU (`STICKY_AFFINITY_LIMIT`), round-robin cursor per `scopeKey`, balanced weights (`lastUsedAt === 0 ? 4 : idle seconds`, `Math.random`), `replace` preserving cooldown/affinity and dropping bindings to disabled accounts, `noteDeclaredReset` floor/cap. Add seeded-random + fixed-clock tests so `Random`/`Clock` injection is provably behaviour-preserving.
3. **`wireAccountFor` vs `selectTurnAccount`** (`host.ts:583-593`, `929-948`): the `llm/stream` attribution reads `activeAccountRoutes` written by `agent/request`; side purposes never claim attribution (`ServingAccountModel.startRequest`). Test the cross-hook contract.
4. **Quota continuations (`quota-continuation.ts:272-510`)**: per-session serialization, inbox reconcile (`queueSource` manual vs schedule, removing a schedule message when a manual one competes), `makeRoom` eviction at `MAX_CONTINUATIONS`, `ensureScheduled` dedupe + delete-if-no-longer-waiting race, `recordFailure` resetAt precedence (`readResetAt` → message parse). `quota-continuation-service.test.ts` (414 LOC) exists; extend it for reconcile on resume/compact and for concurrent `recordFailure`+`preStep` on one session.
5. **Login staging (`account-login-service.ts`, `codex-login-files.ts`, `codex-login-process.ts`)**: staged home → adopt only after verification; `deferAdoption` while a setup candidate exists; detached process-group kill (`codex-login-process.ts:33,55-60`) — **verify `effect/process` kills the whole group** (`detached` + negative-pid kill) before switching; never clean a home before `close`; device code redaction for non-client callers (`AccountLoginHostModel.forCaller`). Existing tests mock `node:child_process`; replace with a scripted `ChildProcessSpawner` and keep assertions.
6. **Synchronous activation**: `host.ts:289-296` primes the store synchronously because "an unprimed cache … registers no routes at all". Moving registration into an async Effect `setup` opens a window where resumed sessions request an unregistered provider. Either keep a `Layer.sync` initial snapshot via one sync read at the edge, or prove DSH tolerates late `registerAdapter`. Test: boot + immediate request.
7. **Usage cache generation**: an `invalidate()` during an in-flight read must drop that result (`account-usage.ts:79,87`). Confirm `Cache.invalidateAll` semantics in v4 for pending lookups before relying on it; otherwise keep a generation `Ref`.
8. **Route refresh serialization** (`host.ts:816-823`): a failed refresh must not poison later ones; catalog refresh aborts stale fetch when the route changes (`sameKeyedRoute`).
9. **Account lock fail-fast** (`account-runtime.ts:51`): concurrent operation **rejects**, not queues — easy to break by swapping in `withPermit`. Use `withPermitsIfAvailable` or `Ref.modify`.

## 6. Cross-cutting patterns (fix once)

- `effectHandler`-style `tryPromise` wrappers → mandate `plugin.hostApi` with service `yield*`; add an antislop rule flagging `Effect.tryPromise({ catch: error => error })` and `DshxEffect.host` inside a plugin that also calls `DshxEffect.plugin`.
- `WeakMap<Context, X>` runtime bags + `if (runtime.x === x) delete runtime.x` → services in the plugin layer.
- Module-level storage singletons (`let opening`) → `acquireRelease` in service layer via dshx `PluginStorage`; move `asZodSchema` into dshx so storage takes an Effect schema directly.
- Bespoke `decode`/`decodeResult` wrapper classes → use `Schema.decodeUnknown*` directly.
- Double spans (`Effect.fn` + dshx `dshx-effect …`): pick one naming owner in dshx.
- Promise-chain locks / `inFlight` dedupe / `setTimeout` expiry / `setInterval` polls → Semaphore, Cache/FiberHandle, FiberMap+sleep, Schedule.
- `vi.mock('node:*')` + `useFakeTimers` → platform test layers + `TestClock` with `@effect/vitest`.
- `@effect/platform-node` is not in the workspace catalog; adding it is a prerequisite for FileSystem/ChildProcess (bundle via `host.bundleDependencies`).

## 7. Ordered migration steps

| #   | Step                                                                                                                                                                                                                                 | Depends | Verification                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0   | Characterization tests (risks 1-9) against current code, plain vitest; fake `CordisHost`/agent context; seeded random/fixed clock for pool                                                                                           | —       | `pnpm --dir plugins/@dshfiles/ai-accounts exec vitest run src/<new>.test.ts` green on current code                           |
| 1   | Add `@effect/vitest`, `@effect/platform-node` (catalog); switch host to `DshxEffect.plugin({ layer: ctx => … })`; define `CordisHost`, `LlmRegistry`, `CredentialVault`, `SessionModelControl` edge layers; move all `ctx.get` there | 0       | host-boot test + import-check of built `dist/index.js` (`dsh-plugin-verify`)                                                 |
| 2   | Error taxonomy module (`errors.ts`) + edge mapper to actionable API messages / `LlmError`                                                                                                                                            | 1       | API tests assert tagged failure → message                                                                                    |
| 3   | Leaf services: `AccountStore` (FileSystem, Semaphore, SubscriptionRef), `Settings`, `AccountLocks`, `AccountPool` (Ref+Clock+Random)                                                                                                 | 1,2     | `it.effect` ports of `account-store-prime`, `account-pool`, lock tests; TestClock                                            |
| 4   | `ProviderUsage` on `HttpClient` (replace `providerFetch`, keep span name), `UsageSnapshot` (Cache), `LunaReserve`, `UsageHistory` (Schedule), `PricingCatalog` (opencode `models-dev.ts` shape)                                      | 3       | `provider-usage`, `usage-recorder`, `pricing-catalog` tests on `HttpClient` test layer; `traces_search` span names unchanged |
| 5   | `AccountRoutes` + `ModelCatalogs` (FiberMap) + `LlmRegistry` reconcile; resolve sync-activation risk (6)                                                                                                                             | 3,4     | boot-then-request characterization test; scratch DSH via `verify-dsh` lists routes                                           |
| 6   | `ModelFallbacks`, `FailureRecovery`, `RetryWait`, `FastMode`, `ServingAccount`; then `RequestRouting` hook handlers as `Effect.fn`, registered with `acquireRelease`                                                                 | 5       | risk-1/2/3 characterization suite unchanged and green                                                                        |
| 7   | `QuotaContinuations` (RcMap semaphores, PluginStorage, schedule port)                                                                                                                                                                | 4,6     | `quota-continuation-service/storage` tests ported to `it.effect`; risk-4 tests                                               |
| 8   | `ClaudeCli` (ChildProcess, RcMap idle TTL, Stream→AsyncIterable at adapter), `ConnectionVerifier`, `CodexLogin`, `CopilotLogin`, `AccountSetup` (FiberMap expiry)                                                                    | 1-5     | login/setup tests on scripted `ChildProcessSpawner`; manual scratch-profile sign-in; process-group kill check (`ps -o pgid`) |
| 9   | Move all 7 APIs to `plugin.hostApi` with `yield*`; delete `host-effect.ts`, `account-runtime.ts`, runtime bag, `AiAccountsSchema.decode*`, `rolling-concurrency.ts`, `request-retry-wait.ts`, `account-write-queue.ts`               | 3-8     | `api-tools.test.ts`, `account-session-host.test.ts`; agent tool smoke in scratch DSH; `pnpm typecheck && pnpm lint`          |
| 10  | Replace remaining `vi.mock('node:*')`/`useFakeTimers` tests with layers + TestClock                                                                                                                                                  | 8       | `grep -l "vi.mock('node:" src` = 0                                                                                           |

Unverified: no code was run; v4 `Cache.invalidateAll` behaviour on pending lookups and `effect/process` process-group kill were read from source signatures only, not exercised.
