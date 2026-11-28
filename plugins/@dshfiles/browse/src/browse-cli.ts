import { Settings } from '@dshfiles/dshx/effect/settings'
import { Config, Context, Duration, Effect, FileSystem, Layer, Option, Path, Schema, Stream, type Scope } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { browseSettings, type BrowseSettings } from './settings.js'

export const browseSettingsTag = Settings.Tag<BrowseSettings>(browseSettings.namespace)

export class BrowseNotInstalled extends Schema.TaggedError<BrowseNotInstalled>()(
  'BrowseNotInstalled',
  { command: Schema.String },
  { dshxWireCode: 'browse-not-installed' },
) {
  override get message(): string {
    return `The browse CLI (${this.command}) was not found.`
  }
}

export class BrowseCommandFailed extends Schema.TaggedError<BrowseCommandFailed>()(
  'BrowseCommandFailed',
  {
    verb: Schema.String,
    reason: Schema.Literals(['spawn-failed', 'timed-out', 'exit-code']),
    exitCode: Schema.NullOr(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'browse-failed' },
) {
  override get message(): string {
    if (this.reason === 'timed-out') return `browse ${this.verb} did not answer in time.`
    if (this.reason === 'exit-code') return `browse ${this.verb} exited with code ${this.exitCode ?? '?'}.`
    return `browse ${this.verb} could not start.`
  }
}

export interface BrowseOutput {
  readonly exitCode: number
  readonly stdout: string
}

/** One span name per short verb, as literals so the telemetry catalog can find them. */
const RUN_SPANS = { status: 'browse status', 'pair list': 'browse pair list', 'pair revoke': 'browse pair revoke' } as const
type RunVerb = keyof typeof RUN_SPANS

const COMMAND_TIMEOUT = Duration.seconds(15)
const KILL_GRACE = Duration.seconds(2)
const MAX_STDOUT_CHARS = 512 * 1024

/** Where installers put browse when DSH's own PATH (a launchd service, for one) does not list it. */
const fallbackDirectories = (input: { readonly home: string; readonly user: string }): readonly string[] => [
  ...(input.home.length > 0 ? [`${input.home}/.local/bin`, `${input.home}/.nix-profile/bin`] : []),
  ...(input.user.length > 0 ? [`/etc/profiles/per-user/${input.user}/bin`] : []),
  '/run/current-system/sw/bin',
  '/nix/var/nix/profiles/default/bin',
  '/opt/homebrew/bin',
  '/usr/local/bin',
]

/** The configured browse CLI on the DSH spawner: one bounded, traced process per call, never through a shell. */
export class BrowseCli extends Context.Service<
  BrowseCli,
  {
    /** The configured command resolved to an executable path; the setting is read on every call, so a change applies at once. */
    readonly executable: Effect.Effect<string, BrowseNotInstalled>
    readonly command: Effect.Effect<string>
    /** Run one short browse command to completion; a non-zero exit is a value. */
    readonly run: (input: { readonly verb: RunVerb; readonly args: readonly string[] }) => Effect.Effect<BrowseOutput, BrowseNotInstalled | BrowseCommandFailed>
    /** Start a long-running browse command for the caller's Scope; closing it stops the process. */
    readonly spawn: (input: {
      readonly verb: string
      readonly args: readonly string[]
    }) => Effect.Effect<ChildProcessSpawner.ChildProcessHandle, BrowseNotInstalled | BrowseCommandFailed, Scope.Scope>
  }
>()('@dshfiles/browse/BrowseCli') {
  static readonly layer = Layer.effect(
    BrowseCli,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const settings = yield* browseSettingsTag

      const isExecutableFile = (candidate: string) =>
        fileSystem.stat(candidate).pipe(
          Effect.map(info => info.type === 'File' && (info.mode & 0o111) !== 0),
          Effect.orElseSucceed(() => false),
        )

      const command = Effect.map(settings.get, value => {
        const trimmed = value.command.trim()
        return trimmed.length === 0 ? 'browse' : trimmed
      })

      const executable = Effect.gen(function* () {
        const configured = yield* command
        if (configured.includes('/')) {
          if (path.isAbsolute(configured) && (yield* isExecutableFile(configured))) return configured
          return yield* new BrowseNotInstalled({ command: configured })
        }
        const searchPath = yield* Config.String('PATH').pipe(Config.withDefault(''))
        const home = yield* Config.String('HOME').pipe(Config.withDefault(''))
        const user = yield* Config.String('USER').pipe(Config.withDefault(''))
        const directories = [...searchPath.split(':'), ...fallbackDirectories({ home, user })].filter(
          directory => directory.length > 0 && path.isAbsolute(directory),
        )
        const found = yield* Effect.findFirst(
          [...new Set(directories)].map(directory => path.join(directory, configured)),
          isExecutableFile,
        )
        if (Option.isNone(found)) return yield* new BrowseNotInstalled({ command: configured })
        return found.value
      }).pipe(Effect.catchTag('ConfigError', () => Effect.flatMap(command, configured => Effect.fail(new BrowseNotInstalled({ command: configured })))))

      const spawn = Effect.fnUntraced(function* (input: { readonly verb: string; readonly args: readonly string[] }) {
        const resolved = yield* executable
        return yield* spawner
          .spawn(ChildProcess.make(resolved, [...input.args], { stdin: 'ignore', forceKillAfter: KILL_GRACE }))
          .pipe(Effect.mapError(cause => new BrowseCommandFailed({ verb: input.verb, reason: 'spawn-failed', exitCode: null, cause })))
      })

      const collect = (stream: Stream.Stream<Uint8Array, unknown>) =>
        stream.pipe(
          Stream.decodeText,
          Stream.runFold(
            () => '',
            (collected: string, chunk: string) =>
              collected.length >= MAX_STDOUT_CHARS ? collected : collected + chunk.slice(0, MAX_STDOUT_CHARS - collected.length),
          ),
        )

      const run = (input: { readonly verb: RunVerb; readonly args: readonly string[] }) =>
        Effect.gen(function* () {
          const handle = yield* spawn(input)
          const [stdout, exitCode] = yield* Effect.all([collect(handle.stdout), handle.exitCode, Stream.runDrain(handle.stderr)], {
            concurrency: 'unbounded',
          }).pipe(
            Effect.map(([collected, code]) => [collected, Number(code)] as const),
            Effect.mapError(cause => new BrowseCommandFailed({ verb: input.verb, reason: 'spawn-failed', exitCode: null, cause })),
          )
          yield* Effect.annotateCurrentSpan({ 'process.exit.code': exitCode, 'dshx.browse.stdout_chars': stdout.length })
          return { exitCode, stdout } satisfies BrowseOutput
        }).pipe(
          Effect.scoped,
          Effect.timeoutOrElse({
            duration: COMMAND_TIMEOUT,
            orElse: () => Effect.fail(new BrowseCommandFailed({ verb: input.verb, reason: 'timed-out', exitCode: null })),
          }),
          Effect.withSpan(RUN_SPANS[input.verb], { kind: 'client', attributes: { 'dshx.browse.verb': input.verb } }),
        )

      return BrowseCli.of({ executable, command, run, spawn })
    }),
  )
}
