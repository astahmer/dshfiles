// An enclosing `[data-conversation-scroll]` owns scrolling when present;
// otherwise this view owns it. Each row subscribes to one stable node key.

import { ChevronDownIcon } from '@dshfiles/plugin-ui/icons'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  NodeKey, RenderEntry,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  Button, classifyLinkPath, IconChevronDownOutlineRegular, MarkdownDelegateProvider, Modal, type MarkdownMenuTarget,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ImageLightbox, type ImageLightboxLabels, type LightboxImage } from '@dshfiles/plugin-ui/components/image-lightbox'
import { endInteractionAfterPaint } from '@dshfiles/dshx/tracing/client'
import { isAtOrOutside } from '../contract/group-tree.ts'
import type { ChatFlowHookContext, ChatViewSlotProps, OpenFileOptions } from '../contract/slots.ts'
import type { ImageGalleryNode } from './image-gallery.ts'
import { collectChatGalleryImages, selectChatImageGallery } from './image-gallery.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import { TurnNavigator } from './TurnNavigator.tsx'
import { AnnotateSelection } from './AnnotateSelection.tsx'
import { TranscriptWindow, useTranscriptWindow } from '../../transcript-window.ts'
import { chatRenderKey } from './render-entry.ts'
import { ConversationViewOpenerContext, useChatFocus } from '../../chat-focus-reveal.ts'
import { InlineReferenceScope } from '../../inline-references.tsx'
import { mergeTurnRailItems, turnStarts } from './turn-rail-items.ts'
import { TranscriptFind } from '../../transcript-find.ts'
import { TranscriptFindBar } from '../../transcript-find-bar.tsx'
import { useTextInteraction } from './text-interaction.ts'
import { useChatScroll } from './use-chat-scroll.ts'
import { openMarkdownExternalLink, openMarkdownFileLink } from './markdown-image-links.ts'
import { ImagePreviewRequestModel, type ImagePreview } from '../../image-preview-request.ts'
import { FileOpenRequestModel, type FileOpenRequest } from '../../file-open-request.ts'
import { MOTION_TAIL_MS, motionTailNext, type MotionTail } from '../../motion-tail.ts'
import { fileMediaUrl, resolveWorkspacePath, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
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

/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
export function ChatView({
  useSession, useChat, useConversation, useSessions, renderSlot, useImageGalleryScope, useUnreadLanding,
  sessionId, openFile, openExternalLink, resolveFilePath, useContextMenu,
  loadOlder, loadThrough, loadImage, inspectCall, chatScroll, seenAnswer, forkAt,
  usePresentation, useProjection, useInteractionIds, dispatchInteraction, t, fileDrag,
  viewRequest, completeViewRequest, openView,
}: ChatViewSlotProps) {
  const { getTriggerProps } = useContextMenu()
  const getMarkdownTriggerProps = useCallback((target: MarkdownMenuTarget) => getTriggerProps(() => {
    switch (target.kind) {
      case 'file': return { kind: 'file', value: { sessionId, path: resolveFilePath(target.path),
        ...(target.line === undefined ? {} : { line: target.line }) } }
      case 'url': return { kind: 'url', value: { sessionId, url: target.url } }
      case 'image': return { kind: 'image', value: { sessionId, url: target.url,
        ...(target.name === undefined ? {} : { name: target.name }),
        ...(target.mediaType === undefined ? {} : { mediaType: target.mediaType }),
        ...(target.path === undefined ? {} : { path: resolveFilePath(target.path) }) } }
    }
  }), [getTriggerProps, resolveFilePath, sessionId])
  const order = useChat(s => s.order)
  const groupedView = useConversation(snapshot => snapshot.views.grouped('chat'))
  const groupedEntries = groupedView?.entries
  const entries = useMemo<readonly RenderEntry[]>(() => groupedEntries
    ?? order.map(key => ({ kind: 'node', key: key as NodeKey })), [groupedEntries, order])
  const nodeStore = useChat(s => s.nodes)
  const imageGalleryScope = useImageGalleryScope(scope => scope)
  const unreadLanding = useUnreadLanding(landing => landing)
  const unreadLabel = t('chat.unreadDivider')
  const unread = useMemo(() => ({ landing: unreadLanding, seenAnswer, label: unreadLabel }), [unreadLanding, seenAnswer, unreadLabel])
  const deferCompletedTurns = usePresentation(policy => policy.collapseTiming === 'next-input')
  const transcriptView = usePresentation(policy => policy.mode)
  // The rail's items are accumulated in the Chat snapshot, so this selector is
  // both the data and its change signal: the array identity moves only when a
  // Turn enters, leaves, or changes its preview.
  const turnNavigationItems = useChat(s => s.navigation.items())
  // Host-computed whole-log outline; the merge is view-layer only (the
  // conversation snapshot never carries projection values).
  const turnOutline = useProjection('turnOutline')
  // dshfiles (productivity pass T4.2): per-Turn question / failure / edit facts, served by turn-summary's Host fold.
  const turnMarksValue = useProjection(TurnMarksModel.key)
  const turnMarks = useMemo(() => TurnMarksModel.byTurn(turnMarksValue), [turnMarksValue])
  const railItems = useMemo(
    () => mergeTurnRailItems(turnNavigationItems, turnOutline, turnMarks),
    [turnNavigationItems, turnOutline, turnMarks],
  )
  const inbox = useProjection('inbox') as InboxState | undefined
  // Workspace root off the session list row: path summaries display relative to it.
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const fileImages = useMemo(() => ({
    fileDrag,
    resolve: (path: string) => fileMediaUrl(document.baseURI, resolveWorkspacePath(cwd, path)),
    resourceAddress: (path: string) => sessionFileAddress(sessionId, resolveWorkspacePath(cwd, path)),
    labels: {
      open: t('image.open'), loading: t('image.loading'), failed: t('image.failed'),
      dialog: t('image.dialog'), close: t('image.close'),
    },
  }), [cwd, t, fileDrag, sessionId])
  const [imagePreview, setImagePreview] = useState<ImagePreview<LightboxImage>>(() =>
    ImagePreviewRequestModel.imagePreviewClosed<LightboxImage>(),
  )
  useEffect(() => { setImagePreview(ImagePreviewRequestModel.imagePreviewClosed<LightboxImage>()) }, [sessionId])
  const imageLightboxLabels = useMemo<ImageLightboxLabels>(() => ({
    dialog: t('image.dialog'),
    close: t('image.close'),
    previous: t('image.previous'),
    next: t('image.next'),
    thumbnail: (position, total) => t('image.thumbnail', { position, total }),
    loading: t('image.loading'),
  }), [t])
  const openImagePreview = useCallback((image: LightboxImage, path?: string) => {
    const request = ImagePreviewRequestModel.beginImagePreview()
    setImagePreview(ImagePreviewRequestModel.imagePreviewOpening(request))
    const open = async (): Promise<void> => {
      const firstTurn = railItems[0]
      if (imageGalleryScope === 'thread' && firstTurn?.anchor.kind === 'unloaded') {
        await loadThrough(firstTurn.anchor.seq).catch(() => {})
      }
      if (!ImagePreviewRequestModel.imagePreviewRequestIsCurrent(request)) return
      const nodes: ImageGalleryNode[] = []
      for (const { turn } of railItems) {
        nodes.push(
          ...nodeStore.turnDataSource(turn, 'assistant-step').getSnapshot().map(data => ({ kind: 'assistant-step', turn, data } satisfies ImageGalleryNode)),
          ...nodeStore.turnDataSource(turn, 'user').getSnapshot().map(data => ({ kind: 'user', turn, data } satisfies ImageGalleryNode)),
          ...nodeStore.turnDataSource(turn, 'steering').getSnapshot().map(data => ({ kind: 'steering', turn, data } satisfies ImageGalleryNode)),
          ...nodeStore.turnDataSource(turn, 'context').getSnapshot().map(data => ({ kind: 'context', turn, data } satisfies ImageGalleryNode)),
          ...nodeStore.turnDataSource(turn, 'turn-trigger').getSnapshot().map(data => ({ kind: 'turn-trigger', turn, data } satisfies ImageGalleryNode)),
          ...nodeStore.turnDataSource(turn, 'tool-call').getSnapshot().map(data => ({ kind: 'tool-call', turn, data } satisfies ImageGalleryNode)),
        )
      }
      const selection = selectChatImageGallery({
        images: collectChatGalleryImages({ nodes, loadImage, resolveImage: fileImages.resolve }),
        scope: imageGalleryScope,
        ...(path === undefined ? {} : { selectedPath: path }),
        resolvePath: imagePath => resolveWorkspacePath(cwd, imagePath),
        fallbackImage: image,
      })
      const preview = { images: selection.images, initialIndex: selection.initialIndex }
      setImagePreview(current => ImagePreviewRequestModel.imagePreviewOpened(current, { request, ...preview }))
      void Promise.all(selection.images.map((candidate, index) => {
        if (candidate.src !== undefined) return Promise.resolve(candidate.src)
        const load = selection.loaders[index]
        return load === undefined ? Promise.resolve(undefined) : load().catch(() => undefined)
      })).then(sources => {
        setImagePreview(current => ImagePreviewRequestModel.imagePreviewLoaded(current, {
          request,
          images: preview.images.map((candidate, index) => {
            const src = sources[index]
            return src === undefined ? candidate : { ...candidate, src }
          }),
        }))
      })
    }
    void open()
  }, [cwd, fileImages, imageGalleryScope, loadImage, loadThrough, nodeStore, railItems])
  const closeImagePreview = useCallback(() => { setImagePreview(ImagePreviewRequestModel.imagePreviewClosed<LightboxImage>()) }, [])
  const running = useSession(s => s.running)
  // Fold transitions run while a Turn is live, while an input is pending, and briefly after settling.
  const [motionTail, setMotionTail] = useState<MotionTail>('off')
  useEffect(() => {
    setMotionTail(current => motionTailNext(current, { running, deferCompletedTurns }))
    if (!deferCompletedTurns || running) return
    const timer = setTimeout(() => { setMotionTail('off') }, MOTION_TAIL_MS)
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
  const [fileOpen, setFileOpen] = useState<FileOpenRequest>(FileOpenRequestModel.idleFileOpen)
  /** The refusal dialog's content: the settled refusal, or the one a running retry keeps on screen. */
  const fileOpenFailure = fileOpen.status === 'refused'
    ? { path: fileOpen.path, message: fileOpen.message, busy: false }
    : fileOpen.status === 'opening' && fileOpen.refusal !== undefined
      ? { path: fileOpen.path, message: fileOpen.refusal, busy: true }
      : null

  const startFileOpen = useCallback((input: { path: string; options: OpenFileOptions | undefined; refusal: string | undefined }) => {
    const request = FileOpenRequestModel.beginFileOpen(input)
    if (request.status !== 'opening') return
    setFileOpen(request)
    void (input.options === undefined ? openFile(input.path) : openFile(input.path, input.options)).then(
      () => { setFileOpen(current => FileOpenRequestModel.settleFileOpen(current, { request: request.request, message: undefined })) },
      (error: unknown) => {
        setFileOpen(current => FileOpenRequestModel.settleFileOpen(current, {
          request: request.request,
          message: openFailureMessage(error, t('fileOpen.unknown')),
        }))
      },
    )
  }, [openFile, t])

  const requestOpenFile = useCallback((path: string, options?: OpenFileOptions) => {
    startFileOpen({ path, options, refusal: undefined })
  }, [startFileOpen])

  const retryFileOpen = useCallback((input: { path: string; refusal: string }) => {
    startFileOpen({ path: input.path, options: undefined, refusal: input.refusal })
  }, [startFileOpen])

  const requestOpenImageAwareFile = useCallback((path: string, options?: OpenFileOptions) => {
    openMarkdownFileLink({
      path,
      kind: classifyLinkPath(path),
      options,
      resolveImage: fileImages.resolve,
      openImage: openImagePreview,
      openFile: requestOpenFile,
    })
  }, [fileImages, openImagePreview, requestOpenFile])

  const requestOpenMarkdownExternalLink = useCallback((href: string) => {
    const kind = (() => {
      try {
        const url = new URL(href)
        return url.protocol === 'http:' || url.protocol === 'https:' ? classifyLinkPath(url.pathname) : undefined
      } catch {
        return undefined
      }
    })()
    openMarkdownExternalLink({ href, kind, openImage: image => { openImagePreview(image) }, openExternalLink })
  }, [openExternalLink, openImagePreview])

  const closeFileOpenError = useCallback(() => { setFileOpen(FileOpenRequestModel.idleFileOpen()) }, [])

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
    submissionSteers: visibleSubmissions.at(-1)?.placement === 'steering',
    loadedTurns: turnNavigationItems,
    transcriptView,
    unread,
  })
  followingTail.current = scroll.followingTail
  // Back at the newest row (and while new rows stream in), the rows read further up leave the DOM again.
  const keepTail = transcript.keepTail
  useLayoutEffect(() => {
    if (scroll.followingTail) keepTail()
  }, [scroll.followingTail, keepTail])
  useChatFocus({
    sessionId, viewRequest, completeViewRequest, ready: scroll.initialized,
    railItems, navigateToTurn: scroll.navigateToTurn, listRef: scroll.listRef,
  })
  const interactionSurfaceRef = useRef<HTMLDivElement>(null)
  const interactionIds = useInteractionIds(ids => ids)
  const textInteraction = useTextInteraction(scroll.columnRef, interactionSurfaceRef, dispatchInteraction, interactionIds)
  const flowContext = useMemo<ChatFlowHookContext>(() => ({ motion: scroll.motion }), [scroll.motion])

  // dshfiles (productivity pass Q4): long-thread tools — find, the typed turn map, the Turns sheet, Since you left.
  const frameRef = useRef<HTMLDivElement>(null)
  const listElement = useCallback(() => scroll.listRef.current, [scroll.listRef])
  const navigateToTurn = scroll.navigateToTurn
  const activeTurn = scroll.activeTurn
  const [turnFilter, setTurnFilter] = useState<TurnMarkFilter>('all')
  useEffect(() => { setTurnFilter('all') }, [sessionId])
  const filterCounts = useMemo(() => {
    const counts: Record<TurnMarkFilter, number> = { all: railItems.length, questions: 0, errors: 0, edits: 0 }
    for (const item of railItems) {
      if (TurnMarksModel.matches('questions', item.kind, item.mark)) counts.questions += 1
      if (TurnMarksModel.matches('errors', item.kind, item.mark)) counts.errors += 1
      if (TurnMarksModel.matches('edits', item.kind, item.mark)) counts.edits += 1
    }
    return counts
  }, [railItems])
  const shownRailItems = useMemo(
    () => (turnFilter === 'all' ? railItems : railItems.filter(item => TurnMarksModel.matches(turnFilter, item.kind, item.mark))),
    [railItems, turnFilter],
  )
  /** Jump to a Turn; one the window has not mounted pages in through its `turn/start` sequence. */
  const jumpToTurn = useCallback((turn: number) => {
    const item = railItems.find(candidate => candidate.turn === turn)
    if (item === undefined) return
    const mounted = scroll.columnRef.current?.querySelector(`[data-chat-turn="${String(turn)}"]`) != null
    navigateToTurn(!mounted && item.seq !== null ? { ...item, anchor: { kind: 'unloaded', seq: item.seq } } : item)
  }, [railItems, navigateToTurn, scroll.columnRef])
  const stepTurn = useCallback((direction: 'previous' | 'next'): boolean => {
    const target = direction === 'previous'
      ? shownRailItems.findLast(item => activeTurn === null || item.turn < activeTurn)
      : shownRailItems.find(item => activeTurn !== null && item.turn > activeTurn)
    if (target === undefined) return false
    jumpToTurn(target.turn)
    return true
  }, [shownRailItems, activeTurn, jumpToTurn])
  // The Turns on screen, for the rail's band; read from the top-level rows after each scroll frame.
  const [inView, setInView] = useState<{ readonly first: number; readonly last: number } | null>(null)
  useEffect(() => {
    const column = scroll.columnRef.current
    const list = scroll.listRef.current
    if (column === null || list === null) return
    let frame = 0
    const measure = (): void => {
      frame = 0
      const scroller = list.closest<HTMLElement>('[data-conversation-scroll]') ?? list
      const bounds = scroller.getBoundingClientRect()
      let first = Number.POSITIVE_INFINITY
      let last = Number.NEGATIVE_INFINITY
      for (const row of column.querySelectorAll<HTMLElement>(':scope > [data-chat-turn]')) {
        const rect = row.getBoundingClientRect()
        if (rect.height === 0 || rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue
        const turn = Number(row.dataset.chatTurn)
        if (!Number.isFinite(turn)) continue
        first = Math.min(first, turn)
        last = Math.max(last, turn)
      }
      const next = Number.isFinite(first) ? { first, last } : null
      setInView(current => (current?.first === next?.first && current?.last === next?.last ? current : next))
    }
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }
    schedule()
    document.addEventListener('scroll', schedule, { capture: true, passive: true })
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    observer?.observe(column)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      document.removeEventListener('scroll', schedule, { capture: true })
      observer?.disconnect()
    }
  }, [scroll.columnRef, scroll.listRef, sessionId, scroll.initialized])

  // Find: rows of each loaded Turn with their first sequence, so a hit maps to the row that renders it.
  const rowsByTurn = useMemo(() => {
    const rows = new Map<number, { key: string; seq: number }[]>()
    for (const key of order) {
      const node = nodeStore.get(key)
      const location = node?.location
      if (node === undefined || (location?.kind !== 'turn' && location?.kind !== 'step')) continue
      const turn = location.turn.turn
      const list = rows.get(turn) ?? []
      list.push({ key, seq: node.anchorSeq })
      rows.set(turn, list)
    }
    return rows
  }, [order, nodeStore])
  const rowsRef = useRef(rowsByTurn)
  rowsRef.current = rowsByTurn
  // A finished Turn keeps its work out of the order until its "Worked for" opens: an event of that work resolves to
  // the process row, whose toggle the reveal opens; once its rows load, the same lookup lands on the real row.
  const rowFor = useCallback((turn: number, seq: number, type: string | undefined) => {
    const rows = rowsRef.current.get(turn) ?? []
    const key = ThreadFindModel.rowFor(rows, seq)
    if (key === null || type === undefined || type === 'user/message') return key
    if (nodeStore.get(key as NodeKey)?.kind !== 'user') return key
    return rows.find(row => nodeStore.get(row.key as NodeKey)?.kind === 'turn-process')?.key ?? key
  }, [nodeStore])
  const railRef = useRef(railItems)
  railRef.current = railItems
  const activeRef = useRef(activeTurn)
  activeRef.current = activeTurn
  const readerSeq = useCallback((): number | null => {
    const items = railRef.current
    const index = items.findIndex(item => item.turn === activeRef.current)
    const next = index === -1 ? undefined : items[index + 1]
    return next?.seq === null || next?.seq === undefined ? null : next.seq - 1
  }, [])
  const [find, setFind] = useState<{ readonly open: boolean; readonly focus: number }>({ open: false, focus: 0 })
  const openFind = useCallback(() => { setFind(current => ({ open: true, focus: current.focus + 1 })) }, [])
  const closeFind = useCallback(() => {
    setFind(current => ({ ...current, open: false }))
    frameRef.current?.querySelector<HTMLElement>('[data-chat-flow]')?.focus({ preventScroll: true })
  }, [])
  useEffect(() => { setFind(current => (current.open ? { ...current, open: false } : current)) }, [sessionId])
  // The sheet mounts the first time it opens (and stays, for its closing animation): a closed sheet costs nothing.
  const [turnsSheet, setTurnsSheet] = useState<'unmounted' | 'open' | 'closed'>('unmounted')
  const openTurns = useCallback(() => { setTurnsSheet('open') }, [])
  const setTurnsOpen = useCallback((open: boolean) => { setTurnsSheet(open ? 'open' : 'closed') }, [])
  useEffect(() => { setTurnsSheet('unmounted') }, [sessionId])
  // The thread `⋯` menu (and ⌘F / [ / ] through the registry) reach this view.
  const stepRef = useRef(stepTurn)
  stepRef.current = stepTurn
  useEffect(() => {
    const unregister = ChatViewRegistry.register({
      sessionId,
      root: () => frameRef.current,
      openFind,
      findFocused: () => frameRef.current?.querySelector('[data-thread-find]')?.contains(document.activeElement) === true,
      stepTurn: direction => stepRef.current(direction),
      openTurns,
    })
    const take = (): void => {
      const tool = ThreadToolsModel.take(sessionId)
      if (tool === 'find') openFind()
      else if (tool === 'turns') openTurns()
    }
    take()
    const stop = ThreadToolsModel.listen(sessionId, take)
    return () => {
      stop()
      unregister()
    }
  }, [sessionId, openFind, openTurns])

  // Since you left: the unread record the opening surface handed over before clearing it.
  const [sinceNote, setSinceNote] = useState<SinceYouLeftNote | null>(null)
  useLayoutEffect(() => {
    setSinceNote(SinceYouLeftModel.take(sessionId))
    return SinceYouLeftModel.listen(sessionId, () => {
      const note = SinceYouLeftModel.take(sessionId)
      if (note !== null) setSinceNote(note)
    })
  }, [sessionId])
  const recap = useMemo(() => (sinceNote === null ? null : SinceYouLeftRecapModel.recap(railItems, sinceNote)), [sinceNote, railItems])
  const dismissSince = useCallback(() => { setSinceNote(null) }, [])
  const entryTurn = useCallback((entry: RenderEntry): number | undefined => {
    const key = entry.kind === 'node' ? entry.key : groupMembers(entry.key)[0]
    const location = key === undefined ? undefined : nodeStore.get(key as NodeKey)?.location
    return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.turn : undefined
  }, [groupMembers, nodeStore])
  const sincePlacement = useMemo<SinceYouLeftPlacement | null>(() => {
    if (recap === null) return null
    const before = transcript.entries.find(entry => (entryTurn(entry) ?? -1) >= recap.firstTurn)
    if (before === undefined) return null
    // Opening at the final answer (the default): the recap sits right above that answer, the landing position, when the
    // latest Turn ended with one; a failed or questioning Turn keeps it above the first unseen Turn.
    const latest = railItems.at(-1)
    const atAnswer = unreadLanding === 'final-answer' && !running && latest !== undefined && latest.kind !== 'failed' && latest.kind !== 'question'
    return {
      beforeKey: chatRenderKey(before),
      element: <SinceYouLeftCard recap={recap} onJump={jumpToTurn} onDismiss={dismissSince} t={t} />,
      ...(atAnswer ? { answerTurn: latest.turn } : {}),
    }
  }, [recap, transcript.entries, entryTurn, jumpToTurn, dismissSince, t, railItems, unreadLanding, running])

  return (
    <div ref={frameRef} className={css.frame}>
      <AnnotateSelection sessionId={sessionId} containerRef={scroll.listRef} t={t} />
      {scroll.initialized && (
        <TurnNavigator
          items={shownRailItems}
          activeTurn={scroll.activeTurn}
          busyTurn={scroll.busyTurn}
          onNavigate={scroll.navigateToTurn}
          t={t}
          filter={turnFilter}
          filterCounts={filterCounts}
          onFilterChange={setTurnFilter}
          inView={inView}
          onStep={stepTurn}
        />
      )}
      {find.open && (
        <ThreadFindBar
          sessionId={sessionId}
          focusRequest={find.focus}
          onClose={closeFind}
          list={listElement}
          anchors={railItems}
          rowFor={rowFor}
          revealTurn={jumpToTurn}
          readerSeq={readerSeq}
          t={t}
        />
      )}
      {turnsSheet !== 'unmounted' && <TurnsSheet
        open={turnsSheet === 'open'}
        onOpenChange={setTurnsOpen}
        items={railItems}
        activeTurn={scroll.activeTurn}
        filter={turnFilter}
        counts={filterCounts}
        onFilterChange={setTurnFilter}
        onNavigate={item => { jumpToTurn(item.turn) }}
        t={t}
      />}
      <div className={css.root} data-chat-following-tail={scroll.followingTail ? '' : undefined}>
        <div ref={scroll.listRef} className={css.scroll}>
          <div ref={scroll.columnRef} className={css.column} data-chat-flow=""
            data-chat-motion={deferCompletedTurns && scroll.initialized
              && (running || motionTail !== 'off' || pendingInputs.length > 0) ? '' : undefined}>
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
            <MarkdownDelegateProvider
              getTriggerProps={getMarkdownTriggerProps}
              openFile={requestOpenImageAwareFile}
              openExternalLink={requestOpenMarkdownExternalLink}
              fileImages={fileImages}
            >
              <InlineReferenceScope sessionId={sessionId} cwd={cwd}>
              <ConversationViewOpenerContext.Provider value={openView}>
              <SinceYouLeftContext.Provider value={sincePlacement}>
                {renderSlot('conversation.chat.flow', {
                  entries: transcript.entries, pendingInputs, lastInputTurn, deferCollapse,
                  cwd, openFile: requestOpenImageAwareFile, inspectCall, forkAt, loadImage, useProjection,
                }, { hookContext: flowContext })}
              </SinceYouLeftContext.Provider>
              </ConversationViewOpenerContext.Provider>
              </InlineReferenceScope>
            </MarkdownDelegateProvider>
            <div ref={interactionSurfaceRef} className={css.textInteraction} data-text-interaction-surface=""
              aria-hidden={textInteraction.active === null}>
              {textInteraction.active !== null && renderSlot('conversation.chat.text-interaction', {
                trigger: textInteraction.active.trigger, readText: textInteraction.readText,
                dismiss: textInteraction.dismiss, clearSelection: textInteraction.clearSelection,
              }, { entryKey: textInteraction.active.id })}
            </div>
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
            <ChevronDownIcon size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}
      {imagePreview.status === 'open' && (
        <ImageLightbox images={imagePreview.images} initialIndex={imagePreview.initialIndex} labels={imageLightboxLabels} onClose={closeImagePreview} />
      )}
      {fileOpenFailure !== null && (
        <FileOpenErrorDialog
          message={fileOpenFailure.message}
          busy={fileOpenFailure.busy}
          onClose={closeFileOpenError}
          onRetry={() => { retryFileOpen({ path: fileOpenFailure.path, refusal: fileOpenFailure.message }) }}
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
    // First read in an observer callback, where layout is current; reading at mount would force the new rows' layout.
    let lastTop: number | null = null
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
      lastTop ??= list.scrollTop
      take()
    }, { root: list, rootMargin: '1200px 0px 0px 0px' })
    // Reading upward also counts when the rows cannot scroll yet: a wheel or key toward older rows.
    const onScroll = (): void => {
      const top = list.scrollTop
      if (lastTop !== null && top < lastTop) upward = true
      lastTop = top
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
