// An enclosing `[data-conversation-scroll]` owns scrolling when present;
// otherwise this view owns it. Each row subscribes to one stable node key.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  NodeKey, RenderEntry,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  Button, classifyLinkPath, IconChevronDownOutlineRegular, MarkdownDelegateProvider, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ImageLightbox, type ImageLightboxLabels, type LightboxImage } from '@dshfiles/plugin-ui/components/image-lightbox'
import { endInteractionAfterPaint } from '@dshfiles/dshx/tracing/client'
import { isAtOrOutside } from '../contract/group-tree.ts'
import type { ChatFlowHookContext, ChatViewSlotProps, OpenFileOptions } from '../contract/slots.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import { TurnNavigator } from './TurnNavigator.tsx'
import { TranscriptWindow, useTranscriptWindow } from '../../transcript-window.ts'
import { mergeTurnRailItems } from './turn-rail-items.ts'
import { useChatScroll } from './use-chat-scroll.ts'
import { openMarkdownExternalLink, openMarkdownFileLink } from './markdown-image-links.ts'
import { fileMediaUrl, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import css from './ChatView.module.css'

/** Host/OS refusal text for the file-open dialog; empty throws keep a locale fallback. */
function openFailureMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return message === '' ? fallback : message
}

/**
 * Durable input identities suppress matching echoes in the same render.
 * The last input's Turn also distinguishes an empty opening control from
 * one whose human input or trigger notice is already present.
 */
function observedInputs(
  order: readonly string[],
  nodes: ChatSnapshot['nodes'],
): { readonly rpcIds: ReadonlySet<string>; readonly lastInputTurn: number | undefined } {
  const observed = new Set<string>()
  let lastInputTurn: number | undefined
  for (const key of order) {
    const node = nodes.get(key)
    if (node === undefined || !isAtOrOutside(node, 'input')) continue
    if (node.location.kind === 'turn' || node.location.kind === 'step') lastInputTurn = node.location.turn.turn
    const data: unknown = node.data
    const source = typeof data === 'object' && data !== null && 'source' in data ? data.source : undefined
    if (typeof source === 'object' && source !== null && 'kind' in source && source.kind === 'user'
      && 'rpcId' in source && typeof source.rpcId === 'string') observed.add(source.rpcId)
  }
  return { rpcIds: observed, lastInputTurn }
}

type PendingInput = PendingSubmission | InboxState['next-step'][number]

/** How long fold transitions stay enabled after a Turn stops running. */
const MOTION_TAIL_MS = 800

/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
export function ChatView({
  useSession, useChat, useConversation, useSessions, renderSlot,
  sessionId, openFile, openExternalLink, loadOlder, loadThrough, loadImage, inspectCall, chatScroll, forkAt, fileMentions,
  usePresentation, useProjection, t,
}: ChatViewSlotProps) {
  const order = useChat(s => s.order)
  const groupedView = useConversation(snapshot => snapshot.views.grouped('chat'))
  const groupedEntries = groupedView?.entries
  const entries = useMemo<readonly RenderEntry[]>(() => groupedEntries
    ?? order.map(key => ({ kind: 'node', key: key as NodeKey })), [groupedEntries, order])
  const nodeStore = useChat(s => s.nodes)
  const deferCompletedTurns = usePresentation(policy => policy.collapseTiming === 'next-input')
  const transcriptView = usePresentation(policy => policy.mode)
  // The rail's items are accumulated in the Chat snapshot, so this selector is
  // both the data and its change signal: the array identity moves only when a
  // Turn enters, leaves, or changes its preview.
  const turnNavigationItems = useChat(s => s.navigation.items())
  // Host-computed whole-log outline; the merge is view-layer only (the
  // conversation snapshot never carries projection values).
  const turnOutline = useProjection('turnOutline')
  const railItems = useMemo(
    () => mergeTurnRailItems(turnNavigationItems, turnOutline),
    [turnNavigationItems, turnOutline],
  )
  const inbox = useProjection('inbox') as InboxState | undefined
  // Workspace root off the session list row: path summaries display relative to it.
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const fileImages = useMemo(() => ({
    resolve: (path: string) => fileMediaUrl(document.baseURI, resolveWorkspacePath(cwd, path)),
    labels: {
      open: t('image.open'), loading: t('image.loading'), failed: t('image.failed'),
      dialog: t('image.dialog'), close: t('image.close'),
    },
  }), [cwd, t])
  const [imagePreview, setImagePreview] = useState<LightboxImage | null>(null)
  const imageLightboxLabels = useMemo<ImageLightboxLabels>(() => ({
    dialog: t('image.dialog'),
    close: t('image.close'),
    previous: t('image.previous'),
    next: t('image.next'),
    thumbnail: (position, total) => t('image.thumbnail', { position, total }),
    loading: t('image.loading'),
  }), [t])
  const closeImagePreview = useCallback(() => { setImagePreview(null) }, [])
  const running = useSession(s => s.running)
  // Fold transitions run while a Turn is live, while an input is pending, and briefly after settling.
  const [motionTail, setMotionTail] = useState(false)
  useEffect(() => {
    if (!deferCompletedTurns) {
      setMotionTail(false)
      return
    }
    if (running) {
      setMotionTail(true)
      return
    }
    const timer = setTimeout(() => { setMotionTail(false) }, MOTION_TAIL_MS)
    return () => { clearTimeout(timer) }
  }, [running, deferCompletedTurns])
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)
  const groupMembers = useCallback((groupKey: string) => (
    groupedView?.groupSource(groupKey as Parameters<NonNullable<typeof groupedView>['groupSource']>[0]).getSnapshot()?.members.map(member => member.key) ?? []
  ), [groupedView])
  // Read during render from the previous commit: the scroll owner needs the window's output to exist.
  const followingTail = useRef(true)
  const fillSteps = useRef(TranscriptWindow.openingFillSteps)
  useEffect(() => { fillSteps.current = TranscriptWindow.openingFillSteps }, [sessionId])
  // A sidebar or tab click opened the thread switch; it ends once this thread's transcript painted.
  const transcriptOpen = openState === 'open'
  const entryCount = useRef(0)
  entryCount.current = entries.length
  useEffect(() => {
    if (transcriptOpen) endInteractionAfterPaint('thread switch', { 'dshx.chat.entries': entryCount.current })
  }, [sessionId, transcriptOpen])
  const transcript = useTranscriptWindow({
    ready: openState === 'open',
    following: useCallback(() => followingTail.current, []),
    entries,
    seqOf: useCallback((entry: RenderEntry) => {
      const key = entry.kind === 'node' ? entry.key : groupMembers(entry.key)[0]
      return key === undefined ? undefined : nodeStore.get(key as NodeKey)?.anchorSeq
    }, [groupMembers, nodeStore]),
    members: groupMembers,
    savedAnchor: useCallback(() => chatScroll.read()?.anchorKey ?? null, [chatScroll]),
    hasMore, loadOlder, loadThrough,
  })
  // The scroll owner measures the rows it can see, so it follows the mounted window, not the whole Chat order.
  const mountedOrder = useMemo(() => {
    const firstMounted = transcript.firstSeq
    if (transcript.hidden === 0 || firstMounted === null) return order
    return order.filter(key => (nodeStore.get(key)?.anchorSeq ?? firstMounted) >= firstMounted)
  }, [order, nodeStore, transcript.hidden, transcript.firstSeq])
  const [fileOpenError, setFileOpenError] = useState<{ path: string; message: string } | null>(null)
  const [fileOpenBusy, setFileOpenBusy] = useState(false)
  // Close/retry must ignore a settlement that started before the latest
  // gesture; otherwise a cancelled in-flight refusal reopens the dialog.
  const fileOpenRequest = useRef(0)

  const requestOpenFile = useCallback((path: string, options?: OpenFileOptions) => {
    const id = ++fileOpenRequest.current
    setFileOpenBusy(true)
    void (options === undefined ? openFile(path) : openFile(path, options)).then(
      () => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError(null)
        setFileOpenBusy(false)
      },
      (error: unknown) => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError({
          path,
          message: openFailureMessage(
            error,
            t('fileOpen.unknown'),
          ),
        })
        setFileOpenBusy(false)
      },
    )
  }, [openFile, t])

  const requestOpenMarkdownFile = useCallback((path: string, options?: OpenFileOptions) => {
    openMarkdownFileLink({
      path,
      kind: classifyLinkPath(path),
      options,
      resolveImage: fileImages.resolve,
      openImage: setImagePreview,
      openFile: requestOpenFile,
    })
  }, [fileImages, requestOpenFile])

  const requestOpenMarkdownExternalLink = useCallback((href: string) => {
    const kind = (() => {
      try {
        const url = new URL(href)
        return url.protocol === 'http:' || url.protocol === 'https:' ? classifyLinkPath(url.pathname) : undefined
      } catch {
        return undefined
      }
    })()
    openMarkdownExternalLink({ href, kind, openImage: setImagePreview, openExternalLink })
  }, [openExternalLink])

  const closeFileOpenError = useCallback(() => {
    fileOpenRequest.current += 1
    setFileOpenError(null)
    setFileOpenBusy(false)
  }, [])

  const inboxSteering = useMemo(
    () => inbox?.['next-step'].filter(message => message.source.kind === 'user') ?? [],
    [inbox],
  )
  const pendingSubmissions = useSession(s => s.pendingSubmissions)
  // Submission echoes still awaiting their durable counterpart. `order` is the
  // recompute trigger: durable user material always arrives as an append, and
  // every append replaces the order array.
  const [visibleSubmissions, lastInputTurn] = useMemo(() => {
    if (pendingSubmissions.length === 0) return [pendingSubmissions, undefined] as const
    const observed = observedInputs(order, nodeStore)
    return [pendingSubmissions.filter(submission => (
      submission.placement !== 'queued' && !observed.rpcIds.has(submission.requestId)
    )), observed.lastInputTurn] as const
  }, [pendingSubmissions, order, nodeStore])
  const pendingInputs = useMemo(() => {
    const local = new Map(visibleSubmissions.map(submission => [submission.requestId, submission]))
    // Admitted local identities outlive their bubbles until the Inbox claim watermark.
    const localIds = new Set(pendingSubmissions.filter(submission => submission.placement !== 'queued')
      .map(submission => submission.requestId))
    const pending = inboxSteering.flatMap<PendingInput>((item) => {
      const source = item.source
      if (source.kind !== 'user' || !('rpcId' in source)) return [item]
      const submission = local.get(source.rpcId)
      if (submission === undefined) return localIds.has(source.rpcId) ? [] : [item]
      local.delete(source.rpcId)
      return [submission]
    })
    return [...pending, ...local.values()]
  }, [inboxSteering, pendingSubmissions, visibleSubmissions])
  const deferCollapse = deferCompletedTurns
    && !pendingInputs.some(item => 'requestId' in item && item.placement === 'transcript')

  const firstSeq = transcript.firstSeq
  const lastKey = order.at(-1) ?? null
  const latestSteering = pendingInputs.findLast(item => 'source' in item)
  const steeringId = latestSteering?.source.kind === 'user' && 'rpcId' in latestSteering.source
    ? latestSteering.source.rpcId : latestSteering?.id ?? null
  const scroll = useChatScroll({
    ready: openState === 'open',
    order: mountedOrder, firstSeq, lastKey, running, loadingOlder, hasMore: transcript.hasMore, chatScroll,
    loadOlder: transcript.loadOlder, loadThrough: transcript.loadThrough, deferCompletedTurns,
    lastIsUser: lastKey !== null && nodeStore.get(lastKey)?.kind === 'user',
    steeringId,
    submissionId: visibleSubmissions.at(-1)?.requestId ?? null,
    loadedTurns: turnNavigationItems,
    transcriptView,
  })
  followingTail.current = scroll.followingTail
  const flowContext = useMemo<ChatFlowHookContext>(() => ({ motion: scroll.motion }), [scroll.motion])

  return (
    <div className={css.frame}>
      {scroll.initialized && (
        <TurnNavigator
          items={railItems}
          activeTurn={scroll.activeTurn}
          busyTurn={scroll.busyTurn}
          onNavigate={scroll.navigateToTurn}
          t={t}
        />
      )}
      <div className={css.root} data-chat-following-tail={scroll.followingTail ? '' : undefined}>
        <div ref={scroll.listRef} className={css.scroll}>
          <div ref={scroll.columnRef} className={css.column} data-chat-flow=""
            data-chat-motion={deferCompletedTurns && scroll.initialized
              && (running || motionTail || pendingInputs.length > 0) ? '' : undefined}>
            {openState === 'loading' && <div className={css.hint}>{t('chat.loadingHistory')}</div>}
            {openState === 'error' && openError !== null && (
              <div className={css.openError}>
                {t('chat.loadError', { message: openError.message, code: openError.code })}
              </div>
            )}
            {transcript.hasMore && scroll.initialized && !loadingOlder && (
              <OlderRowsSentinel listRef={scroll.listRef} hidden={transcript.hidden} onVisible={scroll.loadEarlier} fillSteps={fillSteps} />
            )}
            {transcript.hasMore && loadingOlder && <div className={css.older}>{t('loading')}</div>}
            <MarkdownDelegateProvider openFile={requestOpenMarkdownFile} openExternalLink={requestOpenMarkdownExternalLink} fileImages={fileImages}>
              {renderSlot('conversation.chat.flow', {
                entries: transcript.entries, pendingInputs, lastInputTurn, deferCollapse,
                cwd, openFile: requestOpenFile, inspectCall, forkAt, loadImage, fileMentions,
              }, { hookContext: flowContext })}
            </MarkdownDelegateProvider>
            {/* No pending placeholders: questions (ui-user-questions) and approvals
                (ApprovalPanel) both take over the composer, so a flow card would
                double-render the same wait. */}
          </div>
          {/* Fold room is reclaimed by viewport scroll, content-growth, and display-mode policies. */}
          <div className={css.turnSpacer} data-chat-turn-spacer aria-hidden="true" />
        </div>
      </div>
      {!scroll.followingTail && (
        <div className={css.toBottomSlot}>
          <button
            type="button"
            className={css.toBottom}
            aria-label={t('chat.toBottom')}
            onClick={scroll.returnToBottom}
          >
            <IconChevronDownOutlineRegular />
          </button>
        </div>
      )}
      {imagePreview !== null && (
        <ImageLightbox images={[imagePreview]} initialIndex={0} labels={imageLightboxLabels} onClose={closeImagePreview} />
      )}
      {fileOpenError !== null && (
        <FileOpenErrorDialog
          message={fileOpenError.message}
          busy={fileOpenBusy}
          onClose={closeFileOpenError}
          onRetry={() => { requestOpenFile(fileOpenError.path) }}
          t={t}
        />
      )}
    </div>
  )
}

/**
 * Mounts the next older rows, or asks the Host for the next older page, once the reader nears the top. It unmounts
 * while a page loads, so a page that still leaves it in view observes it again and takes the next one.
 */
function OlderRowsSentinel({ listRef, hidden, onVisible, fillSteps }: {
  listRef: { readonly current: HTMLDivElement | null }
  hidden: number
  onVisible: () => void
  /** Steps left that may widen a view the rows do not fill yet, without the reader scrolling. */
  fillSteps: { current: number }
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Observed again after every step: a step that still leaves the sentinel in view must take the next one.
  useEffect(() => {
    const target = ref.current
    const list = listRef.current
    if (target === null || list === null || typeof IntersectionObserver !== 'function') return
    let near = false
    let fired = false
    let upward = false
    let lastTop = list.scrollTop
    // A thread opens at its newest row, and collapsed Turns are a few pixels tall, so the top is often within reach
    // there; widening only once the reader leaves the tail, or a few steps while the rows do not fill the view, keeps
    // an open from paging in the whole history.
    const take = (): void => {
      if (fired || !near) return
      const fillsView = list.scrollHeight > list.clientHeight + 1
      const atTail = list.scrollHeight - list.scrollTop - list.clientHeight < 48
      if (atTail && !upward && (fillsView || fillSteps.current <= 0)) return
      if (atTail && !upward) fillSteps.current -= 1
      fired = true
      onVisible()
    }
    const observer = new IntersectionObserver((records) => {
      near = records.some(record => record.isIntersecting)
      take()
    }, { root: list, rootMargin: '1200px 0px 0px 0px' })
    // Reading upward also counts when the rows cannot scroll yet: a wheel or key toward older rows.
    const onScroll = (): void => {
      if (list.scrollTop < lastTop) upward = true
      lastTop = list.scrollTop
      take()
    }
    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY >= 0) return
      upward = true
      take()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'PageUp' && event.key !== 'ArrowUp' && event.key !== 'Home') return
      upward = true
      take()
    }
    observer.observe(target)
    list.addEventListener('scroll', onScroll, { passive: true })
    list.addEventListener('wheel', onWheel, { passive: true })
    list.addEventListener('keydown', onKey)
    return () => {
      observer.disconnect()
      list.removeEventListener('scroll', onScroll)
      list.removeEventListener('wheel', onWheel)
      list.removeEventListener('keydown', onKey)
    }
  }, [listRef, hidden, onVisible])
  return <div ref={ref} aria-hidden="true" data-chat-older-rows="" />
}

/** In-page Host open-path refusal: the wire reason plus a retry of the same path. */
function FileOpenErrorDialog({
  message, busy, onClose, onRetry, t,
}: {
  message: string
  busy: boolean
  onClose: () => void
  onRetry: () => void
  t: ChatViewSlotProps['t']
}) {
  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('close')}
      title={t('fileOpen.title')}
      description={message}
      footer={(
        <>
          <Button variant="outline" className={css.modalAction} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" className={css.modalAction} disabled={busy} onClick={onRetry}>{t('retry')}</Button>
        </>
      )}
    />
  )
}
