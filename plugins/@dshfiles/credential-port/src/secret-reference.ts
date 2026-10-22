import { z } from 'zod'

/** The environment a reference without `@env` means; Secret Catalog writes `prod` when the user does not choose one. */
export const DEFAULT_SECRET_ENVIRONMENT = 'prod'

export const secretAliasSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, 'Start with a letter or _, then use letters, digits, _ or -.')

export const secretEnvironmentSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, _ or -.')

export interface SecretReference {
  readonly alias: string
  readonly environment: string
}

export interface ResolvedSecretCredential {
  readonly value: string
  readonly label: string
}

const referencePattern = /^secret:([A-Za-z_][A-Za-z0-9_-]*)(?:@([A-Za-z0-9_-]+))?$/

/** Parses `secret:ALIAS` or `secret:ALIAS@ENV`; null for anything else, so a field can hold prose instead. */
export const parseSecretReference = (text: string): SecretReference | null => {
  const match = referencePattern.exec(text.trim())
  if (match === null) return null
  const alias = match[1]
  if (alias === undefined) return null
  return { alias, environment: match[2] ?? DEFAULT_SECRET_ENVIRONMENT }
}

/** The canonical text for a reference: no `@env` suffix for the default environment. */
export const formatSecretReference = (reference: SecretReference): string =>
  reference.environment === DEFAULT_SECRET_ENVIRONMENT ? `secret:${reference.alias}` : `secret:${reference.alias}@${reference.environment}`

export const secretReferenceSchema = z
  .string()
  .max(4096)
  .transform((text, context) => {
    const reference = parseSecretReference(text)
    if (reference === null) {
      context.addIssue({ code: 'custom', message: 'Use secret:ALIAS or secret:ALIAS@ENV.' })
      return z.NEVER
    }
    return reference
  })

export const secretCredentialLabelSchema = z
  .string()
  .max(400)
  .transform((text, context) => {
    const reference = parseSecretReference(text)
    if (reference !== null) return formatSecretReference(reference)
    if (text.startsWith('env:')) {
      const variableName = secretAliasSchema.safeParse(text.slice('env:'.length))
      if (variableName.success) return text
    }
    context.addIssue({ code: 'custom', message: 'Use a secret reference or env:VARIABLE_NAME label.' })
    return z.NEVER
  })

/** One reference resolved for a folder: `project`/`local` aliases come from that folder's config, `global` needs none. */
export interface SecretReferenceResolution {
  readonly reference: SecretReference
  readonly cwd: string | null
}

/**
 * The Host-side value port: a consumer resolves a stored reference at the moment it uses the credential. The value
 * never travels to a Client, which is why this is separate from the browser-facing Secret Catalog API.
 */
export interface SecretCatalogValues {
  resolve(input: SecretReferenceResolution): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    secretCatalogValues?: SecretCatalogValues
  }
}

/**
 * The key a Host feature uses for an API: the bound reference when the setting holds one, otherwise the process
 * environment variable it has always read. Resolving here keeps the value on the Host and gives every consumer one
 * error vocabulary for a bad binding.
 */
export class SecretReferenceResolver {
  static async resolve(input: {
    readonly referenceText: string
    readonly values: Pick<SecretCatalogValues, 'resolve'> | undefined
    readonly environmentValue: string | undefined
  }): Promise<string | undefined> {
    return (await SecretReferenceResolver.resolveWithLabel({ ...input, environmentVariableName: 'environment' }))?.value
  }

  static async resolveWithLabel(input: {
    readonly referenceText: string
    readonly values: Pick<SecretCatalogValues, 'resolve'> | undefined
    readonly environmentValue: string | undefined
    readonly environmentVariableName: string
  }): Promise<ResolvedSecretCredential | undefined> {
    const reference = parseSecretReference(input.referenceText)
    if (reference !== null) {
      if (input.values === undefined) throw new Error('The Secret Catalog plugin is not loaded, so the bound secret reference cannot be resolved.')
      return { value: await input.values.resolve({ reference, cwd: null }), label: formatSecretReference(reference) }
    }
    if (input.referenceText.trim() !== '') throw new Error('The bound key is not a secret:ALIAS or secret:ALIAS@env reference.')
    if (input.environmentValue === undefined || input.environmentValue === '') return undefined
    return { value: input.environmentValue, label: `env:${input.environmentVariableName}` }
  }
}
