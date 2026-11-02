import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { Schema } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { DurableTaskRunner, type DurableTaskResult } from './durable-task-runner.js'
import { DurableTaskStore } from './durable-task-store.js'
import { durableTaskSchema, type DurableTask } from './durable-tasks.js'
import { runManagedProcess } from './managed-process.js'

// The durable queue's observable contract on a real SQLite store and real processes, pinned before it becomes a
// Queue + FiberMap worker (mid-hosts review, "Durable queue").

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const scratchRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'project-checks-queue-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

const openStore = async (root: string): Promise<DurableTaskStore> => {
  const store = await DurableTaskStore.open({ root })
  cleanups.push(async () => store.close())
  return store
}

const queuedTask = (letter: string, createdAt: number): DurableTask =>
  Schema.decodeUnknownSync(durableTaskSchema)({
    id: letter.repeat(64),
    idempotencyKey: `00000000-0000-4000-8000-00000000000${createdAt}`,
    sessionId: 'queue-session',
    actionId: 'test',
    handlerVersion: 1,
    actionFingerprint: 'f'.repeat(64),
    cwd: '/tmp/project',
    status: 'queued',
    attempts: [],
    createdAt,
    updatedAt: createdAt,
    errorCode: null,
  })

let attemptCounter = 0
const makeRunner = (input: {
  readonly table: DurableTaskStore
  readonly run: (task: DurableTask, signal: AbortSignal) => Promise<DurableTaskResult>
}): DurableTaskRunner => {
  const runner = new DurableTaskRunner({
    table: input.table,
    newAttemptId: () => `00000000-0000-4000-9000-${String((attemptCounter += 1)).padStart(12, '0')}`,
    validate: async () => ({ runnable: true, safeReplay: false }),
    findReceipt: async () => null,
    run: ({ task, signal }) => input.run(task, signal),
    onFailure: error => {
      throw error
    },
  })
  cleanups.push(() => runner.close())
  return runner
}

const gate = () => {
  let open: () => void = () => undefined
  const opened = new Promise<void>(resolve => {
    open = resolve
  })
  return { opened, open }
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const subprocessRuntime = async (): Promise<SubprocessRuntime> => {
  const host: TestHost = await createTestHost()
  cleanups.push(() => host.dispose())
  await host.ctx.plugin(LocalSubprocessRuntime)
  const runtime = host.ctx.get('subprocess')
  if (runtime === undefined) throw new Error('The local subprocess runtime did not register.')
  return runtime
}

/** Runs `sleep 30` in the background of a shell and records the grandchild's pid, so group termination is observable. */
const sleeperRun = (input: { readonly subprocess: SubprocessRuntime; readonly root: string; readonly pidFile: string }) => {
  const started = gate()
  const run = async (_task: DurableTask, signal: AbortSignal): Promise<DurableTaskResult> => {
    const running = runManagedProcess({
      subprocess: input.subprocess,
      command: 'sh',
      args: ['-c', `sleep 30 & echo $! > '${input.pidFile}'; wait`],
      cwd: input.root,
      timeoutMs: 60_000,
      signal,
    })
    started.open()
    const result = await running
    if (result.failure === 'cancelled') return { status: 'cancelled', exitCode: null }
    if (result.failure !== null) return { status: 'unknown', exitCode: null }
    return { status: result.exitCode === 0 ? 'succeeded' : 'failed', exitCode: result.exitCode }
  }
  return { run, started: started.opened }
}

const grandchildPid = async (pidFile: string): Promise<number> => {
  try {
    return Number((await readFile(pidFile, 'utf8')).trim())
  } catch {
    return 0
  }
}

describe('durable Project Checks queue characterization', () => {
  it('runs one task at a time, in admission order', async () => {
    const store = await openStore(await scratchRoot())
    const events: string[] = []
    const first = gate()
    const runner = makeRunner({
      table: store,
      run: async task => {
        const letter = task.id.slice(0, 1)
        events.push(`start ${letter}`)
        if (letter === 'a') await first.opened
        events.push(`end ${letter}`)
        return { status: 'succeeded', exitCode: 0 }
      },
    })
    await runner.enqueue(queuedTask('a', 1))
    await runner.enqueue(queuedTask('b', 2))
    await runner.enqueue(queuedTask('c', 3))
    await expect.poll(() => events).toEqual(['start a'])
    expect([runner.get('b'.repeat(64))?.status, runner.get('c'.repeat(64))?.status]).toEqual(['queued', 'queued'])
    first.open()
    await runner.waitForIdle()
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
    expect(['a', 'b', 'c'].map(letter => runner.get(letter.repeat(64))?.status)).toEqual(['succeeded', 'succeeded', 'succeeded'])
  })

  it('cancelling a queued task behind a running one settles it as cancelled and never runs it', async () => {
    const store = await openStore(await scratchRoot())
    const ran: string[] = []
    const first = gate()
    const runner = makeRunner({
      table: store,
      run: async task => {
        ran.push(task.id.slice(0, 1))
        if (task.id.startsWith('a')) await first.opened
        return { status: 'succeeded', exitCode: 0 }
      },
    })
    await runner.enqueue(queuedTask('a', 1))
    await runner.enqueue(queuedTask('b', 2))
    await expect.poll(() => ran).toEqual(['a'])
    expect((await runner.cancel('b'.repeat(64))).status).toBe('cancelled')
    first.open()
    await runner.waitForIdle()
    expect(ran).toEqual(['a'])
    expect(runner.get('b'.repeat(64))).toMatchObject({ status: 'cancelled', attempts: [] })
  })

  it('cancelling a running task terminates its real process group and records the task as cancelled', async () => {
    const root = await scratchRoot()
    const store = await openStore(root)
    const pidFile = join(root, 'sleeper.pid')
    const sleeper = sleeperRun({ subprocess: await subprocessRuntime(), root, pidFile })
    const runner = makeRunner({ table: store, run: sleeper.run })
    await runner.enqueue(queuedTask('a', 1))
    await sleeper.started
    await expect.poll(() => grandchildPid(pidFile)).toBeGreaterThan(0)
    const pid = await grandchildPid(pidFile)
    expect(isAlive(pid)).toBe(true)

    expect((await runner.cancel('a'.repeat(64))).status).toBe('cancel-requested')
    await runner.waitForIdle()

    expect(runner.get('a'.repeat(64))).toMatchObject({ status: 'cancelled', attempts: [{ status: 'cancelled' }] })
    await expect.poll(() => isAlive(pid), { timeout: 5_000 }).toBe(false)
  }, 20_000)

  it('a cancel written through another store connection reaches the running process within the 200 ms poll', async () => {
    const root = await scratchRoot()
    const store = await openStore(root)
    const pidFile = join(root, 'sleeper.pid')
    const sleeper = sleeperRun({ subprocess: await subprocessRuntime(), root, pidFile })
    const runner = makeRunner({ table: store, run: sleeper.run })
    await runner.enqueue(queuedTask('a', 1))
    await sleeper.started
    await expect.poll(() => grandchildPid(pidFile)).toBeGreaterThan(0)
    const pid = await grandchildPid(pidFile)

    const otherHostStore = await openStore(root)
    const otherHost = makeRunner({ table: otherHostStore, run: async () => ({ status: 'succeeded', exitCode: 0 }) })
    expect((await otherHost.cancel('a'.repeat(64))).status).toBe('cancel-requested')

    await runner.waitForIdle()
    expect(store.get('a'.repeat(64))).toMatchObject({ status: 'cancelled', attempts: [{ status: 'cancelled' }] })
    await expect.poll(() => isAlive(pid), { timeout: 5_000 }).toBe(false)
  }, 20_000)

  it('closing the runner marks a claimed running task unknown and stops its process', async () => {
    const root = await scratchRoot()
    const store = await openStore(root)
    const pidFile = join(root, 'sleeper.pid')
    const sleeper = sleeperRun({ subprocess: await subprocessRuntime(), root, pidFile })
    const runner = makeRunner({ table: store, run: sleeper.run })
    await runner.enqueue(queuedTask('a', 1))
    await runner.enqueue(queuedTask('b', 2))
    await sleeper.started
    await expect.poll(() => grandchildPid(pidFile)).toBeGreaterThan(0)
    const pid = await grandchildPid(pidFile)

    await runner.close()

    expect(store.get('a'.repeat(64))?.status).toBe('unknown')
    expect(store.get('b'.repeat(64))?.status).toBe('queued')
    await expect.poll(() => isAlive(pid), { timeout: 5_000 }).toBe(false)
    await expect(runner.enqueue(queuedTask('c', 3))).rejects.toThrow('Durable Project Checks runner is stopping.')
  }, 20_000)

  it('a second Host opening the store after close recovers queued work and leaves the interrupted task unknown', async () => {
    const root = await scratchRoot()
    const first = await DurableTaskStore.open({ root })
    await first.createIfAbsent(queuedTask('a', 1), 1_000)
    await first.update('a'.repeat(64), task => ({ ...task, status: 'running', attempts: [] }))
    await first.createIfAbsent(queuedTask('b', 2), 1_000)
    first.close()

    const store = await openStore(root)
    const ran: string[] = []
    const runner = makeRunner({
      table: store,
      run: async task => {
        ran.push(task.id.slice(0, 1))
        return { status: 'succeeded', exitCode: 0 }
      },
    })
    await runner.recover()
    await runner.waitForIdle()
    expect(ran).toEqual(['b'])
    expect(store.get('a'.repeat(64))?.status).toBe('unknown')
    expect(store.get('b'.repeat(64))?.status).toBe('succeeded')
  })
})

describe('durable task worker claim (SQLite BEGIN IMMEDIATE)', () => {
  it('a second claimant waits while the claim is held and proceeds once it is released', async () => {
    const root = await scratchRoot()
    const holder = await openStore(root)
    const waiter = await openStore(root)
    const events: string[] = []
    const release = gate()
    const held = holder.withWorkerClaim(new AbortController().signal, async () => {
      events.push('holder in')
      await release.opened
      events.push('holder out')
    })
    await expect.poll(() => events).toEqual(['holder in'])
    const waiting = waiter.withWorkerClaim(new AbortController().signal, async () => {
      events.push('waiter in')
    })
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(events).toEqual(['holder in'])
    release.open()
    await Promise.all([held, waiting])
    expect(events).toEqual(['holder in', 'holder out', 'waiter in'])
  })

  it('aborting a waiting claimant rejects with the abort reason and never runs its work', async () => {
    const root = await scratchRoot()
    const holder = await openStore(root)
    const waiter = await openStore(root)
    const release = gate()
    const held = holder.withWorkerClaim(new AbortController().signal, () => release.opened)
    await new Promise(resolve => setTimeout(resolve, 20))
    const controller = new AbortController()
    let ran = false
    const waiting = waiter.withWorkerClaim(controller.signal, async () => {
      ran = true
    })
    await new Promise(resolve => setTimeout(resolve, 80))
    controller.abort(new Error('claim wait cancelled'))
    await expect(waiting).rejects.toThrow()
    expect(ran).toBe(false)
    release.open()
    await held
  })

  it('a claim whose work throws is released for the next claimant', async () => {
    const root = await scratchRoot()
    const first = await openStore(root)
    const second = await openStore(root)
    await expect(
      first.withWorkerClaim(new AbortController().signal, async () => {
        throw new Error('work failed')
      }),
    ).rejects.toThrow('work failed')
    await expect(second.withWorkerClaim(new AbortController().signal, async () => 'claimed')).resolves.toBe('claimed')
  })
})
