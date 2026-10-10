# Client state ownership

Use the narrowest state owner that matches the lifetime and source of the data:

| State | Owner | Guidance |
|---|---|---|
| Host or other async data | `@dshfiles/plugin-ui/query` | Use queries and mutations; forward `AbortSignal`, scope keys by plugin, invalidate or update after writes. Prefer `refetchInterval` over component timers. |
| Multi-field validated form | `@dshfiles/plugin-ui/form` | Use `useAppForm` with Standard Schema validators. Keep drafts local only when they intentionally synchronize with another owner, such as an autosaver. |
| Multi-step flow with three or more states | `@dshfiles/plugin-ui/machine` | Machine owns transition state; async data stays in Query. Use promise actors with cancellation. |
| Small persisted preference | `createStoredValue` | Validate persisted data and keep storage scoped to the owning plugin. |
| Ephemeral presentation state | React state | Keep truly local UI state local; do not mirror Host state into component state without a specific synchronization rule. |

## Established exceptions

- AI Accounts keeps its autosaved account draft in local state because selection changes resynchronize it and rename commits on blur; a second form store would duplicate the autosaver's source of truth.
- Thread Sidebar restart and read-state actions use `useApiQuery` rather than the kit Query client. A regression test protects the sidebar from crashing when another plugin has removed the shared provider.
- Jujutsu history is the Host-retained event window, not a paginated endpoint; mutations and the bounded history window are used instead of a fabricated infinite-query contract.
- Prompt Stash keeps direct text editing because its save path owns storage conflict detection, while the shared form fields do not provide the required length/counter behavior.
- Optional library substitutions are adopted only when they preserve the caller's behavior and reduce real maintenance; an unchecked audit candidate is not a requirement to add a dependency.

These are behavior-based decisions, not a migration checklist. Revisit them when their owning contract changes. For component APIs and styling constraints, see the [package guide](../README.md).
