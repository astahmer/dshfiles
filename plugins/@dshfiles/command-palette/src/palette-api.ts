import type { ReactNode } from 'react'
import { z } from 'zod'

export interface PaletteWorkspace {
  readonly id: string
  readonly title: string
}

export interface PaletteThread {
  readonly id: string
  readonly title: string
  readonly cwd: string
  readonly workspaceId: string | undefined
  readonly pinned: boolean
  readonly archived: boolean
}

export type PaletteMode = 'all' | 'threads' | 'files'
export type PaletteThemePreference = 'light' | 'dark' | 'system'
export const PALETTE_EVENT = 'dshfiles:command-palette'

export interface PaletteActionContext {
  readonly thread: PaletteThread | null
  readonly workspace: PaletteWorkspace | null
  readonly workspaces: readonly PaletteWorkspace[]
  readonly themePreference: PaletteThemePreference
}

export interface PaletteAction {
  readonly id: string
  readonly label: string | (() => string)
  readonly aliases?: readonly string[]
  readonly keys?: readonly string[]
  readonly icon?: ReactNode
  readonly group?: 'destination' | 'command' | 'action'
  readonly isAvailable?: (context: PaletteActionContext) => boolean
  readonly isSelected?: (context: PaletteActionContext) => boolean
  readonly run: (context: PaletteActionContext) => void | Promise<void>
}

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

declare global {
  interface Window {
    __dshfilesCommandPaletteV1?: PaletteRegistry
  }
}

const isActionLabel = (value: unknown): value is string | (() => string) => typeof value === 'string' || typeof value === 'function'
const isOptionalAction = (value: unknown): value is ((context: PaletteActionContext) => boolean) | undefined =>
  value === undefined || typeof value === 'function'
const isActionRun = (value: unknown): value is PaletteAction['run'] => typeof value === 'function'

const paletteActionSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^@[^/]+\/.+/u)
    .max(180),
  label: z.custom<PaletteAction['label']>(isActionLabel),
  aliases: z.array(z.string().trim().min(1)).max(20).exactOptional(),
  keys: z.array(z.string().trim().min(1)).max(5).exactOptional(),
  icon: z.custom<ReactNode>().exactOptional(),
  group: z.enum(['destination', 'command', 'action']).exactOptional(),
  isAvailable: z.custom<NonNullable<PaletteAction['isAvailable']>>(isOptionalAction).exactOptional(),
  isSelected: z.custom<NonNullable<PaletteAction['isSelected']>>(isOptionalAction).exactOptional(),
  run: z.custom<PaletteAction['run']>(isActionRun),
})

const registry = (): PaletteRegistry => {
  const current = window.__dshfilesCommandPaletteV1
  if (current !== undefined) return current
  const created: PaletteRegistry = {
    actions: new Map(),
    listeners: new Set(),
    mode: null,
    recentLimit: 10,
    snapshot: { actions: [], mode: null, recentLimit: 10 },
  }
  window.__dshfilesCommandPaletteV1 = created
  return created
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
  const parsed = paletteActionSchema.safeParse(input)
  if (!parsed.success) throw new Error('Command palette action has an invalid definition.')
  const current = registry()
  if (current.actions.has(parsed.data.id)) throw new Error(`Command palette action id is already registered: ${parsed.data.id}`)
  current.actions.set(parsed.data.id, parsed.data)
  notify(current)
  return () => {
    if (current.actions.get(parsed.data.id) !== parsed.data) return
    current.actions.delete(parsed.data.id)
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
  const parsed = z.number().int().min(1).max(50).parse(recentLimit)
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
