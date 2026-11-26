import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { useApi, usePlugin, useRegistry, useResource, type CommandTrigger } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { KeyHint } from '@dshfiles/plugin-ui/components/ui/kbd'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { EmptyState, Page } from '@dshfiles/plugin-ui/components/page'
import { PeekCard, RowPeek } from '@dshfiles/plugin-ui/components/peek'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import { useCommands } from '@dshfiles/plugin-ui/hooks/commands'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { ProjectMark } from '@dshfiles/plugin-ui/components/ui/project-mark'
import { useLastReply, type RetainThread } from '@dshfiles/plugin-ui/hooks/last-reply'
import { RowGestureModel, useRowGestures } from '@dshfiles/plugin-ui/hooks/row-gestures'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { ArrowRightIcon, BellIcon, CheckIcon, ClockIcon, EllipsisIcon, InboxIcon, ListChecksIcon, MessagesSquareIcon, PencilLineIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { fromPromise, useMachine } from '@dshfiles/plugin-ui/machine'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { LoadError } from '@dshfiles/plugin-ui/components/load-error'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ATTENTION_LIST_LIMIT,
  ATTENTION_READ,
  attentionApi,
  type AttentionItem,
  type AttentionProviderVerb,
  type AttentionSubject,
  type AttentionSubjectKind,
  type AttentionView,
} from './attention-api.js'
import { AttentionSubjectOpeners, type AttentionSubjectOpener } from './attention-openers.js'
import { HeldOrder } from './held-order.js'
import { InboxQuickReplies } from './quick-replies.js'
import { InboxKeys } from './inbox-keys.js'
import { InboxAlerts } from './inbox-alerts.js'
import { InboxPush } from './web-push-client.js'
import { INBOX_CHIP, TriageBar, TriageReply, TriageZero } from './triage-stage.js'
import { triageMachine, TriageModel, type TriageRequest } from './triage-machine.js'
import type { PrimaryAction } from './inbox-keys.js'
import type { InboxTranslate } from './inbox-locales.js'
import { usePublishInboxPhoneActions } from './inbox-phone-bar.js'
import { InboxSwipe, InboxView, type SnoozeChoice } from './inbox-view.js'
import { ThreadReferences } from './thread-reference.js'

const PROVIDER_VERBS: readonly AttentionProviderVerb[] = ['Approve', 'Land', 'Retry', 'Resume']

/**
 * The list is a stack of cards (each item draws its own surface, InboxView.CARD), not one bordered box of rows: 16px
 * apart, 8px on a compact pane, where the band and the border already part them and the third card's action stays above
 * the fold (round six C1).
 */
const INBOX_STACK = 'dshx:gap-4 dshx:divide-y-0 dshx:rounded-none dshx:border-0 dshx:bg-transparent dshx:@max-pane-narrow:gap-2'

/** A prompt-library reply a stopped thread's card offers in its menu. */
interface InboxQuickReply {
  readonly id: string
  readonly label: string
  readonly disabled: boolean
  readonly onSelect: () => void
}

export interface Navigation {
  readonly sessions: ISessions
  readonly uiWorkspace: UiWorkspace
  readonly workspaces: IWorkspaces
  /** Open a thread's work in its Changes view (dshx `Changes`); false when no Changes owner is loaded. */
  readonly review?: ((input: { readonly sessionId: string; readonly workspacePath: string }) => boolean) | undefined
  /** Open the retained notification history (thread-sidebar); false when that page is not loaded (b:ysaj). */
  readonly openNotifications?: (() => boolean) | undefined
}

/** The folder a thread works in, for Review; undefined for a thread the list does not know or one without a folder. */
const threadFolderOf = (navigation: Navigation, sessionId: string): string | undefined => {
  const sessionList = navigation.sessions.list.getSnapshot()
  const listedId = sessionList.ids.find(candidate => candidate === sessionId)
  const cwd = listedId === undefined ? undefined : sessionList.byId[listedId]?.cwd
  return cwd === undefined || cwd === '' ? undefined : cwd
}

/** Open a thread the user can still reach; an archived or missing one reports why instead of reviving it. */
export const openThread = (navigation: Navigation, sessionId: string): boolean => {
  const workspaceList = navigation.workspaces.list.getSnapshot()
  if (workspaceList.phase !== 'ready' || workspaceList.archivedSessionIds.some(archivedId => archivedId === sessionId)) return false
  const sessionList = navigation.sessions.list.getSnapshot()
  const availableId = sessionList.ids.find(candidate => candidate === sessionId)
  if (availableId === undefined || sessionList.byId[availableId] === undefined) return false
  try {
    navigation.uiWorkspace.openSession(availableId)
    return true
  } catch {
    return false
  }
}

/** The pages other plugins let the inbox open, by subject kind; absent for a kind nobody contributed. */
export const useSubjectOpeners = (): ReadonlyMap<AttentionSubjectKind, AttentionSubjectOpener> => {
  const openers = useRegistry(AttentionSubjectOpeners)
  return useMemo(() => new Map(openers.map(opener => [opener.subjectKind, opener])), [openers])
}

/** Open an item's subject wherever it lives: its thread, or the page its provider registered. */
export const useInboxOpener = (navigation: Navigation): ((subject: AttentionSubject) => boolean) => {
  const openers = useSubjectOpeners()
  return useCallback(
    (subject: AttentionSubject) => {
      if (subject.kind === 'session') return openThread(navigation, subject.id)
      return openers.get(subject.kind)?.open(subject) ?? false
    },
    [navigation, openers],
  )
}

const statusOf = InboxView.statusOf

const statusLabelOf = (status: WorkStatus, t: InboxTranslate): string => {
  switch (status) {
    case 'needs-you':
      return t('severityBlocking')
    case 'failed':
      return t('severityFailed')
    case 'ready':
      return t('severityReady')
    case 'idle':
      return t('severityInfo')
    default:
      return t('closed')
  }
}

/** A touch-first device (the phone rules apply under `pointer: coarse`); read once, it does not change mid-session. */
let coarsePointerMatch: boolean | undefined
export const coarsePointer = (): boolean => {
  coarsePointerMatch ??= typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  return coarsePointerMatch
}

/** What Open is called for an item: review a finished turn, open its thread, or the page its provider registered. */
const openLabelOf = (item: AttentionItem, opener: AttentionSubjectOpener | undefined, t: InboxTranslate): string => {
  const openAction = InboxView.openActionOf(item)
  if (openAction === 'approval') return t('review')
  return openAction === 'review' ? t('reviewThread') : openAction === 'thread' ? t('openThread') : t('openSubject', { label: opener?.label ?? '' })
}

/** The muted "·" before a card head's part (council round 8 C2); decorative, the parts read in order without it. */
const HeadSep = (): JSX.Element => (
  <span aria-hidden data-inbox-head-sep="" className={InboxView.HEAD_SEP}>
    ·
  </span>
)

const InboxRow = (props: {
  readonly item: AttentionItem
  readonly view: AttentionView
  readonly t: InboxTranslate
  readonly now: number
  readonly sessionLabel: (sessionId: string) => string
  /** The project a thread works in, by name; undefined when the client does not know its folder. */
  readonly projectOf: (sessionId: string) => string | undefined
  readonly busy: boolean
  readonly openers: ReadonlyMap<AttentionSubjectKind, AttentionSubjectOpener>
  readonly onOpen: (item: AttentionItem) => void
  readonly onOpenThread: (sessionId: string) => void
  /** Open the item's thread in its Changes view; absent when nothing can show Changes for this item. */
  readonly onReview: ((item: AttentionItem) => void) | undefined
  readonly onAct: (item: AttentionItem, verb: AttentionProviderVerb, choiceId?: string) => void
  readonly onDone: (item: AttentionItem) => void
  readonly onSnooze: (item: AttentionItem, choice: SnoozeChoice) => void
  readonly onReopen: (item: AttentionItem) => void
  readonly onMute: (source: string, muted: boolean) => void
  /** The keyboard highlight is on this row (J/K); it holds focus so the list's keys reach it. */
  readonly cursor?: boolean
  /** Picked with X or Shift+J/K for a batch Done or Snooze. */
  readonly selected?: boolean
  readonly rowRef?: (element: HTMLDivElement | null) => void
  readonly onFocusRow?: () => void
  /** The choice keys (1–9) shown on the answer buttons while this row is highlighted. */
  readonly showChoiceKeys?: boolean
  /** Quick replies for a stopped thread (prompt library), sent to that thread; never on an item that asks a question. */
  readonly quickReplies?: (sessionId: string) => readonly InboxQuickReply[]
  /** Bumped by Triage's Enter on a Land item: open the Land confirmation, never Land itself. */
  readonly landSignal?: number
  /** Triage shows the item only: its bar is the one action row, so the card draws none of its own. */
  readonly actionRow?: boolean
}): JSX.Element => {
  const { item, t } = props
  const [confirmingLand, setConfirmingLand] = useState(false)
  // Phone: the item is a full card; swipe left for Done, right for Snooze; a long press opens its action sheet.
  const phone = coarsePointer()
  const [sheetOpen, setSheetOpen] = useState(false)
  const gestures = useRowGestures({
    swipe: phone && !props.busy && (InboxSwipe.verb(item, props.view, 'left') !== undefined || InboxSwipe.verb(item, props.view, 'right') !== undefined),
    onSwipe: side => {
      const verb = InboxSwipe.verb(item, props.view, side)
      if (verb === 'done') props.onDone(item)
      else if (verb === 'snooze') props.onSnooze(item, 'hour')
    },
    onLongPress: phone ? () => setSheetOpen(true) : undefined,
  })
  const revealed = InboxSwipe.verb(item, props.view, RowGestureModel.revealed(gestures.offset))
  useEffect(() => {
    if ((props.landSignal ?? 0) > 0) setConfirmingLand(true)
  }, [props.landSignal])
  const open = props.view !== 'closed' && props.view !== 'muted'
  const undo = InboxView.undoOf(item, props.view)
  const status = statusOf(item, props.view)
  const statusLabel = statusLabelOf(status, t)
  const title = InboxView.subjectTitleOf(item, props.sessionLabel)
  const text = InboxView.textOf(item)
  // Council round 4 (C3): an approval says its title once and reads its command as one; a bodyless Failed item is one row.
  const card = InboxView.cardText({ source: item.source, reason: InboxView.bodyReason(text.reason, title), detail: text.detail }, title)
  const reason = card.reason
  const compact = InboxView.compact(status, card)
  const clamped = InboxView.clampsText(item, props.view)
  // A question the card answers reads at body size in ink; any other text is a muted note under the head band.
  const answerable = open && item.verbs.includes('Answer') && item.choices.length > 0
  const doneable = open && item.verbs.includes('Done')
  const snoozable = open && props.view !== 'snoozed' && item.verbs.includes('Snooze')
  const mutable = open && item.verbs.includes('MuteSource')
  const quickReplies = InboxView.offersQuickReplies(item, props.view) ? (props.quickReplies?.(item.subject.id) ?? []) : []
  const opener = item.subject.kind === 'session' ? undefined : props.openers.get(item.subject.kind)
  const openable = item.subject.kind === 'session' || opener !== undefined
  const openLabel = openLabelOf(item, opener, t)
  const project = item.subject.kind === 'session' ? props.projectOf(item.subject.id) : undefined
  const head = InboxView.headMeta(item.source, project, status === 'failed')
  const referencedThreadId =
    item.subject.kind === 'session'
      ? null
      : (ThreadReferences.threadIdIn(item.reason) ?? (item.detail === null ? null : ThreadReferences.threadIdIn(item.detail)))
  /**
   * The card's verbs: on a desktop in the head's trailing slot before the menu (council round 11 C2), on a touch screen
   * in the body right after the evidence they act on (council round 8 C2); a bodyless Failed card keeps its one verb in
   * the head, under its short name (council round 9 C3: "Review", named "Review thread"). A question's answers stay
   * under it. The head holds glyph · title · project · kind · time, the verb and the menu.
   */
  const hasVerbs =
    (open && PROVIDER_VERBS.some(verb => item.verbs.includes(verb))) || (open && props.onReview !== undefined) || (openable && !answerable) || undo !== null
  const footed = InboxView.footsVerbs(compact, phone)
  const hasMenu = doneable || snoozable || quickReplies.length > 0 || mutable
  const verbButtons = (place: 'head' | 'body'): JSX.Element => {
    const size = place === 'head' ? cn('dshx:shrink', InboxView.HEAD_VERB) : InboxView.BODY_VERB
    const shortLabel = place === 'head' && !footed ? t(InboxView.shortOpenLabelKey(InboxView.openActionOf(item))) : null
    return (
      <>
          {open
            ? PROVIDER_VERBS.filter(verb => item.verbs.includes(verb)).map(verb =>
                verb === 'Land' ? (
                  <Button
                    key={verb}
                    size="sm"
                    variant="outline"
                    className={cn(INBOX_CHIP, size)}
                    disabled={props.busy}
                    onClick={() => setConfirmingLand(true)}
                  >
                    {t('land')}
                  </Button>
                ) : (
                  <Button
                    key={verb}
                    size="sm"
                    variant="outline"
                    className={cn(INBOX_CHIP, size)}
                    disabled={props.busy}
                    onClick={() => props.onAct(item, verb)}
                  >
                    {verb}
                  </Button>
                ),
              )
            : null}
          {open && props.onReview !== undefined ? (
            <Button size="sm" variant="outline" className={cn(INBOX_CHIP, size)} onClick={() => props.onReview?.(item)}>
              {t('review')}
            </Button>
          ) : null}
          {/* A question's answers are its verbs; on a desktop its head still seats a quiet Open (council round 13 C2), so
              the verb column down the list has no hole. Council round 14 C3: it names where it goes, "Open thread" with a
              12px arrow. */}
          {place === 'head' && openable && answerable ? (
            <Button
              size="sm"
              variant="ghost"
              data-inbox-open-quiet=""
              className={cn('dshx:max-w-full dshx:text-muted-foreground dshx:hover:text-foreground', INBOX_CHIP, size, InboxView.SHORT_VERB)}
              onClick={() => props.onOpen(item)}
            >
              <span className="dshx:truncate">{openLabel}</span>
              <ArrowRightIcon aria-hidden className="dshx:size-3" />
            </Button>
          ) : null}
          {openable && !answerable ? (
            <Button
              size="sm"
              variant={
                open && !item.verbs.includes('Answer') ? (place === 'head' ? InboxView.headVariant(status) : InboxView.attentionVariant(status)) : 'ghost'
              }
              band={place === 'head' && InboxView.onBand(status)}
              className={cn('dshx:max-w-full', INBOX_CHIP, size, shortLabel !== null && InboxView.SHORT_VERB)}
              aria-label={openLabel}
              onClick={() => props.onOpen(item)}
            >
              <span className="dshx:truncate">{shortLabel ?? openLabel}</span>
            </Button>
          ) : null}
          {undo === 'reopen' || undo === 'unsnooze' ? (
            <Button size="sm" variant="outline" className={size} disabled={props.busy} onClick={() => props.onReopen(item)}>
              {undo === 'reopen' ? t('reopen') : t('unsnooze')}
            </Button>
          ) : null}
          {undo === 'unmute' ? (
            <Button size="sm" variant="outline" className={size} disabled={props.busy} onClick={() => props.onMute(item.source, false)}>
              {t('unmuteSource')}
            </Button>
          ) : null}
      </>
    )
  }
  const headVerbs = (
        <div data-inbox-row-actions="band" className={cn(InboxView.HEAD_SEAT, phone && !footed && InboxView.HEAD_SEAT_VERB)}>
          {footed ? null : verbButtons('head')}
          {/* Utility verbs live in the card's menu (round five P2): the row shows the one verb it asks for. */}
          {hasMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  data-inbox-card-menu=""
                  className={cn('dshx:size-7 dshx:pointer-coarse:size-11', InboxView.MENU_AFTER_VERB)}
                  aria-label={t('more')}
                  disabled={props.busy}
                >
                  <EllipsisIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="dshx-root">
                {doneable ? (
                  <DropdownMenuItem keys="E" onSelect={() => props.onDone(item)}>
                    <CheckIcon aria-hidden />
                    {t('done')}
                  </DropdownMenuItem>
                ) : null}
                {snoozable ? (
                  <>
                    <DropdownMenuLabel className="dshx:flex dshx:items-center dshx:gap-2">
                      <ClockIcon aria-hidden className="dshx:size-3.5" />
                      {t('snooze')}
                    </DropdownMenuLabel>
                    <DropdownMenuItem keys="H" onSelect={() => props.onSnooze(item, 'hour')}>
                      {t('snoozeHour')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => props.onSnooze(item, 'four-hours')}>{t('snoozeFourHours')}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => props.onSnooze(item, 'tomorrow')}>{t('snoozeDay')}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => props.onSnooze(item, 'change')}>{t('snoozeChange')}</DropdownMenuItem>
                  </>
                ) : null}
                {quickReplies.length === 0 ? null : (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>{t('quickReplies')}</DropdownMenuLabel>
                    {quickReplies.map(reply => (
                      <DropdownMenuItem key={reply.id} disabled={reply.disabled} onSelect={reply.onSelect}>
                        <span className="dshx:truncate">{reply.label}</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                {mutable ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => props.onMute(item.source, true)}>{t('muteSource')}</DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
  )
  /** The answers a question offers, under it: the one row of controls a card body keeps. */
  const answers = !answerable ? null : (
        <div
          data-inbox-row-actions=""
          className={cn(InboxView.ANSWERS, InboxView.BODY_INSET)}
        >
          {[
                ...item.choices.map((choice, index) => (
                  <Button
                    key={choice.id}
                    size="sm"
                    variant={InboxView.answerVariant(choice.recommended === true)}
                    // On a phone each option is a full-width row of at least 44 px (InboxView.ANSWER_ROW).
                    className={cn(INBOX_CHIP, InboxView.ANSWER, InboxView.ANSWER_ROW)}
                    disabled={props.busy}
                    onClick={() => props.onAct(item, 'Answer', choice.id)}
                  >
                    {props.showChoiceKeys === true && index < 9 ? <KeyHint keys={String(index + 1)} className="dshx:opacity-70" /> : null}
                    <span className="dshx:truncate dshx:pointer-coarse:whitespace-normal dshx:pointer-coarse:text-left">{choice.label}</span>
                    {/* The recommendation reads in words, not only in the tint (round five C4). */}
                    {choice.recommended === true ? (
                      <span data-inbox-recommended="" className={InboxView.RECOMMENDED}>
                        {t('recommended')}
                      </span>
                    ) : null}
                  </Button>
                )),
                // A custom reply sits beside the answers: it opens the thread, where the composer takes free text.
                openable ? (
                  <Button
                    key="write-own"
                    size="sm"
                    variant="field"
                    data-inbox-write-own=""
                    // Council round 12 C3: the answers' resting trigger look and row, its pencil saying it opens the thread.
                    className={cn(INBOX_CHIP, InboxView.ANSWER, InboxView.ANSWER_ROW)}
                    onClick={() => props.onOpen(item)}
                  >
                    <PencilLineIcon aria-hidden />
                    <span className="dshx:truncate">{t('writeOwn')}</span>
                  </Button>
                ) : null,
              ]}
          {/* Any other verb a question card offers follows its answers (council round 8 C2). */}
          {footed && hasVerbs && props.actionRow !== false ? verbButtons('body') : null}
        </div>
  )
  /**
   * What the card acts on, first in its body (council round 8 C2): a question's "Asks: …" in ink at body size, an
   * approval's "Runs: `command`" (12/16, the command in ink mono), any other note muted.
   */
  const evidence =
    reason === null && card.detail === null ? null : (
      <div
        data-inbox-card-body=""
        className={cn(
          'dshx:flex dshx:min-w-0 dshx:flex-[0_1_auto] dshx:flex-col dshx:gap-0.5',
          answerable ? 'dshx:text-sm dshx:text-foreground' : 'dshx:text-xs dshx:text-muted-foreground',
        )}
      >
        {reason === null ? null : <span className={cn(clamped && 'dshx:line-clamp-2', 'dshx:break-words', InboxView.TEXT_MEASURE)}>{reason}</span>}
        {card.detail === null ? null : card.command ? (
          <span data-inbox-runs="" className={cn(clamped && 'dshx:line-clamp-2', 'dshx:break-words', InboxView.LEAD_IN, InboxView.RUNS_BLOCK, InboxView.TEXT_MEASURE)}>
            {/* "Runs: command" inline on every width (council round 13 C1); a compact pane draws it as one muted block. */}
            <span>{t('runs')}</span>{' '}
            <code className={cn(InboxView.COMMAND, InboxView.COMMAND_BLOCK)}>
              {InboxView.commandWords(card.detail).map((word, index) => (
                <span key={index}>
                  {index === 0 ? null : ' '}
                  {word.keep ? <span className="dshx:whitespace-nowrap">{word.text}</span> : word.text}
                </span>
              ))}
            </code>
          </span>
        ) : (
          <span className={cn(clamped && 'dshx:line-clamp-2', 'dshx:break-words', answerable && 'dshx:text-xs dshx:text-muted-foreground', InboxView.TEXT_MEASURE)}>
            {card.detail}
          </span>
        )}
      </div>
    )
  /** The verbs, right after the evidence they act on; a question's verbs follow its answers instead. */
  const bodyVerbs =
    props.actionRow === false || !footed || !hasVerbs || answers !== null ? null : (
      <div data-inbox-row-actions="body" className={InboxView.BODY_VERBS}>
        {verbButtons('body')}
      </div>
    )
  const row = (
    <EntityRow
      role="listitem"
      ref={props.rowRef}
      {...(phone ? { 'data-row-gestures': '', ...gestures.handlers } : {})}
      style={gestures.offset === 0 ? undefined : { transform: `translateX(${String(gestures.offset)}px)` }}
      tabIndex={-1}
      onFocus={event => {
        if (event.target === event.currentTarget) props.onFocusRow?.()
      }}
      selected={props.selected === true}
      data-cursor={props.cursor === true ? '' : undefined}
      className={cn(
        // The card draws the surface (InboxView.CARD); the row fills it edge to edge, so the head band is flush with its top.
        'dshx:rounded-none dshx:bg-card dshx:scroll-my-2 dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:focus-visible:ring-inset dshx:data-[cursor]:bg-muted/50',
        // The swipe reveal sits under the row.
        'dshx:relative',
        // The verbs and the menu share the head row with the title on every width (round five C4, council round 5).
        InboxView.CARD_HEAD,
        // On a phone every card's head is the same two lines: glyph · full title · seat, then mark · kind · age (council
        // round 9 C1).
        InboxView.HEAD_TWO_LINES,
        phone && gestures.offset === 0 && 'dshx:transition-transform dshx:duration-150',
        InboxView.headerBand(status),
      )}
      data-attention-item={item.id}
      data-severity={item.severity}
      status={status}
      statusLabel={statusLabel}
      heading={<span className={InboxView.TITLE}>{title}</span>}
      trailing={(props.actionRow === false && !compact) || (footed && !hasMenu) ? undefined : headVerbs}
      meta={
        <>
          {/* Every head reads glyph · title · project · kind · time with muted "·" separators (council round 7 C1, round 8
              C2); a finished turn's project replaces its "Thread turns" kind (round five C4), and a failed one reads "Turn
              failed" (council round 9 C3). On a phone these parts take a second line under the full title
              (InboxView.HEAD_TWO_LINES). */}
          {head.project === undefined ? null : (
            <span data-inbox-head-part="project" data-inbox-project="" className={InboxView.HEAD_PART}>
              <HeadSep />
              <ProjectMark name={head.project} size="dense" />
              <span data-inbox-project-name="" className="dshx:truncate dshx:pl-1.5">
                {head.project}
              </span>
            </span>
          )}
          {head.kind === undefined ? null : (
            <span data-inbox-head-part="kind" className={InboxView.HEAD_PART}>
              <HeadSep />
              {head.shortKind === undefined ? (
                head.kind
              ) : (
                <>
                  <span data-inbox-kind-long="">{head.kind}</span>
                  <span data-inbox-kind-short="">{head.shortKind}</span>
                </>
              )}
            </span>
          )}
          {referencedThreadId === null ? null : (
            <span data-inbox-head-part="thread" className={InboxView.HEAD_PART}>
              <HeadSep />
              <button
                type="button"
                className="dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:font-medium dshx:text-info dshx:underline-offset-2 dshx:hover:underline dshx:pointer-coarse:min-h-11"
                onClick={() => props.onOpenThread(referencedThreadId)}
              >
                <MessagesSquareIcon aria-hidden className="dshx:size-3" />
                {t('openThread')}
              </button>
            </span>
          )}
          <span data-inbox-head-part="age" className={InboxView.HEAD_PART}>
            <HeadSep />
            <span data-inbox-age="">{InboxView.relativeAge(item.openedAt, props.now)}</span>
          </span>
          {item.occurrences > 1 ? <Badge variant="outline" className="dshx:ml-2">{`${String(item.occurrences)} ${t('occurrences')}`}</Badge> : null}
          {item.resolvedAt !== null ? <Badge variant="secondary" className="dshx:ml-2">{t('resolved')}</Badge> : null}
          {props.view === 'snoozed' ? (
            <Badge variant="outline" className="dshx:ml-2">
              {item.snoozeUntilChange ? t('snoozedUntilChange') : `${t('snoozedUntil')} ${new Date(item.snoozedUntil ?? 0).toLocaleString()}`}
            </Badge>
          ) : null}
        </>
      }
    >
      {evidence === null && bodyVerbs === null ? null : (
        <div
          data-inbox-card-evidence=""
          className={cn(
            InboxView.EVIDENCE,
            InboxView.BODY_INSET,
            // The body ends the card unless answers follow it; a phone's verb ends it 8px from the edge (council round 7 C2).
            (answers === null || props.actionRow === false) && 'dshx:pb-3',
            answers === null && bodyVerbs !== null && InboxView.VERB_MARGIN,
          )}
        >
          {evidence}
          {bodyVerbs}
        </div>
      )}
      {props.actionRow === false ? null : answers}
      {/* Land rebases the thread's work onto the bookmark and moves it: say what lands before it runs (never one click). */}
      <AlertDialog open={confirmingLand} onOpenChange={setConfirmingLand}>
        <AlertDialogContent className="dshx-root">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('landConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{text.reason}</AlertDialogDescription>
          </AlertDialogHeader>
          {text.detail === null ? null : <p className="dshx:text-sm dshx:text-foreground dshx:break-words">{text.detail}</p>}
          <p className="dshx:text-xs dshx:text-muted-foreground">{t('landConfirmHint')}</p>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={props.busy}
              onClick={() => {
                setConfirmingLand(false)
                props.onAct(item, 'Land')
              }}
            >
              {t('land')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {phone ? (
        <InboxActionSheet
          item={item}
          view={props.view}
          t={t}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          openable={openable}
          undo={undo}
          busy={props.busy}
          onOpen={() => props.onOpen(item)}
          onReview={props.onReview === undefined ? undefined : () => props.onReview?.(item)}
          onLand={() => setConfirmingLand(true)}
          onAct={verb => props.onAct(item, verb)}
          onDone={() => props.onDone(item)}
          onSnooze={choice => props.onSnooze(item, choice)}
          onReopen={() => props.onReopen(item)}
          onMute={muted => props.onMute(item.source, muted)}
        />
      ) : null}
    </EntityRow>
  )
  return (
    <div role="none" data-inbox-card="" className={InboxView.CARD}>
      {revealed === undefined ? null : (
        <div
          aria-hidden="true"
          data-inbox-swipe-reveal={revealed}
          className={cn(
            'dshx:absolute dshx:inset-0 dshx:flex dshx:items-center dshx:bg-muted dshx:px-5 dshx:text-sm dshx:font-medium dshx:text-foreground',
            revealed === 'done' ? 'dshx:justify-end' : 'dshx:justify-start',
          )}
        >
          {revealed === 'done' ? t('done') : t('swipeSnooze')}
        </div>
      )}
      {row}
    </div>
  )
}

/**
 * A long press on an Inbox card opens every verb it offers as one sheet (the phone's ⌘K for the item, T6.1). Land
 * still opens its confirmation; nothing here runs without the tap that names it.
 */
const InboxActionSheet = (props: {
  readonly item: AttentionItem
  readonly view: AttentionView
  readonly t: InboxTranslate
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly openable: boolean
  readonly undo: ReturnType<typeof InboxView.undoOf>
  readonly busy: boolean
  readonly onOpen: () => void
  readonly onReview: (() => void) | undefined
  readonly onLand: () => void
  readonly onAct: (verb: AttentionProviderVerb) => void
  readonly onDone: () => void
  readonly onSnooze: (choice: SnoozeChoice) => void
  readonly onReopen: () => void
  readonly onMute: (muted: boolean) => void
}): JSX.Element => {
  const { item, t } = props
  const live = props.view !== 'closed' && props.view !== 'muted'
  return (
    <DropdownMenu open={props.open} onOpenChange={props.onOpenChange}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden="true" tabIndex={-1} className="dshx:pointer-events-none dshx:absolute dshx:inset-x-0 dshx:bottom-0 dshx:h-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label={t('actionSheet', { title: InboxView.textOf(item).reason })} data-inbox-action-sheet="">
        {props.openable ? <DropdownMenuItem onSelect={props.onOpen}>{t('open')}</DropdownMenuItem> : null}
        {live && props.onReview !== undefined ? <DropdownMenuItem onSelect={props.onReview}>{t('review')}</DropdownMenuItem> : null}
        {live
          ? PROVIDER_VERBS.filter(verb => item.verbs.includes(verb)).map(verb => (
              <DropdownMenuItem key={verb} disabled={props.busy} onSelect={() => (verb === 'Land' ? props.onLand() : props.onAct(verb))}>
                {verb === 'Land' ? t('land') : verb}
              </DropdownMenuItem>
            ))
          : null}
        {live && item.verbs.includes('Done') ? (
          <DropdownMenuItem disabled={props.busy} onSelect={props.onDone}>
            {t('done')}
          </DropdownMenuItem>
        ) : null}
        {live && props.view !== 'snoozed' && item.verbs.includes('Snooze') ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={props.busy} onSelect={() => props.onSnooze('hour')}>
              {t('snoozeHour')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={props.busy} onSelect={() => props.onSnooze('four-hours')}>
              {t('snoozeFourHours')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={props.busy} onSelect={() => props.onSnooze('tomorrow')}>
              {t('snoozeDay')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={props.busy} onSelect={() => props.onSnooze('change')}>
              {t('snoozeChange')}
            </DropdownMenuItem>
          </>
        ) : null}
        {props.undo === 'reopen' || props.undo === 'unsnooze' ? (
          <DropdownMenuItem disabled={props.busy} onSelect={props.onReopen}>
            {props.undo === 'reopen' ? t('reopen') : t('unsnooze')}
          </DropdownMenuItem>
        ) : null}
        {props.undo === 'unmute' ? <DropdownMenuItem onSelect={() => props.onMute(false)}>{t('unmuteSource')}</DropdownMenuItem> : null}
        {live && item.verbs.includes('MuteSource') ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => props.onMute(true)}>{t('muteSource')}</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const emptyCopy = (view: AttentionView, t: InboxTranslate): string => {
  if (view === 'needs-you') return `${t('emptyNeedsYou')} ${t('emptyNeedsYouHint')}`
  if (view === 'other') return t('emptyOther')
  if (view === 'snoozed') return t('emptySnoozed')
  if (view === 'closed') return t('emptyClosed')
  return t('emptyMuted')
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    inboxPeek: true
    /** A quick reply queued in a waiting thread from its Inbox row. */
    inboxQuickReply: true
  }
}

/** Retain a listed thread for a peek; an id the list does not know is refused instead of creating a binding. */
const peekRetain =
  (sessions: ISessions): RetainThread =>
  (sessionId, signal) => {
    const listed = sessions.list.getSnapshot().ids.find(candidate => candidate === sessionId)
    if (listed === undefined) throw new Error('This thread is not listed. Open it from the thread list.')
    const reference = sessions.retain(listed, { source: 'inboxPeek', signal })
    return { ready: reference.ready.then(binding => ({ eventSource: binding.eventSource })), release: () => reference.release() }
  }

/** Queue one message in a listed thread, as the composer's Enter would. */
const queueInThread = async (sessions: ISessions, sessionId: string, text: string): Promise<void> => {
  const listed = sessions.list.getSnapshot().ids.find(candidate => candidate === sessionId)
  if (listed === undefined) throw new Error('This thread is not listed.')
  const reference = sessions.retain(listed, { source: 'inboxQuickReply' })
  try {
    await reference.ready
    const session = reference.binding.session
    const handle = session.beginSubmission({ mode: 'queue', text, attachments: [] })
    const result = await session.prompt([{ type: 'text', text }], 'queue', undefined, handle.requestId)
    if (!result.ok) throw new Error(result.error.message)
  } finally {
    reference.release()
  }
}

/** The one row a key acts on, or every selected row when X / Shift+J picked some. */
const targetsOf = (selected: readonly string[], cursor: string | null): readonly string[] => (selected.length > 0 ? selected : cursor === null ? [] : [cursor])

type Transition =
  | { readonly kind: 'done'; readonly id: string }
  | { readonly kind: 'reopen'; readonly id: string }
  | { readonly kind: 'snooze'; readonly id: string; readonly choice: SnoozeChoice }
  | { readonly kind: 'mute'; readonly source: string; readonly muted: boolean }
  | { readonly kind: 'resume-all'; readonly itemIds: readonly string[] }
  | { readonly kind: 'act'; readonly id: string; readonly verb: AttentionProviderVerb; readonly choiceId?: string }
  | { readonly kind: 'batch'; readonly requests: readonly Transition[]; readonly message?: string }

export const InboxPanel = (props: Navigation & { readonly t: InboxTranslate }): JSX.Element => {
  const api = useApi(attentionApi)
  const t = props.t
  const plugin = usePlugin()
  const [view, setView] = useState<AttentionView>('needs-you')
  const [notice, setNotice] = useState<{ readonly tone: 'ok' | 'error'; readonly text: string } | null>(null)
  const openSubject = useInboxOpener(props)
  const sessionLabel = EntityLabels.useSessionLabel(props.sessions)
  const sessionCwd = EntityLabels.useSessionCwd(props.sessions)
  const workspaceLabel = EntityLabels.useWorkspaceLabel(props.workspaces)
  const projectOf = useCallback(
    (sessionId: string): string | undefined => {
      const cwd = sessionCwd(sessionId)
      return cwd === null || cwd === '' ? undefined : workspaceLabel({ path: cwd })
    },
    [sessionCwd, workspaceLabel],
  )
  const listQuery = useResource(attentionApi, 'list', { view, limit: ATTENTION_LIST_LIMIT }, ATTENTION_READ)
  const settle = (outcome: { readonly ok: boolean; readonly message: string } | null): void => {
    if (outcome !== null) setNotice({ tone: outcome.ok ? 'ok' : 'error', text: outcome.message })
  }
  const failed = (error: unknown): void => setNotice({ tone: 'error', text: errorMessage(error, t('actionFailed')) })
  const runOne = async (request: Transition): Promise<{ readonly ok: boolean; readonly message: string } | undefined> => {
    if (request.kind === 'batch') {
      for (const each of request.requests) await runOne(each)
      return request.message === undefined ? undefined : { ok: true, message: request.message }
    }
    if (request.kind === 'resume-all') {
      // One request per item, so a slow resume never spends the next item's timeout; a refusal is counted, not fatal.
      let resumed = 0
      let refusedCount = 0
      for (const itemId of request.itemIds) {
        try {
          const outcome = await runHostRequest({ request: signal => api.act({ id: itemId, verb: 'Resume' }, { signal }) })
          if (outcome.ok) resumed += 1
          else refusedCount += 1
        } catch {
          refusedCount += 1
        }
      }
      return refusedCount === 0
        ? { ok: true, message: t('resumedAll', { count: resumed }) }
        : { ok: false, message: t('resumedSome', { sent: resumed, failed: refusedCount }) }
    }
    return runHostRequest({
      request: async signal => {
        if (request.kind === 'done') return void (await api.done({ id: request.id }, { signal }))
        if (request.kind === 'reopen') return void (await api.reopen({ id: request.id }, { signal }))
        if (request.kind === 'snooze') return void (await api.snooze({ id: request.id, ...InboxView.snoozeTarget(request.choice, Date.now()) }, { signal }))
        if (request.kind === 'mute') return void (await api.muteSource({ source: request.source, muted: request.muted }, { signal }))
        return api.act({ id: request.id, verb: request.verb, ...(request.choiceId !== undefined && { choiceId: request.choiceId }) }, { signal })
      },
    })
  }
  const transition = useMutation({ mutationFn: runOne, onSuccess: outcome => settle(outcome ?? null), onError: failed })

  // Triage (plan Q2 T2.3): one item at a time, Needs you then Ready, until Inbox zero; the machine owns the flow.
  const runRef = useRef(runOne)
  runRef.current = runOne
  const triageDefinition = useMemo(
    () =>
      triageMachine.provide({
        actors: {
          run: fromPromise<void, TriageRequest>(async ({ input }) => {
            const outcome = await runRef.current(
              input.kind === 'done'
                ? { kind: 'done', id: input.id }
                : input.kind === 'snooze'
                  ? { kind: 'snooze', id: input.id, choice: input.choice ?? 'hour' }
                  : { kind: 'act', id: input.id, verb: input.verb, ...(input.choiceId !== undefined && { choiceId: input.choiceId }) },
            )
            if (outcome !== undefined && !outcome.ok) throw new Error(outcome.message)
          }),
        },
      }),
    [],
  )
  const [triage, sendTriage] = useMachine(triageDefinition)
  const triaging = !triage.matches('list')
  const triageNeedsYou = useResource(attentionApi, 'list', { view: 'needs-you', limit: ATTENTION_LIST_LIMIT }, { ...ATTENTION_READ, enabled: triaging })
  const triageOther = useResource(attentionApi, 'list', { view: 'other', limit: ATTENTION_LIST_LIMIT }, { ...ATTENTION_READ, enabled: triaging })
  const triageItems = useMemo(
    () => new Map([...(triageNeedsYou.data?.items ?? []), ...(triageOther.data?.items ?? [])].map(item => [item.id, item] as const)),
    [triageNeedsYou.data, triageOther.data],
  )
  useEffect(() => {
    if (!triage.matches('running') || triageNeedsYou.data === undefined || triageOther.data === undefined) return
    sendTriage({ type: 'items', open: [...triageItems.keys()] })
    // Only fresh lists move the run; the machine itself is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triageItems])
  const startTriage = async (): Promise<void> => {
    try {
      const [needsYou, other] = await Promise.all([
        runHostRequest({ request: signal => api.list({ view: 'needs-you', limit: ATTENTION_LIST_LIMIT }, { signal }) }),
        runHostRequest({ request: signal => api.list({ view: 'other', limit: ATTENTION_LIST_LIMIT }, { signal }) }),
      ])
      if (needsYou.items.length + other.items.length === 0) {
        setNotice({ tone: 'ok', text: t('triageEmpty') })
        return
      }
      setNotice(null)
      sendTriage({ type: 'start', needsYou: needsYou.items.map(item => item.id), ready: other.items.map(item => item.id) })
    } catch (error) {
      failed(error)
    }
  }
  const triageRoot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (triaging) triageRoot.current?.focus({ preventScroll: true })
  }, [triaging])
  const triageId = TriageModel.current(triage.context)
  const triageItem =
    triage.matches({ running: 'showing' }) || triage.matches({ running: 'acting' })
      ? triageId === undefined
        ? undefined
        : triageItems.get(triageId)
      : undefined
  const triageBusy = triage.matches({ running: 'acting' })
  const [landSignal, setLandSignal] = useState(0)
  const triageAct = (request: TriageRequest): void => {
    if (!triageBusy) sendTriage({ type: 'act', request })
  }
  const triagePrimary = triageItem === undefined ? undefined : InboxKeys.primaryOf(triageItem)
  const runTriageAction = (action: PrimaryAction | { readonly kind: 'review' }): void => {
    if (triageItem === undefined) return
    if (action.kind === 'answer') triageAct({ kind: 'act', id: triageItem.id, verb: 'Answer', choiceId: action.choiceId })
    else if (action.kind === 'verb') triageAct({ kind: 'act', id: triageItem.id, verb: action.verb })
    else if (action.kind === 'land') setLandSignal(current => current + 1)
    else if (action.kind === 'review') reviewOf(triageItem)?.(triageItem)
    else openItem(triageItem)
  }
  const runTriagePrimary = (): void => {
    if (triagePrimary !== undefined) runTriageAction(triagePrimary)
  }
  const triageRegion = (): HTMLDivElement | null => triageRoot.current
  useCommands(triaging ? plugin : undefined, [
    {
      id: '@dshfiles/activity-timeline.triage-primary',
      title: t('triagePrimary'),
      keys: ['Enter'],
      scope: 'triage',
      section: 'Triage',
      hidden: true,
      region: triageRegion,
      run: trigger => {
        const target = trigger?.event?.target
        if (target instanceof Element && target.closest('button, a[href]') !== null) return false
        runTriagePrimary()
        return undefined
      },
    },
    {
      id: '@dshfiles/activity-timeline.triage-choice',
      title: t('keyChoice'),
      keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
      scope: 'triage',
      section: 'Triage',
      hidden: true,
      region: triageRegion,
      run: trigger => {
        const choiceId = triageItem === undefined ? undefined : InboxKeys.choiceAt(triageItem, Number(trigger?.keys))
        if (triageItem === undefined || choiceId === undefined) return false
        triageAct({ kind: 'act', id: triageItem.id, verb: 'Answer', choiceId })
        return undefined
      },
    },
    {
      id: '@dshfiles/activity-timeline.triage-done',
      title: t('keyDone'),
      keys: ['E'],
      scope: 'triage',
      section: 'Triage',
      hidden: true,
      region: triageRegion,
      run: () => {
        if (triageItem === undefined || !triageItem.verbs.includes('Done')) return false
        triageAct({ kind: 'done', id: triageItem.id })
        return undefined
      },
    },
    {
      id: '@dshfiles/activity-timeline.triage-snooze',
      title: t('keySnooze'),
      keys: ['H'],
      scope: 'triage',
      section: 'Triage',
      hidden: true,
      region: triageRegion,
      run: () => {
        if (triageItem === undefined || !triageItem.verbs.includes('Snooze')) return false
        triageAct({ kind: 'snooze', id: triageItem.id })
        return undefined
      },
    },
    {
      id: '@dshfiles/activity-timeline.triage-skip',
      title: t('triageSkip'),
      keys: ['S'],
      scope: 'triage',
      section: 'Triage',
      hidden: true,
      region: triageRegion,
      run: () => {
        if (triageItem === undefined || triageBusy) return false
        sendTriage({ type: 'skip' })
        return undefined
      },
    },
    {
      id: '@dshfiles/activity-timeline.triage-exit',
      title: t('triageExit'),
      keys: ['Escape'],
      scope: 'triage',
      section: 'Triage',
      hidden: true,
      region: triageRegion,
      run: () => {
        sendTriage({ type: 'exit' })
        return undefined
      },
    },
  ])
  const openers = useSubjectOpeners()
  const openItem = (item: AttentionItem): void => {
    if (openSubject(item.subject)) setNotice(null)
    else {
      const label = openers.get(item.subject.kind)?.label
      setNotice({ tone: 'error', text: label === undefined ? t('sessionUnavailable') : t('subjectUnavailable', { label }) })
    }
  }
  /** Review opens a thread's Changes: offered on items that can Land, for a thread whose folder the list knows. */
  const reviewOf = (item: AttentionItem): ((target: AttentionItem) => void) | undefined => {
    const review = props.review
    if (review === undefined || item.subject.kind !== 'session' || !item.verbs.includes('Land')) return undefined
    const sessionId = item.subject.id
    const workspacePath = threadFolderOf(props, sessionId)
    if (workspacePath === undefined) return undefined
    return () => {
      if (review({ sessionId, workspacePath })) setNotice(null)
      else setNotice({ tone: 'error', text: t('reviewUnavailable') })
    }
  }
  const data = useMemo(() => (listQuery.data === undefined ? undefined : { ...listQuery.data, items: listQuery.data.items.slice(0, 100) }), [listQuery.data])
  const counts = data?.counts
  // Ages are read against the moment the list arrived, so a render never reads the clock.
  const now = listQuery.updatedAt

  // The list holds its order while the pointer is over it or focus is in it, so rows never move under J/K.
  const listRoot = useRef<HTMLDivElement>(null)
  const rowElements = useRef(new Map<string, HTMLDivElement>())
  const [held, setHeld] = useState<readonly string[] | null>(null)
  const holding = useRef({ hover: false, focus: false })
  const liveItems = data?.items ?? EMPTY_ITEMS
  const liveIds = useMemo(() => liveItems.map(item => item.id), [liveItems])
  const shownItems = HeldOrder.hold(liveItems, held)
  const shownIds = useMemo(() => shownItems.map(item => item.id), [shownItems])
  const updates = HeldOrder.pending(liveIds, held)
  const holdOrder = (reason: 'hover' | 'focus', on: boolean): void => {
    holding.current = { ...holding.current, [reason]: on }
    if (on) setHeld(current => current ?? liveIds)
    else if (!holding.current.hover && !holding.current.focus) setHeld(null)
  }
  const showUpdates = (): void => setHeld(holding.current.hover || holding.current.focus ? liveIds : null)

  const [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<readonly string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [peeking, setPeeking] = useState(false)
  const undo = useRef<{ readonly run: () => void } | null>(null)
  const previousIds = useRef<readonly string[]>([])
  const cursorItem = shownItems.find(item => item.id === cursor)
  // A row that left (Done, Snooze, resolved elsewhere) hands the highlight to its neighbour.
  useEffect(() => {
    if (cursor !== null && !shownIds.includes(cursor)) setCursor(InboxKeys.afterRemoval(previousIds.current, shownIds, cursor))
    previousIds.current = shownIds
  }, [cursor, shownIds])
  useEffect(() => {
    setCursor(null)
    setSelected([])
    setAnchor(null)
    setPeeking(false)
    setHeld(null)
  }, [view])
  const focusRow = (id: string | null): void => {
    setCursor(id)
    if (id === null) return
    const element = rowElements.current.get(id)
    element?.focus({ preventScroll: true })
    element?.scrollIntoView({ block: 'nearest' })
  }
  useEffect(() => {
    if (cursor === null) return
    const element = rowElements.current.get(cursor)
    if (
      element !== undefined &&
      listRoot.current?.contains(document.activeElement) === true &&
      document.activeElement !== element &&
      !element.contains(document.activeElement)
    )
      element.focus({ preventScroll: true })
  }, [cursor])

  const move = (direction: 1 | -1, extend: boolean): void => {
    const next = InboxKeys.step(shownIds, cursor, direction)
    if (next === null) return
    if (extend) {
      const from = anchor ?? cursor ?? next
      setAnchor(from)
      setSelected(InboxKeys.extend(shownIds, from, next))
    } else if (selected.length > 0) {
      setSelected([])
      setAnchor(null)
    }
    focusRow(next)
  }
  const remember = (run: () => void): void => {
    undo.current = { run }
  }
  const markDone = (ids: readonly string[]): void => {
    const open = ids.filter(id => shownItems.find(item => item.id === id)?.verbs.includes('Done') === true)
    if (open.length === 0) return
    transition.mutate({ kind: 'batch', requests: open.map(id => ({ kind: 'done', id })), message: t('doneCount', { count: open.length }) })
    remember(() => transition.mutate({ kind: 'batch', requests: open.map(id => ({ kind: 'reopen', id })), message: t('undone') }))
    setSelected([])
  }
  const snooze = (ids: readonly string[]): void => {
    const open = ids.filter(id => shownItems.find(item => item.id === id)?.verbs.includes('Snooze') === true)
    if (open.length === 0) return
    transition.mutate({ kind: 'batch', requests: open.map(id => ({ kind: 'snooze', id, choice: 'hour' })), message: t('snoozedCount', { count: open.length }) })
    remember(() => transition.mutate({ kind: 'batch', requests: open.map(id => ({ kind: 'reopen', id })), message: t('undone') }))
    setSelected([])
  }
  const muteSource = (item: AttentionItem | undefined): void => {
    if (item === undefined || !item.verbs.includes('MuteSource')) return
    transition.mutate({ kind: 'batch', requests: [{ kind: 'mute', source: item.source, muted: true }], message: t('mutedSource') })
    remember(() => transition.mutate({ kind: 'batch', requests: [{ kind: 'mute', source: item.source, muted: false }], message: t('undone') }))
  }
  const answer = (item: AttentionItem, choiceId: string): void => {
    transition.mutate({ kind: 'act', id: item.id, verb: 'Answer', choiceId })
    // An answer reaches the agent at once; there is nothing to take back.
    undo.current = null
  }
  const listOpen = view !== 'closed' && view !== 'muted'
  const region = (): HTMLDivElement | null => listRoot.current
  const onRow = (trigger: CommandTrigger | undefined): boolean => {
    // Enter on a row's own button (an answer, Open, Snooze) is that button's; the key only opens from the row itself.
    const target = trigger?.event?.target
    return !(target instanceof Element && target.closest('button, a[href], [role="menuitem"]') !== null)
  }
  useCommands(plugin, [
    {
      id: '@dshfiles/activity-timeline.inbox-next',
      title: t('keyNext'),
      keys: ['J', 'ArrowDown'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region,
      run: () => move(1, false),
    },
    {
      id: '@dshfiles/activity-timeline.inbox-previous',
      title: t('keyPrevious'),
      keys: ['K', 'ArrowUp'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region,
      run: () => move(-1, false),
    },
    {
      id: '@dshfiles/activity-timeline.inbox-extend-down',
      title: t('keyExtendDown'),
      keys: ['Shift+J', 'Shift+ArrowDown'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region,
      run: () => move(1, true),
    },
    {
      id: '@dshfiles/activity-timeline.inbox-extend-up',
      title: t('keyExtendUp'),
      keys: ['Shift+K', 'Shift+ArrowUp'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region,
      run: () => move(-1, true),
    },
    {
      id: '@dshfiles/activity-timeline.inbox-select',
      title: t('keySelect'),
      keys: ['X'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region,
      run: () => {
        if (cursor === null) return false
        setAnchor(cursor)
        setSelected(current => (current.includes(cursor) ? current.filter(id => id !== cursor) : [...current, cursor]))
      },
    },
    {
      id: '@dshfiles/activity-timeline.inbox-open',
      title: t('keyOpen'),
      keys: ['Enter'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region,
      run: trigger => {
        if (cursorItem === undefined || !onRow(trigger)) return false
        openItem(cursorItem)
      },
    },
    {
      id: '@dshfiles/activity-timeline.inbox-done',
      title: t('keyDone'),
      keys: ['E'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      enabled: listOpen,
      region,
      run: () => markDone(targetsOf(selected, cursor)),
    },
    {
      id: '@dshfiles/activity-timeline.inbox-snooze',
      title: t('keySnooze'),
      keys: ['H'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      enabled: listOpen,
      region,
      run: () => snooze(targetsOf(selected, cursor)),
    },
    {
      id: '@dshfiles/activity-timeline.inbox-mute',
      title: t('keyMute'),
      keys: ['M'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      enabled: listOpen,
      region,
      run: () => muteSource(cursorItem),
    },
    {
      id: '@dshfiles/activity-timeline.inbox-undo',
      title: t('keyUndo'),
      keys: ['Z'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region,
      run: () => {
        const last = undo.current
        undo.current = null
        if (last === null) setNotice({ tone: 'ok', text: t('nothingToUndo') })
        else last.run()
      },
    },
    {
      id: '@dshfiles/activity-timeline.inbox-peek',
      title: t('keyPeek'),
      keys: ['Space'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region,
      run: trigger => {
        if (cursorItem === undefined || !onRow(trigger)) return false
        setPeeking(current => !current)
      },
    },
    {
      id: '@dshfiles/activity-timeline.inbox-choice',
      title: t('keyChoice'),
      keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      enabled: listOpen,
      region,
      run: trigger => {
        const choiceId = cursorItem === undefined ? undefined : InboxKeys.choiceAt(cursorItem, Number(trigger?.keys))
        if (cursorItem === undefined || choiceId === undefined) return false
        answer(cursorItem, choiceId)
      },
    },
    {
      id: '@dshfiles/activity-timeline.inbox-new-thread',
      title: t('keyNewThread'),
      keys: ['C'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region,
      run: () => (plugin.commands.run('@dshfiles/command-palette.new-thread') ? undefined : false),
    },
    {
      id: '@dshfiles/activity-timeline.inbox-triage',
      title: t('keyTriage'),
      keys: ['T'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region,
      run: () => {
        void startTriage()
      },
    },
  ])
  const retain = useMemo(() => peekRetain(props.sessions), [props.sessions])
  // Quick replies (plan Q2 T2.5): chips from the prompt library on a waiting thread's row; a tap queues the text.
  const quickReplySources = useRegistry(InboxQuickReplies)
  const quickReplyList = useQuery({
    queryKey: ['activity-timeline', 'quick-replies', quickReplySources.map(source => source.id).join(',')],
    queryFn: async ({ signal }) => (await Promise.all(quickReplySources.map(source => source.list(signal).catch(() => [])))).flat().slice(0, 3),
    enabled: quickReplySources.length > 0,
    staleTime: 60_000,
  })
  const quickReply = useMutation({
    mutationFn: async (input: { readonly sessionId: string; readonly text: string }) => {
      await queueInThread(props.sessions, input.sessionId, input.text)
      return input.text
    },
    onSuccess: text => setNotice({ tone: 'ok', text: t('quickReplySent', { text }) }),
    onError: () => setNotice({ tone: 'error', text: t('quickReplyFailed') }),
  })
  const replies = quickReplyList.data ?? []
  const quickReplies =
    replies.length === 0
      ? undefined
      : (sessionId: string): readonly InboxQuickReply[] =>
          replies.map(reply => ({
            id: reply.id,
            label: reply.label,
            disabled: quickReply.isPending,
            onSelect: () => quickReply.mutate({ sessionId, text: reply.text }),
          }))
  const peekSessionId = peeking && cursorItem?.subject.kind === 'session' ? cursorItem.subject.id : undefined
  const reply = useLastReply(peeking ? retain : undefined, peekSessionId)
  const triageReply = useLastReply(triaging ? retain : undefined, triageItem?.subject.kind === 'session' ? triageItem.subject.id : undefined)

  // Every open item that can be resumed moves at once: the inbox already lists only what needs the user.
  const resumableIds = data === undefined ? [] : InboxView.resumableIds(data.items)
  const resumeAllAction =
    view === 'needs-you' && resumableIds.length > 0
      ? {
          id: 'resume-all',
          label: t('resumeAll'),
          icon: <RefreshCwIcon aria-hidden />,
          pending: transition.isPending,
          onSelect: () => transition.mutate({ kind: 'resume-all', itemIds: resumableIds }),
        }
      : null
  const triageable = (counts?.needsYou ?? 0) + (counts?.other ?? 0) > 0
  const triageAction = {
    id: 'triage',
    label: t('triageStart'),
    icon: <ListChecksIcon aria-hidden />,
    onSelect: () => void startTriage(),
  }
  const [alertSettingsOpen, setAlertSettingsOpen] = useState(false)
  InboxPush.useNotificationOpen()
  const alertSettingsAction = { id: 'alerts', label: t('alertSettings'), icon: <BellIcon aria-hidden />, onSelect: () => setAlertSettingsOpen(true) }
  // Triage (one card at a time, 1 of N; on a phone its verbs sit in the thumb zone) is the way through the Inbox: it is
  // the page's one ink button, unless Resume all needs that seat (round five P2: no ink button in a card).
  const triageOnTop = resumeAllAction === null && triageable
  // Needs you holds two statuses: on a phone its segment shows them as a tally (◆ 2 · ✕ 1), so a failure below the fold
  // shows at first glance (council round 10 C2; the kit draws it only in the phone shell, where the title is hidden).
  const tabs: readonly { readonly view: AttentionView; readonly label: string; readonly count: number; readonly statusCounts?: ReturnType<typeof InboxView.titleCounts> }[] = [
    { view: 'needs-you', label: t('needsYou'), count: counts?.needsYou ?? 0, statusCounts: InboxView.titleCounts(counts) },
    { view: 'other', label: t('other'), count: counts?.other ?? 0 },
    { view: 'snoozed', label: t('snoozed'), count: counts?.snoozed ?? 0 },
    { view: 'closed', label: t('closed'), count: counts?.closed ?? 0 },
    { view: 'muted', label: t('muted'), count: counts?.muted ?? 0 },
  ]
  const visibleTabs = tabs.filter(tab => tab.view === 'needs-you' || tab.view === 'other' || tab.count > 0 || tab.view === view)
  const peekAnchor = cursor === null ? null : (rowElements.current.get(cursor) ?? null)
  const primaryAction = resumeAllAction ?? (triageOnTop ? triageAction : undefined)
  const headerActions = InboxView.pageActions({ triagePrimary: triageOnTop, alertSettings: InboxAlerts.available(), triageable }).map(action =>
    action.id === 'triage' ? triageAction : { ...alertSettingsAction, placement: action.placement },
  )
  // On a phone the top bar keeps its title and ⋯ (inbox-phone-bar.tsx): Resume all and the other actions fold into the
  // ⋯, and Triage is a worded text button beside it (council round 11 C1); triage draws its own bar, so the top bar
  // holds none then.
  const phoneActions = [...(resumeAllAction === null ? [] : [resumeAllAction]), ...headerActions.filter(action => action.id !== 'triage')]
  const phoneBar = { actions: triaging ? [] : phoneActions, moreLabel: t('more') }
  usePublishInboxPhoneActions(triaging || !triageable ? phoneBar : { ...phoneBar, triage: { label: t('triage'), onSelect: () => void startTriage() } })
  if (triaging) {
    const progress = TriageModel.progress(triage.context)
    return (
      <Page scroll width="lane" mark={<InboxIcon />} markTone="inbox" heading={t('triage')} description={t('subtitle')}>
        <div
          ref={triageRoot}
          tabIndex={-1}
          data-shortcut-scope="triage"
          data-shortcut-ambient=""
          data-inbox-triage=""
          // On the phone shell the stage fills down to the tab bar, so the bar (order-last) sits in the thumb zone.
          className="dshx:flex dshx:flex-col dshx:gap-3 dshx:outline-none dshx:in-data-shell-phone-nav:min-h-[calc(100dvh-19rem)]"
        >
          {triage.matches('zero') ? (
            <TriageZero t={t} handled={triage.context.handled} onBack={() => sendTriage({ type: 'exit' })} />
          ) : triageItem === undefined || triagePrimary === undefined ? (
            <div className="dshx:flex dshx:justify-center dshx:py-8">
              <Spinner />
            </div>
          ) : (
            <>
              <TriageBar
                t={t}
                index={progress.index}
                total={progress.total}
                item={triageItem}
                actions={InboxKeys.triageActions(triageItem, {
                  openable: triageItem.subject.kind === 'session' || openers.has(triageItem.subject.kind),
                  reviewable: reviewOf(triageItem) !== undefined,
                })}
                openLabel={openLabelOf(triageItem, triageItem.subject.kind === 'session' ? undefined : openers.get(triageItem.subject.kind), t)}
                busy={triageBusy}
                error={triage.context.error}
                onAction={runTriageAction}
                onDone={() => triageAct({ kind: 'done', id: triageItem.id })}
                onSnooze={() => triageAct({ kind: 'snooze', id: triageItem.id })}
                onSkip={() => sendTriage({ type: 'skip' })}
                onExit={() => sendTriage({ type: 'exit' })}
              />
              <EntityList aria-label={t('triage')} className={INBOX_STACK}>
                <InboxRow
                  key={triageItem.id}
                  item={triageItem}
                  view={triageItem.severity === 'ready' || triageItem.severity === 'info' ? 'other' : 'needs-you'}
                  t={t}
                  now={Date.now()}
                  sessionLabel={sessionLabel}
                  projectOf={projectOf}
                  busy={triageBusy}
                  openers={openers}
                  actionRow={false}
                  landSignal={landSignal}
                  onOpen={openItem}
                  onReview={reviewOf(triageItem)}
                  onOpenThread={sessionId => {
                    if (openThread(props, sessionId)) setNotice(null)
                    else setNotice({ tone: 'error', text: t('sessionUnavailable') })
                  }}
                  onAct={(target, verb, choiceId) => triageAct({ kind: 'act', id: target.id, verb, ...(choiceId !== undefined && { choiceId }) })}
                  onDone={target => triageAct({ kind: 'done', id: target.id })}
                  onSnooze={(target, choice) => triageAct({ kind: 'snooze', id: target.id, choice })}
                  onReopen={target => transition.mutate({ kind: 'reopen', id: target.id })}
                  onMute={(source, muted) => transition.mutate({ kind: 'mute', source, muted })}
                />
              </EntityList>
              <TriageReply t={t} reply={triageReply} />
            </>
          )}
        </div>
      </Page>
    )
  }
  return (
    <Page
      scroll
      // The rail's Inbox glyph in its tone before the title (council round 7 C1, kit A2).
      mark={<InboxIcon />}
      markTone="inbox"
      heading={t('title')}
      // One StatusCount per status present beside the title (◆2 ✕1, round five C3; the kit Page draws them, A5).
      statusCounts={InboxView.titleCounts(counts)}
      // On a phone the top bar names the page (its own h1) and holds its actions (InboxPhoneBar), so the page header
      // goes and the segmented control leads the page.
      description={<span className="dshx:in-data-shell-phone-nav:hidden">{t('subtitle')}</span>}
      className={cn(
        'dshx:in-data-shell-phone-nav:[&_[data-slot=page-header]]:hidden',
        // Council round 7 C2: 8px, not 12, above the segmented control and under it, so the failed card clears the tab bar.
        'dshx:in-data-shell-phone-nav:[&>[data-slot=page-container]]:pt-2 dshx:in-data-shell-phone-nav:[&>[data-slot=page-container]>[data-slot=tabs]]:gap-2',
        // Council round 12 C3: the segmented control spans the row; its segments grow from one basis, so they are equal
        // wherever a segment's words fit (Needs you keeps its tally's width).
        'dshx:in-data-shell-phone-nav:[&>[data-slot=page-container]>[data-slot=tabs]>[data-slot=page-tab-strip]>div]:w-full',
        'dshx:in-data-shell-phone-nav:[&>[data-slot=page-container]>[data-slot=tabs]>[data-slot=page-tab-strip]_[data-slot=tabs-list]]:w-full',
        'dshx:in-data-shell-phone-nav:[&>[data-slot=page-container]>[data-slot=tabs]>[data-slot=page-tab-strip]_[data-slot=tabs-trigger]]:flex-[1_1_0]',
        // Council round 14 C3: the desktop "Needs you" tab shows its status tally (◆ 2 · ✕ 1) like the phone, not a
        // plain 3 that hides which of them failed.
        'dshx:[&_[data-slot=page-tab-count]]:hidden dshx:[&_[data-slot=page-tab-status-counts]]:inline-flex',
      )}
      // The kit's list lane (920px): header and list share one container, so Start triage ends on the list's edge.
      width="lane"
      {...(primaryAction === undefined ? {} : { primaryAction })}
      actions={headerActions}
      overflowLabel={t('more')}
      tabs={{
        label: t('title'),
        value: view,
        onValueChange: value => setView(tabs.find(tab => tab.view === value)?.view ?? 'needs-you'),
        items: visibleTabs.map(tab => ({ value: tab.view, label: tab.label, ...(tab.count > 0 && { count: tab.count }), ...(tab.statusCounts !== undefined && { statusCounts: tab.statusCounts }) })),
      }}
    >
      {notice === null ? null : (
        <Alert variant={notice.tone === 'error' ? 'destructive' : 'default'} role={notice.tone === 'error' ? 'alert' : 'status'}>
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}
      {listQuery.status !== 'error' ? null : (
        // One sentence that names the Inbox, Retry, the cause under Details: never an endpoint id (D6, D7).
        <LoadError subject={t('title')} error={listQuery.error} onRetry={() => void listQuery.refetch()} retryLabel={t('retry')} />
      )}
      {data !== undefined && data.items.length === 0 ? <EmptyState>{emptyCopy(view, t)}</EmptyState> : null}
      {view === 'closed' && props.openNotifications !== undefined ? (
        // b:ysaj: Closed holds what was handled; every alert, including the ones missed while away, is in Notifications.
        <p className="dshx:m-0 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-1 dshx:text-xs dshx:text-muted-foreground" data-inbox-history-link="">
          {t('closedHistoryHint')}
          <Button
            size="xs"
            variant="link"
            className="dshx:h-auto dshx:px-0 dshx:pointer-coarse:min-h-11"
            onClick={() => {
              if (props.openNotifications?.() !== true) setNotice({ tone: 'error', text: t('closedHistoryUnavailable') })
            }}
          >
            {t('closedHistoryOpen')}
          </Button>
        </p>
      ) : null}
      {data === undefined || data.items.length === 0 ? null : (
        <div
          ref={listRoot}
          data-shortcut-scope="list"
          data-shortcut-ambient=""
          className="dshx:flex dshx:flex-col dshx:gap-2"
          onPointerEnter={() => holdOrder('hover', true)}
          onPointerLeave={() => holdOrder('hover', false)}
          onFocus={() => holdOrder('focus', true)}
          onBlur={event => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) holdOrder('focus', false)
          }}
        >
          {updates > 0 ? (
            <Button
              size="sm"
              variant="outline"
              data-held-updates=""
              className="dshx:self-center dshx:rounded-full dshx:tabular-nums"
              aria-label={`${t('updates', { count: updates })}. ${t('updatesHint')}`}
              onClick={showUpdates}
            >
              {t('updates', { count: updates })}
            </Button>
          ) : null}
          <EntityList aria-label={tabs.find(tab => tab.view === view)?.label ?? t('title')} className={INBOX_STACK}>
            {shownItems.map(item => (
              <InboxRow
                key={item.id}
                item={item}
                view={view}
                t={t}
                now={now}
                sessionLabel={sessionLabel}
                projectOf={projectOf}
                busy={transition.isPending}
                openers={openers}
                cursor={item.id === cursor}
                selected={selected.includes(item.id)}
                showChoiceKeys={item.id === cursor}
                {...(quickReplies === undefined ? {} : { quickReplies })}
                rowRef={element => {
                  if (element === null) rowElements.current.delete(item.id)
                  else rowElements.current.set(item.id, element)
                }}
                onFocusRow={() => setCursor(item.id)}
                onOpen={openItem}
                onReview={reviewOf(item)}
                onOpenThread={sessionId => {
                  if (openThread(props, sessionId)) setNotice(null)
                  else setNotice({ tone: 'error', text: t('sessionUnavailable') })
                }}
                onAct={(target, verb, choiceId) => transition.mutate({ kind: 'act', id: target.id, verb, ...(choiceId !== undefined && { choiceId }) })}
                onDone={target => transition.mutate({ kind: 'done', id: target.id })}
                onSnooze={(target, choice) => transition.mutate({ kind: 'snooze', id: target.id, choice })}
                onReopen={target => transition.mutate({ kind: 'reopen', id: target.id })}
                onMute={(source, muted) => transition.mutate({ kind: 'mute', source, muted })}
              />
            ))}
          </EntityList>
          {cursorItem === undefined ? null : (
            <RowPeek anchor={peekAnchor} open={peeking} onOpenChange={setPeeking} side="bottom">
              <PeekCard
                heading={InboxView.textOf(cursorItem).reason}
                status={statusOf(cursorItem, view)}
                statusLabel={statusLabelOf(statusOf(cursorItem, view), t)}
                {...(cursorItem.subject.kind === 'session' ? { reply } : {})}
                {...(listOpen && cursorItem.verbs.includes('Answer') && cursorItem.choices.length > 0
                  ? {
                      question: {
                        text: InboxView.textOf(cursorItem).detail ?? InboxView.textOf(cursorItem).reason,
                        choices: cursorItem.choices,
                        busy: transition.isPending,
                        onAnswer: (choiceId: string) => answer(cursorItem, choiceId),
                      },
                    }
                  : {})}
                facts={[
                  [
                    InboxView.sourceLabel(cursorItem.source),
                    cursorItem.subject.kind === 'session' ? sessionLabel(cursorItem.subject.id) : (cursorItem.subject.label ?? cursorItem.subject.id),
                    InboxView.relativeAge(cursorItem.openedAt, now),
                  ].join(' · '),
                  ...(cursorItem.verbs.includes('Answer') ? [] : [InboxView.textOf(cursorItem).detail ?? []].flat()),
                ]}
                actions={
                  <Button size="sm" variant="outline" onClick={() => openItem(cursorItem)}>
                    {t('open')}
                  </Button>
                }
                labels={{ lastReply: t('peekLastReply'), noReply: t('peekNoReply'), loading: t('peekLoading'), close: t('peekClose') }}
              />
            </RowPeek>
          )}
        </div>
      )}
      {view === 'other' ? <p className="dshx:text-xs dshx:text-muted-foreground">{t('otherExpiryHint')}</p> : null}
      <InboxAlerts.SettingsDialog t={t} open={alertSettingsOpen} onOpenChange={setAlertSettingsOpen} />
    </Page>
  )
}

const EMPTY_ITEMS: readonly AttentionItem[] = []
