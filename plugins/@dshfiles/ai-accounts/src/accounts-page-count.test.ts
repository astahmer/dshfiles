import { describe, expect, it } from 'vitest'
import { accountsPageCount } from './account-page-model.js'
import { quotaWindowCategories } from './usage-card-view.js'

describe('AI accounts page header count', () => {
  it('counts every row the unfiltered list shows: saved accounts and built-in providers', () => {
    const native = { available: true, providers: [{ entryId: 'a' }, { entryId: 'b' }] }
    expect(accountsPageCount({ accounts: [{ instanceId: 'cc' }], native })).toBe(3)
    expect(accountsPageCount({ accounts: [{ instanceId: 'cc' }], native: { available: false, providers: [] } })).toBe(1)
    expect(accountsPageCount({ accounts: [{ instanceId: 'cc' }], native: undefined })).toBe(1)
  })
})

describe('Usage › Quota cards', () => {
  const windows = [{ label: 'Current session', percentRemaining: 75, resetsAt: null }]
  it('prints "left" as its own word after the percentage, not glued to it', () => {
    const [card] = quotaWindowCategories({ windows: windows as never, now: 0, history: [] })
    expect(card?.formatTotal?.(75)).toBe('75%')
    expect(card?.unit).toBe('left')
  })
})
