import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { delimiter, join } from 'node:path'
import { Clock, Context, Deferred, Duration, Effect, Exit, FileSystem, Layer, Option, Ref, Schema, Scope, Stream, SynchronizedRef } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import type { PublishStatus } from './share-api.js'
import { ROUTE_PATH } from './share-route.js'

export type PublishProvider = 'tailscale-funnel' | 'cloudflared'
type ToolName = 'tailscale' | 'cloudflared'

/** Where the two CLIs usually live besides PATH: Homebrew on both architectures and the macOS Tailscale app. */
const EXTRA_LOCATIONS = {
  tailscale: ['/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'],
  cloudflared: ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared'],
} as const satisfies Record<ToolName, readonly string[]>

/** The public port a Funnel listens on; 443 usually carries the user's own `tailscale serve`, so it stays untouched. */
export const FUNNEL_HTTPS_PORT = 8443
const READY_TIMEOUT = Duration.seconds(45)
const STOP_GRACE = Duration.seconds(5)
const OUTPUT_TAIL = 8_192

/** The URL each CLI prints once its tunnel accepts traffic. */
const PUBLIC_URL = {
  cloudflared: /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
  'tailscale-funnel': /https:\/\/[a-z0-9.-]+\.ts\.net(?::\d+)?/,
} as const satisfies Record<PublishProvider, RegExp>

/**
 * Arguments of the bounded foreground command. Both commands run in the foreground and stop publishing when the
 * process exits: no `--bg`, no named tunnel, no persisted serve config.
 */
export const tunnelArguments = (input: { readonly provider: PublishProvider; readonly port: number }): readonly string[] =>
  input.provider === 'cloudflared'
    ? ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${String(input.port)}`]
    : ['funnel', `--https=${String(FUNNEL_HTTPS_PORT)}`, `http://127.0.0.1:${String(input.port)}`]

export const toolOf = (provider: PublishProvider): ToolName => (provider === 'cloudflared' ? 'cloudflared' : 'tailscale')

/** Finds the tailscale and cloudflared executables; tests replace it with fakes so nothing is ever published. */
export class PublishExecutables extends Context.Service<PublishExecutables, { readonly find: (tool: ToolName) => Effect.Effect<Option.Option<string>> }>()(
  '@dshfiles/thread-share/PublishExecutables',
) {
  static readonly layer = Layer.effect(
    PublishExecutables,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const exists = (path: string) => fileSystem.exists(path).pipe(Effect.orElseSucceed(() => false))
      const find = Effect.fn('thread share publish detect')(function* (tool: ToolName) {
        const directories = (process.env.PATH ?? '').split(delimiter).filter(directory => directory.length > 0)
        for (const candidate of [...directories.map(directory => join(directory, tool)), ...EXTRA_LOCATIONS[tool]]) {
          if (yield* exists(candidate)) return Option.some(candidate)
        }
        return Option.none<string>()
      })
      return PublishExecutables.of({ find })
    }),
  )
}

/** The tunnel did not start; nothing was published. */
export class PublishFailed extends Schema.TaggedError<PublishFailed>()(
  'PublishFailed',
  {
    reason: Schema.Literals(['not-installed', 'listener', 'spawn', 'exited', 'timeout']),
    tool: Schema.String,
    detail: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'thread-share-publish-failed' },
) {
  override get message(): string {
    switch (this.reason) {
      case 'not-installed':
        return `${this.tool} is not installed. Install it (brew install ${this.tool}), sign in if it needs it, then try again.`
      case 'listener':
        return 'The local share listener could not start. Restart DSH and try again.'
      case 'spawn':
        return `${this.tool} could not be started. Check that it runs from a terminal, then try again.`
      case 'exited':
        return `${this.tool} stopped before publishing${this.detail === undefined ? '' : `: ${this.detail}`}. ${this.tool === 'tailscale' ? 'Turn on Funnel for this machine in the Tailscale admin console (or run `tailscale funnel` once in a terminal) and try again.' : 'Run the same command in a terminal to see why, then try again.'}`
      case 'timeout':
        return `${this.tool} did not print a public URL in time. Check the network, then try again.`
    }
  }
}

interface ActiveTunnel {
  readonly scope: Scope.Closeable
  readonly info: Ref.Ref<NonNullable<PublishStatus['active']>>
}

/** The last stderr/stdout line, without anything that looks like a URL or a path, for the failure message. */
const lastLine = (tail: string): string | undefined => {
  const line = tail
    .trim()
    .split('\n')
    .at(-1)
    ?.replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\/(?:Users|home)\/\S+/g, '<path>')
    .slice(0, 200)
  return line === undefined || line === '' ? undefined : line
}

const notFound = (response: ServerResponse) => {
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' })
  response.end('Not found.')
}

const exitFailure = (input: { readonly tool: string; readonly tail: string }): PublishFailed => {
  const detail = lastLine(input.tail)
  return detail === undefined ? new PublishFailed({ reason: 'exited', tool: input.tool }) : new PublishFailed({ reason: 'exited', tool: input.tool, detail })
}

/** A loopback listener that answers only the share route, so a tunnel never reaches the DSH UI or its API. */
const shareOnlyListener = (handler: (request: IncomingMessage, response: ServerResponse) => void) =>
  Effect.acquireRelease(
    Effect.callback<ReturnType<typeof createServer>, PublishFailed>(resume => {
      const server = createServer((request, response) => {
        const pathname = new URL(request.url ?? '/', 'http://share.invalid').pathname
        if (pathname.startsWith(`${ROUTE_PATH}/`)) handler(request, response)
        else notFound(response)
      })
      server.once('error', cause => resume(Effect.fail(new PublishFailed({ reason: 'listener', tool: 'node', cause }))))
      server.listen(0, '127.0.0.1', () => resume(Effect.succeed(server)))
    }),
    server =>
      Effect.callback<void>(resume => {
        server.close(() => resume(Effect.void))
        server.closeAllConnections()
      }),
  )

const make = Effect.gen(function* () {
  const executables = yield* PublishExecutables
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const active = yield* SynchronizedRef.make(Option.none<ActiveTunnel>())

  const tools = Effect.gen(function* () {
    const tailscale = yield* executables.find('tailscale')
    const cloudflared = yield* executables.find('cloudflared')
    const shape = (found: Option.Option<string>) => ({ available: Option.isSome(found), path: Option.getOrNull(found) })
    return { tailscale: shape(tailscale), cloudflared: shape(cloudflared) }
  })

  const status = Effect.fn('thread share publish status')(function* () {
    const current = yield* SynchronizedRef.get(active)
    const info = Option.isSome(current) ? yield* Ref.get(current.value.info) : null
    const result: PublishStatus = { tools: yield* tools, active: info }
    return result
  })

  const closeActive = (current: Option.Option<ActiveTunnel>) =>
    Option.isSome(current)
      ? Scope.close(current.value.scope, Exit.void).pipe(Effect.timeoutOption(Duration.sum(STOP_GRACE, Duration.seconds(5))), Effect.asVoid)
      : Effect.void

  const stop = Effect.fn('thread share publish stop')(function* () {
    yield* SynchronizedRef.updateEffect(active, current => Effect.as(closeActive(current), Option.none()))
    return yield* status()
  })

  /** Run one tunnel in its own Scope; closing the Scope kills the CLI and closes the listener. */
  const launch = Effect.fn('thread share publish start', { kind: 'client' })(function* (input: {
    readonly provider: PublishProvider
    readonly minutes: number
    readonly handler: (request: IncomingMessage, response: ServerResponse) => void
  }) {
    const tool = toolOf(input.provider)
    yield* Effect.annotateCurrentSpan({
      'dshx.thread_share.provider': input.provider,
      'dshx.thread_share.minutes': input.minutes,
      'process.executable.name': tool,
    })
    const executable = yield* executables.find(tool)
    if (Option.isNone(executable)) return yield* new PublishFailed({ reason: 'not-installed', tool })
    const scope = yield* Scope.make()
    const started = yield* Effect.gen(function* () {
      const server = yield* shareOnlyListener(input.handler)
      // SAFETY: a TCP server listening on a port reports an AddressInfo, never a pipe path.
      const port = (server.address() as AddressInfo).port
      const now = yield* Clock.currentTimeMillis
      const info = yield* Ref.make<NonNullable<PublishStatus['active']>>({
        provider: input.provider,
        state: 'starting',
        publicUrl: null,
        localPort: port,
        startedAt: now,
        stopsAt: now + input.minutes * 60_000,
        detail: null,
      })
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(executable.value, [...tunnelArguments({ provider: input.provider, port })], {
            stdin: 'ignore',
            env: Object.fromEntries(
              ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG'].flatMap(key => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
            ),
            forceKillAfter: STOP_GRACE,
          }),
        )
        .pipe(Effect.mapError(cause => new PublishFailed({ reason: 'spawn', tool, cause })))
      const ready = yield* Deferred.make<string, PublishFailed>()
      const output = { tail: '' }
      const watch = (stream: Stream.Stream<Uint8Array, unknown>) =>
        stream.pipe(
          Stream.decodeText,
          Stream.runForEach(chunk =>
            Effect.suspend(() => {
              output.tail = (output.tail + chunk).slice(-OUTPUT_TAIL)
              const url = PUBLIC_URL[input.provider].exec(output.tail)?.[0]
              return url === undefined ? Effect.void : Deferred.succeed(ready, url)
            }),
          ),
          Effect.ignore,
        )
      yield* Effect.forkScoped(watch(handle.stdout))
      yield* Effect.forkScoped(watch(handle.stderr))
      yield* Effect.forkScoped(
        Effect.ignore(handle.exitCode).pipe(
          Effect.andThen(Deferred.fail(ready, exitFailure({ tool, tail: output.tail }))),
          Effect.andThen(
            Ref.update(info, current => ({ ...current, state: 'failed' as const, detail: lastLine(output.tail) ?? 'The tunnel process exited.' })),
          ),
        ),
      )
      const publicUrl = yield* Deferred.await(ready).pipe(
        Effect.timeoutOrElse({ duration: READY_TIMEOUT, orElse: () => Effect.fail(new PublishFailed({ reason: 'timeout', tool })) }),
      )
      yield* Ref.update(info, current => ({ ...current, state: 'published' as const, publicUrl: publicUrl.replace(/\/$/, '') }))
      return info
    }).pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    )
    const tunnel: ActiveTunnel = { scope, info: started }
    // The bound: the tunnel stops itself after the chosen minutes even if nobody presses Stop. The timer lives in the
    // tunnel's Scope (a replaced or stopped tunnel cancels it); the stop runs detached so it can close that Scope.
    const expire = SynchronizedRef.updateEffect(active, current =>
      Option.isSome(current) && current.value === tunnel ? Effect.as(closeActive(current), Option.none<ActiveTunnel>()) : Effect.succeed(current),
    )
    yield* Effect.forkIn(Effect.sleep(Duration.minutes(input.minutes)).pipe(Effect.andThen(Effect.forkDetach(expire))), scope)
    return tunnel
  })

  const start = Effect.fn('thread share publish request')(function* (input: {
    readonly provider: PublishProvider
    readonly minutes: number
    readonly handler: (request: IncomingMessage, response: ServerResponse) => void
  }) {
    yield* SynchronizedRef.updateEffect(active, current => closeActive(current).pipe(Effect.andThen(launch(input)), Effect.map(Option.some)))
    return yield* status()
  })

  yield* Effect.addFinalizer(() => SynchronizedRef.get(active).pipe(Effect.flatMap(closeActive)))
  return SharePublisher.of({ status: status(), start, stop: stop() })
})

/** The opt-in publish helper: one bounded tunnel at a time, stopped by the user, by its timer, or with the plugin. */
export class SharePublisher extends Context.Service<
  SharePublisher,
  {
    readonly status: Effect.Effect<PublishStatus>
    readonly start: (input: {
      readonly provider: PublishProvider
      readonly minutes: number
      readonly handler: (request: IncomingMessage, response: ServerResponse) => void
    }) => Effect.Effect<PublishStatus, PublishFailed>
    readonly stop: Effect.Effect<PublishStatus>
  }
>()('@dshfiles/thread-share/SharePublisher') {
  static readonly layer = Layer.effect(SharePublisher, make)
}
