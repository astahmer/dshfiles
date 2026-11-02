import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { HostContext } from '@dshfiles/dshx/effect'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Deferred, Effect, Exit, Fiber, Layer, Ref, Schedule, Scope } from 'effect'
import { DurableTasks, type DurableTaskResult } from './durable-task-runner.js'
import { DurableTaskStore } from './durable-task-store.js'
import { DurableTaskModel } from './durable-tasks.js'
import { Executables } from './host-promise.js'
import { ProcessRunner } from './managed-process.js'
import { DurableTestLayers } from './test-fixtures/durable-layers.js'

const { queuedTask, store: storeLayer, taskStatus, tasks: tasksLayer } = DurableTestLayers

// The durable queue's observable contract on a real SQLite store and real processes: one task at a time, a cancel
// interrupts the attempt and its process group, close leaves a claimed task unknown, a second Host recovers.

const scratchRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), 'project-checks-queue-'))),
  root => Effect.promise(() => rm(root, { recursive: true, force: true })),
)

const task = (letter: string, createdAt: number) =>
  queuedTask({ id: letter.repeat(64), idempotencyKey: `00000000-0000-4000-8000-00000000000${createdAt}`, sessionId: 'queue-session', createdAt })

let attemptCounter = 0
const attemptIds = () => `00000000-0000-4000-9000-${String((attemptCounter += 1)).padStart(12, '0')}`

const build = <ROut, E>(layer: Layer.Layer<ROut, E>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const services = yield* Layer.buildWithScope(layer, scope)
    return { services, close: Scope.close(scope, Exit.void) }
  })

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const eventually = <A>(read: Effect.Effect<A>, accept: (value: A) => boolean) =>
  read.pipe(Effect.repeat({ schedule: Schedule.spaced('25 millis'), until: accept }), Effect.timeout('10 seconds'))

const grandchildPid = (pidFile: string) =>
  Effect.promise(() =>
    readFile(pidFile, 'utf8').then(
      text => Number(text.trim()),
      () => 0,
    ),
  )

const processRunner = Effect.gen(function* () {
  const host = yield* Effect.acquireRelease(
    Effect.promise(() => createTestHost()),
    created => Effect.promise(() => created.dispose()),
  )
  yield* Effect.promise(() => host.ctx.plugin(LocalSubprocessRuntime))
  const services = yield* Layer.build(
    ProcessRunner.layer.pipe(
      Layer.provide(Layer.mergeAll(DshChildProcessSpawner.layer, Executables.layer)),
      Layer.provide(HostContext.layer({ ctx: host.ctx, packageId: '@dshfiles/project-checks' })),
    ),
  )
  return Context.get(services, ProcessRunner)
})

/** Runs `sleep 30` in the background of a shell and records the grandchild's pid, so group termination is observable. */
const sleeperRun = Effect.fnUntraced(function* (input: { readonly root: string; readonly pidFile: string }) {
  const runner = yield* processRunner
  const started = yield* Deferred.make<void>()
  const run = () =>
    Effect.gen(function* () {
      yield* Deferred.succeed(started, undefined)
      const result = yield* runner.run({ command: 'sh', args: ['-c', `sleep 30 & echo $! > '${input.pidFile}'; wait`], cwd: input.root, timeoutMs: 60_000 })
      if (result.failure !== null) return { status: 'unknown', exitCode: null } satisfies DurableTaskResult
      return { status: result.exitCode === 0 ? 'succeeded' : 'failed', exitCode: result.exitCode } satisfies DurableTaskResult
    })
  return { run, started: Deferred.await(started) }
})

describe('durable Project Checks queue characterization', () => {
  it.live('runs one task at a time, in admission order', () =>
    Effect.gen(function* () {
      const root = yield* scratchRoot
      const events = yield* Ref.make<ReadonlyArray<string>>([])
      const first = yield* Deferred.make<void>()
      const queue = yield* build(
        tasksLayer(root, {
          attemptIds,
          run: ({ task: current }) =>
            Effect.gen(function* () {
              const letter = current.id.slice(0, 1)
              yield* Ref.update(events, list => [...list, `start ${letter}`])
              if (letter === 'a') yield* Deferred.await(first)
              yield* Ref.update(events, list => [...list, `end ${letter}`])
              return { status: 'succeeded', exitCode: 0 } satisfies DurableTaskResult
            }),
        }),
      )
      const tasks = Context.get(queue.services, DurableTasks)
      yield* tasks.enqueue(task('a', 1))
      yield* tasks.enqueue(task('b', 2))
      yield* tasks.enqueue(task('c', 3))
      yield* eventually(Ref.get(events), list => list.length === 1)
      expect(yield* Ref.get(events)).toEqual(['start a'])
      const statuses = yield* Effect.forEach(['b', 'c'], letter => taskStatus(letter.repeat(64))).pipe(Effect.provide(queue.services))
      expect(statuses).toEqual(['queued', 'queued'])
      yield* Deferred.succeed(first, undefined)
      yield* tasks.awaitIdle
      expect(yield* Ref.get(events)).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
      const settled = yield* Effect.forEach(['a', 'b', 'c'], letter => taskStatus(letter.repeat(64))).pipe(Effect.provide(queue.services))
      expect(settled).toEqual(['succeeded', 'succeeded', 'succeeded'])
      yield* queue.close
    }).pipe(Effect.scoped),
  )

  it.live('cancelling a queued task behind a running one settles it as cancelled and never runs it', () =>
    Effect.gen(function* () {
      const root = yield* scratchRoot
      const ran = yield* Ref.make<ReadonlyArray<string>>([])
      const first = yield* Deferred.make<void>()
      const queue = yield* build(
        tasksLayer(root, {
          attemptIds,
          run: ({ task: current }) =>
            Effect.gen(function* () {
              yield* Ref.update(ran, list => [...list, current.id.slice(0, 1)])
              if (current.id.startsWith('a')) yield* Deferred.await(first)
              return { status: 'succeeded', exitCode: 0 } satisfies DurableTaskResult
            }),
        }),
      )
      const tasks = Context.get(queue.services, DurableTasks)
      yield* tasks.enqueue(task('a', 1))
      yield* tasks.enqueue(task('b', 2))
      yield* eventually(Ref.get(ran), list => list.length === 1)
      expect((yield* tasks.cancel('b'.repeat(64))).status).toBe('cancelled')
      yield* Deferred.succeed(first, undefined)
      yield* tasks.awaitIdle
      expect(yield* Ref.get(ran)).toEqual(['a'])
      expect(yield* tasks.get('b'.repeat(64))).toMatchObject({ value: { status: 'cancelled', attempts: [] } })
      yield* queue.close
    }).pipe(Effect.scoped),
  )

  it.live(
    'cancelling a running task terminates its real process group and records the task as cancelled',
    () =>
      Effect.gen(function* () {
        const root = yield* scratchRoot
        const pidFile = join(root, 'sleeper.pid')
        const sleeper = yield* sleeperRun({ root, pidFile })
        const queue = yield* build(tasksLayer(root, { attemptIds, run: sleeper.run }))
        const tasks = Context.get(queue.services, DurableTasks)
        yield* tasks.enqueue(task('a', 1))
        yield* sleeper.started
        const pid = yield* eventually(grandchildPid(pidFile), value => value > 0)
        expect(isAlive(pid)).toBe(true)

        expect((yield* tasks.cancel('a'.repeat(64))).status).toBe('cancel-requested')
        yield* tasks.awaitIdle

        expect(yield* tasks.get('a'.repeat(64))).toMatchObject({ value: { status: 'cancelled', attempts: [{ status: 'cancelled' }] } })
        yield* eventually(
          Effect.sync(() => isAlive(pid)),
          alive => !alive,
        )
        yield* queue.close
      }).pipe(Effect.scoped),
    20_000,
  )

  it.live(
    'a cancel written through another store connection reaches the running process within the 200 ms poll',
    () =>
      Effect.gen(function* () {
        const root = yield* scratchRoot
        const pidFile = join(root, 'sleeper.pid')
        const sleeper = yield* sleeperRun({ root, pidFile })
        const queue = yield* build(tasksLayer(root, { attemptIds, run: sleeper.run }))
        const tasks = Context.get(queue.services, DurableTasks)
        yield* tasks.enqueue(task('a', 1))
        yield* sleeper.started
        const pid = yield* eventually(grandchildPid(pidFile), value => value > 0)

        const otherHost = yield* build(storeLayer(root))
        const requested = yield* Context.get(otherHost.services, DurableTaskStore).update('a'.repeat(64), current =>
          DurableTaskModel.cancel(current, Date.now()),
        )
        expect(requested.status).toBe('cancel-requested')

        yield* tasks.awaitIdle
        expect(yield* tasks.get('a'.repeat(64))).toMatchObject({ value: { status: 'cancelled', attempts: [{ status: 'cancelled' }] } })
        yield* eventually(
          Effect.sync(() => isAlive(pid)),
          alive => !alive,
        )
        yield* otherHost.close
        yield* queue.close
      }).pipe(Effect.scoped),
    20_000,
  )

  it.live(
    'closing the runner marks a claimed running task unknown and stops its process',
    () =>
      Effect.gen(function* () {
        const root = yield* scratchRoot
        const pidFile = join(root, 'sleeper.pid')
        const sleeper = yield* sleeperRun({ root, pidFile })
        const queue = yield* build(tasksLayer(root, { attemptIds, run: sleeper.run }))
        const tasks = Context.get(queue.services, DurableTasks)
        yield* tasks.enqueue(task('a', 1))
        yield* tasks.enqueue(task('b', 2))
        yield* sleeper.started
        const pid = yield* eventually(grandchildPid(pidFile), value => value > 0)

        yield* queue.close

        const reopened = yield* build(storeLayer(root))
        const statuses = yield* Effect.forEach(['a', 'b'], letter => taskStatus(letter.repeat(64))).pipe(Effect.provide(reopened.services))
        expect(statuses).toEqual(['unknown', 'queued'])
        yield* eventually(
          Effect.sync(() => isAlive(pid)),
          alive => !alive,
        )
        const refused = yield* Effect.flip(tasks.enqueue(task('c', 3)))
        expect(refused.message).toBe('Durable Project Checks runner is stopping.')
        yield* reopened.close
      }).pipe(Effect.scoped),
    20_000,
  )

  it.live('a second Host opening the store after close recovers queued work and leaves the interrupted task unknown', () =>
    Effect.gen(function* () {
      const root = yield* scratchRoot
      const first = yield* build(storeLayer(root))
      const firstStore = Context.get(first.services, DurableTaskStore)
      yield* firstStore.createIfAbsent({ task: task('a', 1) })
      yield* firstStore.update('a'.repeat(64), current => ({ ...current, status: 'running', attempts: [] }))
      yield* firstStore.createIfAbsent({ task: task('b', 2) })
      yield* first.close

      const ran = yield* Ref.make<ReadonlyArray<string>>([])
      const queue = yield* build(
        tasksLayer(root, {
          attemptIds,
          run: ({ task: current }) =>
            Ref.update(ran, list => [...list, current.id.slice(0, 1)]).pipe(Effect.as({ status: 'succeeded', exitCode: 0 } satisfies DurableTaskResult)),
        }),
      )
      yield* Context.get(queue.services, DurableTasks).awaitIdle
      expect(yield* Ref.get(ran)).toEqual(['b'])
      const statuses = yield* Effect.forEach(['a', 'b'], letter => taskStatus(letter.repeat(64))).pipe(Effect.provide(queue.services))
      expect(statuses).toEqual(['unknown', 'succeeded'])
      yield* queue.close
    }).pipe(Effect.scoped),
  )
})

describe('durable task worker claim (SQLite BEGIN IMMEDIATE)', () => {
  it.live('a second claimant waits while the claim is held and proceeds once it is released', () =>
    Effect.gen(function* () {
      const root = yield* scratchRoot
      const holder = Context.get((yield* build(storeLayer(root))).services, DurableTaskStore)
      const waiter = Context.get((yield* build(storeLayer(root))).services, DurableTaskStore)
      const events = yield* Ref.make<ReadonlyArray<string>>([])
      const release = yield* Deferred.make<void>()
      const held = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* holder.claimWorker
          yield* Ref.update(events, list => [...list, 'holder in'])
          yield* Deferred.await(release)
          yield* Ref.update(events, list => [...list, 'holder out'])
        }),
      ).pipe(Effect.forkChild)
      yield* eventually(Ref.get(events), list => list.length === 1)
      const waiting = yield* Effect.scoped(
        Effect.andThen(
          waiter.claimWorker,
          Ref.update(events, list => [...list, 'waiter in']),
        ),
      ).pipe(Effect.forkChild)
      yield* Effect.sleep('150 millis')
      expect(yield* Ref.get(events)).toEqual(['holder in'])
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(held)
      yield* Fiber.join(waiting)
      expect(yield* Ref.get(events)).toEqual(['holder in', 'holder out', 'waiter in'])
    }).pipe(Effect.scoped),
  )

  it.live('interrupting a waiting claimant never runs its work', () =>
    Effect.gen(function* () {
      const root = yield* scratchRoot
      const holder = Context.get((yield* build(storeLayer(root))).services, DurableTaskStore)
      const waiter = Context.get((yield* build(storeLayer(root))).services, DurableTaskStore)
      const release = yield* Deferred.make<void>()
      const claimed = yield* Deferred.make<void>()
      const held = yield* Effect.scoped(Effect.andThen(holder.claimWorker, Effect.andThen(Deferred.succeed(claimed, undefined), Deferred.await(release)))).pipe(
        Effect.forkChild,
      )
      yield* Deferred.await(claimed)
      const ran = yield* Ref.make(false)
      const waiting = yield* Effect.scoped(Effect.andThen(waiter.claimWorker, Ref.set(ran, true))).pipe(Effect.forkChild)
      yield* Effect.sleep('80 millis')
      yield* Fiber.interrupt(waiting)
      expect(yield* Ref.get(ran)).toBe(false)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(held)
    }).pipe(Effect.scoped),
  )

  it.live('a claim whose work fails is released for the next claimant', () =>
    Effect.gen(function* () {
      const root = yield* scratchRoot
      const first = Context.get((yield* build(storeLayer(root))).services, DurableTaskStore)
      const second = Context.get((yield* build(storeLayer(root))).services, DurableTaskStore)
      const failed = yield* Effect.flip(Effect.scoped(Effect.andThen(first.claimWorker, Effect.fail('work failed'))))
      expect(failed).toBe('work failed')
      expect(yield* Effect.scoped(Effect.as(second.claimWorker, 'claimed'))).toBe('claimed')
    }).pipe(Effect.scoped),
  )
})
