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

describe('input trigger menu dismissal and launcher records', () => {
  const opened = InputTriggerMenuModel.reduce(InputTriggerMenuModel.seedGroups(MENU_CLOSED, [{ name: 'files' }]), { type: 'hit', hit })

  it('records a dismissal that survives the close and matches only the same token', () => {
    const dismissed = InputTriggerMenuModel.reduce(opened, { type: 'dismiss' })
    expect(dismissed.open).toBe(false)
    expect(dismissed.dismissed).toEqual({ trigger: '/', query: 'readme', quoted: false, start: 0, end: 7 })
    const record = dismissed.dismissed
    if (record === null) throw new Error('expected a recorded dismissal')
    expect(InputTriggerMenuModel.dismissedHit(record, hit)).toBe(true)
    expect(InputTriggerMenuModel.dismissedHit(record, { ...hit, query: 'read' })).toBe(false)
    expect(InputTriggerMenuModel.reduce(dismissed, { type: 'close' })).toBe(dismissed)
  })

  it('clears the dismissal on request and ignores the request when none is recorded', () => {
    const dismissed = InputTriggerMenuModel.reduce(opened, { type: 'dismiss' })
    expect(InputTriggerMenuModel.reduce(dismissed, { type: 'dismissed-cleared' }).dismissed).toBeNull()
    expect(InputTriggerMenuModel.reduce(opened, { type: 'dismissed-cleared' })).toBe(opened)
  })

  it('keeps the launcher source on the open menu and ends it with the close', () => {
    const launched = InputTriggerMenuModel.reduce(InputTriggerMenuModel.seedGroups(MENU_CLOSED, [{ name: 'command' }]), {
      type: 'hit',
      hit,
      launcher: 'command',
    })
    expect(launched.launcher).toBe('command')
    expect(InputTriggerMenuModel.reduce(launched, { type: 'launcher-cleared' }).launcher).toBeNull()
    expect(InputTriggerMenuModel.reduce(launched, { type: 'close' }).launcher).toBeNull()
    expect(InputTriggerMenuModel.reduce(launched, { type: 'close' }).drilled).toBe(false)
  })

  it('keeps the drill record through the hit that follows a descent until the menu closes', () => {
    const closed = InputTriggerMenuModel.reduce(opened, { type: 'close' })
    const drilled = InputTriggerMenuModel.reduce(closed, { type: 'drilled', value: true })
    expect(drilled.open).toBe(false)
    expect(drilled.drilled).toBe(true)

    const descended = InputTriggerMenuModel.reduce(InputTriggerMenuModel.seedGroups(drilled, [{ name: 'files' }]), { type: 'hit', hit })
    expect(descended.drilled).toBe(true)

    const refused = InputTriggerMenuModel.reduce(descended, { type: 'drilled', value: false })
    expect(refused.drilled).toBe(false)
    expect(InputTriggerMenuModel.reduce(descended, { type: 'close' }).drilled).toBe(false)
  })
})
