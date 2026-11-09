import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { StartIntentClaims, StartIntents, type StartIntentDraft } from './start-intents.js'
import { backlogDbLayer } from './test-support.js'

const openIntents = Effect.map(Layer.build(StartIntents.layer.pipe(Layer.provideMerge(backlogDbLayer()))), context => Context.get(context, StartIntents))

/** The stale window the recovery pass uses: a start nobody refreshed for this long is taken. */
const window = 45_000
const sweepAt = (now: number) => ({ before: now - window, limit: 5 })

const draft = (overrides: Partial<StartIntentDraft> = {}): StartIntentDraft => ({
  id: 'start-1',
  promptRequestId: 'request-1',
  itemIds: [4, 5],
  agent: 'dsh',
  agentPreset: null,
  create: { workspaceId: 'workspace-1' },
  route: { provider: 'deepseek', model: 'deepseek-v4' },
  message: null,
  actor: { kind: 'user' },
  ...overrides,
})

describe('thread start log', () => {
  it.effect('hands a start to recovery only once nobody refreshed it for the stale window', () =>
    Effect.gen(function* () {
      const intents = yield* openIntents
      yield* intents.record(draft(), 1_000_000)
      expect(yield* intents.find('start-1')).toMatchObject({ itemIds: [4, 5], sessionId: null, attempts: 0, actor: { kind: 'user' } })

      expect(yield* intents.stale(sweepAt(1_044_999))).toEqual([])
      const [stale] = yield* intents.stale(sweepAt(1_045_000))
      expect(stale?.itemIds).toEqual([4, 5])
      expect(stale?.route).toEqual({ provider: 'deepseek', model: 'deepseek-v4' })
      expect(stale?.create).toEqual({ workspaceId: 'workspace-1' })
    }),
  )

  it.effect('keeps a start a live Host is still refreshing out of the recovery pass', () =>
    Effect.gen(function* () {
      const intents = yield* openIntents
      yield* intents.record(draft(), 1_000_000)
      yield* intents.touch('start-1', 1_040_000)
      expect(yield* intents.stale(sweepAt(1_084_999))).toEqual([])
      expect((yield* intents.stale(sweepAt(1_085_000))).map(intent => intent.id)).toEqual(['start-1'])
    }),
  )

  it.effect('remembers the Session a start created so a resume never creates a second one', () =>
    Effect.gen(function* () {
      const intents = yield* openIntents
      yield* intents.record(draft(), 1_000_000)
      yield* intents.setSession('start-1', 'session-9', 1_041_000)
      const [stale] = yield* intents.stale(sweepAt(1_086_000))
      expect(stale?.sessionId).toBe('session-9')
      expect(stale?.updatedAt).toBe(1_041_000)
    }),
  )

  it.effect('backs a failing start off and forgets one that finished', () =>
    Effect.gen(function* () {
      const intents = yield* openIntents
      yield* intents.record(draft(), 1_000_000)
      yield* intents.attempted({ id: 'start-1', attempts: 2, lastError: 'Sessions are unavailable.', now: 1_050_000 })
      expect(yield* intents.stale(sweepAt(1_094_999))).toEqual([])
      const [stale] = yield* intents.stale(sweepAt(1_095_000))
      expect(stale?.attempts).toBe(2)
      expect(stale?.lastError).toBe('Sessions are unavailable.')
      yield* intents.remove('start-1')
      expect(yield* intents.find('start-1')).toBeNull()
    }),
  )
})

describe('running start claims', () => {
  it.effect('holds a start while its effect runs and releases it afterwards', () =>
    Effect.gen(function* () {
      const claims = yield* Layer.build(StartIntentClaims.layer).pipe(Effect.map(context => Context.get(context, StartIntentClaims)))
      expect(yield* claims.held('start-1')).toBe(false)
      yield* claims.hold(
        'start-1',
        Effect.gen(function* () {
          expect(yield* claims.held('start-1')).toBe(true)
        }),
      )
      expect(yield* claims.held('start-1')).toBe(false)
    }),
  )
})
