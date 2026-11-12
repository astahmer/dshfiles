import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { useApi, useApiEvent, usePlugin, useRegistry, type CommandTrigger } from '@dshfiles/dshx/client'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { EmptyState, Page } from '@dshfiles/plugin-ui/components/page'
import { PeekCard, RowPeek } from '@dshfiles/plugin-ui/components/peek'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import { useCommands } from '@dshfiles/plugin-ui/hooks/commands'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { useLastReply, type RetainThread } from '@dshfiles/plugin-ui/hooks/last-reply'
import { RowGestureModel, useRowGestures } from '@dshfiles/plugin-ui/hooks/row-gestures'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { ClockIcon, EllipsisIcon, ListChecksIcon, MessagesSquareIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { fromPromise, useMachine } from '@dshfiles/plugin-ui/machine'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
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
import { InboxNotifications } from './inbox-notifications.js'
import { InboxPush } from './web-push-client.js'
import { INBOX_CHIP, TriageBar, TriageReply, TriageZero } from './triage-stage.js'
import { triageMachine, TriageModel, type TriageRequest } from './triage-machine.js'
import type { InboxTranslate } from './inbox-locales.js'
import { InboxSwipe, InboxView, type SnoozeChoice } from './inbox-view.js'
import { ThreadReferences } from './thread-reference.js'

export const inboxKeys = { all: ['activity-timeline', 'attention'] as const, view: (view: AttentionView) => ['activity-timeline', 'attention', view] as const }

const PROVIDER_VERBS: readonly AttentionProviderVerb[] = ['Approve', 'Land', 'Retry', 'Resume']

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

/** Plan §4.7: blocking items are Needs you, failed stay Failed, ready is Ready; anything closed reads as Done. */
const statusOf = (item: AttentionItem, view: AttentionView): WorkStatus => {
  if (view === 'closed') return 'done'
  if (item.severity === 'blocking') return 'needs-you'
  if (item.severity === 'failed') return 'failed'
  return 'ready'
}

const statusLabelOf = (status: WorkStatus, t: InboxTranslate): string => {
  switch (status) {
    case 'needs-you':
      return t('severityBlocking')
    case 'failed':
      return t('severityFailed')
    case 'ready':
      return t('severityReady')
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

const InboxRow = (props: {
  readonly item: AttentionItem
  readonly view: AttentionView
  readonly t: InboxTranslate
  readonly now: number
  readonly sessionLabel: (sessionId: string) => string
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
  /** Quick-reply chips for a waiting thread (prompt library), sent to that thread. */
  readonly quickReplies?: (sessionId: string) => React.ReactNode
  /** Bumped by Triage's Enter on a Land item: open the Land confirmation, never Land itself. */
  readonly landSignal?: number
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
  const subjectLabel = item.subject.kind === 'session' ? props.sessionLabel(item.subject.id) : (item.subject.label ?? item.subject.id)
  const opener = item.subject.kind === 'session' ? undefined : props.openers.get(item.subject.kind)
  const openable = item.subject.kind === 'session' || opener !== undefined
  const referencedThreadId =
    item.subject.kind === 'session'
      ? null
      : (ThreadReferences.threadIdIn(item.reason) ?? (item.detail === null ? null : ThreadReferences.threadIdIn(item.detail)))
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
      aria-selected={props.selected === true}
      className={cn(
        'dshx:scroll-my-2 dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:focus-visible:ring-inset dshx:data-[cursor]:bg-muted/50',
        phone && 'dshx:relative dshx:bg-card dshx:py-1',
        phone && gestures.offset === 0 && 'dshx:transition-transform dshx:duration-150',
      )}
      data-attention-item={item.id}
      data-severity={item.severity}
      status={status}
      statusLabel={statusLabel}
      heading={item.reason}
      meta={
        <>
          <span>{InboxView.sourceLabel(item.source)}</span>
          {openable ? (
            <button
              type="button"
              className="dshx:min-w-0 dshx:max-w-full dshx:truncate dshx:text-left dshx:underline-offset-2 dshx:hover:underline"
              onClick={() => props.onOpen(item)}
            >
              {subjectLabel}
            </button>
          ) : (
            <span className="dshx:min-w-0 dshx:truncate">{subjectLabel}</span>
          )}
          {referencedThreadId === null ? null : (
            <button
              type="button"
              className="dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:font-medium dshx:text-info dshx:underline-offset-2 dshx:hover:underline"
              onClick={() => props.onOpenThread(referencedThreadId)}
            >
              <MessagesSquareIcon aria-hidden className="dshx:size-3" />
              {t('openThread')}
            </button>
          )}
          <span>{InboxView.relativeAge(item.openedAt, props.now)}</span>
          {item.occurrences > 1 ? <Badge variant="outline">{`${String(item.occurrences)} ${t('occurrences')}`}</Badge> : null}
          {item.resolvedAt !== null ? <Badge variant="secondary">{t('resolved')}</Badge> : null}
          {props.view === 'snoozed' ? (
            <Badge variant="outline">
              {item.snoozeUntilChange ? t('snoozedUntilChange') : `${t('snoozedUntil')} ${new Date(item.snoozedUntil ?? 0).toLocaleString()}`}
            </Badge>
          ) : null}
        </>
      }
      {...(item.detail === null ? {} : { description: item.detail })}
    >
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:px-3 dshx:pb-2 dshx:pl-9">
        {open && item.verbs.includes('Answer') && item.choices.length > 0
          ? item.choices.map((choice, index) => (
              <Button
                key={choice.id}
                size="sm"
                variant={choice.recommended === true ? 'default' : 'outline'}
                className={cn('dshx:shrink dshx:max-w-full', INBOX_CHIP)}
                disabled={props.busy}
                onClick={() => props.onAct(item, 'Answer', choice.id)}
              >
                {props.showChoiceKeys === true && index < 9 ? <KeyHint keys={String(index + 1)} className="dshx:opacity-70" /> : null}
                <span className="dshx:truncate">{choice.label}</span>
                {choice.recommended === true ? <span className="dshx:sr-only"> ({t('recommended')})</span> : null}
              </Button>
            ))
          : null}
        {open && item.subject.kind === 'session' && item.severity !== 'ready' && !(item.verbs.includes('Answer') && item.choices.length > 0)
          ? props.quickReplies?.(item.subject.id)
          : null}
        {open
          ? PROVIDER_VERBS.filter(verb => item.verbs.includes(verb)).map(verb =>
              verb === 'Land' ? (
                <Button key={verb} size="sm" variant="outline" className={INBOX_CHIP} disabled={props.busy} onClick={() => setConfirmingLand(true)}>
                  {t('land')}
                </Button>
              ) : (
                <Button key={verb} size="sm" variant="outline" className={INBOX_CHIP} disabled={props.busy} onClick={() => props.onAct(item, verb)}>
                  {verb}
                </Button>
              ),
            )
          : null}
        {open && props.onReview !== undefined ? (
          <Button size="sm" variant="outline" className={INBOX_CHIP} onClick={() => props.onReview?.(item)}>
            {t('review')}
          </Button>
        ) : null}
        {openable ? (
          <Button size="sm" variant={open && !item.verbs.includes('Answer') ? 'default' : 'ghost'} className={INBOX_CHIP} onClick={() => props.onOpen(item)}>
            {t('open')}
          </Button>
        ) : null}
        {open && item.verbs.includes('Done') ? (
          <Button size="sm" variant="ghost" className={INBOX_CHIP} disabled={props.busy} onClick={() => props.onDone(item)}>
            {t('done')}
          </Button>
        ) : null}
        {open && props.view !== 'snoozed' && item.verbs.includes('Snooze') ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className={INBOX_CHIP} disabled={props.busy}>
                <ClockIcon aria-hidden />
                {t('snooze')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem keys="H" onSelect={() => props.onSnooze(item, 'hour')}>
                {t('snoozeHour')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onSnooze(item, 'four-hours')}>{t('snoozeFourHours')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onSnooze(item, 'tomorrow')}>{t('snoozeDay')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => props.onSnooze(item, 'change')}>{t('snoozeChange')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {undo === 'reopen' || undo === 'unsnooze' ? (
          <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onReopen(item)}>
            {undo === 'reopen' ? t('reopen') : t('unsnooze')}
          </Button>
        ) : null}
        {undo === 'unmute' ? (
          <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onMute(item.source, false)}>
            {t('unmuteSource')}
          </Button>
        ) : null}
        {open && item.verbs.includes('MuteSource') ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label={t('more')}>
                <EllipsisIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => props.onMute(item.source, true)}>{t('muteSource')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {/* Land rebases the thread's work onto the bookmark and moves it: say what lands before it runs (never one click). */}
      <AlertDialog open={confirmingLand} onOpenChange={setConfirmingLand}>
        <AlertDialogContent className="dshx-root">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('landConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{item.reason}</AlertDialogDescription>
          </AlertDialogHeader>
          {item.detail === null ? null : <p className="dshx:text-sm dshx:text-foreground dshx:break-words">{item.detail}</p>}
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
  if (!phone) return row
  return (
    <div role="none" data-inbox-card="" className="dshx:relative dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-muted">
      {revealed === undefined ? null : (
        <div
          aria-hidden="true"
          data-inbox-swipe-reveal={revealed}
          className={cn(
            'dshx:absolute dshx:inset-0 dshx:flex dshx:items-center dshx:px-5 dshx:text-sm dshx:font-medium dshx:text-foreground',
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
      <DropdownMenuContent align="start" aria-label={t('actionSheet', { title: item.reason })} data-inbox-action-sheet="">
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
    if (listed === undefined) throw new Error('This thread is not listed; open it from the thread list.')
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
  const queryClient = useQueryClient()
  const [view, setView] = useState<AttentionView>('needs-you')
  const [notice, setNotice] = useState<{ readonly tone: 'ok' | 'error'; readonly text: string } | null>(null)
  const openSubject = useInboxOpener(props)
  const sessionLabel = EntityLabels.useSessionLabel(props.sessions)
  const eventStatus = useApiEvent(attentionApi, 'changed', () => void queryClient.invalidateQueries({ queryKey: inboxKeys.all }))
  const viewQuery = (target: AttentionView) => ({
    queryKey: inboxKeys.view(target),
    queryFn: ({ signal }: { readonly signal: AbortSignal }) =>
      runHostRequest({ signal, request: hostSignal => api.list({ view: target, limit: 100 }, { signal: hostSignal }) }),
  })
  // The changed event keeps the list current; polling only covers a disconnected event stream.
  const refetchInterval = eventStatus === 'live' ? 60_000 : 10_000
  const listQuery = useQuery({ ...viewQuery(view), refetchInterval })
  const settle = (outcome: { readonly ok: boolean; readonly message: string } | null): void => {
    if (outcome !== null) setNotice({ tone: outcome.ok ? 'ok' : 'error', text: outcome.message })
    void queryClient.invalidateQueries({ queryKey: inboxKeys.all })
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
            void queryClient.invalidateQueries({ queryKey: inboxKeys.all })
          }),
        },
      }),
    [queryClient],
  )
  const [triage, sendTriage] = useMachine(triageDefinition)
  const triaging = !triage.matches('list')
  const triageNeedsYou = useQuery({ ...viewQuery('needs-you'), enabled: triaging, refetchInterval })
  const triageOther = useQuery({ ...viewQuery('other'), enabled: triaging, refetchInterval })
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
      const [needsYou, other] = await Promise.all([queryClient.fetchQuery(viewQuery('needs-you')), queryClient.fetchQuery(viewQuery('other'))])
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
  const runTriagePrimary = (): void => {
    if (triageItem === undefined || triagePrimary === undefined) return
    if (triagePrimary.kind === 'answer') triageAct({ kind: 'act', id: triageItem.id, verb: 'Answer', choiceId: triagePrimary.choiceId })
    else if (triagePrimary.kind === 'verb') triageAct({ kind: 'act', id: triageItem.id, verb: triagePrimary.verb })
    else if (triagePrimary.kind === 'land') setLandSignal(current => current + 1)
    else openItem(triageItem)
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
  const data = listQuery.data
  const counts = data?.counts
  // Ages are read against the moment the list arrived, so a render never reads the clock.
  const now = listQuery.dataUpdatedAt

  // The list holds its order while the pointer is over it or focus is in it, so rows never move under J/K.
  const listRoot = useRef<HTMLDivElement>(null)
  const rowElements = useRef(new Map<string, HTMLDivElement>())
  const [held, setHeld] = useState<readonly string[] | null>(null)
  const holding = useRef({ hover: false, focus: false })
  const liveItems = data?.items ?? EMPTY_ITEMS
  const liveIds = useMemo(() => liveItems.map(item => item.id), [liveItems])
  const shownItems = HeldOrder.hold(liveItems, held)
  const shownIds = shownItems.map(item => item.id)
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
  })
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
      : (sessionId: string) => (
          <span role="group" aria-label={t('quickReplies')} className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5" data-quick-replies="">
            {replies.map(reply => (
              <Button
                key={reply.id}
                size="sm"
                variant="outline"
                className="dshx:max-w-48 dshx:shrink dshx:rounded-full"
                disabled={quickReply.isPending}
                onClick={() => quickReply.mutate({ sessionId, text: reply.text })}
              >
                <span className="dshx:truncate">{reply.label}</span>
              </Button>
            ))}
          </span>
        )
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
  const triageAction = {
    id: 'triage',
    label: t('triageStart'),
    icon: <ListChecksIcon aria-hidden />,
    disabled: (counts?.needsYou ?? 0) + (counts?.other ?? 0) === 0,
    onSelect: () => void startTriage(),
  }
  // On a phone, Triage (one card at a time, 1 of N, verbs in the thumb zone) is the way through the Inbox: it is the
  // page's visible button rather than an entry in its overflow menu, unless Resume all needs that seat.
  const triageOnTop = coarsePointer() && resumeAllAction === null
  const tabs: readonly { readonly view: AttentionView; readonly label: string; readonly count: number }[] = [
    { view: 'needs-you', label: t('needsYou'), count: counts?.needsYou ?? 0 },
    { view: 'other', label: t('other'), count: counts?.other ?? 0 },
    { view: 'snoozed', label: t('snoozed'), count: counts?.snoozed ?? 0 },
    { view: 'closed', label: t('closed'), count: counts?.closed ?? 0 },
    { view: 'muted', label: t('muted'), count: counts?.muted ?? 0 },
  ]
  const visibleTabs = tabs.filter(tab => tab.view === 'needs-you' || tab.view === 'other' || tab.count > 0 || tab.view === view)
  const peekAnchor = cursor === null ? null : (rowElements.current.get(cursor) ?? null)
  if (triaging) {
    const progress = TriageModel.progress(triage.context)
    return (
      <Page scroll heading={t('triage')} description={t('subtitle')} className="dshx:mx-auto dshx:w-full dshx:max-w-3xl">
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
                primary={triagePrimary}
                busy={triageBusy}
                error={triage.context.error}
                onPrimary={runTriagePrimary}
                onDone={() => triageAct({ kind: 'done', id: triageItem.id })}
                onSnooze={() => triageAct({ kind: 'snooze', id: triageItem.id })}
                onSkip={() => sendTriage({ type: 'skip' })}
                onExit={() => sendTriage({ type: 'exit' })}
              />
              <EntityList aria-label={t('triage')}>
                <InboxRow
                  key={triageItem.id}
                  item={triageItem}
                  view={triageItem.severity === 'ready' || triageItem.severity === 'info' ? 'other' : 'needs-you'}
                  t={t}
                  now={Date.now()}
                  sessionLabel={sessionLabel}
                  busy={triageBusy}
                  openers={openers}
                  showChoiceKeys
                  landSignal={landSignal}
                  {...(quickReplies === undefined ? {} : { quickReplies })}
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
      heading={t('title')}
      description={t('subtitle')}
      className="dshx:mx-auto dshx:w-full dshx:max-w-3xl"
      {...(resumeAllAction !== null ? { primaryAction: resumeAllAction } : triageOnTop ? { primaryAction: triageAction } : {})}
      actions={triageOnTop ? [] : [triageAction]}
      tabs={{
        label: t('title'),
        value: view,
        onValueChange: value => setView(tabs.find(tab => tab.view === value)?.view ?? 'needs-you'),
        items: visibleTabs.map(tab => ({ value: tab.view, label: tab.label, ...(tab.count > 0 && { count: tab.count }) })),
      }}
    >
      {notice === null ? null : (
        <Alert variant={notice.tone === 'error' ? 'destructive' : 'default'} role={notice.tone === 'error' ? 'alert' : 'status'}>
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}
      {listQuery.error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <span>
              {errorMessage(listQuery.error, t('loadFailed'))} {t('loadFailedHint')}
            </span>
            <Button size="sm" variant="outline" onClick={() => void listQuery.refetch()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
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
          <EntityList
            aria-label={tabs.find(tab => tab.view === view)?.label ?? t('title')}
            className="dshx:pointer-coarse:gap-2 dshx:pointer-coarse:divide-y-0 dshx:pointer-coarse:rounded-none dshx:pointer-coarse:border-0 dshx:pointer-coarse:bg-transparent"
          >
            {shownItems.map(item => (
              <InboxRow
                key={item.id}
                item={item}
                view={view}
                t={t}
                now={now}
                sessionLabel={sessionLabel}
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
                title={cursorItem.reason}
                status={statusOf(cursorItem, view)}
                statusLabel={statusLabelOf(statusOf(cursorItem, view), t)}
                {...(cursorItem.subject.kind === 'session' ? { reply } : {})}
                {...(listOpen && cursorItem.verbs.includes('Answer') && cursorItem.choices.length > 0
                  ? {
                      question: {
                        text: cursorItem.detail ?? cursorItem.reason,
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
                  ...(cursorItem.detail === null || cursorItem.verbs.includes('Answer') ? [] : [cursorItem.detail]),
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
      <InboxNotifications.Toggle t={t} />
      <InboxPush.Control t={t} />
    </Page>
  )
}

const EMPTY_ITEMS: readonly AttentionItem[] = []
