import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { describe, expect, it } from 'vitest'
import { durableTaskDomain } from './durable-task-domain.js'
import { DurableTaskRunner } from './durable-task-runner.js'
import { DurableTaskStore } from './durable-task-store.js'
import { DurableTaskModel, durableTaskSchema } from './durable-tasks.js'
import { storedReceiptSchema } from './store.js'

const taskId = 'a'.repeat(64)
const interruptedTaskId = 'c'.repeat(64)
const attemptId = '00000000-0000-4000-8000-000000000002'

const queuedTask = (id: string, idempotencyKey: string) =>
  durableTaskSchema.parse({
    id,
    idempotencyKey,
    sessionId: 'session-storage-test',
    actionId: 'test',
    handlerVersion: 1,
    actionFingerprint: 'b'.repeat(64),
    cwd: '/work/project',
    status: 'queued',
    attempts: [],
    createdAt: 1,
    updatedAt: 1,
    errorCode: null,
  })

const interruptedTask = () => DurableTaskModel.begin(queuedTask(interruptedTaskId, '00000000-0000-4000-8000-000000000003'), { attemptId, now: 2 })

const successfulReceipt = () =>
  storedReceiptSchema.parse({
    id: '00000000-0000-4000-8000-000000000004',
    taskId: interruptedTaskId,
    taskAttemptId: attemptId,
    sessionId: 'session-storage-test',
    actionId: 'test',
    label: 'Test action',
    status: 'passed',
    failure: null,
    startedAt: 2,
    finishedAt: 3,
    durationMs: 1,
    exitCode: 0,
    sourceRevision: null,
    verificationTurn: null,
    automatic: false,
    attempt: 1,
  })

const openLegacyStorage = async (root: string) => {
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root })
  await context.plugin(StorageDomain, { backend: 'json' })
  const domain = await context.storageDomain.open(durableTaskDomain)
  return { context, domain, table: domain.table('tasks') }
}

describe('durable Project Checks task SQLite storage', () => {
  it('imports JSON history, recovers queued work, and reconciles an attempt-specific receipt after reopening', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-project-checks-tasks-'))
    let legacy: Awaited<ReturnType<typeof openLegacyStorage>> | undefined
    let store: DurableTaskStore | undefined
    let reopened: DurableTaskStore | undefined

    try {
      legacy = await openLegacyStorage(join(root, 'legacy-json'))
      await legacy.table.put(taskId, queuedTask(taskId, '00000000-0000-4000-8000-000000000001'))
      await legacy.table.put(interruptedTaskId, interruptedTask())
      await legacy.domain.close()
      await legacy.context.fiber.dispose()
      legacy = undefined

      store = await DurableTaskStore.open({ root: join(root, 'sqlite') })
      await store.importLegacy({
        tasks: [queuedTask(taskId, '00000000-0000-4000-8000-000000000001'), interruptedTask()],
        receipts: [successfulReceipt()],
      })
      await expect(store.saveAttemptReceipt({ ...successfulReceipt(), taskAttemptId: '00000000-0000-4000-8000-000000000006' })).rejects.toThrow(
        /does not match a persisted task attempt/u,
      )
      await expect(store.saveAttemptReceipt({ ...successfulReceipt(), sessionId: 'another-session' })).rejects.toThrow(
        /does not match a persisted task attempt/u,
      )
      let executions = 0
      const runner = new DurableTaskRunner({
        table: store,
        newAttemptId: () => '00000000-0000-4000-8000-000000000005',
        validate: async () => ({ runnable: true, safeReplay: false }),
        findReceipt: async (recoveredTaskId, recoveredAttemptId) => {
          const saved = store?.findAttemptReceipt(recoveredTaskId, recoveredAttemptId)
          if (saved === undefined) return null
          const receipt = storedReceiptSchema.parse(saved)
          return { status: receipt.status === 'passed' ? 'succeeded' : receipt.status, exitCode: receipt.exitCode }
        },
        run: async () => {
          executions += 1
          return { status: 'succeeded', exitCode: 0 }
        },
        onFailure: error => {
          throw error
        },
      })
      await runner.recover()
      await runner.waitForIdle()

      expect(runner.get(taskId)).toMatchObject({ status: 'succeeded', attempts: [{ number: 1, status: 'succeeded' }] })
      expect(runner.get(interruptedTaskId)).toMatchObject({ status: 'succeeded', attempts: [{ id: attemptId, status: 'succeeded' }] })
      expect(executions).toBe(1)
      await runner.close()
      store.close()
      store = undefined

      reopened = await DurableTaskStore.open({ root: join(root, 'sqlite') })
      expect(reopened.get(taskId)).toMatchObject({ status: 'succeeded' })
      expect(storedReceiptSchema.parse(reopened.findAttemptReceipt(interruptedTaskId, attemptId))).toEqual(successfulReceipt())
      expect(await reopened.createIfAbsent(queuedTask(taskId, '00000000-0000-4000-8000-000000000001'), 1_000)).toMatchObject({
        id: taskId,
        status: 'succeeded',
      })
      await expect(
        reopened.createIfAbsent({ ...queuedTask(taskId, '00000000-0000-4000-8000-000000000001'), actionFingerprint: 'f'.repeat(64) }, 1_000),
      ).rejects.toThrow(/idempotency key.*different/u)
      await reopened.createIfAbsent(queuedTask('d'.repeat(64), '00000000-0000-4000-8000-000000000006'), 1)
      expect(reopened.get(taskId)).toBeUndefined()
      await reopened.importLegacy({ tasks: [queuedTask(taskId, '00000000-0000-4000-8000-000000000001')], receipts: [successfulReceipt()] })
      expect(reopened.get(taskId)).toBeUndefined()
      await expect(reopened.createIfAbsent(queuedTask(taskId, '00000000-0000-4000-8000-000000000001'), 1_000)).rejects.toThrow(/history has expired/u)
    } finally {
      legacy?.domain.close()
      legacy?.context.fiber.dispose()
      store?.close()
      reopened?.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
