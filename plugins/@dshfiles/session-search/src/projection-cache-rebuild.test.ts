import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectionCacheRebuild } from './projection-cache-rebuild.js'

const directories: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

// SAFETY: a stored header with every field the code under test reads; the rest of the header type is unused.
const headerOf = (id: string) => ({ id: SessionId(id), createdAt: 1, cwd: '/work', isSeeded: false, delegationDepth: 0, version: 4 }) as SessionHeader

interface Stored {
  readonly id: string
  readonly sizeBytes?: number
  readonly checkpointed?: boolean
  readonly live?: boolean
  readonly unreadable?: boolean
}

const setup = (stored: readonly Stored[]) => {
  const directory = mkdtempSync(join(tmpdir(), 'projcache-rebuild-'))
  directories.push(directory)
  const ctx = new Context()
  contexts.push(ctx)
  const byId = new Map(stored.map(entry => [entry.id, entry]))
  const folded: string[] = []
  const calls = { list: 0, close: 0, folded }
  const list = async () => {
    calls.list += 1
    return stored.map(entry => ({ header: headerOf(entry.id), revision: 'r', sizeBytes: entry.sizeBytes ?? 1_000 }))
  }
  const close = async () => {
    calls.close += 1
  }
  const open = async (id: string, access: string) => {
    if (access !== 'read') throw new Error('the rebuild must never take write ownership')
    if (byId.get(id)?.unreadable === true) throw new Error('corrupt log')
    return { header: headerOf(id), inheritedEventCount: 0, read: async () => ({ events: [{ seq: 0, type: 'user/message' }] }), close }
  }
  // SAFETY: the rebuild calls only `list` and `open` on persistence, `get` on the live registry, and the cache's
  // `cachedSnapshot` and `coldSnapshot`.
  ctx.provide('sessionPersistence', { list, open } as never)
  ctx.provide('sessions', { get: (id: string) => (byId.get(id)?.live === true ? {} : undefined) } as never)
  const coldSnapshot = (meta: SessionHeader) => {
    calls.folded.push(String(meta.id))
    return { sessionId: meta.id }
  }
  const cachedSnapshot = (meta: SessionHeader) => (byId.get(meta.id)?.checkpointed === true ? { asOfSeq: 0, values: {} } : undefined)
  ctx.provide('sessionProjectionCache', { cachedSnapshot, coldSnapshot } as never)
  const progressPath = join(directory, 'nested', 'checkpoint-rebuild.json')
  const run = () => Effect.runPromise(ProjectionCacheRebuild.run({ ctx, progressPath, pause: 0, maxLogBytes: 10_000 }).pipe(Effect.provide(platform)))
  return { run, calls, progressPath }
}

describe('the projection checkpoint rebuild', () => {
  it('folds only cold, bounded Sessions without a checkpoint, then never runs again', async () => {
    const { run, calls, progressPath } = setup([
      { id: 'missing' },
      { id: 'checkpointed', checkpointed: true },
      { id: 'too-large', sizeBytes: 20_000 },
      { id: 'live', live: true },
      { id: 'unreadable', unreadable: true },
      { id: 'missing-too' },
    ])

    await expect(run()).resolves.toEqual({ rebuilt: 2 })

    expect(calls.folded).toEqual(['missing', 'missing-too'])
    expect(calls.close).toBe(2)
    expect(JSON.parse(readFileSync(progressPath, 'utf8'))).toEqual({ complete: true, settled: [] })
    await expect(run()).resolves.toEqual({ rebuilt: 0 })
    expect(calls.list).toBe(1)
  })

  it('resumes after the Sessions an interrupted pass settled', async () => {
    const { run, calls, progressPath } = setup([{ id: 'settled-before' }, { id: 'left' }])
    mkdirSync(join(progressPath, '..'), { recursive: true })
    writeFileSync(progressPath, JSON.stringify({ complete: false, settled: ['settled-before'] }))

    await expect(run()).resolves.toEqual({ rebuilt: 1 })

    expect(calls.folded).toEqual(['left'])
  })
})
