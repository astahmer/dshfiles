import type { CommandItem } from '@dshfiles/dshx/client'
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

const sameKeys = (left: readonly string[] | undefined, right: readonly string[] | undefined): boolean =>
  left === right || (left !== undefined && right !== undefined && left.length === right.length && left.every((key, index) => key === right[index]))

/**
 * The palette rows of every contributed command with the keys it answers to now. A command whose object and keys are
 * unchanged keeps its row object, so a shortcut-catalog change re-lists nothing that did not move.
 */
const createCommandRows = (): ((commands: readonly CommandItem[], keys: ReadonlyMap<string, readonly string[]>) => readonly PaletteAction[]) => {
  let previous = new Map<CommandItem, { readonly keys: readonly string[] | undefined; readonly action: PaletteAction }>()
  return (commands, keys) => {
    const next = new Map<CommandItem, { readonly keys: readonly string[] | undefined; readonly action: PaletteAction }>()
    const rows = commands.flatMap(command => {
      const commandKeys = keys.get(command.id)
      const known = previous.get(command)
      if (known !== undefined && sameKeys(known.keys, commandKeys)) {
        next.set(command, known)
        return [known.action]
      }
      const action = toPaletteAction(command, commandKeys)
      if (action === undefined) {
        if (command.hidden !== true)
          console.warn(`command-palette: ${command.id} is not listed; command ids start with the package scope, e.g. @acme/plugin.open.`)
        return []
      }
      next.set(command, { keys: commandKeys, action })
      return [action]
    })
    previous = next
    return rows
  }
}

export class ContributedCommandsModel {
  static readonly toPaletteAction = toPaletteAction
  static readonly createCommandRows = createCommandRows
}
