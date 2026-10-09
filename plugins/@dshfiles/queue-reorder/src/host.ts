import type { Context } from '@deepseek-ai/cordis'
import { defineHost, defineTool } from '@dshfiles/dshx/host'
import { LlmError, type FileBlock } from '@deepseek-ai/dsh-llm'
import { MAX_QUEUE_FILE_BYTES, queueApi } from './api.js'
import { queueReorderSettings } from './settings.js'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describeInbox, isDirection, moveWithinInbox, QueueItemMissingError, type QueueMoveRequest, type QueuePosition } from './queue-order.js'
import '@deepseek-ai/dsh-agent'

/**
 * Queue reordering.
 *
 * DSH 0.2 ships `updateQueue` with `edit`, `remove`, and `steer`, and the Agent
 * inbox exposes `splice`, which durably records the normalized result. So a
 * reorder is a splice on the pending list rather than a remove-and-resend: the
 * message keeps its identity and the session log records the new order, so
 * replay, fork, and resume reconstruct exactly what the user saw.
 *
 * `updateQueue` cannot express a reorder, so this plugin adds one Host-side and
 * exposes it as a tool. The Client affordance calls the same function, so the
 * button and the agent can never disagree.
 */

const liveAgent = (ctx: Context, sessionId: string) => {
  const agents = ctx.get('agents')
  if (agents === undefined) throw new LlmError('agents service unavailable', 'MISSING_SERVICE')
  return agents.get(SessionId(sessionId))
}

/** Move one pending item by exactly one position. */
export const moveQueueItem = async (ctx: Context, request: QueueMoveRequest): Promise<QueuePosition> => {
  if (!isDirection(request.direction)) {
    throw new LlmError('queue move direction must be "up" or "down"', 'INVALID_ARGUMENT')
  }
  const agent = liveAgent(ctx, request.sessionId)
  if (agent === undefined) {
    throw new LlmError(`Session ${request.sessionId} has no live agent, so nothing is waiting to be reordered.`, 'NOT_FOUND')
  }
  try {
    return moveWithinInbox(agent.inbox, request)
  } catch (error) {
    if (error instanceof QueueItemMissingError) throw new LlmError(error.message, 'NOT_FOUND')
    throw error
  }
}

/** Pending ids per list, for rendering which affordances are available. */
export const describeQueueOrder = (ctx: Context, sessionId: string) => {
  const agent = liveAgent(ctx, sessionId)
  return agent === undefined ? [] : describeInbox(agent.inbox)
}

type FileAttachmentRef = FileBlock['attachment']

interface FileReader {
  readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array>
}

const isFileReader = (value: unknown): value is FileReader =>
  typeof value === 'object' && value !== null && 'readFileStream' in value && typeof value.readFileStream === 'function'

/**
 * File references this Host has already confirmed in a session's queue. Editing removes the message from the queue,
 * and Cancel still needs its files, so a reference stays readable for that session once it was seen there.
 */
const confirmedFiles = new Map<string, Map<string, FileAttachmentRef>>()

const queuedFileRef = (ctx: Context, sessionId: string, attachmentId: string): FileAttachmentRef | undefined => {
  const confirmed = confirmedFiles.get(sessionId)?.get(attachmentId)
  if (confirmed !== undefined) return confirmed
  const agent = liveAgent(ctx, sessionId)
  if (agent === undefined) return undefined
  for (const message of [...agent.inbox.nextTurn, ...agent.inbox.nextStep]) {
    for (const block of message.content) {
      if (block.type !== 'file' || block.attachment.attachmentId !== attachmentId) continue
      const session = confirmedFiles.get(sessionId) ?? new Map<string, FileAttachmentRef>()
      session.set(attachmentId, block.attachment)
      confirmedFiles.set(sessionId, session)
      return block.attachment
    }
  }
  return undefined
}

/** Bytes of one file attached to a queued message, so the composer can hold it while the message is edited. */
export const readQueuedFile = async (ctx: Context, request: { readonly sessionId: string; readonly attachmentId: string }) => {
  const ref = queuedFileRef(ctx, request.sessionId, request.attachmentId)
  if (ref === undefined) throw new LlmError('That file is not attached to a message queued in this session.', 'NOT_FOUND')
  if (ref.bytes > MAX_QUEUE_FILE_BYTES) throw new LlmError('That file is too large to edit in the composer.', 'INVALID_ARGUMENT')
  const store = ctx.get('attachments')
  if (!isFileReader(store)) throw new LlmError('attachments service unavailable', 'MISSING_SERVICE')
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of store.readFileStream(ref)) {
    total += chunk.byteLength
    if (total > MAX_QUEUE_FILE_BYTES) throw new LlmError('That file is too large to edit in the composer.', 'INVALID_ARGUMENT')
    chunks.push(chunk)
  }
  return { name: ref.name, data: Buffer.concat(chunks).toString('base64') }
}

/** The context this plugin activated on, captured once at setup. */
let hostContext: Context | undefined

const moveTool = defineTool({
  name: 'queue_move',
  description:
    'Move one message waiting in a session queue up or down by one position. Use it when the user asks to reorder the queue, or to put a queued message before or after another.',
  parameters: {
    sessionId: { type: 'string', required: true, description: 'Session whose queue is being reordered.' },
    itemId: { type: 'string', required: true, description: 'Id of the queued message to move.' },
    direction: { type: 'string', required: true, description: '"up" moves it earlier, "down" moves it later.' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessionId: { type: 'string' },
        itemId: { type: 'string' },
        index: { type: 'number' },
        total: { type: 'number' },
        target: { type: 'string' },
        first: { type: 'boolean' },
        last: { type: 'boolean' },
      },
    },
    render(_args, value) {
      const index = value.index ?? 0
      const total = value.total ?? 0
      const where = value.first === true ? 'first' : value.last === true ? 'last' : `position ${index + 1} of ${total}`
      return [{ type: 'text', text: `Moved ${value.itemId ?? 'item'} to ${where} in the ${value.target ?? 'queue'} queue.` }]
    },
  },
  execute: async args => {
    if (hostContext === undefined) {
      throw new LlmError('queue-reorder is not active yet', 'MISSING_SERVICE')
    }
    const direction = args.direction
    if (!isDirection(direction)) throw new LlmError('queue move direction must be "up" or "down"', 'INVALID_ARGUMENT')
    return moveQueueItem(hostContext, { sessionId: args.sessionId, itemId: args.itemId, direction })
  },
})

const queueHostApi = queueApi.host({
  move: async ({ input }) => {
    if (hostContext === undefined) {
      throw new LlmError('queue-reorder is not active yet', 'MISSING_SERVICE')
    }
    return moveQueueItem(hostContext, {
      sessionId: input.sessionId,
      itemId: input.itemId,
      direction: input.direction,
    })
  },
  describe: async ({ input }) => {
    if (hostContext === undefined) return []
    return describeQueueOrder(hostContext, input.sessionId)
  },
  readFile: async ({ input }) => {
    if (hostContext === undefined) {
      throw new LlmError('queue-reorder is not active yet', 'MISSING_SERVICE')
    }
    return readQueuedFile(hostContext, { sessionId: input.sessionId, attachmentId: input.attachment.attachmentId })
  },
})

export default defineHost({
  name: 'llm-queue-reorder',
  apis: [queueHostApi],
  inject: ['agents'],
  tools: [moveTool],
  settings: [queueReorderSettings],
  setup: (ctx: Context) => {
    hostContext = ctx
    ctx.provide('queueOrder', {
      move: (request: QueueMoveRequest) => moveQueueItem(ctx, request),
      describe: (sessionId: string) => describeQueueOrder(ctx, sessionId),
    })
  },
})
