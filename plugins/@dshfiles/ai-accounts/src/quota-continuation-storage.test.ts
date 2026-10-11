import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { createQuotaContinuationService, type QuotaFailureAgent } from './quota-continuation.js'

const sessionId = SessionId('quota-session')

const failureAgent: QuotaFailureAgent = {
  id: sessionId,
  session: { seq: 12 },
  inbox: { nextTurn: [], nextStep: [] },
}

const openContext = async (root: string) => {
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root })
  await context.plugin(StorageDomain, { backend: 'json' })
  return context
}

describe('quota continuation storage', () => {
  it('recovers an unknown-reset continuation after Host storage reopens', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-quota-continuation-'))
    let firstContext: Context | undefined
    let firstService: ReturnType<typeof createQuotaContinuationService> | undefined
    let secondContext: Context | undefined
    let secondService: ReturnType<typeof createQuotaContinuationService> | undefined

    try {
      firstContext = await openContext(root)
      firstService = createQuotaContinuationService({ context: firstContext, readResetAt: async () => null })
      await firstService.recordFailure(failureAgent, 'codex_work', false)
      const firstResult = await firstService.list()
      expect(firstResult).toMatchObject({
        scheduleAvailable: false,
        continuations: [
          {
            sessionId,
            accountId: 'codex_work',
            resetAt: null,
            state: 'waiting',
            scheduled: false,
            ready: false,
          },
        ],
      })
      const [stored] = firstResult.continuations
      expect(stored).toBeDefined()

      await firstService.close()
      firstService = undefined
      await firstContext.fiber.dispose()
      firstContext = undefined

      secondContext = await openContext(root)
      secondService = createQuotaContinuationService({ context: secondContext, readResetAt: async () => null })
      await expect(secondService.list()).resolves.toMatchObject({
        scheduleAvailable: false,
        continuations: [
          {
            continuationId: stored?.continuationId,
            sessionId,
            accountId: 'codex_work',
            resetAt: null,
            state: 'waiting',
            scheduled: false,
            ready: false,
          },
        ],
      })
    } finally {
      await secondService?.close()
      await secondContext?.fiber.dispose()
      await firstService?.close()
      await firstContext?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps snooze separate and invalidates recovery when the Session is stopped for archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-quota-continuation-stop-'))
    let context: Context | undefined
    let service: ReturnType<typeof createQuotaContinuationService> | undefined
    let stop: (() => void) | undefined

    try {
      context = await openContext(root)
      service = createQuotaContinuationService({ context, readResetAt: async () => null })
      stop = service.start()
      await service.recordFailure(failureAgent, 'codex_work', false)
      const [record] = (await service.list()).continuations
      expect(record).toBeDefined()
      if (record === undefined) throw new Error('Quota continuation was not stored.')

      expect(await service.snooze(record.continuationId, 'one-hour')).toEqual({ updated: true })
      const [snoozed] = (await service.list()).continuations
      expect(snoozed?.snoozedUntil).toBeGreaterThan(Date.now())
      expect(snoozed?.resetAt).toBeNull()

      expect(await service.snooze(record.continuationId, 'unsnooze')).toEqual({ updated: true })
      expect((await service.list()).continuations[0]?.snoozedUntil).toBeNull()

      await context.parallel('workspace/session-stop', { sessionId })
      await expect(service.list()).resolves.toMatchObject({ continuations: [] })
    } finally {
      stop?.()
      await service?.close()
      await context?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
