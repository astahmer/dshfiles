# Effect refactor

Move the owned dshfiles code (dshx SDK + owned plugin Host halves, optionally browser logic) onto Effect. DSH core
(Cordis services, hooks, agent tools) stays Promise-based: Effect lives inside our code, adapters sit at the edge.

**Resume here:** Phase 0 not started. First task: 0.1 (version pin + reference refresh).

## Progress

| Phase | Title                                 | State       | Wall time (6–8 agents) | Gate                                               |
| ----- | ------------------------------------- | ----------- | ---------------------- | -------------------------------------------------- |
| 0     | Decisions, conventions, tracer bridge | not started | 1 day                  | ADR table below signed off; bridge span test green |
| 1     | dshx Effect-native API                | not started | 2–3 days               | dshx tests + tool-schema snapshot byte-identical   |
| 2     | zod → Schema codemod                  | not started | 2–3 days (overlaps 3)  | per-plugin JSON-schema parity, zero diff           |
| 3     | Host halves, waves A–D                | not started | 6–8 days               | per-plugin checklist all ticked                    |
| 4     | Shared ports                          | not started | 1 day (with wave A)    | consumers typecheck + journeys                     |
| 5     | Browser logic (optional)              | not started | 5–7 days               | journeys + switch-probe budgets unchanged          |
| 6     | Stabilization, perf, live restart     | not started | 2–3 days               | full e2e, perf table, one user-approved restart    |
|       | **Host + dshx + Schema (0–4, 6)**     |             | **~2 weeks**           |                                                    |
|       | **Incl. browser side (0–6)**          |             | **~3 weeks**           | bound by verification + machine load, not typing   |

## Measured baseline (2026-10-29, `jj:main` 3c49886b)

| Fact                                                                             | Count                                                                              |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| TS source / test lines                                                           | 315k / 82k                                                                         |
| Plugins under `plugins/@dshfiles/*` / with Host half                             | 82 / 81 (66 declare `host:` in `dshx.config.ts`)                                   |
| Plugin source lines: total / native forks / in scope                             | 273k / 67k / 206k                                                                  |
| dshx SDK (`tooling/dshx`)                                                        | 42k lines; 70 files import zod                                                     |
| Files using async/Promise                                                        | 656                                                                                |
| Files importing zod (repo) / zod call sites in plugins                           | 402 / ~3.1k                                                                        |
| Files importing `effect`                                                         | 1 (`tooling/dshx/packages/dshx/src/effect/index.ts`, 185 lines, unused by plugins) |
| API contracts (`defineApi`/`defineContract`)                                     | 68                                                                                 |
| Agent tool bindings (`tool: {`) / `defineTool(`                                  | 290 / 54                                                                           |
| `withSpan`/`traced` call sites / `recordSpans` test files                        | 55 / 42                                                                            |
| Browser: `.tsx` files / TanStack Query files / stored-value files / xstate files | 454 / 122 / 42 / 4                                                                 |
| Unit test files / e2e feature files (`tooling/dshx/e2e/features`)                | 815 / 84                                                                           |

## Versions and API names (verified)

| Item                 | Value                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pinned `effect`      | `4.0.4` (`pnpm-workspace.yaml` catalog); dshx peer `>=4.0.4 <5`                                                                                        |
| Latest on npm        | `effect@4.1.0`; `@effect/platform-node`, `@effect/vitest`, `@effect/atom-react`, `@effect/opentelemetry` 4.1.0 (peer `^4.1.0`)                         |
| Reference repo       | `~/.references/effect` is at `4.0.0-rc.111` — **older than the pin**; refresh before reading APIs                                                      |
| Errors               | `Schema.TaggedError<Self>()('Tag', fields)`                                                                                                            |
| Functions / spans    | `Effect.fn('name')(function* …)` (traced), `Effect.fnUntraced`, `Effect.withSpan`, `Effect.withSpanScoped`                                             |
| Services             | `Context.Service` (class-style service key), `Context.Reference`; `Layer`, `ManagedRuntime`, `Scope`                                                   |
| Interop              | `Effect.tryPromise({ try: signal => …, catch })`, `Effect.runPromiseExit(e, { signal })`                                                               |
| Schema ↔ standards   | `Schema.toStandardSchemaV1`, `Schema.toStandardJSONSchemaV1`, `Schema.toJsonSchemaDocument`, module `JsonSchema`                                       |
| Platform (v4 merged) | `effect/FileSystem`, `effect/Path`, `effect/unstable/process` (`ChildProcess`), `effect/unstable/http`, `effect/unstable/observability` (`OtlpTracer`) |
| Tracer hook          | `Tracer.make({ span, context })`, `Tracer.externalSpan`, `Tracer.ParentSpanKey`                                                                        |
| React state          | `@effect/atom-react` over `effect/unstable/reactivity` (`Atom.make`, `Atom.runtime`, `Atom.fn`, `Atom.family`, `AsyncResult`)                          |

## Scope

| In                                                                                                      | Out (and why)                                                                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| dshx SDK runtime surfaces (`api`, `host`, `platform`, `tracing`, `communication`, `settings` Host side) | DSH core, Cordis services/hooks, the agent tool protocol: stay Promise                                 |
| Owned plugin Host halves (~60 plugins, ~206k lines total incl. client)                                  | Native forks (upstream sync cost; every delta re-applied on each bump): see list below                 |
| Shared ports `credential-port`, `vcs-provider-port`, `session-source-port`                              | `plugin-ui`, `ui-styles`, `shared-runtime`, React components                                           |
| Optional: browser data/state logic (Phase 5)                                                            | dshx CLI/compiler/scaffold (`cli`, `compiler`, `scaffold`, `scratch`: build tooling, no runtime value) |
| Settings: Host-side reads only                                                                          | `defineSettings` schemas: Cordis `schemastery`, rendered by core; stays                                |

### Native forks kept out (65–67k lines)

| Fork                 | Lines | Note                                                                                                  |
| -------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| `chat`               | 15.4k | client only                                                                                           |
| `rich-composer`      | 15.2k | client only                                                                                           |
| `session-controller` | 11.1k | **Decision: out.** Host side vendored; consumers wrap its `continuation-api` with `DshxEffect.client` |
| `workspace-nav`      | 6.1k  |                                                                                                       |
| `subprocess-local`   | 5.0k  | Host; upstream transport                                                                              |
| `sidebar-right`      | 4.9k  |                                                                                                       |
| `user-questions`     | 2.2k  |                                                                                                       |
| `input-trigger`      | 2.1k  | vendored, no `native-fork.json` (see its `UPSTREAM.md`)                                               |
| `agent-preset`       | 1.8k  |                                                                                                       |
| `model-selection`    | 1.5k  |                                                                                                       |
| `frame-layout`       | 1.5k  |                                                                                                       |
| `goal-tool`          | 0.5k  |                                                                                                       |
| `hmr-gate`           | 0.6k  | reimplements upstream transport; keep shape-equal to upstream                                         |

Rule: an owned delta file inside a fork may call an Effect helper through a Promise adapter, never import `effect`
into a vendored file. `node scripts/native-fork-diff.mjs` must stay clean.

## Phase 0 — decisions and conventions

| #    | Decision               | Choice                                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1  | Version                | Bump catalog to `effect@4.1.0` once (all `@effect/*` move in lockstep, exact pins). Refresh `~/.references/effect` to the `effect@4.1.0` tag.                                                                                                                                                                                                                                                        |
| 0.2  | One runtime per plugin | `ManagedRuntime.make(PluginLayer)` built in `DshxEffect.setup`; disposed with the plugin Scope on unload/reload. No global runtime.                                                                                                                                                                                                                                                                  |
| 0.3  | Tracing                | **Bridge, not a second exporter.** Implement an Effect `Tracer.make` that delegates to dshx `TracerModel.process()`; install it in every plugin runtime. Effect spans then nest under the dshx active span (`api-dispatch`, `agent-tool`) and leave through the existing OTLP export → `traces` plugin. Do not add `OtlpTracer`/`@effect/opentelemetry` (would duplicate spans and break parentage). |
| 0.4  | Span naming            | `Effect.fn('<subject> <verb>')` — same `<subject> <verb>` rule as the telemetry contract; attributes: identities and counts only. `dshx.features.json` `telemetry.custom` keeps naming the span; `recordSpans()` tests keep passing via the bridge.                                                                                                                                                  |
| 0.5  | Errors                 | One `Schema.TaggedError` per failure kind, defined next to the domain. Wire mapping already exists: `_tag` → `PluginApiError.code` (kebab-case). Defects stay internal.                                                                                                                                                                                                                              |
| 0.6  | Services               | `Context.Service` classes with `static layer`; Cordis `ctx.get(...)` reads only in the plugin's root Layer (edge adapter).                                                                                                                                                                                                                                                                           |
| 0.7  | Promise edge           | Allowed only in: dshx adapters, plugin `host.ts` registration, fork boundaries, tests. Lint: `effect-antislop` rule bans `runPromise` elsewhere.                                                                                                                                                                                                                                                     |
| 0.8  | Style                  | `Effect.fn` + `withSpan`, no `else`, dot notation, no destructuring, single-object args, `Schema.TaggedError`; `Effect.promise` only when no Effect API exists.                                                                                                                                                                                                                                      |
| 0.9  | Schema coexistence     | Contracts accept any Standard Schema already (`api/define.ts`), so zod and Effect Schema coexist per contract; migration is per plugin, not big-bang.                                                                                                                                                                                                                                                |
| 0.10 | Tests                  | `@effect/vitest` (`it.effect`, `it.layer`) for new Effect code; real services, no mocks (test Layers wrap real implementations with scratch dirs).                                                                                                                                                                                                                                                   |
| 0.11 | Abort                  | Every Host handler runs with the call's `AbortSignal` → fiber interruption (already in `DshxEffect.host`). Subprocesses via `ChildProcess` get killed on interrupt.                                                                                                                                                                                                                                  |

Deliverables: this ADR table promoted to `tooling/dshx/docs/sdk/effect.md`; antislop/effect-antislop rules enabled
for touched paths; `docs/observability.md` section on the bridge.
Verification: bridge unit test — an `Effect.fn` span inside `withSpan('parent')` records as child in `recordSpans()`; a
scratch DSH trace shows `api-dispatch → effect span` in `traces_get`.
Risks: Effect fiber context vs dshx AsyncLocalStorage parentage drift → test both directions (Effect inside dshx span,
dshx `withSpan` inside Effect).

## Phase 1 — dshx Effect-native API

Scope: `tooling/dshx/packages/dshx/src/{effect,api,host,platform,communication,tracing}` (~11k lines). Extend the
existing `@dshfiles/dshx/effect` export (`DshxEffect.host/setup/client/events/publish`).

| #   | Deliverable                                                                                                                                                                   | Notes                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1.1 | `DshxEffect.plugin({ layer, setup })`: plugin lifetime = `Scope`, runtime = `ManagedRuntime` of `layer`                                                                       | replaces ad-hoc `ctx.on('dispose')`; reload closes Scope         |
| 1.2 | Host services as Layers: `PluginStorage`, `SecretValues`, `Subprocess` (`ChildProcess`), `HostApiClient`, `Communication`, `Settings` (read)                                  | thin wrappers over existing dshx Promise modules                 |
| 1.3 | `DshxEffect.host` uses the plugin runtime by default; handler type `Effect<Out, TaggedError, Services>`                                                                       | typed failure union surfaces in contract docs                    |
| 1.4 | `defineApi` accepts Effect Schema directly (wrap with `Schema.toStandardSchemaV1` + `toStandardJSONSchemaV1` internally)                                                      | no call-site wrapping                                            |
| 1.5 | Tool schema parity harness: `dshx inspect tool-schemas --json` dumps `toToolSchema(publishedJsonSchema(...))` for all 290 bindings + 54 `defineTool`s from built Host bundles | committed snapshot `tooling/dshx/e2e/fixtures/tool-schemas.json` |
| 1.6 | Tracer bridge (0.3) shipped as `DshxEffect.tracerLayer`                                                                                                                       | default in 1.1                                                   |
| 1.7 | Streams: `events`/`publish` + `Stream` → Host event publication with backpressure                                                                                             |                                                                  |
| 1.8 | Promise API unchanged; Effect API is opt-in import                                                                                                                            | Promise adapters stay the public baseline                        |
| 1.9 | Docs: `tooling/dshx/docs/sdk/effect.md`, scaffold template `--template effect-host`                                                                                           |                                                                  |

Verification: `pnpm --dir tooling/dshx/packages/dshx test -- --run`, typecheck; tool-schema snapshot byte-identical vs
pre-change dump; one pilot plugin boots in `bootPluginProfile`.
Risks: Effect Schema JSON output differs from zod (`additionalProperties`, `$defs`, `anyOf` vs `oneOf`, `null`
handling, descriptions) → 1.5 snapshot is the gate; adjust annotations, never the projector, until zero diff.
Bundle size: Effect bundled per Host entry → measure `dist/index.js` size and Host boot time per plugin (Phase 6 budget).

## Phase 2 — zod → Schema codemod

Scope: 402 files / ~3.1k zod call sites (dshx 70 files; top plugins: ai-accounts 41, thread-sidebar 36, multi-host 20,
traces 18, jujutsu 17). Run per plugin inside its Phase 3 wave, not repo-wide.

| #   | Deliverable                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | ast-grep codemod (`safe-transformations` skill): `z.object/string/number/boolean/array/enum/literal/union/discriminatedUnion/optional/nullable/default/describe` → `Schema.*` |
| 2.2 | Residual report: `.refine/.superRefine/.transform/.preprocess/z.custom/.passthrough` listed per file for hand port                                                            |
| 2.3 | Parity check per contract: zod `toJSONSchema` vs `Schema.toJsonSchemaDocument` normalized diff + decode round-trip on recorded fixtures                                       |
| 2.4 | Tool schema snapshot (1.5) re-run per plugin                                                                                                                                  |
| 2.5 | Remove `zod` from a plugin's deps when its residual is zero; repo-wide drop only when count = 0                                                                               |

Verification: codemod idempotent (second run = no diff); `pnpm --dir plugins/@dshfiles/<p> typecheck test`; parity
script zero diff. Client forms (`@tanstack/react-form` + zod) stay on zod until Phase 5.
Risks: decode semantics (zod strips unknown keys; Effect Schema `Struct` also strips on decode but `exact` options
differ), `default` placement (decoding vs constructor), error message text shown in UI.

## Phase 3 — Host halves per plugin

Order by value: subprocess/job/queue/network heavy Hosts first (cancellation, retries, Scope gain most); thin CRUD last.
Waves run 6–8 agents in parallel, one plugin per agent workspace.

| Wave    | Plugins (src lines)                                                                                                                                                                                                                                                                                                                                                                             | Why                                                    | Days |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---- |
| A pilot | `secret-catalog` (5.1k), `jj-integration` (12.1k) + ports (Phase 4)                                                                                                                                                                                                                                                                                                                             | small subprocess Host, then the queue/cleanup-job Host | 2    |
| B       | `ai-accounts` (28.0k), `multi-host` (8.1k), `jujutsu` (12.9k), `backlog` (14.2k), `memory` (9.0k), `project-checks` (3.4k), `background-jobs` (2.1k)                                                                                                                                                                                                                                            | SSH, provider HTTP, durable jobs, polling              | 3    |
| C       | `traces` (9.2k), `usage` (6.2k), `mcp-servers` (4.3k), `annotations` (3.9k), `session-search` (2.0k), `activity-timeline` (1.9k), `agent-communication` (2.5k), `agent-questions` (2.8k), `editor` (2.7k), `worktree-memory` (1.9k), `settings-shell` (5.5k), `loopback-access` (1.2k), `pulls-review` (1.2k), `git-worktrees`, `fff-search`, `tweet-context`, `web-search-brave`, `references` | storage/indexing/IO, medium                            | 2    |
| D       | `thread-sidebar` Host part (21.9k total, mostly client), `agents`, `prompt-stash`, `queue-reorder`, `agent-toolkit`, `resource-packs`, `optmem-core`, `plugin-marketplace`, `agent-telemetry`, remaining <1k Hosts (~30)                                                                                                                                                                        | thin Hosts; batch 4–5 per agent                        | 1–2  |

### Per-plugin checklist

| Step | Check                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------- |
| 1    | Dump tool schemas + API JSON schemas (before)                                                                        |
| 2    | Plugin `Layer` + `DshxEffect.plugin`; `ctx.get` only in root Layer                                                   |
| 3    | Handlers → `Effect.fn('<subject> <verb>')`; failures → `Schema.TaggedError`; no `try/catch` around Effects           |
| 4    | Timers/intervals/watchers → `Effect.forkScoped` + `Schedule`; subprocesses → `ChildProcess`                          |
| 5    | zod → Schema (Phase 2) for this plugin                                                                               |
| 6    | `dshx.features.json` telemetry entries still accurate; `recordSpans()` tests green through bridge                    |
| 7    | Tool + API schema dump (after) == before, byte-identical                                                             |
| 8    | `pnpm --dir plugins/@dshfiles/<p> build typecheck test`; `pnpm lint`; Host bundle import check (`dsh-plugin-verify`) |
| 9    | Plugin e2e journeys green in scratch DSH (`verify-dsh`); old-Host/new-client tolerance unchanged                     |
| 10   | One revision per plugin, `refactor(<plugin>): move Host half to Effect`                                              |

Risks: hidden ordering/race behaviour in hand-written queues (jj-integration `integration-queue-machine`, ai-accounts
pool) → port behaviour tests first, unchanged; parallel agents touching shared catalog/lockfile → lockfile edits only
in Phase 0.1.

## Phase 4 — shared ports

| Package                                    | Lines | Change                                                                                           | Consumers check                                 |
| ------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `credential-port`                          | 177   | reference grammar as Schema; `SecretReferenceResolver` as `Context.Service`; keep Promise export | every `host.bundleDependencies` user typechecks |
| `vcs-provider-port`                        | 92    | provider interface as Service + TaggedErrors; keep Promise interface                             | jj-integration, jujutsu, git-worktrees          |
| `session-source-port`                      | 199   | same pattern                                                                                     | its importers                                   |
| `plugin-ui`, `ui-styles`, `shared-runtime` | —     | untouched                                                                                        | —                                               |

Runs with wave A (jj-integration depends on `vcs-provider-port`).

## Phase 5 — browser logic (optional)

React stays. Only data/state logic moves; components unchanged.

| Target                             | Count                                   | Move to                                                                             |
| ---------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| TanStack Query files               | 122                                     | `Atom.runtime(layer)` + `Atom.fn` over `DshxEffect.client`; `AsyncResult` in render |
| `createStoredValue`                | 42 files                                | `Atom.kvs`/stored atom only if it removes code; otherwise keep                      |
| xstate                             | 4 files (`plugin-ui`, `shared-runtime`) | keep unless an atom is strictly simpler                                             |
| Event subscriptions                | —                                       | `DshxEffect.events` → `Stream` → atom                                               |
| Forms (`@tanstack/react-form`+zod) | —                                       | keep; switch validator to Standard Schema from Effect Schema                        |

Gate: `plugin-state` skill updated first; pilot `backlog` client, measure bundle + switch probe before continuing.
Risks: client bundle growth (Effect in every `dist/client.js`) → share one Effect copy via `shared-runtime` externals
or keep Phase 5 out; HMR stays per-bundle.

## Phase 6 — stabilization

| #   | Deliverable                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | All 84 e2e features green in scratch DSH (`dshx dev up`), full unit suite, `pnpm lint typecheck fmt`, `pnpm check:cycles`, `node scripts/native-fork-diff.mjs`                                                                    |
| 6.2 | Perf budgets (`live-performance-audit`): Host boot time, Host event-loop lag, per-plugin `dist/index.js` size, thread switch probe — before/after table in `docs/performance.md`; budget: ≤ +10% boot, no new >250 ms interaction |
| 6.3 | Trace check: a representative turn shows Effect spans nested under `api-dispatch`/`agent-tool`, no orphans (`traces_search`, `traces_service_map`)                                                                                |
| 6.4 | Live restart plan: land on `main`, `dshx checkout sync`, Host + client rebuild; **user** triggers one Host restart ("Restart when idle"); rollback = `jj` revert of the wave revision + rebuild                                   |
| 6.5 | `complete-plan`: move ADR into `tooling/dshx/docs/sdk/effect.md`, delete this plan                                                                                                                                                |

## Wall-time model

| Assumption                                              | Effect on estimate                               |
| ------------------------------------------------------- | ------------------------------------------------ |
| 6–8 parallel agents, one workspace each                 | waves B/C fit in 2–3 days                        |
| Verification (build + scratch DSH + journeys) dominates | machine load caps concurrency at ~6 scratch DSHs |
| Phase 2 rides inside Phase 3                            | no separate repo-wide codemod window             |
| Phase 5 pilot may stop the browser phase                | 3-week figure assumes go after the pilot         |
