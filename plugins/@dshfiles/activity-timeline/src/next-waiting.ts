import type { AttentionItem } from './attention-api.js'

/**
 * Jump to next waiting (docs/ade-ux §4.8, ⌥J): the Needs you item after the one the last jump opened, wrapping to the
 * first. An item that left the list restarts the cycle at the top.
 */
const next = (input: { readonly items: readonly Pick<AttentionItem, 'id'>[]; readonly lastId: string | null }): number | null => {
  if (input.items.length === 0) return null
  const last = input.lastId === null ? -1 : input.items.findIndex(item => item.id === input.lastId)
  return (last + 1) % input.items.length
}

export class NextWaiting {
  static readonly next = next
}
