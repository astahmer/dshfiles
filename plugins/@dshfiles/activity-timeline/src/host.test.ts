import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { isApiError } from '@dshfiles/dshx/api'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Effect, Schedule } from 'effect'
import { activityTimelineApi } from './api.js'
import { attentionApi } from './attention-api.js'
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
  // The attention inbox stores its items in a real JSON storage domain under the same temporary home.
  yield* Effect.promise(async () => {
    await host.ctx.plugin(Storage)
    await host.ctx.plugin(StorageJson, { root: join(dirname(statePath), 'storage') })
    await host.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
  })
  yield* Effect.promise(() => host.mount(plugin, { packageId: '@dshfiles/activity-timeline' }))
  return {
    host,
    home: dirname(statePath),
    client: createHostApiClient(host.ctx, activityTimelineApi, '@test/caller'),
    attention: createHostApiClient(host.ctx, attentionApi, '@test/provider'),
  }
})

describe('activity-timeline Host', () => {
  it.live('stores a decoded activity event under the DSH_HOME set after startup and serves it through the API', () =>
    Effect.gen(function* () {
      const { host, home, client } = yield* mountedTimeline
      host.ctx.emit('dshfiles/activity/event', {
        kind: 'communication-message',
        value: { at: 10, messageId: 'message-1', senderId: 'session-a', recipientCount: 1, intent: 'request', topic: null, sessionId: 'session-a' },
      })
      host.ctx.emit('dshfiles/activity/event', { kind: 'communication-message', value: { at: 10 } })
      const page = yield* Effect.promise(() => client.page({ detailed: true })).pipe(
        Effect.repeat({ schedule: Schedule.spaced('10 millis'), until: result => result.totalRetained > 0, times: 50 }),
      )
      expect(page.items.map(item => item.id)).toEqual(['communication:message:message-1'])
      expect(existsSync(join(home, 'runtime', 'dshfiles', 'activity-timeline', 'state.json'))).toBe(true)
    }),
  )

  it.live('serves the attention inbox to a provider plugin and refuses a stale reopen with its wire code', () =>
    Effect.gen(function* () {
      const { attention } = yield* mountedTimeline
      const published = yield* Effect.promise(() =>
        attention.publish({
          source: 'test.provider',
          dedupeKey: 'q1',
          subject: { kind: 'session', id: 'session-a' },
          reason: 'A question waits',
          severity: 'blocking',
          verbs: ['Open', 'Done'],
        }),
      )
      const id = published.item?.id ?? ''
      expect((yield* Effect.promise(() => attention.list({}))).counts.needsYou).toBe(1)
      yield* Effect.promise(() => attention.resolve({ source: 'test.provider', dedupeKey: 'q1' }))
      const failure = yield* Effect.flip(
        Effect.tryPromise({ try: () => attention.reopen({ id }), catch: error => (isApiError(error) ? error : new Error('not an ApiError')) }),
      )
      expect(failure).toMatchObject({ remoteCode: 'attention-transition-refused' })
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
