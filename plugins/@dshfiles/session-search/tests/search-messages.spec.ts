import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { findExpression } from '../src/find-query.js'
import type { DocumentRow, SearchIndex } from '../src/index-db.js'
import { withoutUndefined } from '../src/optional-fields.js'
import { runWithIndex } from './index-harness.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const openIndex = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-messages-'))
  roots.push(root)
  return join(root, 'index.sqlite')
}

type MessageInput = Partial<DocumentRow> & { readonly type: string; readonly text: string; readonly time: number }

const commit = (
  index: SearchIndex,
  input: {
    readonly sessionId: string
    readonly cwd?: string
    readonly parentSession?: string
    readonly delegationDepth?: number
    readonly documents: readonly MessageInput[]
  },
) => {
  const header = withoutUndefined({
    id: input.sessionId,
    version: 4,
    createdAt: 1,
    isSeeded: false,
    cwd: input.cwd,
    parentSession: input.parentSession,
    delegationDepth: input.delegationDepth,
  })
  return index.commitBatch({
    header,
    cursor: { logPath: `/logs/${input.sessionId}`, dev: '1', ino: input.sessionId, offset: 10, size: 10, mtimeNs: '1' },
    documents: input.documents.map((document, seq) => ({
      sessionId: input.sessionId,
      seq,
      surface: 'current',
      truncated: false,
      ...document,
    })),
    replace: false,
    now: 1,
  })
}

describe('SearchIndex.searchMessages', () => {
  it('leaves out user messages a plugin or agent sent, keeping typed prompts and legacy rows', async () => {
    const query = findExpression('basalt') ?? ''
    const found = await runWithIndex(await openIndex(), function* (index) {
      yield* commit(index, {
        sessionId: 'thread-typed',
        documents: [
          { type: 'user/message', text: 'Why is basalt slow?', time: 1, humanPrompt: true },
          { type: 'user/message', text: 'Scheduled basalt check from a plugin', time: 2, humanPrompt: false },
          { type: 'user/message', text: 'Legacy basalt prompt', time: 3 },
          { type: 'assistant/message', text: 'basalt answer', time: 4 },
        ],
      })
      return {
        user: yield* index.searchMessages({ query, role: 'user', limit: 20 }),
        all: yield* index.searchMessages({ query, role: 'all', limit: 20 }),
      }
    })

    expect(found.user.matches.map(match => match.seq).sort()).toEqual([0, 2])
    expect(found.all.matches.map(match => match.seq).sort()).toEqual([0, 2, 3])
  })

  it('searches only current user and assistant messages across top-level threads and filters by role', async () => {
    const query = findExpression('quartz') ?? ''
    const found = await runWithIndex(await openIndex(), function* (index) {
      yield* commit(index, {
        sessionId: 'thread-a',
        cwd: '/repo/alpha',
        documents: [
          { type: 'user/message', text: 'Please deploy the quartz worker', time: 10 },
          { type: 'tool/call', text: 'quartz deploy command', time: 11 },
          { type: 'tool/result', text: 'quartz exit code 0', time: 12 },
          { type: 'assistant/message', text: 'The quartz rollout finished cleanly', time: 13 },
          { type: 'assistant/message', surface: 'shadowed', text: 'quartz shadowed draft', time: 14 },
        ],
      })
      yield* commit(index, {
        sessionId: 'thread-child',
        parentSession: 'thread-a',
        delegationDepth: 1,
        documents: [{ type: 'assistant/message', text: 'quartz subagent report', time: 20 }],
      })
      yield* commit(index, {
        sessionId: 'thread-b',
        cwd: '/repo/beta',
        documents: [{ type: 'user/message', text: 'Check quartz metrics', time: 30 }],
      })
      const all = yield* index.searchMessages({ query, role: 'all', limit: 20 })
      const userOnly = yield* index.searchMessages({ query, role: 'user', limit: 20 })
      const assistantOnly = yield* index.searchMessages({ query, role: 'assistant', limit: 20 })
      return { all, userOnly, assistantOnly }
    })

    expect(found.all.hasMore).toBe(false)
    expect(found.all.matches.map(match => [match.sessionId, match.seq, match.role, match.cwd]).sort()).toEqual([
      ['thread-a', 0, 'user', '/repo/alpha'],
      ['thread-a', 3, 'assistant', '/repo/alpha'],
      ['thread-b', 0, 'user', '/repo/beta'],
    ])
    expect(found.userOnly.matches.map(match => [match.sessionId, match.seq, match.role]).sort()).toEqual([
      ['thread-a', 0, 'user'],
      ['thread-b', 0, 'user'],
    ])
    expect(found.assistantOnly.matches.map(match => [match.sessionId, match.seq, match.role])).toEqual([['thread-a', 3, 'assistant']])
  })

  it('caps matches per thread, reports hasMore, and works both before and after conversation backfill', async () => {
    const path = await openIndex()
    const query = findExpression('obsidian') ?? ''
    await runWithIndex(path, function* (index) {
      yield* commit(index, {
        sessionId: 'thread-busy',
        documents: [
          { type: 'user/message', text: 'obsidian one', time: 1 },
          { type: 'assistant/message', text: 'obsidian two', time: 2 },
          { type: 'user/message', text: 'obsidian three', time: 3 },
          { type: 'assistant/message', text: 'obsidian four', time: 4 },
          { type: 'tool/result', text: 'obsidian tool noise', time: 5 },
        ],
      })
      yield* commit(index, {
        sessionId: 'thread-other',
        documents: [{ type: 'assistant/message', text: 'obsidian other reply', time: 6 }],
      })
    })

    const raw = new DatabaseSync(path)
    raw.exec("DELETE FROM conversation_documents; DELETE FROM meta WHERE key LIKE 'conversation_%'")
    raw.close()

    const outcome = await runWithIndex(path, function* (index) {
      const before = yield* index.searchMessages({ query, role: 'all', limit: 10 })
      while (!(yield* index.backfillConversation(2))) {}
      const after = yield* index.searchMessages({ query, role: 'all', limit: 10 })
      const paged = yield* index.searchMessages({ query, role: 'all', limit: 2 })
      return { before, after, paged }
    })

    const busyBefore = outcome.before.matches.filter(match => match.sessionId === 'thread-busy')
    const busyAfter = outcome.after.matches.filter(match => match.sessionId === 'thread-busy')
    expect(busyBefore).toHaveLength(3)
    expect(busyAfter).toHaveLength(3)
    expect(outcome.after.matches).toHaveLength(4)
    expect(outcome.after.hasMore).toBe(false)
    expect(outcome.paged.matches).toHaveLength(2)
    expect(outcome.paged.hasMore).toBe(true)
  })
})
