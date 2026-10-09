# Narrow DSH core fork

The agent package is copied from DeepSeek Harness tag `dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84`, https://github.com/deepseek-ai/deepseek-harness. Original MIT license is retained. No upstream remote or nested VCS boundary.

This source fork earns its scope from software roadmap Phase 1A: named runtime drivers must coexist behind the native AgentRegistry lifecycle while preserving the standard factory. Its native package name is retained so all runtime consumers share one identity. It is private, never published by this repository.

Build only this TypeScript package; existing official runtime dependencies remain binary/published packages. Scratch profile overrides must bind every native agent dependency to this package. Never patch the user's installed global package or running web profile.

Commands: `pnpm --dir tooling/dsh-core/agent install`, then `build`, `test`, and `typecheck`. Runtime acceptance must explicitly test the override; source checks are not activation proof.

## dshfiles additions

- `agent/request-messages` waterfall (agent `runtime-types.ts`, called in agent-loop `buildRequest` after the
  frozen surface is derived): payload `{ agent, turn, step, isFirstStepOfTurn, messages, toolHistory, signal }`,
  `next()` yields the derived messages. Returning a list that differs (length or element identity) sends it
  instead, deep-frozen, and appends one log-only `request/messages-override { turn, step, originalCount,
  sentCount }` session event; the session surface is never rewritten. Abort is checked after the waterfall.
  Used by OptMem full mode (`plans/optmem`). Tests: `agent-loop/tests/request-messages.spec.ts`.
- `AgentLoop.forkFeatures` (`ReadonlySet`, contains `agent/request-messages`) lets plugins detect the hook at runtime.
- `request/messages-override` is added to the session `SessionEventMap` and to `known-event-types.ts` by hand (the
  upstream generator script is not part of this fork). Stock DSH builds do not know this type, so a log written
  with an override is readable only by this fork.
- Baseline: 6 agent-loop spec files fail to import upstream-only test deps (fast-check, agent-loop-testkit,
  ptc-runtime, pi-ai sources, settings tests); unrelated to these additions.
