import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findExpression } from '../src/find-query.js'
import type { DocumentRow, SearchIndex } from '../src/index-db.js'
import { runWithIndex } from './index-harness.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const openIndex = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-history-'))
  roots.push(root)
  return join(root, 'index.sqlite')
}

type Prompt = Partial<DocumentRow> & { readonly text: string; readonly time: number }

const commit = (
  index: SearchIndex,
  input: { readonly sessionId: string; readonly delegationDepth?: number; readonly replace?: boolean; readonly documents: readonly Prompt[] },
) =>
  index.commitBatch({
    header: {
      id: input.sessionId,
      version: 4,
      createdAt: 1,
      isSeeded: false,
      ...(input.delegationDepth === undefined ? {} : { delegationDepth: input.delegationDepth }),
    },
    cursor: { logPath: `/logs/${input.sessionId}`, dev: '1', ino: input.sessionId, offset: 10, size: 10, mtimeNs: '1' },
    documents: input.documents.map((document, seq) => ({
      sessionId: input.sessionId,
      seq,
      type: 'user/message',
      surface: 'current',
      truncated: false,
      humanPrompt: true,
      ...document,
    })),
    replace: input.replace ?? false,
    now: 1,
  })

const request = { limit: 10, window: 100, maxChars: 1_000 }

describe('SearchIndex.promptHistory', () => {
  it('lists the prompts people sent across threads, newest first and each text once', async () => {
    const found = await runWithIndex(await openIndex(), function* (index) {
      yield* commit(index, {
        sessionId: 'thread-a',
        documents: [
          { text: 'Deploy the quartz service', time: 10 },
          { text: 'The assistant answer', time: 11, type: 'assistant/message' },
          { text: 'A child finished', time: 12, humanPrompt: false },
          { text: 'Deploy the quartz service', time: 30 },
        ],
      })
      yield* commit(index, { sessionId: 'thread-b', documents: [{ text: 'Review the release notes', time: 20 }] })
      yield* commit(index, { sessionId: 'child', delegationDepth: 1, documents: [{ text: 'Delegated task prompt', time: 40 }] })
      return yield* index.promptHistory(request)
    })

    expect(found.prompts.map(prompt => [prompt.sessionId, prompt.time, prompt.text])).toEqual([
      ['thread-a', 30, 'Deploy the quartz service'],
      ['thread-b', 20, 'Review the release notes'],
    ])
  })

  it('narrows to prompts holding every word, keeps only the newest window and skips oversized or truncated prompts', async () => {
    const found = await runWithIndex(await openIndex(), function* (index) {
      yield* commit(index, {
        sessionId: 'thread-a',
        documents: [
          { text: 'old quartz prompt', time: 1 },
          { text: 'quartz rollout plan', time: 2 },
          { text: `quartz ${'x'.repeat(2_000)}`, time: 3 },
          { text: 'quartz pasted log', time: 4, truncated: true },
          { text: 'unrelated question', time: 5 },
        ],
      })
      const matching = yield* index.promptHistory({ ...request, query: findExpression('quartz') ?? '' })
      const windowed = yield* index.promptHistory({ ...request, window: 2 })
      return { matching, windowed }
    })

    expect(found.matching.prompts.map(prompt => prompt.text)).toEqual(['quartz rollout plan', 'old quartz prompt'])
    expect(found.windowed.prompts.map(prompt => prompt.text)).toEqual(['unrelated question', 'quartz rollout plan'])
  })

  it('drops a thread’s prompts when the thread is reindexed or forgotten', async () => {
    const found = await runWithIndex(await openIndex(), function* (index) {
      yield* commit(index, { sessionId: 'thread-a', documents: [{ text: 'first wording', time: 1 }] })
      yield* commit(index, { sessionId: 'thread-a', replace: true, documents: [{ text: 'rewritten wording', time: 2 }] })
      yield* commit(index, { sessionId: 'thread-b', documents: [{ text: 'archived thread prompt', time: 3 }] })
      yield* index.forget('thread-b')
      return yield* index.promptHistory(request)
    })

    expect(found.prompts.map(prompt => prompt.text)).toEqual(['rewritten wording'])
  })
})
