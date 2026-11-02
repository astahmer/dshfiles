import { Option } from 'effect'
import * as Schema from 'effect/Schema'
import type { ReactNode } from 'react'

import type { PaletteAction, PaletteActionContext, PaletteMode } from './palette-contract.js'

interface PaletteApiSnapshot {
  readonly actions: readonly PaletteAction[]
  readonly mode: PaletteMode | null
  readonly recentLimit: number
}

interface PaletteRegistry {
  readonly actions: Map<string, PaletteAction>
  readonly listeners: Set<() => void>
  mode: PaletteMode | null
  recentLimit: number
  snapshot?: PaletteApiSnapshot
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
    actions: new Map(),
    listeners: new Set(),
    mode: null,
    recentLimit: 10,
    snapshot: { actions: [], mode: null, recentLimit: 10 },
  }
  return paletteRegistry
}

const refreshSnapshot = (current: PaletteRegistry): PaletteApiSnapshot => {
  const actions = [...current.actions.values()]
  const previous = current.snapshot
  if (
    previous !== undefined &&
    previous.mode === current.mode &&
    previous.recentLimit === current.recentLimit &&
    previous.actions.length === actions.length &&
    previous.actions.every((action, index) => action === actions[index])
  )
    return previous
  const next = { actions, mode: current.mode, recentLimit: current.recentLimit }
  current.snapshot = next
  return next
}

const notify = (current: PaletteRegistry): void => {
  refreshSnapshot(current)
  for (const listener of current.listeners) listener()
}

/** Register a browser-local action and return its lifecycle disposer. */
const registerPaletteAction = (input: PaletteAction): (() => void) => {
  const parsed = Schema.decodeUnknownOption(paletteActionSchema)(input)
  if (Option.isNone(parsed)) throw new Error('Command palette action has an invalid definition.')
  const action = parsed.value
  const current = registry()
  if (current.actions.has(action.id)) throw new Error(`Command palette action id is already registered: ${action.id}`)
  current.actions.set(action.id, action)
  notify(current)
  return () => {
    if (current.actions.get(action.id) !== action) return
    current.actions.delete(action.id)
    notify(current)
  }
}

const getPaletteSnapshot = (): PaletteApiSnapshot => refreshSnapshot(registry())

const subscribePaletteActions = (listener: () => void): (() => void) => {
  const current = registry()
  const onChange = (): void => {
    refreshSnapshot(current)
    listener()
  }
  current.listeners.add(onChange)
  return () => current.listeners.delete(onChange)
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
  static readonly setRecentLimit = setPaletteRecentLimit
  static readonly open = openPalette
  static readonly close = closePalette
}
