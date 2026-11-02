import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Fiber, FileSystem, Layer, Ref } from 'effect'
import { ActivityTimelineAdapters } from './adapters.js'
import { ActivityTimeline } from './activity-timeline.js'
import { ActivityTimelineCondensation } from './condensation.js'
import { now, routine, temporaryStatePath, timelineLayer } from './test-support.js'
import type { ActivityIngest } from './types.js'

const withTimeline = <A, E>(body: Effect.Effect<A, E, ActivityTimeline>) =>
  Effect.flatMap(temporaryStatePath, statePath => body.pipe(Effect.provide(timelineLayer({ statePath }))))

/** The Node file system, counting the whole-document reads and writes the store performs. */
const countingFileSystem = (counts: { readonly reads: Ref.Ref<number>; readonly writes: Ref.Ref<number> }) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, fs => ({
      ...fs,
      readFileString: (path: string, encoding?: string) => Ref.update(counts.reads, count => count + 1).pipe(Effect.andThen(fs.readFileString(path, encoding))),
      writeFileString: (path: string, data: string, options?: Parameters<FileSystem.FileSystem['writeFileString']>[2]) =>
        Ref.update(counts.writes, count => count + 1).pipe(Effect.andThen(fs.writeFileString(path, data, options))),
    })),
  ).pipe(Layer.provide(NodeServices.layer))

describe('activity timeline', () => {
  it.effect('interleaves events from multiple agents in chronological order', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        yield* timeline.ingest([routine(1, now + 300, 'session-b'), routine(2, now + 100, 'session-a'), routine(3, now + 200, 'session-c')])
        const page = yield* timeline.page({ detailed: true })
        expect(page.items.map(item => item.sessionId)).toEqual(['session-a', 'session-c', 'session-b'])
        expect(page.items.map(item => item.at)).toEqual([now + 100, now + 200, now + 300])
      }),
    ),
  )

  it.effect('deduplicates repeated delivery of the same event id', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        const [first] = yield* timeline.ingest([routine(1, now)])
        const [second] = yield* timeline.ingest([routine(1, now)])
        expect(first?.duplicate).toBe(false)
        expect(second?.duplicate).toBe(true)
        expect(yield* timeline.stats).toMatchObject({ retained: 1, duplicates: 1 })
      }),
    ),
  )

  it.effect('orders out-of-order timestamps and preserves references', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        yield* timeline.ingest([
          ActivityTimelineAdapters.integrationActivity({
            id: 'evt-2',
            at: now + 500,
            type: 'integration.completed',
            workspaceId: 'workspace-1',
            sessionId: 'session-a',
            candidateId: 'candidate-1',
            correlationId: 'corr-1',
            detail: 'Integrated as abc123',
            outcome: 'integrated',
          }),
        ])
        yield* timeline.ingest([ActivityTimelineAdapters.sessionActivity({ kind: 'created', at: now + 100, sessionId: 'session-a' })])
        const page = yield* timeline.page({ detailed: true })
        expect(page.items.map(item => item.type)).toEqual(['session.started', 'integration.completed'])
        expect(page.items[1]?.references.map(reference => reference.kind)).toEqual(['integration-candidate', 'workspace'])
      }),
    ),
  )

  it.effect('replays retained history after a coordinator restart', () =>
    Effect.gen(function* () {
      const statePath = yield* temporaryStatePath
      yield* ActivityTimeline.use(timeline => timeline.ingest([routine(1, now), routine(2, now + 1)])).pipe(Effect.provide(timelineLayer({ statePath })))
      const page = yield* ActivityTimeline.use(timeline => timeline.page({ detailed: true })).pipe(Effect.provide(timelineLayer({ statePath })))
      expect(page.totalRetained).toBe(2)
      expect(page.items).toHaveLength(2)
    }),
  )

  it.effect('paginates history newest-first with an older cursor', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        yield* timeline.ingest(Array.from({ length: 200 }, (_, index) => routine(index, now + index)))
        const newest = yield* timeline.page({ limit: 60, detailed: true })
        expect(newest.items).toHaveLength(60)
        expect(newest.hasMore).toBe(true)
        expect(newest.nextCursor).not.toBeNull()
        expect(newest.items[59]?.at).toBe(now + 199)
        const older = yield* timeline.page({ limit: 60, detailed: true, ...(newest.nextCursor !== null && { cursor: newest.nextCursor }) })
        expect(older.items.at(-1)?.at).toBe(now + 139)
        expect(new Set([...newest.items, ...older.items].map(item => item.id)).size).toBe(120)
      }),
    ),
  )

  it.effect('refuses a malformed cursor and an unknown event with their wire errors', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        const cursor = yield* Effect.flip(timeline.page({ cursor: 'no-separator' }))
        expect(cursor._tag).toBe('ActivityCursorInvalid')
        const missing = yield* Effect.flip(timeline.event('missing'))
        expect(missing).toMatchObject({ _tag: 'ActivityEventNotFound', eventId: 'missing', message: 'Activity event is no longer retained.' })
        expect((yield* Effect.flip(timeline.related('missing', 10)))._tag).toBe('ActivityEventNotFound')
      }),
    ),
  )

  it.effect('condenses routine runs and keeps attention events individual', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        yield* timeline.ingest([
          routine(1, now, 'session-a'),
          routine(2, now + 1, 'session-a'),
          routine(3, now + 2, 'session-a'),
          ActivityTimelineAdapters.sessionActivity({ kind: 'error', at: now + 3, sessionId: 'session-a', detail: 'boom' }),
          routine(4, now + 4, 'session-a'),
        ])
        const condensed = yield* timeline.page({})
        const group = condensed.items.find(item => item.kind === 'group')
        expect(group?.count).toBe(3)
        expect(group?.eventIds).toHaveLength(3)
        expect(condensed.items.some(item => item.level === 'attention' && item.type === 'session.error')).toBe(true)
        expect((yield* timeline.page({ detailed: true })).items).toHaveLength(5)
      }),
    ),
  )

  it.effect('groups correlated events and expands to their ids', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        yield* timeline.ingest([
          { ...routine(1, now, 'session-a', 'corr-9'), level: 'notable' },
          { ...routine(2, now + 1, 'session-a', 'corr-9'), level: 'notable' },
        ])
        const group = (yield* timeline.page({})).items.find(item => item.correlationId === 'corr-9')
        expect(group?.count).toBe(2)
        expect(group?.eventIds).toHaveLength(2)
        expect((yield* timeline.related('routine-1', 50)).map(event => event.id)).toEqual(['routine-1', 'routine-2'])
      }),
    ),
  )

  it.effect('exposes attention events even when routine events are condensed away', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        yield* timeline.ingest([
          routine(1, now, 'session-a'),
          ActivityTimelineAdapters.integrationActivity({
            id: 'evt-block',
            at: now + 1,
            type: 'integration.blocked',
            workspaceId: 'ws-1',
            sessionId: 'session-a',
            candidateId: 'cand-1',
            correlationId: null,
            detail: 'conflict in shared.txt',
            outcome: 'blocked',
          }),
          routine(2, now + 2, 'session-a'),
        ])
        expect((yield* timeline.page({})).items.some(item => item.type === 'integration.blocked')).toBe(true)
        expect((yield* timeline.attention(20)).map(event => event.type)).toEqual(['integration.blocked'])
      }),
    ),
  )

  it.effect('filters and searches without scanning the whole history on the client', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        yield* timeline.ingest([
          ActivityTimelineAdapters.sessionActivity({ kind: 'created', at: now, sessionId: 'session-a' }),
          ActivityTimelineAdapters.communicationMessage({
            at: now + 1,
            messageId: 'message-1',
            senderId: 'session-a',
            recipientCount: 1,
            intent: 'request',
            topic: null,
            sessionId: 'session-a',
          }),
          ActivityTimelineAdapters.integrationActivity({
            id: 'evt-1',
            at: now + 2,
            type: 'integration.completed',
            workspaceId: 'ws-1',
            sessionId: 'session-b',
            candidateId: 'cand-1',
            correlationId: null,
            detail: 'Integrated as abc123',
            outcome: 'integrated',
          }),
        ])
        expect((yield* timeline.page({ sources: ['communication'], detailed: true })).items.map(item => item.type)).toEqual(['communication.message'])
        expect((yield* timeline.page({ sessionId: 'session-b', detailed: true })).items.map(item => item.type)).toEqual(['integration.completed'])
        expect((yield* timeline.page({ search: 'integrated', detailed: true })).items.map(item => item.type)).toEqual(['integration.completed'])
        expect((yield* timeline.page({ search: 'nothing-matches' })).items).toHaveLength(0)
      }),
    ),
  )

  // Heavy by design: every ingest durably rewrites the whole state document. The size bound fails a window that
  // stops trimming.
  it.effect(
    'keeps a bounded window under high volume',
    () =>
      Effect.gen(function* () {
        const statePath = yield* temporaryStatePath
        const sizeOf = Effect.flatMap(FileSystem.FileSystem, fs => fs.stat(statePath)).pipe(
          Effect.map(info => Number(info.size)),
          Effect.provide(NodeServices.layer),
        )
        yield* Effect.gen(function* () {
          const timeline = yield* ActivityTimeline
          const events = Array.from({ length: 1200 }, (_, index) => routine(index, now + index))
          yield* timeline.ingest(events.slice(0, 600))
          const filledBytes = yield* sizeOf
          yield* timeline.ingest(events.slice(600))
          expect(yield* timeline.stats).toMatchObject({ retained: 500, ingested: 1200 })
          const page = yield* timeline.page({ limit: 200, detailed: true })
          expect(page.items).toHaveLength(200)
          expect(page.totalRetained).toBe(500)
          expect(yield* sizeOf).toBeLessThan(filledBytes * 1.5)
        }).pipe(Effect.provide(timelineLayer({ statePath, maxEvents: 500 })))
      }),
    { timeout: 30_000 },
  )

  it.effect('does not require any agent, session, or jj source to be present', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        const page = yield* timeline.page({})
        expect(page.items).toHaveLength(0)
        expect(page.totalRetained).toBe(0)
        expect((yield* timeline.stats).sources).toEqual({})
      }),
    ),
  )

  it.effect('rejects malformed ingest payloads instead of storing them', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        const malformed: ActivityIngest = { ...routine(1, now), id: '' }
        expect((yield* Effect.flip(timeline.ingest([malformed])))._tag).toBe('ActivityIngestInvalid')
        expect((yield* Effect.flip(timeline.enqueue({ ...routine(2, now), references: [{ kind: 'workspace', id: '', label: null }] })))._tag).toBe(
          'ActivityIngestInvalid',
        )
        expect((yield* timeline.stats).retained).toBe(0)
      }),
    ),
  )

  it.effect('leaves out the workspace reference when a workspace event names no workspace', () =>
    withTimeline(
      Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        const event = ActivityTimelineAdapters.workspaceActivity({
          id: 'workspace:cleanup:host:1',
          at: now,
          type: 'workspace.refused',
          level: 'attention',
          summary: 'Automatic thread-workspace cleanup failed',
          detail: null,
          sessionId: null,
          workspaceId: '',
          workspaceName: null,
        })
        const [stored] = yield* timeline.ingest([event])
        expect(stored?.event.references).toEqual([])
      }),
    ),
  )
})

describe('activity timeline snapshot cache', () => {
  it.effect('serves repeated reads from one parsed snapshot and still sees an external write', () =>
    Effect.gen(function* () {
      const statePath = yield* temporaryStatePath
      const counts = { reads: yield* Ref.make(0), writes: yield* Ref.make(0) }
      yield* Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        yield* timeline.ingest([routine(1, now)])
        yield* Ref.set(counts.reads, 0)
        yield* timeline.page({})
        yield* timeline.stats
        const stored = yield* timeline.event('routine-1')
        expect(yield* Ref.get(counts.reads)).toBe(0)

        const external = { schemaVersion: 1, events: [{ ...stored, id: 'external-1' }], ingestCount: 2, duplicateCount: 0, startedAt: now }
        yield* Effect.flatMap(FileSystem.FileSystem, fs => fs.writeFileString(statePath, JSON.stringify(external))).pipe(Effect.provide(NodeServices.layer))
        expect((yield* timeline.event('external-1')).id).toBe('external-1')
        expect(yield* Ref.get(counts.reads)).toBe(1)
      }).pipe(Effect.provide(timelineLayer({ statePath }, countingFileSystem(counts))))
    }),
  )

  it.effect('reports a corrupt state document as invalid and leaves it untouched', () =>
    Effect.gen(function* () {
      const statePath = yield* temporaryStatePath
      const fs = yield* Effect.provide(FileSystem.FileSystem, NodeServices.layer)
      yield* fs.writeFileString(statePath, '{"schemaVersion":1,"events":"nope"}')
      const failure = yield* Effect.flip(ActivityTimeline.use(timeline => timeline.stats).pipe(Effect.provide(timelineLayer({ statePath }))))
      expect(failure).toMatchObject({ _tag: 'ActivityStateInvalid', message: 'Activity state is invalid; it was left untouched.' })
      expect(yield* fs.readFileString(statePath)).toBe('{"schemaVersion":1,"events":"nope"}')
    }),
  )
})

describe('activity timeline ingest batching', () => {
  it.live('flushes a burst as one durable write and settles every caller', () =>
    Effect.gen(function* () {
      const statePath = yield* temporaryStatePath
      const counts = { reads: yield* Ref.make(0), writes: yield* Ref.make(0) }
      yield* Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        const results = yield* Effect.forEach(
          Array.from({ length: 50 }, (_unused, index) => routine(index + 1, now + index)),
          event => timeline.enqueue(event),
          { concurrency: 'unbounded' },
        )
        expect(results.every(result => !result.duplicate)).toBe(true)
        expect(yield* Ref.get(counts.writes)).toBe(1)
        expect(yield* timeline.stats).toMatchObject({ retained: 50, ingested: 50, duplicates: 0 })
      }).pipe(Effect.provide(timelineLayer({ statePath }, countingFileSystem(counts))))
    }),
  )

  it.effect('settles duplicates per caller and flushes a pending batch when the timeline closes', () =>
    Effect.gen(function* () {
      const statePath = yield* temporaryStatePath
      const pending = yield* Effect.gen(function* () {
        const timeline = yield* ActivityTimeline
        const enqueued = yield* Effect.forEach([routine(1, now), routine(1, now)], event => Effect.forkDetach(timeline.enqueue(event)))
        yield* Effect.yieldNow
        return enqueued
      }).pipe(Effect.provide(timelineLayer({ statePath })))
      const exits = yield* Effect.forEach(pending, Fiber.await)
      expect(exits.map(exit => Exit.isSuccess(exit) && exit.value.duplicate).sort()).toEqual([false, true])
      const stats = yield* ActivityTimeline.use(timeline => timeline.stats).pipe(Effect.provide(timelineLayer({ statePath })))
      expect(stats).toMatchObject({ retained: 1, ingested: 1, duplicates: 1 })
    }),
  )
})

describe('activity condensation primitives', () => {
  it('is deterministic and traceable to underlying event ids', () => {
    const events = [routine(1, now, 'session-a'), routine(2, now + 1, 'session-a')].map(input => ({
      id: input.id,
      at: input.at,
      source: input.source,
      type: input.type,
      level: input.level ?? 'routine',
      sessionId: input.sessionId ?? null,
      workspaceId: null,
      taskId: null,
      correlationId: null,
      causationId: null,
      summary: input.summary,
      detail: null,
      metadata: {},
      references: [],
      provenance: 'observed' as const,
    }))
    const first = ActivityTimelineCondensation.condenseEvents(events)
    expect(first).toEqual(ActivityTimelineCondensation.condenseEvents(events))
    expect(first[0]?.eventIds).toEqual(['routine-1', 'routine-2'])
    expect(ActivityTimelineCondensation.condenseEvents(events, { detailed: true })).toHaveLength(2)
  })

  it('maps adapters with authoritative levels', () => {
    expect(ActivityTimelineAdapters.sessionActivity({ kind: 'error', at: now, sessionId: 's' }).level).toBe('attention')
    expect(
      ActivityTimelineAdapters.communicationActivity({
        at: now,
        sessionId: 's',
        operation: 'dshx_comm_inbox',
        outcome: 'failure',
        callId: 'c1',
        rootCallId: null,
      }).level,
    ).toBe('attention')
    expect(
      ActivityTimelineAdapters.communicationMessage({ at: now, messageId: 'm1', senderId: 's', recipientCount: 2, intent: 'request', topic: null }).level,
    ).toBe('notable')
    expect(
      ActivityTimelineAdapters.integrationActivity({
        id: 'e',
        at: now,
        type: 'integration.completed',
        workspaceId: null,
        sessionId: null,
        candidateId: null,
        correlationId: null,
        detail: null,
        outcome: 'integrated',
      }).level,
    ).toBe('routine')
  })
})
