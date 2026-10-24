// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatFocusModel } from '../src/chat-focus.ts'
import { CHAT_FOCUS_ATTRIBUTE, revealChatFocus } from '../src/chat-focus-reveal.ts'

describe('chat focus contract', () => {
  it('round-trips a focus through the opaque view-request string and refuses anything else', () => {
    const focus = { turn: 3, step: 2, toolCallId: 'call-9' }
    expect(ChatFocusModel.decode(ChatFocusModel.encode(focus))).toEqual(focus)
    expect(ChatFocusModel.decode(ChatFocusModel.encode({ turn: 0 }))).toEqual({ turn: 0 })
    expect(ChatFocusModel.decode('trajectory:call-9')).toBeNull()
    expect(ChatFocusModel.decode('dshfiles-chat-focus:{not json')).toBeNull()
    expect(ChatFocusModel.decode('dshfiles-chat-focus:{"turn":-1}')).toBeNull()
    expect(ChatFocusModel.decode('dshfiles-chat-focus:{"turn":1,"extra":true}')).toBeNull()
    expect(() => ChatFocusModel.encode({ turn: 1.5 })).toThrow()
  })

  it('keeps one pending request per thread until taken or expired, and announces it', () => {
    const announced: unknown[] = []
    const listener = (event: Event): void => {
      if (event instanceof CustomEvent) announced.push(event.detail)
    }
    window.addEventListener(ChatFocusModel.event, listener)
    ChatFocusModel.request({ sessionId: 's-1', focus: { turn: 1 }, now: 1_000 })
    ChatFocusModel.request({ sessionId: 's-1', focus: { turn: 2 }, now: 1_000 })
    ChatFocusModel.request({ sessionId: 's-2', focus: { turn: 5 }, now: 1_000 })
    window.removeEventListener(ChatFocusModel.event, listener)
    expect(announced).toEqual([{ sessionId: 's-1' }, { sessionId: 's-1' }, { sessionId: 's-2' }])
    expect(ChatFocusModel.take('s-1', 1_500)).toEqual({ turn: 2 })
    expect(ChatFocusModel.take('s-1', 1_500)).toBeNull()
    expect(ChatFocusModel.take('s-2', 1_000 + ChatFocusModel.ttlMs + 1)).toBeNull()
  })
})

describe('revealChatFocus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'performance'] })
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  const transcript = (): HTMLElement => {
    const list = document.createElement('div')
    list.innerHTML = `
      <div data-chat-turn="1" data-chat-anchor-key="u1"></div>
      <div data-chat-turn="2" data-chat-anchor-key="group:g2" id="group">
        <div data-step-process-body hidden="until-found" id="body"></div>
      </div>`
    document.body.append(list)
    return list
  }

  it('opens a folded group with beforematch, then scrolls to and highlights the tool call it mounts', () => {
    const list = transcript()
    const body = document.getElementById('body')
    body?.addEventListener('beforematch', () => {
      body.removeAttribute('hidden')
      body.innerHTML = '<div data-chat-turn="2" data-chat-step="3" data-chat-call-id="call-7" id="tool"></div>'
    })
    revealChatFocus({ list, focus: { turn: 2, step: 3, toolCallId: 'call-7' } })
    vi.advanceTimersToNextFrame()
    vi.advanceTimersToNextFrame()
    const tool = document.getElementById('tool')
    expect(tool?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(true)
    expect(tool?.scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    vi.advanceTimersByTime(3_000)
    expect(tool?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(true)
    vi.advanceTimersByTime(1_100)
    expect(tool?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(false)
  })

  it('lands on the visible Turn row when the step never appears, and cancels cleanly', () => {
    const list = transcript()
    const cancel = revealChatFocus({ list, focus: { turn: 2, step: 9 } })
    vi.advanceTimersByTime(4_100)
    const group = document.getElementById('group')
    expect(group?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(true)
    cancel()
    expect(group?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(false)
  })

  it('highlights a Turn focus without unfolding anything', () => {
    const list = transcript()
    const revealed = vi.fn()
    document.getElementById('body')?.addEventListener('beforematch', revealed)
    revealChatFocus({ list, focus: { turn: 1 } })
    vi.advanceTimersToNextFrame()
    expect(list.querySelector('[data-chat-anchor-key="u1"]')?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(true)
    expect(revealed).not.toHaveBeenCalled()
  })
})
