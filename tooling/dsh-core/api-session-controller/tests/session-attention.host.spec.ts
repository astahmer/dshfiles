import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { describe, expect, it, vi } from 'vitest'
import { ApiSessionAttention } from '../src/attention-controller.ts'

class AttentionSessionQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is not configured in this test'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}

const harness = async (
  prepare?: (ctx: Context) => void,
): Promise<{ ctx: Context; attention: ApiSessionAttention; root: string }> => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-attention-host-'))
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(SessionStore)
  new AttentionSessionQuery(ctx)
  prepare?.(ctx)
  const attention = new ApiSessionAttention(ctx)
  await attention.ready
  return { ctx, attention, root }
}

describe('Host session attention', () => {
  it('reconstructs an unrecorded prompt watermark from the Session log', async () => {
    const sessionId = SessionId('attention-recovery-session')
    const { ctx, attention, root } = await harness((context) => {
      const session = context.sessions.create(sessionId, { meta: { cwd: '/tmp' } })
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'persisted prompt' }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
    })
    try {
      expect(attention.summary(sessionId)).toBeNull()
      await expect(attention.reconcile(sessionId)).resolves.toEqual({
        lastPromptSeq: 0,
        readThroughSeq: -1,
        snoozed: false,
        unread: true,
      })
      await expect(attention.reconcile(sessionId)).resolves.toEqual({
        lastPromptSeq: 0,
        readThroughSeq: -1,
        snoozed: false,
        unread: true,
      })
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('persists prompt watermarks and synchronizes read and snooze updates', async () => {
    const { ctx, attention, root } = await harness()
    try {
      const session = ctx.sessions.create(SessionId('attention-session'), { meta: { cwd: '/tmp' } })
      const updates: Array<{ sessionId: SessionId; lastPromptSeq: number | null; readThroughSeq: number; snoozed: boolean; unread: boolean }> = []
      ctx.on('api-session/attention', (sessionId, summary) => {
        updates.push({ sessionId, ...summary })
      })

      const initiallyRead = await attention.update({
        sessionId: session.id,
        action: { type: 'mark-read' },
      }, new AbortController().signal)
      expect(initiallyRead).toEqual({
        lastPromptSeq: null,
        readThroughSeq: -1,
        snoozed: false,
        unread: false,
      })
      expect(updates).toEqual([{ sessionId: session.id, ...initiallyRead }])

      const firstPromptSeq = session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'first prompt' }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' }).seq
      await vi.waitFor(() => expect(updates.at(-1)).toEqual({
        sessionId: session.id,
        lastPromptSeq: firstPromptSeq,
        readThroughSeq: -1,
        snoozed: false,
        unread: true,
      }))

      const read = await attention.update({
        sessionId: session.id,
        action: { type: 'mark-read' },
      }, new AbortController().signal)
      expect(read).toEqual({
        lastPromptSeq: firstPromptSeq,
        readThroughSeq: firstPromptSeq,
        snoozed: false,
        unread: false,
      })

      const snoozed = await attention.update({
        sessionId: session.id,
        action: { type: 'set-snoozed', snoozed: true },
      }, new AbortController().signal)
      expect(snoozed).toEqual({
        lastPromptSeq: firstPromptSeq,
        readThroughSeq: firstPromptSeq,
        snoozed: true,
        unread: false,
      })

      const secondPromptSeq = session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'second prompt' }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' }).seq
      await expect(ctx.sessions.flush(session)).resolves.toBe(true)
      expect(updates.at(-1)).toEqual({
        sessionId: session.id,
        lastPromptSeq: secondPromptSeq,
        readThroughSeq: firstPromptSeq,
        snoozed: true,
        unread: true,
      })
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
