# @dshfiles/goal-tool

Owned Host fork of DSH's `@deepseek-ai/dsh-tool-goal` package. It replaces the native `tool-goal` Loader row while preserving the upstream goal tools, policy, and compare-and-set behavior.

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness), `packages/goal/tool-goal`
- Pinned revision: tag `dsh-v0.2.1-rc.2` (`687f282e8625c6b8d11ff58211a90524be2e4317`)
- License: MIT, see [LICENSE](LICENSE)

## Local delta

`src/native/authority.ts` validates the continued-form reply source and matches it against the native settled-question projection. `src/native/index.ts` updates the model-facing policy to describe the accepted answered-human-turn rule. On a root agent's current open turn, a continued form reply grants the same direct-human authority as a text message only when:

1. its source parses as `user-question-reply` with `outcome: "answered"`;
2. the native `userQuestions` projection settled the same call id with a non-empty, validated answer batch.

This leaves skipped, failed, stale/unknown, or merely queued replies unauthorized. The upstream live-agent, driver, open-turn, root-agent, compare-and-set, goal-round, and blocked-threshold checks remain unchanged. If the `userQuestions` projection is unavailable, the gate fails closed.

Activation is **opt-in**: the checked-in web profile keeps the stock goal tools. To select this replacement in a profile you own, add a local `link:` dependency and include `@dshfiles/goal-tool` in that profile's `dsh.profile.bundles`, then install its dependencies. The `cordis.patch.yml` disables the native row and inserts this package only when the bundle is selected. Applying it requires a user-controlled Host restart; building this repository does not activate it.

## Updating from DSH

```sh
node scripts/native-fork-diff.mjs goal-tool --to <new-tag>
```

Copy files listed under `copy`, reapply the authority delta to files under `reapplyDelta`, update this pin and `native-fork.json`, then type-check, test, build, import-check, and boot-check in a scratch profile.
