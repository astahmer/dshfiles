import { Effect, Schema, Stream, type Duration } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

/** A tunnel CLI exited with a non-zero code. */
class CommandFailed extends Schema.TaggedError<CommandFailed>()('CommandFailed', { command: Schema.String, exitCode: Schema.Number }) {}

/** Stdout of one CLI run, or its stderr when stdout is empty (cloudflared and tailscale log there). */
export const runCommand = (input: { readonly command: string; readonly args: readonly string[]; readonly timeout?: Duration.Input }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(ChildProcess.make(input.command, [...input.args], { stdin: 'ignore' }))
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode],
        { concurrency: 'unbounded' },
      )
      if (exitCode !== 0) return yield* new CommandFailed({ command: input.command, exitCode })
      return stdout.length > 0 ? stdout : stderr
    }),
  ).pipe(Effect.timeout(input.timeout ?? '20 seconds'))

export const commandExists = (command: string) =>
  runCommand({ command: 'sh', args: ['-c', `command -v ${command}`], timeout: '5 seconds' }).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )
