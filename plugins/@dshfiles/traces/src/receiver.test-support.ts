import { connect, createServer as createNetServer, type Server as NetServer } from 'node:net'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { Effect, Layer, Schedule, Schema, Stream } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { Forwarder } from './forwarder.js'
import { OtlpIngest } from './otlp-ingest.js'
import { Receiver, type ListenStatus } from './receiver.js'
import { tracesSettings, TracesSettingsService, type TracesSettings } from './settings.js'
import { TraceRepoTest } from './test-layers.test-support.js'

export const defaultSettings: TracesSettings = { ...tracesSettings.schema({}), port: 0 }

/** The receiver over an in-memory store, with test settings a test changes to move or stop the listener. */
const receiverLayer = (initial: Partial<TracesSettings> = {}) =>
  Receiver.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(OtlpIngest.layer, Forwarder.layer.pipe(Layer.provide(FetchHttpClient.layer)))),
    Layer.provideMerge(TraceRepoTest),
    Layer.provideMerge(Settings.layerTest(tracesSettings.namespace, { ...defaultSettings, ...initial })),
  )

const updateSettings = (patch: Partial<TracesSettings>) => TracesSettingsService.use(settings => settings.update(patch))

/** The first listener status (the current one included) that matches. */
const untilListen = (matches: (status: ListenStatus) => boolean) =>
  Receiver.use(receiver => Stream.runHead(Stream.filter(receiver.changes, matches))).pipe(Effect.flatMap(Effect.fromOption), Effect.orDie)

const untilState = (state: ListenStatus['state']) => untilListen(status => status.state === state)

/** Real-time polling of a counter that has no change stream; only for `it.live` tests. */
const eventually = <A>(read: Effect.Effect<A, never, Receiver>, matches: (value: A) => boolean) =>
  read.pipe(Effect.repeat({ until: matches, schedule: Schedule.spaced('10 millis') }), Effect.timeout('5 seconds'), Effect.orDie)

const status = Receiver.use(receiver => receiver.status)

const boundUrl = (path: string) => Effect.map(status, current => `http://127.0.0.1:${String(current.boundPort)}${path}`)

const post = (url: string, init: { readonly headers: Record<string, string>; readonly body: BodyInit }) =>
  Effect.promise(() => fetch(url, { method: 'POST', headers: init.headers, body: init.body }))

const portOf = (server: Pick<NetServer, 'address'>): number => Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address()).port

/** A port another process holds until the scope closes or `release` runs. */
const occupyPort = Effect.gen(function* () {
  const server = createNetServer()
  yield* Effect.callback<void>(resume => {
    server.listen(0, '127.0.0.1', () => resume(Effect.void))
  })
  const release = Effect.callback<void>(resume => {
    if (!server.listening) return resume(Effect.void)
    server.close(() => resume(Effect.void))
  })
  yield* Effect.addFinalizer(() => release)
  return { port: portOf(server), release }
})

const freePort = Effect.scoped(Effect.flatMap(occupyPort, held => Effect.as(held.release, held.port)))

const accepts = (port: number) =>
  Effect.callback<boolean>(resume => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resume(Effect.succeed(true))
    })
    socket.once('error', () => resume(Effect.succeed(false)))
  })

/** A real receiver to drive from tests: settings in, listener status and HTTP out. */
export class ReceiverHarness {
  static readonly defaultSettings = defaultSettings
  static readonly receiverLayer = receiverLayer
  static readonly updateSettings = updateSettings
  static readonly untilListen = untilListen
  static readonly untilState = untilState
  static readonly eventually = eventually
  static readonly status = status
  static readonly boundUrl = boundUrl
  static readonly post = post
  static readonly occupyPort = occupyPort
  static readonly freePort = freePort
  static readonly accepts = accepts
}
