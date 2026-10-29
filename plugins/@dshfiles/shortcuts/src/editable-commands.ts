import { CommandChords, type CommandItem } from '@dshfiles/dshx/client'

interface HostShortcutCommand {
  readonly id: string
  readonly label: () => string
  readonly aliases: readonly string[]
  readonly defaults: Readonly<Record<string, never>>
  readonly regions: readonly ('page' | 'editable')[]
  readonly modals: readonly string[]
  resolve(): { readonly status: 'pass' }
}

const isShortcutRegistry = (value: unknown): value is { register(command: HostShortcutCommand): () => void } =>
  typeof value === 'object' && value !== null && 'register' in value && typeof value.register === 'function'

/**
 * Lists editable commands in the Host's shortcut registry, which Settings › Shortcuts edits.
 *
 * The registry only stores the user's binding: its `resolve` passes, and this plugin's capture-phase listener runs the
 * command on the keys `api.commands.keys` reads back, so a key press never runs it twice. The row carries no default
 * binding: the Host throws on overlapping defaults in whichever plugin registers second, so a default here could stop
 * a core plugin's setup (frame-layout's `sidebar.left.toggle` holds Mod+B). Until the user binds one, the command's
 * own `keys` apply.
 */
export class EditableCommands {
  static register = (input: { readonly shortcuts: unknown; readonly commands: readonly CommandItem[] }): (() => void) => {
    const registry = input.shortcuts
    if (!isShortcutRegistry(registry)) return () => {}
    const disposers = input.commands.flatMap(command => {
      if (command.editable !== true) return []
      const id = CommandChords.shortcutId(command.id)
      if (id === undefined) {
        console.warn(`shortcuts: ${command.id} cannot be listed in Settings › Shortcuts; its id has no Host shortcut form.`)
        return []
      }
      try {
        return [
          registry.register({
            id,
            label: () => command.title,
            aliases: command.keywords ?? [],
            defaults: {},
            regions: command.scope === 'page' ? ['page'] : ['page', 'editable'],
            modals: [],
            resolve: () => ({ status: 'pass' }),
          }),
        ]
      } catch (error) {
        console.warn(`shortcuts: ${command.id} is not listed in Settings › Shortcuts`, error)
        return []
      }
    })
    return () => {
      for (const dispose of disposers) dispose()
    }
  }
}
