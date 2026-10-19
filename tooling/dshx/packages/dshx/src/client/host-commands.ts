/**
 * Host command execution from plugin UI.
 *
 * The public Shortcuts service lists commands but only runs them from a key
 * press; its registry's `invoke` is what the Desktop menu uses. The registry is
 * not part of the published `Shortcuts` type, so it is read structurally and a
 * Host without it simply reports "cannot run".
 */

interface HostShortcutRegistry {
  readonly invoke: (commandId: string, scope: { readonly region: 'page'; readonly modal: null; readonly target: Element | null }) => void
}

/** Whether this Host publishes the command registry behind its Shortcuts service. */
export const hasHostCommandRegistry = <Shortcuts>(shortcuts: Shortcuts): shortcuts is Shortcuts & { readonly registry: HostShortcutRegistry } =>
  typeof shortcuts === 'object' &&
  shortcuts !== null &&
  'registry' in shortcuts &&
  typeof shortcuts.registry === 'object' &&
  shortcuts.registry !== null &&
  'invoke' in shortcuts.registry &&
  typeof shortcuts.registry.invoke === 'function'

/**
 * Run one Host command by id, as a menu entry would.
 * @param shortcuts - the client's Shortcuts service.
 * @param commandId - Host command id, e.g. `settings.open`.
 * @returns whether the command was handed to the Host.
 */
export const runHostCommand = <Shortcuts>(shortcuts: Shortcuts, commandId: string): boolean => {
  if (!hasHostCommandRegistry(shortcuts)) return false
  try {
    shortcuts.registry.invoke(commandId, { region: 'page', modal: null, target: document.activeElement })
    return true
  } catch (error) {
    console.warn(`dshx: the ${commandId} command failed`, error)
    return false
  }
}
