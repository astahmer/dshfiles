import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { ScheduleId, createAfterScheduleRecord } from '@deepseek-ai/dsh-schedule'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { createQuotaContinuationService, type QuotaFailureAgent } from './quota-continuation.js'
import { QuotaContinuationMessage } from './quota-continuation-message.js'

type SchedulePort = Pick<NonNullable<Context['schedule']>, 'create' | 'delete' | 'list'>
type ScheduleCreateRequest = Parameters<NonNullable<Context['schedule']>['create']>[1]
type ScheduleRecord = Awaited<ReturnType<NonNullable<Context['schedule']>['create']>>
type SessionPromptRequest = Parameters<SessionController['prompt']>[0]

const openContext = async (root: string) => {
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root })
  await context.plugin(StorageDomain, { backend: 'json' })
  return context
}

const createFailureAgent = (id: string, seq = 12): QuotaFailureAgent => ({
  id: SessionId(id),
  session: { seq },
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
      const record = createAfterScheduleRecord(ScheduleId(`quota-${++nextId}`), request.prompt, afterSeconds, now(), request.title)
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
      await firstService.recordFailure(agent, 'codex_work', true, { provider: 'codex_work', model: 'gpt-6-luna' })
      const [record] = (await firstService.list()).continuations
      expect(record).toBeDefined()
      if (record === undefined) throw new Error('Quota continuation was not stored.')
      expect(record).toMatchObject({ failedProvider: 'codex_work', failedModel: 'gpt-6-luna' })
      expect(scheduler.requests[0]?.after_seconds).toBe(120)

      await firstService.snooze(record.continuationId, 'one-hour')
      expect(scheduler.requests[1]?.after_seconds).toBe(3_660)
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
        continuations: [
          {
            continuationId: record.continuationId,
            state: 'waiting',
            resetAt,
            snoozedUntil: now() + 3_600_000,
            scheduled: true,
          },
        ],
      })
      expect(scheduler.requests).toHaveLength(3)
      expect(scheduler.requests[2]?.after_seconds).toBe(3_660)
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

  it('lets one waiting continuation opt into and out of retry-at-reset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-quota-opt-in-'))
    const now = () => 3_000_000
    const resetAt = now() + 90_000
    const sessionId = SessionId('quota-opt-in-session')
    const scheduler = createScheduleFixture(now)
    let context: Context | undefined
    let service: ReturnType<typeof createQuotaContinuationService> | undefined

    try {
      context = await openContext(root)
      service = createQuotaContinuationService({ context, readResetAt: async () => resetAt, schedule: scheduler.schedule, now })
      await service.recordFailure(createFailureAgent(sessionId), 'codex_work', false)
      const [initial] = (await service.list()).continuations
      expect(initial).toMatchObject({ autoRetry: false, scheduled: false })
      if (initial === undefined) throw new Error('Quota continuation was not stored.')
      expect(scheduler.requests).toHaveLength(0)
      await expect(service.setAutoRetry(initial.continuationId, SessionId('other-session'), true)).resolves.toEqual({ updated: false })

      await expect(service.setAutoRetry(initial.continuationId, sessionId, true)).resolves.toEqual({ updated: true })
      expect((await service.list()).continuations[0]).toMatchObject({ autoRetry: true, scheduled: true })
      expect(scheduler.requests[0]?.after_seconds).toBe(150)

      await expect(service.setAutoRetry(initial.continuationId, sessionId, false)).resolves.toEqual({ updated: true })
      expect((await service.list()).continuations[0]).toMatchObject({ autoRetry: false, scheduled: false })
      expect(scheduler.rows.get(sessionId)).toHaveLength(0)
    } finally {
      await service?.close()
      await context?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps unknown resets manual and queues one stable request through Session Controller', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-quota-manual-'))
    const now = () => 2_000_000
    const sessionId = SessionId('quota-manual-session')
    const prompts: SessionPromptRequest[] = []
    const selectedModels: Parameters<SessionController['selectModel']>[0][] = []
    const scheduler = createScheduleFixture(now)
    const sessionController = {
      inspect: async () => ({ events: [] }),
      selectModel: async (request: Parameters<SessionController['selectModel']>[0]) => {
        selectedModels.push(request)
        return { selected: request }
      },
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
      await service.recordFailure(createFailureAgent(sessionId), 'codex_work', false)
      const [record] = (await service.list()).continuations
      expect(record).toBeDefined()
      if (record === undefined) throw new Error('Quota continuation was not stored.')
      expect(record).toMatchObject({ resetAt: null, autoRetry: false, ready: false, scheduled: false })
      expect(scheduler.requests).toHaveLength(0)
      await expect(service.setAutoRetry(record.continuationId, sessionId, true)).resolves.toEqual({ updated: false })

      await expect(service.resume(record.continuationId, { provider: 'codex_alt', model: 'gpt-6-luna', reasoningEffort: 'high' })).resolves.toEqual({
        accepted: true,
      })
      await expect(service.resume(record.continuationId)).resolves.toEqual({ accepted: true })
      expect(selectedModels).toEqual([{ sessionId, provider: 'codex_alt', model: 'gpt-6-luna', reasoningEffort: 'high' }])
      expect(prompts).toHaveLength(1)
      expect(prompts[0]).toMatchObject({
        requestId: record.continuationId,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: QuotaContinuationMessage.promptFor(record.continuationId) }],
      })
      expect((await service.list()).continuations[0]?.state).toBe('queued')
    } finally {
      await service?.close()
      await context?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('invalidates recovery when newer persisted Session work exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-quota-new-work-'))
    const sessionId = SessionId('quota-new-work-session')
    const session = Session.create(sessionId)
    const sequenceAfterFailedPrompt = 1
    const prompts: SessionPromptRequest[] = []
    let context: Context | undefined
    let service: ReturnType<typeof createQuotaContinuationService> | undefined

    try {
      session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'the request that hit quota' }], source: { kind: 'user' } }), {
        surfaceOp: 'append',
      })
      context = await openContext(root)
      service = createQuotaContinuationService({
        context,
        readResetAt: async () => null,
        sessionController: {
          inspect: async () => ({ events: session.ownEvents() }),
          prompt: async (request: SessionPromptRequest) => {
            prompts.push(request)
            return { accepted: true as const }
          },
        },
      })
      await service.recordFailure(createFailureAgent(sessionId, sequenceAfterFailedPrompt), 'codex_work', false)
      const [record] = (await service.list()).continuations
      expect(record).toBeDefined()
      if (record === undefined) throw new Error('Quota continuation was not stored.')

      session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'a newer request' }], source: { kind: 'user' } }), {
        surfaceOp: 'append',
      })

      await expect(service.resume(record.continuationId)).resolves.toEqual({ accepted: false })
      expect(prompts).toHaveLength(0)
      await expect(service.list()).resolves.toMatchObject({ continuations: [] })
    } finally {
      await service?.close()
      await context?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it("carries a thread's own retry choice into its next failure and no further", async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-quota-thread-choice-'))
    const now = () => 5_000_000
    const resetAt = now() + 30 * 60_000
    const thread = SessionId('quota-thread-choice')
    const otherThread = SessionId('quota-thread-choice-other')
    const scheduler = createScheduleFixture(now)
    let context: Context | undefined
    let service: ReturnType<typeof createQuotaContinuationService> | undefined

    try {
      context = await openContext(root)
      service = createQuotaContinuationService({ context, readResetAt: async () => resetAt, schedule: scheduler.schedule, now })

      await service.recordFailure(createFailureAgent(thread), 'claude_work', true)
      const [first] = (await service.list()).continuations
      if (first === undefined) throw new Error('Quota continuation was not stored.')
      expect(first.autoRetry).toBe(true)
      await expect(service.setAutoRetry(first.continuationId, thread, false)).resolves.toEqual({ updated: true })

      await service.recordFailure(createFailureAgent(thread), 'claude_work', true)
      await service.recordFailure(createFailureAgent(otherThread), 'claude_work', true)
      const byThread = new Map((await service.list()).continuations.map(record => [record.sessionId, record]))
      expect(byThread.get(thread)?.autoRetry).toBe(false)
      expect(byThread.get(otherThread)?.autoRetry).toBe(true)
    } finally {
      await service?.close()
      await context?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the reset a provider message names when the usage card reports none', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-quota-message-reset-'))
    const now = () => 6_000_000
    const scheduler = createScheduleFixture(now)
    let context: Context | undefined
    let service: ReturnType<typeof createQuotaContinuationService> | undefined

    try {
      context = await openContext(root)
      service = createQuotaContinuationService({ context, readResetAt: async () => null, schedule: scheduler.schedule, now })
      await service.recordFailure(createFailureAgent(SessionId('quota-message-reset')), 'claude_work', true, undefined, 'Try again in ~42 min.')
      const [record] = (await service.list()).continuations
      expect(record).toMatchObject({ resetAt: now() + 42 * 60_000, autoRetry: true, scheduled: true })
      expect(scheduler.requests[0]?.after_seconds).toBe(42 * 60 + 60)
    } finally {
      await service?.close()
      await context?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
