import { commandAttributes } from '@dshfiles/dshx/tracing'
import { Context, Duration, Effect, Layer, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

const INSTALL_TIMEOUT = Duration.minutes(5)
const MAX_CLI_OUTPUT_CHARACTERS = 64 * 1024

export interface CliRunResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly cancelled: boolean
}

/** The DSH install CLI could not be started at all. */
export class DshCliUnavailable extends Schema.TaggedError<DshCliUnavailable>()(
  'DshCliUnavailable',
  { cliPath: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'dsh-cli-unavailable' },
) {
  override get message(): string {
    return `The DSH CLI at ${this.cliPath} could not be started. Restart DSH, then retry the install.`
  }
}

const collectText = (stream: Stream.Stream<Uint8Array, unknown>): Effect.Effect<string> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(() => '', (text, chunk) => text + chunk),
    Effect.map(text => (text.length <= MAX_CLI_OUTPUT_CHARACTERS ? text : text.slice(0, MAX_CLI_OUTPUT_CHARACTERS))),
    Effect.orElseSucceed(() => ''),
  )

/**
 * The one process a plugin install runs: fixed argv through the DSH spawner, output bounded, and a timeout or
 * cancellation reported as an outcome rather than as a missing result.
 */
export class MarketplaceProcesses extends Context.Service<
  MarketplaceProcesses,
  {
    readonly runCli: (input: {
      readonly cliPath: string
      readonly args: readonly string[]
      readonly cwd: string
    }) => Effect.Effect<CliRunResult, DshCliUnavailable>
  }
>()('@dshfiles/plugin-marketplace/MarketplaceProcesses') {
  static readonly layer = Layer.effect(
    MarketplaceProcesses,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const runCli = (input: { readonly cliPath: string; readonly args: readonly string[]; readonly cwd: string }) => {
        const attributes = commandAttributes({ executable: 'dsh', args: input.args, valueFlags: ['--profile'] })
        return Effect.gen(function* () {
          yield* Effect.annotateCurrentSpan(attributes)
          const handle = yield* spawner.spawn(
            ChildProcess.make(input.cliPath, [...input.args], {
              cwd: input.cwd,
              stdin: 'ignore',
              forceKillAfter: Duration.seconds(1),
              env: { NO_COLOR: '1' },
            }),
          )
          const [stdout, stderr, exitCode] = yield* Effect.all([collectText(handle.stdout), collectText(handle.stderr), handle.exitCode], {
            concurrency: 'unbounded',
          })
          return { exitCode, stdout, stderr, timedOut: false, cancelled: false } satisfies CliRunResult
        }).pipe(
          Effect.scoped,
          Effect.catch(error => Effect.fail(new DshCliUnavailable({ cliPath: input.cliPath, cause: error }))),
          Effect.withSpan('marketplace install cli', { kind: 'client', attributes: { 'process.executable': 'dsh' } }),
        )
      }

      return MarketplaceProcesses.of({
        runCli: input =>
          runCli(input).pipe(
            Effect.timeoutOption(INSTALL_TIMEOUT),
            Effect.map(outcome =>
              outcome._tag === 'Some' ? outcome.value : { exitCode: null, stdout: '', stderr: '', timedOut: true, cancelled: false },
            ),
          ),
      })
    }),
  )
}
