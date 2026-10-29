import { CommandPalette, PaletteActions, type PaletteAction, type PaletteMode } from '@dshfiles/command-palette/palette-contract'
import type { PluginContext } from '@dshfiles/dshx/client'

const DEFAULT_RECENT_LIMIT = 10

let sidebarPlugin: PluginContext | undefined
let recentLimit = DEFAULT_RECENT_LIMIT

const activePalette = () => {
  const live = sidebarPlugin?.use(CommandPalette).get()
  return live?.status === 'active' ? live.value : undefined
}

/**
 * Give the sidebar's React surfaces this plugin's context. Not every sidebar component renders through the dshx
 * decorator, so they reach the palette through this bridge instead of `usePlugin()`.
 * @returns a disposer that disconnects it again.
 */
const connect = (plugin: PluginContext): (() => void) => {
  sidebarPlugin = plugin
  // The palette may load after the sidebar: apply the wanted recent limit whenever it becomes active.
  const stop = plugin.keyed(plugin.use(CommandPalette), live => {
    if (live.status === 'active') live.value.setRecentLimit(recentLimit)
  })
  return () => {
    stop()
    if (sidebarPlugin === plugin) sidebarPlugin = undefined
  }
}

/** Add rows to the command palette until the returned disposer runs. */
const addActions = (actions: readonly PaletteAction[]): (() => void) => (sidebarPlugin === undefined ? () => {} : addActionsTo(sidebarPlugin, actions))

const addActionsTo = (plugin: PluginContext, actions: readonly PaletteAction[]): (() => void) => {
  const disposers = actions.map(action => plugin.add(PaletteActions, action))
  return () => {
    for (const dispose of disposers) dispose()
  }
}

const open = (mode: PaletteMode): void => activePalette()?.open(mode)

const close = (): void => activePalette()?.close()

const setRecentLimit = (limit: number): void => {
  recentLimit = limit
  activePalette()?.setRecentLimit(limit)
}

export class PaletteBridge {
  static readonly connect = connect
  static readonly addActions = addActions
  static readonly open = open
  static readonly close = close
  static readonly setRecentLimit = setRecentLimit
  static readonly defaultRecentLimit = DEFAULT_RECENT_LIMIT
}
