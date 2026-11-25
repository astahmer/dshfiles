import type { AttentionItem, AttentionSeverity, AttentionSubjectKind, AttentionView } from './attention-api.js'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import type { RowSwipeSide } from '@dshfiles/plugin-ui/hooks/row-gestures'
import { InboxPreview } from './inbox-preview.js'

/** Sources the inbox names in words; any other source shows its own id. */
const SOURCE_LABELS = new Map([
  ['agent-questions.child-question', 'Subagent question'],
  ['thread-sidebar.finished-turn', 'Thread turns'],
  ['thread-sidebar.approval', 'Approval'],
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

/**
 * The tint rung on the verb a card asks for (round five P2): Needs you indigo, Failed red, anything else a plain
 * outline. The page's one ink button is Start triage.
 */
const attentionVariant = (status: WorkStatus): 'attention' | 'danger-tint' | 'outline' =>
  status === 'needs-you' ? 'attention' : status === 'failed' ? 'danger-tint' : 'outline'

/**
 * The head band of a waiting card (round five C4): glyph, title, type and age on the kit's attention wash (A2), flush
 * with the card's top, so Needs you and Failed read at a glance; the question and the verbs below stay on the card's
 * neutral body. Ink and muted text hold AA on both washes (plugin-ui tests/attention-wash.test.ts).
 */
const headerBand = (status: WorkStatus): string =>
  status === 'needs-you' ? 'dshx:[&>div:first-child]:bg-wash-needs-you-band' : status === 'failed' ? 'dshx:[&>div:first-child]:bg-wash-failed' : ''

/** One card surface per item, desktop and phone: rounded and clipped, so the head band meets its top edge. */
const CARD = 'dshx:relative dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card'


/**
 * A card's question, note and verbs start under its title on a wide pane (36px, past the glyph); on a phone (a narrow
 * pane) they take the card's own 16px inset, so a question wraps across the card instead of a narrow column.
 */
const BODY_INSET = 'dshx:pl-9 dshx:@max-pane-narrow:px-4'

/** On a phone the card's menu sits in its head band's trailing corner, a 44pt target, not on the row of verbs. */
const BAND_MENU = 'dshx:@max-pane-narrow:absolute dshx:@max-pane-narrow:top-0 dshx:@max-pane-narrow:right-1'

/** The phone head band is 44pt tall and keeps the menu's corner free. */
const PHONE_HEAD = 'dshx:@max-pane-narrow:[&>div:first-child]:py-3 dshx:@max-pane-narrow:[&>div:first-child]:pr-12'

/**
 * The title's counts, one StatusCount per status present (◆2 ✕1): the Needs-you view holds blocking items (Needs you)
 * and failed ones (Failed), and one ◆ count of both hid a failure.
 */
const titleCounts = (
  counts: { readonly needsYou: number; readonly blocking: number } | undefined,
): { readonly 'needs-you'?: number; readonly failed?: number } =>
  counts === undefined ? {} : { 'needs-you': counts.blocking, failed: Math.max(0, counts.needsYou - counts.blocking) }

/**
 * The Inbox's header actions on a phone: a bar in the trailing corner of thread-sidebar's top bar, shown only while that
 * bar names the Inbox (`data-phone-stage` is the stage's panel id), so Start triage shares the title row instead of
 * taking a row of its own. Hidden everywhere else, including every wider screen.
 */
const PHONE_BAR =
  'dshx-root dshx:fixed dshx:top-[calc(var(--dsh-phone-top-height,44px)-44px)] dshx:right-[max(12px,env(safe-area-inset-right,0px))] dshx:z-[42] dshx:hidden dshx:h-11 dshx:translate-y-[var(--dsh-visual-offset-top,0px)] dshx:items-center dshx:gap-1 dshx:[html:has([data-phone-top-bar][data-phone-stage=attention-inbox])_&]:flex'

/**
 * The reason a card prints under its head band, or null when it only repeats the title the band already shows (a failed
 * turn reads “<title>” failed: the red cross and the band say failed).
 */
const bodyReason = (reason: string, title: string): string | null => {
  const rest = reason.replace(/^[“"](.*)[”"]\s*/u, (quoted: string, inner: string) => (inner === title ? '' : quoted)).trim()
  return rest !== reason.trim() && /^\p{L}+[.!]?$/u.test(rest) ? null : reason
}

/** A question the card can answer shows in full; any other text clamps to two lines. */
const clampsText = (item: Pick<AttentionItem, 'verbs' | 'choices'>, view: AttentionView): boolean =>
  view === 'closed' || view === 'muted' || !item.verbs.includes('Answer') || item.choices.length === 0

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
export type InboxOpenAction = 'review' | 'approval' | 'thread' | 'subject'

/** A finished turn is work to review, not a thread to open for its own sake. */
const openActionOf = (item: AttentionItem): InboxOpenAction => {
  if (item.subject.kind !== 'session') return 'subject'
  // An approval is decided on its card in the thread, never in the Inbox: its one action opens the card (D4).
  if (item.source === 'thread-sidebar.approval') return 'approval'
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
  view !== 'closed' &&
  view !== 'muted' &&
  item.subject.kind === 'session' &&
  item.severity !== 'ready' &&
  !asksQuestion(item) &&
  // A thread held on an approval cannot take a prompt: the approval is decided on its card (Review).
  openActionOf(item) !== 'approval'

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
const pageActions = (input: {
  readonly triagePrimary: boolean
  readonly alertSettings: boolean
  /** Something is open to triage; without it Start triage is not offered at all (a disabled button is noise). */
  readonly triageable?: boolean
}): readonly InboxPageAction[] => [
  ...(input.triagePrimary || input.triageable === false ? [] : [{ id: 'triage', placement: 'inline' } as const]),
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
  static readonly attentionVariant = attentionVariant
  static readonly headerBand = headerBand
  static readonly CARD = CARD
  static readonly BODY_INSET = BODY_INSET
  static readonly BAND_MENU = BAND_MENU
  static readonly PHONE_HEAD = PHONE_HEAD
  static readonly titleCounts = titleCounts
  static readonly PHONE_BAR = PHONE_BAR
  static readonly bodyReason = bodyReason
  static readonly clampsText = clampsText
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
