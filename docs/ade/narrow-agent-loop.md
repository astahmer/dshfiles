# Narrow agent runtime bundle — status

The smallest merge that can enable OptMem full mode without giving up jj
workspace provisioning: replace the **agent rows only**, keep the native session
store, JSONL persistence and the session controller that provisions a workspace
per coding thread.

`plugins/@dshfiles/dsh-core-agent-loop` is that bundle. Its patch disables two
rows and inserts one:

```yaml
- id: agent
  name: '@deepseek-ai/dsh-agent'
  disabled: true
- id: agent-loop
  name: '@deepseek-ai/dsh-agent-loop'
  disabled: true
- insert:
    - id: dshfiles-core-agent-loop
      name: '@dshfiles/dsh-core-agent-loop'
```

The row id is package-scoped so it cannot replace an unrelated row; the service
names `agents` and `agentLoop` are unchanged, so every dependant still injects
the same services. `tests/patch-scope.test.mjs` asserts that the patch disables
exactly those two rows and never touches `session`, `session-controller` or
`session-persistence-jsonl`.

## Root cause of the import failure — captured

Earlier attempts guessed. Instrumenting the cordis loader's own `import` method
(the layer above `internal.import`, which succeeds) produced the real exception:

```
[PROBE] loader.import FAILED
[PROBE]   name: @dshfiles/dsh-core-agent-loop
[PROBE]   baseUrl: file:///private/tmp/dsh-narrow-verify/profiles/web/
[PROBE]   hasInternal: true
SyntaxError: The requested module '@deepseek-ai/dsh-agent' does not provide an
export named 'runtimeDriverEventSchema'
    at plugins/@dshfiles/dsh-core-agent-loop/dist/index.js:7
```

The fork agent loop consumes fork-only exports from the fork agent. Measured: the
loop imports **30 names** from `@deepseek-ai/dsh-agent`, and **19 of them do not
exist in the published agent** — including two runtime values,
`runtimeDriverEventSchema` and `runtimeDriverPromptResultSchema`.

So a loop-only swap is impossible, and the earlier "duplicate cordis identity"
theory was wrong: relinking the six externals to the native agent-loop's own
`.pnpm` instances changed nothing, because the missing symbols were never about
identity. `failed to import` was `entry.fiber === undefined` after a module
instantiation error the loader logged to a buffering logger.

The bundle now swaps **both** rows and inlines the fork agent, which resolves the
import: the scratch Host boots with **no `did not activate` warning**.

## The deeper blocker — the fork agent is not a drop-in

With both rows swapped the Host boots, the platform client connects, and then
session creation fails:

```
DshPlatformError: failed to create session "...": Error: Agent preset binding
requires a scoped context
```

That message comes from `@deepseek-ai/dsh-persona`: registering persona sections
needs an agent scope context, and the fork `AgentRegistry` does not provide the
one the deployed `dsh-persona` / `dsh-agent-preset` generation expects. The fork
agent is from a different development generation than the deployed preset stack.

This is a genuine incompatibility, demonstrated rather than assumed. The narrow
two-row swap cannot ship as-is: it would break every new session.

## Options, in order of preference

1. **Give the fork agent the scope the preset stack requires** — a real core
   change in `tooling/dsh-core/agent`, and the only route that keeps the swap
   narrow (2 rows instead of 5).
2. **Widen the swap** to include the preset/persona generation. That approaches
   `@dshfiles/dsh-core-runtime`, whose patch disables five rows and drops the
   deployed workspace-resolution hook — the outcome this bundle exists to avoid.
3. **Upstream the `agent/request-messages` waterfall** so the published loop
   carries it and no swap is needed.

## Verification tooling

- `plugins/@dshfiles/optmem/scripts/drive.mjs` now takes `CORE=narrow`, which
  swaps the five-row bridge for this bundle and skips the core-package links, so
  full mode can be exercised end to end against a real provider.
- `scripts/probes/dsh-loader-probe-*.mjs` instrument the loader boundary. They
  are inert unless enabled explicitly:

  ```sh
  DSH_HOME=<scratch> NODE_OPTIONS="--import scripts/probes/dsh-loader-probe-register.mjs" dsh web --port 3199 --no-open
  ```

## Verified

- Composition: only `agent` and `agent-loop` disabled; `session`,
  `session-controller`, `session-persistence-jsonl` still enabled.
- Artifact: `agent/request-messages`, `forkFeatures` and
  `runtimeDriverEventSchema` are all present in `dist/index.js`.
- Scratch Host: boots clean with the two-row swap, 303 on the authenticated
  index, 401 bare.
- Blocked at: session creation (`Agent preset binding requires a scoped context`).
