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
  readonly keys?: readonly string[]
  /** Listed before anything is typed, like a recently used command. */
  readonly suggested?: boolean
  readonly icon?: ReactNode
  readonly group?: 'destination' | 'command' | 'action'
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

/** Rows other plugins add with `api.add(PaletteActions, action)`; they wait here while the palette loads. */
export const PaletteActions = defineRegistry<PaletteAction>('@dshfiles/command-palette.action')

export const CommandPalette = defineContract<CommandPaletteService>('@dshfiles/command-palette.palette', { owner: '@dshfiles/command-palette' })
