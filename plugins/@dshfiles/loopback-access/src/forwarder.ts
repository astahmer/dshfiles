import { createServer, isIP, Socket } from 'node:net'
import type { Server } from 'node:net'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { isWildcardHost } from '@deepseek-ai/dsh-host-webserver'
import { startSpan, withSpan } from '@dshfiles/dshx/tracing'

interface ForwardTarget {
  host: string
  port: number
  listenPort?: number
}

interface Listener {
  host: '127.0.0.1' | '::1'
  port: number
}

interface ConnectionPair {
  incoming: Socket
  upstream: Socket
}

const unavailableIPv6 = new Set(['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'])
const maxConnections = 256
const connectTimeoutMs = 5_000
const socketErrorSchema = Schema.Struct({ code: Schema.String.check(Schema.isPattern(/^E[A-Z0-9_]+$/)) })
const listenerAddressSchema = Schema.Struct({
  address: Schema.Literals(['127.0.0.1', '::1']),
  port: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65_535)),
})

function errorCode(error: unknown): string {
  // Do not copy arbitrary error text (which may include connection details).
  const parsed = Schema.decodeUnknownOption(socketErrorSchema)(error)
  return Option.isSome(parsed) ? parsed.value.code : 'UNKNOWN'
}

function validPort(port: number, minimum: number): boolean {
  return Number.isInteger(port) && port >= minimum && port <= 65_535
}

/** A byte-transparent bridge. The caller owns native-address policy and lifetime. */
export class LoopbackForwarder {
  private readonly servers: Server[] = []
  private readonly pairs = new Set<ConnectionPair>()
  private closing = false
  private closePromise: Promise<void> | undefined

  private constructor(private readonly target: { host: string; port: number }) {}

  static async start(target: ForwardTarget): Promise<LoopbackForwarder> {
    if (isIP(target.host) === 0 || isWildcardHost(target.host) || !validPort(target.port, 1) || !validPort(target.listenPort ?? target.port, 0)) {
      throw new Error('Loopback forwarder requires a concrete IP and valid TCP ports')
    }

    const forwarder = new LoopbackForwarder({ host: target.host, port: target.port })
    const port = target.listenPort ?? target.port
    try {
      await forwarder.listen('127.0.0.1', port)
      try {
        await forwarder.listen('::1', port)
      } catch (error) {
        if (!unavailableIPv6.has(errorCode(error))) throw error
      }
      return forwarder
    } catch (error) {
      await forwarder.close()
      throw new Error(`Loopback forwarder could not bind loopback listeners (${errorCode(error)})`)
    }
  }

  /** Fresh snapshots of actual, currently owned listening addresses. */
  listeners(): Listener[] {
    return this.servers.flatMap(server => {
      const parsed = Schema.decodeUnknownOption(listenerAddressSchema)(server.address())
      return Option.isSome(parsed) ? [{ host: parsed.value.address, port: parsed.value.port }] : []
    })
  }

  /** Stop accepting and destroy every pair, including idle streaming connections. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closing = true
    this.closePromise = Promise.all(
      this.servers.map(
        server =>
          new Promise<void>(resolve => {
            server.close(() => resolve())
          }),
      ),
    ).then(() => undefined)
    for (const { incoming, upstream } of this.pairs) {
      incoming.destroy()
      upstream.destroy()
    }
    return this.closePromise
  }

  private listen(host: string, port: number): Promise<void> {
    return withSpan('loopback listen', { attributes: { 'network.type': host === '::1' ? 'ipv6' : 'ipv4' } }, async () => {
      const server = createServer({ allowHalfOpen: true }, socket => this.forward(socket))
      // Retain even a failed listener so rollback also closes any partially opened handle.
      this.servers.push(server)
      await new Promise<void>((resolve, reject) => {
        let bound = false
        server.on('error', (error: Error) => {
          if (!bound) reject(error)
          else void this.close()
        })
        server.once('listening', () => {
          bound = true
          resolve()
        })
        server.listen({ host, port, ipv6Only: true, exclusive: true })
      })
    })
  }

  private forward(incoming: Socket): void {
    // Install before any destroy/connect operation, including refused extra clients.
    incoming.on('error', () => incoming.destroy())
    if (this.closing || this.pairs.size >= maxConnections) {
      incoming.destroy()
      return
    }

    const upstream = new Socket({ allowHalfOpen: true })
    const pair: ConnectionPair = { incoming, upstream }
    this.pairs.add(pair)
    // Connect is event-driven and bounded by the deadline, not the stream's lifetime.
    // Accepted sockets are independent work, not children of the ended listen span.
    const span = startSpan('loopback connect', { kind: 'client', parent: null })
    let connecting = true
    const finishConnect = (outcome: 'connected' | 'closed' | 'timeout' | 'error') => {
      if (!connecting) return
      connecting = false
      span.setAttribute('dshx.loopback-access.outcome', outcome)
      span.setStatus(outcome === 'connected' ? 'ok' : 'error')
      span.end()
    }
    // The socket idle timeout bounds the connect: nothing flows before it, and it is cleared once the upstream connects.
    upstream.setTimeout(connectTimeoutMs)
    upstream.once('timeout', () => {
      finishConnect('timeout')
      incoming.destroy()
      upstream.destroy()
    })

    const destroyPair = () => {
      finishConnect('closed')
      upstream.setTimeout(0)
      incoming.destroy()
      upstream.destroy()
    }
    let closedSockets = 0
    const onClose = () => {
      destroyPair()
      closedSockets += 1
      if (closedSockets === 2) this.pairs.delete(pair)
    }
    const onError = () => {
      finishConnect('error')
      destroyPair()
    }
    incoming.on('error', onError)
    upstream.on('error', onError)
    incoming.once('close', onClose)
    upstream.once('close', onClose)
    upstream.once('connect', () => {
      finishConnect('connected')
      upstream.setTimeout(0)
    })

    // pipe handles stream backpressure and preserves TCP half-close semantics.
    incoming.pipe(upstream)
    upstream.pipe(incoming)
    upstream.connect({
      host: this.target.host,
      port: this.target.port,
      // Keep traffic on the native interface; a removed/reassigned LAN address
      // must fail locally instead of routing authentication bytes off-machine.
      localAddress: this.target.host,
    })
  }
}
