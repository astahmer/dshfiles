import { formatSecretReference, parseSecretReference, secretScopeSchema, type SecretScope } from '@dshfiles/credential-port'
import { SecretCliError } from './secret-cli-runner.js'
import type { SecretMetadata } from './secret-metadata.js'
import type { SecretCatalogOperations } from './secret-operations.js'
import type { SecretGlobalConfig, SecretReferenceElsewhere, SecretReferenceState, SecretReferenceStatus } from './secret-reference-status-schema.js'

const MAX_PROBED_FOLDERS = 16

const cliState = (error: unknown): SecretReferenceState => (error instanceof SecretCliError ? error.code : 'cli-failed')

const elsewhereIn = async (input: {
  readonly operations: Pick<SecretCatalogOperations, 'list'>
  readonly alias: string
  readonly folders: readonly string[]
}): Promise<readonly SecretReferenceElsewhere[]> => {
  const found = await Promise.all(
    input.folders.slice(0, MAX_PROBED_FOLDERS).map(async folder => {
      const rows: readonly SecretMetadata[] = await input.operations.list(folder).catch(() => [])
      return rows.flatMap(row => {
        const scope = secretScopeSchema.safeParse(row.scope)
        return row.alias === input.alias && scope.success && scope.data !== 'global' ? [{ scope: scope.data, folder, environment: row.environment }] : []
      })
    }),
  )
  return found.flat()
}

/**
 * Checks one `secret:ALIAS[@env]` the way a consumer resolves it, and names the first reason it would fail. A matched
 * alias is read on the Host so a missing vault item or a locked vault reports here; the value itself never leaves.
 * A missing alias is also looked up in `probeFolders`, so the answer can say "missing from every scope" or "only in
 * that project", which a consumer resolving global aliases cannot reach.
 */
export const checkSecretReference = async (input: {
  readonly operations: Pick<SecretCatalogOperations, 'list' | 'reveal'>
  readonly referenceText: string
  readonly cwd: string | null
  readonly probeFolders?: readonly string[]
  readonly inspectGlobalConfig: () => Promise<SecretGlobalConfig>
}): Promise<SecretReferenceStatus> => {
  const writeScope: SecretScope = input.cwd === null ? 'global' : 'project'
  const globalConfig = await input.inspectGlobalConfig().catch((): SecretGlobalConfig => ({ path: null, linkedTo: null }))
  const base = {
    reference: null,
    alias: null,
    environment: null,
    cwd: input.cwd,
    scope: null,
    environments: [],
    scopes: [],
    elsewhere: [],
    writeScope,
    globalConfig,
  }
  if (input.referenceText.trim() === '') return { ...base, state: 'empty' }
  const reference = parseSecretReference(input.referenceText)
  if (reference === null) return { ...base, state: 'invalid-reference' }
  const named = { ...base, reference: formatSecretReference(reference), alias: reference.alias, environment: reference.environment }

  let rows: readonly SecretMetadata[]
  try {
    rows = await input.operations.list(input.cwd)
  } catch (error) {
    return { ...named, state: cliState(error) }
  }
  const sameAlias = rows.filter(row => row.alias === reference.alias)
  const environments = [...new Set(sameAlias.map(row => row.environment))].sort()
  const matches = sameAlias.filter(row => row.environment === reference.environment)
  const scopes = [...new Set(matches.map(row => row.scope))].sort()
  if (sameAlias.length === 0) {
    const folders = (input.probeFolders ?? []).filter(folder => folder !== input.cwd)
    const elsewhere = await elsewhereIn({ operations: input.operations, alias: reference.alias, folders })
    return { ...named, state: 'alias-missing', elsewhere: [...elsewhere] }
  }
  if (matches.length === 0) {
    const aliasScopes = [...new Set(sameAlias.map(row => row.scope))]
    const owningScope = aliasScopes.length === 1 ? secretScopeSchema.safeParse(aliasScopes[0]) : null
    return { ...named, state: 'environment-missing', environments, writeScope: owningScope?.success === true ? owningScope.data : writeScope }
  }
  if (matches.length > 1) return { ...named, state: 'ambiguous', environments, scopes }

  const scope = secretScopeSchema.safeParse(matches[0]?.scope)
  if (!scope.success) return { ...named, state: 'ambiguous', environments, scopes }
  const found = { ...named, scope: scope.data, writeScope: scope.data, environments, scopes }
  let value: string
  try {
    value = await input.operations.reveal(reference.alias, scope.data, input.cwd, reference.environment)
  } catch (error) {
    const state = cliState(error)
    return { ...found, state: state === 'cli-failed' ? 'value-unreadable' : state }
  }
  return { ...found, state: value.length === 0 ? 'value-empty' : 'resolved' }
}
