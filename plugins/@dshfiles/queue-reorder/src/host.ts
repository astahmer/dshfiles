import type { Context } from '@deepseek-ai/cordis'
import { defineHost, defineTool } from '@dshfiles/dshx/host'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { queueApi } from './api.js'
import type { Agent } from '@deepseek-ai/dsh-agent'
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

type Direction = 'up' | 'down'
type InboxTarget = 'next-turn' | 'next-step'

const isDirection = (value: unknown): value is Direction => value === 'up' || value === 'down'

export interface QueuePosition {
  readonly sessionId: string
  readonly itemId: string
  readonly index: number
  readonly total: number
  readonly target: InboxTarget
  readonly first: boolean
  readonly last: boolean
}

interface PendingMessage {
  readonly id: string
}

/** Each pending list's splice target and the camelCase property that reads it. */
const INBOX_LISTS = [
  ['next-turn', 'nextTurn'],
  ['next-step', 'nextStep'],
] as const satisfies readonly (readonly [InboxTarget, 'nextTurn' | 'nextStep'])[]

interface LocatedItem {
  readonly target: InboxTarget
  readonly index: number
  readonly list: readonly PendingMessage[]
}

const findPending = (
  ctx: Context,
  sessionId: string,
  itemId: string,
): { readonly inbox: Agent['inbox'] } & LocatedItem => {
  const agents = ctx.get('agents')
  if (agents === undefined) throw new LlmError('agents service unavailable', 'MISSING_SERVICE')
  const agent = agents.get(sessionId as never)
  if (agent === undefined) {
    throw new LlmError(
      `Session ${sessionId} has no live agent, so nothing is waiting to be reordered.`,
      'NOT_FOUND',
    )
  }
  for (const [target, list] of INBOX_LISTS) {
    const pending = agent.inbox[list] as readonly PendingMessage[]
    const index = pending.findIndex(message => message.id === itemId)
    if (index >= 0) return { inbox: agent.inbox, target, index, list: pending }
  }
  throw new LlmError(`Queued item ${itemId} is no longer pending.`, 'NOT_FOUND')
}

/** Move one pending item by exactly one position. */
export const moveQueueItem = async (
  ctx: Context,
  request: { readonly sessionId: string; readonly itemId: string; readonly direction: Direction },
): Promise<QueuePosition> => {
  if (!isDirection(request.direction)) {
    throw new LlmError('queue move direction must be "up" or "down"', 'INVALID_ARGUMENT')
  }
  const { inbox, target, index, list } = findPending(ctx, request.sessionId, request.itemId)
  const total = list.length
  const destination = request.direction === 'up' ? index - 1 : index + 1
  const position = (at: number): QueuePosition => ({
    sessionId: request.sessionId,
    itemId: request.itemId,
    index: at,
    total,
    target,
    first: at === 0,
    last: at === total - 1,
  })
  if (destination < 0 || destination >= total) return position(index)

  // One remove plus one insert at the destination. Both are recorded as
  // durable inbox splices, so the log holds the new order rather than a
  // deletion paired with an unrelated re-queue.
  const removed = inbox.splice(target, index, 1, [])
  const [moved] = removed
  if (moved === undefined) return position(index)
  inbox.splice(target, destination, 0, [moved])

  return position(destination)
}

/** Pending ids per list, for rendering which affordances are available. */
export const describeQueueOrder = (
  ctx: Context,
  sessionId: string,
): readonly { readonly target: InboxTarget; readonly items: readonly string[] }[] => {
  const agents = ctx.get('agents')
  const agent = agents?.get(sessionId as never)
  if (agent === undefined) return []
  return INBOX_LISTS.map(([target, list]) => ({
    target,
    items: (agent.inbox[list] as readonly PendingMessage[]).map(message => message.id),
  }))
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
    return moveQueueItem(hostContext, {
      sessionId: args.sessionId,
      itemId: args.itemId,
      direction: args.direction as Direction,
    })
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
    return describeQueueOrder(hostContext, input.sessionId) as never
  },
})

export default defineHost({
  name: 'llm-queue-reorder',
  apis: [queueHostApi],
  inject: ['agents'],
  tools: [moveTool],
  setup: (ctx: Context) => {
    hostContext = ctx
    ctx.provide('queueOrder', {
      move: (request: { readonly sessionId: string; readonly itemId: string; readonly direction: Direction }) =>
        moveQueueItem(ctx, request),
      describe: (sessionId: string) => describeQueueOrder(ctx, sessionId),
    })
  },
})