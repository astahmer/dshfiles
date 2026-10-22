export const jevNeedsSecretSetup = async (input: { readonly enabled: boolean; readonly resolveKey: () => Promise<string | undefined> }): Promise<boolean> => {
  if (!input.enabled) return false
  try {
    return (await input.resolveKey()) === undefined
  } catch {
    return true
  }
}
