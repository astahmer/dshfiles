import type { SecretCatalogValues, SecretReference } from '@dshfiles/credential-port'
import { withSpan } from '@dshfiles/dshx/tracing'
import type { SecretMetadata } from './secret-metadata.js'
import { secretScopeSchema } from './secret-metadata.js'
import type { SecretCatalogOperations } from './secret-operations.js'

const uniqueMatch = (rows: readonly SecretMetadata[], reference: SecretReference): SecretMetadata => {
  const matches = rows.filter(row => row.alias === reference.alias && row.environment === reference.environment)
  const [match] = matches
  if (match === undefined) {
    throw new Error(`No secret alias ${reference.alias} is configured for environment ${reference.environment}. Add it in the Secret Catalog first.`)
  }
  if (matches.length > 1) {
    throw new Error(
      `Alias ${reference.alias} exists in several scopes for environment ${reference.environment}; resolve the duplicate with the secret CLI first.`,
    )
  }
  return match
}

/**
 * Resolves a stored `secret:ALIAS[@env]` reference on the Host, through the same CLI path the Catalog reveals with.
 * A folder given by the caller also covers its project and machine-local aliases; without one only global aliases
 * resolve, so a settings field never picks up an unrelated project's secret.
 */
export const createSecretCatalogValues = (input: { readonly operations: Pick<SecretCatalogOperations, 'list' | 'reveal'> }): SecretCatalogValues => ({
  supportsExpectedScope: true,
  resolve: ({ reference, cwd, expectedScope }) =>
    withSpan(
      'secret resolve',
      { attributes: { 'secret.alias': reference.alias, 'secret.environment': reference.environment, 'secret.project_scoped': cwd !== null } },
      async span => {
        const match = uniqueMatch(await input.operations.list(cwd), reference)
        const scope = secretScopeSchema.parse(match.scope)
        if (expectedScope !== undefined && scope !== expectedScope) throw new Error('The selected secret scope changed. Select the alias again.')
        span.setAttribute('secret.scope', scope)
        return input.operations.reveal(reference.alias, scope, cwd, reference.environment)
      },
    ),
})
