import { parseSecretReference, type SecretReference, type SecretScope } from '@dshfiles/credential-port'
import type { SecretMetadata } from './secret-metadata.js'

/** What an item's `secret:` link can offer inline, decided from Catalog metadata alone (never a value). */
export type SecretLinkTarget =
  | { readonly state: 'invalid' }
  | { readonly state: 'missing'; readonly reference: SecretReference }
  | { readonly state: 'ambiguous'; readonly reference: SecretReference; readonly scopes: readonly string[] }
  | { readonly state: 'revealable'; readonly reference: SecretReference; readonly row: SecretMetadata; readonly scope: SecretScope }

const writableScope = (scope: string): SecretScope | null => (scope === 'global' || scope === 'project' || scope === 'local' ? scope : null)

/**
 * Finds the one Catalog row a reference names: same alias and environment, in a scope the reveal verb accepts. The
 * same alias in two scopes is refused by name, as the Host resolver does, rather than guessing which one was meant.
 */
export const secretLinkTarget = (text: string, rows: readonly SecretMetadata[]): SecretLinkTarget => {
  const reference = parseSecretReference(text)
  if (reference === null) return { state: 'invalid' }
  const matches = rows.flatMap(row => {
    const scope = writableScope(row.scope)
    return row.alias === reference.alias && row.environment === reference.environment && scope !== null ? [{ row, scope }] : []
  })
  const [only, ...others] = matches
  if (only === undefined) return { state: 'missing', reference }
  if (others.length > 0) return { state: 'ambiguous', reference, scopes: matches.map(match => match.scope) }
  return { state: 'revealable', reference, row: only.row, scope: only.scope }
}
