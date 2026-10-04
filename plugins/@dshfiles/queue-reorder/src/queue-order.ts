import type { InboxTarget } from '@deepseek-ai/dsh-agent/types'

export type Direction = 'up' | 'down'

export const isDirection = (value: unknown): value is Direction => value === 'up' || value === 'down'

export interface QueuePosition {
  readonly sessionId: string
  readonly itemId: string
  readonly index: number
  readonly total: number
  readonly target: InboxTarget
  readonly first: boolean
  readonly last: boolean
}

/** The slice of an Agent inbox a reorder needs; generic so a test can supply its own messages. */
export interface QueueInbox<Message extends { readonly id: string }> {
  readonly nextTurn: readonly Message[]
  readonly nextStep: readonly Message[]
  splice(target: InboxTarget, start: number, deleteCount: number, inserted: Message[]): Message[]
}

/** Each pending list's splice target and the property that reads it. */
const INBOX_LISTS = [
  ['next-turn', 'nextTurn'],
  ['next-step', 'nextStep'],
] as const satisfies readonly (readonly [InboxTarget, 'nextTurn' | 'nextStep'])[]

export class QueueItemMissingError extends Error {}

export interface QueueMoveRequest {
  readonly sessionId: string
  readonly itemId: string
  readonly direction: Direction
}

/**
 * Move one pending item by exactly one position, as one remove plus one insert.
 * Both are durable inbox splices, so the log holds the new order rather than a
 * deletion paired with an unrelated re-queue.
 */
export const moveWithinInbox = <Message extends { readonly id: string }>(inbox: QueueInbox<Message>, request: QueueMoveRequest): QueuePosition => {
  for (const [target, list] of INBOX_LISTS) {
    const pending = inbox[list]
    const index = pending.findIndex(message => message.id === request.itemId)
    if (index < 0) continue
    const total = pending.length
    const position = (at: number): QueuePosition => ({
      sessionId: request.sessionId,
      itemId: request.itemId,
      index: at,
      total,
      target,
      first: at === 0,
      last: at === total - 1,
    })
    const destination = request.direction === 'up' ? index - 1 : index + 1
    if (destination < 0 || destination >= total) return position(index)
    const [moved] = inbox.splice(target, index, 1, [])
    if (moved === undefined) return position(index)
    inbox.splice(target, destination, 0, [moved])
    return position(destination)
  }
  throw new QueueItemMissingError(`Queued item ${request.itemId} is no longer pending.`)
}

/** Pending ids per list, for rendering which affordances are available. */
export const describeInbox = <Message extends { readonly id: string }>(inbox: QueueInbox<Message>) =>
  INBOX_LISTS.map(([target, list]) => ({ target, items: inbox[list].map(message => message.id) }))
