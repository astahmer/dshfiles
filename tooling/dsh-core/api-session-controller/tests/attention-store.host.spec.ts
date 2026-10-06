import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { SessionAttentionStore } from '../src/attention-store.ts'

const legacySessionAttentionDomainSpec = StorageDomain.defineDomain({
  name: 'dsh_api_session_attention',
  version: 1,
  layout: 'per-record',
  tables: {
    sessions: StorageDomain.domainTable(z.object({
      lastPromptSeq: z.number().int().nonnegative().nullable(),
      readThroughSeq: z.number().int().min(-1),
      snoozed: z.boolean(),
    }).strict()),
  },
})

const openStore = async (root: string): Promise<{ ctx: Context; store: SessionAttentionStore }> => {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const store = new SessionAttentionStore()
  await store.open(ctx.storageDomain)
  return { ctx, store }
}

describe('SessionAttentionStore', () => {
  it('serializes concurrent updates and restores unread and snoozed state after reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-attention-'))
    const sessionId = SessionId('attention-session')
    let first: Awaited<ReturnType<typeof openStore>> | undefined
    let second: Awaited<ReturnType<typeof openStore>> | undefined
    try {
      first = await openStore(root)
      await Promise.all([
        first.store.notePrompt(sessionId, 7),
        first.store.setSnoozed(sessionId, true),
        first.store.markRead(sessionId, 5),
      ])
      expect(first.store.summary(sessionId)).toEqual({
        lastPromptSeq: 7,
        readThroughSeq: 5,
        snoozed: true,
        unread: true,
      })

      await first.store.markRead(sessionId, 7)
      await first.store.notePrompt(sessionId, 11)
      expect(first.store.summary(sessionId)).toEqual({
        lastPromptSeq: 11,
        readThroughSeq: 7,
        snoozed: true,
        unread: true,
      })
      await first.store.close()
      await first.ctx.fiber.dispose()
      first = undefined

      second = await openStore(root)
      expect(second.store.summary(sessionId)).toEqual({
        lastPromptSeq: 11,
        readThroughSeq: 7,
        snoozed: true,
        unread: true,
      })
      await second.store.setSnoozed(sessionId, false)
      await second.store.markRead(sessionId, 11)
      expect(second.store.summary(sessionId)).toEqual({
        lastPromptSeq: 11,
        readThroughSeq: 11,
        snoozed: false,
        unread: false,
      })
    } finally {
      await first?.store.close()
      await first?.ctx.fiber.dispose()
      await second?.store.close()
      await second?.ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('opens existing version 1 attention rows and stamps reconciled writes as version 2', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-attention-v1-'))
    const sessionId = SessionId('attention-v1-session')
    let current: Awaited<ReturnType<typeof openStore>> | undefined
    try {
      const legacyContext = new Context()
      await legacyContext.plugin(Storage)
      await legacyContext.plugin(StorageJson, { root })
      await legacyContext.plugin(StorageDomain, { backend: 'json' })
      try {
        const legacyDomain = await legacyContext.storageDomain.open(legacySessionAttentionDomainSpec)
        try {
          await legacyDomain.table('sessions').put(sessionId, {
            lastPromptSeq: 7,
            readThroughSeq: 4,
            snoozed: true,
          })
        } finally {
          await legacyDomain.close()
        }
      } finally {
        await legacyContext.fiber.dispose()
      }

      current = await openStore(root)
      expect(current.store.summary(sessionId)).toEqual({
        lastPromptSeq: 7,
        readThroughSeq: 4,
        snoozed: true,
        unread: true,
      })
      expect(current.store.reconciliationCursor(sessionId)).toBe(-1)

      await current.store.reconcile(sessionId, -1, 9, [9])
      expect(current.store.summary(sessionId)).toEqual({
        lastPromptSeq: 9,
        readThroughSeq: 4,
        snoozed: true,
        unread: true,
      })
      const recordDocument = z.object({
        version: z.number().int(),
        record: z.unknown(),
      }).parse(JSON.parse(await readFile(join(
        root,
        'dsh_api_session_attention',
        'sessions',
        `${sessionId}.json`,
      ), 'utf8')))
      expect(recordDocument.version).toBe(2)
    } finally {
      await current?.store.close()
      await current?.ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reconciles missed prompts and resets stale watermarks to the current log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-attention-reconcile-'))
    const sessionId = SessionId('attention-reconcile-session')
    const { ctx, store } = await openStore(root)
    try {
      await store.reconcile(sessionId, -1, 8, [3, 8])
      await store.markRead(sessionId, 6)
      expect(store.summary(sessionId)).toEqual({
        lastPromptSeq: 8,
        readThroughSeq: 6,
        snoozed: false,
        unread: true,
      })

      await store.reconcile(sessionId, 8, 4, [1, 4])
      expect(store.summary(sessionId)).toEqual({
        lastPromptSeq: 4,
        readThroughSeq: 4,
        snoozed: false,
        unread: false,
      })
    } finally {
      await store.close()
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves a newer prompt written while an older observation is being reconciled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-attention-race-'))
    const sessionId = SessionId('attention-race-session')
    const { ctx, store } = await openStore(root)
    try {
      await store.reconcile(sessionId, -1, 5, [5])
      await store.notePrompt(sessionId, 7)

      await store.reconcile(sessionId, 5, 6, [6])
      expect(store.summary(sessionId)).toEqual({
        lastPromptSeq: 7,
        readThroughSeq: -1,
        snoozed: false,
        unread: true,
      })
    } finally {
      await store.close()
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
