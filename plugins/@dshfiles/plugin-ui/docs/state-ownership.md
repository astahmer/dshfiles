# Client state ownership

Use the narrowest state owner that matches the lifetime and source of the data:

| State                                     | Owner                         | Guidance                                                                                                                                                   |
| ----------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host or other async data                  | `@dshfiles/plugin-ui/query`   | Use queries and mutations; forward `AbortSignal`, scope keys by plugin, invalidate or update after writes. Prefer `refetchInterval` over component timers. |
| Multi-field validated form                | `@dshfiles/plugin-ui/form`    | Use `useAppForm` with Standard Schema validators. Keep drafts local only when they intentionally synchronize with another owner, such as an autosaver.     |
| Multi-step flow with three or more states | `@dshfiles/plugin-ui/machine` | Machine owns transition state; async data stays in Query. Use promise actors with cancellation.                                                            |
| Small persisted preference                | `createStoredValue`           | Validate persisted data and keep storage scoped to the owning plugin.                                                                                      |
| Ephemeral presentation state              | React state                   | Keep truly local UI state local; do not mirror Host state into component state without a specific synchronization rule.                                    |

## One owner per flow

An audit of every plugin's lifecycles (2026-11-05, 180 flows) found the same failures again and again, always from
one flow split across flags, refs and timers. The rules that keep a flow honest:

- **The smallest tool that makes the bad state unrepresentable.** Two or three states with no timers are one
  discriminated union in a single `useState` or ref. Three or more tangled states, timers, cancellation or child
  work are an xstate machine (`after` for timers, invoked actors for async, `fromCallback` for listeners). Host or
  async data is Query. On the Host side, check-then-act is `Ref.modify`/`SynchronizedRef.modifyEffect`, per-key
  work is `FiberMap`/`FiberSet`, a flag that must reset is `Effect.ensuring`, and a persisted record is a pure
  `transition(state, event)`.
- **A machine owns all of its flow.** When a component wraps a machine, its parallel flags, refs and effects move
  into the machine as context, states, events or invoked actors. A second source of truth beside a machine is the
  bug, not a detail.
- **Per-key state is per key.** Anything fed by events from several Sessions, accounts or paths keys its state by
  that id; one shared closure across Sessions is a cross-thread race.
- **Reproduce first.** A real defect gets a failing test that shows the bad combination, then the fix. A pure move
  gets the transition tests that cover the moved states.
- **No behavior change beyond the bug.** Preserve defaults, timings and copy; a refactor that changes UX is a
  decision to ask for, not a commit to slip in.
- **Leave is a valid outcome.** A flow that is contained, already explicit or has no reachable bad state is left
  with one line saying why.

## Established exceptions

- AI Accounts keeps its autosaved account draft in a machine (`account-editor-machine.ts`) that owns selection,
  draft and the clean/dirty/renaming phase and reuses `createAutoSaver` as its persistence child, rather than
  adding a second autosaver or a form store.
- Thread Sidebar restart and read-state actions use `useApiQuery` rather than the kit Query client. A regression
  test protects the sidebar from crashing when another plugin has removed the shared provider; the fan-out dialog
  uses a `PluginQueryProvider` scoped to the sidebar root.
- The Thread Sidebar attention store stays a page-wide single-flight store on `globalThis`: the sidebar and
  main-tabs inline their own module copies and must share one poll, which one Query client per plugin bundle
  cannot do.
- Jujutsu history is the Host-retained event window, not a paginated endpoint; mutations and the bounded history
  window are used instead of a fabricated infinite-query contract.
- Chat's image preview and file-open requests are unions, not mutations: `ChatView` renders from the vendored
  native package outside any Query provider.
- The user-questions native fork carries no `@dshfiles/plugin-ui` dependency, so its pending-question carrier is
  an explicit union with one transition function rather than an xstate machine.
- Prompt Stash keeps direct text editing because its save path owns storage conflict detection, while the shared
  form fields do not provide the required length/counter behavior.
- Optional library substitutions are adopted only when they preserve the caller's behavior and reduce real
  maintenance; an unchecked audit candidate is not a requirement to add a dependency.

These are behavior-based decisions, not a migration checklist. Revisit them when their owning contract changes. For
component APIs and styling constraints, see the [package guide](../README.md).
