/**
 * What other plugins import to work with the command palette: the action registry they add rows to and the palette
 * contract they open it through. Published as the `@dshfiles/command-palette/palette` dshx module; importing it loads
 * none of the palette's runtime.
 */
import { defineContract, defineRegistry, type Subscribable } from '@dshfiles/dshx/client'
import type { ReactNode } from 'react'

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

export type PaletteMode = 'all' | 'threads' | 'files' | 'backlog'
export type PaletteThemePreference = 'light' | 'dark' | 'system'

/** Read-only snapshot of where the user is; it holds no Service objects. */
export interface PaletteActionContext {
  readonly thread: PaletteThread | null
  readonly workspace: PaletteWorkspace | null
  readonly workspaces: readonly PaletteWorkspace[]
  readonly themePreference: PaletteThemePreference
}

/** One palette row. Its id starts with the contributing package scope: `@scope/plugin/...`. */
export interface PaletteAction {
  readonly id: string
  readonly label: string | (() => string)
  readonly aliases?: readonly string[]
  /** Key specs that run the same verb (`Mod+K`, `E`, `G I`); every row shows them as keycaps. */
  readonly keys?: readonly string[]
  /** A Host shortcut registry id (`commandPalette.newThread`) whose current binding the row shows when it has no `keys`. */
  readonly shortcutId?: string
  /** Listed before anything is typed, like a recently used command. */
  readonly suggested?: boolean
  readonly icon?: ReactNode
  /**
   * `thread` rows act on the thread the user is on (the focused or selected list row, else the open thread) and list
   * first, under their `heading` ("Actions for “Fix auth”").
   */
  readonly group?: 'destination' | 'command' | 'action' | 'thread'
  /** The section title a `thread` row lists under; the first available row's heading names the section. */
  readonly heading?: string | (() => string)
  readonly isAvailable?: (context: PaletteActionContext) => boolean
  readonly isSelected?: (context: PaletteActionContext) => boolean
  readonly run: (context: PaletteActionContext) => void | Promise<void>
}

export interface CommandPaletteState {
  readonly mode: PaletteMode | null
  readonly recentLimit: number
}

/** The palette itself, provided while `@dshfiles/command-palette` runs. */
export interface CommandPaletteService {
  open(mode: PaletteMode): void
  close(): void
  /** How many recent threads the palette lists, 1 to 50. */
  setRecentLimit(recentLimit: number): void
  readonly state: Subscribable<CommandPaletteState>
}

/** The colour one project wears: a theme-aware class that sets `color:`, or a CSS colour the operator picked. */
export interface PaletteProjectColor {
  readonly className?: string
  readonly color?: string
}

/** Paints a thread row's project mark, so a project wears the same colour in the palette as in the thread list. */
export interface PaletteProjectColorSource {
  /** `path` is the project folder (a thread workspace resolves to the repository it was cut from), `title` its name. */
  readonly colorOf: (project: { readonly path: string | undefined; readonly title: string }) => PaletteProjectColor | undefined
}

/** The plugin that owns project colours adds one source; the latest wins. Without one, project marks stay neutral ink. */
export const PaletteProjectColors = defineRegistry<PaletteProjectColorSource>('@dshfiles/command-palette.project-color')

/** Rows other plugins add with `api.add(PaletteActions, action)`; they wait here while the palette loads. */
export const PaletteActions = defineRegistry<PaletteAction>('@dshfiles/command-palette.action')

export const CommandPalette = defineContract<CommandPaletteService>('@dshfiles/command-palette.palette', { owner: '@dshfiles/command-palette' })
