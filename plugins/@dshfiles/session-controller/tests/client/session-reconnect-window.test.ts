import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { Session } from '../../src/native/client/sessions/session.js'
import type { SessionRemotes } from '../../src/native/client/sessions/remotes.js'

const TURNS = 10
const ASSISTANT_MESSAGES_PER_TURN = 5

interface WindowRequest {
  readonly beforeSeq?: number
  readonly maxMessages?: number
  readonly turnWindow?: { readonly minMessages: number; readonly minTurns: number }
}

interface LogEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: Record<string, never>
}

/** A stored log of ten Turns, each a Turn start, one user message and five assistant messages. */
const createLog = (): LogEvent[] => {
  const log: LogEvent[] = []
  const push = (type: string) => log.push({ type, seq: log.length, time: 1, data: {} })
  for (let turn = 0; turn < TURNS; turn++) {
    push('turn/start')
    push('test/user')
    for (let index = 0; index < ASSISTANT_MESSAGES_PER_TURN; index++) push('test/assistant')
  }
  return log
}

/** The Host's window rule: walk back from the cut, stop at a Turn start once both minima hold, or at maxMessages. */
const windowOf = (log: readonly LogEvent[], request: WindowRequest) => {
  const end = request.beforeSeq ?? log.length
  const maxMessages = request.maxMessages ?? 50
  let messages = 0
  let turns = 0
  let cut = 0
  for (let index = end - 1; index >= 0; index--) {
    const event = log[index]
    if (event === undefined) continue
    if (request.turnWindow !== undefined && event.type === 'turn/start') {
      turns += 1
      if (messages >= request.turnWindow.minMessages && turns >= request.turnWindow.minTurns) {
        cut = index
        break
      }
    }
    if (event.type === 'turn/start') continue
    messages += 1
    if (messages >= maxMessages) {
      cut = index
      break
    }
  }
  return { records: log.slice(cut, end).map(event => ({ type: 'event', event })), hasMore: cut > 0 }
}

/** Gateway stream double whose `restart` ends the physical generation and reopens it, as a carrier loss does. */
const createTransport = () => {
  const streams: { restart(): void; dispose(): Promise<void> }[] = []
  const $stream = (options: { readonly open: (signal: AbortSignal) => AsyncIterable<unknown> }) => {
    const lifetime = new AbortController()
    let current = new AbortController()
    const stream = {
      get signal() {
        return lifetime.signal
      },
      restart: () => {
        current.abort(new Error('carrier lost'))
      },
      dispose: async () => {
        lifetime.abort(new Error('stream disposed'))
        current.abort(new Error('stream disposed'))
      },
      [Symbol.asyncIterator]: async function* () {
        for (let generation = 1; !lifetime.signal.aborted; generation++) {
          current = new AbortController()
          for await (const value of options.open(current.signal)) {
            yield { generation, value, signal: current.signal, accept: () => {} }
          }
        }
      },
    }
    streams.push(stream)
    return stream
  }
  return { $stream, streams }
}

const createSession = () => {
  const log = createLog()
  const follows: WindowRequest[] = []
  const transport = createTransport()
  const follow = async function* (request: WindowRequest, signal: AbortSignal) {
    follows.push(request)
    const window = windowOf(log, request)
    yield {
      type: 'snapshot',
      cursor: log.length - 1,
      records: window.records,
      hasMore: window.hasMore,
      projections: { values: {}, asOfSeq: log.length - 1 },
      assistantStream: { revision: 0 },
    }
    await new Promise<void>(resolve => {
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
  }
  const page = async (request: WindowRequest) => ({ ok: true, value: windowOf(log, request) })
  // SAFETY: the Gateway stream factory and the follow/page methods are the exact transport subset a Session reads.
  const remotes = { $stream: transport.$stream, session: { follow, page } } as unknown as SessionRemotes
  return { session: new Session(SessionId('session-reconnect-window-test'), remotes), follows, transport }
}

const firstSeq = (session: Session) => session.eventSource.getSnapshot().entries[0]?.event.seq

describe('Session event window across a reconnect', () => {
  it('keeps the older history the reader loaded when the follow stream reopens', async () => {
    const { session, follows, transport } = createSession()
    await session.open()
    expect(firstSeq(session)).toBeGreaterThan(0)

    await session.loadOlder()
    expect(firstSeq(session)).toBe(0)
    const held = session.eventSource.getSnapshot().entries.length

    transport.streams[0]?.restart()
    await expect.poll(() => follows.length).toBe(2)
    await expect.poll(() => session.eventSource.getSnapshot().revision).toBeGreaterThan(2)

    expect(firstSeq(session)).toBe(0)
    expect(session.eventSource.getSnapshot().entries).toHaveLength(held)
    expect(session.getSnapshot().openState).toBe('open')
    await session.dispose()
  })

  it('opens a fresh Session with the opening window only', async () => {
    const { session, follows } = createSession()
    await session.open()
    expect(follows[0]).toMatchObject({ maxMessages: 120, turnWindow: { minMessages: 20, minTurns: 1 } })
    await session.dispose()
  })
})
