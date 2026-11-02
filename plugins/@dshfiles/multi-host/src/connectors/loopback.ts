import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { Effect, Option, Schema, type Scope } from 'effect'
import { InvalidRuntimeLocator, LoopbackForwardUnavailable, LoopbackUnavailable } from '../errors.js'

const boundAddressSchema = Schema.Struct({
  port: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65_535)),
})
const decodeBoundAddress = Schema.decodeUnknownOption(boundAddressSchema)
const portSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65_535))
const isPort = Schema.is(portSchema)

export interface LoopbackEndpoint {
  readonly address: string
  readonly port: number
}

const loopbackAddress = '127.0.0.1'

const listen = (input: { readonly server: Server; readonly port: number }) =>
  Effect.callback<number, LoopbackUnavailable>(resume => {
    input.server.once('error', () => resume(Effect.fail(new LoopbackUnavailable({ port: input.port }))))
    input.server.listen({ host: loopbackAddress, port: input.port }, () =>
      resume(
        Option.match(decodeBoundAddress(input.server.address()), {
          onNone: () => Effect.fail(new LoopbackUnavailable({ port: input.port })),
          onSome: bound => Effect.succeed(bound.port),
        }),
      ),
    )
  })

const close = (server: Server) =>
  Effect.callback<void>(resume => {
    if (!server.listening) return resume(Effect.void)
    server.close(() => resume(Effect.void))
  })

/** Check that `port` (or any free port, for 0) is free on the loopback address right now; nothing stays bound. */
const reserve = Effect.fn('multi-host loopback reserve')(function* (port = 0) {
  if (!isPort(port)) return yield* new InvalidRuntimeLocator()
  const probe = createServer()
  const bound = yield* listen({ server: probe, port }).pipe(Effect.ensuring(close(probe)))
  return { address: loopbackAddress, port: bound } satisfies LoopbackEndpoint
})

const isLoopbackHost = (hostname: string): boolean => {
  const parts = hostname.split('.')
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    (parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255))
  )
}

/** A loopback TCP forward to a local runtime's HTTP origin, open for the Scope; its sockets close with it. */
const forward = Effect.fn('multi-host loopback forward')(function* (input: { readonly target: URL; readonly originPort?: number | undefined }) {
  const targetHost = input.target.hostname.replace(/^\[|\]$/g, '')
  if (input.target.protocol !== 'http:' || !isLoopbackHost(targetHost)) return yield* new InvalidRuntimeLocator()
  const endpoint = yield* reserve(input.originPort)
  const targetPort = input.target.port === '' ? 80 : Number(input.target.port)
  const sockets = new Set<Socket>()
  const server = createServer(client => {
    const upstream = createConnection({ host: targetHost, port: targetPort })
    client.once('error', () => upstream.destroy())
    client.once('close', () => upstream.destroy())
    upstream.once('error', () => client.destroy())
    upstream.once('close', () => client.destroy())
    upstream.once('connect', () => {
      if (client.destroyed) return upstream.destroy()
      client.pipe(upstream).pipe(client)
    })
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  yield* Effect.acquireRelease(listen({ server, port: endpoint.port }).pipe(Effect.mapError(() => new LoopbackForwardUnavailable())), () =>
    Effect.suspend(() => {
      for (const socket of sockets) socket.destroy()
      return close(server)
    }),
  )
  return endpoint
}) satisfies (input: { readonly target: URL; readonly originPort?: number | undefined }) => Effect.Effect<LoopbackEndpoint, unknown, Scope.Scope>

export class Loopback {
  static readonly reserve = reserve
  static readonly forward = forward
}
