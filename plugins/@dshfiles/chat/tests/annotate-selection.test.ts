// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { SelectionAnnotation } from '../src/annotate-selection.ts'

// jsdom has no layout, so a Range has no rectangle; the browser supplies a real one.
Range.prototype.getBoundingClientRect ??= () => DOMRect.fromRect()
Range.prototype.getClientRects ??= () => document.createElement('div').getClientRects()

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const renderChat = (html: string): HTMLElement => {
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.append(container)
  cleanups.push(() => container.remove())
  return container
}

const selectText = (node: Node, start: number, end: number): void => {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

const twoStepChat = `
  <div data-chat-flow-kind="assistant-step" data-chat-flow-key="step-1"><p id="first">Alpha beta gamma.</p><p id="second">Delta epsilon.</p></div>
  <div data-chat-flow-kind="assistant-step" data-chat-flow-key="step-2"><p id="third">Zeta eta.</p><p id="fourth">Delta epsilon.</p></div>
`

describe('SelectionAnnotation.selected', () => {
  it('returns the selected text inside one assistant step', () => {
    const container = renderChat(twoStepChat)
    const first = container.querySelector('#first')?.firstChild
    if (first === undefined || first === null) throw new Error('fixture missing')
    selectText(first, 0, 5)
    const selected = SelectionAnnotation.selected({ container, selection: window.getSelection() })
    expect(selected?.text).toBe('Alpha')
    expect(selected?.source).toBe('step=step-1&block=0')
  })

  it('refuses a selection that crosses two assistant steps', () => {
    const container = renderChat(twoStepChat)
    const first = container.querySelector('#first')?.firstChild
    const third = container.querySelector('#third')?.firstChild
    if (first === undefined || first === null || third === undefined || third === null) throw new Error('fixture missing')
    selectText(first, 0, 3)
    const range = window.getSelection()?.getRangeAt(0)
    range?.setEnd(third, 4)
    expect(SelectionAnnotation.selected({ container, selection: window.getSelection() })).toBeUndefined()
  })

  it('refuses a collapsed selection', () => {
    const container = renderChat(twoStepChat)
    const first = container.querySelector('#first')?.firstChild
    if (first === undefined || first === null) throw new Error('fixture missing')
    selectText(first, 2, 2)
    expect(SelectionAnnotation.selected({ container, selection: window.getSelection() })).toBeUndefined()
  })
})

describe('SelectionAnnotation.targetOf', () => {
  it('finds the smallest block holding the quoted text', () => {
    const container = renderChat(twoStepChat)
    expect(SelectionAnnotation.targetOf({ container, text: 'Delta epsilon.', source: '' })?.id).toBe('second')
  })

  it('falls back to the step when the quote crosses blocks', () => {
    const container = renderChat(twoStepChat)
    const target = SelectionAnnotation.targetOf({ container, text: 'gamma.\nDelta', source: '' })
    expect(target?.getAttribute('data-chat-flow-kind')).toBe('assistant-step')
  })

  it('prefers the step the annotation was taken from when the text repeats', () => {
    const container = renderChat(twoStepChat)
    expect(SelectionAnnotation.targetOf({ container, text: 'Delta epsilon.', source: 'step=step-2&block=-1' })?.id).toBe('fourth')
  })

  it('returns the block the selection came from when the text repeats inside one step', () => {
    const container = renderChat(
      '<div data-chat-flow-kind="assistant-step" data-chat-flow-key="s"><p id="a">an apple</p><p id="b">or allow an unsigned commit</p></div>',
    )
    expect(SelectionAnnotation.targetOf({ container, text: 'an', source: 'step=s&block=1' })?.id).toBe('b')
  })

  it('returns nothing for text absent from every step', () => {
    const container = renderChat(twoStepChat)
    expect(SelectionAnnotation.targetOf({ container, text: 'missing words', source: '' })).toBeUndefined()
  })
})
