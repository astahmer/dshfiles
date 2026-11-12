import type { AttentionItem } from './attention-api.js'

/**
 * What Enter does to an item in Triage: its one obvious next step. Answer only with a recommended choice (the provider
 * said which), never a guess; Land only opens its confirmation, it never runs from a key; otherwise the item opens.
 */
export type PrimaryAction =
  | { readonly kind: 'answer'; readonly choiceId: string; readonly label: string }
  | { readonly kind: 'verb'; readonly verb: 'Approve' | 'Retry' | 'Resume' }
  | { readonly kind: 'land' }
  | { readonly kind: 'open' }

const primaryOf = (item: AttentionItem): PrimaryAction => {
  if (item.verbs.includes('Answer')) {
    const recommended = item.choices.find(choice => choice.recommended === true)
    if (recommended !== undefined) return { kind: 'answer', choiceId: recommended.id, label: recommended.label }
    return { kind: 'open' }
  }
  for (const verb of ['Approve', 'Retry', 'Resume'] as const) if (item.verbs.includes(verb)) return { kind: 'verb', verb }
  if (item.verbs.includes('Land')) return { kind: 'land' }
  return { kind: 'open' }
}

/** The choice a digit names (`1` is the first), when the item asks a question. */
const choiceAt = (item: AttentionItem, digit: number): string | undefined =>
  item.verbs.includes('Answer') && Number.isInteger(digit) && digit >= 1 ? item.choices[digit - 1]?.id : undefined

/** Step the highlight through the list, clamped; with nothing highlighted, the first step lands on the first row. */
const step = (ids: readonly string[], current: string | null, direction: 1 | -1): string | null => {
  if (ids.length === 0) return null
  const index = current === null ? -1 : ids.indexOf(current)
  if (index === -1) return direction === 1 ? (ids[0] ?? null) : (ids.at(-1) ?? null)
  return ids[Math.max(0, Math.min(ids.length - 1, index + direction))] ?? null
}

/**
 * Where the highlight goes once a row leaves the list (Done, Snooze): the row that took its place, else the one above,
 * so a run of E presses walks down the list without the highlight jumping to the top.
 */
const afterRemoval = (previousIds: readonly string[], nextIds: readonly string[], removed: string): string | null => {
  const index = previousIds.indexOf(removed)
  if (index === -1) return nextIds[0] ?? null
  for (const candidate of previousIds.slice(index + 1)) if (nextIds.includes(candidate)) return candidate
  for (const candidate of previousIds.slice(0, index).reverse()) if (nextIds.includes(candidate)) return candidate
  return null
}

/** Extend a range selection from the anchor to the highlight, as Shift with J/K does in a list. */
const extend = (ids: readonly string[], anchor: string | null, to: string): readonly string[] => {
  const from = anchor === null ? -1 : ids.indexOf(anchor)
  const end = ids.indexOf(to)
  if (end === -1) return []
  if (from === -1) return [to]
  return ids.slice(Math.min(from, end), Math.max(from, end) + 1)
}

export const InboxKeys = { primaryOf, choiceAt, step, afterRemoval, extend } as const
