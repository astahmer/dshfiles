/**
 * SharedWorker half. One worker instance per origin owns every EventSource the
 * page surface opens, so N tabs cost one connection per stream instead of N.
 * The worker is created from a Blob URL by the page shim, so no HTTP route is
 * needed.
 */
export const SHARED_EVENT_SOURCE_WORKER = String.raw`
const streams = new Map()

const broadcast = (url, payload) => {
  const entry = streams.get(url)
  if (entry === undefined) return
  for (const port of entry.ports.keys()) {
    try { port.postMessage(payload) } catch {}
  }
}

/** Attach exactly the event types some tab is listening for, plus unnamed 'message'. */
const syncListeners = url => {
  const entry = streams.get(url)
  if (entry === undefined) return
  const wanted = new Set(['message'])
  for (const types of entry.ports.values()) for (const type of types) wanted.add(type)
  for (const [type, listener] of entry.listeners) {
    if (wanted.has(type)) continue
    entry.source.removeEventListener(type, listener)
    entry.listeners.delete(type)
  }
  for (const type of wanted) {
    if (entry.listeners.has(type)) continue
    const listener = event => broadcast(url, { kind: 'event', url, event: type, data: event.data, lastEventId: event.lastEventId })
    entry.source.addEventListener(type, listener)
    entry.listeners.set(type, listener)
  }
}

const open = url => {
  const existing = streams.get(url)
  if (existing !== undefined) return existing
  const entry = { source: new EventSource(url), listeners: new Map(), ports: new Map() }
  entry.source.onopen = () => broadcast(url, { kind: 'open', url })
  entry.source.onerror = () => broadcast(url, { kind: 'error', url })
  streams.set(url, entry)
  return entry
}

/** Drop a URL once no tab wants it: the last subscriber closing releases the socket. */
const release = url => {
  const entry = streams.get(url)
  if (entry === undefined || entry.ports.size > 0) return
  try { entry.source.close() } catch {}
  streams.delete(url)
}

const drop = (port, url) => {
  const entry = streams.get(url)
  if (entry === undefined) return
  entry.ports.delete(port)
  release(url)
}

self.onconnect = event => {
  const port = event.ports[0]
  port.onmessage = message => {
    const data = message.data
    if (data === null || typeof data !== 'object') return
    if (data.kind === 'subscribe') {
      const entry = open(data.url)
      entry.ports.set(port, new Set(Array.isArray(data.types) ? data.types : []))
      syncListeners(data.url)
      try { port.postMessage({ kind: 'ready', url: data.url }) } catch {}
      return
    }
    if (data.kind === 'unsubscribe') { drop(port, data.url); return }
    if (data.kind === 'disconnect') { for (const url of [...streams.keys()]) drop(port, url) }
  }
  port.start()
}
`

/**
 * Page half. Replaces the global EventSource with a proxy that subscribes to
 * the worker, and falls back to a real per-tab EventSource when the worker
 * cannot serve (no SharedWorker, blocked worker, or no `ready` in time) so the
 * failure mode is exactly today's behaviour rather than silence.
 *
 * The worker URL must be one stable same-origin path: SharedWorker identity is
 * the script URL, so a per-tab Blob URL would give every tab its own worker and
 * its own connections.
 */
export const SHARED_EVENT_SOURCE_PAGE = String.raw`
const WORKER_PATH = __WORKER_PATH__
const READY_TIMEOUT_MS = 3000
const KEY = '__dshSharedEventSource'
if (globalThis[KEY] !== true && typeof globalThis.EventSource === 'function' && typeof globalThis.SharedWorker === 'function') {
  globalThis[KEY] = true
  const Native = globalThis.EventSource
  let disabled = false
  try { disabled = globalThis.localStorage?.getItem('dsh:shared-event-source') === 'off' } catch {}
  let worker
  if (!disabled) {
    try { worker = new SharedWorker(WORKER_PATH) } catch { worker = undefined }
  }
  if (worker !== undefined && worker.port !== undefined) {
    const port = worker.port
    const groups = new Map()
    let fellBack = false
    let ready = false
    let readyTimer

    const fallbackAll = reason => {
      if (fellBack) return
      fellBack = true
      globalThis.EventSource = Native
      console.warn('[shared-events] falling back to one EventSource per tab:', reason)
      // The worker stops serving this page, so release the subscriptions it still holds before
      // the proxies take ownership of real sockets.
      try { port.postMessage({ kind: 'disconnect' }) } catch {}
      const instances = [...groups.values()].flatMap(group => [...group])
      groups.clear()
      for (const instance of instances) instance.__attachNative()
    }

    port.onmessage = event => {
      const message = event.data
      if (message === null || typeof message !== 'object') return
      if (message.kind === 'ready') {
        ready = true
        if (readyTimer !== undefined) { clearTimeout(readyTimer); readyTimer = undefined }
        return
      }
      const group = groups.get(message.url)
      if (group === undefined) return
      for (const instance of [...group]) instance.__receive(message)
    }
    port.start()

    const post = message => {
      if (fellBack) return
      try { port.postMessage(message) } catch {}
    }

    class SharedEventSource extends EventTarget {
      constructor(url, config) {
        super()
        // Resolve against the document here: the worker's own base URL would send a
        // relative path like "plugins/events" to the wrong place.
        this.url = new URL(String(url), document.baseURI).href
        this.__url = this.url
        this.__types = new Set()
        this.__listeners = new Map()
        this.__native = null
        this.withCredentials = config?.withCredentials === true
        this.readyState = 0
        this.onopen = null
        this.onmessage = null
        this.onerror = null
        const group = groups.get(this.__url)
        if (group === undefined) groups.set(this.__url, new Set([this]))
        else group.add(this)
        this.__subscribe()
      }

      __subscribe() {
        if (readyTimer === undefined && !ready && !fellBack) {
          readyTimer = setTimeout(() => fallbackAll('no worker ready frame'), READY_TIMEOUT_MS)
        }
        this.__publishTypes()
      }

      /** A page has one worker port, so it carries the union of its instances' event types. */
      __publishTypes() {
        const group = groups.get(this.__url)
        if (group === undefined) {
          post({ kind: 'unsubscribe', url: this.__url })
          return
        }
        const types = new Set()
        for (const instance of group) for (const type of instance.__types) types.add(type)
        post({ kind: 'subscribe', url: this.__url, types: [...types] })
      }

      addEventListener(type, listener, options) {
        if (typeof type === 'string' && typeof listener === 'function') {
          const existing = this.__listeners.get(type)
          if (existing === undefined) this.__listeners.set(type, new Set([listener]))
          else existing.add(listener)
          if (!this.__types.has(type)) {
            this.__types.add(type)
            this.__subscribe()
          }
          if (this.__native !== null) this.__native.addEventListener(type, listener)
        }
        return super.addEventListener(type, listener, options)
      }

      removeEventListener(type, listener, options) {
        if (typeof type === 'string' && typeof listener === 'function') {
          this.__listeners.get(type)?.delete(listener)
          this.__native?.removeEventListener(type, listener)
        }
        return super.removeEventListener(type, listener, options)
      }

      close() {
        if (this.readyState === 2) return
        this.readyState = 2
        const group = groups.get(this.__url)
        group?.delete(this)
        if (group !== undefined && group.size === 0) groups.delete(this.__url)
        if (this.__native !== null) {
          try { this.__native.close() } catch {}
          this.__native = null
        }
        // Only the page's last instance releases the port's subscription; siblings keep it alive.
        if (group === undefined || group.size === 0) post({ kind: 'unsubscribe', url: this.__url })
        else this.__publishTypes()
      }

      /** Worker frame -> the same surface a native EventSource exposes. */
      __receive(message) {
        if (this.readyState === 2) return
        if (message.kind === 'open') { this.readyState = 1; this.__emit('open', new Event('open')); return }
        if (message.kind === 'error') { this.readyState = 0; this.__emit('error', new Event('error')); return }
        if (message.kind === 'event') {
          this.readyState = 1
          this.__emit(message.event, new MessageEvent(message.event, { data: message.data, lastEventId: message.lastEventId ?? '' }))
        }
      }

      /** Last resort: proxy one real per-tab EventSource through this instance. */
      __attachNative() {
        if (this.readyState === 2 || this.__native !== null) return
        const source = new Native(this.__url, this.withCredentials ? { withCredentials: true } : undefined)
        this.__native = source
        source.onopen = () => this.__receive({ kind: 'open' })
        source.onerror = () => this.__receive({ kind: 'error' })
        source.onmessage = event => this.__receive({ kind: 'event', event: 'message', data: event.data, lastEventId: event.lastEventId })
        for (const [type, listeners] of this.__listeners) {
          for (const listener of listeners) source.addEventListener(type, listener)
        }
      }

      __emit(type, event) {
        const handler = this['on' + type]
        if (typeof handler === 'function') {
          try { handler.call(this, event) } catch (error) { console.error('[shared-events] handler threw:', error) }
        }
        this.dispatchEvent(event)
      }
    }

    SharedEventSource.CONNECTING = 0
    SharedEventSource.OPEN = 1
    SharedEventSource.CLOSED = 2
    worker.onerror = () => fallbackAll('worker error')
    globalThis.addEventListener?.('pagehide', () => post({ kind: 'disconnect' }))
    globalThis.EventSource = SharedEventSource
  }
}
`

/** Same-origin path the worker script is served from; every tab shares this one worker. */
export const SHARED_EVENT_SOURCE_WORKER_PATH = 'dshfiles/shared-streams/worker.js'

/** The single inline script the index tap injects, before the app entry module. */
export const sharedEventSourceScript = (workerPath: string = SHARED_EVENT_SOURCE_WORKER_PATH): string => {
  const page = SHARED_EVENT_SOURCE_PAGE.replace('__WORKER_PATH__', JSON.stringify(workerPath))
  return `(() => {${page}\n})()`
}

/** Insert markup immediately after the opening head tag, matching the webserver's own row placement. */
export const injectAfterHead = (html: string, markup: string): string => {
  const open = /<head(?:\s[^>]*)?>/i.exec(html)
  if (open === null) return `${markup}${html}`
  const index = open.index + open[0].length
  return `${html.slice(0, index)}${markup}${html.slice(index)}`
}
