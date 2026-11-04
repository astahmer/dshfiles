import type { SubprocessHandle, SubprocessOutcome, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { DshxEffect, HostContext } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { Executables } from './host-promise.js'
import { ProcessRunner } from './managed-process.js'

type FakeSubprocess = Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>

/** A DSH subprocess provider whose process exits on its own or once terminated; a lost range makes `waitForExit` throw. */
const fakeSubprocess = (input: {
  readonly exitCode?: number
  readonly rangeEmpties: boolean
  readonly spawned: (spec: SubprocessSpawnSpec) => void
}): FakeSubprocess => ({
  resolveExecutable: async () => '/usr/local/bin/pnpm',
  spawn: spec => {
    input.spawned(spec)
    let settle: (outcome: SubprocessOutcome) => void = () => undefined
    const done = new Promise<SubprocessOutcome>(resolve => {
      settle = resolve
    })
    if (input.exitCode !== undefined) settle({ exitCode: input.exitCode, signal: null })
    const handle: SubprocessHandle = {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      control: undefined,
      collected: {},
      done,
      terminate: () => settle({ exitCode: null, signal: 'SIGTERM' }),
      waitForExit: () => (input.rangeEmpties ? Promise.resolve(true) : Promise.reject(new Error('The managed range is no longer observable.'))),
    }
    return handle
  },
})

const runnerOver = (subprocess: FakeSubprocess) =>
  Effect.gen(function* () {
    const host = yield* Effect.acquireRelease(
      Effect.promise(() => createTestHost()),
      created => Effect.promise(() => created.dispose()),
    )
    host.ctx.provide('subprocess', subprocess)
    const services = yield* Layer.build(
      ProcessRunner.layer.pipe(
        Layer.provide(Layer.mergeAll(DshChildProcessSpawner.layer, Executables.layer)),
        Layer.provide(HostContext.layer({ ctx: host.ctx, packageId: '@dshfiles/project-checks' })),
      ),
    )
    return Context.get(services, ProcessRunner)
  })

const request = { command: 'pnpm', args: ['run', 'synthetic-private-script'], cwd: '/private/tmp/project', timeoutMs: 5_000 }

describe('managed project-check process', () => {
  it.live('records a project-checks run span with the executable, argument count and exit code, never argv', () =>
    Effect.gen(function* () {
      using recorder = recordSpans()
      const runner = yield* runnerOver(fakeSubprocess({ exitCode: 2, rangeEmpties: true, spawned: () => undefined }))
      const result = yield* runner.run(request).pipe(Effect.provide(DshxEffect.tracerLayer))
      expect(result).toMatchObject({ exitCode: 2, failure: null })
      const span = recorder.span('project-checks run')
      expect(span.attributes).toMatchObject({ 'process.executable.name': 'pnpm', 'dshx.project-checks.argument_count': 2, 'process.exit.code': 2 })
      expect(JSON.stringify(span.attributes)).not.toMatch(/synthetic-private-script|\/private\/tmp/)
    }).pipe(Effect.scoped),
  )

  it.live('an interrupted run ends interrupted once its process group exit is confirmed', () =>
    Effect.gen(function* () {
      const spawned = yield* Deferred.make<void>()
      const runner = yield* runnerOver(fakeSubprocess({ rangeEmpties: true, spawned: () => Deferred.doneUnsafe(spawned, Exit.void) }))
      const running = yield* Effect.forkChild(runner.run(request))
      yield* Deferred.await(spawned)
      yield* Fiber.interrupt(running)
      const exit = yield* Fiber.await(running)
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.live('an interrupted run whose process group cannot confirm its exit dies with ProcessGroupStillRunning', () =>
    Effect.gen(function* () {
      const spawned = yield* Deferred.make<void>()
      const runner = yield* runnerOver(fakeSubprocess({ rangeEmpties: false, spawned: () => Deferred.doneUnsafe(spawned, Exit.void) }))
      const running = yield* Effect.forkChild(runner.run(request))
      yield* Deferred.await(spawned)
      yield* Fiber.interrupt(running)
      const exit = yield* Fiber.await(running)
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
      expect(Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : '').toMatch(/did not confirm its exit/u)
    }).pipe(Effect.scoped),
  )

  it.effect('a run that outlives its timeout and cannot be stopped reports process-group-failed', () =>
    Effect.gen(function* () {
      const runner = yield* runnerOver(fakeSubprocess({ rangeEmpties: false, spawned: () => undefined }))
      const running = yield* Effect.forkChild(runner.run(request))
      yield* TestClock.adjust('5 seconds')
      expect(yield* Fiber.join(running)).toMatchObject({ failure: 'process-group-failed' })
    }).pipe(Effect.scoped),
  )
})
