import type { Message } from '@deepseek-ai/dsh-llm'
import type { TurnEndReason } from '@deepseek-ai/dsh-session/types'

import type { BacklogAttention, BacklogEvent, BacklogItem } from './item.js'

/** What one finished thread turn means for the backlog items that thread is linked to. */
export interface ThreadTurnOutcome {
  /** True when the turn stopped on its own, so its unfinished items should reach the Inbox; false when one finished. */
  readonly stalled: boolean
  /** The tail of the event this signal writes on each item, and why the item asks for attention. */
  readonly reason: string
}

/**
 * A turn that ended blocked or failed leaves the thread's items unfinished; a completed turn means the thread works
 * again. A cancellation is the user's own choice, and a turn that hit the token ceiling still delivered its work.
 */
const outcome = (reason: TurnEndReason): ThreadTurnOutcome | null => {
  if (reason.kind === 'blocked') return { stalled: true, reason: 'the thread stopped on a block' }
  if (reason.kind === 'error') return { stalled: true, reason: `the thread failed: ${reason.error.code}` }
  if (reason.kind === 'completed') return { stalled: false, reason: 'the thread works again' }
  return null
}

/** The last thing the Agent said: all a resolution check reads of a thread, and empty when it never spoke. */
const replyText = (messages: readonly Pick<Message, 'role' | 'content'>[]): string => {
  const reply = messages.findLast(message => message.role === 'assistant')
  const text = reply?.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n') ?? ''
  return text.trim()
}

/**
 * Only an item still in progress, with a status the user never chose, no suggestion already waiting and no dismissal
 * after it, can be offered as done: a suggestion the user turned down waits for the item to change again.
 */
const openToResolution = (item: Pick<BacklogItem, 'status' | 'humanFields' | 'proposal' | 'events'>): boolean => {
  const last = item.events.at(-1)
  const dismissed = last?.kind === 'triaged' && last.detail.startsWith('dismissed')
  return item.status === 'doing' && !item.humanFields.includes('status') && (item.proposal ?? null) === null && dismissed !== true
}

/** An event that changed the item's attention, so the last one says who set the flag the item carries now. */
const changesAttention = (event: Pick<BacklogEvent, 'detail' | 'fieldChanges'>): boolean =>
  event.detail === 'attention' || (event.fieldChanges?.some(change => change.field === 'attention') ?? false)

/**
 * Who set the attention an item carries now: a hand set always wins, a thread signal belongs to the thread that wrote
 * it, and anything else keeps the actor that wrote it.
 */
export type AttentionOwner =
  | { readonly kind: 'user' }
  | { readonly kind: 'thread'; readonly threadId: string; readonly setBy: string }
  | { readonly kind: 'other'; readonly setBy: string }

export interface ItemAttention {
  readonly value: BacklogAttention
  readonly owner: AttentionOwner
}

/**
 * The attention an item carries and its owner, read once from the last event that changed it, whatever else touched the
 * item since. A hand set owns the flag until the user changes it.
 */
const attentionOf = (item: Pick<BacklogItem, 'attention' | 'humanFields' | 'events'>): ItemAttention => {
  const value = item.attention ?? 'none'
  if (item.humanFields.includes('attention')) return { value, owner: { kind: 'user' } }
  const changed = value === 'none' ? undefined : item.events.findLast(changesAttention)
  if (changed === undefined) return { value, owner: { kind: 'other', setBy: '' } }
  if (changed.threadId !== undefined) return { value, owner: { kind: 'thread', threadId: changed.threadId, setBy: changed.actor } }
  return { value, owner: { kind: 'other', setBy: changed.actor } }
}

/** A thread signal owns the flag: that thread's turn wrote it, and nothing replaced it since. */
const ownedByThread = (attention: ItemAttention, threadId: string): boolean => attention.owner.kind === 'thread' && attention.owner.threadId === threadId

/** The thread wrote the flag, either as its own signal or as an agent writing on its behalf. */
const setByThread = (owner: AttentionOwner, threadId: string): boolean =>
  (owner.kind === 'thread' && owner.threadId === threadId) || (owner.kind === 'other' && owner.setBy === `agent:${threadId}`)

/**
 * A question the thread answered settles the request for input that same thread made. A flag the user set by hand, or
 * one another agent raised, waits for its own owner: answering a question elsewhere says nothing about it.
 */
const answeredQuestionSettles = (input: { readonly item: Pick<BacklogItem, 'attention' | 'humanFields' | 'events'>; readonly threadId: string }): boolean => {
  const attention = attentionOf(input.item)
  return attention.value === 'needs-input' && setByThread(attention.owner, input.threadId)
}

/** What a finished thread's turn says about the items it works on, before any item is touched. */
export interface IdleThreadNudge {
  readonly id: number
  readonly threadId: string
}

const idleThreadNudges = (input: {
  readonly items: readonly Pick<BacklogItem, 'id' | 'status' | 'attention' | 'humanFields' | 'links' | 'events'>[]
  readonly sessions: readonly { readonly sessionId: string; readonly running: boolean; readonly updatedAt: number }[]
  readonly now: number
  readonly idleDays: number
}): IdleThreadNudge[] => {
  const cutoff = input.now - input.idleDays * 86_400_000
  const sessions = new Map(input.sessions.map(session => [session.sessionId, session]))
  const nudges: IdleThreadNudge[] = []
  for (const item of input.items) {
    if (item.status !== 'doing' || (item.attention ?? 'none') !== 'none' || item.humanFields.includes('attention')) continue
    for (const link of item.links) {
      if (link.type !== 'thread') continue
      const session = sessions.get(link.target)
      if (session === undefined || session.running || session.updatedAt > cutoff) continue
      const alreadyNudged = item.events.some(
        event => event.kind === 'commented' && event.threadId === session.sessionId && event.detail.startsWith('Thread idle nudge:'),
      )
      if (alreadyNudged) continue
      nudges.push({ id: item.id, threadId: session.sessionId })
      break
    }
  }
  return nudges
}

export class ThreadLifecycle {
  static readonly outcome = outcome
  static readonly replyText = replyText
  static readonly openToResolution = openToResolution
  static readonly attentionOf = attentionOf
  static readonly ownedByThread = ownedByThread
  static readonly idleThreadNudges = idleThreadNudges
  static readonly answeredQuestionSettles = answeredQuestionSettles
}
