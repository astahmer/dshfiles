import { createContext, useEffect, useRef, useState, type RefObject } from 'react'
import type { ConversationViewRequest } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { z } from 'zod/mini'
import { ChatFocusModel, type ChatFocus, type ChatTurnTailExtras } from './chat-focus.ts'
import type { TurnRailItem } from './native/chat/turn-rail-items.ts'

const focusEventDetailSchema = z.object({ sessionId: z.string() })

const REVEAL_TIMEOUT_MS = 4_000
const HIGHLIGHT_MS = 4_000

/** Marks the row a focus landed on; ChatView.module.css outlines it until the attribute is removed. Tool rows carry the native `data-chat-call-id`. */
export const CHAT_FOCUS_ATTRIBUTE = 'data-chat-focus'

/** The thread's native Conversation View opener, handed by ChatView to the Turn-tail seats it renders. */
export const ConversationViewOpenerContext = createContext<ChatTurnTailExtras['openView']>(undefined)

const turnSelector = (turn: number): string => `[data-chat-turn="${String(turn)}"]`

const targetOf = (list: HTMLElement, focus: ChatFocus): HTMLElement | null => {
  if (focus.toolCallId !== undefined) {
    return [...list.querySelectorAll<HTMLElement>('[data-chat-call-id]')].find(row => row.dataset.chatCallId === focus.toolCallId) ?? null
  }
  if (focus.step !== undefined) return list.querySelector<HTMLElement>(`${turnSelector(focus.turn)}[data-chat-step="${String(focus.step)}"]`)
  return list.querySelector<HTMLElement>(turnSelector(focus.turn))
}

const hiddenAncestor = (element: HTMLElement): HTMLElement | null => element.closest<HTMLElement>('[hidden]')

/**
 * Scroll one Turn, Step or tool call into view and highlight it, revealing the folded process groups on the way.
 * A folded group is opened with the `beforematch` event browser find uses (`useSearchableHidden`): the group's own
 * reveal runs and mounts its rows. Retries each frame until the row exists (an unloaded Turn arrives after the jump's
 * page loads) or the timeout lands on the Turn row instead.
 * @returns a cancel function that stops retrying and clears the highlight.
 */
export const revealChatFocus = (input: { readonly list: HTMLElement; readonly focus: ChatFocus }): (() => void) => {
  const deadline = performance.now() + REVEAL_TIMEOUT_MS
  const revealed = new WeakSet<Element>()
  let frame = 0
  let highlightTimer: ReturnType<typeof setTimeout> | undefined
  let highlighted: HTMLElement | null = null

  const reveal = (element: Element): void => {
    if (revealed.has(element)) return
    revealed.add(element)
    element.dispatchEvent(new Event('beforematch'))
  }

  const land = (target: HTMLElement): void => {
    target.scrollIntoView({ block: 'center' })
    target.setAttribute(CHAT_FOCUS_ATTRIBUTE, '')
    highlighted = target
    highlightTimer = setTimeout(() => target.removeAttribute(CHAT_FOCUS_ATTRIBUTE), HIGHLIGHT_MS)
  }

  const tick = (): void => {
    const list = input.list
    const turnRows = [...list.querySelectorAll<HTMLElement>(turnSelector(input.focus.turn))]
    const target = targetOf(list, input.focus)
    const hidden = target === null ? null : hiddenAncestor(target)
    if (target !== null && hidden === null) return land(target)
    if (performance.now() > deadline) {
      const fallback = turnRows.find(row => hiddenAncestor(row) === null)
      if (fallback !== undefined) land(fallback)
      return
    }
    if (hidden !== null) reveal(hidden)
    else if (input.focus.step !== undefined || input.focus.toolCallId !== undefined) {
      for (const row of turnRows) {
        if (row.hasAttribute('hidden')) reveal(row)
        for (const folded of row.querySelectorAll('[hidden]')) reveal(folded)
      }
    }
    frame = requestAnimationFrame(tick)
  }

  frame = requestAnimationFrame(tick)
  return () => {
    cancelAnimationFrame(frame)
    clearTimeout(highlightTimer)
    highlighted?.removeAttribute(CHAT_FOCUS_ATTRIBUTE)
  }
}

/**
 * Take focus requests addressed to this thread's Chat view, from the native `viewRequest` or the cross-thread
 * pending request, then jump to the Turn through the rail's navigation (which pages unloaded history in) and reveal.
 */
export const useChatFocus = (input: {
  readonly sessionId: string
  readonly viewRequest: ConversationViewRequest | null
  readonly completeViewRequest: () => void
  readonly ready: boolean
  readonly railItems: readonly TurnRailItem[]
  readonly navigateToTurn: (item: TurnRailItem) => void
  readonly listRef: RefObject<HTMLDivElement>
}): void => {
  const [focus, setFocus] = useState<ChatFocus | null>(null)
  const cancelReveal = useRef<(() => void) | null>(null)
  const { viewRequest, completeViewRequest, sessionId, ready, railItems, navigateToTurn, listRef } = input

  useEffect(() => {
    if (viewRequest === null || viewRequest.view !== ChatFocusModel.viewId) return
    const decoded = ChatFocusModel.decode(viewRequest.focus)
    completeViewRequest()
    if (decoded !== null) setFocus(decoded)
  }, [viewRequest, completeViewRequest])

  useEffect(() => {
    const take = (): void => {
      const pending = ChatFocusModel.take(sessionId)
      if (pending !== null) setFocus(pending)
    }
    take()
    const onRequest = (event: Event): void => {
      const detail = focusEventDetailSchema.safeParse(event instanceof CustomEvent ? event.detail : undefined)
      if (detail.success && detail.data.sessionId === sessionId) take()
    }
    window.addEventListener(ChatFocusModel.event, onRequest)
    return () => window.removeEventListener(ChatFocusModel.event, onRequest)
  }, [sessionId])

  useEffect(() => () => cancelReveal.current?.(), [sessionId])

  useEffect(() => {
    const list = listRef.current
    if (focus === null || !ready || list === null) return
    setFocus(null)
    const item = railItems.find(candidate => candidate.turn === focus.turn)
    if (item !== undefined) navigateToTurn(item)
    cancelReveal.current?.()
    cancelReveal.current = revealChatFocus({ list, focus })
  }, [focus, ready, railItems, navigateToTurn, listRef])
}
