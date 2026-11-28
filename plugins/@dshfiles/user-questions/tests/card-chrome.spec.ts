import { describe, expect, it } from 'vitest'
import { CardChrome } from '../src/card-chrome.ts'

describe('question card chrome', () => {
  it('shows the pager only when there is another question to page to', () => {
    expect(CardChrome.showsPager(1)).toBe(false)
    expect(CardChrome.showsPager(2)).toBe(true)
  })

  it('names the way out of a pending question, so it is not a third unexplained exit beside Collapse and Skip', () => {
    // A tool-call question only leaves the composer seat: the answer can wait, and its transcript row brings it back.
    expect(CardChrome.exitOf({ dismissal: 'hide', review: false })).toBe('later')
    // A recorded answer under review has nothing pending: it closes.
    expect(CardChrome.exitOf({ dismissal: 'hide', review: true })).toBe('close')
    // A request with no tool call has no way back, so leaving it ends it.
    expect(CardChrome.exitOf({ dismissal: 'cancel', review: false })).toBe('cancel')
  })
})
