import { statSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterAll, describe, expect, it } from 'vitest'

import { StreamIds } from '@dshfiles/optmem-core'

import { openSqliteMemory } from './sqlite-memory.ts'
import { createFakeSummarizer } from './testing/fake-summarizer.ts'
import { createTempDirectory, event, openEngine } from './testing/temp-memory.ts'

const temp = createTempDirectory()
afterAll(() => temp.cleanup())
const dbPath = (name: string): string => join(temp.directory, `${name}.db`)

describe('sqlite store', () => {
  it('appends, replays in order and ignores re-ingested events', async () => {
    const path = dbPath('replay')
    const { engine, memory } = await openEngine({ path, summarizer: createFakeSummarizer() })
    const inputs = [1, 2, 3].map(index => event({ conversationId: 'c1', projectId: 'p1', text: `message ${index}` }))
    const first = await engine.append(inputs)
    expect(first.inserted).toBe(3)
    const second = await engine.append(inputs)
    expect(second.inserted).toBe(0)
    expect(second.events.map(appended => appended.eventId)).toEqual(first.events.map(appended => appended.eventId))
    await engine.close()
    memory.close()

    const reopened = openSqliteMemory({ path })
    const replay = await reopened.store.readStream(StreamIds.conversation('c1'), 0, 10)
    expect(replay.map(entry => [entry.pos, entry.event.text])).toEqual([
      [0, 'message 1'],
      [1, 'message 2'],
      [2, 'message 3'],
    ])
    expect(await reopened.store.streamLength(StreamIds.project('p1'))).toBe(3)
    reopened.close()
  })

  it('keeps positions contiguous per stream with interleaved conversations and two connections', async () => {
    const path = dbPath('interleaved')
    const writers = [openSqliteMemory({ path }), openSqliteMemory({ path })]
    const conversations = ['a', 'b', 'c', 'd']
    await Promise.all(
      conversations.flatMap((conversationId, index) =>
        Array.from({ length: 25 }, (_unused, turn) => {
          const writer = writers[(index + turn) % 2]
          if (!writer) throw new Error('missing writer')
          return writer.store.appendEvents([
            {
              eventKey: `${conversationId}:${turn}`,
              harness: 'test',
              conversationId,
              projectId: 'shared',
              parentConversationId: null,
              role: 'user',
              createdAt: turn,
              text: `${conversationId} turn ${turn}`,
              bytes: 10,
              truncated: false,
              meta: {},
              streams: [StreamIds.conversation(conversationId), StreamIds.project('shared')],
            },
          ])
        }),
      ),
    )
    const reader = writers[0]
    if (!reader) throw new Error('missing reader')
    const project = await reader.store.readStream(StreamIds.project('shared'), 0, 1_000)
    expect(project.map(entry => entry.pos)).toEqual(Array.from({ length: 100 }, (_unused, pos) => pos))
    for (const conversationId of conversations) {
      const stream = await reader.store.readStream(StreamIds.conversation(conversationId), 0, 1_000)
      expect(stream.map(entry => entry.pos)).toEqual(Array.from({ length: 25 }, (_unused, pos) => pos))
      expect(stream.map(entry => entry.event.text)).toEqual(Array.from({ length: 25 }, (_unused, turn) => `${conversationId} turn ${turn}`))
    }
    for (const writer of writers) writer.close()
  })

  it('serializes writers from concurrent threads without gaps or duplicate positions', async () => {
    const path = dbPath('threads')
    openSqliteMemory({ path }).close()
    const conversations = ['w1', 'w2', 'w3']
    await Promise.all(
      conversations.map(
        conversationId =>
          new Promise<void>((resolve, reject) => {
            const worker = new Worker(new URL('./testing/append-worker.ts', import.meta.url), { workerData: { path, conversationId, count: 150 } })
            worker.once('error', reject)
            worker.once('exit', code => (code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`))))
          }),
      ),
    )
    const reader = openSqliteMemory({ path })
    const project = await reader.store.readStream(StreamIds.project('shared'), 0, 1_000)
    expect(project.map(entry => entry.pos)).toEqual(Array.from({ length: 450 }, (_unused, pos) => pos))
    for (const conversationId of conversations) {
      const texts = project.filter(entry => entry.event.conversationId === conversationId).map(entry => entry.event.text)
      expect(texts).toEqual(Array.from({ length: 150 }, (_unused, turn) => `${conversationId} turn ${turn}`))
    }
    reader.close()
  })

  it('creates the database private to the user and migrates idempotently', () => {
    const path = dbPath('private')
    openSqliteMemory({ path }).close()
    const reopened = openSqliteMemory({ path })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(reopened.database.prepare('PRAGMA user_version').get()?.['user_version']).toBe(1)
    expect(reopened.database.prepare('PRAGMA journal_mode').get()?.['journal_mode']).toBe('wal')
    reopened.close()
  })
})
