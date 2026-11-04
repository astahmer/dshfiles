/** The environment a reference without `@env` means; Secret Catalog writes `prod` when the user does not choose one. */
export const DEFAULT_SECRET_ENVIRONMENT = 'prod'

export interface SecretReference {
  readonly alias: string
  readonly environment: string
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
