import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as Schema from 'effect/Schema'
import { findEventTypesSchema } from '../src/api-schemas.js'
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

describe('findEventTypesSchema', () => {
  it('keeps the set of event types open but refuses a bare word that would match nothing', () => {
    const accepts = (types: readonly string[]) => Schema.decodeUnknownResult(findEventTypesSchema)(types)._tag === 'Success'
    expect(accepts(['assistant/message', 'tool/call', 'todo/write'])).toBe(true)
    expect(accepts(['assistant'])).toBe(false)
    expect(accepts(['Tool/call'])).toBe(false)
    expect(accepts([])).toBe(false)
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

  it('filters matches by event type without tool calls crowding out assistant replies', async () => {
    const path = await openIndex()
    const outcome = await runWithIndex(path, function* (index) {
      yield* commit(index, 'session-a', [
        { type: 'user/message', surface: 'current', text: 'check quartz config' },
        { type: 'assistant/message', surface: 'current', text: 'quartz first reply' },
        { type: 'tool/call', surface: 'current', text: 'grep quartz src/' },
        { type: 'tool/result', surface: 'current', text: 'quartz match in tool output' },
        { type: 'assistant/message', surface: 'current', text: 'quartz final reply' },
        { type: 'tool/result', surface: 'current', text: 'trailing quartz tool result' },
      ])
      const assistantOnly = yield* index.findInSession({
        sessionId: 'session-a',
        query: findExpression('quartz') ?? '',
        limit: 1,
        newest: true,
        types: ['assistant/message'],
      })
      const toolsOnly = yield* index.findInSession({
        sessionId: 'session-a',
        query: findExpression('quartz') ?? '',
        limit: 10,
        types: ['tool/call', 'tool/result'],
      })
      const conversation = yield* index.findInSession({
        sessionId: 'session-a',
        query: findExpression('quartz') ?? '',
        limit: 10,
        types: ['user/message', 'assistant/message'],
      })
      return { assistantOnly, toolsOnly, conversation }
    })

    expect(outcome.assistantOnly.matches.map(match => [match.seq, match.type])).toEqual([[4, 'assistant/message']])
    expect(outcome.assistantOnly.hasMore).toBe(true)
    expect(outcome.toolsOnly.matches.map(match => [match.seq, match.type])).toEqual([
      [2, 'tool/call'],
      [3, 'tool/result'],
      [5, 'tool/result'],
    ])
    expect(outcome.conversation.matches.map(match => [match.seq, match.type])).toEqual([
      [0, 'user/message'],
      [1, 'assistant/message'],
      [4, 'assistant/message'],
    ])
  })

  it('reads the conversation table for message filters once it is backfilled, current surface only', async () => {
    const path = await openIndex()
    const outcome = await runWithIndex(path, function* (index) {
      yield* commit(index, 'session-a', [
        { type: 'user/message', surface: 'current', text: 'quartz question' },
        { type: 'assistant/message', surface: 'shadowed', text: 'quartz rewound reply' },
        { type: 'tool/result', surface: 'current', text: 'quartz tool output' },
        { type: 'assistant/message', surface: 'current', text: 'quartz answer' },
      ])
      yield* commit(index, 'session-b', [{ type: 'assistant/message', surface: 'current', text: 'quartz elsewhere' }])
      while (!(yield* index.backfillConversation(100))) {}
      const query = findExpression('quartz') ?? ''
      return {
        ready: yield* index.conversationReady(),
        assistant: yield* index.findInSession({ sessionId: 'session-a', query, limit: 10, types: ['assistant/message'] }),
        messages: yield* index.findInSession({
          sessionId: 'session-a',
          query,
          limit: 1,
          newest: true,
          types: ['assistant/message', 'user/message', 'user/message'],
        }),
        mixed: yield* index.findInSession({ sessionId: 'session-a', query, limit: 10, types: ['assistant/message', 'tool/result'] }),
      }
    })

    expect(outcome.ready).toBe(true)
    expect(outcome.assistant.matches.map(match => match.seq)).toEqual([3])
    expect(outcome.messages.matches.map(match => match.seq)).toEqual([3])
    expect(outcome.messages.hasMore).toBe(true)
    expect(outcome.mixed.matches.map(match => match.seq)).toEqual([2, 3])
  })
})
