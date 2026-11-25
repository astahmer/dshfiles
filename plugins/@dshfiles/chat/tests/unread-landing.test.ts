// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatViewport } from '../src/native/chat/use-chat-viewport.ts'
import { SeenAnswers } from '../src/native/unread-landing.ts'

const memoryStorage = (initial: string | null = null) => {
  const values = new Map<string, string>()
  if (initial !== null) values.set('dshfiles-chat:seen-answers', initial)
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe('SeenAnswers', () => {
  it('remembers the answer reached per Session across instances', () => {
    const storage = memoryStorage()
    new SeenAnswers(storage).markSeen('session-a', 'answer-1')
    const reloaded = new SeenAnswers(storage)
    expect(reloaded.read('session-a')).toBe('answer-1')
    expect(reloaded.read('session-b')).toBeNull()
  })

  it('drops the least recently seen Sessions beyond its limit', () => {
    const seen = new SeenAnswers(memoryStorage(), 2)
    seen.markSeen('a', '1')
    seen.markSeen('b', '1')
    seen.markSeen('a', '2')
    seen.markSeen('c', '1')
    expect(seen.read('b')).toBeNull()
    expect(seen.read('a')).toBe('2')
    expect(seen.read('c')).toBe('1')
  })

  it('starts empty from corrupt or missing storage', () => {
    expect(new SeenAnswers(memoryStorage('{not json')).read('a')).toBeNull()
    expect(new SeenAnswers(memoryStorage('[["a"]]')).read('a')).toBeNull()
    expect(new SeenAnswers(null).read('a')).toBeNull()
  })
})

class InertResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const row = (input: { key: string; turn: number; answer?: boolean }): HTMLElement => {
  const element = document.createElement('div')
  element.dataset.chatAnchorKey = input.key
  element.dataset.chatNodeKey = input.key
  element.dataset.chatTurn = String(input.turn)
  if (input.answer === true) element.dataset.chatFinalAnswer = 'true'
  return element
}

const mount = (rows: readonly HTMLElement[], latestTurn: number): ChatViewport => {
  const list = document.createElement('div')
  const column = document.createElement('div')
  column.append(...rows)
  list.append(column)
  document.body.append(list)
  const viewport = new ChatViewport()
  viewport.attach(list, column)
  viewport.updateTurns([{ turn: latestTurn, anchorKey: `turn-${String(latestTurn)}`, prompt: '', response: '' }])
  return viewport
}

describe('ChatViewport unread answer', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', InertResizeObserver)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('finds the latest Turn final answer below its tool rows', () => {
    const viewport = mount(
      [
        row({ key: 'old-answer', turn: 1, answer: true }),
        row({ key: 'tool', turn: 2 }),
        row({ key: 'answer', turn: 2, answer: true }),
        row({ key: 'trailing-tool', turn: 2 }),
      ],
      2,
    )
    expect(viewport.latestFinalAnswer()?.anchorKey).toBe('answer')
  })

  it('has no unread answer when the latest Turn has none yet', () => {
    const viewport = mount([row({ key: 'old-answer', turn: 1, answer: true }), row({ key: 'running', turn: 2 })], 2)
    expect(viewport.latestFinalAnswer()).toBeNull()
  })

  it('marks one divider at the landing and clears it', () => {
    const answer = row({ key: 'answer', turn: 2, answer: true })
    const viewport = mount([row({ key: 'stale', turn: 1 }), answer], 2)
    const stale = document.querySelector<HTMLElement>('[data-chat-anchor-key="stale"]')
    if (stale !== null) stale.dataset.chatUnreadLabel = 'New'
    viewport.landAtUnread(answer, 'New')
    expect(document.querySelectorAll('[data-chat-unread-label]')).toHaveLength(1)
    expect(answer.dataset.chatUnreadLabel).toBe('New')
    viewport.clearUnread()
    expect(document.querySelectorAll('[data-chat-unread-label]')).toHaveLength(0)
  })
})

/** Give an element a layout box: its viewport top moves with the scroller's scrollTop, as in a browser. */
const place = (element: HTMLElement, scroller: HTMLElement, top: number, height: number): void => {
  element.getBoundingClientRect = () => {
    const y = top - scroller.scrollTop
    // SAFETY: the viewport reads only the box fields set here; DOMRect's other members are never called.
    return { top: y, bottom: y + height, height, left: 0, right: 600, width: 600, x: 0, y, toJSON: () => ({}) } as DOMRect
  }
}

describe('ChatViewport unread landing geometry (round five C3)', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', InertResizeObserver)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  const flowItem = (kind: string, child?: HTMLElement): HTMLElement => {
    const element = document.createElement('div')
    element.dataset.chatFlowKind = kind
    if (child !== undefined) element.append(child)
    return element
  }

  const landing = (withWorkedFor: boolean) => {
    const answer = row({ key: 'answer', turn: 2, answer: true })
    const prompt = flowItem('user')
    const worked = flowItem('turn-process')
    const answerItem = flowItem('assistant-step', answer)
    const scroller = document.createElement('div')
    scroller.dataset.conversationScroll = ''
    const list = document.createElement('div')
    const column = document.createElement('div')
    column.append(...(withWorkedFor ? [prompt, worked, answerItem] : [prompt, answerItem]))
    list.append(column)
    scroller.append(list)
    document.body.append(scroller)
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 3000 })
    // SAFETY: the viewport reads only the box fields set here; DOMRect's other members are never called.
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600, left: 0, right: 600, width: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    // The prompt, then "Worked for" (24px) 12px above the answer, as the flow lays them out.
    place(prompt, scroller, 800, 100)
    place(worked, scroller, 964, 24)
    place(answerItem, scroller, 1000, 400)
    place(answer, scroller, 1000, 400)
    const viewport = new ChatViewport()
    viewport.attach(list, column)
    viewport.updateTurns([{ turn: 2, anchorKey: 'turn-2', prompt: '', response: '' }])
    viewport.landAtUnread(answer, 'New')
    return { scrollTop: scroller.scrollTop }
  }

  it('lands the Turn\'s "Worked for" row whole, 12px below the top edge, never a clipped sliver of it', () => {
    // "Worked for" starts at 964: it lands at 12px from the top.
    expect(landing(true).scrollTop).toBe(964 - 12)
  })

  // Round five C3 (council round 5): a "New" divider between "Worked for" and the answer marked nothing the reader had
  // not already seen arrive; the whole Turn is new. Only an answer after earlier output of its Turn gets the label.
  it('draws no "New" label when the answer opens its Turn (only "Worked for" above it)', () => {
    landing(true)
    expect(document.querySelectorAll('[data-chat-unread-label]')).toHaveLength(0)
  })

  it('labels an answer that follows earlier output of its own Turn', () => {
    const answer = row({ key: 'answer', turn: 2, answer: true })
    const prompt = flowItem('user')
    const step = flowItem('assistant-step')
    const answerItem = flowItem('assistant-step', answer)
    const list = document.createElement('div')
    const column = document.createElement('div')
    column.append(prompt, step, answerItem)
    list.append(column)
    document.body.append(list)
    const scroller = document.body
    place(prompt, scroller, 800, 100)
    place(step, scroller, 912, 40)
    place(answerItem, scroller, 964, 400)
    place(answer, scroller, 964, 400)
    const viewport = new ChatViewport()
    viewport.attach(list, column)
    viewport.updateTurns([{ turn: 2, anchorKey: 'turn-2', prompt: '', response: '' }])
    viewport.landAtUnread(answer, 'New')
    expect(answer.dataset.chatUnreadLabel).toBe('New')
  })

  it('lands an answer with no row directly above it 12px below the top edge', () => {
    // The prompt above ends 100px before the answer: nothing of it shows within the 12px inset.
    expect(landing(false).scrollTop).toBe(1000 - 12)
  })
})

describe('an unread landing the content cannot reach yet (round five C1, council round 3)', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', InertResizeObserver)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  const setup = () => {
    const answer = row({ key: 'answer', turn: 2, answer: true })
    const worked = document.createElement('div')
    worked.dataset.chatFlowKind = 'turn-process'
    const answerItem = document.createElement('div')
    answerItem.dataset.chatFlowKind = 'assistant-step'
    answerItem.append(answer)
    const scroller = document.createElement('div')
    scroller.dataset.conversationScroll = ''
    const list = document.createElement('div')
    const column = document.createElement('div')
    column.append(worked, answerItem)
    list.append(column)
    scroller.append(list)
    document.body.append(scroller)
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 600 })
    // The turn's tail (its summary, the edit card) has not mounted yet: the range ends 23px short of the landing.
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 600 + 929 })
    // SAFETY: the viewport reads only the box fields set here; DOMRect's other members are never called.
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600, left: 0, right: 600, width: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    place(worked, scroller, 964, 24)
    place(answerItem, scroller, 1000, 400)
    place(answer, scroller, 1000, 400)
    const viewport = new ChatViewport()
    viewport.attach(list, column)
    viewport.updateTurns([{ turn: 2, anchorKey: 'turn-2', prompt: '', response: '' }])
    return { viewport, scroller }
  }

  it('lands at the floor, then puts "Worked for" 12px below the top once the rows below mount, not at the new floor', () => {
    const { viewport, scroller } = setup()
    const answer = document.querySelector<HTMLElement>('[data-chat-anchor-key="answer"]')
    if (answer === null) throw new Error('no answer row')
    viewport.landAtUnread(answer, 'New')
    expect(scroller.scrollTop).toBe(929)
    // The tail mounts: the range grows past the landing.
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 600 + 1100 })
    const resumed = viewport.resumeUnreadLanding()
    expect(resumed).not.toBeNull()
    expect(scroller.scrollTop).toBe(964 - 12)
    // Reached: nothing is held any more, so later growth leaves the reader where they are.
    expect(viewport.resumeUnreadLanding()).toBeNull()
  })

  it('lets go once the reader scrolls', () => {
    const { viewport, scroller } = setup()
    const answer = document.querySelector<HTMLElement>('[data-chat-anchor-key="answer"]')
    if (answer === null) throw new Error('no answer row')
    viewport.landAtUnread(answer, 'New')
    viewport.dropUnreadLanding()
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 600 + 1100 })
    expect(viewport.resumeUnreadLanding()).toBeNull()
  })

  it('re-applies the held landing on a resize before the reading policy can follow the tail', () => {
    const scroll = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/native/chat/use-chat-scroll.ts'), 'utf8')
    const resize = scroll.slice(scroll.indexOf('resize: () => {'), scroll.indexOf('reading.onResize()', scroll.indexOf('resize: () => {')))
    expect(resize).toContain('viewport.resumeUnreadLanding()')
    expect(scroll).toMatch(/interact: \(\) => \{[^}]*viewport\.dropUnreadLanding\(\)/u)
    expect(scroll).toMatch(/intent: \(\) => \{[^}]*viewport\.dropUnreadLanding\(\)/u)
  })
})
