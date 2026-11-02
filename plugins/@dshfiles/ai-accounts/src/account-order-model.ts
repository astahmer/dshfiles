import type { AccountKind, AccountReorder } from './api.js'

type OrderedAccount = { readonly instanceId: string; readonly kind: AccountKind }

export type AccountOrderRejection = 'missing' | 'cross-provider' | 'stale'

const rejectionMessages = {
  missing: 'An account is no longer available. Refresh and try again.',
  'cross-provider': 'Account priority can only change within the same provider group.',
  stale: 'Account priority changed elsewhere. Refresh and try your move again.',
} as const satisfies Record<AccountOrderRejection, string>

/** Account priority is the store order, never the list of tiles a surface happens to show. */
export class AccountOrderModel {
  /** Why `reorder` would refuse this move, or undefined when it applies. */
  static rejection = (accounts: readonly OrderedAccount[], input: AccountReorder): AccountOrderRejection | undefined => {
    const current = accounts.find(account => account.instanceId === input.instanceId)
    const target = accounts.find(account => account.instanceId === input.targetInstanceId)
    if (current === undefined || target === undefined) return 'missing'
    if (current.kind !== target.kind) return 'cross-provider'
    const group = accounts.filter(account => account.kind === current.kind).map(account => account.instanceId)
    if (input.expectedOrder !== undefined && (group.length !== input.expectedOrder.length || group.some((id, index) => id !== input.expectedOrder?.[index])))
      return 'stale'
    return undefined
  }

  static readonly rejectionMessage = (rejection: AccountOrderRejection): string => rejectionMessages[rejection]

  static reorder = <Account extends OrderedAccount>(accounts: readonly Account[], input: AccountReorder): Account[] => {
    const rejection = AccountOrderModel.rejection(accounts, input)
    if (rejection !== undefined) throw new Error(rejectionMessages[rejection])
    const current = accounts.find(account => account.instanceId === input.instanceId)
    const target = accounts.find(account => account.instanceId === input.targetInstanceId)
    if (current === undefined || target === undefined) return [...accounts]
    const group = accounts.filter(account => account.kind === current.kind)
    if (current === target) return [...accounts]
    const remaining = group.filter(account => account !== current)
    const targetIndex = remaining.indexOf(target) + (input.placement === 'after' ? 1 : 0)
    remaining.splice(targetIndex, 0, current)
    // Keep every other provider's slots unchanged, including interleaved providers.
    let index = 0
    return accounts.map(account => (account.kind === current.kind ? (remaining[index++] ?? account) : account))
  }

  /** A drop means before an earlier target, after a later one. Never submit a cosmetic full-list replacement. */
  static moveTarget = (
    accounts: readonly OrderedAccount[],
    input: {
      readonly shownIds: readonly string[]
      readonly id: string
      readonly toIndex: number
    },
  ): AccountReorder | null => {
    const fromIndex = input.shownIds.indexOf(input.id)
    const targetInstanceId = input.shownIds[input.toIndex]
    if (fromIndex === -1 || fromIndex === input.toIndex || targetInstanceId === undefined) return null
    const current = accounts.find(account => account.instanceId === input.id)
    if (current === undefined) return null
    return {
      instanceId: input.id,
      targetInstanceId,
      placement: input.toIndex < fromIndex ? 'before' : 'after',
      expectedOrder: accounts.filter(account => account.kind === current.kind).map(account => account.instanceId),
    }
  }

  /** Context-menu arrows skip other providers, retaining same-provider priority semantics. */
  static neighborIndex = (accounts: readonly OrderedAccount[], shownIds: readonly string[], id: string, direction: -1 | 1): number => {
    const current = accounts.find(account => account.instanceId === id)
    const index = shownIds.indexOf(id)
    if (current === undefined || index === -1) return -1
    for (let next = index + direction; next >= 0 && next < shownIds.length; next += direction) {
      if (accounts.some(account => account.instanceId === shownIds[next] && account.kind === current.kind)) return next
    }
    return -1
  }
}
