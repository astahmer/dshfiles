import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { SHARED_EVENT_SOURCE_WORKER, sharedEventSourceScript } from './shim.js'

/**
 * Frames the page and its worker exchange. The page sends subscribe/unsubscribe/disconnect;
 * the worker answers ready/open/error/event.
 */
type ShimMessage =
  | { readonly kind: 'subscribe'; readonly url: string; readonly types: readonly string[] }
  | { readonly kind: 'unsubscribe'; readonly url: string }
  | { readonly kind: 'disconnect' }
  | { readonly kind: 'ready'; readonly url: string }
  | { readonly kind: 'open'; readonly url: string }
  | { readonly kind: 'error'; readonly url: string }
  | { readonly kind: 'event'; readonly url: string; readonly event: string; readonly data: string; readonly lastEventId?: string }

/** What a test needs from an EventSource the shim owns, native or proxied. */
interface SharedEventSourceLike {
  readonly readyState: number
  addEventListener(type: string, listener: () => void): void
  close(): void
}

interface PortMessageEvent {
  readonly data: ShimMessage
}

/** One side of a postMessage channel, used for both the worker port and a page's channel to it. */
class TestPort {
  readonly posted: ShimMessage[] = []
  started = false
  onmessage: ((event: PortMessageEvent) => void) | null = null

  postMessage(message: ShimMessage): void {
    this.posted.push(message)
  }

  start(): void {
    this.started = true
  }

  /** Deliver a frame arriving from the other side of the channel. */
  deliver(message: ShimMessage): void {
    this.onmessage?.({ data: message })
  }
}

class NativeEventSourceStub extends EventTarget {
  readonly url: string
  readyState = 0
  closed = false

  constructor(url: string) {
    super()
    this.url = url
  }

  close(): void {
    this.closed = true
  }
}

interface WorkerSelfLike {
  onconnect?: (event: { readonly ports: readonly TestPort[] }) => void
}

const createPageSandbox = () => {
  const nativeSources: NativeEventSourceStub[] = []
  const port = new TestPort()

  class TrackingEventSource extends NativeEventSourceStub {
    constructor(url: string) {
      super(url)
      nativeSources.push(this)
    }
  }

  class StubSharedWorker {
    readonly port = port
    onerror: ((event: Event) => void) | null = null
  }

  const timers = new Map<number, () => void>()
  let lastTimerId = 0
  const sandbox = {
    EventSource: TrackingEventSource,
    SharedWorker: StubSharedWorker,
    document: { baseURI: 'http://localhost/' },
    console,
    EventTarget,
    Event,
    MessageEvent,
    URL,
    setTimeout: (callback: () => void): number => {
      lastTimerId += 1
      timers.set(lastTimerId, callback)
      return lastTimerId
    },
    clearTimeout: (id: number): void => {
      timers.delete(id)
    },
  }
  runInNewContext(sharedEventSourceScript(), sandbox)
  const EventSourceClass = sandbox.EventSource
  return {
    port,
    nativeSources,
    // The shim replaces the slot with its own SharedEventSource; both satisfy this surface.
    open: (url: string): SharedEventSourceLike => new EventSourceClass(url),
    /** Run the pending ready-timeout, which is how a blocked or absent worker triggers fallback. */
    runTimers: (): void => {
      for (const [id, callback] of [...timers]) {
        timers.delete(id)
        callback()
      }
    },
  }
}

const createWorkerSandbox = () => {
  const nativeSources: NativeEventSourceStub[] = []

  class TrackingEventSource extends NativeEventSourceStub {
    constructor(url: string) {
      super(url)
      nativeSources.push(this)
    }
  }

  const workerSelf: WorkerSelfLike = {}
  runInNewContext(SHARED_EVENT_SOURCE_WORKER, { self: workerSelf, EventSource: TrackingEventSource, console })
  return {
    nativeSources,
    connect: (port: TestPort): void => workerSelf.onconnect?.({ ports: [port] }),
  }
}

const postedOfKind = <Kind extends ShimMessage['kind']>(port: TestPort, kind: Kind): readonly Extract<ShimMessage, { kind: Kind }>[] =>
  port.posted.filter((message): message is Extract<ShimMessage, { kind: Kind }> => message.kind === kind)

describe('shared event source worker', () => {
  it('serves two tabs of one URL from one socket and closes it after the last tab leaves', () => {
    const sandbox = createWorkerSandbox()
    const first = new TestPort()
    const second = new TestPort()
    sandbox.connect(first)
    sandbox.connect(second)

    first.deliver({ kind: 'subscribe', url: 'http://localhost/events', types: ['alpha'] })
    second.deliver({ kind: 'subscribe', url: 'http://localhost/events', types: ['alpha', 'beta'] })

    expect(sandbox.nativeSources).toHaveLength(1)
    first.deliver({ kind: 'unsubscribe', url: 'http://localhost/events' })
    expect(sandbox.nativeSources[0]?.closed).toBe(false)
    second.deliver({ kind: 'unsubscribe', url: 'http://localhost/events' })
    expect(sandbox.nativeSources[0]?.closed).toBe(true)
  })
})

describe('shared event source page shim', () => {
  it('closes the native socket a fallback opened when the proxy closes', () => {
    const sandbox = createPageSandbox()
    const source = sandbox.open('http://localhost/events')
    sandbox.runTimers()

    expect(sandbox.nativeSources).toHaveLength(1)
    source.close()
    expect(sandbox.nativeSources[0]?.closed).toBe(true)
  })

  it('tells the worker to disconnect when it falls back', () => {
    const sandbox = createPageSandbox()
    sandbox.open('http://localhost/events')
    sandbox.runTimers()

    expect(postedOfKind(sandbox.port, 'disconnect')).toHaveLength(1)
  })

  it('keeps a sibling alive when one of two same-URL proxies closes', () => {
    const sandbox = createPageSandbox()
    const first = sandbox.open('http://localhost/events')
    const received: string[] = []
    first.addEventListener('alpha', () => received.push('alpha'))
    const second = sandbox.open('http://localhost/events')
    second.addEventListener('beta', () => received.push('beta'))
    sandbox.port.deliver({ kind: 'ready', url: 'http://localhost/events' })

    const requested = new Set(postedOfKind(sandbox.port, 'subscribe').flatMap(message => message.types))
    expect([...requested].sort()).toEqual(['alpha', 'beta'])

    second.close()
    expect(postedOfKind(sandbox.port, 'unsubscribe')).toHaveLength(0)
    expect(postedOfKind(sandbox.port, 'subscribe').at(-1)?.types).toEqual(['alpha'])

    sandbox.port.deliver({ kind: 'event', url: 'http://localhost/events', event: 'alpha', data: 'payload' })
    expect(received).toEqual(['alpha'])

    first.close()
    expect(postedOfKind(sandbox.port, 'unsubscribe')).toHaveLength(1)
  })

  it('unsubscribes exactly once for a repeated close', () => {
    const sandbox = createPageSandbox()
    const source = sandbox.open('http://localhost/events')
    sandbox.port.deliver({ kind: 'ready', url: 'http://localhost/events' })

    source.close()
    source.close()
    expect(postedOfKind(sandbox.port, 'unsubscribe')).toHaveLength(1)
  })
})
