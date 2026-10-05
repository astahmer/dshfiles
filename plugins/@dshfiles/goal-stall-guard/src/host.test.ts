import { describe, expect, it, vi } from 'vitest'

/**
 * End-to-end wiring check against the recorded livelock.
 *
 * `stall.test.ts` proves the detector decides correctly in isolation. This
 * proves the built plugin reads the real session-event shapes and reaches the
 * real goals service. The event sequence below is the shape taken from
 * session-dbe87c63's durable log, not a hand-written approximation: rounds
 * carrying `<goal_round>` prompts, `assistant/message` events whose
 * `message.content` is empty, and `turn/end` with `{ kind: 'completed' }`.
 */

const roundPrompt = (round: number): string => `<goal_round>\nObjective: "restyle the sidebar"\nRound: ${round}/256\n\nContinue working toward the objective.`

interface Harness {
  readonly pause: ReturnType<typeof vi.fn>
  readonly dispatch: (event: { type: string; data?: unknown }) => void
}

/**
 * The built bundle's `apply` is the exact entry cordis calls, with the row
 * config already unwrapped from schemastery's resolvers. Testing the definition
 * instead would route through `createPluginApi`, whose event surface a stub
 * context has to imitate; testing `apply` tests what actually runs.
 */
interface BuiltPlugin {
  readonly apply: (ctx: unknown, config?: unknown) => unknown
}

const builtEntry = new URL('../dist/index.js', import.meta.url).href

const loadPlugin = async (): Promise<BuiltPlugin> => import(builtEntry)

/**
 * `createBaseApi` binds cordis's whole event surface when it builds the plugin
 * api, so a stub context that only declares `on` throws before the plugin runs.
 */
const bindableContext = (listeners: Map<string, (session: unknown, event: unknown) => void>): Record<string, unknown> => {
  const on = (event: string, handler: (session: unknown, event: unknown) => void): void => {
    listeners.set(event, handler)
  }
  // `get` is what dshx's optional inspect bridge probes; without it the bridge
  // logs a warning on every activation even though the plugin needs no service.
  return { on, once: on, emit: on, parallel: on, serial: on, bail: on, waterfall: on, effect: () => {}, get: () => undefined }
}

const startHarness = (plugin: BuiltPlugin, config: Record<string, unknown> = {}): Harness => {
  const pause = vi.fn()
  const agent = { id: 'agent-1', session: { id: 'session-1' } }
  const goal = { id: 'goal-1', revision: 4, phase: 'active' as const }
  const listeners = new Map<string, (session: unknown, event: unknown) => void>()

  const ctx = {
    ...bindableContext(listeners),
    agents: { get: vi.fn(() => agent) },
    goals: { get: vi.fn(() => goal), pause },
    logger: { warn: vi.fn() },
  }

  plugin.apply(ctx, config)
  const dispatch = (event: { type: string; data?: unknown }): void => {
    const handler = listeners.get('session/event')
    if (handler === undefined) throw new Error('plugin registered no session/event listener')
    handler(agent.session, event)
  }
  return { pause, dispatch }
}

describe('goal-stall-guard wiring', () => {
  it('pauses the goal on the third consecutive empty round', async () => {
    const plugin = await loadPlugin()
    const { pause, dispatch } = startHarness(plugin)

    for (const round of [1, 2, 3]) {
      dispatch({ type: 'turn/start', data: { turn: round } })
      dispatch({ type: 'user/message', data: { content: [{ type: 'text', text: roundPrompt(round) }] } })
      dispatch({ type: 'step/start', data: { turn: round, step: 1 } })
      dispatch({ type: 'assistant/message', data: { message: { content: [] } } })
      dispatch({ type: 'turn/end', data: { turn: round, reason: { kind: 'completed' } } })
    }

    expect(pause).toHaveBeenCalledTimes(1)
    expect(pause).toHaveBeenCalledWith(expect.objectContaining({ session: expect.anything() }), { id: 'goal-1', revision: 4 })
  })

  it('the control: two empty rounds are not enough', async () => {
    const plugin = await loadPlugin()
    const { pause, dispatch } = startHarness(plugin)

    for (const round of [1, 2]) {
      dispatch({ type: 'turn/start', data: { turn: round } })
      dispatch({ type: 'user/message', data: { content: [{ type: 'text', text: roundPrompt(round) }] } })
      dispatch({ type: 'step/start', data: { turn: round, step: 1 } })
      dispatch({ type: 'assistant/message', data: { message: { content: [] } } })
      dispatch({ type: 'turn/end', data: { turn: round, reason: { kind: 'completed' } } })
    }

    expect(pause).not.toHaveBeenCalled()
  })

  it('the control: a round that spoke never pauses the goal', async () => {
    const plugin = await loadPlugin()
    const { pause, dispatch } = startHarness(plugin)

    for (let round = 1; round <= 8; round += 1) {
      dispatch({ type: 'turn/start', data: { turn: round } })
      dispatch({ type: 'user/message', data: { content: [{ type: 'text', text: roundPrompt(round) }] } })
      dispatch({ type: 'step/start', data: { turn: round, step: 1 } })
      dispatch({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'progress' }] } } })
      dispatch({ type: 'turn/end', data: { turn: round, reason: { kind: 'completed' } } })
    }

    expect(pause).not.toHaveBeenCalled()
  })

  it('the control: empty turns that are not goal rounds never pause the goal', async () => {
    const plugin = await loadPlugin()
    const { pause, dispatch } = startHarness(plugin)

    for (let turn = 1; turn <= 10; turn += 1) {
      dispatch({ type: 'turn/start', data: { turn } })
      dispatch({ type: 'user/message', data: { content: [{ type: 'text', text: 'a human typed something' }] } })
      dispatch({ type: 'step/start', data: { turn, step: 1 } })
      dispatch({ type: 'assistant/message', data: { message: { content: [] } } })
      dispatch({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
    }

    expect(pause).not.toHaveBeenCalled()
  })

  it('a tool-only round counts as progress', async () => {
    const plugin = await loadPlugin()
    const { pause, dispatch } = startHarness(plugin)

    for (let round = 1; round <= 6; round += 1) {
      dispatch({ type: 'turn/start', data: { turn: round } })
      dispatch({ type: 'user/message', data: { content: [{ type: 'text', text: roundPrompt(round) }] } })
      dispatch({ type: 'step/start', data: { turn: round, step: 1 } })
      dispatch({ type: 'assistant/message', data: { message: { content: [{ type: 'tool-call', name: 'bash' }] } } })
      dispatch({ type: 'turn/end', data: { turn: round, reason: { kind: 'completed' } } })
    }

    expect(pause).not.toHaveBeenCalled()
  })

  it('honours a configured threshold of two', async () => {
    const plugin = await loadPlugin()
    const { pause, dispatch } = startHarness(plugin, { stallThreshold: 2 })

    for (const round of [1, 2]) {
      dispatch({ type: 'turn/start', data: { turn: round } })
      dispatch({ type: 'user/message', data: { content: [{ type: 'text', text: roundPrompt(round) }] } })
      dispatch({ type: 'step/start', data: { turn: round, step: 1 } })
      dispatch({ type: 'assistant/message', data: { message: { content: [] } } })
      dispatch({ type: 'turn/end', data: { turn: round, reason: { kind: 'completed' } } })
    }

    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('ignores an agent with no goal', async () => {
    const plugin = await loadPlugin()
    const pause = vi.fn()
    const agent = { id: 'agent-1', session: { id: 'session-1' } }
    const listeners = new Map<string, (session: unknown, event: unknown) => void>()
    const ctx = {
      ...bindableContext(listeners),
      agents: { get: () => agent },
      goals: { get: () => undefined, pause },
      logger: { warn: vi.fn() },
    }
    plugin.apply(ctx, {})

    for (const round of [1, 2, 3]) {
      listeners.get('session/event')?.(agent.session, { type: 'turn/start', data: { turn: round } })
      listeners.get('session/event')?.(agent.session, { type: 'user/message', data: { content: [{ type: 'text', text: roundPrompt(round) }] } })
      listeners.get('session/event')?.(agent.session, { type: 'step/start', data: { turn: round, step: 1 } })
      listeners.get('session/event')?.(agent.session, { type: 'assistant/message', data: { message: { content: [] } } })
      listeners.get('session/event')?.(agent.session, { type: 'turn/end', data: { turn: round, reason: { kind: 'completed' } } })
    }

    expect(pause).not.toHaveBeenCalled()
  })

  it('does not pause a goal that is not active', async () => {
    const plugin = await loadPlugin()
    const pause = vi.fn()
    const agent = { id: 'agent-1', session: { id: 'session-1' } }
    const listeners = new Map<string, (session: unknown, event: unknown) => void>()
    const ctx = {
      ...bindableContext(listeners),
      agents: { get: () => agent },
      goals: { get: () => ({ id: 'goal-1', revision: 4, phase: 'paused' }), pause },
      logger: { warn: vi.fn() },
    }
    plugin.apply(ctx, {})

    for (const round of [1, 2, 3, 4]) {
      listeners.get('session/event')?.(agent.session, { type: 'turn/start', data: { turn: round } })
      listeners.get('session/event')?.(agent.session, { type: 'user/message', data: { content: [{ type: 'text', text: roundPrompt(round) }] } })
      listeners.get('session/event')?.(agent.session, { type: 'step/start', data: { turn: round, step: 1 } })
      listeners.get('session/event')?.(agent.session, { type: 'assistant/message', data: { message: { content: [] } } })
      listeners.get('session/event')?.(agent.session, { type: 'turn/end', data: { turn: round, reason: { kind: 'completed' } } })
    }

    expect(pause).not.toHaveBeenCalled()
  })

  it('a pause rejection is logged, not thrown at the session loop', async () => {
    const plugin = await loadPlugin()
    const agent = { id: 'agent-1', session: { id: 'session-1' } }
    const warn = vi.fn()
    const listeners = new Map<string, (session: unknown, event: unknown) => void>()
    const ctx = {
      ...bindableContext(listeners),
      agents: { get: () => agent },
      goals: {
        get: () => ({ id: 'goal-1', revision: 4, phase: 'active' }),
        pause: () => {
          throw new Error('GOAL_INVALID_TRANSITION')
        },
      },
      logger: { warn },
    }
    plugin.apply(ctx, {})

    for (const round of [1, 2, 3]) {
      listeners.get('session/event')?.(agent.session, { type: 'turn/start', data: { turn: round } })
      listeners.get('session/event')?.(agent.session, { type: 'user/message', data: { content: [{ type: 'text', text: roundPrompt(round) }] } })
      listeners.get('session/event')?.(agent.session, { type: 'step/start', data: { turn: round, step: 1 } })
      listeners.get('session/event')?.(agent.session, { type: 'assistant/message', data: { message: { content: [] } } })
      listeners.get('session/event')?.(agent.session, { type: 'turn/end', data: { turn: round, reason: { kind: 'completed' } } })
    }

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not pause stalled goal'), 'goal-1', expect.anything())
  })
})
