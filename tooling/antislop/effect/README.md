# Effect lint integration

This portable copy of the deployed `effect-antislop` Oxlint plugin is pinned to the Nixfiles `emilint` source revision `f4e442ebc003a2661a6cce98f738672e84b1c2d8`. Keep `oxlint/index.mjs` byte-identical to that generated implementation; update it from the pinned upstream source rather than editing or recreating rules here. Nixfiles and other repositories are not changed by this integration.

The root `.oxlintrc.json` enables `effect-antislop/no-domain-effect-run` as an error only for `tooling/dshx/packages/dshx/src/effect/**`. The two explicit exclusions are dshx's Promise boundary (`effect/index.ts`) and tracer context bridge (`effect/tracer.ts`); tests and fixture paths remain excluded by the rule defaults. New Effect domain modules in this directory must compose Effects and leave execution to those adapters.

Run the focused behavior fixtures from the repository root:

```sh
pnpm check:effect-antislop
```

The first fixture must fail with `effect-antislop(no-domain-effect-run)`; the adapter fixture must pass. `oxlint.test.config.json` narrows the same upstream rule to the fixture's domain directory and disables exclusions so the negative case is actually evaluated.
