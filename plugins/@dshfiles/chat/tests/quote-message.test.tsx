// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { insertMessageQuote, selectedMessageText, type MessageQuoteSource } from '../src/quote-message.ts'

const source: MessageQuoteSource = { sessionId: 'session-quote', seq: 5, role: 'assistant', turn: 1 }

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
})

describe('message quote draft', () => {
  it('inserts editable multiline text with source context without replacing the draft or submitting', () => {
    let draft = 'Existing draft'
    const focused: string[] = []
    const composer = {
      insert: (input: { sessionId?: string; text: string; replaceSelection?: boolean }) => {
        expect(input.replaceSelection).toBe(false)
        expect(input.sessionId).toBe(source.sessionId)
        draft += input.text
        return true
      },
      focus: (input?: { sessionId?: string }) => {
        focused.push(input?.sessionId ?? '')
        return true
      },
    }
    expect(insertMessageQuote({ composer, source, text: 'first\r\n\r\n  second\n', attribution: 'Assistant · session-quote · message 5' })).toBe(true)
    expect(draft).toBe('Existing draft\n\n> Assistant · session-quote · message 5\n>\n> first\n> \n>   second\n> \n\n')
    expect(focused).toEqual(['session-quote'])
  })

  it('does not move focus when the composer refuses an insertion', () => {
    let focused = false
    expect(
      insertMessageQuote({
        composer: {
          insert: () => false,
          focus: () => {
            focused = true
            return true
          },
        },
        source,
        text: 'quote',
        attribution: 'Assistant',
      }),
    ).toBe(false)
    expect(focused).toBe(false)
  })
})

const fixture = () => {
  const flow = document.createElement('div')
  flow.setAttribute('data-chat-flow', '')
  const message = document.createElement('div')
  message.setAttribute('data-chat-flow-kind', 'assistant-step')
  message.setAttribute('data-chat-turn', '1')
  message.setAttribute('data-chat-message-seq', '5')
  const text = document.createTextNode('before selected\nsecond after')
  message.append(text)
  const tail = document.createElement('div')
  tail.setAttribute('data-chat-flow-kind', 'turn-tail')
  const button = document.createElement('button')
  tail.append(button)
  flow.append(message, tail)
  document.body.append(flow)
  const selection = window.getSelection()
  const range = document.createRange()
  range.setStart(text, 7)
  range.setEnd(text, 22)
  selection?.addRange(range)
  return { flow, message, button, selection }
}

describe('message quote selection', () => {
  it('uses only the selected text in the matching assistant turn', () => {
    const input = fixture()
    expect(selectedMessageText({ ...input, source })).toBe('selected\nsecond')
  })

  it('ignores a selection in another turn or pane', () => {
    const input = fixture()
    expect(selectedMessageText({ ...input, source: { ...source, turn: 2 } })).toBeUndefined()
    expect(selectedMessageText({ ...input, source: { ...source, seq: 7 } })).toBeUndefined()
    const otherFlow = document.createElement('div')
    otherFlow.setAttribute('data-chat-flow', '')
    document.body.append(otherFlow)
    otherFlow.append(input.message)
    expect(selectedMessageText({ ...input, source })).toBeUndefined()
  })

  it('uses user selections only within the action-owning message', () => {
    const input = fixture()
    const user: MessageQuoteSource = { sessionId: source.sessionId, seq: 3, role: 'user' }
    input.message.setAttribute('data-chat-flow-kind', 'user')
    expect(selectedMessageText({ ...input, source: user })).toBeUndefined()
    input.message.append(input.button)
    expect(selectedMessageText({ ...input, source: user })).toBe('selected\nsecond')
  })

  it('ignores collapsed and action-label selections', () => {
    const input = fixture()
    input.message.setAttribute('data-message-actions', '')
    expect(selectedMessageText({ ...input, source })).toBeUndefined()
    input.message.removeAttribute('data-message-actions')
    input.selection?.collapseToStart()
    expect(selectedMessageText({ ...input, source })).toBeUndefined()
  })
})
