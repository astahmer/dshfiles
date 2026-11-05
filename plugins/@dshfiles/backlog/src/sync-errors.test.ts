import { describe, expect, it } from 'vitest'

import { BacklogWriteFailed } from './errors.js'
import { SyncAlreadyLinked, SyncItemNotLinked, SyncWriteFailed } from './sync-errors.js'

describe('item labels in errors', () => {
  it('names an item by its short alias, and by its number only when no alias is known', () => {
    expect(new SyncItemNotLinked({ itemId: 41, ref: 'k3f9' }).message).toMatch(/^b:k3f9 is not linked/u)
    expect(new SyncAlreadyLinked({ itemId: 41, ref: 'k3f9', remoteKey: 'ENG-1' }).message).toMatch(/^b:k3f9 is already linked to ENG-1/u)
    expect(new SyncWriteFailed({ itemId: 41, ref: 'k3f9' }).message).toContain('The sync state of b:k3f9 could not')
    expect(new BacklogWriteFailed({ itemId: 41, ref: 'k3f9', operation: 'put' }).message).toContain('Backlog item b:k3f9 could not')
    expect(new SyncItemNotLinked({ itemId: 12 }).message).toMatch(/^b:12 is not linked/u)
  })
})
