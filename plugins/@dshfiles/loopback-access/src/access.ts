import { isLoopbackHost, type WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { LoopbackAccessStatus } from './api.js'
import { LoopbackForwarder } from './forwarder.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** This package's active adjunct; absent if startup failed or it was unloaded. */
    dshfilesLoopbackAccess: LoopbackAccess
  }
}

/** Own the adjunct's entire lifetime, including disposal while its listeners start. */
export class LoopbackAccess {
  readonly #server: Pick<WebServer, 'host' | 'port' | 'protocol' | 'getOrigin'>
  #forwarder: LoopbackForwarder | undefined
  #starting: Promise<void> | undefined
  #closed = false
  #state: LoopbackAccessStatus['state'] = 'starting'

  constructor(
    server: Pick<WebServer, 'host' | 'port' | 'protocol' | 'getOrigin'>,
    private readonly enabled = true,
  ) {
    this.#server = server
  }

  start(): Promise<void> {
    this.#starting ??= this.#start()
    return this.#starting
  }

  async #start(): Promise<void> {
    if (this.#closed) return
    if (isLoopbackHost(this.#server.host)) {
      this.#state = 'native-loopback'
      return
    }
    if (!this.enabled) {
      this.#state = 'disabled'
      return
    }
    try {
      const port = this.#server.port
      if (port === undefined) throw new Error('Loopback access requires an initialized Web server port.')
      this.#forwarder = await LoopbackForwarder.start({ host: this.#server.host, port })
      if (this.#closed) await this.#forwarder.close()
      else this.#state = 'forwarding'
    } catch (error) {
      if (!this.#closed) this.#state = 'failed'
      throw error
    }
  }

  status(): LoopbackAccessStatus {
    const port = this.#server.port
    const listeners = this.#forwarder?.listeners() ?? []
    const state = this.#state === 'forwarding' && listeners.length === 0 ? 'failed' : this.#state
    return {
      state,
      upstreamOrigin: port === undefined || this.#server.host.includes('%') ? null : this.#server.getOrigin(),
      localhostOrigin: state === 'forwarding' && port !== undefined ? `${this.#server.protocol}//localhost:${String(port)}` : null,
      listeners,
    }
  }

  async close(): Promise<void> {
    this.#closed = true
    this.#state = 'stopped'
    await this.#starting?.catch(() => undefined)
    await this.#forwarder?.close()
    this.#forwarder = undefined
  }
}
