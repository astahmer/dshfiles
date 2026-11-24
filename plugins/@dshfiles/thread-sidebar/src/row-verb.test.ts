import { describe, expect, it } from 'vitest'
import { RowVerb } from './row-verb.js'

const landing = { verb: 'Land', itemId: 'item-land' } as const

describe("a thread row's inline verb", () => {
  it('Land asks the header confirmation for that thread instead of landing on the first click', () => {
    expect(RowVerb.actionOf(landing, { recovering: false, landConfirm: true })).toEqual({ kind: 'confirm-land' })
  })

  it('Land without anything that can confirm opens the thread, never lands', () => {
    expect(RowVerb.actionOf(landing, { recovering: false, landConfirm: false })).toEqual({ kind: 'open' })
  })

  it('Retry and Resume on an inbox item still run the provider verb', () => {
    expect(RowVerb.actionOf({ verb: 'Retry', itemId: 'i' }, { recovering: false, landConfirm: true })).toEqual({ kind: 'act', itemId: 'i', verb: 'Retry' })
    expect(RowVerb.actionOf({ verb: 'Resume', itemId: 'i' }, { recovering: false, landConfirm: true })).toEqual({ kind: 'act', itemId: 'i', verb: 'Resume' })
  })

  it('Answer and Approve open the thread; an interrupted turn resumes here', () => {
    expect(RowVerb.actionOf({ verb: 'Answer', itemId: 'i' }, { recovering: false, landConfirm: true })).toEqual({ kind: 'open' })
    expect(RowVerb.actionOf({ verb: 'Approve', itemId: undefined }, { recovering: false, landConfirm: true })).toEqual({ kind: 'open' })
    expect(RowVerb.actionOf({ verb: 'Resume', itemId: undefined }, { recovering: true, landConfirm: true })).toEqual({ kind: 'resume' })
    expect(RowVerb.actionOf({ verb: 'Resume', itemId: undefined }, { recovering: false, landConfirm: true })).toEqual({ kind: 'open' })
  })
})
