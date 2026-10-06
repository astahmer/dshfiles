import { describe, expect, it } from 'vitest'
import { createAccountPool } from './account-pool.js'

describe('account pool route reconciliation', () => {
  it('updates account metadata while preserving live cooldown and conversation affinity', () => {
    const pool = createAccountPool()
    pool.put({ id: 'opencode-one', kind: 'opencode-go', label: 'OpenCode One' })
    pool.put({ id: 'opencode-two', kind: 'opencode-go', label: 'OpenCode Two' })

    expect(pool.acquire('conversation-one')?.id).toBe('opencode-one')
    pool.noteRateLimited('opencode-one', 60_000)
    pool.replace([
      { id: 'opencode-one', kind: 'opencode-go', label: 'Renamed Account' },
      { id: 'opencode-two', kind: 'opencode-go', label: 'OpenCode Two' },
    ])

    expect(pool.describe()).toMatchObject([
      { id: 'opencode-one', label: 'Renamed Account', state: 'cooling' },
      { id: 'opencode-two', label: 'OpenCode Two', state: 'healthy' },
    ])
    expect(pool.acquire('conversation-one')?.id).toBe('opencode-two')
  })

  it('drops removed routes and disables accounts without resetting other health', () => {
    const pool = createAccountPool()
    pool.put({ id: 'opencode-one', kind: 'opencode-go', label: 'OpenCode One' })
    pool.put({ id: 'commandcode-one', kind: 'commandcode', label: 'Command Code One' })
    pool.noteRateLimited('commandcode-one', 60_000)

    pool.replace([
      { id: 'opencode-one', kind: 'opencode-go', label: 'OpenCode One', enabled: false },
      { id: 'commandcode-one', kind: 'commandcode', label: 'Command Code One' },
    ])
    expect(pool.describe()).toMatchObject([
      { id: 'opencode-one', enabled: false, state: 'disabled' },
      { id: 'commandcode-one', state: 'cooling' },
    ])
    expect(pool.acquire('conversation-one')?.id).toBeUndefined()

    pool.replace([{ id: 'commandcode-one', kind: 'commandcode', label: 'Command Code One' }])
    expect(pool.describe().map(account => account.id)).toEqual(['commandcode-one'])
    expect(pool.describe()[0]?.state).toBe('cooling')
  })
})
