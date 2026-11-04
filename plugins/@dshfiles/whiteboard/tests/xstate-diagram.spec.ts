import { setup } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { boardSyncMachine } from '../src/board-sync-machine.js'
import { machineToMermaid } from '../src/xstate-diagram.js'

type PlayerEvent = { readonly type: 'GO' } | { readonly type: 'STOP' } | { readonly type: 'TICK' }

const nested = setup({
  // SAFETY: xstate reads `types` only for inference; the empty object is never inspected at runtime.
  types: { events: {} as PlayerEvent },
  guards: { ready: () => true },
  actors: {},
}).createMachine({
  id: 'player',
  initial: 'idle',
  states: {
    idle: { on: { GO: { target: 'running', guard: 'ready' } } },
    running: {
      initial: 'slow',
      states: { slow: { on: { TICK: 'fast' } }, fast: { after: { 500: 'slow' } } },
      on: { STOP: 'done' },
    },
    both: { type: 'parallel', states: { left: { initial: 'a', states: { a: {} } }, right: { initial: 'b', states: { b: {} } } } },
    done: { type: 'final' },
  },
})

describe('xstate machine to Mermaid', () => {
  it('draws states, nested states, guards, delays and the initial marker as a flowchart', () => {
    const text = machineToMermaid(nested)
    expect(text.startsWith('flowchart TD\n')).toBe(true)
    expect(text).toContain('subgraph s_player_running["running"]')
    expect(text).toContain('s_player_done(["done"])')
    expect(text).toContain('s_player_idle -->|"GO [ready]"| s_player_running')
    expect(text).toContain('s_player_running_fast -->|"after 500ms"| s_player_running_slow')
    expect(text).toContain('s_player_running -->|"STOP"| s_player_done')
    expect(text).toContain('s_player_initial --> s_player_idle')
    expect(text).toContain('subgraph s_player_both["both (parallel)"]')
  })

  it('writes a stateDiagram-v2 with concurrent regions and final states', () => {
    const text = machineToMermaid(nested, 'state')
    expect(text.startsWith('stateDiagram-v2\n')).toBe(true)
    expect(text).toContain('[*] --> s_player_idle')
    expect(text).toContain('s_player_done --> [*]')
    expect(text).toContain('state s_player_both {')
    expect(text).toMatch(/s_player_both_left[\s\S]*--[\s\S]*s_player_both_right/u)
    expect(text).toContain('s_player_idle --> s_player_running : GO [ready]')
  })

  it('names invoked actors and their done/error transitions, as in the board autosave machine', () => {
    const text = machineToMermaid(boardSyncMachine)
    expect(text).toContain('s_boardSync_saving["saving<br/>invoke: save"]')
    expect(text).toContain('s_boardSync_dirty -->|"after 800ms"| s_boardSync_saving')
    expect(text).toContain('s_boardSync_saving -->|"done: save [editedWhileSaving]"| s_boardSync_dirty')
    expect(text).toContain('s_boardSync_saving -->|"error: save [isConflict]"| s_boardSync_conflict')
    // A root-level `on` applies in every state, so it starts from an explicit pseudo-state.
    expect(text).toContain('s_boardSync{{"any state"}}')
    expect(text).toContain('s_boardSync -->|"SYNCED"| s_boardSync_clean')
  })
})
