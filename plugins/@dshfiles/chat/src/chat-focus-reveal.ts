import { createContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { ConversationViewRequest } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { assign, createActor, fromCallback, setup } from '@dshfiles/plugin-ui/machine'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { ChatFocusModel, type ChatFocus, type ChatFocusTarget, type ChatMessageFocus, type ChatTurnTailExtras } from './chat-focus.ts'
import { CHAT_FOCUS_ATTRIBUTE, clearFindHighlight, revealFindHit, type FindRevealOutcome, type FindRevealTarget } from './native/chat/find-reveal.ts'
import { ThreadFindModel } from './native/chat/thread-find-model.ts'
import type { TurnRailItem } from './native/chat/turn-rail-items.ts'

export { CHAT_FOCUS_ATTRIBUTE }

const focusEventDetailSchema = Schema.Struct({ sessionId: Schema.String })

const REVEAL_TIMEOUT_MS = 4_000
const HIGHLIGHT_MS = 4_000

/** The thread's native Conversation View opener, handed by ChatView to the Turn-tail seats it renders. */
export const ConversationViewOpenerContext = createContext<ChatTurnTailExtras['openView']>(undefined)

const isMessageFocus = (focus: ChatFocusTarget): focus is ChatMessageFocus => 'seq' in focus

const turnSelector = (turn: number): string => `[data-chat-turn="${String(turn)}"]`

const turnTargetOf = (list: HTMLElement, focus: ChatFocus): HTMLElement | null => {
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
  navigate: (focus: ChatFocusTarget) => void
  /** Map a message-sequence focus to its Turn number once rail anchors are loaded. */
  resolveTurn?: (focus: ChatMessageFocus) => number | null
  /** Map a message-sequence focus to its rendered row key once the Turn's Nodes are loaded. */
  resolveRow?: (focus: ChatMessageFocus, turn: number | null) => string | null
}

interface RevealTiming {
  /** How long the frame clock retries before landing on the Turn row instead. */
  readonly retryMs: number
  /** How long the landed row keeps its highlight. */
  readonly highlightMs: number
}

interface RevealActorInput extends RevealTiming {
  readonly ports: ChatFocusRevealPorts
  readonly focus: ChatFocusTarget | null
}

/** A row the reveal landed on; `centered` when the find reveal already scrolled it, `text` when it set a text highlight. */
type RevealLanding = { readonly type: 'landed'; readonly target: HTMLElement; readonly centered?: boolean; readonly text?: boolean }
type RevealOutcome = RevealLanding | { readonly type: 'missed' }

const landingOf = (outcome: FindRevealOutcome): RevealOutcome => {
  if (outcome.kind === 'missed') return { type: 'missed' }
  if (outcome.kind === 'row') return { type: 'landed', target: outcome.element, centered: true }
  const textParent = outcome.range.startContainer.parentElement
  const row = textParent?.closest<HTMLElement>('[data-chat-node-key]') ?? textParent
  return row === null || row === undefined ? { type: 'missed' } : { type: 'landed', target: row, centered: true, text: true }
}

/**
 * A message focus waits for the rail to place its sequence in a Turn (a cold thread's outline arrives after the view
 * mounts), pages that Turn in, then hands the row to the find reveal: it opens "Worked for…" process rows, folded
 * groups, long prompts and closed tool rows, and highlights the matched words when the focus carries a query.
 */
const revealMessage = (input: {
  readonly ports: ChatFocusRevealPorts
  readonly focus: ChatMessageFocus
  readonly waitMs: number
  readonly sendBack: (outcome: RevealOutcome) => void
}): (() => void) => {
  const { ports, focus } = input
  const deadline = performance.now() + input.waitMs
  let frame = 0
  let cancelFind: (() => void) | null = null
  const tick = (): void => {
    const list = ports.list()
    const turn = list === null ? null : (ports.resolveTurn?.(focus) ?? null)
    if (list === null || turn === null) {
      if (performance.now() > deadline) input.sendBack({ type: 'missed' })
      else frame = requestAnimationFrame(tick)
      return
    }
    ports.navigate(focus)
    const base: FindRevealTarget = {
      list: ports.list,
      turn,
      row: () => ports.resolveRow?.(focus, turn) ?? null,
      terms: focus.query === undefined ? [] : ThreadFindModel.terms(focus.query),
    }
    const prefer = ThreadFindModel.rowKindOf(focus.type)
    const target: FindRevealTarget = prefer === undefined ? base : { ...base, prefer }
    cancelFind = revealFindHit(target, outcome => input.sendBack(landingOf(outcome)))
  }
  frame = requestAnimationFrame(tick)
  return () => {
    cancelAnimationFrame(frame)
    cancelFind?.()
  }
}

const revealActor = fromCallback<RevealOutcome, RevealActorInput>(({ input, sendBack }) => {
  const { ports, focus } = input
  if (focus === null) {
    sendBack({ type: 'missed' })
    return
  }
  if (isMessageFocus(focus)) return revealMessage({ ports, focus, waitMs: input.retryMs, sendBack })
  const deadline = performance.now() + input.retryMs
  const revealed = new WeakSet<Element>()
  let frame = 0
  const reveal = (element: Element): void => {
    if (revealed.has(element)) return
    revealed.add(element)
    element.dispatchEvent(new Event('beforematch'))
  }
  const tick = (): void => {
    const list = ports.list()
    if (list === null) {
      if (performance.now() > deadline) {
        sendBack({ type: 'missed' })
        return
      }
      frame = requestAnimationFrame(tick)
      return
    }
    const turnRows = [...list.querySelectorAll<HTMLElement>(turnSelector(focus.turn))]
    const target = turnTargetOf(list, focus)
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
  readonly focus: ChatFocusTarget | null
  readonly landed: RevealLanding | null
}

type ChatFocusRevealEvent =
  | { readonly type: 'request'; readonly focus: ChatFocusTarget }
  | { readonly type: 'ready'; readonly ready: boolean }
  | { readonly type: 'cancel' }
  | RevealOutcome

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
        const landed = context.landed
        if (landed === null) return
        if (landed.centered !== true) landed.target.scrollIntoView({ block: 'center' })
        landed.target.setAttribute(CHAT_FOCUS_ATTRIBUTE, '')
      },
      clearHighlight: ({ context }) => {
        context.landed?.target.removeAttribute(CHAT_FOCUS_ATTRIBUTE)
        if (context.landed?.text === true) clearFindHighlight()
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
          if (context.focus !== null && !isMessageFocus(context.focus)) context.ports.navigate(context.focus)
        },
        invoke: {
          src: 'reveal',
          input: ({ context }) => ({
            retryMs: context.retryMs,
            highlightMs: context.highlightMs,
            ports: context.ports,
            focus: context.focus,
          }),
        },
        on: {
          landed: { target: 'highlighted', actions: assign({ landed: ({ event }) => event }) },
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
export const revealChatFocus = (input: {
  readonly list: HTMLElement
  readonly focus: ChatFocusTarget
  readonly resolveTurn?: (focus: ChatMessageFocus) => number | null
  readonly resolveRow?: (focus: ChatMessageFocus, turn: number | null) => string | null
  readonly navigate?: (focus: ChatFocusTarget) => void
}): (() => void) => {
  const ports: ChatFocusRevealPorts = {
    list: () => input.list,
    navigate: input.navigate ?? (() => {}),
  }
  if (input.resolveTurn !== undefined) ports.resolveTurn = input.resolveTurn
  if (input.resolveRow !== undefined) ports.resolveRow = input.resolveRow
  const actor = createActor(chatFocusRevealMachine, {
    input: {
      ready: true,
      retryMs: REVEAL_TIMEOUT_MS,
      highlightMs: HIGHLIGHT_MS,
      ports,
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
  readonly jumpToTurn?: (turn: number) => void
  readonly rowFor?: (turn: number, seq: number, type: string | undefined) => string | null
  readonly listRef: RefObject<HTMLDivElement>
}): void => {
  const { viewRequest, completeViewRequest, sessionId, ready, railItems, navigateToTurn, jumpToTurn, rowFor, listRef } = input
  const ports = useRef<ChatFocusRevealPorts>({ list: () => null, navigate: () => {} })
  const [reveal] = useState(() =>
    createActor(chatFocusRevealMachine, {
      input: { ready: false, retryMs: REVEAL_TIMEOUT_MS, highlightMs: HIGHLIGHT_MS, ports: ports.current },
    }),
  )
  useLayoutEffect(() => {
    ports.current.list = () => listRef.current
    ports.current.resolveTurn = (focus: ChatMessageFocus) => ThreadFindModel.turnOf(railItems, focus.seq)
    ports.current.resolveRow = (focus: ChatMessageFocus, turn: number | null) =>
      turn === null || rowFor === undefined ? null : rowFor(turn, focus.seq, focus.type)
    ports.current.navigate = (focus: ChatFocusTarget) => {
      if (isMessageFocus(focus)) {
        const turn = ThreadFindModel.turnOf(railItems, focus.seq)
        if (turn === null) return
        if (jumpToTurn !== undefined) {
          jumpToTurn(turn)
          return
        }
        const item = railItems.find(candidate => candidate.turn === turn)
        if (item !== undefined) navigateToTurn(item)
        return
      }
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
