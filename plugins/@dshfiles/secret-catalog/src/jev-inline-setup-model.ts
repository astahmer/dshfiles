export type JevSetupView = 'hidden' | 'offer' | 'repair'

/**
 * A configured reference is checked by the Secret Catalog's own status verb (the repair card hides itself while it
 * resolves); only an empty setting asks Backlog whether the environment fallback already supplies a key.
 */
export const jevSetupView = (input: { readonly enabled: boolean; readonly needsSetup: boolean; readonly reference: string }): JevSetupView => {
  if (!input.enabled) return 'hidden'
  if (input.reference.trim() !== '') return 'repair'
  return input.needsSetup ? 'offer' : 'hidden'
}
