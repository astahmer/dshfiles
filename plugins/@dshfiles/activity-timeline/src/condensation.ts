import type { ActivityEvent, CondensedItem } from './types.js'

const ROUTINE_GROUP_WINDOW_MS = 10 * 60 * 1000
const REPEATED_ATTENTION_WINDOW_MS = 30 * 60 * 1000
const MAX_GROUP_MEMBERS = 500

/** Attention events whose repeats share one cause and one remedy, so a burst reads as one row instead of many failures. */
const REPEATABLE_ATTENTION = new Set(['workspace.sync_refused'])

const repeatedCauseKey = (event: ActivityEvent): string | null =>
  event.level === 'attention' && REPEATABLE_ATTENTION.has(event.type) ? JSON.stringify([event.type, event.workspaceId, event.detail ?? event.summary]) : null

interface RepeatedAttentionBurst {
  readonly startedAt: number
  readonly members: ActivityEvent[]
  slot: number
}

const ALWAYS_INDIVIDUAL = new Set([
  'session.error',
  'session.input',
  'communication.message',
  'integration.queued',
  'integration.started',
  'integration.blocked',
  'integration.validation_failed',
  'integration.completed',
  'integration.failed',
  'integration.stale',
  'integration.already_integrated',
  'integration.cancelled',
  'verification.cancelled',
  'workspace.ready',
  'workspace.missing',
])

const TYPE_LABELS: Readonly<Record<string, string>> = {
  'session.started': 'agent started',
  'session.disposed': 'agent disposed',
  'session.status': 'status change',
  'session.input': 'input received',
  'session.error': 'agent error',
  'communication.activity': 'communication tool call',
  'communication.message': 'agent message',
  'integration.queued': 'integration queued',
  'integration.started': 'integration started',
  'integration.blocked': 'integration blocked',
  'integration.validation_failed': 'validation failed',
  'integration.completed': 'integration completed',
  'integration.failed': 'integration failed',
  'integration.stale': 'integration stale',
  'integration.already_integrated': 'already integrated',
  'integration.cancelled': 'integration cancelled',
  'verification.passed': 'verification passed',
  'verification.failed': 'verification failed',
  'verification.timed-out': 'verification timed out',
  'verification.cancelled': 'verification cancelled',
  'workspace.created': 'workspace registered',
  'workspace.ready': 'workspace ready',
  'workspace.missing': 'workspace missing',
  'workspace.sync_refused': 'checkout sync refused (local work kept)',
}

export class ActivityTimelineCondensation {
  static typeLabel = (type: string): string => TYPE_LABELS[type] ?? type.replaceAll('.', ' ')

  private static toItem = (event: ActivityEvent): CondensedItem => ({
    kind: 'event',
    id: event.id,
    at: event.at,
    source: event.source,
    type: event.type,
    level: event.level,
    sessionId: event.sessionId,
    correlationId: event.correlationId,
    summary: event.summary,
    count: 1,
    eventIds: [event.id],
    references: [...event.references],
  })

  private static toGroup = (members: readonly ActivityEvent[]): CondensedItem => {
    const first = members[0]
    const last = members[members.length - 1]
    if (first === undefined || last === undefined) throw new Error('Cannot condense an empty group.')
    const sessions = new Set(members.map(member => member.sessionId ?? 'unknown'))
    const scope = sessions.size === 1 ? ` for ${first.sessionId ?? 'unknown'}` : ` across ${String(sessions.size)} agents`
    return {
      kind: 'group',
      id: `group:${first.id}`,
      at: last.at,
      source: first.source,
      type: first.type,
      level: 'routine',
      sessionId: sessions.size === 1 ? first.sessionId : null,
      correlationId: first.correlationId,
      summary: `${String(members.length)}× ${ActivityTimelineCondensation.typeLabel(first.type)}${scope}`,
      count: members.length,
      eventIds: members.slice(0, MAX_GROUP_MEMBERS).map(member => member.id),
      references: [],
    }
  }

  static condenseEvents = (events: readonly ActivityEvent[], options: { readonly detailed?: boolean } = {}): CondensedItem[] => {
    const sorted = [...events].sort((left, right) => left.at - right.at || left.id.localeCompare(right.id))
    if (options.detailed === true) return sorted.map(ActivityTimelineCondensation.toItem)

    const slots: (CondensedItem | RepeatedAttentionBurst | null)[] = []
    const bursts = new Map<string, RepeatedAttentionBurst>()
    let index = 0
    while (index < sorted.length) {
      const current = sorted[index]
      if (current === undefined) break
      const causeKey = repeatedCauseKey(current)
      if (causeKey !== null) {
        const burst = bursts.get(causeKey)
        if (burst === undefined || current.at - burst.startedAt > REPEATED_ATTENTION_WINDOW_MS) {
          const started: RepeatedAttentionBurst = { startedAt: current.at, members: [current], slot: slots.length }
          bursts.set(causeKey, started)
          slots.push(started)
        } else {
          burst.members.push(current)
          slots[burst.slot] = null
          burst.slot = slots.length
          slots.push(burst)
        }
        index += 1
        continue
      }
      if (current.level === 'attention' || ALWAYS_INDIVIDUAL.has(current.type)) {
        slots.push(ActivityTimelineCondensation.toItem(current))
        index += 1
        continue
      }
      if (current.level === 'routine') {
        const run: ActivityEvent[] = [current]
        let cursor = index + 1
        while (cursor < sorted.length) {
          const next = sorted[cursor]
          if (next === undefined) break
          if (next.level !== 'routine' || next.type !== current.type || next.sessionId !== current.sessionId) break
          if (next.at - current.at > ROUTINE_GROUP_WINDOW_MS) break
          run.push(next)
          cursor += 1
        }
        if (run.length > 1) {
          slots.push(ActivityTimelineCondensation.toGroup(run))
          index = cursor
          continue
        }
        index += 1
        continue
      }
      slots.push(ActivityTimelineCondensation.toItem(current))
      index += 1
    }
    const condensed = slots.flatMap(slot => {
      if (slot === null) return []
      if (!('members' in slot)) return [slot]
      const [only] = slot.members
      return [
        slot.members.length === 1 && only !== undefined
          ? ActivityTimelineCondensation.toItem(only)
          : ActivityTimelineCondensation.toRepeatedAttention(slot.members),
      ]
    })
    return ActivityTimelineCondensation.groupByCorrelation(condensed)
  }

  /** One attention row for a burst of same-cause events; each member's details stay one expansion away (Detailed). */
  private static toRepeatedAttention = (members: readonly ActivityEvent[]): CondensedItem => {
    const first = members[0]
    const last = members[members.length - 1]
    if (first === undefined || last === undefined) throw new Error('Cannot condense an empty burst.')
    const sessions = new Set(members.map(member => member.sessionId ?? 'unknown'))
    const scope = sessions.size === 1 ? '' : ` · across ${String(sessions.size)} agents`
    return {
      kind: 'group',
      id: `repeated:${first.id}`,
      at: last.at,
      source: last.source,
      type: last.type,
      level: 'attention',
      sessionId: sessions.size === 1 ? last.sessionId : null,
      correlationId: null,
      summary: `${String(members.length)}× ${last.summary}${scope}`.slice(0, 500),
      count: members.length,
      eventIds: members.slice(-MAX_GROUP_MEMBERS).map(member => member.id),
      references: [...last.references],
    }
  }

  static groupByCorrelation = (items: readonly CondensedItem[]): CondensedItem[] => {
    const merged: CondensedItem[] = []
    let index = 0
    while (index < items.length) {
      const current = items[index]
      if (current === undefined) break
      if (current.kind !== 'event' || current.correlationId === null || current.level === 'attention') {
        merged.push(current)
        index += 1
        continue
      }
      const run: CondensedItem[] = [current]
      let cursor = index + 1
      while (cursor < items.length) {
        const next = items[cursor]
        if (next === undefined || next.kind !== 'event' || next.correlationId !== current.correlationId || next.level === 'attention') break
        run.push(next)
        cursor += 1
      }
      if (run.length < 2) {
        merged.push(current)
        index += 1
        continue
      }
      const last = run[run.length - 1] ?? current
      merged.push({
        kind: 'group',
        id: `correlation:${current.correlationId}`,
        at: last.at,
        source: current.source,
        type: current.type,
        level: 'notable',
        sessionId: current.sessionId,
        correlationId: current.correlationId,
        summary: `${String(run.length)} related events (${current.correlationId})`,
        count: run.length,
        eventIds: run.flatMap(item => item.eventIds).slice(0, MAX_GROUP_MEMBERS),
        references: [],
      })
      index = cursor
    }
    return merged
  }
}
