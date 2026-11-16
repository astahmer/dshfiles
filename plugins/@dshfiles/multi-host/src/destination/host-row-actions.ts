export type HostRowVerb =
  | 'open'
  | 'copy-link'
  | 'diagnose'
  | 'clone'
  | 'sync'
  | 'add-folder'
  | 'link-back'
  | 'reconnect'
  | 'edit'
  | 'hide'
  | 'move-up'
  | 'move-down'
  | 'remove'

/**
 * What one host row offers: at most one inline verb, and a menu holding everything else. A row is not a toolbar: an
 * SSH host leads with Open host (Diagnose once it failed), and no other control sits beside it.
 */
export const hostRowActions = (input: {
  readonly kind: string
  readonly failed: boolean
}): { readonly inline: HostRowVerb | null; readonly menu: readonly HostRowVerb[] } => {
  const arrange: readonly HostRowVerb[] = ['hide', 'move-up', 'move-down', 'remove']
  if (input.kind === 'local') return { inline: null, menu: ['reconnect', ...arrange] }
  if (input.kind !== 'ssh') return { inline: null, menu: ['add-folder', 'link-back', 'reconnect', ...arrange] }
  return {
    inline: input.failed ? 'diagnose' : 'open',
    menu: [...(input.failed ? (['open'] as const) : []), 'copy-link', 'clone', 'sync', 'add-folder', 'link-back', 'reconnect', 'edit', ...arrange],
  }
}
