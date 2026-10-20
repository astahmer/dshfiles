import { parseSecretReference, type SecretCatalogValues } from '@dshfiles/credential-port'

/**
 * Which key Jev answers with: the bound Secret Catalog alias when the setting holds a reference, otherwise the Host
 * environment. Only this module's caller sees the value, so it is resolved on the Host and never stored in settings.
 */
export class BacklogTriageKey {
  static async resolve(input: {
    readonly referenceText: string
    readonly values: Pick<SecretCatalogValues, 'resolve'> | undefined
    readonly environmentKey: string | undefined
  }): Promise<string | undefined> {
    const reference = parseSecretReference(input.referenceText)
    if (reference !== null) {
      if (input.values === undefined) throw new Error('The Secret Catalog plugin is not loaded, so the bound Jev key cannot be resolved.')
      return input.values.resolve({ reference, cwd: null })
    }
    if (input.referenceText.trim() !== '') throw new Error('The bound Jev key is not a secret:ALIAS or secret:ALIAS@env reference.')
    return input.environmentKey === undefined || input.environmentKey === '' ? undefined : input.environmentKey
  }
}
