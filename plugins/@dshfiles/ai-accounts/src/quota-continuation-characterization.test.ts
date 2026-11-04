import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ScheduleId, createAfterScheduleRecord } from '@deepseek-ai/dsh-schedule'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { QuotaContinuationMessage } from './quota-continuation-message.js'
import { createQuotaContinuationService, type QuotaFailureAgent } from './quota-continuation.js'

/**
 * Pins quota recovery's persistence rules before wave F moves it onto Effect services: which reset wins, one active
 * recovery per thread even under concurrent failures, the capacity rule, and one Schedule task per recovery.
 * Storage is the real JSON storage domain; only the Schedule service is a recording stand-in.
 */
type SchedulePort = Pick<NonNullable<Context['schedule']>, 'create' | 'delete' | 'list'>
type ScheduleRecord = Awaited<ReturnType<NonNullable<Context['schedule']>['create']>>

const NOW = 1_800_000_000_000
const MINUTE = 60_000

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const openContext = async (root: string): Promise<Context> => {
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root })
  await context.plugin(StorageDomain, { backend: 'json' })
  return context
}

const recordingSchedule = () => {
  const rows = new Map<string, ScheduleRecord[]>()
  const created: Array<{ readonly sessionId: string; readonly afterSeconds: number | undefined }> = []
  const deleted: string[] = []
  let nextId = 0
  const schedule: SchedulePort = {
    create: async (sessionId, request) => {
      created.push({ sessionId, afterSeconds: request.after_seconds })
      const record = createAfterScheduleRecord(ScheduleId(`quota-${String(++nextId)}`), request.prompt, request.after_seconds ?? 1, NOW, request.title)
      rows.set(sessionId, [...(rows.get(sessionId) ?? []), record])
      return record
    },
    delete: async ({ sessionId, id }) => {
      deleted.push(String(id))
      const previous = rows.get(sessionId) ?? []
      const next = previous.filter(record => record.id !== id)
      rows.set(sessionId, next)
      return previous.length === next.length ? { id, deleted: false, code: 'schedule_not_found' } : { id, deleted: true }
    },
    list: async ({ sessionId }) => rows.get(sessionId) ?? [],
  }
  return { schedule, rows, created, deleted }
}

const failureAgent = (id: string, seq = 7): QuotaFailureAgent => ({ id: SessionId(id), session: { seq }, inbox: { nextTurn: [], nextStep: [] } })

const serviceIn = async (input: {
  readonly root?: string
  readonly readResetAt: (accountId: string) => Promise<number | null>
  readonly schedule?: SchedulePort
}) => {
  const root = input.root ?? (await mkdtemp(join(tmpdir(), 'ai-accounts-quota-')))
  if (input.root === undefined) cleanups.push(() => rm(root, { recursive: true, force: true }))
  const context = await openContext(root)
  const service = createQuotaContinuationService({
    context,
    readResetAt: input.readResetAt,
    ...(input.schedule !== undefined && { schedule: input.schedule }),
    archivedSessionIds: () => [],
    now: () => NOW,
  })
  const close = async () => {
    await service.close()
    await context.fiber.dispose()
  }
  cleanups.push(close)
  return { root, service, close }
}

describe('reset precedence', () => {
  it('prefers the reset the usage card reports over one the failure text names', async () => {
    const scheduler = recordingSchedule()
    const { service } = await serviceIn({ readResetAt: async () => NOW + 10 * MINUTE, schedule: scheduler.schedule })
    await service.recordFailure(failureAgent('thread-1'), 'codex_work', true, undefined, 'You have hit your usage limit. Try again in ~240 min.')

    expect((await service.list()).continuations).toMatchObject([{ resetAt: NOW + 10 * MINUTE, autoRetry: true, scheduled: true }])
    expect(scheduler.created).toEqual([{ sessionId: 'thread-1', afterSeconds: 11 * 60 }])
  })

  it('falls back to the failure text when reading the usage card fails', async () => {
    const scheduler = recordingSchedule()
    const { service } = await serviceIn({
      readResetAt: async () => {
        throw new Error('usage unavailable')
      },
      schedule: scheduler.schedule,
    })
    await service.recordFailure(failureAgent('thread-1'), 'codex_work', true, undefined, 'You have hit your usage limit. Try again in ~30 min.')

    expect((await service.list()).continuations).toMatchObject([{ resetAt: NOW + 30 * MINUTE, autoRetry: true, scheduled: true }])
  })

  it('stays manual when neither source names a reset, whatever the retry default', async () => {
    const scheduler = recordingSchedule()
    const { service } = await serviceIn({ readResetAt: async () => null, schedule: scheduler.schedule })
    await service.recordFailure(failureAgent('thread-1'), 'codex_work', true, undefined, 'quota exceeded')

    expect((await service.list()).continuations).toMatchObject([{ resetAt: null, autoRetry: false, scheduled: false, ready: false }])
    expect(scheduler.created).toEqual([])
  })

  it('keeps a known reset but schedules nothing when the retry default is off', async () => {
    const scheduler = recordingSchedule()
    const { service } = await serviceIn({ readResetAt: async () => NOW + 5 * MINUTE, schedule: scheduler.schedule })
    await service.recordFailure(failureAgent('thread-1'), 'codex_work', false)

    expect((await service.list()).continuations).toMatchObject([{ resetAt: NOW + 5 * MINUTE, autoRetry: false, scheduled: false, ready: false }])
    expect(scheduler.created).toEqual([])
  })
})

describe('per-thread serialization', () => {
  it('leaves one active recovery and one Schedule task when a thread fails twice at once', async () => {
    const scheduler = recordingSchedule()
    const { service } = await serviceIn({ readResetAt: async () => NOW + MINUTE, schedule: scheduler.schedule })
    await Promise.all([
      service.recordFailure(failureAgent('thread-1', 3), 'codex_work', true),
      service.recordFailure(failureAgent('thread-1', 9), 'codex_personal', true),
    ])

    const { continuations } = await service.list()
    expect(continuations).toMatchObject([{ sessionId: 'thread-1', accountId: 'codex_personal' }])
    expect(scheduler.created).toHaveLength(2)
    expect(scheduler.rows.get('thread-1')).toHaveLength(1)
    expect(scheduler.rows.get('thread-1')?.[0]?.prompt).toBe(QuotaContinuationMessage.promptFor(continuations[0]?.continuationId ?? ''))
  })

  it('keeps recoveries of different threads independent', async () => {
    const { service } = await serviceIn({ readResetAt: async () => null })
    await Promise.all([
      service.recordFailure(failureAgent('thread-1'), 'codex_work', true),
      service.recordFailure(failureAgent('thread-2'), 'codex_work', true),
    ])

    expect((await service.list()).continuations.map(continuation => continuation.sessionId).sort()).toEqual(['thread-1', 'thread-2'])
  })

  it('stores a recovery already invalidated when other work is queued for the thread', async () => {
    const { service } = await serviceIn({ readResetAt: async () => null })
    const busy: QuotaFailureAgent = {
      id: SessionId('thread-1'),
      session: { seq: 4 },
      inbox: {
        nextTurn: [createUserMessage({ content: [{ type: 'text', text: 'newer work' }], source: { kind: 'user' } })],
        nextStep: [],
      },
    }
    await service.recordFailure(busy, 'codex_work', true)

    expect((await service.list()).continuations).toEqual([])
  })
})

describe('capacity', () => {
  it('refuses a new recovery at 500 active ones and frees room by evicting the oldest retired one', { timeout: 60_000 }, async () => {
    const { service } = await serviceIn({ readResetAt: async () => null })
    for (let index = 0; index < 500; index++) await service.recordFailure(failureAgent(`thread-${String(index)}`), 'codex_work', false)
    expect((await service.list()).continuations).toHaveLength(500)

    await service.recordFailure(failureAgent('overflow'), 'codex_work', false)
    const afterOverflow = await service.list()
    expect(afterOverflow.continuations).toHaveLength(500)
    expect(afterOverflow.continuations.some(continuation => continuation.sessionId === 'overflow')).toBe(false)

    const replacedBefore = afterOverflow.continuations.find(continuation => continuation.sessionId === 'thread-0')?.continuationId
    await service.recordFailure(failureAgent('thread-0', 99), 'codex_personal', false)
    const afterRetry = await service.list()
    expect(afterRetry.continuations).toHaveLength(500)
    const replaced = afterRetry.continuations.find(continuation => continuation.sessionId === 'thread-0')
    expect(replaced?.accountId).toBe('codex_personal')
    expect(replaced?.continuationId).not.toBe(replacedBefore)
  })
})

describe('one Schedule task per recovery', () => {
  it('keeps the first matching task and deletes duplicates when the Host restarts', async () => {
    const scheduler = recordingSchedule()
    const first = await serviceIn({ readResetAt: async () => NOW + MINUTE, schedule: scheduler.schedule })
    await first.service.recordFailure(failureAgent('thread-1'), 'codex_work', true)
    const [continuation] = (await first.service.list()).continuations
    if (continuation === undefined) throw new Error('The recovery was not stored.')
    await first.close()
    await scheduler.schedule.create(SessionId('thread-1'), {
      title: 'Quota recovery',
      prompt: QuotaContinuationMessage.promptFor(continuation.continuationId),
      after_seconds: 30,
    })
    const [kept, duplicate] = scheduler.rows.get('thread-1') ?? []

    const second = await serviceIn({ root: first.root, readResetAt: async () => null, schedule: scheduler.schedule })
    const stop = second.service.start()
    cleanups.push(async () => stop())
    await second.service.list()
    await setImmediate()
    await setImmediate()

    expect(scheduler.rows.get('thread-1')?.map(row => row.id)).toEqual([kept?.id])
    expect(scheduler.deleted).toEqual([String(duplicate?.id)])
    expect((await second.service.list()).continuations).toMatchObject([{ continuationId: continuation.continuationId, scheduled: true }])
  })

  it('removes the old task when a snooze moves the recovery later', async () => {
    const scheduler = recordingSchedule()
    const { service } = await serviceIn({ readResetAt: async () => NOW + MINUTE, schedule: scheduler.schedule })
    await service.recordFailure(failureAgent('thread-1'), 'codex_work', true)
    const [continuation] = (await service.list()).continuations
    if (continuation === undefined) throw new Error('The recovery was not stored.')
    const [original] = scheduler.rows.get('thread-1') ?? []

    expect(await service.snooze(continuation.continuationId, 'four-hours')).toEqual({ updated: true })
    expect(scheduler.deleted).toEqual([String(original?.id)])
    expect(scheduler.created.map(entry => entry.afterSeconds)).toEqual([120, 4 * 3_600 + 60])
    expect(scheduler.rows.get('thread-1')).toHaveLength(1)
  })

  it('cancels its task and drops out of the list once dismissed, and a second dismiss is refused', async () => {
    const scheduler = recordingSchedule()
    const { service } = await serviceIn({ readResetAt: async () => NOW + MINUTE, schedule: scheduler.schedule })
    await service.recordFailure(failureAgent('thread-1'), 'codex_work', true)
    const [continuation] = (await service.list()).continuations
    if (continuation === undefined) throw new Error('The recovery was not stored.')

    expect(await service.dismiss(continuation.continuationId)).toEqual({ dismissed: true })
    expect(await service.dismiss(continuation.continuationId)).toEqual({ dismissed: false })
    expect(scheduler.rows.get('thread-1')).toEqual([])
    expect((await service.list()).continuations).toEqual([])
  })
})
