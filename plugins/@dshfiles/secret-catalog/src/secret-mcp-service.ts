import { Context, Effect, Layer, Ref, Schema } from 'effect'
import { type SecretMcpRunResult, SecretMcpClient, toRunResult } from './secret-mcp.js'

export interface SecretMcpShape {
  readonly run: (input: {
    readonly command: readonly string[]
    readonly cwd: string
    readonly environment: string
    readonly timeoutSeconds?: number
  }) => Effect.Effect<SecretMcpRunResult, SecretMcpError>
}

const failureMessages = {
  missing: 'The secret CLI (`secret mcp`) is not on the Host PATH.',
  timeout: 'secret mcp did not answer in time.',
  failed: 'secret mcp failed.',
} as const

export class SecretMcpError extends Schema.TaggedError<SecretMcpError>()(
  'SecretMcpError',
  { code: Schema.Literals(['missing', 'timeout', 'failed']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'secret-mcp-error' },
) {
  override get message(): string {
    return failureMessages[this.code]
  }
}

const codeOf = (error: unknown): SecretMcpError['code'] => {
  const text = error instanceof Error ? error.message : String(error)
  if (/ENOENT|exited/.test(text)) return 'missing'
  if (/timed out/.test(text)) return 'timeout'
  return 'failed'
}

/** `secret mcp` as a service: one long-lived server per Host, values never cross it. */
export class SecretMcp extends Context.Service<SecretMcp, SecretMcpShape>()('@dshfiles/secret-catalog/SecretMcp') {
  static readonly layer = Layer.effect(
    SecretMcp,
    Effect.gen(function* () {
      // Started on first use: a Host that never runs a command keeps no child.
      const client = yield* Ref.make<SecretMcpClient | undefined>(undefined)
      const acquire = Effect.sync(() => new SecretMcpClient())
      const shared = Ref.get(client).pipe(
        Effect.flatMap(current =>
          current === undefined
            ? acquire.pipe(
                Effect.tap(created => Ref.set(client, created)),
                Effect.map(created => created),
              )
            : Effect.succeed(current),
        ),
      )
      return SecretMcp.of({
        run: input =>
          shared.pipe(
            Effect.flatMap(server =>
              Effect.tryPromise({
                try: () =>
                  server.callTool(
                    'secret_run',
                    { command: [...input.command], cwd: input.cwd, env: input.environment, timeoutSeconds: input.timeoutSeconds ?? 60 },
                    ((input.timeoutSeconds ?? 60) + 5) * 1000,
                  ),
                catch: error => new SecretMcpError({ code: codeOf(error), cause: error }),
              }),
            ),
            Effect.map(toRunResult),
            Effect.withSpan('secret mcp run'),
          ),
      })
    }),
  )

  static readonly layerTest = (run: SecretMcpShape['run']) => Layer.succeed(SecretMcp, SecretMcp.of({ run }))
}
