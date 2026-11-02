import { spawn } from 'node:child_process'
import { Schema } from 'effect'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context, Effect, Layer, Option } from 'effect'
import { DurableTasks, type DurableTaskResult } from './durable-task-runner.js'
import { DurableTaskStore } from './durable-task-store.js'
import { DurableTaskModel, durableTaskSchema, type DurableTask } from './durable-tasks.js'
import { storedReceiptSchema } from './store.js'
import { DurableTestLayers } from './test-fixtures/durable-layers.js'

const { store: storeLayer, tasks: tasksLayer } = DurableTestLayers

const taskId = 'a'.repeat(64)
const attemptId = '00000000-0000-4000-8000-000000000002'
const sourceDirectory = dirname(fileURLToPath(import.meta.url))
const workerPath = join(sourceDirectory, 'test-fixtures', 'durable-task-process-worker.mjs')
const projectRoot = dirname(sourceDirectory)

const task = () =>
  Schema.decodeUnknownSync(durableTaskSchema)({
    id: taskId,
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    sessionId: 'process-race-session',
    actionId: 'test',
    handlerVersion: 1,
    actionFingerprint: 'b'.repeat(64),
    cwd: '/tmp/project',
    status: 'queued',
    attempts: [],
    createdAt: 1,
    updatedAt: 1,
    errorCode: null,
  })

const startWorker = (root: string, markerPath: string, mode: string) =>
  spawn(process.execPath, ['--experimental-strip-types', workerPath, root, markerPath, mode], { cwd: projectRoot })

const runWorker = (root: string, markerPath: string, mode: string): Promise<{ code: number | null; signal: NodeJS.Signals | null }> =>
  new Promise((resolve, reject) => {
    const worker = startWorker(root, markerPath, mode)
    worker.stderr.on('data', chunk => process.stderr.write(chunk))
    worker.once('error', reject)
    worker.once('exit', (code, signal) => resolve({ code, signal }))
  })

const markerCount = async (path: string): Promise<number> => {
  try {
    return (await readFile(path, 'utf8')).trim().split('\n').length
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0
    throw error
  }
}

const withStore = <A, E>(root: string, use: (store: DurableTaskStore['Service']) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(Layer.build(storeLayer(root)), services => use(Context.get(services, DurableTaskStore)))))

const storedTask = (root: string): Promise<DurableTask | undefined> => withStore(root, store => Effect.map(store.get(taskId), Option.getOrUndefined))

/** Recover the store under root with a handler that counts executions; returns the settled task. */
const recoverWith = (root: string, findReceipt: boolean) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        let executions = 0
        const reader = Context.get(yield* Layer.build(storeLayer(root)), DurableTaskStore)
        const decode = Schema.decodeUnknownEffect(storedReceiptSchema)
        const tasks = Context.get(
          yield* Layer.build(
            tasksLayer(root, {
              attemptIds: () => '00000000-0000-4000-8000-000000000003',
              ...(findReceipt && {
                findReceipt: (recoveredTaskId: string, recoveredAttemptId: string) =>
                  reader.findAttemptReceipt(recoveredTaskId, recoveredAttemptId).pipe(
                    Effect.flatMap(found => Effect.transposeOption(Option.map(found, decode))),
                    Effect.map(
                      Option.map((receipt): DurableTaskResult => ({
                        status: receipt.status === 'passed' ? 'succeeded' : receipt.status,
                        exitCode: receipt.exitCode,
                      })),
                    ),
                    Effect.orDie,
                  ),
              }),
              run: () =>
                Effect.sync((): DurableTaskResult => {
                  executions += 1
                  return { status: 'succeeded', exitCode: 0 }
                }),
            }),
          ),
          DurableTasks,
        )
        yield* tasks.awaitIdle
        return { executions, task: Option.getOrUndefined(yield* tasks.get(taskId)) }
      }),
    ),
  )

describe('durable Project Checks cross-process coordination', () => {
  it('admits the same idempotency key in two Node processes but runs its side effect once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-project-checks-process-race-'))
    const markerPath = join(root, 'effects.txt')
    try {
      const outcomes = await Promise.all([runWorker(root, markerPath, 'complete'), runWorker(root, markerPath, 'complete')])
      expect(outcomes).toEqual([
        { code: 0, signal: null },
        { code: 0, signal: null },
      ])
      expect(await markerCount(markerPath)).toBe(1)
      expect(await withStore(root, store => Effect.map(store.all, all => all.length))).toBe(1)
      expect(await storedTask(root)).toMatchObject({ status: 'succeeded', attempts: [{ status: 'succeeded' }] })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('lets two independent recovering Hosts share one queued task claim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-project-checks-process-recovery-'))
    const markerPath = join(root, 'effects.txt')
    try {
      await withStore(root, store => store.createIfAbsent({ task: task() }))
      const outcomes = await Promise.all([runWorker(root, markerPath, 'recover'), runWorker(root, markerPath, 'recover')])
      expect(outcomes).toEqual([
        { code: 0, signal: null },
        { code: 0, signal: null },
      ])
      expect(await markerCount(markerPath)).toBe(1)
      expect(await storedTask(root)).toMatchObject({ status: 'succeeded', attempts: [{ status: 'succeeded' }] })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('propagates cancellation from another Host to the process holding the worker claim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-project-checks-process-cancel-'))
    const markerPath = join(root, 'effects.txt')
    try {
      const worker = startWorker(root, markerPath, 'cancelable')
      worker.stderr.on('data', chunk => process.stderr.write(chunk))
      await new Promise<void>((resolve, reject) => {
        worker.stdout.once('data', () => resolve())
        worker.once('error', reject)
        worker.once('exit', (code, signal) => reject(new Error(`Worker exited before starting: ${code ?? signal}.`)))
      })
      const requested = await withStore(root, store => store.update(taskId, current => DurableTaskModel.cancel(current, Date.now())))
      expect(requested.status).toBe('cancel-requested')
      const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        worker.once('error', reject)
        worker.once('exit', (code, signal) => resolve({ code, signal }))
      })
      expect(outcome).toEqual({ code: 0, signal: null })
      expect(await markerCount(markerPath)).toBe(1)
      expect(await storedTask(root)).toMatchObject({ status: 'cancelled', attempts: [{ status: 'cancelled' }] })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('releases the process claim on hard exit and leaves an unreceipted side effect unknown without replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-project-checks-process-crash-'))
    const markerPath = join(root, 'effects.txt')
    try {
      expect(await runWorker(root, markerPath, 'crash-after-effect')).toMatchObject({ code: null, signal: 'SIGKILL' })
      const recovered = await recoverWith(root, false)
      expect(await markerCount(markerPath)).toBe(1)
      expect(recovered.executions).toBe(0)
      expect(recovered.task).toMatchObject({ status: 'unknown', attempts: [{ id: attemptId, status: 'unknown' }] })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('reconciles a committed attempt receipt after its owner dies before the task terminal update', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-project-checks-process-receipt-'))
    const markerPath = join(root, 'effects.txt')
    try {
      expect(await runWorker(root, markerPath, 'crash-after-receipt')).toMatchObject({ code: null, signal: 'SIGKILL' })
      const recovered = await recoverWith(root, true)
      expect(await markerCount(markerPath)).toBe(1)
      expect(recovered.executions).toBe(0)
      expect(recovered.task).toMatchObject({ status: 'succeeded', attempts: [{ id: attemptId, status: 'succeeded' }] })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)
})
