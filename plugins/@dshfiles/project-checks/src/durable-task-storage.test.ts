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
import { DurableTaskModel, durableTaskSchema } from './durable-tasks.js'

const taskId = 'a'.repeat(64)
const attemptId = '00000000-0000-4000-8000-000000000002'

const queuedTask = () =>
  durableTaskSchema.parse({
    id: taskId,
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
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

const openTaskStorage = async (root: string) => {
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root })
  await context.plugin(StorageDomain, { backend: 'json' })
  const domain = await context.storageDomain.open(durableTaskDomain)
  return { context, domain, table: domain.table('tasks') }
}

describe('durable Project Checks JSON storage', () => {
  it('recovers queued work and reconciles an interrupted attempt from its persisted receipt after Host reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-project-checks-tasks-'))
    let first: Awaited<ReturnType<typeof openTaskStorage>> | undefined
    let second: Awaited<ReturnType<typeof openTaskStorage>> | undefined
    let third: Awaited<ReturnType<typeof openTaskStorage>> | undefined

    try {
      first = await openTaskStorage(root)
      await first.table.put(taskId, queuedTask())
      await first.domain.close()
      await first.context.fiber.dispose()
      first = undefined

      second = await openTaskStorage(root)
      let executions = 0
      const runner = new DurableTaskRunner({
        table: second.table,
        newAttemptId: () => attemptId,
        validate: async () => ({ runnable: true, safeReplay: false }),
        findReceipt: async () => null,
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
      expect(runner.get(taskId)).toMatchObject({ status: 'succeeded', attempts: [{ id: attemptId, status: 'succeeded' }] })
      expect(executions).toBe(1)
      await runner.close()
      await second.domain.close()
      await second.context.fiber.dispose()
      second = undefined

      third = await openTaskStorage(root)
      const interrupted = DurableTaskModel.unknown(DurableTaskModel.begin(queuedTask(), { attemptId, now: 2 }), 3)
      await third.table.put(taskId, interrupted)
      const recoveredRunner = new DurableTaskRunner({
        table: third.table,
        newAttemptId: () => '00000000-0000-4000-8000-000000000003',
        validate: async () => ({ runnable: true, safeReplay: false }),
        findReceipt: async (recoveredTaskId, recoveredAttemptId) =>
          recoveredTaskId === taskId && recoveredAttemptId === attemptId ? { status: 'succeeded', exitCode: 0 } : null,
        run: async () => {
          throw new Error('receipt reconciliation must not replay completed work')
        },
        onFailure: error => {
          throw error
        },
      })
      await recoveredRunner.recover()
      await recoveredRunner.waitForIdle()
      expect(recoveredRunner.get(taskId)).toMatchObject({ status: 'succeeded', attempts: [{ id: attemptId, status: 'succeeded' }] })
      await recoveredRunner.close()
    } finally {
      await first?.domain.close()
      await first?.context.fiber.dispose()
      await second?.domain.close()
      await second?.context.fiber.dispose()
      await third?.domain.close()
      await third?.context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
