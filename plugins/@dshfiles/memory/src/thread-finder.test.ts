import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Ref } from 'effect'
import { TestClock } from 'effect/testing'

import {
  ThreadFinder,
  type ContentFailure,
  type ThreadFinderDeps,
  type ThreadFinderMemoryHit,
  type ThreadFinderQuery,
  type ThreadFinderRecord,
  type ThreadFinderSource,
} from './thread-finder.ts'

const now = 1_800_000_000_000

const record = (input: Partial<ThreadFinderRecord> & { readonly sessionId: string }): ThreadFinderRecord => ({
  title: '',
  createdAt: now - 86_400_000,
  updatedAt: now - 3_600_000,
  cwd: null,
  project: '/dev/dshfiles',
  live: false,
  persisted: true,
  parentSessionId: null,
  ...input,
})

type ContentReply = { readonly hits: readonly { readonly sessionId: string; readonly snippet: string }[]; readonly hasMore: boolean }

const deps = (options: {
  readonly records: readonly ThreadFinderRecord[]
  readonly content?: Effect.Effect<ContentReply, ContentFailure>
  readonly memory?: readonly ThreadFinderMemoryHit[]
  readonly digest?: (sessionId: string) => string | null
}): ThreadFinderDeps<never> => ({
  records: options.records,
  searchContent: () => options.content ?? Effect.succeed({ hits: [], hasMore: false }),
  searchMemory: () => Effect.succeed(options.memory ?? []),
  readDigest: sessionId => Effect.succeed(options.digest?.(sessionId) ?? null),
  retry: { attempts: 3, delaysMs: [0, 0, 0] },
})

const query = (input: Partial<ThreadFinderQuery> & { readonly query: string }): ThreadFinderQuery => ({
  projects: [],
  ownProject: '/dev/dshfiles',
  limit: 5,
  ...input,
})

/** Runs a search at the fixed test time. */
const find = (finderDeps: ThreadFinderDeps<never>, request: ThreadFinderQuery) =>
  Effect.andThen(TestClock.setTime(now), ThreadFinder.find({ deps: finderDeps, query: request }))

const titles = (...sources: readonly (readonly ThreadFinderSource[])[]): readonly string[] => sources.flat().sort()

const persistenceFailure = (message: string): ContentFailure => ({ code: 'SESSION_QUERY_PERSISTENCE_FAILED', message })

describe('thread finder source overlap', () => {
  it.effect('starts content search and memory retrieval together instead of one after the other', () =>
    Effect.gen(function* () {
      const started = yield* Ref.make<readonly string[]>([])
      const releaseContent = yield* Deferred.make<void>()
      const releaseMemory = yield* Deferred.make<void>()
      const both = yield* Deferred.make<void>()
      const mark = (source: string) =>
        Effect.andThen(
          Ref.updateAndGet(started, list => [...list, source]),
          list => (list.length === 2 ? Deferred.succeed(both, undefined) : Effect.void),
        )
      const concurrent: ThreadFinderDeps<never> = {
        records: [record({ sessionId: 'session-a', title: 'checkpoint notes' })],
        searchContent: () => mark('content').pipe(Effect.andThen(Deferred.await(releaseContent)), Effect.as({ hits: [], hasMore: false })),
        searchMemory: () => mark('memory').pipe(Effect.andThen(Deferred.await(releaseMemory)), Effect.as([])),
        readDigest: () => Effect.succeed(null),
        retry: { attempts: 1, delaysMs: [0] },
        contentDeadlineMs: 0,
      }
      const pending = yield* Effect.forkChild(find(concurrent, query({ query: 'checkpoint' })))
      // Both requests are in flight before either answers; a sequential run would leave memory unstarted here.
      yield* Deferred.await(both)
      expect(yield* Ref.get(started)).toEqual(['content', 'memory'])
      yield* Deferred.succeed(releaseContent, undefined)
      yield* Deferred.succeed(releaseMemory, undefined)
      // The title still matches the query, so this only asserts that the overlapped sources produced a page.
      const page = yield* Fiber.join(pending)
      expect(page.hits.map(hit => hit.sessionId)).toEqual(['session-a'])
    }),
  )

  it.effect('degrades to titles when content search outlives its deadline, and starts one background reconcile', () =>
    Effect.gen(function* () {
      const warmed = yield* Ref.make<readonly string[]>([])
      const slow: ThreadFinderDeps<never> = {
        ...deps({ records: [record({ sessionId: 'session-a', title: 'checkpoint notes' })], content: Effect.never }),
        warmContent: text => Ref.update(warmed, list => [...list, text]),
        contentDeadlineMs: 1_500,
      }
      yield* TestClock.setTime(now)
      const pending = yield* Effect.forkChild(ThreadFinder.find({ deps: slow, query: query({ query: 'checkpoint' }) }))
      yield* TestClock.adjust('1500 millis')
      const page = yield* Fiber.join(pending)
      expect(page.hits.map(hit => hit.sessionId)).toEqual(['session-a'])
      expect(page.degraded).toMatchObject([{ code: 'SESSION_QUERY_TIMEOUT', attempts: 1, elapsedMs: 1_500 }])
      expect(yield* Ref.get(warmed)).toEqual(['checkpoint'])
    }),
  )
})

describe('thread finder', () => {
  it.effect('ranks an exact title above every weaker match and names its source and evidence', () =>
    Effect.gen(function* () {
      const page = yield* find(
        deps({
          records: [
            record({ sessionId: 'session-a', title: 'Session search and thread finder', updatedAt: now - 10_000 }),
            record({ sessionId: 'session-b', title: 'Session search notes', updatedAt: now }),
          ],
        }),
        query({ query: 'Session search and thread finder' }),
      )
      expect(page.hits.map(hit => hit.sessionId)).toEqual(['session-a', 'session-b'])
      expect(page.hits[0]?.evidence).toEqual(['exact-title'])
      expect(page.hits[0]?.sources).toEqual(['session-title'])
      expect(page.hits[1]?.evidence).toEqual(['title-match'])
      expect(page.diagnostics.incomplete).toBe(false)
      expect(page.degraded).toEqual([])
    }),
  )

  it.effect('finds a thread by a repository or workspace identifier in its cwd', () =>
    Effect.gen(function* () {
      const page = yield* find(
        deps({
          records: [
            record({ sessionId: 'session-a', title: 'Rebase work', cwd: '/Users/astahmer/dev/dshfiles-threads/thread-992924' }),
            record({ sessionId: 'session-b', title: 'Unrelated', cwd: '/Users/astahmer/dev/other' }),
          ],
        }),
        query({ query: 'thread-992924' }),
      )
      expect(page.hits.map(hit => hit.sessionId)).toEqual(['session-a'])
      expect(page.hits[0]?.evidence).toEqual(['identifier'])
      expect(page.hits[0]?.sources).toEqual(['session-metadata'])
    }),
  )

  it.effect('finds a natural phrase in a user message through session content', () =>
    Effect.gen(function* () {
      const page = yield* find(
        deps({
          records: [record({ sessionId: 'session-a', title: 'Plugin audit' })],
          content: Effect.succeed({ hits: [{ sessionId: 'session-a', snippet: '…so I started another thread mentioning it' }], hasMore: false }),
        }),
        query({ query: 'another thread mentioning it' }),
      )
      expect(page.hits[0]?.sources).toEqual(['session-content'])
      expect(page.hits[0]?.evidence).toEqual(['text-match'])
      expect(page.hits[0]?.snippet).toBe('…so I started another thread mentioning it')
    }),
  )

  it.effect('returns one hit for a session found by two sources, keeping both provenances', () =>
    Effect.gen(function* () {
      const page = yield* find(
        deps({
          records: [record({ sessionId: 'session-a', title: 'Memory search ranking' })],
          content: Effect.succeed({ hits: [{ sessionId: 'session-a', snippet: 'ranking the memory search hits' }], hasMore: false }),
        }),
        query({ query: 'memory search ranking' }),
      )
      expect(page.hits).toHaveLength(1)
      expect(titles(page.hits[0]?.sources ?? [])).toEqual(['session-content', 'session-title'])
      expect(page.hits[0]?.evidence).toEqual(['exact-title', 'text-match'])
    }),
  )

  it.effect('keeps ambiguous same-topic threads apart with a deterministic order', () =>
    Effect.gen(function* () {
      const records = [
        record({ sessionId: 'session-b', title: 'Thread search plan', updatedAt: now - 1_000 }),
        record({ sessionId: 'session-a', title: 'Thread search plan', updatedAt: now - 1_000 }),
        record({ sessionId: 'session-c', title: 'Thread search plan', updatedAt: now - 5_000 }),
      ]
      const request = query({ query: 'thread search plan' })
      const first = yield* find(deps({ records }), request)
      const second = yield* find(deps({ records: [...records].reverse() }), request)
      expect(first.hits.map(hit => hit.sessionId)).toEqual(['session-a', 'session-b', 'session-c'])
      expect(second.hits.map(hit => hit.sessionId)).toEqual(['session-a', 'session-b', 'session-c'])
    }),
  )

  it.effect('merges a memory digest hit into the session it belongs to', () =>
    Effect.gen(function* () {
      const page = yield* find(
        deps({
          records: [record({ sessionId: 'session-a', title: 'Billing incident' })],
          memory: [
            {
              kind: 'digest',
              sessionId: 'session-a',
              project: '/dev/dshfiles',
              updatedAt: now,
              title: 'Billing incident',
              text: 'Rediscovered the retry storm fix',
              score: 3,
            },
          ],
        }),
        query({ query: 'retry storm' }),
      )
      expect(page.hits.map(hit => hit.sessionId)).toEqual(['session-a'])
      expect(page.hits[0]?.sources).toEqual(['memory-digest'])
      expect(page.hits[0]?.evidence).toEqual(['digest-match'])
      expect(page.diagnostics.sources).toContain('memory-digest')
    }),
  )

  it.effect('returns notes only when asked, labeled apart from the thread hits', () =>
    Effect.gen(function* () {
      const memory: ThreadFinderMemoryHit[] = [
        { kind: 'note', noteId: 7, project: '/dev/dshfiles', updatedAt: now, text: 'the retry cap is 4', sourceThread: 'session-a', score: 2 },
      ]
      const silent = yield* find(deps({ records: [], memory }), query({ query: 'retry cap' }))
      expect(silent.notes).toEqual([])
      const labeled = yield* find(deps({ records: [], memory }), query({ query: 'retry cap', includeNotes: true }))
      expect(labeled.notes.map(entry => entry.noteId)).toEqual([7])
      expect(labeled.notes[0]?.sourceThread).toBe('session-a')
    }),
  )

  it.effect('applies project, availability and creation-date filters before ranking', () =>
    Effect.gen(function* () {
      const records = [
        record({ sessionId: 'session-live', title: 'alpha', live: true, persisted: true, project: '/dev/dshfiles', createdAt: now - 1_000 }),
        record({ sessionId: 'session-cold', title: 'alpha', live: false, persisted: true, project: '/dev/dshfiles', createdAt: now - 10 * 86_400_000 }),
        record({ sessionId: 'session-other', title: 'alpha', project: '/dev/other', createdAt: now - 1_000 }),
      ]
      const live = yield* find(deps({ records }), query({ query: 'alpha', projects: ['/dev/dshfiles'], availability: ['live'] }))
      expect(live.hits.map(hit => hit.sessionId)).toEqual(['session-live'])
      const recent = yield* find(deps({ records }), query({ query: 'alpha', projects: ['/dev/dshfiles'], createdFrom: now - 2 * 86_400_000 }))
      expect(recent.hits.map(hit => hit.sessionId)).toEqual(['session-live'])
      const scoped = yield* find(deps({ records }), query({ query: 'alpha', projects: ['/dev/other'], ownProject: '/dev/other' }))
      expect(scoped.hits.map(hit => hit.sessionId)).toEqual(['session-other'])
    }),
  )

  it.effect('pages with a cursor and refuses one issued against a different corpus', () =>
    Effect.gen(function* () {
      const records = [record({ sessionId: 'session-a', title: 'alpha' }), record({ sessionId: 'session-b', title: 'alpha' })]
      const first = yield* find(deps({ records }), query({ query: 'alpha', limit: 1 }))
      expect(first.hits.map(hit => hit.sessionId)).toEqual(['session-a'])
      expect(first.nextCursor).not.toBeNull()
      const second = yield* find(deps({ records }), query({ query: 'alpha', limit: 1, cursor: first.nextCursor ?? undefined }))
      expect(second.hits.map(hit => hit.sessionId)).toEqual(['session-b'])
      expect(second.nextCursor).toBeNull()
      const grown = [...records, record({ sessionId: 'session-c', title: 'alpha', updatedAt: now })]
      const stale = yield* Effect.flip(find(deps({ records: grown }), query({ query: 'alpha', limit: 1, cursor: first.nextCursor ?? undefined })))
      expect(stale._tag).toBe('FinderStaleCursor')
      const foreign = yield* Effect.flip(find(deps({ records }), query({ query: 'alpha', limit: 1, cursor: 'not-a-cursor' })))
      expect(foreign).toMatchObject({ _tag: 'FinderInvalidRequest', reason: 'foreign-cursor' })
    }),
  )

  it.effect('retries the transient observation failure and returns complete results', () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const content = Effect.flatMap(
        Ref.updateAndGet(calls, count => count + 1),
        count =>
          count < 3
            ? Effect.fail(persistenceFailure('session-search persistence observation did not stabilize after one retry'))
            : Effect.succeed({ hits: [{ sessionId: 'session-a', snippet: 'the phrase you remember' }], hasMore: false }),
      )
      const page = yield* find(
        deps({ records: [record({ sessionId: 'session-a', title: 'unrelated title' })], content }),
        query({ query: 'the phrase you remember' }),
      )
      expect(yield* Ref.get(calls)).toBe(3)
      expect(page.degraded).toEqual([])
      expect(page.diagnostics.incomplete).toBe(false)
      expect(page.hits.map(hit => hit.sessionId)).toEqual(['session-a'])
    }),
  )

  it.effect('labels a degraded page instead of pretending it is complete', () =>
    Effect.gen(function* () {
      const page = yield* find(
        deps({ records: [record({ sessionId: 'session-a', title: 'thread finder plan' })], content: Effect.fail(persistenceFailure('did not stabilize')) }),
        query({ query: 'thread finder plan' }),
      )
      expect(page.degraded).toEqual([
        { source: 'session-content', code: 'SESSION_QUERY_PERSISTENCE_FAILED', message: 'did not stabilize', attempts: 3, elapsedMs: 0 },
      ])
      expect(page.diagnostics.incomplete).toBe(true)
      expect(page.diagnostics.attempts).toBe(3)
      expect(page.hits.map(hit => hit.sessionId)).toEqual(['session-a'])
    }),
  )

  it.effect('never reports an empty page when the content source failed and nothing else matched', () =>
    Effect.gen(function* () {
      const failing = yield* Effect.flip(
        find(deps({ records: [], content: Effect.fail(persistenceFailure('did not stabilize')) }), query({ query: 'nothing matches this' })),
      )
      expect(failing).toMatchObject({ _tag: 'FinderSearchUnavailable', code: 'SESSION_QUERY_PERSISTENCE_FAILED', attempts: 3 })
      const disabled = yield* Effect.flip(
        find(
          deps({ records: [], content: Effect.fail({ code: 'SESSION_QUERY_SEARCH_DISABLED', message: 'full-text search is disabled' }) }),
          query({ query: 'nothing matches this' }),
        ),
      )
      expect(disabled).toMatchObject({ _tag: 'FinderSearchUnavailable', code: 'SESSION_QUERY_SEARCH_DISABLED', attempts: 1 })
    }),
  )

  it.effect('rejects an empty query', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(find(deps({ records: [] }), query({ query: '   ' })))
      expect(failure).toMatchObject({ _tag: 'FinderInvalidRequest', reason: 'empty-query' })
    }),
  )

  it.effect('separates explicit fork lineage from labeled inferred candidates', () =>
    Effect.gen(function* () {
      const records = [
        record({ sessionId: 'session-parent', title: 'Original plan', project: '/dev/dshfiles', cwd: '/dev/dshfiles' }),
        record({ sessionId: 'session-seed', title: 'Thread search plan', project: '/dev/dshfiles', cwd: '/dev/dshfiles', parentSessionId: 'session-parent' }),
        record({
          sessionId: 'session-child',
          title: 'Thread search follow-up',
          project: '/dev/dshfiles',
          cwd: '/dev/dshfiles',
          parentSessionId: 'session-seed',
        }),
        record({ sessionId: 'session-workspace', title: 'Unrelated work in the same checkout', project: '/dev/dshfiles', cwd: '/dev/dshfiles' }),
        record({ sessionId: 'session-elsewhere', title: 'Thread search plan', project: '/dev/other', cwd: '/dev/other' }),
        record({ sessionId: 'session-unrelated', title: 'Kubernetes ingress rollout', project: '/dev/other', cwd: '/dev/other' }),
      ]
      const relations = yield* ThreadFinder.related({
        deps: deps({ records, digest: sessionId => (sessionId === 'session-seed' ? 'thread search finder retrieval' : null) }),
        query: { sessionId: 'session-seed', projects: [], limit: 5 },
      })
      expect(relations.seed.sessionId).toBe('session-seed')
      expect(relations.explicit.map(hit => hit.sessionId)).toEqual(['session-parent', 'session-child'])
      expect(relations.explicit.every(hit => hit.evidence.includes('explicit-lineage'))).toBe(true)
      const inferred = new Map(relations.inferred.map(hit => [hit.sessionId, hit.evidence]))
      expect(inferred.get('session-workspace')).toEqual(['shared-workspace'])
      expect(inferred.get('session-elsewhere')).toEqual(['topic-candidate'])
      expect(inferred.get('session-unrelated')).toBeUndefined()
      expect(relations.inferred.every(hit => !hit.evidence.includes('explicit-lineage'))).toBe(true)
    }),
  )

  it.effect('refuses related threads for a session outside the caller scope', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        ThreadFinder.related({
          deps: deps({ records: [record({ sessionId: 'session-other', project: '/dev/other' })] }),
          query: { sessionId: 'session-other', projects: ['/dev/dshfiles'], limit: 5 },
        }),
      )
      expect(failure).toMatchObject({ _tag: 'FinderSessionNotFound', sessionId: 'session-other' })
    }),
  )
})
