import type { AttentionItem, AttentionSeverity, AttentionSubjectKind, AttentionView } from './attention-api.js'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import type { RowSwipeSide } from '@dshfiles/plugin-ui/hooks/row-gestures'
import { InboxPreview } from './inbox-preview.js'

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

/** Subjects whose Ready item is finished work to collect: a turn that ended, a workspace ready to land. */
const FINISHED_WORK: ReadonlySet<AttentionSubjectKind> = new Set(['session', 'workspace'])

/**
 * Plan §4.7: blocking items are Needs you, failed stay Failed, anything closed reads as Done. Ready (the green dot) is
 * kept for finished work; any other Ready item (a waiting backlog item, an update that waits for a restart) is a notice
 * and stays quiet.
 */
const statusOf = (item: AttentionItem, view: AttentionView): WorkStatus => {
  if (view === 'closed') return 'done'
  if (item.severity === 'blocking') return 'needs-you'
  if (item.severity === 'failed') return 'failed'
  return item.severity === 'ready' && FINISHED_WORK.has(item.subject.kind) ? 'ready' : 'idle'
}

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

/** Sources whose items wait on a question: only an answer moves the thread, so a queued prompt never does. */
const QUESTION_SOURCES: ReadonlySet<string> = new Set(['agent-questions.child-question', 'agent-questions.native-question'])

/** The item waits on a question, whether the Inbox can answer it in place or only its thread can. */
const asksQuestion = (item: AttentionItem): boolean => QUESTION_SOURCES.has(item.source) || item.verbs.includes('Answer')

/**
 * Quick replies queue a canned prompt in a thread. They fit a thread that stopped (a failed turn, a usage limit), never
 * one that asked a question: "Continue" does not answer "Which layout?".
 */
const offersQuickReplies = (item: AttentionItem, view: AttentionView): boolean =>
  view !== 'closed' && view !== 'muted' && item.subject.kind === 'session' && item.severity !== 'ready' && !asksQuestion(item)

/**
 * What a row prints under its title: the first paragraph of the reason and the detail, both as plain words. Providers
 * pass a question through as written (Markdown, a table, a fenced chart); the row clamps each to two lines.
 */
const textOf = (item: AttentionItem) => {
  const reason = InboxPreview.firstParagraph(item.reason)
  const detail = item.detail === null ? '' : InboxPreview.flat(item.detail)
  return { reason: reason === '' ? sourceLabel(item.source) : reason, detail: detail === '' ? null : detail }
}

/** A page fills its pane (DESIGN.md); the words of a row keep a readable line length on a wide one. */
const TEXT_MEASURE = 'dshx:max-w-[72ch]'

export interface InboxPageAction {
  readonly id: 'triage' | 'alerts'
  readonly placement: 'inline' | 'overflow'
}

/**
 * The header's actions besides the primary: Start triage (unless it is the primary, as on a phone), then this device's
 * alert settings in the page menu. Settings never sit under the work list.
 */
const pageActions = (input: { readonly triagePrimary: boolean; readonly alertSettings: boolean }): readonly InboxPageAction[] => [
  ...(input.triagePrimary ? [] : [{ id: 'triage', placement: 'inline' } as const]),
  ...(input.alertSettings ? [{ id: 'alerts', placement: 'overflow' } as const] : []),
]

/** Sources whose question the thread does not show itself: a subagent's question lives in the child, not in the parent. */
const THREAD_QUESTION_SOURCES: ReadonlySet<string> = new Set(['agent-questions.child-question'])

/**
 * The open questions a thread shows above its composer, answerable there with their options: the place "Answer" on a
 * thread row lands. A native question form is left out, since its own card already takes the composer seat.
 */
const threadQuestions = (items: readonly AttentionItem[], sessionId: string): readonly AttentionItem[] =>
  items.filter(
    item =>
      item.subject.kind === 'session' &&
      item.subject.id === sessionId &&
      THREAD_QUESTION_SOURCES.has(item.source) &&
      item.verbs.includes('Answer') &&
      item.choices.length > 0 &&
      item.resolvedAt === null &&
      item.doneAt === null,
  )

export class InboxView {
  static readonly threadQuestions = threadQuestions
  static readonly pageActions = pageActions
  static readonly TEXT_MEASURE = TEXT_MEASURE
  static readonly textOf = textOf
  static readonly asksQuestion = asksQuestion
  static readonly offersQuickReplies = offersQuickReplies
  static readonly openActionOf = openActionOf
  static readonly subjectTitleOf = subjectTitleOf
  static readonly sourceLabel = sourceLabel
  static readonly snoozeTarget = snoozeTarget
  static readonly severityGlyph = severityGlyph
  static readonly statusOf = statusOf
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
