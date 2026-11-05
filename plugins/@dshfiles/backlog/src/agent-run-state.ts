import type { BacklogSummaryView } from './api.js'

/** What the agent working on an item is doing now, Linear AgentSession-style. */
export type AgentRunState = 'working' | 'awaiting-input' | 'error' | 'done' | 'stale'

/** A thread with no activity this long reads as stale rather than done. */
const STALE_AFTER_MS = 30 * 60_000

export interface RunStateThread {
  readonly id: string
  readonly running: boolean
  readonly updatedAt?: number | undefined
}

export type FinishReason = 'completed' | 'aborted' | 'blocked' | 'error' | 'max-tokens'

/**
 * The thread an item's run state follows: its delegate, else the most recently active thread linked to it. Only open
 * items carry one; a closed item's chip would only repeat its status.
 */
const sessionOf = (input: {
  readonly item: Pick<BacklogSummaryView, 'status' | 'delegate' | 'links'>
  readonly threads: ReadonlyMap<string, RunStateThread>
}): string | null => {
  const item = input.item
  if (item.status === 'done' || item.status === 'dropped') return null
  const delegate = item.delegate?.startsWith('agent:') === true ? item.delegate.slice('agent:'.length) : null
  if (delegate !== null) return delegate
  const linked = item.links.flatMap(link => {
    const thread = link.type === 'thread' ? input.threads.get(link.target) : undefined
    return thread === undefined ? [] : [thread]
  })
  const latest = linked.reduce<RunStateThread | null>(
    (best, thread) => (best === null || (thread.updatedAt ?? 0) > (best.updatedAt ?? 0) ? thread : best),
    null,
  )
  return latest?.id ?? null
}

/**
 * Working while its turn runs; awaiting input when the last turn stopped on a question or approval; error when it
 * failed; stale when idle past half an hour; done otherwise. Null when the thread is not one this browser lists.
 */
const of = (input: {
  readonly item: Pick<BacklogSummaryView, 'status' | 'delegate' | 'links'>
  readonly threads: ReadonlyMap<string, RunStateThread>
  readonly finished: ReadonlyMap<string, FinishReason | null>
  readonly now: number
}): { readonly sessionId: string; readonly state: AgentRunState } | null => {
  const sessionId = sessionOf(input)
  if (sessionId === null) return null
  const thread = input.threads.get(sessionId)
  if (thread === undefined) return null
  if (thread.running) return { sessionId, state: 'working' }
  const reason = input.finished.get(sessionId) ?? null
  if (reason === 'blocked') return { sessionId, state: 'awaiting-input' }
  if (reason === 'error') return { sessionId, state: 'error' }
  const idle = thread.updatedAt !== undefined && input.now - thread.updatedAt > STALE_AFTER_MS
  return { sessionId, state: idle ? 'stale' : 'done' }
}

export class AgentRunStates {
  static readonly of = of
  static readonly staleAfterMs = STALE_AFTER_MS
}
