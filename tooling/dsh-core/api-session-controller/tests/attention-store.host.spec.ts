import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { SessionAttentionStore } from '../src/attention-store.ts'

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
})
