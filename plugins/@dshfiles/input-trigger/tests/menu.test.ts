import { describe, expect, it } from 'vitest'
import type { TriggerHit } from '../src/core/contract.js'
import { InputTriggerMenuModel, MENU_CLOSED } from '../src/core/menu.js'

const hit: TriggerHit = {
  trigger: '/',
  query: 'readme',
  quoted: false,
  position: 'leading',
  span: { start: 0, end: 7, draftRev: 1 },
}

describe('input trigger menu model', () => {
  it('seeds groups, settles candidates and drops stale results', () => {
    const seeded = InputTriggerMenuModel.seedGroups(MENU_CLOSED, [{ name: 'files', showGroupTitle: false }])
    expect(seeded.groups).toEqual([{ source: 'files', showGroupTitle: false, status: 'pending', items: [] }])

    const opened = InputTriggerMenuModel.reduce(seeded, { type: 'hit', hit })
    const candidate = { name: 'README.md', value: 'readme' }
    const ready = InputTriggerMenuModel.reduce(opened, {
      type: 'source-settled',
      generation: opened.generation,
      source: 'files',
      items: [candidate],
    })

    expect(ready.highlight).toEqual({ source: 'files', index: 0 })
    expect(InputTriggerMenuModel.exactMatch(ready.groups, 'files', 'README.md')).toBe(candidate)
    expect(InputTriggerMenuModel.reduce(ready, { type: 'source-settled', generation: 0, source: 'files' })).toBe(ready)
  })
})
