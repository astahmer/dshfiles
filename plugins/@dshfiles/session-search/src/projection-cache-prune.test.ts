import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectionCachePrune } from './projection-cache-prune.js'

const directories: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

// SAFETY: a stored header with every field the code under test reads; the rest of the header type is unused.
const headerOf = (id: string) => ({ id: SessionId(id), createdAt: 1, cwd: '/work', isSeeded: false, delegationDepth: 0, version: 4 }) as SessionHeader

const scratch = (names: readonly string[]): string => {
  const directory = mkdtempSync(join(tmpdir(), 'projcache-'))
  directories.push(directory)
  const root = join(directory, 'sessions')
  mkdirSync(root, { recursive: true })
  for (const name of names) writeFileSync(join(root, name), '{"version":7,"record":{}}')
  return root
}

/** Persistence that lists `listed`, and whose stat also sees `createdLater`, a Session created after the listing. */
const contextWith = (input: { readonly listed: readonly string[]; readonly createdLater?: string; readonly live?: string }) => {
  const ctx = new Context()
  contexts.push(ctx)
  const snapshot = (id: string) => ({ header: headerOf(id), revision: 'r', sizeBytes: 1 })
  // SAFETY: the prune calls only `list` and `stat` on persistence and `get` on the live registry.
  ctx.provide('sessionPersistence', {
    list: async () => input.listed.map(snapshot),
    stat: async (id: string) => (input.listed.includes(id) || id === input.createdLater ? snapshot(id) : undefined),
  } as never)
  ctx.provide('sessions', { get: (id: string) => (id === input.live ? {} : undefined) } as never)
  return ctx
}

describe('the projection cache prune', () => {
  it('drops only checkpoints whose Session no longer exists, whatever their age', async () => {
    const root = scratch(['stored.json', 'orphan.json', 'live.json', 'created-later.json'])
    const ctx = contextWith({ listed: ['stored'], createdLater: 'created-later', live: 'live' })

    const removed = await Effect.runPromise(ProjectionCachePrune.orphans({ ctx, root }).pipe(Effect.provide(platform)))

    expect(removed).toBe(1)
    expect(readdirSync(root).sort()).toEqual(['created-later.json', 'live.json', 'stored.json'])
  })

  it('keeps everything when the directory is missing', async () => {
    const ctx = contextWith({ listed: [] })
    const root = join(tmpdir(), 'no-such-projcache-dir')

    await expect(Effect.runPromise(ProjectionCachePrune.orphans({ ctx, root }).pipe(Effect.provide(platform)))).resolves.toBe(0)
  })
})
