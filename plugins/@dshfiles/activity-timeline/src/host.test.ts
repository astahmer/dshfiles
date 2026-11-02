import { isApiError } from '@dshfiles/dshx/api'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { dirname } from 'node:path'
import { Effect, Schedule } from 'effect'
import { activityTimelineApi } from './api.js'
import plugin from './host.js'
import { temporaryStatePath } from './test-support.js'

const mountedTimeline = Effect.gen(function* () {
  const statePath = yield* temporaryStatePath
  const previousHome = process.env.DSH_HOME
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.env.DSH_HOME = dirname(statePath)
    }),
    () =>
      Effect.sync(() => {
        if (previousHome === undefined) delete process.env.DSH_HOME
        else process.env.DSH_HOME = previousHome
      }),
  )
  const host = yield* Effect.acquireRelease(
    Effect.promise(() => createTestHost()),
    created => Effect.promise(() => created.dispose()),
  )
  // SAFETY: the timeline only injects `agents` to order its activation after it; it never calls the service.
  const releaseAgents = host.ctx.provide('agents', {} as never)
  yield* Effect.addFinalizer(() => Effect.sync(releaseAgents))
  yield* Effect.promise(() => host.mount(plugin, { packageId: '@dshfiles/activity-timeline' }))
  return { host, client: createHostApiClient(host.ctx, activityTimelineApi, '@test/caller') }
})

describe('activity-timeline Host', () => {
  it.live('stores a decoded activity event and serves it through the API', () =>
    Effect.gen(function* () {
      const { host, client } = yield* mountedTimeline
      host.ctx.emit('dshfiles/activity/event', {
        kind: 'communication-message',
        value: { at: 10, messageId: 'message-1', senderId: 'session-a', recipientCount: 1, intent: 'request', topic: null, sessionId: 'session-a' },
      })
      host.ctx.emit('dshfiles/activity/event', { kind: 'communication-message', value: { at: 10 } })
      const page = yield* Effect.promise(() => client.page({ detailed: true })).pipe(
        Effect.repeat({ schedule: Schedule.spaced('10 millis'), until: result => result.totalRetained > 0, times: 50 }),
      )
      expect(page.items.map(item => item.id)).toEqual(['communication:message:message-1'])
    }),
  )

  it.live('exposes an unknown event id under its domain wire code', () =>
    Effect.gen(function* () {
      const { client } = yield* mountedTimeline
      const failure = yield* Effect.flip(
        Effect.tryPromise({ try: () => client.event({ eventId: 'missing' }), catch: error => (isApiError(error) ? error : new Error('not an ApiError')) }),
      )
      expect(failure).toMatchObject({ remoteCode: 'event-not-found', message: 'Activity event is no longer retained.' })
    }),
  )
})
