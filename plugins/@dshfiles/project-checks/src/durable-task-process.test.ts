import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DurableTaskRunner } from './durable-task-runner.js'
import { DurableTaskStore } from './durable-task-store.js'
import { durableTaskSchema } from './durable-tasks.js'
import { storedReceiptSchema } from './store.js'

const taskId = 'a'.repeat(64)
const attemptId = '00000000-0000-4000-8000-000000000002'
const sourceDirectory = dirname(fileURLToPath(import.meta.url))
const workerPath = join(sourceDirectory, 'test-fixtures', 'durable-task-process-worker.mjs')
const projectRoot = dirname(sourceDirectory)

const task = () =>
  durableTaskSchema.parse({
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

describe('durable Project Checks cross-process coordination', () => {
  it('admits the same idempotency key in two Node processes but runs its side effect once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-project-checks-process-race-'))
    const markerPath = join(root, 'effects.txt')
    let store: DurableTaskStore | undefined

    try {
      const outcomes = await Promise.all([runWorker(root, markerPath, 'complete'), runWorker(root, markerPath, 'complete')])
      expect(outcomes).toEqual([
        { code: 0, signal: null },
        { code: 0, signal: null },
      ])
      expect(await markerCount(markerPath)).toBe(1)

      store = await DurableTaskStore.open({ root })
      expect(store.size).toBe(1)
      expect(store.get(taskId)).toMatchObject({ status: 'succeeded', attempts: [{ status: 'succeeded' }] })
    } finally {
      store?.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('lets two independent recovering Hosts share one queued task claim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-project-checks-process-recovery-'))
    const markerPath = join(root, 'effects.txt')
    let store: DurableTaskStore | undefined

    try {
      store = await DurableTaskStore.open({ root })
      await store.createIfAbsent(task(), 1_000)
      store.close()
      store = undefined

      const outcomes = await Promise.all([runWorker(root, markerPath, 'recover'), runWorker(root, markerPath, 'recover')])
      expect(outcomes).toEqual([
        { code: 0, signal: null },
        { code: 0, signal: null },
      ])
      expect(await markerCount(markerPath)).toBe(1)

      store = await DurableTaskStore.open({ root })
      expect(store.get(taskId)).toMatchObject({ status: 'succeeded', attempts: [{ status: 'succeeded' }] })
    } finally {
      store?.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('propagates cancellation from another Host to the process holding the worker claim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-project-checks-process-cancel-'))
    const markerPath = join(root, 'effects.txt')
    let store: DurableTaskStore | undefined

    try {
      store = await DurableTaskStore.open({ root })
      const cancelRunner = new DurableTaskRunner({
        table: store,
        newAttemptId: () => '00000000-0000-4000-8000-000000000003',
        validate: async () => ({ runnable: true, safeReplay: false }),
        findReceipt: async () => null,
        run: async () => ({ status: 'succeeded', exitCode: 0 }),
        onFailure: error => {
          throw error
        },
      })
      const worker = startWorker(root, markerPath, 'cancelable')
      worker.stderr.on('data', chunk => process.stderr.write(chunk))
      await new Promise<void>((resolve, reject) => {
        worker.stdout.once('data', () => resolve())
        worker.once('error', reject)
        worker.once('exit', (code, signal) => reject(new Error(`Worker exited before starting: ${code ?? signal}.`)))
      })
      expect((await cancelRunner.cancel(taskId)).status).toBe('cancel-requested')
      const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        worker.once('error', reject)
        worker.once('exit', (code, signal) => resolve({ code, signal }))
      })
      expect(outcome).toEqual({ code: 0, signal: null })
      expect(await markerCount(markerPath)).toBe(1)
      expect(store.get(taskId)).toMatchObject({ status: 'cancelled', attempts: [{ status: 'cancelled' }] })
      await cancelRunner.close()
    } finally {
      store?.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('releases the process claim on hard exit and leaves an unreceipted side effect unknown without replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-project-checks-process-crash-'))
    const markerPath = join(root, 'effects.txt')
    let store: DurableTaskStore | undefined

    try {
      expect(await runWorker(root, markerPath, 'crash-after-effect')).toMatchObject({ code: null, signal: 'SIGKILL' })
      store = await DurableTaskStore.open({ root })
      let executions = 0
      const runner = new DurableTaskRunner({
        table: store,
        newAttemptId: () => '00000000-0000-4000-8000-000000000003',
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

      expect(await markerCount(markerPath)).toBe(1)
      expect(executions).toBe(0)
      expect(runner.get(taskId)).toMatchObject({ status: 'unknown', attempts: [{ id: attemptId, status: 'unknown' }] })
      await runner.close()
    } finally {
      store?.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('reconciles a committed attempt receipt after its owner dies before the task terminal update', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-project-checks-process-receipt-'))
    const markerPath = join(root, 'effects.txt')
    let store: DurableTaskStore | undefined

    try {
      expect(await runWorker(root, markerPath, 'crash-after-receipt')).toMatchObject({ code: null, signal: 'SIGKILL' })
      store = await DurableTaskStore.open({ root })
      let executions = 0
      const runner = new DurableTaskRunner({
        table: store,
        newAttemptId: () => '00000000-0000-4000-8000-000000000003',
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

      expect(await markerCount(markerPath)).toBe(1)
      expect(executions).toBe(0)
      expect(runner.get(taskId)).toMatchObject({ status: 'succeeded', attempts: [{ id: attemptId, status: 'succeeded' }] })
      await runner.close()
    } finally {
      store?.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)
})
