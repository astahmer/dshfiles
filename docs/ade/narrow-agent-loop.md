# Narrow agent-loop bundle — status

The smallest merge that can enable OptMem full mode without giving up jj
workspace provisioning: replace the **agent loop row only**, keep the native
session store, JSONL persistence and the session controller that provisions a
workspace per coding thread.

`plugins/@dshfiles/dsh-core-agent-loop` is that bundle. Its patch disables one
row and inserts one row:

```yaml
- id: agent-loop
  name: '@deepseek-ai/dsh-agent-loop'
  disabled: true
- insert:
    - id: dshfiles-core-agent-loop
      name: '@dshfiles/dsh-core-agent-loop'
```

The row id is package-scoped so it cannot replace an unrelated row; the service
name `agentLoop` is unchanged, so every dependant still injects the same
service. `tests/patch-scope.test.mjs` asserts that the patch disables
`agent-loop` and nothing else, and never touches `session`, `session-controller`
or `session-persistence-jsonl`.

## Verified

- **Composition is correct.** `dsh --profile web --dump-config` against a scratch
  home shows `agent-loop` with `disabled: true`, the inserted
  `dshfiles-core-agent-loop` row, and `session`, `session-controller`,
  `session-persistence-jsonl` all still present and **enabled**.
- **The fork is really in the artifact.** `dist/index.js` contains
  `agent/request-messages` (3) and `forkFeatures` (2) — the published package
  contains neither.
- **The row wiring is correct.** A variant whose entry imports nothing evaluates,
  runs `setup`, and activates with no warning — confirmed by module-level and
  setup-level `console.error` markers, which both print.

## Blocker — the module is never evaluated

With the fork bundled, the scratch Host reports:

```
dsh: warning: 1 entry did not activate
dshfiles-core-agent-loop (@dshfiles/dsh-core-agent-loop): failed to import
```

The same markers that print for the working variant **never print** for the fork
bundle. So DSH's importer fails **before module evaluation**, and:

- the loader's own catch — `_init`'s `this.ctx.logger.error(error)` — never
  fires (patched via an ESM loader hook to also `console.error`, confirmed
  applied three times; nothing printed);
- `unhandledRejection` and `uncaughtException` never fire;
- the cordis logger only buffers (its default exporter pushes into a 1000-entry
  array), so the real message is not on stdout anywhere.

`failed to import` in `dsh-app-boot` is emitted when `entry.fiber === undefined`,
which is a symptom of that earlier failure, not the cause.

## What is ruled out

| hypothesis                       | evidence                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| plugin registration              | a variant that statically imports the fork and never calls `ctx.plugin` fails identically                                                               |
| plain module loading             | the same `dist/index.js` imports under Node from the workspace **and** from the profile directory                                                       |
| duplicate cordis / core identity | relinked all six external packages to the **native agent-loop's own `.pnpm` virtual store instances** — same modules the Host uses — and it still fails |
| a missing export or config       | the row is listed, the patch is correct, and the no-op variant with the same package.json activates                                                     |

## Next step

Determine what DSH's importer does **before** evaluating a profile bundle, and
why it silently declines one whose `dist` carries vendored core code. The
candidate is a pre-bundle/transform step: `dsh-app-boot` reaches Node's internal
ESM loader through `node-addon-require-builtin`, and inlining the remaining
`@deepseek-ai/*` imports (approach 3) changes exactly that graph. Inlining is
viable — `@dshfiles/dsh-core-runtime` already does it — but it pulls a cascade of
transitive peers that must be declared to satisfy `DSHX4005`
(`cosmokit`, `dsh-sandbox`, `dsh-timeout`, `dsh-typert-protocol`,
`dsh-util-crypto` were the next tier after `dsh-agent`, `dsh-session`,
`dsh-llm`, `dsh-tools`, `schemastery`).

`scripts/probes/dsh-loader-probe-*.mjs` are the loader-hook probes used above:
they patch the cordis loader to surface its swallowed import error and install
global rejection handlers.

Run them with:

```sh
DSH_HOME=<scratch> NODE_OPTIONS="--import scripts/probes/dsh-loader-probe-register.mjs" dsh web --port 3199 --no-open
```
