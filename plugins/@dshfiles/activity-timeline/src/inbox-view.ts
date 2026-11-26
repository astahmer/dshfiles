import type { AttentionItem, AttentionSeverity, AttentionSubjectKind, AttentionView } from './attention-api.js'
import { ATTENTION_KIND_LABEL } from '@dshfiles/plugin-ui/components/ui/attention-meta'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import type { RowSwipeSide } from '@dshfiles/plugin-ui/hooks/row-gestures'
import { InboxPreview } from './inbox-preview.js'

/**
 * Sources the inbox names in words; any other source shows its own id. An approval and a thread's question use the
 * kit's one word list (council round 14 C1: "Question", never "Thread question"), as the thread list does.
 */
const SOURCE_LABELS = new Map<string, string>([
  ['agent-questions.child-question', 'Subagent question'],
  ['thread-sidebar.finished-turn', 'Thread turns'],
  ['thread-sidebar.approval', ATTENTION_KIND_LABEL.approval],
  ['agent-questions.native-question', ATTENTION_KIND_LABEL.question],
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
 * A question's answers (council round 11 C6): each is the kit's quiet trigger (`field`: the trigger fill and its
 * hairline at rest, the 3:1 edge on hover), and the recommended one differs by its tint only (`attention`). Both at
 * one weight, so the tint is the one difference; the recommendation is also said in words. Council round 12 C3: that
 * weight is 500, and "Recommended" is a 12/400 annotation in secondary ink 12px after the answer (the button's 6px gap
 * plus 6px), not a second label in the tint pushed to the row's end.
 */
const answerVariant = (recommended: boolean): 'attention' | 'field' => (recommended ? 'attention' : 'field')
const ANSWER = 'dshx:font-medium'
const RECOMMENDED = 'dshx:shrink-0 dshx:ml-1.5 dshx:text-xs dshx:font-normal dshx:text-muted-foreground'

/**
 * One answer row (and "Write your own…", council round 12 C3: the same resting trigger look): on a touch screen a
 * full-width row of at least 44px, a long answer wrapping inside it and reading in full (round five C3).
 */
const ANSWER_ROW =
  'dshx:shrink dshx:max-w-full dshx:pointer-coarse:w-full dshx:pointer-coarse:justify-start dshx:pointer-coarse:h-auto dshx:pointer-coarse:min-h-11 dshx:pointer-coarse:py-2.5 dshx:pointer-coarse:whitespace-normal'

/**
 * "Write your own…" after the answers (council round 17 C2): a ghost row, no fill or edge at rest, its pencil in
 * secondary ink and its words in ink at the answers' 500; the hover wash and the answers' row and 44pt target stay.
 */
const WRITE_OWN = 'dshx:text-foreground dshx:[&_svg]:text-muted-foreground'

/**
 * The answers under a question: 8px apart beside each other on a wide pane. Council round 12 C3: on a phone they stack
 * 4px apart and the card ends 4px under the last one (as Review ends the approval card), so the fold reaches the next
 * card's title.
 */
const ANSWERS =
  'dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:px-3 dshx:pt-2 dshx:pb-3 dshx:@max-pane-narrow:gap-y-1 dshx:@max-pane-narrow:pb-1'

/**
 * The verb in a card's head sits on its wash. Council round 12 C2: an approval's Review and a failed card's Review are
 * the same trigger (one size and padding), each in its status tint at the kit's band strength (`band`, kit A2: 20% at
 * rest, 26% hover, 32% pressed), where red text on the red band (council round 9 C3) and a 12% tint lost on the
 * indigo band read as two different controls.
 */
const headVariant = (status: WorkStatus): 'attention' | 'danger-tint' | 'outline' =>
  status === 'failed' ? 'danger-tint' : status === 'needs-you' ? 'attention' : 'outline'

/** Whether a card's head carries a coloured band (headerBand), so a verb in it takes the band tint. */
const onBand = (status: WorkStatus): boolean => status === 'needs-you' || status === 'failed'

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
 * pane) they take the card's own inset, so a question wraps across the card instead of a narrow column. Council round 9
 * (lane B's phone gutter): that inset is 11px inside the 1px border, so text starts 24px from the screen's edge.
 */
const BODY_INSET = 'dshx:pl-9 dshx:@max-pane-narrow:px-[11px]'

/**
 * The verb a card asks for sits in its head row, trailing, before the menu (round five C4, council round 5): 28px on a
 * wide pane, pulled 4px into the row's padding so the 36px band keeps its height. Council round 14 C2: on a touch
 * screen it is drawn 44pt tall (round 12's 28px read as a small target), centred in the head band by HEAD_SEAT_VERB.
 */
const HEAD_VERB = 'dshx:h-7 dshx:pointer-coarse:h-11'

/**
 * The head row's trailing seat (the menu, and on a wide pane the verbs) is an ordinary part of the row at every width.
 * On a compact pane (round six C1) the head is padded 12px by 16px and the seat stays beside the title instead of
 * wrapping under it (the kit drops it to a line of its own on a narrow pane): the title owns the row with its age and ⋯.
 */
const CARD_HEAD =
  // Council round 9 C1: the seat is top-aligned with the title's first line, and its 44px controls sit 8px inside the
  // card's edge, so the ⋯ glyph is 22px from it on every card. The glyph leads 11px inside the border, 24px from the
  // screen's edge (lane B's phone gutter).
  // Council round 10 C2: 8px above and below the head, not 12, so each card is 8px shorter. Council round 12 C3: 6px,
  // so a head whose title holds one line is 52px (6 + 20 + 2 + 18 + 6).
  'dshx:@max-pane-narrow:[&>div:first-child]:items-start dshx:@max-pane-narrow:[&>div:first-child]:pl-[11px] dshx:@max-pane-narrow:[&>div:first-child]:pr-2 dshx:@max-pane-narrow:[&>div:first-child]:py-1.5' +
  ' dshx:@max-pane-narrow:[&_[data-slot=entity-row-trailing]]:w-auto dshx:@max-pane-narrow:[&_[data-slot=entity-row-trailing]]:self-start' +
  // Council round 8 C2: the head's parts are spaced by their muted "·" separators, not by flex gaps.
  ' dshx:[&_span:has(>[data-slot=entity-row-title])]:gap-x-0 dshx:[&_[data-slot=entity-row-meta]]:gap-x-0' +
  // Council round 14 C1: the meta grows to the rest of its line (or wraps to a line of its own), so the kit's
  // AttentionMeta measures the room it really has; a shrink-to-content box would keep it at its last drop step.
  ' dshx:[&_[data-slot=entity-row-meta]]:flex-auto' +
  // Council round 15 C1: a desktop head is two lines as on a phone, 6px above and below (6 + 20 + 2 + 16 + 6 = 50px),
  // its verb and ⋯ centred on both lines (a phone's seat stays level with the title, above).
  ' dshx:[&>div:first-child]:py-1.5 dshx:[&_[data-slot=entity-row-trailing]]:self-center'

/**
 * The muted "·" before a head part after the title (council round 8 C2): 4px each side since council round 14 C1, as
 * the kit's AttentionMeta spaces its own parts, so every "·" on the line sits alike.
 */
const HEAD_SEP = 'dshx:px-1 dshx:text-muted-foreground'

/**
 * The card head's meta line (council round 14 C1): the kit's AttentionMeta, `ProjectMark project · kind · age` with
 * its drop order. 12/16 on a wide pane; on a compact pane 13/18 (the kit's touch meta step), so a one-line head stays
 * 52px.
 */
const HEAD_META = 'dshx:@max-pane-narrow:leading-4.5'

/** One head part (project, kind, link, age): it keeps its words on one line and never shrinks; the title does. */
const HEAD_PART = 'dshx:inline-flex dshx:min-w-0 dshx:shrink-0 dshx:items-center dshx:whitespace-nowrap'

/**
 * Every card head is the same two lines (council round 9 C1 on a compact pane; council round 15 C1 on every width).
 * Line 1: glyph · the full title, wrapping, never cut for metadata · the seat (a bodyless Failed card's verb, then ⋯).
 * Line 2: the project's mark and name · kind · age, muted, 12/16 on a wide pane and 13/18 on a touch screen (the kit's
 * meta step), never opening on a separator. Council round 14 C1: the name shows whole; AttentionMeta drops the age,
 * then the name, when the line runs out.
 */
const HEAD_TWO_LINES =
  'dshx:[&_span:has(>[data-slot=entity-row-title])]:gap-y-0.5' +
  ' dshx:[&_[data-slot=entity-row-meta]]:basis-full dshx:@max-pane-narrow:[&_[data-slot=entity-row-meta]]:leading-4.5' +
  ' dshx:[&_[data-slot=entity-row-meta]>[data-inbox-head-part]:first-child>[data-inbox-head-sep]]:hidden' +
  // A Failed card's verb meets its ⋯: both are 44pt seats, so no gap between them.
  ' dshx:@max-pane-narrow:[&_[data-inbox-row-actions=band]]:gap-0'

/**
 * The head row's seat: 28px controls pulled 4px into the row's padding on a wide pane; on a compact pane its 44pt
 * controls take 8px above and below the title's first line (council round 10 C2), centred on it; since council round 12
 * C3 the head's padding is 6px, so the seat reaches 2px past the band's top, inside the card's clip (important: the
 * touch rule `my-0` is emitted after the container query and would otherwise win on a phone).
 */
const HEAD_SEAT =
  'dshx:-my-1 dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-end dshx:gap-1 dshx:pointer-coarse:my-0 dshx:@max-pane-narrow:-my-2!'

/**
 * A touch screen's seat that holds a verb (a bodyless Failed card's 44pt Review, council round 14 C2): 2px into the
 * head's 6px padding, not 8, so the pill sits 4px inside the 52px band, centred on both head lines; its 40px outer
 * height keeps the head (and the card's clearance above a phone's tab bar) unchanged.
 */
const HEAD_SEAT_VERB = 'dshx:@max-pane-narrow:-my-0.5!'

/**
 * Where a card's verbs sit. Council round 11 C2: with a fine pointer (a desktop) every card's primary verb is in its
 * head's trailing slot, 12px before ⋯ (MENU_AFTER_VERB), approval and failed alike, so Review is always in one place;
 * a question's answers stay under it. A touch screen keeps a body's verb under its evidence, in the thumb's reach; a
 * bodyless (compact) Failed card keeps it in its head everywhere.
 */
const footsVerbs = (compactCard: boolean, coarse: boolean): boolean => !compactCard && coarse

/** The card menu's trigger after a head verb: 8px on the seat's 4px gap, 12px; a compact pane's 44pt seats meet. */
const MENU_AFTER_VERB = 'dshx:not-first:ml-2 dshx:@max-pane-narrow:ml-0!'

/**
 * One card structure (council round 8 C2): the body opens with its evidence (an approval's "Runs: `command`", a
 * question's "Asks: …") and the verb follows it, on every width. On a wide pane the verb sits beside the evidence, 12px
 * after it; on a compact pane under it, 8px below, as a full-width button (round six C1), so a phone fits the failed card.
 */
const EVIDENCE =
  'dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-2 dshx:px-3 dshx:pt-2 dshx:@max-pane-narrow:flex-col dshx:@max-pane-narrow:items-stretch dshx:@max-pane-narrow:gap-2'

/** The body's verbs: a row after the evidence; on a compact pane a stack of full-width buttons. */
const BODY_VERBS = 'dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1 dshx:@max-pane-narrow:flex-col dshx:@max-pane-narrow:items-stretch dshx:@max-pane-narrow:gap-2'

/**
 * A body verb: 28px beside the evidence (a 44pt target on a touch screen); on a compact pane drawn 44pt tall over the
 * full width (council round 16 C2: Review's visible height is its 44pt target, where 36px read as a small control).
 */
const FOOT_VERB = 'dshx:@max-pane-narrow:w-full dshx:@max-pane-narrow:h-11!'
const BODY_VERB = `dshx:shrink dshx:h-7 dshx:pointer-coarse:h-11 ${FOOT_VERB}`

/**
 * That verb's 10px inset on a compact pane (a touch screen gives chips 16px) and no gap before the ghost ⋯, so a title
 * of about 177px ("Upgrade the router to v8") keeps one line at 390px.
 */
const SHORT_VERB = 'dshx:@max-pane-narrow:px-2.5!'

/**
 * The short name a bodyless card's open verb shows on every width (council round 9 C3: "Review", named "Review
 * thread"), so its title keeps the head.
 */
const shortOpenLabelKey = (action: InboxOpenAction): 'review' | 'open' => (action === 'review' || action === 'approval' ? 'review' : 'open')

/** Sources whose type says nothing a card does not (a finished turn): the card names the thread's project instead. */
const PROJECT_SOURCES: ReadonlySet<string> = new Set(['thread-sidebar.finished-turn'])
const namesProject = (source: string): boolean => PROJECT_SOURCES.has(source)

/**
 * What a card head prints after its title, always in one order (council round 7 C1): glyph · title · project · kind ·
 * time. The project shows whenever the client knows the thread's folder; the kind is left out only where it says nothing
 * the card does not (a finished turn's "Thread turns") and a project names the card instead.
 */
export interface InboxHeadMeta {
  /** The thread's project, by name, when the client knows its folder. */
  readonly project: string | undefined
  /** The item's kind in words ("Approval"), unless the project already names the card. */
  readonly kind: string | undefined
}

/** A finished turn that failed says so as its kind (council round 9 C3), where a finished turn otherwise names none. */
const FAILED_TURN_KIND = ATTENTION_KIND_LABEL.failed

const headMeta = (source: string, project: string | undefined, failed = false): InboxHeadMeta => {
  if (failed && namesProject(source)) return { project, kind: FAILED_TURN_KIND }
  return { project, kind: project !== undefined && namesProject(source) ? undefined : sourceLabel(source) }
}

/**
 * A command's words, so it wraps only between them (council round 8 C1): a phone broke `--env` after its dashes. A word
 * longer than about one phone line keeps the ordinary breaks.
 */
const COMMAND_WORD_MAX = 40
const commandWords = (command: string): readonly { readonly text: string; readonly keep: boolean }[] =>
  command.split(' ').map(text => ({ text, keep: text.length <= COMMAND_WORD_MAX }))

/** A card's title at the kit's contextual heading step, 15/20 at 600 (council round 4, A4/C3). */
const TITLE = 'dshx:text-heading'

/**
 * Council round 16 C3: a card body that quotes something (an approval's command, a failed turn's provider line) puts it
 * in the kit's evidence well (`EvidenceWell`: padding 8/12, radius 6, mono 12/18 on its neutral or danger fill) across
 * the text measure, desktop and phone. The body holding it spans the card's width, so the well is never
 * shrink-to-content.
 */
const WELL_BODY = 'dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:gap-0.5'

/** The command inherits the well's mono 12/18 (a UA `code` would set its own font). */
const WELL_CODE = 'dshx:[font:inherit]'

/** A long command shows four lines in the list; a provider error line two. */
const WELL_CLAMP_RUNS = 'dshx:line-clamp-4'
const WELL_CLAMP_ERROR = 'dshx:line-clamp-2'

/**
 * A compact card's body verb under its evidence (council round 11 C1): 4px under it to the card's edge. Council round 16
 * C2: 8px above it, so the evidence well and Review read as two things, not one stacked control.
 */
const VERB_MARGIN = 'dshx:@max-pane-narrow:gap-2 dshx:@max-pane-narrow:pb-1'

/**
 * A question card's "Open thread" in its head (council round 16 C2): a quiet secondary action, ghost with no fill, in
 * secondary ink with a ↗ after it, so the answers under the question are the card's strongest controls. Ink on hover.
 */
const QUIET_OPEN = 'dshx:text-muted-foreground dshx:hover:text-foreground dshx:gap-1 dshx:[&_svg]:size-3.5'

const APPROVAL_SOURCE = 'thread-sidebar.approval'
const APPROVE_LEAD_IN = /^Approve:\s*/u
const FILLER = new Set(['a', 'an', 'the', 'to', 'of'])
const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word !== '' && !FILLER.has(word))

/**
 * What a card prints under its band (council round 4, C3). An approval says its title once: its "Approve: <what>" line
 * goes when <what> only restates the title (the band, its type and its Review verb already say approve), and otherwise
 * keeps <what> without the lead-in; its command reads as a command (in the evidence well). Others are unchanged.
 */
export interface InboxCardText {
  /** The line under the band, or null when the band already says it. */
  readonly reason: string | null
  readonly detail: string | null
  /** The detail is a command an approval would run. */
  readonly command: boolean
}

const cardText = (
  item: { readonly source: string; readonly reason: string | null; readonly detail: string | null },
  title: string,
): InboxCardText => {
  if (item.source !== APPROVAL_SOURCE) return { reason: item.reason, detail: item.detail, command: false }
  const subject = item.reason?.replace(APPROVE_LEAD_IN, '').trim() ?? ''
  const titleWords = new Set(wordsOf(title))
  const restates = subject === '' || wordsOf(subject).every(word => titleWords.has(word))
  return { reason: restates ? null : subject, detail: item.detail, command: item.detail !== null }
}

/**
 * What a failed turn's card says under its title (council round 15 C2). Council round 16 C3: a provider error line
 * shows in the danger evidence well, as does the token limit; a plain error (`stopped-on-error`) draws no well, as the
 * meta already says Turn failed. The order is the provider's error (its detail's first line, as `Error: <line>`), else
 * the failure kind its reason names; with neither, no well. thread-sidebar's failed-turn item carries no error text yet
 * (a Host change, recorded as a follow-up), so its reason's wording is the kind: "“<title>” failed" or "Turn
 * failed." for an error, "… output token limit" for the token limit (thread-sidebar inbox-provider FINISH_COPY).
 */
export type InboxFailureWell =
  | { readonly kind: 'error'; readonly line: string }
  | { readonly kind: 'stopped-on-error' }
  | { readonly kind: 'token-limit' }

const FAILED_TURN_SOURCE = 'thread-sidebar.finished-turn'
const TOKEN_LIMIT_REASON = /output token limit\.?$/u
const ERROR_REASON = /(?:^Turn failed|” failed)\.?$/u

const failureWell = (item: Pick<AttentionItem, 'source' | 'severity' | 'reason' | 'detail'>): InboxFailureWell | null => {
  if (item.severity !== 'failed' || item.source !== FAILED_TURN_SOURCE) return null
  const line = item.detail
    ?.split('\n')
    .map(part => part.trim())
    .find(part => part !== '')
  if (line !== undefined) return { kind: 'error', line }
  const reason = item.reason.trim()
  if (TOKEN_LIMIT_REASON.test(reason)) return { kind: 'token-limit' }
  return ERROR_REASON.test(reason) ? { kind: 'stopped-on-error' } : null
}

/** A Failed item with nothing to say under its band is one row: its title and its recovery verb, no empty body. */
const compact = (status: WorkStatus, text: { readonly reason: string | null; readonly detail: string | null }): boolean =>
  status === 'failed' && text.reason === null && text.detail === null

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
 * taking a row of its own. Hidden everywhere else, including every wider screen. Council round 17 C3: every phone top
 * bar seats its leading and trailing 44pt controls 4pt from the edge (or at the safe-area inset), glyphs centred at x 26
 * and x 364 at 390pt, from the insets the phone shell publishes; the 4px fallback is the same rule.
 */
const PHONE_BAR =
  'dshx-root dshx:fixed dshx:top-[calc(var(--dsh-phone-top-height,44px)-44px)] dshx:right-[var(--dsh-phone-seat-right,4px)] dshx:z-[42] dshx:hidden dshx:h-11 dshx:translate-y-[var(--dsh-visual-offset-top,0px)] dshx:items-center dshx:gap-1 dshx:[html:has([data-phone-top-bar][data-phone-stage=attention-inbox])_&]:flex'

/**
 * The bar's leading seat (round five C4, council round 5): the frame's status button sits left of the centred "Inbox"
 * title, so the trailing corner holds only the menu and Start triage and never runs over the title at 390 px.
 */

const PHONE_BAR_LEADING =
  'dshx-root dshx:fixed dshx:top-[calc(var(--dsh-phone-top-height,44px)-44px)] dshx:left-[var(--dsh-phone-seat-left,4px)] dshx:z-[42] dshx:hidden dshx:h-11 dshx:translate-y-[var(--dsh-visual-offset-top,0px)] dshx:items-center dshx:[html:has([data-phone-top-bar][data-phone-stage=attention-inbox])_&]:flex'

/** The bar's trailing ⋯: a 44pt seat with a 20px glyph in secondary ink, as the thread bar's menu (council round 17 C3). */
const PHONE_BAR_MENU = 'dshx:size-11 dshx:text-muted-foreground dshx:[&_svg]:size-5'

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

/**
 * A page fills its pane (DESIGN.md); the words of a row keep a readable line length on a wide one. Council round 17 C1:
 * a card body's well, prose and answers share this one measure, 36rem, where 72ch in the well's mono 12px, the prose's
 * sans 14px and the answers' own width drew three right edges. A phone is narrower, so its body runs the full card.
 */
const TEXT_MEASURE = 'dshx:max-w-xl'

/** The answers row measures its content box, so its inset stays outside the measure, as the evidence's does. */
const ANSWERS_MEASURE = `dshx:box-content ${TEXT_MEASURE}`

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
  static readonly ANSWERS_MEASURE = ANSWERS_MEASURE
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
  static readonly answerVariant = answerVariant
  static readonly ANSWER = ANSWER
  static readonly RECOMMENDED = RECOMMENDED
  static readonly ANSWER_ROW = ANSWER_ROW
  static readonly WRITE_OWN = WRITE_OWN
  static readonly ANSWERS = ANSWERS
  static readonly headVariant = headVariant
  static readonly onBand = onBand
  static readonly headerBand = headerBand
  static readonly CARD = CARD
  static readonly BODY_INSET = BODY_INSET
  static readonly HEAD_VERB = HEAD_VERB
  static readonly CARD_HEAD = CARD_HEAD
  static readonly HEAD_SEP = HEAD_SEP
  static readonly HEAD_META = HEAD_META
  static readonly HEAD_PART = HEAD_PART
  static readonly HEAD_TWO_LINES = HEAD_TWO_LINES
  static readonly HEAD_SEAT = HEAD_SEAT
  static readonly HEAD_SEAT_VERB = HEAD_SEAT_VERB
  static readonly footsVerbs = footsVerbs
  static readonly MENU_AFTER_VERB = MENU_AFTER_VERB
  static readonly EVIDENCE = EVIDENCE
  static readonly BODY_VERBS = BODY_VERBS
  static readonly BODY_VERB = BODY_VERB
  static readonly FOOT_VERB = FOOT_VERB
  static readonly shortOpenLabelKey = shortOpenLabelKey
  static readonly SHORT_VERB = SHORT_VERB
  static readonly namesProject = namesProject
  static readonly headMeta = headMeta
  static readonly commandWords = commandWords
  static readonly TITLE = TITLE
  static readonly WELL_BODY = WELL_BODY
  static readonly WELL_CODE = WELL_CODE
  static readonly WELL_CLAMP_RUNS = WELL_CLAMP_RUNS
  static readonly WELL_CLAMP_ERROR = WELL_CLAMP_ERROR
  static readonly VERB_MARGIN = VERB_MARGIN
  static readonly QUIET_OPEN = QUIET_OPEN
  static readonly cardText = cardText
  static readonly compact = compact
  static readonly titleCounts = titleCounts
  static readonly PHONE_BAR = PHONE_BAR
  static readonly PHONE_BAR_LEADING = PHONE_BAR_LEADING
  static readonly PHONE_BAR_MENU = PHONE_BAR_MENU
  static readonly bodyReason = bodyReason
  static readonly failureWell = failureWell
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
