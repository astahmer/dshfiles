# xstate visualization

Owned plugins use xstate v5 for tangled client flows (35 `createMachine` calls under `plugins/@dshfiles/*/src` on
2026-11-04: ai-accounts, command-palette, editor, jj-integration, jujutsu, thread-sidebar, …). A static machine →
Mermaid generator ships in this plugin. Live inspection is deliberately not built: it is a debugging technique you
wire up for one session, never a feature.

## Options compared

| Option                                                    | Static diagram   | Live state | Runs offline | Data leaves the machine              | Cost here                                                             | Verdict                            |
| --------------------------------------------------------- | ---------------- | ---------- | ------------ | ------------------------------------ | --------------------------------------------------------------------- | ---------------------------------- |
| `@statelyai/inspect` 0.7.2 (MIT) `createBrowserInspector` | yes (Stately UI) | yes        | no           | every event + snapshot to stately.ai | popup window to stately.ai; per-actor `inspect` option in each plugin | dev-only, opt-in, never shipped    |
| `@statelyai/inspect` `createWebSocketInspector`           | yes              | yes        | partly       | to a local WebSocket viewer          | needs `ws`/`partysocket` in the client and a viewer process           | not worth it yet                   |
| Stately Studio / visualizer (stately.ai/editor)           | yes              | no         | no           | pasted machine source                | manual copy-paste, account for saving                                 | fine ad hoc, not a feature         |
| `@xstate/inspect` 0.8                                     | —                | —          | —            | —                                    | xstate v4 only                                                        | not applicable                     |
| `@xstate/graph` 3.0.4 (MIT)                               | paths/adjacency  | no         | yes          | none                                 | data only, still needs a renderer                                     | useful for test paths, not drawing |
| elkjs 0.12 (EPL-2.0 / GPL-3.0)                            | layout only      | no         | yes          | none                                 | 8 MB package, licence review, we would write the drawing ourselves    | no                                 |
| **Machine → Mermaid (built)**                             | yes              | no         | yes          | none                                 | ~200 lines, no dependency, reads `machine.root`                       | **shipped**                        |

## What ships

- `@dshfiles/whiteboard/xstate-diagram` — `machineToMermaid(machine, 'flowchart' | 'state')`. It walks the live v5
  state-node tree (`states`, `initial`, `transitions`, `always`, `invoke`) structurally, without importing xstate:
  nested states become subgraphs / composite states, parallel children become concurrent regions, `after` delays
  read `after 800ms`, invoke done/error events read `done: <src>`, guards read `EVENT [guard]`, and a root-level `on`
  starts from an explicit "any state" node. Targetless (action-only) transitions are left out.
- `pnpm --dir plugins/@dshfiles/whiteboard run machine-diagram -- <module.ts> [--format state] [--export name]`
  prints every machine a module exports (Vite's module runner loads the TypeScript source, so the machine's own
  imports resolve as in its plugin).
- **Export to a whiteboard:** pass the `flowchart` output to `whiteboard_write({ project, title, mermaid })`;
  mermaid-to-excalidraw turns flowcharts into editable shapes when the board opens. A `stateDiagram-v2` would only be
  pasted as an image, which is why `flowchart` is the default.
- `stateDiagram-v2` output renders on GitHub, so a plugin README can embed its machine (the whiteboard README does).

## Live inspection, when a flow misbehaves

Wire `@statelyai/inspect` behind an explicit dev switch rather than shipping it:
`createActor(machine, { inspect: createBrowserInspector({ autoStart: false }).inspect })` only when
`localStorage['dshfiles:xstate-inspect'] === '1'`, with the dependency in the plugin under investigation and removed
afterwards. Do not make it default: it opens a stately.ai window and sends every event and context snapshot there
(context often holds paths, prompts or thread ids).

A local live view (current state highlighted on the generated diagram) would need each machine's actor to publish its
snapshot to one registry; that is a cross-plugin contract (`defineRegistry` in plugin-ui) and only worth it if
repeated debugging sessions ask for it.
