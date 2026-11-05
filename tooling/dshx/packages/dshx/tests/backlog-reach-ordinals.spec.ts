import { describe, expect, it } from 'vitest'
import { parseReachStep } from '../src/project/features.js'
import { BacklogReachOrdinals } from '../src/scratch/backlog-ordinals.js'

describe('backlog ordinals in reach steps', () => {
  it('finds each b:#<n> ordinal once and leaves plain b:<n> text alone', () => {
    expect(BacklogReachOrdinals.ordinalsIn('click checkbox "Select b:#1"')).toEqual([1])
    expect(BacklogReachOrdinals.ordinalsIn('fill textbox "Comment" "b:#2 then b:#1 and b:#2"')).toEqual([2, 1])
    expect(BacklogReachOrdinals.ordinalsIn('fill textbox "Capture" "Start a thread from b:1"')).toEqual([])
    expect(BacklogReachOrdinals.ordinalsIn('expect text "ab:#1 or b:#0"')).toEqual([])
  })

  it('writes each ordinal as the label of the item captured in that order', () => {
    const labels = new Map([
      [1, 'b:k3f9'],
      [2, 'b:7hq2'],
    ])
    expect(BacklogReachOrdinals.replace('rightclick row "Item b:#2"', labels)).toBe('rightclick row "Item b:7hq2"')
    expect(BacklogReachOrdinals.replace('fill textbox "Composer" "Working on b:#1 and b:#2"', labels)).toBe(
      'fill textbox "Composer" "Working on b:k3f9 and b:7hq2"',
    )
  })

  it('reads an ordinal no item has yet as its number, and keeps the step in the reach grammar', () => {
    const step = BacklogReachOrdinals.replace('expect article "Card b:#3"', new Map())
    expect(step).toBe('expect article "Card b:3"')
    expect(parseReachStep('click checkbox "Select b:#1"')).toEqual({ action: 'click', by: 'checkbox', name: 'Select b:#1' })
  })

  it('makes no Host call for a step without an ordinal', async () => {
    await expect(BacklogReachOrdinals.resolve({ step: 'click button "Backlog"', launchUrl: 'not-a-url' })).resolves.toBe('click button "Backlog"')
  })
})
