/** Composes viewport operations, reading policy, and history navigation for Chat. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import type { TranscriptViewMode, UnreadLanding } from '../../chat-settings.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { useChatNavigation, type ChatNavigation, type ChatNavigationInput } from './use-chat-navigation.ts'
import { useChatReading, type ChatReadingState } from './use-chat-reading.ts'
import { useChatViewport } from './use-chat-viewport.ts'
import type { FlowMotionRows } from './flow-motion.ts'

/** Committed content and Session operations used to reconcile scroll ownership. */
export interface ChatScrollInput extends ChatNavigationInput {
  readonly chatScroll: ChatViewSlotProps['chatScroll']
  readonly ready: boolean
  readonly order: readonly string[]
  readonly lastKey: string | null
  readonly lastIsUser: boolean
  readonly steeringId: string | null
  readonly submissionId: string | null
  readonly running: boolean
  /** Enable the browser-local delayed-fold experiment and its input reveal animation. */
  readonly deferCompletedTurns: boolean
  /** A changed work-details preference resets fold reservations after the layout settles. */
  readonly transcriptView: TranscriptViewMode
  readonly loadedTurns: ReturnType<ChatSnapshot['navigation']['items']>
  /** Opening at an unseen final answer, and the divider marking it. */
  readonly unread: {
    readonly landing: UnreadLanding
    readonly seenAnswer: ChatViewSlotProps['seenAnswer']
    readonly label: string
  }
}

interface ChatScrollState extends ChatReadingState {
  readonly listRef: RefObject<HTMLDivElement>
  readonly columnRef: RefObject<HTMLDivElement>
  readonly busyTurn: number | null
  readonly navigateToTurn: ChatNavigation['navigateToTurn']
  readonly loadEarlier: ChatNavigation['loadEarlier']
  readonly returnToBottom: () => void
  readonly motion: FlowMotionRows
}

/**
 * Coordinate scroll policy after Chat content commits. Initial history must be ready
 * before automatic scroll or resize handling can initialize reading state and fold motion.
 * New submitted input supersedes pending reader sampling.
 * @param input - current Chat content, scroll memory, and history operations.
 * @returns element refs, visible reading state, and navigation callbacks.
 */
export function useChatScroll(input: ChatScrollInput): ChatScrollState {
  const {
    ready, order, firstSeq, lastKey, lastIsUser, steeringId, submissionId, running, deferCompletedTurns,
    loadedTurns, chatScroll, hasMore, loadingOlder, loadOlder, loadThrough, transcriptView, unread,
  } = input
  const { viewport, listRef, columnRef } = useChatViewport()
  const { reading, state } = useChatReading(viewport, chatScroll, loadedTurns.at(-1)?.turn ?? null)
  const navigationInput = useMemo(() => ({
    firstSeq, loadingOlder, hasMore, loadOlder, loadThrough,
  }), [firstSeq, loadingOlder, hasMore, loadOlder, loadThrough])
  const { navigation, busyTurn } = useChatNavigation(viewport, reading, navigationInput)
  const content = useRef<{ input: ChatScrollInput; applied: ChatScrollInput | null; opened: boolean; layoutChanged: boolean }>({
    input, applied: null, opened: false, layoutChanged: false,
  })
  // A fold batch owns layout and scrolling until it lands: at the tail for own input or a following
  // reader, otherwise with the reader's content still. Growth consumes any room the landing installed.
  const cancelPendingFollow = useCallback(() => { viewport.motion.cancelInput() }, [viewport])

  // Without a saved reading position, a settled thread whose final answer this browser never reached opens at it.
  const landAtUnreadAnswer = useCallback((current: ChatScrollInput): boolean => {
    if (current.unread.landing !== 'final-answer' || current.running || current.chatScroll.read() !== null) return false
    const answer = viewport.latestFinalAnswer()
    if (answer === null || answer.anchorKey === current.unread.seenAnswer.read()) return false
    const landing = viewport.landAtUnread(answer.row, current.unread.label)
    if (landing === null) return false
    reading.acceptNavigation(landing)
    return true
  }, [viewport, reading])

  const processContent = useCallback(() => {
    const current = content.current.input
    if (!current.ready && !content.current.opened) return
    const previous = content.current.applied
    const ownInput = (current.lastIsUser && current.lastKey !== previous?.lastKey)
      || (current.steeringId !== null && current.steeringId !== previous?.steeringId
        && current.steeringId !== previous?.submissionId)
      || (current.submissionId !== null && current.submissionId !== previous?.submissionId
        && current.submissionId !== previous?.steeringId)
    if (reading.pending && !ownInput) return
    content.current.applied = current
    if (current.ready && !content.current.opened) {
      content.current.opened = true
      navigation.reset()
      if (!landAtUnreadAnswer(current)) reading.restore()
      return
    }
    if (ownInput) {
      viewport.clearUnread()
      navigation.cancel()
      if (current.deferCompletedTurns && reading.followInputFold()) return
      reading.followTail(current.deferCompletedTurns ? 'smooth' : 'instant')
      return
    }
    if (navigation.contentCommitted()) {
      navigation.reconcile()
      return
    }
    const tipChanged = previous === null || current.ready !== previous.ready
      || current.firstSeq !== previous.firstSeq || current.lastKey !== previous.lastKey
      || current.order.length !== previous.order.length || current.running !== previous.running
      || current.steeringId !== previous.steeringId || current.submissionId !== previous.submissionId
    if (tipChanged && reading.followingTail) {
      navigation.cancel()
      if (current.deferCompletedTurns && reading.followInputFold()) return
      reading.followTail()
    } else navigation.reconcile()
  }, [reading, navigation, viewport, landAtUnreadAnswer])

  // Reaching the end of a settled thread is reading its answer.
  const seenAnswer = unread.seenAnswer
  useEffect(() => {
    if (!state.initialized || !state.followingTail || running) return
    const answer = viewport.latestFinalAnswer()
    if (answer !== null) seenAnswer.markSeen(answer.anchorKey)
  }, [state.initialized, state.followingTail, running, lastKey, viewport, seenAnswer])

  useLayoutEffect(() => {
    const disconnectViewport = viewport.connect({
      scroll: (event) => {
        if (!content.current.opened) return
        if (!event.movedByReader && viewport.motion.foldActive()) return
        reading.onScroll(event)
      },
      scrollEnd: (outer) => {
        reading.onScrollEnd(outer)
        navigation.readerSettled()
      },
      interact: () => { navigation.cancel() },
      intent: () => { cancelPendingFollow(); reading.interruptFollow() },
      resize: () => {
        if (!content.current.opened) return
        if (navigation.contentCommitted()) {
          navigation.reconcile()
          return
        }
        if (!content.current.input.deferCompletedTurns || !viewport.motion.foldActive()) reading.onResize()
        navigation.reconcile()
      },
    })
    const disconnectReading = reading.connect((sample) => {
      navigation.readerSampled(sample)
      processContent()
    })
    return () => {
      disconnectViewport()
      disconnectReading()
      content.current.opened = false
      content.current.applied = null
    }
  }, [viewport, reading, navigation, processContent, cancelPendingFollow])

  useLayoutEffect(() => {
    const previous = content.current.input
    content.current.input = {
      ready, order, lastKey, lastIsUser, steeringId, submissionId, running, loadedTurns, chatScroll,
      deferCompletedTurns, transcriptView, unread, ...navigationInput,
    }
    if (!deferCompletedTurns) {
      cancelPendingFollow()
      reading.interruptFollow()
    }
    viewport.updateTurns(loadedTurns)
    const layoutChanged = previous.order !== order || previous.ready !== ready
    if (layoutChanged) viewport.invalidate()
    content.current.layoutChanged ||= layoutChanged
    // Measuring here would force the layout the commit just invalidated, once per streamed publication.
    viewport.afterLayout(() => {
      const changed = content.current.layoutChanged
      content.current.layoutChanged = false
      viewport.reclaimBelow()
      processContent()
      if (changed && content.current.opened) reading.refreshActiveTurn()
    })
  }, [
    viewport, reading, processContent, navigationInput, ready, order, lastKey, lastIsUser,
    steeringId, submissionId, running, loadedTurns, chatScroll, deferCompletedTurns, transcriptView, cancelPendingFollow, unread,
  ])

  const previousView = useRef(transcriptView)
  useLayoutEffect(() => {
    if (previousView.current === transcriptView) return
    previousView.current = transcriptView
    cancelPendingFollow()
    reading.interruptFollow()
    return viewport.motion.onFoldIdle(() => {
      viewport.resetBelow()
      if (content.current.opened) reading.onResize()
    })
  }, [transcriptView, viewport, reading, cancelPendingFollow])

  const returnToBottom = useCallback(() => {
    cancelPendingFollow()
    navigation.cancel()
    reading.followTail()
  }, [navigation, reading, cancelPendingFollow])

  return {
    listRef, columnRef, ...state, busyTurn, motion: viewport.motion,
    navigateToTurn: navigation.navigateToTurn,
    loadEarlier: navigation.loadEarlier,
    returnToBottom,
  }
}
