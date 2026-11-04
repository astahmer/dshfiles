export * as DshChildProcessSpawner from './child-process-spawner.js'

import { sep as pathSeparator } from 'node:path'
import { PassThrough, type Readable } from 'node:stream'
import type { SubprocessHandle, SubprocessOutcome, SubprocessOutputMode, SubprocessSpawnSpec, SubprocessStdinMode } from '@deepseek-ai/dsh-subprocess'
import { fromWritable } from '@effect/platform-node/NodeSink'
import { fromReadable } from '@effect/platform-node/NodeStream'
import { Deferred, Duration, Effect, Layer, Option, PlatformError, Redacted, Schema, type Scope, Sink, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner, CommandLine } from 'effect/process'
import { hostService, type HostContext, type HostServiceMissing } from './host-context.js'

/** DSH reports no OS pid on a subprocess handle; every handle carries this placeholder. */
export const unknownProcessId = ChildProcessSpawner.ProcessId(-1)

const DEFAULT_GRACE_MS = 1_000

const SystemErrorCause = Schema.Struct({ code: Schema.String })
const ExecutableNotFound = Schema.Struct({ name: Schema.Literal('SubprocessExecutableNotFoundError') })
const isExecutableNotFound = Schema.is(ExecutableNotFound)

const systemErrorTag = (cause: unknown): PlatformError.SystemErrorTag => {
  if (isExecutableNotFound(cause)) return 'NotFound'
  const code = Option.getOrUndefined(Schema.decodeUnknownOption(SystemErrorCause)(cause))?.code
  if (code === 'ENOENT') return 'NotFound'
  if (code === 'EACCES' || code === 'EPERM') return 'PermissionDenied'
  if (code === 'EEXIST') return 'AlreadyExists'
  if (code === 'EBUSY') return 'Busy'
  if (code === 'ETIMEDOUT') return 'TimedOut'
  if (code === 'EPIPE') return 'WriteZero'
  if (code === 'EAGAIN') return 'WouldBlock'
  return 'Unknown'
}

const unwrap = (word: CommandLine.Word): string => (Redacted.isRedacted(word) ? Redacted.value(word) : word)

const describeCommand = (command: ChildProcess.StandardCommand): string => CommandLine.display([command.command, ...command.args])

const failure = (command: ChildProcess.StandardCommand, method: string) => (cause: unknown) =>
  PlatformError.systemError({ _tag: systemErrorTag(cause), module: 'ChildProcess', method, pathOrDescriptor: describeCommand(command), cause })

const unsupported = (description: string) => PlatformError.badArgument({ module: 'ChildProcess', method: 'spawn', description })

const stdinOf = (options: ChildProcess.CommandOptions): ChildProcess.StdinConfig => {
  const fallback: ChildProcess.StdinConfig = { stream: 'pipe', encoding: 'utf-8', endOnDone: true }
  if (options.stdin === undefined) return fallback
  if (typeof options.stdin === 'string' || Stream.isStream(options.stdin)) return { ...fallback, stream: options.stdin }
  return { stream: options.stdin.stream, encoding: options.stdin.encoding ?? 'utf-8', endOnDone: options.stdin.endOnDone ?? true }
}

const outputOf = (options: ChildProcess.CommandOptions, name: 'stdout' | 'stderr'): ChildProcess.CommandOutput => {
  const option = options[name]
  if (option === undefined) return 'pipe'
  if (typeof option === 'string' || Sink.isSink(option)) return option
  return option.stream ?? 'pipe'
}

const stdinMode = (stream: ChildProcess.CommandInput): Effect.Effect<SubprocessStdinMode, PlatformError.PlatformError> => {
  if (stream === 'inherit') return Effect.fail(unsupported('A DSH subprocess cannot inherit stdin; pipe the input as a Stream instead.'))
  return Effect.succeed(stream === 'ignore' ? 'ignore' : 'pipe')
}

const outputMode = (stream: ChildProcess.CommandOutput): SubprocessOutputMode => (stream === 'inherit' ? 'inherit' : 'pipe')

const environmentOf = (options: ChildProcess.CommandOptions): NodeJS.ProcessEnv | undefined => {
  if (options.env === undefined) return undefined
  return Object.fromEntries(Object.entries(options.env).map(([name, value]) => [name, value === undefined ? undefined : unwrap(value)]))
}

const specOf = Effect.fnUntraced(function* (command: ChildProcess.StandardCommand) {
  const options = command.options
  if (options.shell !== undefined && options.shell !== false)
    return yield* unsupported('DSH subprocesses never run through a shell; spawn the shell explicitly, e.g. make("sh", ["-c", script]).')
  if (options.additionalFds !== undefined && Object.keys(options.additionalFds).length > 0)
    return yield* unsupported('DSH subprocesses support stdin, stdout and stderr only.')
  if ([command.command, ...command.args.map(unwrap)].some(word => word.includes('\0'))) return yield* unsupported('The command contains a NUL character.')
  const stdin = stdinOf(options)
  const env = environmentOf(options)
  const spec: SubprocessSpawnSpec = {
    argv: [command.command, ...command.args.map(unwrap)],
    cwd: options.cwd ?? globalThis.process.cwd(),
    stdio: { stdin: yield* stdinMode(stdin.stream), stdout: outputMode(outputOf(options, 'stdout')), stderr: outputMode(outputOf(options, 'stderr')) },
    graceMs: options.forceKillAfter === undefined ? DEFAULT_GRACE_MS : Math.max(1, Duration.toMillis(Duration.fromInputUnsafe(options.forceKillAfter))),
    ...(env !== undefined && { env }),
  }
  return { spec, stdin }
})

const isBareName = (program: string): boolean => !program.includes('/') && !program.includes(pathSeparator)

const lookupEnvironment = (env: NodeJS.ProcessEnv | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(env ?? {}).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]])))

const readableStream = (command: ChildProcess.StandardCommand, readable: Readable | undefined, name: string) => {
  if (readable === undefined) return Stream.empty
  const passThrough = new PassThrough()
  readable.on('error', error => passThrough.destroy(error))
  readable.pipe(passThrough)
  return fromReadable({ evaluate: () => passThrough, onError: failure(command, `fromReadable(${name})`) })
}

const exitCodeOf = (command: ChildProcess.StandardCommand, outcome: SubprocessOutcome) =>
  outcome.exitCode === null
    ? Effect.fail(
        PlatformError.systemError({
          _tag: 'Unknown',
          module: 'ChildProcess',
          method: 'exitCode',
          pathOrDescriptor: describeCommand(command),
          description: `Process interrupted due to receipt of signal: '${outcome.signal ?? 'unknown'}'`,
        }),
      )
    : Effect.succeed(ChildProcessSpawner.ExitCode(outcome.exitCode))

/**
 * Terminate the managed process range and wait until it is empty. DSH owns the escalation (its grace period, then a
 * forced kill), so `killSignal` is not honoured and every kill is that one procedure.
 */
const terminate = (command: ChildProcess.StandardCommand, handle: SubprocessHandle) =>
  Effect.tryPromise({
    try: signal => {
      handle.terminate()
      return handle.waitForExit(signal)
    },
    catch: failure(command, 'kill'),
  }).pipe(Effect.asVoid)

export const layer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner, HostServiceMissing, HostContext> = Layer.effect(
  ChildProcessSpawner.ChildProcessSpawner,
  Effect.gen(function* () {
    const subprocess = yield* hostService('subprocess')

    /** A bare program name resolves in the provider's execution world (its scrubbed PATH plus explicit entries). */
    const resolved = (command: ChildProcess.StandardCommand, spec: SubprocessSpawnSpec) => {
      const [program, ...args] = spec.argv
      if (program === undefined || !isBareName(program)) return Effect.succeed(spec)
      return Effect.tryPromise({
        try: signal => subprocess.resolveExecutable(program, lookupEnvironment(spec.env), signal),
        catch: failure(command, 'spawn'),
      }).pipe(Effect.map((executable): SubprocessSpawnSpec => ({ ...spec, argv: [executable, ...args] })))
    }

    const spawnStandard = Effect.fnUntraced(function* (command: ChildProcess.StandardCommand) {
      const prepared = yield* specOf(command)
      const stdin = prepared.stdin
      const spec = yield* resolved(command, prepared.spec)
      const handle = yield* Effect.acquireRelease(Effect.try({ try: () => subprocess.spawn(spec), catch: failure(command, 'spawn') }), spawned =>
        terminate(command, spawned).pipe(Effect.ignore({ log: 'Warn', message: `DSH subprocess ${describeCommand(command)} did not stop cleanly` })),
      )
      const outcome = yield* Deferred.make<SubprocessOutcome, PlatformError.PlatformError>()
      yield* Effect.tryPromise({ try: () => handle.done, catch: failure(command, 'spawn') }).pipe(
        Effect.exit,
        Effect.flatMap(exit => Deferred.done(outcome, exit)),
        Effect.forkScoped,
      )
      const inputFailure = yield* Deferred.make<never, PlatformError.PlatformError>()
      const writable = handle.stdin
      const stdinSink =
        writable === undefined
          ? Sink.drain
          : fromWritable<PlatformError.PlatformError, Uint8Array>({
              evaluate: () => writable,
              onError: failure(command, 'fromWritable(stdin)'),
              endOnDone: stdin.endOnDone,
              encoding: stdin.encoding,
            })
      if (Stream.isStream(stdin.stream))
        yield* Stream.run(
          Stream.tapError(stdin.stream, error => Deferred.fail(inputFailure, error)),
          stdinSink,
        ).pipe(Effect.forkScoped)

      const spawnFailed = Effect.flatMap(Deferred.await(outcome), () => Effect.void)
      const withOutput = (name: 'stdout' | 'stderr', readable: Readable | undefined) => {
        const configured = outputOf(command.options, name)
        const raw = Stream.concat(readableStream(command, readable, name), Stream.fromEffectDrain(spawnFailed))
        if (configured === 'ignore') return { stream: Stream.empty, drain: Stream.runDrain(raw) }
        if (Sink.isSink(configured)) return { stream: Stream.transduce(raw, configured), drain: Effect.void }
        return { stream: raw, drain: Effect.void }
      }
      const stdout = withOutput('stdout', handle.stdout)
      const stderr = withOutput('stderr', handle.stderr)
      yield* Effect.forkScoped(Effect.ignore(stdout.drain))
      yield* Effect.forkScoped(Effect.ignore(stderr.drain))

      return ChildProcessSpawner.makeHandle({
        pid: unknownProcessId,
        exitCode: Effect.raceFirst(Deferred.await(outcome), Deferred.await(inputFailure)).pipe(Effect.flatMap(done => exitCodeOf(command, done))),
        isRunning: Effect.map(Deferred.isDone(outcome), done => !done),
        kill: () => terminate(command, handle),
        stdin: stdinSink,
        stdout: stdout.stream,
        stderr: stderr.stream,
        all: Stream.merge(stdout.stream, stderr.stream),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      })
    })

    const spawn = (command: ChildProcess.Command): Effect.Effect<ChildProcessSpawner.ChildProcessHandle, PlatformError.PlatformError, Scope.Scope> => {
      if (command._tag === 'StandardCommand') return spawnStandard(command)
      return Effect.gen(function* () {
        const source = yield* spawn(command.left)
        if (command.options.to !== undefined && command.options.to !== 'stdin') return yield* unsupported('DSH subprocess pipelines write to stdin only.')
        const from = command.options.from ?? 'stdout'
        if (from !== 'stdout' && from !== 'stderr' && from !== 'all') return yield* unsupported('DSH subprocess pipelines read stdout, stderr or both only.')
        const right = command.right
        const input = source[from]
        const target =
          right._tag === 'StandardCommand'
            ? ChildProcess.make(right.command, right.args, { ...right.options, stdin: { ...stdinOf(right.options), stream: input } })
            : right
        const sink = yield* spawn(target)
        return ChildProcessSpawner.makeHandle({
          ...sink,
          stdin: source.stdin,
          kill: options => Effect.andThen(Effect.ignore(sink.kill(options)), source.kill(options)),
        })
      })
    }

    return ChildProcessSpawner.make(spawn)
  }),
)
