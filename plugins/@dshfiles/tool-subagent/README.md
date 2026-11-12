# @dshfiles/tool-subagent

Owned Host fork of DSH's `@deepseek-ai/dsh-tool-subagent` package, the model-facing `subagent`, `subagent_fork` and
`list_subagent_models` tools. Its only change: the allowed child model routes follow the Subagents model-selection
setting in running threads, instead of being frozen when the thread started (b:rmkm).

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness), `packages/subagent/tool-subagent`
- Package: `@deepseek-ai/dsh-tool-subagent@0.2.2-rc.2`
- Pinned revision: tag `dsh-v0.2.2-rc.2` (`ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`)
- License: MIT, see [LICENSE](LICENSE)

## Why a fork

Upstream's `subagent-model-selection-settings` row samples `subagentModelSelection` once, when a fresh Session's Agent
is created, and appends one `subagent/model-selection-policy` event; children inherit the parent's recorded policy.
The delegation tools read that policy through the shared `subagentModelSelectionPolicy` projection, which keeps the
first event and ignores later ones. Nothing re-reads the setting, so a route added later fails with
`child LLM route "<provider>/<model>" is not allowed for this Session` until a new thread. The policy reader lives
inside this package, so no slot or settings plugin can reach it.

## Local delta

| File                                  | Change                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/native/model-selection-state.ts` | adds `dshfilesSubagentModelSelectionPolicy`, a Host-only projection over the same events that keeps the latest one, and `followingSubagentModelSelection`, a policy reader that appends a replacement event when the enabled setting's route list differs from the recorded one |
| `src/native/index.ts`                 | the delegation and `list_subagent_models` tools read the policy through that following reader                                                                                                                                                                                   |

The fork folds under its own key because the native settings row registers the shared `subagentModelSelectionPolicy`
unit first, and the projection registry shares the first definition of a key, so a changed fold on the shared key
would never run. The shared definition stays byte-for-byte upstream's.

Kept as upstream: a Session that recorded no policy (selection was off when it started) stays restricted to its
parent route, and turning selection off mid-thread keeps the last recorded routes. A child Session inherits the
parent's first recorded policy from the native row, then follows the setting like any other Session while it is
enabled. The settings service keeps its reader private; the fork calls it by name and looks the service up on each
read, because a settings edit can replace the service instance.

`src/live-model-selection.test.ts` mounts the real settings row behind the Loader, records a policy, edits the setting
and reads the policy through the following reader; it cannot pass on the upstream source, which has no such reader.

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
