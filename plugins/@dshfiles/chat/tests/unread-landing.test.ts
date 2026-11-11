// @vitest-environment jsdom
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
