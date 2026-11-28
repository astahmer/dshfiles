// @vitest-environment jsdom
import { createActor } from '@dshfiles/plugin-ui/machine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_FOCUS_ATTRIBUTE, createChatFocusRevealMachine, type ChatFocusRevealPorts } from '../src/chat-focus-reveal.ts'

const RETRY_MS = 4_000
const HIGHLIGHT_MS = 4_000
const machine = createChatFocusRevealMachine({ retryMs: RETRY_MS, highlightMs: HIGHLIGHT_MS })

const transcript = (): HTMLElement => {
  const list = document.createElement('div')
  list.innerHTML = '<div data-chat-turn="1" id="turn-1"></div><div data-chat-turn="2" id="turn-2"></div>'
  document.body.append(list)
  return list
}

const start = (options: { readonly list: HTMLElement | null; readonly ready?: boolean; readonly navigate?: ChatFocusRevealPorts['navigate'] }) => {
  const actor = createActor(machine, {
    input: {
      ready: options.ready ?? true,
      retryMs: RETRY_MS,
      highlightMs: HIGHLIGHT_MS,
      ports: { list: () => options.list, navigate: options.navigate ?? (() => {}) },
    },
  })
  actor.start()
  return actor
}

const highlighted = (): HTMLElement | null => document.querySelector<HTMLElement>(`[${CHAT_FOCUS_ATTRIBUTE}]`)

describe('chat focus reveal machine', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'performance'] })
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('waits in pending until the view is ready, then navigates and highlights the landed row', () => {
    const list = transcript()
    const navigate = vi.fn()
    const actor = start({ list, ready: false, navigate })
    actor.send({ type: 'request', focus: { turn: 2 } })
    expect(actor.getSnapshot().matches('pending')).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
    actor.send({ type: 'ready', ready: true })
    expect(actor.getSnapshot().matches('revealing')).toBe(true)
    expect(navigate).toHaveBeenCalledWith({ turn: 2 })
    vi.advanceTimersToNextFrame()
    expect(actor.getSnapshot().matches('highlighted')).toBe(true)
    expect(highlighted()?.id).toBe('turn-2')
  })

  it('drops a pending request when its view goes away instead of landing it in the next one', () => {
    const list = transcript()
    const actor = start({ list, ready: false })
    actor.send({ type: 'request', focus: { turn: 1 } })
    actor.send({ type: 'cancel' })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    actor.send({ type: 'ready', ready: true })
    vi.advanceTimersByTime(RETRY_MS + 1_000)
    expect(highlighted()).toBeNull()
  })

  it('reveals only the newest request, clearing the highlight the superseded one landed', () => {
    const list = transcript()
    const actor = start({ list })
    actor.send({ type: 'request', focus: { turn: 1 } })
    vi.advanceTimersToNextFrame()
    expect(document.getElementById('turn-1')?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(true)
    actor.send({ type: 'request', focus: { turn: 2 } })
    expect(document.getElementById('turn-1')?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(false)
    vi.advanceTimersToNextFrame()
    expect(document.getElementById('turn-2')?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(true)
    expect(document.getElementById('turn-1')?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(false)
  })

  it('clears the highlight at its deadline and never revives it after a cancel', () => {
    const list = transcript()
    const actor = start({ list })
    actor.send({ type: 'request', focus: { turn: 1 } })
    vi.advanceTimersToNextFrame()
    vi.advanceTimersByTime(HIGHLIGHT_MS - 1)
    expect(document.getElementById('turn-1')?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(document.getElementById('turn-1')?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(false)
    actor.send({ type: 'request', focus: { turn: 2 } })
    vi.advanceTimersToNextFrame()
    actor.send({ type: 'cancel' })
    expect(document.getElementById('turn-2')?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(false)
    vi.advanceTimersByTime(HIGHLIGHT_MS)
    expect(document.getElementById('turn-2')?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(false)
  })

  /** A folded tool call: its row is mounted under a hidden group and opens its card on click. */
  const foldedCall = () => {
    const list = document.createElement('div')
    list.innerHTML =
      '<div data-chat-turn="1" hidden id="group"><div data-chat-call-id="call-1" id="call">' +
      '<div role="button" aria-expanded="false" id="row">Bash · Build the project</div>' +
      '<div><div role="button" aria-expanded="false" id="nested">nested</div></div></div></div>'
    document.body.append(list)
    const group = list.querySelector('#group')
    group?.addEventListener('beforematch', () => group.removeAttribute('hidden'))
    const row = list.querySelector('#row')
    const toggle = vi.fn(() => row?.setAttribute('aria-expanded', 'true'))
    row?.addEventListener('click', toggle)
    return { list, toggle }
  }

  it('opens the folded turn, lands on the tool call and opens its card when the request asks to', () => {
    const { list, toggle } = foldedCall()
    const actor = start({ list })
    actor.send({ type: 'request', focus: { turn: 1, toolCallId: 'call-1', open: true } })
    vi.advanceTimersToNextFrame()
    vi.advanceTimersToNextFrame()
    expect(highlighted()?.id).toBe('call')
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(document.getElementById('row')?.getAttribute('aria-expanded')).toBe('true')
    // Only the call's own row: a row nested in its body stays as it was.
    expect(document.getElementById('nested')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('leaves the card closed for a plain focus on a tool call', () => {
    const { list, toggle } = foldedCall()
    const actor = start({ list })
    actor.send({ type: 'request', focus: { turn: 1, toolCallId: 'call-1' } })
    vi.advanceTimersToNextFrame()
    vi.advanceTimersToNextFrame()
    expect(highlighted()?.id).toBe('call')
    expect(toggle).not.toHaveBeenCalled()
  })
})
