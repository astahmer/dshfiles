import { CommandKeys, type CommandItem } from '@dshfiles/dshx/client'
import { ShortcutKeyboardModel, type ShortcutBinding } from './keyboard.js'

/**
 * Bind the keys every contributed command answers to now: its defaults, or the user's binding when it is editable.
 *
 * A key spec the grammar cannot read stays unbound with one warning per command and spec, so a typo is visible
 * without flooding the console on every catalog change.
 */
const warned = new Set<string>()

const toBindings = (commands: readonly CommandItem[], keys: ReadonlyMap<string, readonly string[]>): ShortcutBinding[] =>
  commands.flatMap(command =>
    (keys.get(command.id) ?? command.keys ?? []).flatMap((spec): ShortcutBinding[] => {
      const parsed = CommandKeys.parse(spec)
      if (parsed === undefined) {
        const key = `${command.id}\u0000${spec}`
        if (!warned.has(key)) {
          warned.add(key)
          console.warn(`shortcuts: ${command.id} keeps ${spec} unbound; write a chord (Mod+K), a key (J, Shift+J, ?) or a sequence (G I).`)
        }
        return []
      }
      return [
        {
          id: command.id,
          keys: parsed,
          scope: ShortcutKeyboardModel.normalizeScope(command.scope),
          ...(command.region !== undefined && { region: command.region }),
          ...(command.allowInTerminal !== undefined && { allowInTerminal: command.allowInTerminal }),
          label: command.title,
          run: trigger => {
            if (command.enabled === false) return false
            const result = command.run({
              keys: trigger.keys,
              event: trigger.event,
            })
            if (result === false) return false
            if (result instanceof Promise) result.catch((error: unknown) => console.error(`shortcuts: ${command.id} failed`, error))
          },
        },
      ]
    }),
  )

export class CommandBindings {
  static readonly toBindings = toBindings
}
