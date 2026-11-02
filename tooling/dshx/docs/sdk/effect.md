# Effect in dshx

Effect is an opt-in authoring API for owned Host code. DSH core remains Promise-based: Cordis setup, hooks, agent tools, and the native tool protocol continue to receive and return Promises. dshx owns the Effect-to-Promise adapters at those boundaries. Existing Promise APIs, exports, and plugin registrations remain supported and unchanged.

## Decisions

| Topic | Decision | Boundary |
| --- | --- | --- |
| Version | Pin `effect` to exact `4.1.0` in the workspace catalog; dshx peers require `>=4.1.0 <5`. Any adopted `@effect/*` runtime package must be pinned to the same `4.1.0` release. | `pnpm-workspace.yaml`, dshx package manifest |
| Runtime lifetime | Use one `ManagedRuntime` per plugin instance. `DshxEffect.plugin({ layer, setup })` adds the dshx tracer, serves that runtime to `DshxEffect.host` handlers in the same Cordis context, and disposes its `Scope` and runtime on unload/reload. No process-global runtime. | Plugin root setup |
| Tracing | Bridge through dshx's `TracerModel`; do not install another exporter. Effect spans use the existing dshx OTLP exporter and recorder, so they retain `api-dispatch` / `agent-tool` parents and show up in the `traces` plugin. | `DshxEffect.tracerLayer` and default plugin setup |
| Span names and data | Name work-unit spans `<subject> <verb>`. Record bounded identities, counts, and failure types only; never arguments, results, secret values, prompts, or error messages. | Effect handlers and domain functions |
| Errors | Use one `Schema.TaggedError` per expected failure kind. Existing dshx mapping converts `_tag` to the remote kebab-case code; defects remain internal. | API boundary |
| Services | Use `Context.Service` classes and `Layer`. Read Cordis `ctx.get(...)` only in the plugin's root Layer, where Promise adapters can be constructed. | Layer construction |
| Promise edge | Keep `runPromise` and Promise conversion in dshx adapters, plugin registration, fork boundaries, and tests. Effect domain code composes Effects and never runs its own fibers as Promises. | `effect-antislop/no-domain-effect-run` is an error under `src/effect/**`, excluding only the API Promise boundary and tracer bridge. Valid/invalid Oxlint fixtures pin this behavior. |
| Schemas | Standard Schema remains the interop point. Effect Schema and zod can coexist per API; Effect discriminated unions are projected from `anyOf` to the native tool `oneOf` subset, while validation remains at the contract boundary. | `defineApi` / JSON Schema projection |
| Tests | Use `@effect/vitest` (`it.effect`, `it.layer`) for Effect tests. Exercise real implementations and scratch Layers; do not mock the Effect service being tested. | `tests/effect.spec.ts` includes `it.effect`; `@effect/vitest` is pinned to 4.1.0. |
| Cancellation | Pass the Host call's `AbortSignal` into `runPromiseExit`; interruption cancels the handler fiber. Scoped child processes must be interrupted and reaped. | `DshxEffect.host` and platform adapters |

## Current API

The public Promise API remains the baseline. Import the opt-in helpers from `@dshfiles/dshx/effect`:

```ts
import { Context, Effect, Layer, Schema } from 'effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineApi, method } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'

class Greeting extends Context.Service<Greeting, { readonly prefix: string }>()('example/Greeting') {}
class Missing extends Schema.TaggedError<Missing>()('Missing', { message: Schema.String }) {}

const greetingApi = defineApi({
  id: 'greeting',
  version: 1,
  methods: { hello: method<{ readonly name: string }, string>() },
})

const { hostApi, ...greetingPlugin } = DshxEffect.plugin({
  layer: Layer.succeed(Greeting, { prefix: 'Hello' }),
  setup: () => Effect.void,
})

export default defineHost({
  ...greetingPlugin,
  apis: [
    hostApi(greetingApi, {
      hello: ({ input }) => Effect.gen(function*() {
        const greeting = yield* Greeting
        if (input.name === '') return yield* Effect.fail(new Missing({ message: 'Name required' }))
        return `${greeting.prefix} ${input.name}`
      }),
    }),
  ],
})
```

`DshxEffect.plugin` owns one `ManagedRuntime` and `Scope` for that plugin instance. Use the returned `hostApi(contract, handlers)` helper (destructured from the plugin setup options before spreading them into `defineHost`) to type handlers against that Layer and select its runtime for the same Cordis context. `DshxEffect.host(contract, handlers, { runtime })` remains available for explicit composition; a service-free handler can omit the runtime. The call's `AbortSignal` interrupts the running fiber. A tagged typed failure becomes the existing Promise API error; defects are not sent as remote failures. Effect Schema values can be passed directly to `method` and `event` when the Effect adapter has been imported; the adapter supplies both Standard Schema validation and Standard JSON Schema. It omits only explicit `additionalProperties: true`, which is semantically the same as the existing zod projector's absence.

`DshxEffect.setup(program)` is a smaller Scope-only adapter for plugins that do not need a shared service Layer. Use `DshxEffect.client(promiseClient)` to create Effect-returning API methods, `DshxEffect.events(client, event)` for a cancellable event Stream, and `DshxEffect.publish(ctx, contract, event, payload)` on the Host. Stream publication composes through `Stream.runForEach` and `DshxEffect.publish`.

`DshxEffect.tracerLayer` is available for explicit `ManagedRuntime` construction. `DshxEffect.plugin` and `DshxEffect.setup` install it automatically. The bridge maps Effect parentage into dshx's `AsyncLocalStorage` while evaluating Effect primitives, and maps an active dshx span to an Effect `ExternalSpan`. Thus Promise work nested in Effect and Effect work nested in Promise spans retain the same trace. It delegates to dshx's recorder/exporter; it is not an OTLP exporter and does not require `@effect/opentelemetry`.

## Migration constraints

- Keep Promise exports, `defineApi`, `defineHost`, tool handlers, and native DSH contracts intact. Effect is an opt-in alternate implementation, not a parallel RPC/tool transport.
- Keep `api-dispatch`, `agent-tool`, and custom telemetry contracts accurate. Tests use `recordSpans()` to prove the actual recorded child relationships.
- Keep the tool schema projector unchanged to repair schema differences. Add annotations to individual schemas only when a pre-change snapshot demonstrates the exact correction needed.
- Do not import Effect into vendored native forks. An owned delta may call a dshx helper through its Promise adapter.
- Do not migrate any plugin as part of the foundation. Pilot/plugin migrations are separate isolated threads after this foundation is integrated.

## Phase 1 checklist

| Deliverable | State |
| --- | --- |
| `DshxEffect.plugin` with per-instance `ManagedRuntime` and scoped disposal | implemented |
| `DshxEffect.host` default runtime, explicit runtime compatibility, AbortSignal interruption | implemented |
| Host service Layers and Effect Schema `defineApi` conversion | plugin `Layer` + context-bound typed API handlers and direct Effect Schema conversion implemented; named Host service adapters pending |
| dshx tracer bridge and both-direction parentage test | implemented |
| Event/publish helpers; Promise APIs unchanged | existing and retained |
| Tool-schema JSON dump and committed pre-Effect snapshot | collected; the fixture remains unchanged by this migration, and the contract delta is reported separately |
| `effect-host` scaffold template | implemented; generates a typed API/tool, plugin `Layer`, and `effect@4.1.0` dependency |
| Focused tests, package typecheck and targeted zod/Effect tool-schema parity | validated; the legacy built-bundle snapshot differs in documented Effect JSON Schema output |
