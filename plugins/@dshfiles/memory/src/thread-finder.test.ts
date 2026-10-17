import { describe, expect, it } from 'vitest'

import { createThreadFinder, ThreadFinderError, type ThreadFinderMemoryHit, type ThreadFinderRecord, type ThreadFinderSource } from './thread-finder.ts'

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

type ContentReply = { readonly sessionId: string; readonly snippet: string }

const finder = (options: {
  readonly records: readonly ThreadFinderRecord[]
  readonly content?: () => Promise<{ readonly hits: readonly ContentReply[]; readonly hasMore: boolean }>
  readonly memory?: readonly ThreadFinderMemoryHit[]
  readonly digest?: (sessionId: string) => string | null
}) =>
  createThreadFinder({
    listSessions: async () => options.records,
    searchContent: options.content ?? (async () => ({ hits: [], hasMore: false })),
    searchMemory: async () => options.memory ?? [],
    readDigest: async sessionId => options.digest?.(sessionId) ?? null,
    now: () => now,
    correlationId: () => 'test-correlation',
    retry: { attempts: 3, delaysMs: [0, 0, 0], sleep: async () => {} },
  })

const titles = (...sources: readonly (readonly ThreadFinderSource[])[]): readonly string[] => sources.flat().sort()

describe('thread finder', () => {
  it('ranks an exact title above every weaker match and names its source and evidence', async () => {
    const page = await finder({
      records: [
        record({ sessionId: 'session-a', title: 'Session search and thread finder', updatedAt: now - 10_000 }),
        record({ sessionId: 'session-b', title: 'Session search notes', updatedAt: now }),
      ],
    }).find({ query: 'Session search and thread finder', projects: [], ownProject: '/dev/dshfiles', limit: 5 })
    expect(page.hits.map(hit => hit.sessionId)).toEqual(['session-a', 'session-b'])
    expect(page.hits[0]?.evidence).toEqual(['exact-title'])
    expect(page.hits[0]?.sources).toEqual(['session-title'])
    expect(page.hits[1]?.evidence).toEqual(['title-match'])
    expect(page.diagnostics.incomplete).toBe(false)
    expect(page.degraded).toEqual([])
  })

  it('finds a thread by a repository or workspace identifier in its cwd', async () => {
    const page = await finder({
      records: [
        record({ sessionId: 'session-a', title: 'Rebase work', cwd: '/Users/astahmer/dev/dshfiles-threads/thread-992924' }),
        record({ sessionId: 'session-b', title: 'Unrelated', cwd: '/Users/astahmer/dev/other' }),
      ],
    }).find({ query: 'thread-992924', projects: [], ownProject: '/dev/dshfiles', limit: 5 })
    expect(page.hits.map(hit => hit.sessionId)).toEqual(['session-a'])
    expect(page.hits[0]?.evidence).toEqual(['identifier'])
    expect(page.hits[0]?.sources).toEqual(['session-metadata'])
  })

  it('finds a natural phrase in a user message through session content', async () => {
    const page = await finder({
      records: [record({ sessionId: 'session-a', title: 'Plugin audit' })],
      content: async () => ({ hits: [{ sessionId: 'session-a', snippet: '…so I started another thread mentioning it' }], hasMore: false }),
    }).find({ query: 'another thread mentioning it', projects: [], ownProject: '/dev/dshfiles', limit: 5 })
    expect(page.hits[0]?.sources).toEqual(['session-content'])
    expect(page.hits[0]?.evidence).toEqual(['text-match'])
    expect(page.hits[0]?.snippet).toBe('…so I started another thread mentioning it')
  })

  it('returns one hit for a session found by two sources, keeping both provenances', async () => {
    const page = await finder({
      records: [record({ sessionId: 'session-a', title: 'Memory search ranking' })],
      content: async () => ({ hits: [{ sessionId: 'session-a', snippet: 'ranking the memory search hits' }], hasMore: false }),
    }).find({ query: 'memory search ranking', projects: [], ownProject: '/dev/dshfiles', limit: 5 })
    expect(page.hits).toHaveLength(1)
    expect(titles(page.hits[0]?.sources ?? [])).toEqual(['session-content', 'session-title'])
    expect(page.hits[0]?.evidence).toEqual(['exact-title', 'text-match'])
  })

  it('keeps ambiguous same-topic threads apart with a deterministic order', async () => {
    const records = [
      record({ sessionId: 'session-b', title: 'Thread search plan', updatedAt: now - 1_000 }),
      record({ sessionId: 'session-a', title: 'Thread search plan', updatedAt: now - 1_000 }),
      record({ sessionId: 'session-c', title: 'Thread search plan', updatedAt: now - 5_000 }),
    ]
    const query = { query: 'thread search plan', projects: [], ownProject: '/dev/dshfiles', limit: 5 }
    const first = await finder({ records }).find(query)
    const second = await finder({ records: [...records].reverse() }).find(query)
    expect(first.hits.map(hit => hit.sessionId)).toEqual(['session-a', 'session-b', 'session-c'])
    expect(second.hits.map(hit => hit.sessionId)).toEqual(['session-a', 'session-b', 'session-c'])
  })

  it('merges a memory digest hit into the session it belongs to', async () => {
    const page = await finder({
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
    }).find({ query: 'retry storm', projects: [], ownProject: '/dev/dshfiles', limit: 5 })
    expect(page.hits.map(hit => hit.sessionId)).toEqual(['session-a'])
    expect(page.hits[0]?.sources).toEqual(['memory-digest'])
    expect(page.hits[0]?.evidence).toEqual(['digest-match'])
    expect(page.diagnostics.sources).toContain('memory-digest')
  })

  it('returns notes only when asked, labeled apart from the thread hits', async () => {
    const memory: ThreadFinderMemoryHit[] = [
      { kind: 'note', noteId: 7, project: '/dev/dshfiles', updatedAt: now, text: 'the retry cap is 4', sourceThread: 'session-a', score: 2 },
    ]
    const silent = await finder({ records: [], memory }).find({ query: 'retry cap', projects: [], ownProject: '/dev/dshfiles', limit: 5 })
    expect(silent.notes).toEqual([])
    const labeled = await finder({ records: [], memory }).find({ query: 'retry cap', projects: [], ownProject: '/dev/dshfiles', limit: 5, includeNotes: true })
    expect(labeled.notes.map(note => note.noteId)).toEqual([7])
    expect(labeled.notes[0]?.sourceThread).toBe('session-a')
  })

  it('applies project, availability and creation-date filters before ranking', async () => {
    const records = [
      record({ sessionId: 'session-live', title: 'alpha', live: true, persisted: true, project: '/dev/dshfiles', createdAt: now - 1_000 }),
      record({ sessionId: 'session-cold', title: 'alpha', live: false, persisted: true, project: '/dev/dshfiles', createdAt: now - 10 * 86_400_000 }),
      record({ sessionId: 'session-other', title: 'alpha', project: '/dev/other', createdAt: now - 1_000 }),
    ]
    const live = await finder({ records }).find({ query: 'alpha', projects: ['/dev/dshfiles'], ownProject: '/dev/dshfiles', limit: 5, availability: ['live'] })
    expect(live.hits.map(hit => hit.sessionId)).toEqual(['session-live'])
    const recent = await finder({ records }).find({
      query: 'alpha',
      projects: ['/dev/dshfiles'],
      ownProject: '/dev/dshfiles',
      limit: 5,
      createdFrom: now - 2 * 86_400_000,
    })
    expect(recent.hits.map(hit => hit.sessionId)).toEqual(['session-live'])
    const scoped = await finder({ records }).find({ query: 'alpha', projects: ['/dev/other'], ownProject: '/dev/other', limit: 5 })
    expect(scoped.hits.map(hit => hit.sessionId)).toEqual(['session-other'])
  })

  it('pages with a cursor and refuses one issued against a different corpus', async () => {
    const records = [record({ sessionId: 'session-a', title: 'alpha' }), record({ sessionId: 'session-b', title: 'alpha' })]
    const first = await finder({ records }).find({ query: 'alpha', projects: [], ownProject: '/dev/dshfiles', limit: 1 })
    expect(first.hits.map(hit => hit.sessionId)).toEqual(['session-a'])
    expect(first.nextCursor).not.toBeNull()
    const second = await finder({ records }).find({
      query: 'alpha',
      projects: [],
      ownProject: '/dev/dshfiles',
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    })
    expect(second.hits.map(hit => hit.sessionId)).toEqual(['session-b'])
    expect(second.nextCursor).toBeNull()
    const grown = [...records, record({ sessionId: 'session-c', title: 'alpha', updatedAt: now })]
    await expect(
      finder({ records: grown }).find({ query: 'alpha', projects: [], ownProject: '/dev/dshfiles', limit: 1, cursor: first.nextCursor ?? undefined }),
    ).rejects.toMatchObject({ code: 'stale-cursor' })
    await expect(
      finder({ records }).find({ query: 'alpha', projects: [], ownProject: '/dev/dshfiles', limit: 1, cursor: 'not-a-cursor' }),
    ).rejects.toBeInstanceOf(ThreadFinderError)
  })

  it('retries the transient observation failure and returns complete results', async () => {
    let calls = 0
    const page = await finder({
      records: [record({ sessionId: 'session-a', title: 'unrelated title' })],
      content: async () => {
        calls += 1
        if (calls < 3)
          throw Object.assign(new Error('session-search persistence observation did not stabilize after one retry'), {
            code: 'SESSION_QUERY_PERSISTENCE_FAILED',
          })
        return { hits: [{ sessionId: 'session-a', snippet: 'the phrase you remember' }], hasMore: false }
      },
    }).find({ query: 'the phrase you remember', projects: [], ownProject: '/dev/dshfiles', limit: 5 })
    expect(calls).toBe(3)
    expect(page.degraded).toEqual([])
    expect(page.diagnostics.incomplete).toBe(false)
    expect(page.hits.map(hit => hit.sessionId)).toEqual(['session-a'])
  })

  it('labels a degraded page instead of pretending it is complete', async () => {
    const page = await finder({
      records: [record({ sessionId: 'session-a', title: 'thread finder plan' })],
      content: async () => {
        throw Object.assign(new Error('did not stabilize'), { code: 'SESSION_QUERY_PERSISTENCE_FAILED' })
      },
    }).find({ query: 'thread finder plan', projects: [], ownProject: '/dev/dshfiles', limit: 5 })
    expect(page.degraded).toEqual([
      {
        source: 'session-content',
        code: 'SESSION_QUERY_PERSISTENCE_FAILED',
        message: 'did not stabilize',
        attempts: 3,
        elapsedMs: 0,
      },
    ])
    expect(page.diagnostics.incomplete).toBe(true)
    expect(page.diagnostics.attempts).toBe(3)
    expect(page.hits.map(hit => hit.sessionId)).toEqual(['session-a'])
  })

  it('never reports an empty page when the content source failed and nothing else matched', async () => {
    const failing = () =>
      finder({
        records: [],
        content: async () => {
          throw Object.assign(new Error('did not stabilize'), { code: 'SESSION_QUERY_PERSISTENCE_FAILED' })
        },
      }).find({ query: 'nothing matches this', projects: [], ownProject: '/dev/dshfiles', limit: 5 })
    await expect(failing()).rejects.toMatchObject({ code: 'search-unavailable' })
    const disabled = finder({
      records: [],
      content: async () => {
        throw Object.assign(new Error('full-text search is disabled'), { code: 'SESSION_QUERY_SEARCH_DISABLED' })
      },
    })
    await expect(disabled.find({ query: 'nothing matches this', projects: [], ownProject: '/dev/dshfiles', limit: 5 })).rejects.toMatchObject({
      code: 'search-unavailable',
    })
  })

  it('rejects an empty query', async () => {
    await expect(finder({ records: [] }).find({ query: '   ', projects: [], ownProject: '/dev/dshfiles', limit: 5 })).rejects.toMatchObject({
      code: 'invalid-request',
    })
  })

  it('separates explicit fork lineage from labeled inferred candidates', async () => {
    const records = [
      record({ sessionId: 'session-parent', title: 'Original plan', project: '/dev/dshfiles', cwd: '/dev/dshfiles' }),
      record({ sessionId: 'session-seed', title: 'Thread search plan', project: '/dev/dshfiles', cwd: '/dev/dshfiles', parentSessionId: 'session-parent' }),
      record({ sessionId: 'session-child', title: 'Thread search follow-up', project: '/dev/dshfiles', cwd: '/dev/dshfiles', parentSessionId: 'session-seed' }),
      record({ sessionId: 'session-workspace', title: 'Unrelated work in the same checkout', project: '/dev/dshfiles', cwd: '/dev/dshfiles' }),
      record({ sessionId: 'session-elsewhere', title: 'Thread search plan', project: '/dev/other', cwd: '/dev/other' }),
      record({ sessionId: 'session-unrelated', title: 'Kubernetes ingress rollout', project: '/dev/other', cwd: '/dev/other' }),
    ]
    const relations = await finder({ records, digest: sessionId => (sessionId === 'session-seed' ? 'thread search finder retrieval' : null) }).related({
      sessionId: 'session-seed',
      projects: [],
      limit: 5,
    })
    expect(relations.seed.sessionId).toBe('session-seed')
    expect(relations.explicit.map(hit => hit.sessionId)).toEqual(['session-parent', 'session-child'])
    expect(relations.explicit.every(hit => hit.evidence.includes('explicit-lineage'))).toBe(true)
    const inferred = new Map(relations.inferred.map(hit => [hit.sessionId, hit.evidence]))
    expect(inferred.get('session-workspace')).toEqual(['shared-workspace'])
    expect(inferred.get('session-elsewhere')).toEqual(['topic-candidate'])
    expect(inferred.get('session-unrelated')).toBeUndefined()
    expect(relations.inferred.every(hit => !hit.evidence.includes('explicit-lineage'))).toBe(true)
  })

  it('refuses related threads for a session outside the caller scope', async () => {
    const scope = finder({ records: [record({ sessionId: 'session-other', project: '/dev/other' })] })
    await expect(scope.related({ sessionId: 'session-other', projects: ['/dev/dshfiles'], limit: 5 })).rejects.toMatchObject({ code: 'not-found' })
  })
})
