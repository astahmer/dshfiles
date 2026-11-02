import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { MAX_QUEUE_FILE_BYTES } from './api.js'
import queueReorderHost from './host.js'

type InboxTarget = 'next-turn' | 'next-step'

interface QueuedMessage {
  readonly id: string
  readonly content: readonly unknown[]
}

const fileBlock = (attachmentId: string, bytes: number) => ({
  type: 'file',
  attachment: { attachmentId, name: `${attachmentId}.txt`, bytes, mediaType: 'text/plain' },
})

/** One live session's Agent inbox with standard splice semantics; the Host reaches it through the `agents` registry. */
const liveSession = () => {
  const lists = {
    'next-turn': new Array<QueuedMessage>(
      { id: 'a', content: [{ type: 'text', text: 'first' }, fileBlock('notes', 5)] },
      { id: 'b', content: [{ type: 'text', text: 'second' }, fileBlock('huge', MAX_QUEUE_FILE_BYTES + 1)] },
      { id: 'c', content: [fileBlock('grows', 3)] },
    ),
    'next-step': new Array<QueuedMessage>(),
  } satisfies Record<InboxTarget, QueuedMessage[]>
  return {
    get nextTurn() {
      return lists['next-turn']
    },
    get nextStep() {
      return lists['next-step']
    },
    splice: (target: InboxTarget, start: number, deleteCount: number, inserted: QueuedMessage[]) => lists[target].splice(start, deleteCount, ...inserted),
  }
}

const fileContents = new Map<string, readonly Uint8Array[]>([
  ['notes', [new TextEncoder().encode('he'), new TextEncoder().encode('llo')]],
  ['grows', [new Uint8Array(MAX_QUEUE_FILE_BYTES), new Uint8Array(1)]],
])

const wireEnvelope = Schema.Struct({
  result: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: Schema.Unknown }) }),
    Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
  ]),
})

type ApiInput = Parameters<TestHost['connection']['requestApi']>[0]['input']
type ToolArguments = Parameters<TestHost['tools']['execute']>[0]['arguments']

const mountedQueue = Effect.gen(function* () {
  const inbox = liveSession()
  const host = yield* Effect.acquireRelease(
    Effect.promise(async () => {
      const created = await createTestHost()
      created.ctx.provide('settings', { configure: () => () => undefined, describe: () => [], update: async () => undefined, replace: async () => undefined })
      created.ctx.provide('agents', { get: (sessionId: string) => (sessionId === 'live' ? { inbox } : undefined), list: () => [] })
      created.ctx.provide('attachments', {
        readFileStream: async function* (ref: { readonly attachmentId: string }) {
          yield* fileContents.get(ref.attachmentId) ?? []
        },
      })
      await created.mount(queueReorderHost, { packageId: '@dshfiles/queue-reorder' })
      return created
    }),
    created => Effect.promise(() => created.dispose()),
  )
  const call = (method: string, input: ApiInput) =>
    Effect.promise(async () => {
      const response = await host.connection.requestApi({ packageId: '@dshfiles/queue-reorder', apiId: 'queue-order', method, version: 1, input })
      return Schema.decodeUnknownSync(wireEnvelope)(await response.json()).result
    })
  const runTool = (args: ToolArguments) =>
    Effect.promise(() => host.tools.execute({ callId: ToolCallId('call-1'), name: 'queue_move', arguments: args, signal: new AbortController().signal }))
  return { inbox, call, runTool }
})

const attachment = (attachmentId: string, bytes: number) => ({ attachmentId, name: `${attachmentId}.txt`, bytes })

describe('queue-reorder Host', () => {
  it.effect('moves a queued message over the API and describes the new order', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* mountedQueue
        const moved = yield* queue.call('move', { sessionId: 'live', itemId: 'b', direction: 'up' })
        expect(moved).toEqual({
          ok: true,
          value: { output: { sessionId: 'live', itemId: 'b', index: 0, total: 3, target: 'next-turn', first: true, last: false } },
        })
        expect(yield* queue.call('describe', { sessionId: 'live' })).toEqual({
          ok: true,
          value: {
            output: [
              { target: 'next-turn', items: ['b', 'a', 'c'] },
              { target: 'next-step', items: [] },
            ],
          },
        })
        expect(yield* queue.call('describe', { sessionId: 'idle' })).toEqual({ ok: true, value: { output: [] } })
      }),
    ),
  )

  it.effect('names why a move cannot happen', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* mountedQueue
        expect(yield* queue.call('move', { sessionId: 'idle', itemId: 'a', direction: 'up' })).toEqual({
          ok: false,
          error: { code: 'queue-session-not-live', message: 'Session idle has no live agent, so nothing is waiting to be reordered.' },
        })
        expect(yield* queue.call('move', { sessionId: 'live', itemId: 'gone', direction: 'up' })).toEqual({
          ok: false,
          error: { code: 'queue-item-not-pending', message: 'Queued item gone is no longer pending.' },
        })
      }),
    ),
  )

  it.effect('reorders through the queue_move tool and reports the new position', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* mountedQueue
        const result = yield* queue.runTool({ sessionId: 'live', itemId: 'a', direction: 'down' })
        expect(result.content).toEqual([{ type: 'text', text: 'Moved a to position 2 of 3 in the next-turn queue.' }])
        expect(queue.inbox.nextTurn.map(message => message.id)).toEqual(['b', 'a', 'c'])

        const missing = yield* queue.runTool({ sessionId: 'live', itemId: 'gone', direction: 'down' })
        expect(missing).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Error: Queued item gone is no longer pending.' }] })
      }),
    ),
  )

  it.effect('reads a queued file and keeps it readable after the message leaves the queue', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* mountedQueue
        const read = yield* queue.call('readFile', { sessionId: 'live', attachment: attachment('notes', 5) })
        expect(read).toEqual({ ok: true, value: { output: { name: 'notes.txt', data: Buffer.from('hello').toString('base64') } } })

        queue.inbox.splice('next-turn', 0, 1, [])
        expect(yield* queue.call('readFile', { sessionId: 'live', attachment: attachment('notes', 5) })).toMatchObject({ ok: true })
        expect(yield* queue.call('readFile', { sessionId: 'live', attachment: attachment('other', 5) })).toEqual({
          ok: false,
          error: { code: 'queued-file-missing', message: 'That file is not attached to a message queued in this session.' },
        })
      }),
    ),
  )

  it.effect('refuses a queued file over the composer limit, declared or streamed', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* mountedQueue
        const tooLarge = { ok: false, error: { code: 'queued-file-too-large', message: 'That file is too large to edit in the composer.' } }
        expect(yield* queue.call('readFile', { sessionId: 'live', attachment: attachment('grows', 3) })).toEqual(tooLarge)
        queue.inbox.nextTurn.push({ id: 'd', content: [fileBlock('huge-declared', MAX_QUEUE_FILE_BYTES + 1)] })
        expect(yield* queue.call('readFile', { sessionId: 'live', attachment: attachment('huge-declared', 3) })).toEqual(tooLarge)
      }),
    ),
  )
})
