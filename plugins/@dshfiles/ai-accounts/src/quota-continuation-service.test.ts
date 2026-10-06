import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { ScheduleId, createAfterScheduleRecord } from '@deepseek-ai/dsh-schedule'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { createQuotaContinuationService, type QuotaFailureAgent } from './quota-continuation.js'
import { promptFor } from './quota-continuation-message.js'

type SchedulePort = Pick<NonNullable<Context['schedule']>, 'create' | 'delete' | 'list'>
type ScheduleCreateRequest = Parameters<NonNullable<Context['schedule']>['create']>[1]
type ScheduleRecord = Awaited<ReturnType<NonNullable<Context['schedule']>['create']>>
type SessionPromptRequest = Parameters<NonNullable<Context['sessionController']>['prompt']>[0]

const openContext = async (root: string) => {
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root })
  await context.plugin(StorageDomain, { backend: 'json' })
  return context
}

const createFailureAgent = (id: string): QuotaFailureAgent => ({
  id: SessionId(id),
  session: { seq: 12 },
  inbox: { nextTurn: [], nextStep: [] },
})

const createScheduleFixture = (now: () => number) => {
  const rows = new Map<string, ScheduleRecord[]>()
  const requests: ScheduleCreateRequest[] = []
  let nextId = 0

  const schedule: SchedulePort = {
    create: async (sessionId, request) => {
      const afterSeconds = request.after_seconds
      if (afterSeconds === undefined) throw new Error('Quota recovery must use a relative one-shot schedule.')
      requests.push(request)
      const record = createAfterScheduleRecord(
        ScheduleId(`quota-${++nextId}`),
        request.prompt,
        afterSeconds,
        now(),
        request.title,
      )
      rows.set(sessionId, [...(rows.get(sessionId) ?? []), record])
      return record
    },
    delete: async ({ sessionId, id }) => {
      const previous = rows.get(sessionId) ?? []
      const next = previous.filter(record => record.id !== id)
      if (previous.length === next.length) return { id, deleted: false, code: 'schedule_not_found' }
      rows.set(sessionId, next)
      return { id, deleted: true }
    },
    list: async ({ sessionId }) => rows.get(sessionId) ?? [],
  }

  return { schedule, requests, rows }
}

describe('quota continuation service', () => {
  it('schedules a known reset and rebuilds a missing Host task after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-quota-restart-'))
    const now = () => 1_000_000
    const resetAt = now() + 60_000
    const sessionId = SessionId('quota-known-session')
    const agent = createFailureAgent(sessionId)
    const scheduler = createScheduleFixture(now)
    let firstContext: Context | undefined
    let firstService: ReturnType<typeof createQuotaContinuationService> | undefined
    let secondContext: Context | undefined
    let secondService: ReturnType<typeof createQuotaContinuationService> | undefined
    let stopSecond: (() => void) | undefined

    try {
      firstContext = await openContext(root)
      firstService = createQuotaContinuationService({
        context: firstContext,
        readResetAt: async () => resetAt,
        schedule: scheduler.schedule,
        now,
      })
      await firstService.recordFailure(agent, 'codex_work')
      const [record] = (await firstService.list()).continuations
      expect(record).toBeDefined()
      if (record === undefined) throw new Error('Quota continuation was not stored.')
      expect(scheduler.requests[0]?.after_seconds).toBe(60)

      await firstService.snooze(record.continuationId, 'one-hour')
      expect(scheduler.requests[1]?.after_seconds).toBe(3_600)
      expect(scheduler.rows.get(sessionId)).toHaveLength(1)

      await firstService.close()
      firstService = undefined
      await firstContext.fiber.dispose()
      firstContext = undefined
      scheduler.rows.delete(sessionId)

      secondContext = await openContext(root)
      secondService = createQuotaContinuationService({
        context: secondContext,
        readResetAt: async () => null,
        schedule: scheduler.schedule,
        now,
      })
      stopSecond = secondService.start()
      await secondService.list()
      await setImmediate()

      const recovered = await secondService.list()
      expect(recovered).toMatchObject({
        scheduleAvailable: true,
        continuations: [{
          continuationId: record.continuationId,
          state: 'waiting',
          resetAt,
          snoozedUntil: now() + 3_600_000,
          scheduled: true,
        }],
      })
      expect(scheduler.requests).toHaveLength(3)
      expect(scheduler.requests[2]?.after_seconds).toBe(3_600)
      expect(scheduler.rows.get(sessionId)).toHaveLength(1)
    } finally {
      stopSecond?.()
      await secondService?.close()
      await secondContext?.fiber.dispose()
      await firstService?.close()
      await firstContext?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps unknown resets manual and queues one stable request through Session Controller', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-quota-manual-'))
    const now = () => 2_000_000
    const sessionId = SessionId('quota-manual-session')
    const prompts: SessionPromptRequest[] = []
    const scheduler = createScheduleFixture(now)
    const sessionController = {
      inspect: async () => ({ events: [] }),
      prompt: async (request: SessionPromptRequest) => {
        prompts.push(request)
        return { accepted: true as const }
      },
    }
    let context: Context | undefined
    let service: ReturnType<typeof createQuotaContinuationService> | undefined

    try {
      context = await openContext(root)
      service = createQuotaContinuationService({
        context,
        readResetAt: async () => null,
        schedule: scheduler.schedule,
        sessionController,
        now,
      })
      await service.recordFailure(createFailureAgent(sessionId), 'codex_work')
      const [record] = (await service.list()).continuations
      expect(record).toBeDefined()
      if (record === undefined) throw new Error('Quota continuation was not stored.')
      expect(record).toMatchObject({ resetAt: null, ready: false, scheduled: false })
      expect(scheduler.requests).toHaveLength(0)

      await expect(service.resume(record.continuationId)).resolves.toEqual({ accepted: true })
      await expect(service.resume(record.continuationId)).resolves.toEqual({ accepted: true })
      expect(prompts).toHaveLength(1)
      expect(prompts[0]).toMatchObject({
        requestId: record.continuationId,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: promptFor(record.continuationId) }],
      })
      expect((await service.list()).continuations[0]?.state).toBe('queued')
    } finally {
      await service?.close()
      await context?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
