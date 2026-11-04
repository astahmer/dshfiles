import { mkdtemp, rm } from 'node:fs/promises'
import { Cause, Context as EffectContext, Effect, Exit, Layer, Option, Schema, Scope } from 'effect'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { describe, expect, it } from '@effect/vitest'
import { durableTaskDomain } from './durable-task-domain.js'
import { DurableTasks, type DurableTaskResult } from './durable-task-runner.js'
import { DurableTaskStore } from './durable-task-store.js'
import { DurableTestLayers } from './test-fixtures/durable-layers.js'

const { store: storeLayer, tasks: tasksLayer } = DurableTestLayers
import { DurableTaskModel, durableTaskSchema } from './durable-tasks.js'
import { storedReceiptSchema } from './store.js'

const taskId = 'a'.repeat(64)
const interruptedTaskId = 'c'.repeat(64)
const attemptId = '00000000-0000-4000-8000-000000000002'

const queuedTask = (id: string, idempotencyKey: string) =>
  Schema.decodeUnknownSync(durableTaskSchema)({
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
  Schema.decodeUnknownSync(storedReceiptSchema)({
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

const build = <ROut, E>(layer: Layer.Layer<ROut, E>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const services = yield* Layer.buildWithScope(layer, scope)
    return { services, close: Scope.close(scope, Exit.void) }
  })

const defectMessage = (exit: Exit.Exit<unknown, unknown>): string => (Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : '')

const openLegacyStorage = async (root: string) => {
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root })
  await context.plugin(StorageDomain, { backend: 'json' })
  const domain = await context.storageDomain.open(durableTaskDomain)
  return { context, domain, table: domain.table('tasks') }
}

describe('durable Project Checks task SQLite storage', () => {
  it.live('imports JSON history, recovers queued work, and reconciles an attempt-specific receipt after reopening', () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), 'dsh-project-checks-tasks-'))),
        directory => Effect.promise(() => rm(directory, { recursive: true, force: true })),
      )
      const legacy = yield* Effect.promise(() => openLegacyStorage(join(root, 'legacy-json')))
      yield* Effect.promise(async () => {
        await legacy.table.put(taskId, queuedTask(taskId, '00000000-0000-4000-8000-000000000001'))
        await legacy.table.put(interruptedTaskId, interruptedTask())
        await legacy.domain.close()
        await legacy.context.fiber.dispose()
      })

      const opened = yield* build(storeLayer(join(root, 'sqlite')))
      const store = EffectContext.get(opened.services, DurableTaskStore)
      yield* store.importLegacy({ tasks: [queuedTask(taskId, '00000000-0000-4000-8000-000000000001'), interruptedTask()], receipts: [successfulReceipt()] })
      expect(
        defectMessage(yield* Effect.exit(store.saveAttemptReceipt({ ...successfulReceipt(), taskAttemptId: '00000000-0000-4000-8000-000000000006' }))),
      ).toMatch(/does not match a persisted task attempt/u)
      expect(defectMessage(yield* Effect.exit(store.saveAttemptReceipt({ ...successfulReceipt(), sessionId: 'another-session' })))).toMatch(
        /does not match a persisted task attempt/u,
      )
      yield* opened.close

      let executions = 0
      const reader = yield* build(storeLayer(join(root, 'sqlite')))
      const readerStore = EffectContext.get(reader.services, DurableTaskStore)
      const decodeReceipt = Schema.decodeUnknownEffect(storedReceiptSchema)
      const queue = yield* build(
        tasksLayer(join(root, 'sqlite'), {
          attemptIds: () => '00000000-0000-4000-8000-000000000005',
          findReceipt: (recoveredTaskId, recoveredAttemptId) =>
            readerStore.findAttemptReceipt(recoveredTaskId, recoveredAttemptId).pipe(
              Effect.flatMap(found => Effect.transposeOption(Option.map(found, decodeReceipt))),
              Effect.map(
                Option.map((receipt): DurableTaskResult => ({
                  status: receipt.status === 'passed' ? 'succeeded' : receipt.status,
                  exitCode: receipt.exitCode,
                })),
              ),
              Effect.orDie,
            ),
          run: () =>
            Effect.sync(() => {
              executions += 1
              return { status: 'succeeded', exitCode: 0 }
            }),
        }),
      )
      const tasks = EffectContext.get(queue.services, DurableTasks)
      yield* tasks.awaitIdle
      expect(yield* tasks.get(taskId)).toMatchObject({ value: { status: 'succeeded', attempts: [{ number: 1, status: 'succeeded' }] } })
      expect(yield* tasks.get(interruptedTaskId)).toMatchObject({ value: { status: 'succeeded', attempts: [{ id: attemptId, status: 'succeeded' }] } })
      expect(executions).toBe(1)
      yield* queue.close
      yield* reader.close

      const reopenedLayer = yield* build(storeLayer(join(root, 'sqlite')))
      const reopened = EffectContext.get(reopenedLayer.services, DurableTaskStore)
      expect(yield* reopened.get(taskId)).toMatchObject({ value: { status: 'succeeded' } })
      const saved = yield* reopened.findAttemptReceipt(interruptedTaskId, attemptId)
      expect(Option.map(saved, receipt => Schema.decodeUnknownSync(storedReceiptSchema)(receipt))).toEqual(Option.some(successfulReceipt()))
      expect(yield* reopened.createIfAbsent({ task: queuedTask(taskId, '00000000-0000-4000-8000-000000000001') })).toMatchObject({
        id: taskId,
        status: 'succeeded',
      })
      const conflict = yield* Effect.flip(
        reopened.createIfAbsent({ task: { ...queuedTask(taskId, '00000000-0000-4000-8000-000000000001'), actionFingerprint: 'f'.repeat(64) } }),
      )
      expect(conflict.message).toMatch(/idempotency key.*different/u)
      yield* reopened.createIfAbsent({ task: queuedTask('d'.repeat(64), '00000000-0000-4000-8000-000000000006'), maxRows: 1 })
      expect(yield* reopened.get(taskId)).toEqual(Option.none())
      yield* reopened.importLegacy({ tasks: [queuedTask(taskId, '00000000-0000-4000-8000-000000000001')], receipts: [successfulReceipt()] })
      expect(yield* reopened.get(taskId)).toEqual(Option.none())
      const expired = yield* Effect.flip(reopened.createIfAbsent({ task: queuedTask(taskId, '00000000-0000-4000-8000-000000000001') }))
      expect(expired.message).toMatch(/history has expired/u)
      yield* reopenedLayer.close
    }).pipe(Effect.scoped),
  )
})
