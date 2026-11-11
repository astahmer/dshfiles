# @dshfiles/tool-subagent

Owned Host fork of DSH's `@deepseek-ai/dsh-tool-subagent` package, the model-facing `subagent`, `subagent_fork` and
`list_subagent_models` tools. Its only change: the allowed child model routes follow the Subagents model-selection
setting in running threads, instead of being frozen when the thread started (b:rmkm).

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness), `packages/subagent/tool-subagent`
- Package: `@deepseek-ai/dsh-tool-subagent@0.2.1-rc.2`
- Pinned revision: tag `dsh-v0.2.1-rc.2` (`687f282e8625c6b8d11ff58211a90524be2e4317`)
- License: MIT, see [LICENSE](LICENSE)

## Why a fork

Upstream reads `subagentModelSelection` once, when a fresh Session's delegation tool is composed, appends one
`subagent/model-selection-policy` event, and hands that captured route list to the tool. The policy projection keeps
the first event and ignores later ones, and children inherit the parent's recorded policy. Nothing re-reads the
setting, so a route added later fails with `child LLM route "<provider>/<model>" is not allowed for this Session` until
a new thread. The captured list and the projection both live inside this package, so no slot or settings plugin can
reach them.

## Local delta

| File                                  | Change                                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/native/model-selection-state.ts` | the projection keeps the latest `subagent/model-selection-policy` event; `followSubagentModelSelection` appends a replacement when the saved list differs |
| `src/native/index.ts`                 | the policy handed to the tools reads the setting on each use and follows it while enabled                                                                 |

Kept as upstream: a thread that started with selection off keeps a tool without `provider`/`model` fields, and turning
selection off mid-thread keeps the last recorded routes, because the tool schema is fixed when it is installed. The
projection key and `stateVersion` are unchanged, so existing Session checkpoints stay valid.

`src/live-model-selection.test.ts` mounts the real settings row behind the Loader, records a policy, edits the setting
and calls `list_subagent_models`; it fails on the upstream source.

## Wiring

The tools are children of the `preset-standard` `delegation` group, so this bundle's `cordis.patch.yml` inserts
nothing. `profiles/web/cordis.patch.yml` names `@dshfiles/tool-subagent` for the `tool-subagent` and
`tool-subagent-fork` children. Those rows sit outside the managed region: an existing profile keeps the native tool
until its own rows get the same `name` edit. The native `subagent-model-selection-settings` row stays: this fork reads
its `subagentModelSelection` service. The Host must restart for either change.

## Updating from DSH

```sh
node scripts/native-fork-diff.mjs tool-subagent --to <new-tag>
```

Copy the files listed under `copy`, reapply the two deltas above, update this pin and `native-fork.json`, then
type-check, test, build and boot-check in a scratch profile. Drop the fork when upstream follows the setting itself.
