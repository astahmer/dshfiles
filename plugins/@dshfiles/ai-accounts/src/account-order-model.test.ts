import { describe, expect, it } from 'vitest'
import type { AccountKind } from './api.js'
import { AccountOrderModel } from './account-order-model.js'

const account = (instanceId: string, kind: AccountKind = 'codex', enabled = true) => ({ instanceId, kind, enabled })
const accounts = [account('a'), account('claude', 'claude'), account('hidden'), account('disabled', 'codex', false), account('b'), account('c')]
const ids = (items: readonly { readonly instanceId: string }[]) => items.map(item => item.instanceId)

describe('canonical account priority', () => {
  it('atomically inserts before a target without dropping hidden, disabled or unlisted accounts', () => {
    const reordered = AccountOrderModel.reorder(accounts, { instanceId: 'c', targetInstanceId: 'a', placement: 'before' })
    expect(ids(reordered)).toEqual(['c', 'claude', 'a', 'hidden', 'disabled', 'b'])
    expect(reordered[1]).toBe(accounts[1])
    expect(reordered.find(account => account.instanceId === 'disabled')?.enabled).toBe(false)
    expect(ids(accounts)).toEqual(['a', 'claude', 'hidden', 'disabled', 'b', 'c'])
  })

  it('inserts after a target in one move, not a sequence of directional swaps', () => {
    expect(ids(AccountOrderModel.reorder(accounts, { instanceId: 'a', targetInstanceId: 'c', placement: 'after' }))).toEqual([
      'hidden',
      'claude',
      'disabled',
      'b',
      'c',
      'a',
    ])
  })

  it('refuses cross-provider, removed source and removed target without modifying the input', () => {
    expect(() => AccountOrderModel.reorder(accounts, { instanceId: 'a', targetInstanceId: 'claude', placement: 'before' })).toThrow(/same provider/)
    expect(() => AccountOrderModel.reorder(accounts, { instanceId: 'gone', targetInstanceId: 'a', placement: 'before' })).toThrow(/no longer available/)
    expect(() => AccountOrderModel.reorder(accounts, { instanceId: 'a', targetInstanceId: 'gone', placement: 'before' })).toThrow(/no longer available/)
  })

  it('rejects a stale same-provider order but ignores changes in another provider group', () => {
    const expectedOrder = ['a', 'hidden', 'disabled', 'b', 'c']
    const input = { instanceId: 'c', targetInstanceId: 'a', placement: 'before', expectedOrder } as const
    expect(() => AccountOrderModel.reorder([account('other', 'claude'), ...accounts], input)).not.toThrow()
    expect(() => AccountOrderModel.reorder([...accounts, account('new')], input)).toThrow(/changed elsewhere/)
    const moved = AccountOrderModel.reorder(accounts, input)
    expect(() => AccountOrderModel.reorder(moved, input)).toThrow(/changed elsewhere/)
  })

  it('translates drag and context targets with full same-provider concurrency snapshots', () => {
    expect(AccountOrderModel.moveTarget(accounts, { shownIds: ['a', 'b', 'c'], id: 'c', toIndex: 0 })).toEqual({
      instanceId: 'c',
      targetInstanceId: 'a',
      placement: 'before',
      expectedOrder: ['a', 'hidden', 'disabled', 'b', 'c'],
    })
    expect(AccountOrderModel.moveTarget(accounts, { shownIds: ['a', 'b', 'c'], id: 'a', toIndex: 2 })?.placement).toBe('after')
    expect(AccountOrderModel.moveTarget(accounts, { shownIds: ['a', 'b'], id: 'gone', toIndex: 0 })).toBeNull()
    expect(AccountOrderModel.moveTarget(accounts, { shownIds: ['a', 'b'], id: 'a', toIndex: 0 })).toBeNull()
    expect(AccountOrderModel.moveTarget(accounts, { shownIds: ['a', 'b'], id: 'a', toIndex: 20 })).toBeNull()
  })

  it('context arrows skip tiles of another provider, and disable at same-provider bounds', () => {
    const shown = ['a', 'claude', 'b', 'c']
    expect(AccountOrderModel.neighborIndex(accounts, shown, 'a', 1)).toBe(2)
    expect(AccountOrderModel.neighborIndex(accounts, shown, 'b', -1)).toBe(0)
    expect(AccountOrderModel.neighborIndex(accounts, shown, 'claude', 1)).toBe(-1)
    expect(AccountOrderModel.neighborIndex(accounts, shown, 'c', 1)).toBe(-1)
  })
})
