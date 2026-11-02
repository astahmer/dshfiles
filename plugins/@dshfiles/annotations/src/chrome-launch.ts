import { connect } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { Context, Duration, Effect, Exit, FileSystem, Layer, Option, Schedule, Schema, Scope, SynchronizedRef } from 'effect'
import { HttpClient } from 'effect/http'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { endpointOf } from './chrome-cdp.js'

const MAC_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
const LINUX_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
const WINDOWS_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Chromium\\Application\\chrome.exe',
]

const launchFailures = {
  'no-executable': () => 'No Chrome or Chromium found. Set its path in the annotations settings.',
  'no-free-port': (port: number) => `No free debugging port between ${port} and ${port + 19}.`,
  exited: () => 'Chrome exited right after launch. Quit any window already using that profile and try again.',
  'no-debugging-port': () => 'Chrome did not open a debugging port in time.',
} as const

/** The picker browser could not be started. */
export class ChromeLaunchFailed extends Schema.TaggedError<ChromeLaunchFailed>()(
  'ChromeLaunchFailed',
  {
    reason: Schema.Literals(['no-executable', 'no-free-port', 'exited', 'no-debugging-port']),
    port: Schema.Number,
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'annotations-host-error' },
) {
  override get message(): string {
    return launchFailures[this.reason](this.port)
  }
}

export interface LaunchedChrome {
  readonly port: number
  readonly endpoint: string
}

const VersionInfo = Schema.Struct({ webSocketDebuggerUrl: Schema.String })
const decodeVersionInfo = Schema.decodeUnknownOption(VersionInfo)

/**
 * A configured path wins; otherwise the platform's usual install locations and PATH.
 * Nothing here guesses a browser for a platform it does not know.
 */
export const chromeExecutable = Effect.fn('annotations find chrome')(function* (input: {
  readonly platform: string
  readonly pathValue?: string
  readonly configured?: string
}) {
  const fileSystem = yield* FileSystem.FileSystem
  const exists = (path: string) => fileSystem.exists(path).pipe(Effect.orElseSucceed(() => false))
  const chosen = (input.configured ?? '').trim()
  if (chosen.length > 0) return (yield* exists(chosen)) ? Option.some(chosen) : Option.none<string>()
  const candidates = input.platform === 'darwin' ? MAC_PATHS : input.platform === 'win32' ? WINDOWS_PATHS : LINUX_NAMES
  const searchesPath = input.platform !== 'win32' && input.platform !== 'darwin'
  const directories = (input.pathValue ?? '').split(delimiter).filter(directory => directory.length > 0)
  for (const candidate of candidates) {
    if (yield* exists(candidate)) return Option.some(candidate)
    if (!searchesPath) continue
    for (const directory of directories) if (yield* exists(join(directory, candidate))) return Option.some(join(directory, candidate))
  }
  return Option.none<string>()
})

export const defaultProfileDir = (input: { readonly dshHome: string | undefined }): string =>
  join(input.dshHome === undefined || input.dshHome.length === 0 ? join(homedir(), '.dsh') : input.dshHome, 'plugins', 'annotations', 'chrome-profile')

export const chromeArguments = (input: {
  readonly port: number
  readonly profileDir: string
  readonly startUrl?: string | undefined
  readonly headless?: boolean | undefined
}): string[] => [
  `--remote-debugging-port=${input.port}`,
  `--user-data-dir=${input.profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate',
  // A fresh user-data-dir otherwise triggers macOS's "Keychain Not Found" dialog and
  // blocks the window before any page exists.
  '--password-store=basic',
  '--use-mock-keychain',
  ...(input.headless === true ? ['--headless=new'] : []),
  input.startUrl !== undefined && input.startUrl.trim().length > 0 ? input.startUrl.trim() : 'about:blank',
]

/** Any listener counts as busy: a port can answer something other than our JSON, or nothing at all. */
const portBusy = (port: number) =>
  Effect.callback<boolean>(resume => {
    const socket = connect({ host: '127.0.0.1', port })
    const settle = (busy: boolean): void => {
      socket.destroy()
      resume(Effect.succeed(busy))
    }
    socket.setTimeout(500, () => settle(false))
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
    return Effect.sync(() => socket.destroy())
  })

/**
 * Never attach to a browser we did not start: if the configured port already answers,
 * take the next free one instead of driving someone else's Chrome.
 */
export const freePort = Effect.fn('annotations find free port')(function* (input: { readonly start: number; readonly attempts?: number }) {
  for (let offset = 0; offset < (input.attempts ?? 20); offset += 1) {
    if (!(yield* portBusy(input.start + offset))) return input.start + offset
  }
  return yield* new ChromeLaunchFailed({ reason: 'no-free-port', port: input.start })
})

/** Whether the DevTools endpoint on `port` answers with a browser version. */
export const devtoolsReachable = Effect.fn('annotations probe devtools')(function* (input: { readonly endpoint: string; readonly timeout: Duration.Input }) {
  const client = yield* HttpClient.HttpClient
  return yield* client.get(`${input.endpoint}/json/version`).pipe(
    Effect.flatMap(response => (response.status >= 200 && response.status < 300 ? response.json : Effect.succeed(undefined))),
    Effect.map(body => Option.isSome(decodeVersionInfo(body))),
    Effect.timeoutOption(input.timeout),
    Effect.map(Option.getOrElse(() => false)),
    Effect.orElseSucceed(() => false),
  )
})

export interface ChromeLaunchRequest {
  readonly executable: string
  readonly port: number
  readonly profileDir: string
  readonly startUrl?: string | undefined
  readonly headless?: boolean | undefined
  readonly timeout?: Duration.Input | undefined
}

interface RunningChrome {
  readonly launched: LaunchedChrome
  readonly scope: Scope.Closeable
}

/**
 * The one picker browser this Host launched. It runs as a DSH-managed process in a Scope of its own: stopping it, or
 * unloading the plugin, ends the whole process range, helpers included.
 */
export class ChromeController extends Context.Service<
  ChromeController,
  {
    readonly launched: Effect.Effect<Option.Option<LaunchedChrome>>
    readonly launch: (request: ChromeLaunchRequest) => Effect.Effect<LaunchedChrome, ChromeLaunchFailed>
    readonly stop: Effect.Effect<boolean>
  }
>()('@dshfiles/annotations/ChromeController') {
  static readonly layer = Layer.effect(
    ChromeController,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fileSystem = yield* FileSystem.FileSystem
      const client = yield* HttpClient.HttpClient
      const pluginScope = yield* Effect.scope
      const running = yield* SynchronizedRef.make(Option.none<RunningChrome>())

      const start = Effect.fnUntraced(
        function* (request: ChromeLaunchRequest) {
          const chosen = yield* freePort({ start: request.port })
          // Chrome creates the leaf but not a nested path, and a missing parent makes it exit silently.
          yield* fileSystem.makeDirectory(request.profileDir, { recursive: true }).pipe(Effect.ignore)
          const scope = yield* Scope.fork(pluginScope)
          const endpoint = endpointOf({ port: chosen })
          const launchedChrome = Effect.gen(function* () {
            const handle = yield* spawner
              .spawn(
                ChildProcess.make(
                  request.executable,
                  chromeArguments({ port: chosen, profileDir: request.profileDir, startUrl: request.startUrl, headless: request.headless }),
                  { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
                ),
              )
              .pipe(
                Scope.provide(scope),
                Effect.mapError(cause => new ChromeLaunchFailed({ reason: 'exited', port: chosen, cause })),
              )
            const ready = Effect.gen(function* () {
              const alive = yield* handle.isRunning.pipe(Effect.orElseSucceed(() => false))
              if (!alive) return yield* new ChromeLaunchFailed({ reason: 'exited', port: chosen })
              return yield* devtoolsReachable({ endpoint, timeout: Duration.millis(700) })
            })
            yield* ready.pipe(
              Effect.repeat({ until: reachable => reachable, schedule: Schedule.spaced(Duration.millis(250)) }),
              Effect.timeoutOrElse({
                duration: request.timeout ?? Duration.seconds(12),
                orElse: () => Effect.fail(new ChromeLaunchFailed({ reason: 'no-debugging-port', port: chosen })),
              }),
            )
            return { launched: { port: chosen, endpoint }, scope } satisfies RunningChrome
          })
          return yield* launchedChrome.pipe(Effect.onError(cause => Scope.close(scope, Exit.failCause(cause))))
        },
        Effect.provideService(HttpClient.HttpClient, client),
      )

      return ChromeController.of({
        launched: Effect.map(
          SynchronizedRef.get(running),
          Option.map(chrome => chrome.launched),
        ),
        launch: request =>
          SynchronizedRef.modifyEffect(running, current =>
            Option.match(current, {
              onSome: chrome => Effect.succeed([chrome.launched, current] as const),
              onNone: () => Effect.map(start(request), chrome => [chrome.launched, Option.some(chrome)] as const),
            }),
          ).pipe(Effect.withSpan('annotations launch chrome')),
        stop: SynchronizedRef.modifyEffect(running, current =>
          Option.match(current, {
            onNone: () => Effect.succeed([false, current] as const),
            onSome: chrome => Effect.as(Scope.close(chrome.scope, Exit.void), [true, Option.none<RunningChrome>()] as const),
          }),
        ).pipe(Effect.withSpan('annotations stop chrome')),
      })
    }),
  )
}
