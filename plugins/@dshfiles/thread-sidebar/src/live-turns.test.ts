import { Effect, Layer, PubSub } from 'effect'
import { describe, expect, it } from 'vitest'
import { InflightTurns } from './inflight-turns.js'
import { LiveTurns, LiveTurnsModel, type LiveTurnsState } from './live-turns.js'
import { SessionEvents, type SessionEvent } from './session-events.js'

/** The durable markers a reload keeps: one turn the fold never saw start. */
const markers = Layer.succeed(
  InflightTurns,
  InflightTurns.of({
    list: Effect.succeed([{ sessionId: 'before-reload', startedAt: 2 }]),
    start: () => Effect.void,
    end: () => Effect.succeed(true),
    promote: Effect.succeed([]),
  }),
)

const event = (sessionId: string, type: string, time: number, data?: unknown): SessionEvent =>
  ({ sessionId, event: { type, seq: time, time, ...(data === undefined ? {} : { data }) } }) as SessionEvent

const fold = (events: readonly SessionEvent[]): LiveTurnsState => events.reduce(LiveTurnsModel.apply, new Map())

describe('live turns', () => {
  it('records a turn from its start and says its current step in words', () => {
    const state = fold([
      event('a', 'turn/start', 1_000),
      event('a', 'tool/call', 1_100, { name: 'bash', arguments: JSON.stringify({ command: 'pnpm test\necho done' }) }),
    ])
    expect(LiveTurnsModel.snapshot(state)).toEqual([{ sessionId: 'a', startedAt: 1_000, step: 'Running pnpm test' }])
  })

  it('counts the files a turn edits and thinks between calls', () => {
    const edit = (path: string, time: number) => event('a', 'tool/call', time, { name: 'mcp__dsh__edit', arguments: JSON.stringify({ file_path: path }) })
    const once = fold([event('a', 'turn/start', 1), edit('/repo/src/client.tsx', 2)])
    expect(LiveTurnsModel.snapshot(once)[0]?.step).toBe('Editing client.tsx')
    const thrice = fold([event('a', 'turn/start', 1), edit('/a.ts', 2), event('a', 'tool/result', 3, {}), edit('/b.ts', 4), edit('/a.ts', 5), edit('/c.ts', 6)])
    expect(LiveTurnsModel.snapshot(thrice)[0]?.step).toBe('Editing 3 files')
    const thinking = fold([event('a', 'turn/start', 1), edit('/a.ts', 2), event('a', 'tool/result', 3, {})])
    expect(LiveTurnsModel.snapshot(thinking)[0]?.step).toBe('Thinking')
  })

  it('drops a turn at its end and ignores events of a turn it never saw start', () => {
    const state = fold([event('a', 'turn/start', 1), event('b', 'tool/call', 2, { name: 'bash', arguments: '{}' }), event('a', 'turn/end', 3)])
    expect(LiveTurnsModel.snapshot(state)).toEqual([])
    const untouched = new Map()
    expect(LiveTurnsModel.apply(untouched, event('a', 'message/delta', 1))).toBe(untouched)
  })

  it('names other tools without leaking long arguments', () => {
    const base = { startedAt: 0, step: null, edited: [] }
    expect(LiveTurnsModel.describeCall(base, 'web_search', '{}').step).toBe('Searching the web')
    expect(LiveTurnsModel.describeCall(base, 'subagent', '{}').step).toBe('Delegating to a subagent')
    expect(LiveTurnsModel.describeCall(base, 'backlog_update', 'not json').step).toBe('Using backlog update')
    const long = LiveTurnsModel.describeCall(base, 'bash', JSON.stringify({ command: 'x'.repeat(200) })).step
    expect(long.length).toBeLessThanOrEqual(70)
    expect(long.endsWith('…')).toBe(true)
  })

  it('serves the folded turns with the Host clock, and keeps the start of a turn the fold missed', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pubsub = yield* PubSub.unbounded<SessionEvent>()
        return yield* Effect.gen(function* () {
          const live = yield* LiveTurns
          yield* PubSub.publish(pubsub, event('s', 'turn/start', 5))
          const read = live.list.pipe(
            Effect.tap(Effect.yieldNow),
            Effect.repeat({ until: value => value.turns.some(turn => turn.sessionId === 's'), times: 500 }),
          )
          return yield* read
        }).pipe(Effect.provide(LiveTurns.layer.pipe(Layer.provide(Layer.mergeAll(SessionEvents.layerTest(pubsub), markers)))))
      }),
    )
    expect(result.turns).toEqual([
      { sessionId: 's', startedAt: 5, step: null },
      { sessionId: 'before-reload', startedAt: 2, step: null },
    ])
    expect(result.now).toBeGreaterThan(0)
  })
})
