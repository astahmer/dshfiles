// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { MessageQuote, quoteScopeFor, selectedQuoteText } from '../src/message-quote.ts'

const labels = { turn: (turn: number) => `turn ${turn}` }

describe('MessageQuote.blockquote', () => {
  it('prefixes every line and keeps line breaks', () => {
    expect(MessageQuote.blockquote('first\nsecond\r\nthird')).toBe('> first\n> second\n> third')
  })

  it('keeps empty lines inside the quote as a bare marker so it stays one block', () => {
    expect(MessageQuote.blockquote('one\n\n\ntwo')).toBe('> one\n>\n>\n> two')
  })

  it('drops leading and trailing blank lines and trailing spaces', () => {
    expect(MessageQuote.blockquote('\n\n  indented  \nend\t\n\n')).toBe('>   indented\n> end')
  })

  it('nests an existing quote one level deeper', () => {
    expect(MessageQuote.blockquote('> earlier\n>> older\nreply')).toBe('>> earlier\n>>> older\n> reply')
  })

  it('returns undefined for whitespace only', () => {
    expect(MessageQuote.blockquote(' \n\t\n')).toBeUndefined()
  })
})

describe('MessageQuote.format', () => {
  it('adds the source line and an empty line for the reply', () => {
    expect(MessageQuote.format('a\nb', { author: 'Assistant', turn: 3, clock: '14:05' }, labels)).toBe('> a\n> b\n— Assistant · turn 3 · 14:05\n\n')
  })

  it('leaves out source parts it does not have', () => {
    expect(MessageQuote.format('a', { author: 'You' }, labels)).toBe('> a\n— You\n\n')
  })

  it('formats nothing for an empty message', () => {
    expect(MessageQuote.format('', { author: 'You' }, labels)).toBeUndefined()
  })
})

describe('MessageQuote.separatorBefore', () => {
  it('starts the quote on its own paragraph', () => {
    expect(MessageQuote.separatorBefore('')).toBe('')
    expect(MessageQuote.separatorBefore('draft')).toBe('\n\n')
    expect(MessageQuote.separatorBefore('draft\n')).toBe('\n')
    expect(MessageQuote.separatorBefore('draft\n\n')).toBe('')
  })
})

describe('selectedQuoteText', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    document.body.innerHTML = ''
  })

  const seat = (kind: string, turn: number, text: string): HTMLElement => {
    const element = document.createElement('div')
    element.setAttribute('data-chat-flow-kind', kind)
    element.setAttribute('data-chat-turn', String(turn))
    const paragraph = document.createElement('p')
    paragraph.textContent = text
    element.append(paragraph)
    document.body.append(element)
    return element
  }
  const select = (from: Node, fromOffset: number, to: Node, toOffset: number): Selection => {
    const selection = window.getSelection()
    if (selection === null) throw new Error('no selection')
    selection.removeAllRanges()
    const range = document.createRange()
    range.setStart(from, fromOffset)
    range.setEnd(to, toOffset)
    selection.addRange(range)
    return selection
  }
  const textOf = (element: HTMLElement): Node => element.querySelector('p')?.firstChild as Node

  it('quotes a selection inside the user row only', () => {
    const user = seat('user', 1, 'hello world')
    const actions = document.createElement('div')
    user.append(actions)
    const other = seat('user', 2, 'elsewhere')
    expect(selectedQuoteText(select(textOf(user), 6, textOf(user), 11), quoteScopeFor(actions, 'row'))).toBe('world')
    expect(selectedQuoteText(select(textOf(user), 0, textOf(other), 3), quoteScopeFor(actions, 'row'))).toBeUndefined()
  })

  it('quotes a selection across the assistant steps of the same turn', () => {
    const first = seat('assistant-step', 4, 'step one')
    const second = seat('assistant-step', 4, 'step two')
    const otherTurn = seat('assistant-step', 5, 'later')
    const tail = seat('turn-tail', 4, '')
    const actions = document.createElement('div')
    tail.append(actions)
    const scope = quoteScopeFor(actions, 'turn-assistant')
    expect(selectedQuoteText(select(textOf(first), 5, textOf(second), 4), scope)).toBe('onestep')
    expect(selectedQuoteText(select(textOf(second), 0, textOf(otherTurn), 2), scope)).toBeUndefined()
  })

  it('ignores a collapsed or blank selection', () => {
    const user = seat('user', 1, 'hello')
    const actions = document.createElement('div')
    user.append(actions)
    expect(selectedQuoteText(select(textOf(user), 2, textOf(user), 2), quoteScopeFor(actions, 'row'))).toBeUndefined()
    expect(selectedQuoteText(null, quoteScopeFor(actions, 'row'))).toBeUndefined()
  })
})
