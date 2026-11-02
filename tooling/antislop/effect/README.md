# Effect lint integration

This portable copy of the deployed `effect-antislop` Oxlint plugin is pinned to the Nixfiles `emilint` source revision `f4e442ebc003a2661a6cce98f738672e84b1c2d8`. Keep `oxlint/index.mjs` byte-identical to that generated implementation; update it from the pinned upstream source rather than editing or recreating rules here. Nixfiles and other repositories are not changed by this integration.

The upstream `effect-antislop` bundle stays byte-identical to its pinned emilint revision. The root `.oxlintrc.json` enables its `no-domain-effect-run` rule only for `tooling/dshx/packages/dshx/src/effect/**`; dshx's Promise boundary (`effect/index.ts`) and tracer context bridge (`effect/tracer.ts`) remain excluded.

`repo-rules/index.mjs` adds project-specific Effect migration checks without duplicating upstream rules. Avoid lifting an Effect operation through `Effect.promise`/`tryPromise`, catching Effect execution with JavaScript `try/catch`, uncurried `Schema.TaggedError`, raw `new Error` on an Effect failure path (except inside an `Effect.try`/`tryPromise` `try` callback whose `catch` maps it), unacquired global timers in an Effect program, `Effect.run*` inside a Host handler, and Cordis `ctx.get` outside a root Layer factory. Prefer direct Effect composition, typed Effect error handling and tagged errors, `Clock`/`Schedule` or `Effect.acquireRelease` with a matching clear finalizer for timers, returning Effects from handlers, and reading Cordis dependencies at the Layer edge; those preserve interruption, typed failures and plugin lifetime ownership.

`project-oxlint.config.json` scopes the error rules to Effect-bearing plugin sources and the dshx Effect boundary. `pnpm lint` runs the source scan and each rule's negative/positive fixture through `pnpm check:effect-antislop`.

Run the focused behavior fixtures from the repository root:

```sh
pnpm check:effect-antislop
```

The first fixture must fail with `effect-antislop(no-domain-effect-run)`; the adapter fixture must pass. `oxlint.test.config.json` narrows the same upstream rule to the fixture's domain directory and disables exclusions so the negative case is actually evaluated.
