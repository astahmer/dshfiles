# Effect lint integration

This portable copy of the deployed `effect-antislop` Oxlint plugin is pinned to the Nixfiles `emilint` source revision `f4e442ebc003a2661a6cce98f738672e84b1c2d8`. Keep `oxlint/index.mjs` byte-identical to that generated implementation; update it from the pinned upstream source rather than editing or recreating rules here. Nixfiles and other repositories are not changed by this integration.

## Where each rule runs

`project-oxlint.config.json` enables all eight upstream `effect-antislop` rules and every `effect-migration` repo rule over `plugins/@dshfiles/**` and `tooling/dshx/packages/dshx/src/**` (vendored `src/native/**` is ignored). `no-domain-effect-run` covers plugin and dshx sources except the dshx edge modules `effect/{index,plugin,api,tool,events,tracer}.ts`, tests and fixtures. The upstream matcher treats a path pattern as ordered substrings, so scope options use distinctive fragments (`.test.`, `-db.`, `sqlite`) rather than short directory names.

`baseline.json` is the ratchet: finding counts per rule per file. `pnpm lint` runs `pnpm check:effect-antislop`, which fails when any rule/file count grows past the baseline (a new file starts at 0) and reports when counts went down. After removing findings, lower the baseline with:

```sh
node scripts/check-effect-antislop.mjs --update
```

Never raise the baseline to land new debt. The root `.oxlintrc.json` enables, as hard errors and for editor feedback, only the Effect rules that already have zero findings everywhere; ratcheted rules live in the project config alone.

## Repo rules

`repo-rules/index.mjs` adds project-specific checks without duplicating upstream rules. Each one is avoid → prefer:

| Rule                              | Avoid                                                                                  | Prefer                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `no-effect-api-promise-lift`      | lifting an Effect API through `Effect.promise`/`tryPromise`                            | composing the Effect directly                                                |
| `no-try-catch-around-effect`      | JavaScript `try/catch` around Effect execution                                         | `Effect.catch`/`catchTag`                                                    |
| `require-curried-tagged-error`    | uncurried `Schema.TaggedError`                                                         | `Schema.TaggedError<T>()('Tag', fields)`                                     |
| `no-raw-error-in-effect`          | `new Error` on an Effect failure path (outside a mapped `try` callback)                | a `Schema.TaggedError`                                                       |
| `no-unscoped-plugin-timer`        | timers in an Effect program without a matching release                                 | `Clock`/`Schedule`, or `Effect.acquireRelease` with the clear finalizer      |
| `no-run-promise-in-host-handler`  | `Effect.run*` inside a Host handler                                                    | returning the Effect                                                         |
| `no-cordis-get-outside-root-layer`| Cordis `ctx.get` outside the root Layer factory                                        | typed services provided by the root Layer                                    |
| `no-cause-dropping-catch`         | `Effect.try`/`tryPromise` whose `catch` ignores its parameter or returns it unchanged  | a tagged error with `cause: Schema.optional(Schema.Defect())`                |
| `no-empty-plugin-layer`           | `layer: Layer.empty` in `DshxEffect.plugin` / `DshxPlugin.make`                        | a Layer graph built from `HostContext`                                       |
| `no-gen-inside-fn`                | `Effect.fn('x')(params => Effect.gen(…))`                                              | `Effect.fn('x')(function* (params) { … })`                                   |
| `no-repeat-over-uncaught-effect`  | `Effect.repeat`/`forever` over a directly fallible lift with no recovery step          | `catch`/`catchCause`/`ignore`/`retry` inside the loop                         |
| `no-host-module-state`            | module-level `let`/`var` and `new WeakMap<Context…>` in Host files                     | state in a service built by the plugin Layer                                 |
| `no-host-global-timer`            | `setTimeout`/`setInterval` in Host files                                               | `Effect.sleep`/`Schedule`/`Clock` in a scoped fiber                          |
| `no-host-child-process`           | `node:child_process` in Host files                                                     | the DSH-backed `ChildProcessSpawner`                                         |
| `no-void-then`                    | `void p.then(…)` in files importing `effect`                                           | forking the work as an Effect in the owning scope                            |
| `effect-span-name-format`         | `Effect.fn`/`withSpan` literals that are not `<subject> <verb>`                        | lowercase words separated by single spaces, e.g. `'jj run'`, `'memory notes list'` |
| `no-effect-unstable-import`       | `effect/unstable/*` imports (absent in Effect 4.1)                                     | `effect`, `effect/process`, `effect/http`, `effect/sql`, `effect/rpc`         |

A Host file is a file reachable through runtime imports from a plugin's `dshx.config.ts` host entry (`host-files.mjs`, shared with `scripts/effect-native-audit.mjs`); client-only modules never count, even when they are plain `.ts`.

## Fixtures

```sh
pnpm check:effect-antislop
```

Every repo rule, plus the upstream rules whose fixtures emilint ships (`no-domain-effect-run`, `no-silent-error-swallow`), has a failing fixture (`repo-rules/fixtures/bad/*`, `tests/oxlint/{domain,implementation}/invalid-*`) that must report that rule — with an exact count for the newer rules — and a passing fixture that must not. `oxlint.test.config.json` narrows the upstream scope options to the fixture directories so the negative cases are actually evaluated.
