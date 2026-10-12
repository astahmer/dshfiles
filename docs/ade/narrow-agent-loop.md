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
- **The row wiring is correct.** A variant whose entry imports nothing activates
  cleanly in the scratch Host, with no `did not activate` warning. So bundle
  resolution, the patch, and the profile composition all work.

## Blocker — the bundled fork fails to load under DSH's importer

With the fork bundled, the scratch Host reports:

```
dsh: warning: 1 entry did not activate
dshfiles-core-agent-loop (@dshfiles/dsh-core-agent-loop): failed to import
```

`failed to import` is emitted when `entry.fiber === undefined`, which is
**before** `setup` runs. A variant that statically imports the fork agent-loop
and never calls `ctx.plugin` fails identically, and a version that wrapped
activation in `try/catch` with `ctx.logger.error` printed nothing — so the
failure is at module load, not at registration.

The same `dist/index.js` imports successfully under plain Node, both from the
workspace and from the profile directory (`import('@dshfiles/dsh-core-agent-loop')`
→ `OK`). The difference is DSH's own importer.

What the bundle still imports externally after inlining the fork's own
dependencies (`dsh-brand`, `dsh-scope`, `dsh-session-persistence`,
`dsh-system-prompt`, `dsh-util-values` — without these it also fails, and they
are unresolvable from a profile):

```
@deepseek-ai/cordis, @deepseek-ai/dsh-agent, @deepseek-ai/dsh-llm,
@deepseek-ai/dsh-session, @deepseek-ai/dsh-tools, @deepseek-ai/schemastery
```

Those must stay **shared** with the Host for service identity, but they are not
resolvable from the profile anchor (`require.resolve` from the profile directory
fails for all but `schemastery`), and pointing them at the global installation
did not change the outcome. Adding them to `bundleDependencies` to inline them
is refused by dshx with `DSHX4005`.

## Next step

Determine the contract DSH's importer has for a profile bundle that carries core
code: either the exact anchor it resolves bare `@deepseek-ai/*` specifiers from,
or the supported way to satisfy `DSHX4005` for them. `@dshfiles/dsh-core-runtime`
sidesteps this by inlining the whole core chain and disabling the native rows —
which is exactly the trade this bundle exists to avoid.
