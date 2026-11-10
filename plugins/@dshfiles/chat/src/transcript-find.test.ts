// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { turnStarts } from './native/chat/turn-rail-items.ts'
import { TranscriptFind } from './transcript-find.ts'

afterEach(() => {
  document.body.replaceChildren()
})

describe('TranscriptFind', () => {
  it('maps an event seq to the Turn that holds it', () => {
    const starts = turnStarts([
      { turn: 2, seq: 40, prompt: 'b', response: '' },
      { turn: 1, seq: 10, prompt: 'a', response: '' },
      { turn: 'bad', seq: 5 },
      { turn: 3, seq: 90, prompt: 'c', response: '' },
    ])
    expect(starts).toEqual([
      { turn: 1, seq: 10 },
      { turn: 2, seq: 40 },
      { turn: 3, seq: 90 },
    ])
    expect(TranscriptFind.turnOf(starts, 5)).toBeUndefined()
    expect(TranscriptFind.turnOf(starts, 10)).toBe(1)
    expect(TranscriptFind.turnOf(starts, 89)).toBe(2)
    expect(TranscriptFind.turnOf(starts, 500)).toBe(3)
  })

  it('steps through matches and wraps at both ends', () => {
    expect(TranscriptFind.step({ index: 2, count: 3, direction: 1 })).toBe(0)
    expect(TranscriptFind.step({ index: 0, count: 3, direction: -1 })).toBe(2)
    expect(TranscriptFind.step({ index: 0, count: 0, direction: 1 })).toBe(0)
  })

  it('marks every typed word in visible rows, case-insensitively, in document order', () => {
    document.body.innerHTML = '<div id="row">Retry the <b>storm</b> retry<span hidden>retry hidden</span></div>'
    const row = document.getElementById('row')
    if (row === null) throw new Error('fixture row missing')
    const ranges = TranscriptFind.wordRanges([row], TranscriptFind.findWords('RETRY storm -'))
    expect(ranges.map(range => range.toString())).toEqual(['Retry', 'storm', 'retry'])
  })

  it('opens the find bar of the focused Chat view, else the last one used, and lets the key through when none is on screen', () => {
    expect(TranscriptFind.open()).toBe(false)
    const opened: string[] = []
    const frame = (id: string): HTMLElement => {
      const element = document.createElement('div')
      element.id = id
      element.tabIndex = 0
      Object.defineProperty(element, 'getClientRects', { value: () => ({ length: 1 }) })
      document.body.append(element)
      return element
    }
    const first = frame('first')
    const second = frame('second')
    const firstTarget = { frame: () => first, open: () => opened.push('first') }
    const unregisterFirst = TranscriptFind.register(firstTarget)
    const unregisterSecond = TranscriptFind.register({ frame: () => second, open: () => opened.push('second') })
    expect(TranscriptFind.open()).toBe(true)
    TranscriptFind.touch(firstTarget)
    expect(TranscriptFind.open()).toBe(true)
    second.focus()
    expect(TranscriptFind.open()).toBe(true)
    expect(opened).toEqual(['second', 'first', 'second'])
    unregisterFirst()
    unregisterSecond()
    expect(TranscriptFind.open()).toBe(false)
  })
})
