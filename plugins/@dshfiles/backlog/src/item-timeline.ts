import { BacklogOrigins } from './event-origin.js'
import type { BacklogEvent } from './item.js'

/** **Conversation**: what you did and said, and what was said to you. **Work log**: agent and system churn around it. */
export type TimelineLane = 'conversation' | 'work'

const AGENT_PREFIX = 'agent:'

/** A smart-reply answer: the Host posts it as a system comment headed by the agent it speaks for. */
const isGeneratedReply = (event: BacklogEvent): boolean => event.kind === 'commented' && /^\*\*@[\w.-]+\*\*\n/u.test(event.detail)

const isRevert = (event: BacklogEvent): boolean => event.detail.startsWith('reverted ')

/** An event that asks the user for input or flags stalled work: it waits on them, whoever raised it. */
const isAttentionRequest = (event: BacklogEvent): boolean =>
  event.fieldChanges?.some(change => change.field === 'attention' && change.after !== '' && change.after !== 'none') ?? false

/**
 * The lane of every event, in order. Everything you did is conversation, and so are attention requests, reverts, remote
 * comments, smart-reply answers and an agent comment that answers you: the comment right after yours, or the first one
 * a thread you started or linked posts. Every other agent, system or sync event is work log.
 */
const lanes = (events: readonly BacklogEvent[]): TimelineLane[] => {
  const awaitingReply = new Set<string>()
  let lastCommentOrigin: string | undefined
  return events.map(event => {
    const origin = BacklogOrigins.of(event)
    const lane = ((): TimelineLane => {
      if (origin === 'user') {
        if (event.threadId !== undefined) awaitingReply.add(event.threadId)
        return 'conversation'
      }
      if (isRevert(event) || isAttentionRequest(event)) return 'conversation'
      if (event.kind !== 'commented') return 'work'
      if (BacklogOrigins.isRemote(origin) || isGeneratedReply(event)) return 'conversation'
      if (!BacklogOrigins.isAgent(origin)) return 'work'
      const session = origin.slice(AGENT_PREFIX.length)
      const answers = lastCommentOrigin === 'user' || awaitingReply.has(session)
      awaitingReply.delete(session)
      return answers ? 'conversation' : 'work'
    })()
    if (event.kind === 'commented') lastCommentOrigin = origin
    return lane
  })
}

/** Both lanes, each in order. */
const split = (events: readonly BacklogEvent[]) => {
  const lanesOf = lanes(events)
  return {
    conversation: events.filter((_event, index) => lanesOf[index] === 'conversation'),
    work: events.filter((_event, index) => lanesOf[index] === 'work'),
  }
}

export interface WorkLogSummary {
  readonly agents: number
  readonly updates: number
  readonly lastAt: number | null
}

const summarize = (work: readonly BacklogEvent[]): WorkLogSummary => ({
  agents: new Set(work.map(event => BacklogOrigins.of(event)).filter(BacklogOrigins.isAgent)).size,
  updates: work.length,
  lastAt: work.reduce<number | null>((latest, event) => (latest === null || event.at > latest ? event.at : latest), null),
})

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`

/** The one line a collapsed work log shows: `3 agents · 14 updates · last 2h`. */
const summaryText = (input: { readonly summary: WorkLogSummary; readonly ago: (at: number) => string }): string =>
  [
    ...(input.summary.agents > 0 ? [plural(input.summary.agents, 'agent')] : []),
    plural(input.summary.updates, 'update'),
    ...(input.summary.lastAt === null ? [] : [`last ${input.ago(input.summary.lastAt)}`]),
  ].join(' · ')

export class ItemTimeline {
  static readonly lanes = lanes
  static readonly split = split
  static readonly summarize = summarize
  static readonly summaryText = summaryText
}
