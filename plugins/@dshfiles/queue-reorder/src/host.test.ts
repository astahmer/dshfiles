import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
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

const imageBlock = (attachmentId: string) => ({
  type: 'image',
  attachment: { attachmentId, mediaType: 'image/png', bytes: 4, width: 1, height: 1, name: `${attachmentId}.png` },
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
type ToolArguments = Parameters<TestHost['runTool']>[0]['arguments']

const mountedQueue = Effect.gen(function* () {
  const inbox = liveSession()
  const home = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), 'queue-reorder-host-'))),
    path => Effect.promise(() => rm(path, { recursive: true, force: true })),
  )
  const host = yield* Effect.acquireRelease(
    Effect.promise(async () => {
      const created = await createTestHost()
      await created.ctx.plugin(Storage)
      await created.ctx.plugin(StorageJson, { root: join(home, 'storage') })
      await created.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
      created.ctx.provide('settings', { configure: () => () => undefined, describe: () => [], update: async () => undefined, replace: async () => undefined })
      const live = new Map<string, unknown>([
        ['live', { inbox }],
        ['child', { session: { header: { id: 'child', origin: 'subagent', parentSession: 'mine' } } }],
      ])
      created.ctx.provide('agents', { get: (sessionId: string) => live.get(sessionId), list: () => [] })
      created.ctx.provide('attachments', {
        readFileStream: async function* (ref: { readonly attachmentId: string }) {
          yield* fileContents.get(ref.attachmentId) ?? []
        },
        readImage: async (ref: { readonly attachmentId: string }) => ({ ref, data: new Uint8Array([137, 80, 78, 71]) }),
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
  const runTool = (args: ToolArguments) => Effect.promise(() => host.runTool({ name: 'queue_move', arguments: args }))
  const sendsCall = (method: string, input: ApiInput) =>
    Effect.promise(async () => {
      const response = await host.connection.requestApi({ packageId: '@dshfiles/queue-reorder', apiId: 'scheduled-sends', method, version: 1, input })
      return Schema.decodeUnknownSync(wireEnvelope)(await response.json()).result
    })
  const agentTool = (sessionId: string, name: string, args: ToolArguments) =>
    // SAFETY: the dshx tool edge reads only the Agent's id and its session header's cwd to name the caller.
    Effect.promise(() => host.runTool({ name, arguments: args, agent: { id: sessionId, session: { header: {} } } as never }))
  return { inbox, call, runTool, sendsCall, agentTool }
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

  it.effect('reads a queued image and keeps it readable after the message leaves the queue, for its own session only', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* mountedQueue
        queue.inbox.nextTurn.push({ id: 'd', content: [{ type: 'text', text: 'look' }, imageBlock('shot')] })
        const image = { ok: true, value: { output: { name: 'shot.png', mediaType: 'image/png', data: Buffer.from([137, 80, 78, 71]).toString('base64') } } }
        expect(yield* queue.call('readImage', { sessionId: 'live', attachmentId: 'shot' })).toEqual(image)

        queue.inbox.splice('next-turn', 3, 1, [])
        expect(yield* queue.call('readImage', { sessionId: 'live', attachmentId: 'shot' })).toEqual(image)
        const missing = { ok: false, error: { code: 'queued-file-missing', message: 'That file is not attached to a message queued in this session.' } }
        expect(yield* queue.call('readImage', { sessionId: 'child', attachmentId: 'shot' })).toEqual(missing)
        expect(yield* queue.call('readImage', { sessionId: 'live', attachmentId: 'notes' })).toEqual(missing)
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

  it.effect('keeps an agent to the scheduled sends of its own thread and its subagents', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* mountedQueue
        const sendAt = Date.now() + 60 * 60 * 1000
        const foreign = yield* queue.sendsCall('create', { sessionId: 'other', text: 'from the user', sendAt })
        if (!foreign.ok) return expect.fail(foreign.error.message)
        const foreignId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(foreign.value.output).id

        const refusedCreate = yield* queue.agentTool('mine', 'scheduled_send_create', { sessionId: 'other', text: 'hijack', sendAt })
        expect(refusedCreate).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('other') }] })
        expect(yield* queue.agentTool('mine', 'scheduled_send_create', { sessionId: 'child', text: 'for my subagent', sendAt })).not.toHaveProperty(
          'isError',
          true,
        )
        expect(yield* queue.agentTool('mine', 'scheduled_send_create', { text: 'for me', sendAt })).not.toHaveProperty('isError', true)

        const listed = yield* queue.agentTool('mine', 'scheduled_send_list', {})
        expect(listed.content).toEqual([{ type: 'text', text: expect.stringContaining('for me') }])
        expect(JSON.stringify(listed.content)).not.toContain('from the user')
        expect(yield* queue.agentTool('mine', 'scheduled_send_list', { sessionId: 'other' })).toMatchObject({ isError: true })

        for (const [name, args] of [
          ['scheduled_send_update', { id: foreignId, text: 'rewritten' }],
          ['scheduled_send_cancel', { id: foreignId }],
          ['scheduled_send_now', { id: foreignId }],
        ] as const) {
          expect(yield* queue.agentTool('mine', name, args)).toMatchObject({
            isError: true,
            content: [{ type: 'text', text: expect.stringContaining(`No scheduled message ${foreignId}`) }],
          })
        }
        expect(yield* queue.sendsCall('cancel', { id: foreignId })).toMatchObject({ ok: true, value: { output: { text: 'from the user' } } })
      }),
    ),
  )
})
