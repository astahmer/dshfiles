import type { CommandItem } from '@dshfiles/dshx/client'
import { PaletteApi, type PaletteAction } from './palette-api.js'

const PALETTE_ACTION_ID = /^@[^/]+\/.+/u

/** The palette row of one contributed command, or undefined when the palette does not list it. */
const toPaletteAction = (command: CommandItem): PaletteAction | undefined => {
  if (command.hidden === true || !PALETTE_ACTION_ID.test(command.id)) return undefined
  return {
    id: command.id,
    label: command.title,
    group: 'command',
    ...(command.keywords !== undefined && { aliases: command.keywords.slice(0, 20) }),
    ...(command.keys !== undefined && { keys: command.keys.slice(0, 5) }),
    isAvailable: () => command.enabled !== false,
    run: async () => {
      await command.run()
    },
  }
}

/**
 * List every contributed command in the palette.
 *
 * Commands whose id lacks the package scope stay out with a warning: the
 * palette keys its frecency and dedupe by that scoped id.
 * @returns a disposer removing the rows it added.
 */
const listContributedCommands = (commands: readonly CommandItem[]): (() => void) => {
  const disposers = commands.flatMap(command => {
    const action = toPaletteAction(command)
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

export class ContributedCommandsModel {
  static readonly toPaletteAction = toPaletteAction
  static readonly list = listContributedCommands
}
