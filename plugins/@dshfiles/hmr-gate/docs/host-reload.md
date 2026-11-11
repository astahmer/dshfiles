# In-process Host reload

Can a plugin's rebuilt Host half (`dist/index.js`) replace the running one without restarting DSH? Investigation and
prototype of 2026-11-11 on DSH 0.2.1-rc.2 (installed core: `@deepseek-ai/cordis` 4.0.5, `cordis-plugin-loader` 1.0.6,
`dsh-hmr` 0.2.1-rc.2, Node 22.23.3). Behaviour of the gate itself is in the [README](../README.md); why the gate exists
is in the [design](design.md).

**Verdict.** Feasible today for **owned, stateless `defineHost` plugins** (APIs, agent tools, settings, prompts
registered through `ctx`). Feasible for **stateless `DshxPlugin.make` (Effect) plugins once the dshx activation-slot
fix lands** (lane 10cc5fd0): until then the old generation's Effect runtime is never stopped, and a failed activation
can exit the Host. Plugins owning sqlite handles, servers, subprocesses or watchers need their own
dispose/handover proof before they opt in. Core rows and native forks (session-controller, agent-loop,
persistence) stay restart-only.

## How DSH loads a Host plugin

| Step                                                                                                                                                                                                                                                                                                                 | Where                                                                                           | What it means for reload                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Loader row is an `Entry`; `_init` imports `options.name`, unwraps the exports and starts `registry.plugin(plugin, config)` in the Entry's context, then keeps `moduleNamespace`                                                                                                                                    | cordis-plugin-loader 1.0.6 `lib/index.js:450-465`                                               | The swap verb is these four lines; 1.0.5 (this repo's dev dependency) has no `moduleNamespace` (`diff` against 1.0.5 at 315-316, 451-464)           |
| Import goes through Node's internal ESM loader when reachable (`loader.internal.import`)                                                                                                                                                                                                                             | `lib/index.js:214-228`, `ModuleLoader.fromInternal` `:29-38` (via `node-addon-require-builtin`) | `import()` is cached per URL; no public invalidation                                                                                                |
| `Entry.update()` disposes the fiber on `disabled`, re-runs `_patchContext` on a config change, and only re-imports when no fiber exists (`refresh`)                                                                                                                                                                  | `lib/index.js:361-389`                                                                          | Disable → enable re-uses the **cached** module: new code never loads                                                                                |
| Disposing an Entry fiber while its runtime is still registered makes the Loader persist `disabled: true` into the profile                                                                                                                                                                                            | `internal/plugin` hook `lib/index.js:628-643`                                                   | A swap must `registry.delete(plugin)` first: it drops the runtime before disposing (`cordis lib/index.js:1565-1571`), so the hook returns at `:636` |
| A plugin fiber collects the disposer its `apply` returns, also from a promise                                                                                                                                                                                                                                        | cordis `lib/index.js:1135-1143`, unload `:1371-1385`                                            | Everything a plugin registers through `ctx` (`ctx.effect`, `ctx.on`, tools, routes) dies with the fiber                                             |
| `@deepseek-ai/dsh-hmr` already does per-plugin replacement: watches a tree with chokidar, evicts changed URLs from `internal.loadCache` (`Map.prototype.delete`, because Node's `LoadCache.delete` clears one type slot), re-imports, `registry.delete(old)` then `registry.plugin(new, config)`, emits `hmr/reload` | `dsh-hmr lib/index.js:1015-1149`, `evict` `:1157-1178`                                          | Proven mechanism; the `web` profile disables the row because whole-profile recomposition wedged `sessionQuery` (#10237)                             |
| Agent tools live in `dsh-tools` scoped layers; `view(scope)` merges the global layer **on every call**, and `schemas(scope)` is computed per request                                                                                                                                                                 | `dsh-tools lib/index.js:2974-2983`, `:3055-3075`, `:3119-3121`                                  | A re-registered global tool reaches existing Agents at their next request; a call in the swap gap gets `UNKNOWN_TOOL`                               |
| After boot, `dsh-app-boot` treats any `unhandledRejection` as `fatal load failure` and exits                                                                                                                                                                                                                         | `dsh-app-boot lib/index.js:4240-4243`                                                           | Any activation rejection that escapes Cordis ends the Host (row 109 in [Host gaps](../../../../plans/dsh-host-gaps.md))                             |

ESM caching: a cache-busting query (`dist/index.js?v=N`) is a new module record that is never freed, and it does not
reach the bundle's own relative chunks (they resolve to the old cached URLs). Measured on the scratch Host: 20
cache-busted imports of `capabilities-hub/dist/index.js` left `loadCache` +20 entries and heap +1.01 MB after GC.
Evicting the package's own `loadCache` keys and importing the plain URL again keeps both flat (below). There is no
worker or isolate boundary in the Host: it is one Node process (`dsh/lib/bin.js`), so eviction is the only lever short
of a restart.

What hmr-gate did before this change: it gates **client** HMR. It watches client bundles, compares the digest of the
paired Host artifact with the digest the Host loaded, and defers the `rebuilt` frame while they differ, because the Host
never reloads plugin code in this profile. It releases a deferral on `hmr/reload`. It did not load Host code.

dshx already ships a development-only variant: `dev.hostHmr` (`tooling/dshx/packages/dshx/src/host/generation.ts`)
wraps the implementation in a stable Loader plugin that imports content-addressed generations and swaps child fibers
with last-good restore. It only applies under `dshx dev`, and its stable wrapper must be what the Host loaded at boot.

## Reload safety by plugin class

From a heuristic source scan of the 89 owned packages with a Host half (sqlite, `child_process`, `createServer`,
timers/watchers, module-level `let`, `native-fork.json`):

| Class                                                             | Examples                                                                                                         | In-process reload                  | Why                                                                                                                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Stateless `defineHost` (APIs, tools, settings, prompts via `ctx`) | attachment-gallery, backlog-jira, backlog-notion, main-tabs, test-runs, tool-meta, turn-summary, workbench       | **Safe**                           | Every registration is a `ctx` effect; disposal is complete                                                                                   |
| Stateless `DshxPlugin.make` (Effect layer, no I/O resources)      | capabilities-hub, apply-patch, html-render, agent-toolkit, plugin-guide, settings-shell, web-fetch-readable (15) | **Safe after lane 10cc5fd0**       | Today the old Effect runtime keeps serving after dispose, and re-activating a disposed generation exits the Host                             |
| Timers, watchers, background workers (27)                         | backlog gate watch, pull-requests sweep, thread-sidebar scans                                                    | Opt-in per plugin after a leak run | Safe only if every timer is a `ctx.effect` / layer-scoped fiber; a module top-level timer leaks one per reload (measured below)              |
| Module-level state (21: `let runtime`, `globalThis[…]`)           | hmr-gate itself, attention providers                                                                             | Case by case                       | Re-import resets module state; process-global registries (`Symbol.for`) survive and must be keyed by fiber                                   |
| sqlite / storage handles (9)                                      | memory, traces, usage, backlog, session-search, whiteboard                                                       | Not yet                            | Needs proven close-before-open on the same file and no write in flight; WAL handles survive a missed dispose                                 |
| Servers and sockets (12)                                          | traces receiver, loopback-access, phone-access, mcp-endpoint, multi-host                                         | Not yet                            | Port re-bind ordering and open client connections; a gap drops traffic                                                                       |
| Subprocesses (23)                                                 | ai-accounts logins, jujutsu, project-checks                                                                      | Not yet                            | Children are not fiber-scoped unless the plugin kills them on dispose                                                                        |
| dshx API-registry leader (first dshx Host to join)                | whichever loads first (hmr-gate on the scratch)                                                                  | Avoid                              | Disposing the leader hands over the shared event, batch and storage routes (`api/host-runtime.ts:515-531`): every plugin's stream reconnects |
| Native forks that replace core rows (19)                          | session-controller, agent-loop, session-persistence-jsonl, chat, rich-composer, storage-json                     | **Never**                          | They own live Session/Agent state and services other rows inject; this is the #10237 wedge                                                   |
| The reloader itself                                               | hmr-gate                                                                                                         | Never                              | It cannot dispose the code running the swap                                                                                                  |

What live Sessions hold: Agents resolve tools by name per request (above), API callers go through the dshx registry by
key, and settings scopes re-resolve their Loader Entry fiber. None of them caches a plugin's objects across a swap, so
re-registration reaches existing Sessions. An in-flight call keeps the closure it started with and completes on the old
generation.

## Prototype

Off by default; two switches, both required:

1. The `dshfiles-hmr-gate` Loader row config `hostReload: true` (profile `cordis.patch.yml`, outside the marked block).
2. The rebuilt plugin's `package.json`: `"dshx": { "hostReload": "safe" }`. No plugin opts in yet.

Trigger: the gate already sees each client rebuild and the paired Host digest. When the verdict is _defer_ and both
switches hold, it queues one reload (`src/host/host-reload.ts`), serialized:

1. Find the single Loader Entry whose `options.name` is the package and read its `moduleNamespace`.
2. Evict the package's own `loadCache` keys (its `dist/`, never its `node_modules` or the shared dshx runtime store),
   keeping a backup.
3. `import()` the Host entry again. A throw restores the backup → `failed: import-failed`, the old code keeps running.
4. Compare the Loader contract (`name`, `inject`, `Config` JSON). A change restores the backup →
   `refused: contract-changed` (needs a restart, like dshx `hostContractVersion`).
5. `registry.delete(old)`, wait for the fiber, `entry.ctx.registry.plugin(new, entry.options.config)`, set
   `entry.fiber` / `entry.moduleNamespace`, wait for activation.
6. Activation failure: delete the new runtime, restore the cache, start the previous plugin again →
   `failed: activation-failed`. **This step relies on lane 10cc5fd0**: on today's dshx it re-enters the old activation
   slot and exits the Host.
7. Success: `gate.release([hostPath])`, announce the held-back client rebuild, log, record a `host-reload apply` span.

`hmr_gate_status` gains `hostReload: { enabled, recent[≤16] }`. A refused or failed reload leaves the plugin in the
deferred list, so the restart notice and Inbox item stay: full restart is the fallback.

### Results (scratch DSH, installed core, `@dshfiles/hmr-gate` + `@dshfiles/capabilities-hub`)

Driven through the Host inspector (`SIGUSR1` on the scratch Host only); each reload = rewrite
`capabilities-hub/dist/index.js` with a new marker and touch `dist/client.js`.

| Check                                                               | Result                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setting off, rebuilt Host half                                      | Deferred (`host-artifact-changed`), no swap in 15 s, old behaviour served                                                                                                                                                                |
| New behaviour live                                                  | `overview` returned the new marker after each swap; `capabilities_hub_overview` resolved to the new definition                                                                                                                           |
| Reload latency (gate's own measure, import → active)                | 17-148 ms in most swaps, up to 1.7 s under GC/inspector load; trigger → swap p50 200-378 ms (includes the 50 ms settle)                                                                                                                  |
| Leak, 60 swaps (3 × 20), after forced GC                            | heap 90.46 → 91.06 MB overall (+0.60 MB; per batch +0.97, +0.12, +0.04: warm-up, not linear); `loadCache` 1370 → 1370; Cordis runtimes 266 → 266; capabilities-hub runtimes 1; dshx APIs 5; Timeout handles 2 → 2; FSEventWrap 148 → 148 |
| Cache-busting instead of eviction, 20 imports                       | `loadCache` +20, heap +1.01 MB, never reclaimed                                                                                                                                                                                          |
| Module top-level `setInterval` (deliberately leaky bundle), 5 swaps | Timeout handles 2 → 7: module side effects outside `ctx` leak one per reload                                                                                                                                                             |
| In-flight API calls across a swap                                   | 715 in-process `overview` dispatches fired every ~2 ms during a swap: 715 ok, 0 errors, 0 pending                                                                                                                                        |
| Existing Sessions                                                   | Two live Agents (seeded thread): both scopes' `view` switched from the old to the new `capabilities_hub_overview` definition, `schemas(scope)` lists it                                                                                  |
| Import throws                                                       | `failed: import-failed`, still deferred, old code serves                                                                                                                                                                                 |
| Loader `name` changed                                               | `refused: contract-changed`, still deferred, old code serves                                                                                                                                                                             |
| `apply` throws                                                      | Host exit: `fatal load failure: PluginInactive: dshfiles-capabilities-hub is already active in this process` (rollback re-entered the old dshx activation slot)                                                                          |
| Old generation after a successful swap                              | **Still serves** in-process dispatch: its Effect scope is never closed (same root cause)                                                                                                                                                 |
| Stock Loader disable → enable, no reload code                       | Disable leaves the runtime serving; enable exits the Host with the same fatal. Reported to lane 10cc5fd0                                                                                                                                 |
| hmr-gate row without config                                         | First build failed activation (`invalid config: Expected object`); fixed with a decoding default, regression test `src/host-config.test.ts`                                                                                              |

Known limits of the prototype:

- The trigger is a client bundle change. A Host-only plugin (no client row) is never watched.
- Restarting hmr-gate (for example changing its row config) re-baselines every digest from disk, so a Host half that
  was already deferred is forgotten until its next rebuild. This predates the prototype.
- Settings schema changes are not part of the contract check; treat them like `Config` and restart.
- The swap gap is a few ms: a tool call or API call that starts inside it gets `UNKNOWN_TOOL` / owner-missing.

## Rollout

1. Land lane 10cc5fd0 (dshx: stop the activation slot on dispose, allow re-activation, never reject unhandled). Re-run
   the leak table with an "old generation stopped" check (the captured old dispatcher must answer `PluginInactive`).
2. Move the opt-in into `dshx.config.ts` as `hostReload: 'safe'`; `dshx build` writes it to the package manifest the
   gate reads and refuses it for a package with `native-fork.json`, a `Config` schema without JSON form, or a Host
   module with top-level side effects it can detect.
3. Pilot one stateless `defineHost` plugin (turn-summary or tool-meta) with the row config on in a personal profile;
   then stateless Effect plugins.
4. Per class beyond that, opt in only with a plugin-specific leak run (handles, sqlite close, port re-bind).
5. Keep the full restart as the fallback in every refused/failed case; never reload native forks or core rows.

## Reproduce

```sh
pnpm --dir plugins/@dshfiles/hmr-gate test
DSHX_DSH_EXECUTABLE=<installed dsh bin> dshx dev up --name hostreload --plugin @dshfiles/hmr-gate --plugin @dshfiles/capabilities-hub --skip-build
# scratch only: kill -USR1 <scratch dsh pid>; Runtime.queryObjects on cordis-plugin-loader's Loader.prototype gives the Loader;
# loader.update('include:dshfiles-hmr-gate', { config: { hostReload: true } }); add the opt-in to the plugin's package.json;
# rewrite its dist/index.js and touch dist/client.js; read hmr_gate_status.hostReload.recent.
dshx dev down --name hostreload
```
