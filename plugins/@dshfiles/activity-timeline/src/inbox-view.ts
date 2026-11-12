import type { AttentionItem, AttentionSeverity, AttentionView } from './attention-api.js'
import type { RowSwipeSide } from '@dshfiles/plugin-ui/hooks/row-gestures'

/** Sources the inbox names in words; any other source shows its own id. */
const SOURCE_LABELS = new Map([
  ['agent-questions.child-question', 'Subagent question'],
  ['thread-sidebar.finished-turn', 'Thread turns'],
  ['agent-questions.native-question', 'Thread question'],
  ['jj-integration.land-blocked', 'Land blocked'],
  ['jj-integration.ready-to-land', 'Ready to land'],
  ['ai-accounts.quota-continuation', 'Usage limit'],
  ['traces.alert-firing', 'Alert'],
  ['backlog.attention', 'Backlog'],
  ['hmr-gate.deferred-update', 'Restart needed'],
])

const sourceLabel = (source: string): string => SOURCE_LABELS.get(source) ?? source

export type SnoozeChoice = 'hour' | 'four-hours' | 'tomorrow' | 'change'

/** Tomorrow at 09:00 local time. */
const tomorrowMorning = (now: number): number => {
  const date = new Date(now)
  date.setDate(date.getDate() + 1)
  date.setHours(9, 0, 0, 0)
  return date.getTime()
}

const snoozeTarget = (choice: SnoozeChoice, now: number): { readonly until: number } | { readonly untilChange: true } => {
  if (choice === 'change') return { untilChange: true }
  if (choice === 'hour') return { until: now + 60 * 60 * 1000 }
  if (choice === 'four-hours') return { until: now + 4 * 60 * 60 * 1000 }
  return { until: tomorrowMorning(now) }
}

/** One glyph per severity; colour comes from the row, never from a new token (plan §4.7). */
const SEVERITY_GLYPH = { blocking: '◆', failed: '✕', ready: '●', info: '·' } as const satisfies Record<AttentionSeverity, string>
const severityGlyph = (severity: AttentionSeverity): string => SEVERITY_GLYPH[severity]

const relativeAge = (at: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${String(minutes)} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${String(hours)} h ago`
  return `${String(Math.round(hours / 24))} d ago`
}

/** Which open control a row offers: review a finished turn, open a thread, or open a provider-owned page. */
export type InboxOpenAction = 'review' | 'thread' | 'subject'

/** A finished turn is work to review, not a thread to open for its own sake. */
const openActionOf = (item: AttentionItem): InboxOpenAction => {
  if (item.subject.kind !== 'session') return 'subject'
  return item.source === 'thread-sidebar.finished-turn' ? 'review' : 'thread'
}

/** The thread or item an entry is about, so a row leads with what the user acts on rather than its source sentence. */
const subjectTitleOf = (item: AttentionItem, sessionTitle: (sessionId: string) => string): string =>
  item.subject.kind === 'session' ? sessionTitle(item.subject.id) : (item.subject.label ?? item.subject.id)

/** What a row in `view` can undo: Reopen for Done and Snoozed, Unmute for Muted; resolved items have nothing to undo. */
const undoOf = (item: AttentionItem, view: AttentionView): 'reopen' | 'unsnooze' | 'unmute' | null => {
  if (view === 'muted') return 'unmute'
  if (item.resolvedAt !== null) return null
  if (view === 'closed' && item.doneAt !== null) return 'reopen'
  if (view === 'snoozed') return 'unsnooze'
  return null
}

/** Ids of the open items whose provider offers Resume: one action resumes every one of them. */
const resumableIds = (items: readonly AttentionItem[]): readonly string[] =>
  items.filter(item => item.doneAt === null && item.resolvedAt === null && item.verbs.includes('Resume')).map(item => item.id)

export class InboxView {
  static readonly openActionOf = openActionOf
  static readonly subjectTitleOf = subjectTitleOf
  static readonly sourceLabel = sourceLabel
  static readonly snoozeTarget = snoozeTarget
  static readonly severityGlyph = severityGlyph
  static readonly relativeAge = relativeAge
  static readonly undoOf = undoOf
  static readonly resumableIds = resumableIds
}

/**
 * The verb a phone swipe commits on an Inbox item (T6.1): left is Done, right is Snooze for an hour. Never Land, Approve
 * or an answer: those change code or speak for the user, so they stay a deliberate tap.
 */
export const InboxSwipe = {
  verb: (item: { readonly verbs: readonly string[] }, view: AttentionView, side: RowSwipeSide | undefined): 'done' | 'snooze' | undefined => {
    if (side === undefined || view === 'closed' || view === 'muted') return undefined
    if (side === 'left') return item.verbs.includes('Done') ? 'done' : undefined
    return item.verbs.includes('Snooze') && view !== 'snoozed' ? 'snooze' : undefined
  },
} as const
