import { Option } from 'effect'
import * as Schema from 'effect/Schema'
import type { ReactNode } from 'react'

import type { PaletteAction, PaletteActionContext, PaletteMode } from './palette-contract.js'

interface PaletteApiSnapshot {
  readonly actions: readonly PaletteAction[]
  readonly mode: PaletteMode | null
  readonly recentLimit: number
}

interface PaletteRowGroup {
  rows: readonly PaletteAction[]
}

/** Rows that come and go together; `set` replaces them in one change instead of one per row. */
interface PaletteRows {
  readonly set: (actions: readonly PaletteAction[]) => void
  readonly dispose: () => void
}

interface PaletteRegistry {
  readonly groups: Set<PaletteRowGroup>
  readonly owners: Map<string, PaletteRowGroup>
  readonly listeners: Set<() => void>
  mode: PaletteMode | null
  recentLimit: number
  dirty: boolean
  snapshot: PaletteApiSnapshot
}

const isActionLabel = (value: unknown): value is string | (() => string) => typeof value === 'string' || typeof value === 'function'
const isActionCallback = (value: unknown): value is (context: PaletteActionContext) => boolean => typeof value === 'function'
const isActionRun = (value: unknown): value is PaletteAction['run'] => typeof value === 'function'

const actionLabelSchema = Schema.declare<PaletteAction['label']>(isActionLabel)
const optionalActionCallbackSchema = Schema.declare<(context: PaletteActionContext) => boolean>(isActionCallback)
const actionRunSchema = Schema.declare<PaletteAction['run']>(isActionRun)
const reactNodeSchema = Schema.declare<ReactNode>((_value): _value is ReactNode => true)

const paletteActionSchema = Schema.Struct({
  id: Schema.Trim.check(Schema.isPattern(/^@[^/]+\/.+/u), Schema.isMaxLength(180)),
  label: actionLabelSchema,
  aliases: Schema.optionalKey(Schema.Array(Schema.Trim.check(Schema.isMinLength(1))).check(Schema.isMaxLength(20))),
  keys: Schema.optionalKey(Schema.Array(Schema.Trim.check(Schema.isMinLength(1))).check(Schema.isMaxLength(5))),
  suggested: Schema.optionalKey(Schema.Boolean),
  icon: Schema.optionalKey(reactNodeSchema),
  group: Schema.optionalKey(Schema.Literals(['destination', 'command', 'action'])),
  isAvailable: Schema.optionalKey(optionalActionCallbackSchema),
  isSelected: Schema.optionalKey(optionalActionCallbackSchema),
  run: actionRunSchema,
})

const recentLimitSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(50))

let paletteRegistry: PaletteRegistry | undefined

/** The palette's own rows and open state; other plugins reach it through the `palette-contract` registry and contract. */
const registry = (): PaletteRegistry => {
  paletteRegistry ??= {
    groups: new Set(),
    owners: new Map(),
    listeners: new Set(),
    mode: null,
    recentLimit: 10,
    dirty: false,
    snapshot: { actions: [], mode: null, recentLimit: 10 },
  }
  return paletteRegistry
}

const refreshSnapshot = (current: PaletteRegistry): PaletteApiSnapshot => {
  if (!current.dirty) return current.snapshot
  current.dirty = false
  const actions = [...current.groups].flatMap(group => group.rows)
  const previous = current.snapshot
  if (
    previous.mode === current.mode &&
    previous.recentLimit === current.recentLimit &&
    previous.actions.length === actions.length &&
    previous.actions.every((action, index) => action === actions[index])
  )
    return previous
  current.snapshot = { actions, mode: current.mode, recentLimit: current.recentLimit }
  return current.snapshot
}

const notify = (current: PaletteRegistry): void => {
  current.dirty = true
  refreshSnapshot(current)
  for (const listener of current.listeners) listener()
}

const decodeAction = Schema.decodeUnknownOption(paletteActionSchema)

const releaseRows = (current: PaletteRegistry, group: PaletteRowGroup): void => {
  for (const action of group.rows) if (current.owners.get(action.id) === group) current.owners.delete(action.id)
}

/** Register a browser-local action and return its lifecycle disposer. */
const registerPaletteAction = (input: PaletteAction): (() => void) => {
  const parsed = decodeAction(input)
  if (Option.isNone(parsed)) throw new Error('Command palette action has an invalid definition.')
  const action = parsed.value
  const current = registry()
  if (current.owners.has(action.id)) throw new Error(`Command palette action id is already registered: ${action.id}`)
  const group: PaletteRowGroup = { rows: [action] }
  current.groups.add(group)
  current.owners.set(action.id, group)
  notify(current)
  return () => {
    if (!current.groups.delete(group)) return
    releaseRows(current, group)
    notify(current)
  }
}

/**
 * Open a set of rows replaced as a whole. A row with an invalid definition or an id another row holds is left out
 * with a warning instead of breaking the rest; a `set` that keeps every row as it was notifies nobody.
 */
const openPaletteRows = (): PaletteRows => {
  const current = registry()
  const group: PaletteRowGroup = { rows: [] }
  current.groups.add(group)
  let decoded = new Map<PaletteAction, PaletteAction>()
  return {
    set: actions => {
      if (!current.groups.has(group)) return
      releaseRows(current, group)
      const nextDecoded = new Map<PaletteAction, PaletteAction>()
      const rows: PaletteAction[] = []
      for (const input of actions) {
        const known = decoded.get(input) ?? nextDecoded.get(input)
        const parsed = known === undefined ? decodeAction(input) : Option.some(known)
        if (Option.isNone(parsed)) {
          console.warn(`command-palette: ${String(input.id)} is not listed`, new Error('Command palette action has an invalid definition.'))
          continue
        }
        const action = parsed.value
        if (current.owners.has(action.id)) {
          console.warn(`command-palette: ${action.id} is not listed`, new Error(`Command palette action id is already registered: ${action.id}`))
          continue
        }
        nextDecoded.set(input, action)
        current.owners.set(action.id, group)
        rows.push(action)
      }
      decoded = nextDecoded
      const unchanged = rows.length === group.rows.length && rows.every((action, index) => action === group.rows[index])
      if (unchanged) return
      group.rows = rows
      notify(current)
    },
    dispose: () => {
      if (!current.groups.delete(group)) return
      releaseRows(current, group)
      if (group.rows.length > 0) notify(current)
    },
  }
}

const getPaletteSnapshot = (): PaletteApiSnapshot => refreshSnapshot(registry())

const subscribePaletteActions = (listener: () => void): (() => void) => {
  const current = registry()
  current.listeners.add(listener)
  return () => current.listeners.delete(listener)
}
const setPaletteRecentLimit = (recentLimit: number): void => {
  const parsed = Schema.decodeUnknownSync(recentLimitSchema)(recentLimit)
  const current = registry()
  if (current.recentLimit === parsed) return
  current.recentLimit = parsed
  notify(current)
}
const openPalette = (mode: PaletteMode): void => {
  const current = registry()
  current.mode = mode
  notify(current)
}
const closePalette = (): void => {
  const current = registry()
  current.mode = null
  notify(current)
}

export class PaletteApi {
  static readonly getSnapshot = getPaletteSnapshot
  static readonly subscribe = subscribePaletteActions
  static readonly registerAction = registerPaletteAction
  static readonly openRows = openPaletteRows
  static readonly setRecentLimit = setPaletteRecentLimit
  static readonly open = openPalette
  static readonly close = closePalette
}
