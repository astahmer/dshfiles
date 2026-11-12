import { SessionId } from '@deepseek-ai/dsh-session'
import { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import { HostContext, tracerLayer } from '@dshfiles/dshx/effect'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { resolveThreadMentionCandidate } from './mention-candidate.js'

const sessionHeader = (id: string) => ({ id: SessionId(id), formatVersion: 4, createdAt: 1, cwd: '/work', isSeeded: false })

const provideMentionServices = async (input: {
  readonly live?: boolean
  readonly stored?: boolean
  readonly liveValues?: unknown
  readonly cachedValues?: unknown
  readonly storeFailure?: boolean
}) => {
  const host = await createTestHost()
  const corpusCalls: string[] = []
  host.ctx.provide('agents', {
    list: () => (input.live === true ? [{ id: SessionId('session-target'), session: { header: sessionHeader('session-target') } }] : []),
  })
  host.ctx.provide('sessionProjections', {
    register: () => () => undefined,
    snapshot: () => (input.liveValues === undefined ? undefined : { asOfSeq: 1, values: input.liveValues }),
  })
  host.ctx.provide('sessionProjectionCache', {
    cachedSnapshot: () => (input.cachedValues === undefined ? undefined : { asOfSeq: 1, values: input.cachedValues }),
  })
  host.ctx.provide('sessionPersistence', {
    stat: async (id: string) => {
      if (input.storeFailure === true) throw new Error('store unavailable')
      return input.stored === true ? { header: sessionHeader(id) } : undefined
    },
    list: async () => {
      corpusCalls.push('list')
      return []
    },
  })
  host.ctx.provide('sessionQuery', {
    listSessions: async () => {
      corpusCalls.push('listSessions')
      return []
    },
  })
  return { host, corpusCalls }
}

const resolveWith = async (host: Awaited<ReturnType<typeof createTestHost>>, input: { sessionId: string; agentSessionId?: string }) => {
  const layer = HostContext.layer({ ctx: host.ctx, packageId: '@dshfiles/thread-sidebar' })
  return Effect.runPromise(resolveThreadMentionCandidate(input).pipe(Effect.provide(tracerLayer), Effect.provide(layer)))
}

describe('thread mention candidate', () => {
  it.effect('labels a live Session from its projections without listing the corpus', () =>
    Effect.gen(function* () {
      const target = 'session-target'
      const provided = yield* Effect.promise(() => provideMentionServices({ live: true, liveValues: { title: 'Mention target' } }))
      yield* Effect.addFinalizer(() => Effect.promise(() => provided.host.dispose().then(() => undefined)))
      const answer = yield* Effect.promise(() => resolveWith(provided.host, { sessionId: target, agentSessionId: 'session-host' }))

      expect(answer).toEqual({
        candidate: {
          sessionId: target,
          label: 'Mention target',
          displayTitle: 'Mention target',
          mention: formatSessionReferenceMention({ sessionId: SessionId(target), label: 'Mention target' }),
        },
      })
      expect(provided.corpusCalls).toEqual([])
    }),
  )

  it.effect('labels a cold Session from its projection cache and prefers the subagent creation label', () =>
    Effect.gen(function* () {
      const target = 'session-cold'
      const provided = yield* Effect.promise(() =>
        provideMentionServices({ stored: true, cachedValues: { title: 'Cold target', subagent: { label: 'Child label' } } }),
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => provided.host.dispose().then(() => undefined)))
      const answer = yield* Effect.promise(() => resolveWith(provided.host, { sessionId: target, agentSessionId: 'session-host' }))

      expect(answer).toMatchObject({ candidate: { sessionId: target, label: 'Cold target', displayTitle: 'Child label' } })
      if (!('candidate' in answer)) throw new Error('expected a resolved candidate')
      expect(answer.candidate.mention).toBe(formatSessionReferenceMention({ sessionId: SessionId(target), label: 'Child label' }))
      expect(provided.corpusCalls).toEqual([])
    }),
  )

  it.effect('distinguishes a self reference, a missing Session and an unreadable store', () =>
    Effect.gen(function* () {
      const self = yield* Effect.promise(() => provideMentionServices({ live: true }))
      yield* Effect.addFinalizer(() => Effect.promise(() => self.host.dispose().then(() => undefined)))
      expect(yield* Effect.promise(() => resolveWith(self.host, { sessionId: 'session-a', agentSessionId: 'session-a' }))).toEqual({ reason: 'self' })

      const missing = yield* Effect.promise(() => provideMentionServices({}))
      yield* Effect.addFinalizer(() => Effect.promise(() => missing.host.dispose().then(() => undefined)))
      expect(yield* Effect.promise(() => resolveWith(missing.host, { sessionId: 'session-gone' }))).toEqual({ reason: 'missing' })

      const failed = yield* Effect.promise(() => provideMentionServices({ storeFailure: true }))
      yield* Effect.addFinalizer(() => Effect.promise(() => failed.host.dispose().then(() => undefined)))
      expect(yield* Effect.promise(() => resolveWith(failed.host, { sessionId: 'session-gone' }))).toEqual({ reason: 'unavailable' })
    }),
  )

  it.effect('records one thread mention resolve span with identities only, never the title', () =>
    Effect.gen(function* () {
      using recorder = recordSpans()
      const target = 'session-span'
      const provided = yield* Effect.promise(() => provideMentionServices({ live: true, liveValues: { title: 'Private tab title' } }))
      yield* Effect.addFinalizer(() => Effect.promise(() => provided.host.dispose().then(() => undefined)))
      yield* Effect.promise(() => resolveWith(provided.host, { sessionId: target, agentSessionId: 'session-host' }))

      const span = recorder.span('thread mention resolve')
      expect(span.attributes['dsh.session.id']).toBe(target)
      expect(span.attributes['dshx.thread-sidebar.mention_self']).toBe(false)
      expect(JSON.stringify(span.attributes)).not.toContain('Private tab title')
    }),
  )
})
