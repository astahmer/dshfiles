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

/**
 * The kind a phone's one-line card head prints where the full name would leave the title a few letters (council round 8
 * C1): "Thread question" took ~90px of a 390px head and cut "Reconcile Stripe payouts" to "Reconcile Str…".
 */
const SHORT_SOURCE_LABELS = new Map([
  ['agent-questions.child-question', 'Question'],
  ['agent-questions.native-question', 'Question'],
])

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
 * The verb in a card's head sits on its wash (council round 9 C3): a Failed head is already red, so its verb is red
 * text, not a red fill on a red row.
 */
const headVariant = (status: WorkStatus): 'attention' | 'danger-text' | 'outline' =>
  status === 'failed' ? 'danger-text' : status === 'needs-you' ? 'attention' : 'outline'

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
 * wide pane, pulled 4px into the row's padding so the 36px band keeps its height; a 44pt target on a touch screen.
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
  // Council round 10 C2: 8px above and below the head, not 12, so each card is 8px shorter.
  'dshx:@max-pane-narrow:[&>div:first-child]:items-start dshx:@max-pane-narrow:[&>div:first-child]:pl-[11px] dshx:@max-pane-narrow:[&>div:first-child]:pr-2 dshx:@max-pane-narrow:[&>div:first-child]:py-2' +
  ' dshx:@max-pane-narrow:[&_[data-slot=entity-row-trailing]]:w-auto dshx:@max-pane-narrow:[&_[data-slot=entity-row-trailing]]:self-start' +
  // Council round 8 C2: the head's parts are spaced by their muted "·" separators (6px each side), not by flex gaps.
  ' dshx:[&_span:has(>[data-slot=entity-row-title])]:gap-x-0 dshx:[&_[data-slot=entity-row-meta]]:gap-x-0' +
  // A kind with a short name shows it on a compact pane (council round 8 C1).
  ' dshx:[&_[data-inbox-kind-short]]:hidden dshx:@max-pane-narrow:[&_[data-inbox-kind-short]]:inline dshx:@max-pane-narrow:[&_[data-inbox-kind-long]]:hidden'

/** The muted "·" before each head part after the title (council round 8 C2): 6px each side. */
const HEAD_SEP = 'dshx:px-1.5 dshx:text-muted-foreground'

/** One head part (project, kind, link, age): it keeps its words on one line and never shrinks; the title does. */
const HEAD_PART = 'dshx:inline-flex dshx:min-w-0 dshx:shrink-0 dshx:items-center dshx:whitespace-nowrap'

/**
 * Every card head on a compact pane is the same two lines (council round 9 C1, all seats). Line 1: glyph · the full
 * title, wrapping, never cut for metadata · the seat (a bodyless Failed card's verb, then ⋯). Line 2: the project's
 * mark · kind · age at 13/400 muted (the kit's meta step on a touch screen), never opening on a separator; the
 * project's name is left to the mark.
 */
const HEAD_TWO_LINES =
  'dshx:@max-pane-narrow:[&_span:has(>[data-slot=entity-row-title])]:gap-y-0.5' +
  ' dshx:@max-pane-narrow:[&_[data-slot=entity-row-meta]]:basis-full dshx:@max-pane-narrow:[&_[data-slot=entity-row-meta]]:leading-4.5' +
  ' dshx:@max-pane-narrow:[&_[data-slot=entity-row-meta]>[data-inbox-head-part]:first-child>[data-inbox-head-sep]]:hidden' +
  ' dshx:@max-pane-narrow:[&_[data-inbox-project-name]]:hidden' +
  // A Failed card's verb meets its ⋯: both are 44pt seats, so no gap between them.
  ' dshx:@max-pane-narrow:[&_[data-inbox-row-actions=band]]:gap-0'

/**
 * The head row's seat: 28px controls pulled 4px into the row's padding on a wide pane; on a compact pane its 44pt
 * controls sit inside the 8px padding (council round 10 C2), centred on the title's first line (important: the touch rule `my-0` is emitted after the container
 * query and would otherwise win on a phone).
 */
const HEAD_SEAT =
  'dshx:-my-1 dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-end dshx:gap-1 dshx:pointer-coarse:my-0 dshx:@max-pane-narrow:-my-2!'

/** A card with a body draws its verbs in the body, after its evidence; a bodyless (compact) Failed card keeps them in its head. */
const footsVerbs = (compactCard: boolean): boolean => !compactCard

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
 * A body verb: 28px beside the evidence (a 44pt target on a touch screen); on a compact pane 36px over the full width
 * (council round 7 C2; the kit's ::after keeps a 44px hit area).
 */
const FOOT_VERB = 'dshx:@max-pane-narrow:w-full dshx:@max-pane-narrow:h-9!'
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
  /** A shorter name for the kind on a compact pane ("Question"), when it has one. */
  readonly shortKind?: string
}

/** A finished turn that failed says so as its kind (council round 9 C3), where a finished turn otherwise names none. */
const FAILED_TURN_KIND = 'Turn failed'

const headMeta = (source: string, project: string | undefined, failed = false): InboxHeadMeta => {
  if (failed && namesProject(source)) return { project, kind: FAILED_TURN_KIND }
  const kind = project !== undefined && namesProject(source) ? undefined : sourceLabel(source)
  const shortKind = kind === undefined ? undefined : SHORT_SOURCE_LABELS.get(source)
  return shortKind === undefined ? { project, kind } : { project, kind, shortKind }
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
 * A command an approval would run (council round 8 C2): 12/16 mono in ink after its muted "Runs:" lead-in, so the
 * evidence the user reviews reads at full contrast.
 */
const COMMAND = 'dshx:font-mono dshx:text-xs dshx:leading-4 dshx:text-foreground'

/**
 * The lead-in before an approval's command: 12/16 sans, muted. On a compact pane its two-line clamp lets go, since the
 * command under it is a block that clamps itself (COMMAND_BLOCK).
 */
const LEAD_IN = 'dshx:font-sans dshx:text-xs dshx:leading-4 dshx:text-muted-foreground dshx:@max-pane-narrow:line-clamp-none'

/**
 * On a compact pane the command is a block (council round 9 C1): 13/18 mono (COMMAND's meta step is 13px on a touch
 * screen), a wrapped line hanging 2ch under the first, at most four lines. Council round 11 C1: the block holds its
 * "Runs" caption (RUNS_BLOCK, RUNS_CAPTION), so the command line is one object instead of a label above a box.
 */
const COMMAND_BLOCK =
  'dshx:@max-pane-narrow:line-clamp-4 dshx:@max-pane-narrow:pl-[2ch] dshx:@max-pane-narrow:-indent-[2ch] dshx:@max-pane-narrow:leading-4.5'

/**
 * The approval's evidence on a compact pane (council round 11 C1): one muted block, 6px radius, 8px by 10px inside,
 * "Runs" as its 12/16 muted caption on the first line and the command under it. A wide pane keeps "Runs: command" inline.
 */
const RUNS_BLOCK = 'dshx:@max-pane-narrow:block dshx:@max-pane-narrow:rounded-md dshx:@max-pane-narrow:bg-muted dshx:@max-pane-narrow:px-2.5 dshx:@max-pane-narrow:py-2'

/** The block's caption: "Runs" with no colon, 12/16, on its own line (the inline "Runs:" hides there). */
const RUNS_CAPTION = 'dshx:hidden dshx:@max-pane-narrow:block dshx:@max-pane-narrow:mb-0.5'
const RUNS_INLINE = 'dshx:@max-pane-narrow:hidden'

/**
 * A compact card's body verb under its evidence (council round 11 C1): 4px above and below, so the approval card is
 * the block, Review, and the card's edge with no slack between them.
 */
const VERB_MARGIN = 'dshx:@max-pane-narrow:gap-1 dshx:@max-pane-narrow:pb-1'

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
 * keeps <what> without the lead-in; its command reads as a command (`command`, drawn in COMMAND). Others are unchanged.
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
 * taking a row of its own. Hidden everywhere else, including every wider screen.
 */
const PHONE_BAR =
  'dshx-root dshx:fixed dshx:top-[calc(var(--dsh-phone-top-height,44px)-44px)] dshx:right-[max(12px,env(safe-area-inset-right,0px))] dshx:z-[42] dshx:hidden dshx:h-11 dshx:translate-y-[var(--dsh-visual-offset-top,0px)] dshx:items-center dshx:gap-1 dshx:[html:has([data-phone-top-bar][data-phone-stage=attention-inbox])_&]:flex'

/**
 * The bar's leading seat (round five C4, council round 5): the frame's status button sits left of the centred "Inbox"
 * title, so the trailing corner holds only the menu and Start triage and never runs over the title at 390 px.
 */
/**
 * Start triage on a phone (council round 11 C1): a worded "Triage" text button, 44px tall, in the top bar's trailing
 * seats beside ⋯ (InboxPhoneBar), in ink at the bar's 14/500, so the view switcher's row holds only the segments and
 * the Needs you tally. (Round 9 put a worded button on that row, round 10 a framed list-checks square; both crowded it.)
 */
const PHONE_TRIAGE = 'dshx:h-11 dshx:px-3 dshx:text-sm dshx:font-medium dshx:text-foreground'

const PHONE_BAR_LEADING =
  'dshx-root dshx:fixed dshx:top-[calc(var(--dsh-phone-top-height,44px)-44px)] dshx:left-[max(12px,env(safe-area-inset-left,0px))] dshx:z-[42] dshx:hidden dshx:h-11 dshx:translate-y-[var(--dsh-visual-offset-top,0px)] dshx:items-center dshx:[html:has([data-phone-top-bar][data-phone-stage=attention-inbox])_&]:flex'

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
  static readonly headVariant = headVariant
  static readonly headerBand = headerBand
  static readonly CARD = CARD
  static readonly BODY_INSET = BODY_INSET
  static readonly HEAD_VERB = HEAD_VERB
  static readonly CARD_HEAD = CARD_HEAD
  static readonly HEAD_SEP = HEAD_SEP
  static readonly HEAD_PART = HEAD_PART
  static readonly HEAD_TWO_LINES = HEAD_TWO_LINES
  static readonly HEAD_SEAT = HEAD_SEAT
  static readonly footsVerbs = footsVerbs
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
  static readonly COMMAND = COMMAND
  static readonly LEAD_IN = LEAD_IN
  static readonly COMMAND_BLOCK = COMMAND_BLOCK
  static readonly RUNS_BLOCK = RUNS_BLOCK
  static readonly RUNS_CAPTION = RUNS_CAPTION
  static readonly RUNS_INLINE = RUNS_INLINE
  static readonly VERB_MARGIN = VERB_MARGIN
  static readonly cardText = cardText
  static readonly compact = compact
  static readonly titleCounts = titleCounts
  static readonly PHONE_BAR = PHONE_BAR
  static readonly PHONE_BAR_LEADING = PHONE_BAR_LEADING
  static readonly PHONE_TRIAGE = PHONE_TRIAGE
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
