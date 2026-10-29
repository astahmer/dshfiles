import type { CommandItem } from '@dshfiles/dshx/client'
import { PaletteApi } from './palette-api.js'
import type { PaletteAction } from './palette-contract.js'

const PALETTE_ACTION_ID = /^@[^/]+\/.+/u

/** The palette row of one contributed command, or undefined when the palette does not list it. */
const toPaletteAction = (command: CommandItem, keys: readonly string[] | undefined = command.keys): PaletteAction | undefined => {
  if (command.hidden === true || !PALETTE_ACTION_ID.test(command.id)) return undefined
  return {
    id: command.id,
    label: command.title,
    group: 'command',
    ...(command.keywords !== undefined && { aliases: command.keywords.slice(0, 20) }),
    ...(keys !== undefined && keys.length > 0 && { keys: keys.slice(0, 5) }),
    ...(command.suggested === true && { suggested: true }),
    isAvailable: () => command.enabled !== false,
    run: async () => {
      await command.run()
    },
  }
}

/**
 * List every contributed command in the palette with the keys it answers to now.
 *
 * Commands whose id lacks the package scope stay out with a warning: the
 * palette keys its frecency and dedupe by that scoped id.
 * @returns a disposer removing the rows it added.
 */
const listContributedCommands = (commands: readonly CommandItem[], keys: ReadonlyMap<string, readonly string[]>): (() => void) => {
  const disposers = commands.flatMap(command => {
    const action = toPaletteAction(command, keys.get(command.id))
    if (action === undefined) {
      if (command.hidden !== true)
        console.warn(`command-palette: ${command.id} is not listed; command ids start with the package scope, e.g. @acme/plugin.open.`)
      return []
    }
    try {
      return [PaletteApi.registerAction(action)]
    } catch (error) {
      console.warn(`command-palette: ${command.id} is not listed`, error)
      return []
    }
  })
  return () => {
    for (const dispose of disposers) dispose()
  }
}

/**
 * List every row other plugins added to the `PaletteActions` registry.
 *
 * A row with an invalid definition or an id another row holds is left out with a warning instead of breaking the rest.
 * @returns a disposer removing the rows it added.
 */
const listContributedActions = (actions: readonly PaletteAction[]): (() => void) => {
  const disposers = actions.flatMap(action => {
    try {
      return [PaletteApi.registerAction(action)]
    } catch (error) {
      console.warn(`command-palette: ${action.id} is not listed`, error)
      return []
    }
  })
  return () => {
    for (const dispose of disposers) dispose()
  }
}

export class ContributedCommandsModel {
  static readonly toPaletteAction = toPaletteAction
  static readonly list = listContributedCommands
  static readonly listActions = listContributedActions
}
