export type JevSetupView = 'hidden' | 'offer' | 'reference-unresolved'

export const jevSetupView = (input: { readonly enabled: boolean; readonly needsSetup: boolean; readonly reference: string }): JevSetupView => {
  if (!input.enabled || !input.needsSetup) return 'hidden'
  if (input.reference.trim() !== '') return 'reference-unresolved'
  return 'offer'
}
