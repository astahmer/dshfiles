import { Context as CordisContext } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Exit, Fiber, Layer, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { DshChildProcessSpawner } from '../src/effect/child-process-spawner.js'
import { HostContext } from '../src/effect/host-context.js'

const subprocessHost = Layer.effect(
  HostContext,
  Effect.acquireRelease(
    Effect.promise(async () => {
      const ctx = new CordisContext()
      await ctx.plugin(LocalSubprocessRuntime)
      return ctx
    }),
    ctx => Effect.promise(() => ctx.fiber.dispose()),
  ).pipe(Effect.map(ctx => HostContext.of({ ctx, packageId: '@test/spawner' }))),
)

const SpawnerLive = DshChildProcessSpawner.layer.pipe(Layer.provide(subprocessHost))

const node = (script: string, options?: ChildProcess.CommandOptions) => ChildProcess.make(process.execPath, ['-e', script], options)

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe.skipIf(process.platform === 'win32')('DshChildProcessSpawner', () => {
  it.layer(SpawnerLive)(layer => {
    layer.effect('collects stdout through the standard spawner helpers', () =>
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        expect(yield* spawner.string(node('process.stdout.write("one\\ntwo\\n")'))).toBe('one\ntwo\n')
        expect(yield* spawner.lines(node('console.log("a"); console.log("b")'))).toEqual(['a', 'b'])
      }),
    )

    layer.effect('reports stderr and a non-zero exit code', () =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* node('process.stderr.write("bad"); process.exit(3)')
          const stderr = yield* Stream.mkString(Stream.decodeText(handle.stderr))
          expect(stderr).toBe('bad')
          expect(yield* handle.exitCode).toBe(3)
          expect(yield* handle.isRunning).toBe(false)
        }),
      ),
    )

    layer.effect('pipes a stdin stream into the child', () =>
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const echo = node('process.stdin.pipe(process.stdout)', { stdin: Stream.encodeText(Stream.make('hello ', 'stdin')) })
        expect(yield* spawner.string(echo)).toBe('hello stdin')
      }),
    )

    layer.effect('passes explicit environment entries over the scrubbed base', () =>
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        expect(yield* spawner.string(node('process.stdout.write(process.env.DSHX_SPAWN_TEST ?? "")', { env: { DSHX_SPAWN_TEST: 'kept' } }))).toBe('kept')
      }),
    )

    layer.effect('fails with a PlatformError when the program does not exist', () =>
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const error = yield* spawner.string(ChildProcess.make('dshx-missing-program-for-test', [])).pipe(Effect.flip)
        expect(error._tag).toBe('PlatformError')
        expect(error.reason._tag).toBe('NotFound')
        expect(error.reason.cause).toMatchObject({ name: 'SubprocessExecutableNotFoundError' })
      }),
    )

    layer.effect('resolves a bare program name through the provider PATH and explicit entries', () =>
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const directory = yield* Effect.acquireRelease(
          Effect.promise(() => mkdtemp(join(tmpdir(), 'dshx-spawner-'))),
          path => Effect.promise(() => rm(path, { recursive: true, force: true })),
        )
        const program = join(directory, 'dshx-resolve-probe')
        yield* Effect.promise(() => writeFile(program, `#!${process.execPath}\nprocess.stdout.write(process.argv[1])\n`, { mode: 0o755 }))
        const pathEntry = `${directory}${delimiter}${process.env['PATH'] ?? ''}`
        expect(yield* spawner.string(ChildProcess.make('dshx-resolve-probe', [], { env: { PATH: pathEntry } }))).toBe(program)
      }).pipe(Effect.scoped),
    )

    layer.effect('rejects shell commands DSH never interprets', () =>
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const error = yield* spawner.string(ChildProcess.make('echo hi', [], { shell: true })).pipe(Effect.flip)
        expect(error.reason._tag).toBe('BadArgument')
      }),
    )

    layer.effect('kills the process when the spawning fiber is interrupted', () =>
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const started = yield* Deferred.make<number>()
        const lines = spawner.streamLines(node('console.log(process.pid); setInterval(() => {}, 1000)'))
        const fiber = yield* Stream.runForEach(lines, line => Deferred.succeed(started, Number(line))).pipe(Effect.forkChild)
        const childPid = yield* Deferred.await(started)
        expect(isAlive(childPid)).toBe(true)
        yield* Fiber.interrupt(fiber)
        expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true)
        expect(isAlive(childPid)).toBe(false)
      }),
    )
  })
})
