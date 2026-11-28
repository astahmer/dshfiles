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

  it('round-trips a message-sequence focus and refuses invalid shapes', () => {
    const messageFocus = { seq: 42, type: 'assistant/message' as const, query: 'quartz' }
    expect(ChatFocusModel.decode(ChatFocusModel.encode(messageFocus))).toEqual(messageFocus)
    expect(ChatFocusModel.decode(ChatFocusModel.encode({ seq: 0 }))).toEqual({ seq: 0 })
    expect(ChatFocusModel.decode('dshfiles-chat-focus:{"seq":-1}')).toBeNull()
    expect(ChatFocusModel.decode('dshfiles-chat-focus:{"seq":10,"type":"tool/call"}')).toBeNull()
    expect(ChatFocusModel.decode('dshfiles-chat-focus:{"seq":10,"turn":1}')).toBeNull()
    expect(ChatFocusModel.decode('dshfiles-chat-focus:{"seq":10,"extra":true}')).toBeNull()
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

  describe('message-sequence focus', () => {
    beforeEach(() => {
      vi.stubGlobal('CSS', { escape: (value: string) => value })
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('opens the folded prompt bubble inside the row before landing on the matched message', () => {
      const list = document.createElement('div')
      list.innerHTML = `
        <div data-chat-turn="4" data-chat-node-key="node-user-40" data-chat-flow-kind="user">
          <div data-message-bubble="" data-prompt-fold="closed" id="bubble"><div id="prompt-body">Please deploy the quartz worker</div></div>
        </div>
        <div data-chat-turn="4" data-chat-node-key="node-assistant-45" data-chat-flow-kind="assistant-step">Assistant reply</div>`
      document.body.append(list)
      const navigate = vi.fn()
      revealChatFocus({
        list,
        focus: { seq: 40, type: 'user/message', query: 'quartz' },
        resolveTurn: () => 4,
        resolveRow: () => 'node-user-40',
        navigate,
      })
      vi.advanceTimersToNextFrame()
      vi.advanceTimersToNextFrame()
      expect(navigate).toHaveBeenCalledTimes(1)
      expect(document.getElementById('prompt-body')?.scrollTop).toBe(1)
      const row = list.querySelector('[data-chat-node-key="node-user-40"]')
      expect(row?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(false)
      document.getElementById('bubble')?.setAttribute('data-prompt-fold', 'open')
      vi.advanceTimersToNextFrame()
      expect(row?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(true)
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
      vi.advanceTimersByTime(4_100)
      expect(row?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(false)
    })

    it('opens a finished Turn’s “Worked for” row to reach an agent message folded inside it', () => {
      const list = document.createElement('div')
      list.innerHTML = `
        <div data-chat-turn="7" data-chat-node-key="process-7" data-chat-flow-kind="turn-process">
          <button type="button" data-turn-process="7" id="worked-for">Worked for 2m</button>
        </div>`
      document.body.append(list)
      let mounted = false
      document.getElementById('worked-for')?.addEventListener('click', () => {
        mounted = true
        list.insertAdjacentHTML(
          'beforeend',
          '<div data-chat-turn="7" data-chat-node-key="step-72" data-chat-flow-kind="assistant-step">The quartz rollout finished cleanly</div>',
        )
      })
      revealChatFocus({
        list,
        focus: { seq: 72, type: 'assistant/message', query: 'quartz rollout' },
        resolveTurn: () => 7,
        resolveRow: () => (mounted ? 'step-72' : 'process-7'),
      })
      for (let frame = 0; frame < 12; frame += 1) vi.advanceTimersToNextFrame()
      expect(mounted).toBe(true)
      expect(list.querySelector('[data-chat-node-key="step-72"]')?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(true)
      expect(list.querySelector('[data-chat-node-key="process-7"]')?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(false)
    })

    it('waits for a cold thread’s rail to place the sequence, navigates once, and gives up without it', () => {
      const list = document.createElement('div')
      list.innerHTML = '<div data-chat-turn="2" data-chat-node-key="user-20" data-chat-flow-kind="user">Check quartz metrics</div>'
      document.body.append(list)
      let railLoaded = false
      const navigate = vi.fn()
      revealChatFocus({
        list,
        focus: { seq: 20, type: 'user/message', query: 'quartz' },
        resolveTurn: () => (railLoaded ? 2 : null),
        resolveRow: () => 'user-20',
        navigate,
      })
      vi.advanceTimersToNextFrame()
      vi.advanceTimersToNextFrame()
      expect(navigate).not.toHaveBeenCalled()
      railLoaded = true
      vi.advanceTimersToNextFrame()
      vi.advanceTimersToNextFrame()
      expect(navigate).toHaveBeenCalledTimes(1)
      expect(list.querySelector('[data-chat-node-key="user-20"]')?.hasAttribute(CHAT_FOCUS_ATTRIBUTE)).toBe(true)

      const never = vi.fn()
      const other = document.createElement('div')
      other.innerHTML = '<div data-chat-turn="1" data-chat-node-key="user-1" data-chat-flow-kind="user">quartz</div>'
      document.body.append(other)
      revealChatFocus({ list: other, focus: { seq: 99 }, resolveTurn: () => null, navigate: never })
      vi.advanceTimersByTime(4_500)
      expect(never).not.toHaveBeenCalled()
      expect(other.querySelector(`[${CHAT_FOCUS_ATTRIBUTE}]`)).toBeNull()
    })
  })
})
