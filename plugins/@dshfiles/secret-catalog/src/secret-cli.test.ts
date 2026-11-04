import { Context as CordisContext } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { DshxEffect, HostContext } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeFileSystem } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { ConfigProvider, Effect, Exit, Fiber, FileSystem, Layer, Schedule, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { SecretCli } from './secret-cli.js'

const subprocessHost = Layer.effect(
  HostContext,
  Effect.acquireRelease(
    Effect.promise(async () => {
      const ctx = new CordisContext()
      await ctx.plugin(LocalSubprocessRuntime)
      return ctx
    }),
    ctx => Effect.promise(() => ctx.fiber.dispose()),
  ).pipe(Effect.map(ctx => HostContext.of({ ctx, packageId: '@dshfiles/secret-catalog-test' }))),
)

const SpawnerLive = DshChildProcessSpawner.layer.pipe(Layer.provide(subprocessHost))

/**
 * A stand-in `secret` executable: it reports what it received as JSON, or follows the behaviour named by the first
 * argument (`exit-2`, `huge`, `hang`, `ignore-stdin`).
 */
const fakeCliSource = `#!${process.execPath}
const fs = require('node:fs')
const [mode] = process.argv.slice(2)
if (mode === 'exit-2') process.exit(2)
if (mode === 'ignore-stdin') process.exit(1)
if (mode === 'huge') { process.stdout.write('x'.repeat(1_100_000)); return }
if (mode === 'hang') { fs.writeFileSync(process.env.SECRET_SESSION_FILE, String(process.pid)); setInterval(() => {}, 1000); return }
let stdin = ''
process.stdin.on('data', chunk => { stdin += chunk })
process.stdin.on('end', () => process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), stdin, bwSession: process.env.BW_SESSION ?? null, sessionFile: process.env.SECRET_SESSION_FILE ?? null, home: process.env.HOME ?? null, foreign: process.env.SYNTHETIC_FOREIGN_SECRET ?? null }) + '\\n'))
`

const Report = Schema.fromJsonString(
  Schema.Struct({
    args: Schema.Array(Schema.String),
    cwd: Schema.String,
    stdin: Schema.String,
    bwSession: Schema.NullOr(Schema.String),
    sessionFile: Schema.NullOr(Schema.String),
    home: Schema.NullOr(Schema.String),
    foreign: Schema.NullOr(Schema.String),
  }),
)

const fakeCli = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'secret-cli-' })
  const executable = `${directory}/secret`
  yield* fileSystem.writeFileString(executable, fakeCliSource)
  yield* fileSystem.chmod(executable, 0o755)
  return { directory, executable }
})

const withCli = <A, E>(body: (input: { readonly cli: SecretCli['Service']; readonly directory: string }) => Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.gen(function* () {
    const fake = yield* fakeCli
    const cli = yield* SecretCli.make(fake.executable)
    return yield* body({ cli, directory: fake.directory })
  }).pipe(Effect.scoped, Effect.provide(SpawnerLive), Effect.provide(NodeFileSystem.layer))

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe.skipIf(process.platform === 'win32')('managed secret CLI', () => {
  it.live('uses argv, pipes manual values on stdin, and forwards only required CLI environment', () =>
    withCli(({ cli, directory }) =>
      Effect.gen(function* () {
        const output = yield* cli.run({
          args: ['set', 'SYNTHETIC_TOKEN', '--env', 'dev'],
          cwd: directory,
          captureStdout: true,
          stdin: 'synthetic-secret-value',
        })
        const report = yield* Schema.decodeUnknownEffect(Report)(output.trim())
        expect(report).toEqual({
          args: ['set', 'SYNTHETIC_TOKEN', '--env', 'dev'],
          cwd: report.cwd,
          stdin: 'synthetic-secret-value',
          bwSession: 'synthetic-session-token',
          sessionFile: '/private/tmp/synthetic-secret-session',
          home: '/private/tmp/synthetic-home',
          foreign: null,
        })
        expect(yield* FileSystem.FileSystem.use(fileSystem => fileSystem.realPath(directory))).toBe(report.cwd)
      }),
    ).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            HOME: '/private/tmp/synthetic-home',
            BW_SESSION: 'synthetic-session-token',
            SECRET_SESSION_FILE: '/private/tmp/synthetic-secret-session',
            SYNTHETIC_FOREIGN_SECRET: 'must-not-be-forwarded',
          }),
        ),
      ),
    ),
  )

  it.live('does not expose CLI stdout for copy and mutation commands', () =>
    withCli(({ cli }) =>
      Effect.gen(function* () {
        expect(yield* cli.run({ args: ['get', 'SYNTHETIC_TOKEN', '--copy'], cwd: null, captureStdout: false })).toBe('')
      }),
    ),
  )

  it.live('tags a failed exit, an oversized output and a CLI that ignores its stdin as cli-failed', () =>
    withCli(({ cli }) =>
      Effect.gen(function* () {
        for (const request of [
          { args: ['exit-2'], cwd: null, captureStdout: true },
          { args: ['huge'], cwd: null, captureStdout: true },
          { args: ['ignore-stdin'], cwd: null, captureStdout: false, stdin: 'synthetic-secret-value'.repeat(10_000) },
        ]) {
          const error = yield* Effect.flip(cli.run(request))
          expect(error).toMatchObject({ _tag: 'SecretCliError', code: 'cli-failed', message: 'Secret CLI command failed.' })
        }
      }),
    ),
  )

  it.live('tags a missing executable as cli-missing', () =>
    Effect.gen(function* () {
      const cli = yield* SecretCli.make('dshfiles-secret-cli-missing-for-test')
      const error = yield* Effect.flip(cli.run({ args: ['print', '--json'], cwd: null, captureStdout: true }))
      expect(error).toMatchObject({ code: 'cli-missing', message: 'Secret CLI executable could not be found on the Host PATH.' })
    }).pipe(Effect.provide(SpawnerLive), Effect.provide(NodeFileSystem.layer)),
  )

  it.effect('tags a command past its deadline as cli-timeout', () =>
    withCli(({ cli, directory }) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(cli.run({ args: ['hang'], cwd: null, captureStdout: true }))
        yield* FileSystem.FileSystem.use(fileSystem => fileSystem.readFileString(`${directory}/pid`)).pipe(
          Effect.retry({ schedule: Schedule.spaced('10 millis'), times: 500 }),
          TestClock.withLive,
        )
        yield* TestClock.adjust('15 seconds')
        const error = yield* Effect.flip(Fiber.join(fiber))
        expect(error).toMatchObject({ code: 'cli-timeout', message: 'Secret CLI command timed out.' })
      }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ SECRET_SESSION_FILE: `${directory}/pid` })))),
    ),
  )

  it.live('kills the managed process when the request is interrupted', () =>
    withCli(({ cli, directory }) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(cli.run({ args: ['hang'], cwd: null, captureStdout: true }))
        const pid = yield* FileSystem.FileSystem.use(fileSystem => fileSystem.readFileString(`${directory}/pid`)).pipe(
          Effect.retry({ schedule: Schedule.spaced('10 millis'), times: 500 }),
          Effect.map(Number),
        )
        expect(isAlive(pid)).toBe(true)
        yield* Fiber.interrupt(fiber)
        expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true)
        expect(isAlive(pid)).toBe(false)
      }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ SECRET_SESSION_FILE: `${directory}/pid` })))),
    ),
  )

  it.live('records a secret <verb> span with flag names only, never the alias or the value', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      yield* withCli(({ cli }) =>
        cli.run({ args: ['set', 'SYNTHETIC_TOKEN', '--env', 'dev'], cwd: null, captureStdout: false, stdin: 'synthetic-secret-value' }),
      )
      const span = recorder.span('secret set')
      expect(span.kind).toBe('client')
      expect(span.attributes['process.command.verb']).toBe('set')
      expect(JSON.stringify(span.attributes)).not.toMatch(/SYNTHETIC_TOKEN|synthetic-secret-value|dev"/)
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
  )
})
