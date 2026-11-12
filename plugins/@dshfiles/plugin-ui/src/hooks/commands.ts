import { Command, type CommandItem, type PluginContext } from '@dshfiles/dshx/client'
import { useEffect, useRef } from 'react'

/**
 * Contribute dshx `Command`s while a component is mounted: list verbs bound to `J`, `E`, … for this list instance, a
 * triage bar's keys while it shows. One registry serves the keys (`@dshfiles/shortcuts`), the palette and the `?`
 * sheet, so a verb added here is listed and bound in all three.
 *
 * The commands re-register only when what the registry shows changes (id, title, keys, scope, enabled, hidden,
 * section); `run` and `region` always call the latest render's closures, so a command never acts on stale state.
 * Pass the plugin context (`usePlugin()` or a bridge); without one, nothing registers.
 */
export const useCommands = (plugin: PluginContext | undefined, commands: readonly CommandItem[]): void => {
  const latest = useRef(commands)
  latest.current = commands
  const signature = commands
    .map(command =>
      [
        command.id,
        command.title,
        (command.keys ?? []).join(','),
        command.scope ?? '',
        command.section ?? '',
        String(command.enabled ?? true),
        String(command.hidden ?? false),
      ].join('\u0001'),
    )
    .join('\u0002')
  useEffect(() => {
    if (plugin === undefined) return
    const current = (id: string): CommandItem | undefined => latest.current.find(command => command.id === id)
    const disposers = latest.current.map(command => {
      const { run: _run, region, ...rest } = command
      const entry = {
        ...rest,
        run: (trigger: Parameters<CommandItem['run']>[0]) => {
          const live = current(command.id)
          return live === undefined ? false : live.run(trigger)
        },
      }
      return plugin.add(Command, region === undefined ? entry : { ...entry, region: () => current(command.id)?.region?.() })
    })
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [plugin, signature])
}
