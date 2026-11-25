import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { NodeFileSystem } from '@effect/platform-node'
import { Cause, Effect, Exit, FileSystem, Layer, Option } from 'effect'
import { SecretMcp, SecretMcpError } from './secret-mcp-service.js'
import { SecretMcpClient, toRunResult } from './secret-mcp.js'

const fakeServerSource = `#!${process.execPath}
const readline = require('node:readline')
const lines = readline.createInterface({ input: process.stdin })
lines.on('line', line => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05' } }) + '\\n')
    return
  }
  if (message.method !== 'tools/call') return
  const tool = message.params?.name
  if (tool === 'hang') return
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    result: {
      content: [{ type: 'text', text: JSON.stringify({
        exitCode: tool === 'secret_run' ? 0 : 1,
        timedOut: false,
        stdout: 'exit 0 · SYNTHETIC_TOKEN',
        stderr: '',
        injectedAliases: ['SYNTHETIC_TOKEN'],
        echoed: message.params.arguments,
      }) }],
    },
  }) + '\\n')
})
`

const withServer = <A, E>(body: (input: { readonly client: SecretMcpClient; readonly directory: string }) => Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'secret-mcp-' })
    const executable = `${directory}/secret`
    yield* fileSystem.writeFileString(executable, fakeServerSource)
    yield* fileSystem.chmod(executable, 0o755)
    const client = new SecretMcpClient(executable)
    return yield* body({ client, directory }).pipe(Effect.ensuring(Effect.sync(() => client.close())))
  }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer))

describe.skipIf(process.platform === 'win32')('secret mcp client', () => {
  it.live('calls a tool over one persistent server and parses its JSON payload', () =>
    withServer(({ client }) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => client.callTool('secret_check', { alias: 'SYNTHETIC_TOKEN' }))
        expect(result['echoed']).toEqual({ alias: 'SYNTHETIC_TOKEN' })
        const run = toRunResult(result)
        expect(run.injectedAliases).toEqual(['SYNTHETIC_TOKEN'])
        expect(run.stdout).toContain('SYNTHETIC_TOKEN')
      }),
    ),
  )

  it.live('fails a call that the server never answers', () =>
    withServer(({ client }) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(Effect.tryPromise(() => client.callTool('hang', {}, 100)))
        expect(Exit.isFailure(exit)).toBe(true)
        expect(String(exit)).toContain('timed out')
      }),
    ),
  )

  it.effect('reports a missing binary as missing, not as a crash', () =>
    Effect.gen(function* () {
      const previous = process.env['SECRET_BIN']
      process.env['SECRET_BIN'] = 'dshfiles-secret-mcp-missing-for-test'
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const mcp = yield* SecretMcp
          return yield* mcp.run({ command: ['true'], cwd: '/tmp', environment: 'prod' })
        }).pipe(Effect.provide(SecretMcp.layer)),
      )
      if (previous === undefined) delete process.env['SECRET_BIN']
      else process.env['SECRET_BIN'] = previous
      expect(Exit.isFailure(exit)).toBe(true)
      const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none()
      expect(Option.isSome(error)).toBe(true)
      if (Option.isSome(error)) {
        expect(error.value).toBeInstanceOf(SecretMcpError)
        expect(error.value.code).toBe('missing')
      }
    }),
  )

  it.live('records a secret mcp run span with no alias or value', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'secret-mcp-span-' })
      const executable = `${directory}/secret`
      yield* fileSystem.writeFileString(executable, fakeServerSource)
      yield* fileSystem.chmod(executable, 0o755)
      const previous = process.env['SECRET_BIN']
      process.env['SECRET_BIN'] = executable
      yield* Effect.gen(function* () {
        const mcp = yield* SecretMcp
        return yield* mcp.run({ command: ['printenv', 'SYNTHETIC_TOKEN'], cwd: directory, environment: 'prod' })
      }).pipe(Effect.provide(SecretMcp.layer))
      if (previous === undefined) delete process.env['SECRET_BIN']
      else process.env['SECRET_BIN'] = previous
      const span = recorder.span('secret mcp run')
      expect(span.kind).toBe('internal')
      expect(JSON.stringify(span.attributes)).not.toMatch(/SYNTHETIC_TOKEN|printenv/)
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, DshxEffect.tracerLayer))),
  )
})
