# Effect review rubric (dshfiles)

Context

- Repo (read-only review, DO NOT EDIT any repo file): /Users/astahmer/dev/dshfiles-threads/thread-72c437
- A previous agent wave "migrated" owned DSH plugin Host halves to Effect 4.1.0 (squashed in commit 2f90b2f0f39d,
  "feat(effect): migrate owned Host plugins to Effect 4.1 (#25)"). Plan: plans/effect-refactor/README.md.
- Foundation: tooling/dshx/packages/dshx/src/effect/{index,services,tracer,client}.ts exposes
  `DshxEffect.plugin({ layer, setup })` -> `{ hostApi, setup }`, `DshxEffect.host`, `DshxEffect.setup`,
  `DshxEffect.client`, `DshxEffect.events`, `DshxEffect.publish`, and services PluginStorage, SecretValues,
  Subprocess, HostApiClient, Communication, SettingsRead (Promise wrappers, single EffectHostServiceError).
- DSH core (Cordis `ctx`, `ctx.get(...)`, `ctx.inject`, `ctx.effect`, agent tools) stays Promise-based; Effect must live
  inside our code with adapters at the edge.
- The user believes the refactor is mediocre. Goal: the highest-standard Effect-native codebase. Be critical and concrete.
- Effect version is 4.1.0 (NOT 3.x). Verify every API you recommend against ~/.references/effect-4.1.0 source
  (packages/effect/src). v4 names: `Context.Service`, `Context.Reference`, `Effect.fn`, `Schema.TaggedError`,
  `Layer.effect/succeed/provide/provideMerge`, `effect/FileSystem`, `effect/Path`, `effect/unstable/process`,
  `effect/unstable/http`, `Effect.catchTag`, `Schedule`, `Semaphore`, `Cache`, `RcMap`, `SubscriptionRef`, `PubSub`, etc.
- Gold-standard references (read real code, cite file:line):
  - ~/.references/opencode (sst/opencode, effect 4.1.0) — esp. packages/core/src/plugin, packages/core/src/session,
    packages/server, packages/core/src/database
  - ~/.references/t3code (apps/server, packages/contracts, packages/shared)
  - ~/.references/effect-4.1.0 (source + tests + AGENTS/docs)

Rubric — check every item, cite file:line evidence

- R1 Facade: `Layer.empty`, `Effect.sync(() => imperativeSetup(ctx))`, `Effect.tryPromise` wrapping an async
  implementation that stays Promise/imperative, `effectify`/`effectHandler` adapters, module-level mutable singletons,
  `WeakMap<Context,…>` registries, `void promise.then(...)`, `ctx.effect` disposers next to an Effect Scope.
- R2 Services: domain logic as `Context.Service` classes with an effectful `make` and `static layer`; dependencies
  acquired with `yield*` inside `make`, not threaded as function params / closures over `ctx`; `ctx.get` only in one
  edge layer.
- R3 Layer graph: composition via `Layer.provide`/`provideMerge`/`mergeAll`, lifetimes via `Layer.effect`/scoped
  layers, test layers; no manual wiring objects.
- R4 Errors: one `Schema.TaggedError` per failure kind with `cause` preserved (`Schema.Defect`), no
  `message: String(error)` flattening, `catchTag`/`catchTags`, defects vs expected failures, no try/catch inside Effect
  code, no blanket `catch: () => new X()` dropping cause.
- R5 Resources/concurrency: Scope, `acquireRelease`, `forkScoped`/`forkIn`, `Schedule`, `Fiber`, `Queue`, `PubSub`,
  `Semaphore`, `SynchronizedRef`, `Deferred`, `Cache`, `RcMap`; vs hand-rolled timers, setInterval, promise locks,
  Maps of in-flight promises, AbortController plumbing.
- R6 Platform: `FileSystem`, `Path`, `ChildProcess`, `HttpClient`, `Config` vs node:fs / fetch / child_process direct.
- R7 Tracing: `Effect.fn('<subject> <verb>')`, no duplicate spans, span attributes identities/counts only.
- R8 Schema: idiomatic Effect Schema (Struct/Class/TaggedClass/brands/transformations), decode once at boundaries,
  no bespoke wrapper modules restating Schema APIs, no `as` casts, no zod residue where Effect Schema is used.
- R9 Tests: `@effect/vitest` `it.effect`/`it.layer`, test layers wrapping real implementations, no mocks.
- R10 Edges: `runPromise`/`runFork`/`runSync` only at Cordis/agent-tool/fork edges.

Report format (markdown). Write it to the report path given in your task AND send it back with send_message.

1. Summary table per unit: verdict (facade | partial | native), Effect-native % estimate, top 3 problems, effort S/M/L.
2. Per unit: findings by rubric id with file:line evidence; then a TARGET DESIGN: list of services (name, shape,
   dependencies), the layer graph (ascii), how the Cordis edge looks, error taxonomy, what imperative code is deleted.
   Include one short before/after code sketch of the most important change.
3. Cross-cutting patterns you saw repeated (so the plan can fix them once).
4. Ordered migration steps for your units with dependencies and verification per step.
   Be dense, no filler. Prefer concrete evidence over generalities. Do not edit repository files.
