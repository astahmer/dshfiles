# @dshfiles/tool-subagent

Owned Host fork of DSH's `@deepseek-ai/dsh-tool-subagent` package, the model-facing `subagent`, `subagent_fork` and
`list_subagent_models` tools. Two changes: the allowed child model routes follow the Subagents model-selection
setting in running threads, instead of being frozen when the thread started (b:rmkm); and `subagent` takes an `agent`
argument that starts the child as a configured agent ([below](#the-agent-argument)).

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
| `src/native/index.ts`                 | the delegation and `list_subagent_models` tools read the policy through that following reader; a fresh-child tool declares `agent` and starts the child as the resolved agent (route, preset, preamble, reserved `childId` recorded before the start)                              |
| `src/native/list-models.ts`           | with no arguments, appends the agents the caller may start (`agent-selection.ts`)                                                                                                                                                                                                |
| `src/native/agent-selection.ts`       | added: the `agent` argument's description, validation, route/prompt merge and listing text                                                                                                                                                                                       |
| `src/agent-resolver.ts`               | added, outside the vendored tree: the `@dshfiles/tool-subagent/agent-resolver` contract                                                                                                                                                                                         |

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

## The agent argument

`subagent` (any tool instance whose backend does not inherit the conversation) declares one optional string
parameter, always, with a constant description:

```ts
agent: { type: 'string', description: AGENT_PARAMETER_DESCRIPTION } // a handle, with or without @
```

Which agent that is comes from the `@dshfiles/tool-subagent/agent-resolver` contract, a dshx module this package owns
and `@dshfiles/agents` provides as the `dshfilesSubagentAgents` Cordis service. The dependency points one way (agents
→ tool-subagent); `pnpm check:cycles` holds.

- **Schema stability.** The parameter stays in the schema without a provider, and the handles are not enumerated, so
  the tool declaration never changes within a Session (prompt cache) whatever the load order, HMR or agent edits.
  Without a provider, `agent` is refused with "enable @dshfiles/agents"; omitting it keeps upstream behavior.
- **Resolution.** The provider answers `inherit` (no `agent`, no default: upstream behavior, the child inherits its
  parent's agent), a refusal message (unknown, disabled or not in the calling agent's `subagents.allowed`), or the
  agent: route, preset, a preamble and `record(childSessionId)`.
- **Before the first request.** The tool mints the child's Session id, awaits `record`, then calls
  `startActivation({ childId })`. tool-search reads the recorded agent when the child attaches, so the child's first
  request already has that agent's tools. An out-of-Host backend (no `prepareContinuable`) cannot take a reserved id
  and is refused.
- **Route precedence.** Explicit `provider`/`model` in the call > the agent's route > the instance's `agentOptions` >
  the parent's route. Explicit fields stay under the Session's model-selection policy. The agent's route is admitted
  without it, because the user configured it on the agent, as a dispatch applies it with `selectModel`; it is still
  resolved through the live LLM runtime first, and its omitted effort uses the model's default.
- **Preset precedence.** Explicit `agent_preset` > the agent's preset > the instance's `agentPreset` > the parent's.
- **Prompt.** The preamble (at most 4,000 characters) goes before the task, separated by `---`; the task is never
  clipped.
- **`subagent_fork` takes no `agent`.** A fork continues this conversation, which was built under the parent agent's
  instructions and tools; another agent's tools would drop tools its transcript already called and break the shared
  prompt prefix. Its schema has no `agent`, a stray `agent` is refused, and the resolver (and any default) is not
  consulted: a fork keeps the parent's agent through the agents plugin's inheritance.
- **Discovery.** `list_subagent_models` without arguments appends the agents the caller may start, marking the default
  and the caller's own agent, and how to change the rule.

`src/agent-selection.test.ts` mounts the real tool on the real tool, LLM and subagent runtimes with a fake backend
and resolver: schema, explicit agent, record-before-start, default agent, inherit, refusal, no provider, precedence,
fork and listing.

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

Copy the files listed under `copy`, reapply the deltas above, update this pin and `native-fork.json`, then
type-check, test, build and boot-check in a scratch profile. Drop the fork when upstream follows the setting itself.
