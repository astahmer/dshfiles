import { describe, expect, it } from 'vitest'
import { StatusSummaryModel } from './status-summary.ts'

describe('phone status pill summary', () => {
  it('names the first two items that have something to say', () => {
    expect(
      StatusSummaryModel.summarize([
        { label: 'Working', text: '1 working' },
        { label: 'Quota', text: ' CC1\n56% ' },
        { label: 'Restart', text: 'Restart pending · 1 plugin' },
      ]),
    ).toBe('1 working · Quota CC1 56%')
  })

  it('skips items that render nothing', () => {
    expect(
      StatusSummaryModel.summarize([
        { label: 'Working', text: '' },
        { label: 'Restart', text: 'Restart pending' },
      ]),
    ).toBe('Restart pending')
  })

  it('is empty when no item has text, so the pill can fall back', () => {
    expect(StatusSummaryModel.summarize([{ label: 'Working', text: '  ' }])).toBe('')
  })
})
