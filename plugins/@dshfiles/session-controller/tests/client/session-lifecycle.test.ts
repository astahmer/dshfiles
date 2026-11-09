import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import { Session } from '../../src/native/client/sessions/session.js'
import type { SessionRemotes } from '../../src/native/client/sessions/remotes.js'
import type { SessionAddress } from '../../src/native/types.js'

const OPENING_SEQ = 5

/** Opening request the Session event stream hands its journal source. */
interface FollowRequest {
  readonly address: SessionAddress
  readonly assistantStream?: boolean
}

const deferred = <Value>() => {
  const settled = Promise.withResolvers<Value>()
  return { promise: settled.promise, resolve: settled.resolve, reject: settled.reject }
}

/** One journal opening page (a single durable event), a live tail that fails on demand, and a page read held open. */
const createJournal = () => {
  const failure = deferred<never>()
  // The tail generator awaits this rejection; keep it observed even when a test never fails the journal.
  failure.promise.catch(() => undefined)
  const page = deferred<unknown>()
  const calls = { follow: 0, page: 0 }
  const follow = async function* (_request: FollowRequest, signal: AbortSignal) {
    calls.follow += 1
    yield {
      type: 'snapshot',
      cursor: OPENING_SEQ,
      records: [{ type: 'event', event: { type: 'test/opening', seq: OPENING_SEQ, time: 1, data: {} } }],
      hasMore: true,
      projections: { values: {}, asOfSeq: OPENING_SEQ },
      assistantStream: { revision: 0 },
    }
    await new Promise<void>((resolve, reject) => {
      failure.promise.then(resolve, reject)
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
  }
  const readPage = async () => {
    calls.page += 1
    return page.promise
  }
  return {
    follow,
    readPage,
    calls,
    fail: (error: unknown) => failure.reject(error),
    settlePage: (error: unknown) => page.reject(error),
  }
}

interface FakeStream {
  readonly signal: AbortSignal
  restart(): void
  dispose(): Promise<void>
  [Symbol.asyncIterator](): AsyncIterator<{ generation: number; value: unknown; signal: AbortSignal; accept(): void }>
}

/** Gateway stream double: the fake journal is the opener, and disposal can be held open by a test. */
const createTransport = () => {
  const streams: { readonly lifetime: AbortController; readonly disposed: Promise<void>; release(): void; readonly closed: boolean }[] = []
  const $stream = (options: { readonly open: (signal: AbortSignal) => AsyncIterable<unknown> }): FakeStream => {
    const lifetime = new AbortController()
    const disposal = deferred<void>()
    const record = {
      lifetime,
      disposed: disposal.promise,
      release: () => disposal.resolve(),
      get closed() {
        return lifetime.signal.aborted
      },
    }
    streams.push(record)
    return {
      get signal() {
        return lifetime.signal
      },
      restart: () => {},
      dispose: () => {
        lifetime.abort(new Error('stream disposed'))
        return record.disposed
      },
      [Symbol.asyncIterator]: async function* () {
        for await (const value of options.open(lifetime.signal)) {
          yield { generation: 1, value, signal: lifetime.signal, accept: () => {} }
        }
      },
    }
  }
  return { $stream, streams }
}

type Journal = ReturnType<typeof createJournal>
type JournalSource = Omit<Journal, 'follow'> & { readonly follow: (request: FollowRequest, signal: AbortSignal) => AsyncIterable<unknown> }

const createSession = (journal: JournalSource = createJournal(), transport = createTransport()) => {
  const failure = () => new RemoteError('gateway/internal', 'journal failure', {})
  // SAFETY: the Gateway streams, journal and prompt method are the exact transport subset a Session reads.
  const remotes = {
    $stream: transport.$stream,
    session: {
      follow: journal.follow,
      page: journal.readPage,
      prompt: async () => ({ ok: true, value: { accepted: true } }),
    },
  } as unknown as SessionRemotes
  const session = new Session(SessionId('session-lifecycle-test'), remotes)
  return { session, journal, transport, failure }
}

const lifecycle = (session: Session) => {
  const snapshot = session.getSnapshot()
  return {
    openState: snapshot.openState,
    loadingOlder: snapshot.loadingOlder,
    blank: snapshot.blank,
    promptAttempted: snapshot.promptAttempted,
    awaitingFirstTurn: snapshot.awaitingFirstTurn,
  }
}

describe('Session history lifecycle', () => {
  it('invalidates the open window before a resync waits for stream teardown', async () => {
    const { session, journal, transport } = createSession()
    await session.open()
    expect(lifecycle(session).openState).toBe('open')

    const resync = session.resync()
    expect(lifecycle(session).openState).not.toBe('open')

    await session.open()
    expect(journal.calls.follow).toBe(2)

    transport.streams[0]?.release()
    await resync
    expect(lifecycle(session).openState).toBe('open')
    expect(journal.calls.follow).toBe(2)
    transport.streams.forEach(stream => {
      stream.release()
    })
    await session.dispose()
  })

  it('leaves no paging state behind when the stream fails mid-jump', async () => {
    const { session, journal, failure } = createSession()
    await session.open()
    const jumping = session.loadThrough(SessionSeq(2))
    expect(lifecycle(session).loadingOlder).toBe(true)

    journal.fail(failure())
    await expect.poll(() => lifecycle(session).openState).toBe('error')
    expect(lifecycle(session).loadingOlder).toBe(false)

    journal.settlePage(failure())
    await jumping
    expect(lifecycle(session)).toMatchObject({ openState: 'error', loadingOlder: false })
    await session.dispose()
  })
})

describe('Session composer phase', () => {
  it('engages on a local submission before the prompt is sent', () => {
    const { session } = createSession()
    expect(lifecycle(session)).toMatchObject({ blank: true, promptAttempted: false, awaitingFirstTurn: false })

    session.beginSubmission({ mode: 'queue', text: 'hello', attachments: [] })
    expect(lifecycle(session)).toMatchObject({ blank: true, promptAttempted: true, awaitingFirstTurn: false })
  })

  it('keeps the first accepted prompt awaiting its turn until one is observed', async () => {
    const { session } = createSession()
    await session.prompt([{ type: 'text', text: 'hello' }], 'queue')
    expect(lifecycle(session)).toMatchObject({ blank: false, promptAttempted: true, awaitingFirstTurn: true })

    session.handleRunning(true)
    expect(lifecycle(session)).toMatchObject({ blank: false, promptAttempted: true, awaitingFirstTurn: false })
  })

  it('refuses to re-blank a session that was attempted or is running', async () => {
    const attempted = createSession().session
    await attempted.prompt([{ type: 'text', text: 'hello' }], 'queue')
    attempted.handleBlank(true)
    expect(lifecycle(attempted).blank).toBe(false)
    await attempted.dispose()

    const running = createSession().session
    running.handleRunning(true)
    running.handleBlank(true)
    expect(lifecycle(running).blank).toBe(false)
    await running.dispose()

    const untouched = createSession().session
    untouched.handleBlank(false)
    untouched.handleBlank(true)
    expect(lifecycle(untouched).blank).toBe(true)
    await untouched.dispose()
  })
})

describe('Session live assistant chunks', () => {
  it('keeps the Session snapshot identity while chunks only grow the event window', async () => {
    const chunks = 5
    const go = deferred<void>()
    const streamed = deferred<void>()
    const follow = async function* (_request: FollowRequest, signal: AbortSignal) {
      yield {
        type: 'snapshot',
        cursor: OPENING_SEQ,
        records: [{ type: 'event', event: { type: 'test/opening', seq: OPENING_SEQ, time: 1, data: {} } }],
        hasMore: false,
        projections: { values: {}, asOfSeq: OPENING_SEQ },
        assistantStream: { revision: 0 },
      }
      await go.promise
      yield { type: 'assistant-stream', frame: { type: 'start', attemptId: 'attempt-1', revision: 1, startedAfterSeq: OPENING_SEQ, turn: 1, step: 1 } }
      for (let index = 0; index < chunks; index++) {
        yield {
          type: 'assistant-stream',
          frame: { type: 'chunk', attemptId: 'attempt-1', revision: index + 2, index, time: 2, chunk: { type: 'text-delta', index: 0, text: `part ${index}` } },
        }
      }
      streamed.resolve()
      await new Promise<void>(resolve => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
    const { session, transport } = createSession({ ...createJournal(), follow })
    let notifications = 0
    session.subscribe(() => {
      notifications += 1
    })
    await session.open()
    await new Promise(resolve => setTimeout(resolve, 0))
    const before = session.getSnapshot()
    notifications = 0

    go.resolve()
    await streamed.promise
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(session.eventSource.getSnapshot().entries.filter(entry => entry.type === 'transient')).toHaveLength(chunks)
    expect(session.getSnapshot()).toBe(before)
    expect(notifications).toBe(0)
    transport.streams.forEach(stream => {
      stream.release()
    })
    await session.dispose()
  })
})
