import { Context as CordisContext } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { DshxEffect, HostContext } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { NodeFileSystem } from '@effect/platform-node'
import { Cause, Effect, Exit, FileSystem, Layer, Option } from 'effect'
import { SecretMcp, SecretMcpError } from './secret-mcp-service.js'

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

const SecretMcpLive = SecretMcp.layer.pipe(Layer.provide(DshChildProcessSpawner.layer), Layer.provide(subprocessHost))

/** A stand-in `secret mcp`: it counts its calls, hangs on `hang` and exits on `exit`. */
const fakeServerSource = `#!${process.execPath}
const readline = require('node:readline')
const lines = readline.createInterface({ input: process.stdin })
let calls = 0
lines.on('line', line => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05' } }) + '\\n')
    return
  }
  if (message.method !== 'tools/call') return
  const [program] = message.params.arguments.command
  if (program === 'hang') return
  if (program === 'exit') process.exit(3)
  calls += 1
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    result: {
      content: [{ type: 'text', text: JSON.stringify({
        exitCode: 0,
        timedOut: false,
        stdout: 'call ' + calls + ' · SYNTHETIC_TOKEN',
        stderr: '',
        injectedAliases: ['SYNTHETIC_TOKEN'],
      }) }],
    },
  }) + '\\n')
})
`

const withSecretBin = <A, E, R>(executable: string, body: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env['SECRET_BIN']
      process.env['SECRET_BIN'] = executable
      return previous
    }),
    () => body,
    previous =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env['SECRET_BIN']
        else process.env['SECRET_BIN'] = previous
      }),
  )

const fakeServer = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'secret-mcp-' })
  const executable = `${directory}/secret`
  yield* fileSystem.writeFileString(executable, fakeServerSource)
  yield* fileSystem.chmod(executable, 0o755)
  return { directory, executable }
})

const run = (command: readonly string[], directory: string, timeoutSeconds?: number) =>
  SecretMcp.use(mcp =>
    mcp.run(timeoutSeconds === undefined ? { command, cwd: directory, environment: 'prod' } : { command, cwd: directory, environment: 'prod', timeoutSeconds }),
  )

const errorCodeOf = <A, E>(exit: Exit.Exit<A, E>) => {
  const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none()
  return Option.flatMap(error, value => (value instanceof SecretMcpError ? Option.some(value.code) : Option.none()))
}

describe.skipIf(process.platform === 'win32')('secret mcp service', () => {
  it.live('runs every call on one persistent server and parses its JSON payload', () =>
    Effect.gen(function* () {
      const server = yield* fakeServer
      yield* withSecretBin(
        server.executable,
        Effect.gen(function* () {
          const first = yield* run(['printenv', 'SYNTHETIC_TOKEN'], server.directory)
          const second = yield* run(['printenv', 'SYNTHETIC_TOKEN'], server.directory)
          expect(first.injectedAliases).toEqual(['SYNTHETIC_TOKEN'])
          expect(first.stdout).toBe('call 1 · SYNTHETIC_TOKEN')
          expect(second.stdout).toBe('call 2 · SYNTHETIC_TOKEN')
        }).pipe(Effect.provide(SecretMcpLive)),
      )
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
  )

  it.live(
    'fails a call that the server never answers as a timeout',
    () =>
      Effect.gen(function* () {
        const server = yield* fakeServer
        const exit = yield* withSecretBin(server.executable, Effect.exit(run(['hang'], server.directory, 0).pipe(Effect.provide(SecretMcpLive))))
        expect(errorCodeOf(exit)).toEqual(Option.some('timeout'))
      }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
    15_000,
  )

  it.live('starts a new server after the previous one exited', () =>
    Effect.gen(function* () {
      const server = yield* fakeServer
      yield* withSecretBin(
        server.executable,
        Effect.gen(function* () {
          const crashed = yield* Effect.exit(run(['exit'], server.directory))
          expect(errorCodeOf(crashed)).toEqual(Option.some('missing'))
          const next = yield* run(['printenv', 'SYNTHETIC_TOKEN'], server.directory)
          expect(next.stdout).toBe('call 1 · SYNTHETIC_TOKEN')
        }).pipe(Effect.provide(SecretMcpLive)),
      )
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
  )

  it.live('reports a missing binary as missing, not as a crash', () =>
    Effect.gen(function* () {
      const exit = yield* withSecretBin('dshfiles-secret-mcp-missing-for-test', Effect.exit(run(['true'], '/tmp').pipe(Effect.provide(SecretMcpLive))))
      expect(errorCodeOf(exit)).toEqual(Option.some('missing'))
    }),
  )

  it.live('records a secret mcp run span with no alias or value', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      const server = yield* fakeServer
      yield* withSecretBin(server.executable, run(['printenv', 'SYNTHETIC_TOKEN'], server.directory).pipe(Effect.provide(SecretMcpLive)))
      const span = recorder.span('secret mcp run')
      expect(span.kind).toBe('internal')
      expect(JSON.stringify(span.attributes)).not.toMatch(/SYNTHETIC_TOKEN|printenv/)
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, DshxEffect.tracerLayer))),
  )
})
