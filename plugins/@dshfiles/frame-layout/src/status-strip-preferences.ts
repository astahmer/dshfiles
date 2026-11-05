import { StatusStripModel, type StatusItem } from './status-strip.ts'

/** The user's status bar choices: `hiddenStatusItems` and `statusItemOrder` in the `dshfiles-frame-layout` namespace. */
export interface StatusStripPreferences {
  readonly hidden: readonly string[]
  readonly order: readonly string[]
}

interface SidedItems {
  readonly global: readonly StatusItem[]
  readonly thread: readonly StatusItem[]
}

export const DEFAULT_STATUS_STRIP_PREFERENCES: StatusStripPreferences = { hidden: [], order: [] }

/** Saved ids first, in their saved order; an unsaved item goes right after the item that precedes it by default. */
const applyOrder = (defaults: readonly StatusItem[], order: readonly string[]): readonly StatusItem[] => {
  const byId = new Map(defaults.map(item => [item.id, item]))
  const placed: StatusItem[] = [...new Set(order)].flatMap(id => {
    const item = byId.get(id)
    return item === undefined ? [] : [item]
  })
  for (const [index, item] of defaults.entries()) {
    if (placed.includes(item)) continue
    const previous = defaults.slice(0, index).findLast(candidate => placed.includes(candidate))
    placed.splice(previous === undefined ? 0 : placed.indexOf(previous) + 1, 0, item)
  }
  return placed
}

/** Every registered item per side, in the user's order, hidden ones included: what Settings lists. */
const list = (items: readonly StatusItem[], preferences: StatusStripPreferences): SidedItems => {
  const arranged = StatusStripModel.arrange(items)
  return { global: applyOrder(arranged.global, preferences.order), thread: applyOrder(arranged.thread, preferences.order) }
}

/** What the strip draws: the listed items minus the hidden ones. */
const visible = (items: readonly StatusItem[], preferences: StatusStripPreferences): SidedItems => {
  const listed = list(items, preferences)
  const hidden = new Set(preferences.hidden)
  return { global: listed.global.filter(item => !hidden.has(item.id)), thread: listed.thread.filter(item => !hidden.has(item.id)) }
}

/** Swap one item with its neighbour on the same side; ids of items not registered now keep their saved entries. */
const move = (input: {
  readonly items: readonly StatusItem[]
  readonly preferences: StatusStripPreferences
  readonly id: string
  readonly direction: 'up' | 'down'
}): StatusStripPreferences => {
  const listed = list(input.items, input.preferences)
  const globalIds = listed.global.map(item => item.id)
  const threadIds = listed.thread.map(item => item.id)
  const sideIds = globalIds.includes(input.id) ? globalIds : threadIds
  const index = sideIds.indexOf(input.id)
  const target = input.direction === 'up' ? index - 1 : index + 1
  const neighbour = sideIds[target]
  if (index === -1 || neighbour === undefined) return input.preferences
  sideIds[target] = input.id
  sideIds[index] = neighbour
  const known = new Set([...globalIds, ...threadIds])
  return { ...input.preferences, order: [...globalIds, ...threadIds, ...input.preferences.order.filter(id => !known.has(id))] }
}

const setHidden = (input: { readonly preferences: StatusStripPreferences; readonly id: string; readonly hidden: boolean }): StatusStripPreferences => {
  const without = input.preferences.hidden.filter(id => id !== input.id)
  return { ...input.preferences, hidden: input.hidden ? [...without, input.id] : without }
}

export class StatusStripPreferencesModel {
  static readonly list = list
  static readonly visible = visible
  static readonly move = move
  static readonly setHidden = setHidden
}
