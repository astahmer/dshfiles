import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { FtsQuery } from '../src/fts-query.js'
import type { SearchIndex } from '../src/index-db.js'
import { runWithIndex } from './index-harness.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const openIndex = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-fts-'))
  roots.push(root)
  return join(root, 'index.sqlite')
}

const commit = (index: SearchIndex, sessionId: string, texts: readonly string[]) =>
  index.commitBatch({
    header: { id: sessionId, version: 4, createdAt: 1, isSeeded: false },
    cursor: { logPath: `/logs/${sessionId}`, dev: '1', ino: sessionId, offset: 10, size: 10, mtimeNs: '1' },
    documents: texts.map((text, seq) => ({ sessionId, seq, time: seq, truncated: false, type: 'user/message', surface: 'current', text })),
    replace: false,
    now: 1,
  })

const seqsFor = (index: SearchIndex, query: string) =>
  Effect.map(index.searchEvents({ sessionId: 'session-a', query, limit: 20 }), result =>
    result.matches.map(match => match.seq).toSorted((left, right) => left - right),
  )

describe('FtsQuery.of', () => {
  it('quotes every word so punctuation and operators are searched, not parsed', () => {
    expect(FtsQuery.of("I can't find")).toBe('"I" "can\'t" "find"')
    expect(FtsQuery.of('deploy AND NEAR rollback')).toBe('"deploy" "AND" "NEAR" "rollback"')
    expect(FtsQuery.of('-fix col:value (a OR b)')).toBe('"-fix" "col:value" "(a" "OR" "b)"')
  })

  it('keeps a quoted phrase whole and doubles quotes inside a word', () => {
    expect(FtsQuery.of('"thread sidebar" inbox')).toBe('"thread sidebar" "inbox"')
    expect(FtsQuery.of('say"hi')).toBe('"say""hi"')
    expect(FtsQuery.of('"unclosed phrase')).toBe('"unclosed phrase"')
  })

  it('keeps a trailing * as a prefix search and drops text with nothing searchable', () => {
    expect(FtsQuery.of('migrat*')).toBe('"migrat" *')
    expect(FtsQuery.of('*')).toBeNull()
    expect(FtsQuery.of(`  " ' - *** ""  `)).toBeNull()
  })
})

describe('search with user text', () => {
  it('searches apostrophes, quotes and fts5 operators in user text literally', async () => {
    const filename = await openIndex()
    const found = await runWithIndex(filename, index =>
      Effect.gen(function* () {
        yield* commit(index, 'session-a', [
          "I can't find the inbox item anymore",
          'deploy AND rollback both failed',
          'the near-term plan: fix -flags and "quotes"',
          'migration stalled at step two',
        ])
        return {
          apostrophe: yield* seqsFor(index, "I can't find"),
          word: yield* seqsFor(index, "can't"),
          and: yield* seqsFor(index, 'deploy AND rollback'),
          near: yield* seqsFor(index, 'NEAR'),
          dash: yield* seqsFor(index, '-flags'),
          quoted: yield* seqsFor(index, '"quotes"'),
          unclosed: yield* seqsFor(index, 'say "unclosed'),
          prefix: yield* seqsFor(index, 'migrat*'),
          or: yield* seqsFor(index, 'OR'),
          nothing: yield* index.searchSessions({ query: '***', limit: 5 }),
          sessions: (yield* index.searchSessions({ query: "I can't find", limit: 5 })).matches.map(match => match.sessionId),
        }
      }),
    )
    expect(found).toMatchObject({
      apostrophe: [0],
      word: [0],
      and: [1],
      near: [2],
      dash: [2],
      quoted: [2],
      unclosed: [],
      prefix: [3],
      or: [],
      nothing: { matches: [], hasMore: false },
      sessions: ['session-a'],
    })
  })
})

describe('find in one session, newest first', () => {
  it('keeps the newest matches when asked, still in seq order', async () => {
    const filename = await openIndex()
    const found = await runWithIndex(filename, index =>
      Effect.gen(function* () {
        yield* commit(index, 'session-a', ['quartzite one', 'nothing', 'quartzite two', 'quartzite three', 'quartzite four'])
        const oldest = yield* index.findInSession({ sessionId: 'session-a', query: '"quartzite"', limit: 2 })
        const newest = yield* index.findInSession({ sessionId: 'session-a', query: '"quartzite"', limit: 2, newest: true })
        return { oldest, newest }
      }),
    )
    expect(found.oldest.matches.map(match => match.seq)).toEqual([0, 2])
    expect(found.oldest.hasMore).toBe(true)
    expect(found.newest.matches.map(match => match.seq)).toEqual([3, 4])
    expect(found.newest.hasMore).toBe(true)
  })
})
