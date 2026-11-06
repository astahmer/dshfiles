import { createContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { ConversationViewRequest } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { assign, createActor, fromCallback, setup } from '@dshfiles/plugin-ui/machine'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { ChatFocusModel, type ChatFocus, type ChatTurnTailExtras } from './chat-focus.ts'
import type { TurnRailItem } from './native/chat/turn-rail-items.ts'

const focusEventDetailSchema = Schema.Struct({ sessionId: Schema.String })

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

/** Where a focus request lands, and the opener that pages unloaded history in. */
export interface ChatFocusRevealPorts {
  /** @returns the transcript list, or null while the view is detached. */
  list: () => HTMLElement | null
  /** Jump the request's Turn into the page through rail navigation. */
  navigate: (focus: ChatFocus) => void
}

interface RevealTiming {
  /** How long the frame clock retries before landing on the Turn row instead. */
  readonly retryMs: number
  /** How long the landed row keeps its highlight. */
  readonly highlightMs: number
}

interface RevealActorInput extends RevealTiming {
  readonly list: HTMLElement | null
  readonly focus: ChatFocus | null
}

const revealActor = fromCallback<{ type: 'landed'; target: HTMLElement } | { type: 'missed' }, RevealActorInput>(({ input, sendBack }) => {
  const { list, focus } = input
  if (list === null || focus === null) {
    sendBack({ type: 'missed' })
    return
  }
  const deadline = performance.now() + input.retryMs
  const revealed = new WeakSet<Element>()
  let frame = 0
  const reveal = (element: Element): void => {
    if (revealed.has(element)) return
    revealed.add(element)
    element.dispatchEvent(new Event('beforematch'))
  }
  const tick = (): void => {
    const turnRows = [...list.querySelectorAll<HTMLElement>(turnSelector(focus.turn))]
    const target = targetOf(list, focus)
    const hidden = target === null ? null : hiddenAncestor(target)
    if (target !== null && hidden === null) {
      sendBack({ type: 'landed', target })
      return
    }
    if (performance.now() > deadline) {
      const fallback = turnRows.find(row => hiddenAncestor(row) === null)
      sendBack(fallback === undefined ? { type: 'missed' } : { type: 'landed', target: fallback })
      return
    }
    if (hidden !== null) reveal(hidden)
    else if (focus.step !== undefined || focus.toolCallId !== undefined) {
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
  }
})

interface ChatFocusRevealContext extends RevealTiming {
  readonly ports: ChatFocusRevealPorts
  readonly ready: boolean
  readonly focus: ChatFocus | null
  readonly landed: HTMLElement | null
}

type ChatFocusRevealEvent =
  | { readonly type: 'request'; readonly focus: ChatFocus }
  | { readonly type: 'ready'; readonly ready: boolean }
  | { readonly type: 'cancel' }
  | { readonly type: 'landed'; readonly target: HTMLElement }
  | { readonly type: 'missed' }

interface ChatFocusRevealInput extends RevealTiming {
  readonly ports: ChatFocusRevealPorts
  readonly ready: boolean
}

/**
 * One focus request: wait for the Chat view to be ready, navigate to its Turn, retry the reveal each
 * frame until the row mounts, then keep the highlight for a bounded time. The machine owns the frame
 * clock, the highlight timer and the attribute, so a cancelled or superseded request cannot land.
 * @param timing - retry deadline and highlight duration.
 * @returns the machine that serves every request addressed to one Chat view.
 */
// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const createChatFocusRevealMachine = (timing: RevealTiming) =>
  setup({
    types: {
      context: {} as ChatFocusRevealContext,
      events: {} as ChatFocusRevealEvent,
      input: {} as ChatFocusRevealInput,
    },
    actors: { reveal: revealActor },
    actions: {
      highlight: ({ context }) => {
        const target = context.landed
        if (target === null) return
        target.scrollIntoView({ block: 'center' })
        target.setAttribute(CHAT_FOCUS_ATTRIBUTE, '')
      },
      clearHighlight: ({ context }) => {
        context.landed?.removeAttribute(CHAT_FOCUS_ATTRIBUTE)
      },
    },
  }).createMachine({
    id: 'chat-focus-reveal',
    initial: 'idle',
    context: ({ input }) => ({
      ports: input.ports,
      retryMs: input.retryMs,
      highlightMs: input.highlightMs,
      ready: input.ready,
      focus: null,
      landed: null,
    }),
    states: {
      idle: {
        on: {
          request: [
            { guard: ({ context }) => context.ready, target: 'revealing', actions: assign({ focus: ({ event }) => event.focus }) },
            { target: 'pending', actions: assign({ focus: ({ event }) => event.focus }) },
          ],
          ready: { actions: assign({ ready: ({ event }) => event.ready }) },
          cancel: { actions: assign({ focus: null, landed: null }) },
        },
      },
      pending: {
        on: {
          ready: { guard: ({ event }) => event.ready, target: 'revealing', actions: assign({ ready: true }) },
          request: { actions: assign({ focus: ({ event }) => event.focus }) },
          cancel: { target: 'idle', actions: assign({ focus: null }) },
        },
      },
      revealing: {
        entry: ({ context }) => {
          if (context.focus !== null) context.ports.navigate(context.focus)
        },
        invoke: {
          src: 'reveal',
          input: ({ context }) => ({
            retryMs: context.retryMs,
            highlightMs: context.highlightMs,
            list: context.ports.list(),
            focus: context.focus,
          }),
        },
        on: {
          landed: { target: 'highlighted', actions: assign({ landed: ({ event }) => event.target }) },
          missed: { target: 'idle', actions: assign({ focus: null }) },
          cancel: { target: 'idle', actions: assign({ focus: null }) },
          request: { target: 'revealing', reenter: true, actions: assign({ focus: ({ event }) => event.focus }) },
        },
      },
      highlighted: {
        entry: 'highlight',
        exit: 'clearHighlight',
        after: { [timing.highlightMs]: 'cleared' },
        on: {
          cancel: { target: 'cleared' },
          request: { target: 'revealing', actions: assign({ focus: ({ event }) => event.focus }) },
        },
      },
      cleared: {
        entry: assign({ focus: null, landed: null }),
        always: 'idle',
      },
    },
  })

const chatFocusRevealMachine = createChatFocusRevealMachine({ retryMs: REVEAL_TIMEOUT_MS, highlightMs: HIGHLIGHT_MS })

/**
 * Scroll one Turn, Step or tool call into view and highlight it, revealing the folded process groups on the way.
 * A folded group is opened with the `beforematch` event browser find uses (`useSearchableHidden`): the group's own
 * reveal runs and mounts its rows. Retries each frame until the row exists (an unloaded Turn arrives after the jump's
 * page loads) or the timeout lands on the Turn row instead.
 * @returns a cancel function that stops retrying and clears the highlight.
 */
export const revealChatFocus = (input: { readonly list: HTMLElement; readonly focus: ChatFocus }): (() => void) => {
  const actor = createActor(chatFocusRevealMachine, {
    input: {
      ready: true,
      retryMs: REVEAL_TIMEOUT_MS,
      highlightMs: HIGHLIGHT_MS,
      ports: { list: () => input.list, navigate: () => {} },
    },
  })
  actor.start()
  actor.send({ type: 'request', focus: input.focus })
  return () => {
    actor.send({ type: 'cancel' })
    actor.stop()
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
  const { viewRequest, completeViewRequest, sessionId, ready, railItems, navigateToTurn, listRef } = input
  const ports = useRef<ChatFocusRevealPorts>({ list: () => null, navigate: () => {} })
  const [reveal] = useState(() =>
    createActor(chatFocusRevealMachine, {
      input: { ready: false, retryMs: REVEAL_TIMEOUT_MS, highlightMs: HIGHLIGHT_MS, ports: ports.current },
    }),
  )
  useLayoutEffect(() => {
    ports.current.list = () => listRef.current
    ports.current.navigate = (focus: ChatFocus) => {
      const item = railItems.find(candidate => candidate.turn === focus.turn)
      if (item !== undefined) navigateToTurn(item)
    }
  })
  useEffect(
    () => () => {
      reveal.send({ type: 'cancel' })
    },
    [reveal, sessionId],
  )
  useEffect(() => {
    reveal.start()
    return () => {
      reveal.stop()
    }
  }, [reveal])
  useEffect(() => {
    reveal.send({ type: 'ready', ready })
  }, [reveal, ready])
  useEffect(() => {
    if (viewRequest === null || viewRequest.view !== ChatFocusModel.viewId) return
    const decoded = ChatFocusModel.decode(viewRequest.focus)
    completeViewRequest()
    if (decoded !== null) reveal.send({ type: 'request', focus: decoded })
  }, [viewRequest, completeViewRequest, reveal])
  useEffect(() => {
    const take = (): void => {
      const pending = ChatFocusModel.take(sessionId)
      if (pending !== null) reveal.send({ type: 'request', focus: pending })
    }
    take()
    const onRequest = (event: Event): void => {
      const detail = Schema.decodeUnknownOption(focusEventDetailSchema)(event instanceof CustomEvent ? event.detail : undefined)
      if (Option.isSome(detail) && detail.value.sessionId === sessionId) take()
    }
    window.addEventListener(ChatFocusModel.event, onRequest)
    return () => window.removeEventListener(ChatFocusModel.event, onRequest)
  }, [sessionId, reveal])
}
