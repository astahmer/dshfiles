import { HostContext } from '@dshfiles/dshx/effect'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { NativeQuestions } from './agent-host-promise.js'

const nativeQuestionsWith = (ctx: Parameters<typeof HostContext.layer>[0]['ctx']) =>
  Layer.build(NativeQuestions.layer.pipe(Layer.provide(HostContext.layer({ ctx, packageId: '@dshfiles/agent-questions' })))).pipe(
    Effect.map(services => Context.get(services, NativeQuestions)),
  )

describe('NativeQuestions.listTargets', () => {
  it.effect('lists the live Sessions without listing the persisted corpus', () =>
    Effect.gen(function* () {
      const host = yield* Effect.acquireRelease(
        Effect.promise(() => createTestHost()),
        created => Effect.promise(() => created.dispose()),
      )
      let corpusListings = 0
      host.ctx.provide('sessionProjections', { register: () => () => undefined })
      host.ctx.provide('sessions', {
        list: () => [{ id: 'session-root' }, { id: 'session-child' }],
        get: () => undefined,
      })
      host.ctx.provide('sessionQuery', {
        listSessions: async () => {
          corpusListings += 1
          return []
        },
      })

      const native = yield* nativeQuestionsWith(host.ctx)
      const targets = yield* native.listTargets({ liveRoots: new Set(['session-root']), includeStopped: false })

      expect(targets).toEqual([
        { sessionId: 'session-root', sessionLive: true, sessionPersisted: true, targetIsLiveRoot: true },
        { sessionId: 'session-child', sessionLive: true, sessionPersisted: true, targetIsLiveRoot: false },
      ])
      expect(corpusListings).toBe(0)
    }),
  )

  it.effect('lists the persisted corpus, stopped Sessions included, when stopped Sessions are asked for', () =>
    Effect.gen(function* () {
      const host = yield* Effect.acquireRelease(
        Effect.promise(() => createTestHost()),
        created => Effect.promise(() => created.dispose()),
      )
      host.ctx.provide('sessionProjections', { register: () => () => undefined })
      host.ctx.provide('sessions', { list: () => [], get: () => undefined })
      host.ctx.provide('sessionQuery', {
        listSessions: async () => [
          { header: { id: 'session-live' }, live: true, persisted: true },
          { header: { id: 'session-stopped' }, live: false, persisted: true },
        ],
      })

      const native = yield* nativeQuestionsWith(host.ctx)
      const targets = yield* native.listTargets({ liveRoots: new Set(['session-live']), includeStopped: true })

      expect(targets).toEqual([
        { sessionId: 'session-live', sessionLive: true, sessionPersisted: true, targetIsLiveRoot: true },
        { sessionId: 'session-stopped', sessionLive: false, sessionPersisted: true, targetIsLiveRoot: false },
      ])
    }),
  )
})
