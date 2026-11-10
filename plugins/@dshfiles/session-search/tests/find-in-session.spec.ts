import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findExpression } from '../src/find-query.js'
import type { SearchIndex } from '../src/index-db.js'
import { runWithIndex } from './index-harness.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const openIndex = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-find-'))
  roots.push(root)
  return join(root, 'index.sqlite')
}

const commit = (index: SearchIndex, sessionId: string, documents: readonly { readonly type: string; readonly surface: string; readonly text: string }[]) =>
  index.commitBatch({
    header: { id: sessionId, version: 4, createdAt: 1, isSeeded: false },
    cursor: { logPath: `/logs/${sessionId}`, dev: '1', ino: sessionId, offset: 10, size: 10, mtimeNs: '1' },
    documents: documents.map((document, seq) => ({ sessionId, seq, time: seq, truncated: false, ...document })),
    replace: false,
    now: 1,
  })

describe('findExpression', () => {
  it('quotes every word, keeps operators literal and matches the last word as a prefix', () => {
    expect(findExpression('retry storm')).toBe('"retry" "storm"*')
    expect(findExpression('  a "b" OR c  ')).toBe('"a" """b""" "OR" "c"*')
    expect(findExpression('foo.bar -')).toBe('"foo.bar"*')
  })

  it('refuses text without a searchable word', () => {
    expect(findExpression('')).toBeNull()
    expect(findExpression(' - * " ')).toBeNull()
  })
})

describe('SearchIndex.findInSession', () => {
  it('returns every matching current event of one Session in seq order, with a snippet', async () => {
    const path = await openIndex()
    const found = await runWithIndex(path, function* (index) {
      yield* commit(index, 'session-a', [
        { type: 'user/message', surface: 'current', text: 'Please investigate the quartz rollout.' },
        { type: 'assistant/thinking', surface: 'current', text: 'The quartz job retries forever.' },
        { type: 'tool/result', surface: 'current', text: 'nothing relevant here' },
        { type: 'tool/result', surface: 'shadowed', text: 'quartz in a rewound branch' },
        { type: 'assistant/message', surface: 'current', text: 'Fixed the quartzite retry loop.' },
      ])
      yield* commit(index, 'session-b', [{ type: 'user/message', surface: 'current', text: 'quartz elsewhere' }])
      return yield* index.findInSession({ sessionId: 'session-a', query: findExpression('quartz') ?? '', limit: 10 })
    })

    expect(found.hasMore).toBe(false)
    expect(found.matches.map(match => [match.seq, match.type])).toEqual([
      [0, 'user/message'],
      [1, 'assistant/thinking'],
      [4, 'assistant/message'],
    ])
    expect(found.matches[1]?.snippet).toBe('The quartz job retries forever.')
  })

  it('needs every word and reports more matches than the limit', async () => {
    const path = await openIndex()
    const outcome = await runWithIndex(path, function* (index) {
      yield* commit(
        index,
        'session-a',
        Array.from({ length: 5 }, (_, seq) => ({ type: 'assistant/message', surface: 'current', text: `step ${String(seq)} retry storm` })),
      )
      const page = yield* index.findInSession({ sessionId: 'session-a', query: findExpression('retry sto') ?? '', limit: 3 })
      const unrelated = yield* index.findInSession({ sessionId: 'session-a', query: findExpression('retry calm') ?? '', limit: 3 })
      return { page, unrelated }
    })

    expect(outcome.page.matches.map(match => match.seq)).toEqual([0, 1, 2])
    expect(outcome.page.hasMore).toBe(true)
    expect(outcome.unrelated.matches).toEqual([])
  })
})
