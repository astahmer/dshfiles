import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { secretScopeSchema, type SecretScope } from './secret-metadata.js'
import type { SecretCatalogOperations } from './secret-operations.js'
import type { SecretCatalogCredentialBridge } from './credential-bridge-contract.js'

export type { SecretCatalogCredentialBridge, SecretCatalogKeyOption } from './credential-bridge-contract.js'

const apiKeyRefPattern = /^[A-Z][A-Z0-9_]*_API_KEY$/
const sourceCwdFor = (scope: SecretScope, cwd: string | null): string | null => {
  if (scope === 'global') return null
  if (cwd === null) throw new Error('Choose a project folder for this alias scope.')
  return cwd
}

const uniqueRows = async (operations: Pick<SecretCatalogOperations, 'list'>, cwd: string | null) => {
  const rows = await operations.list(cwd)
  const scopedRows = rows.flatMap(row => {
    const scope = secretScopeSchema.safeParse(row.scope)
    return scope.success ? [{ row, scope: scope.data }] : []
  })
  const counts = new Map<string, number>()
  for (const entry of scopedRows) {
    const key = JSON.stringify([entry.scope, entry.row.alias, entry.row.environment])
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return scopedRows.filter(entry => counts.get(JSON.stringify([entry.scope, entry.row.alias, entry.row.environment])) === 1)
}

export const createSecretCatalogCredentialBridge = (input: {
  readonly operations: Pick<SecretCatalogOperations, 'list' | 'reveal'>
  readonly getCredentials: () => Pick<CredentialProvider, 'describe' | 'set'> | undefined
}): SecretCatalogCredentialBridge => ({
  listKeys: async cwd => {
    const rows = await uniqueRows(input.operations, cwd)
    return rows.map(entry => ({
      alias: entry.row.alias,
      environment: entry.row.environment,
      scope: entry.scope,
      cwd: entry.scope === 'global' ? null : cwd,
      variableName: entry.row.variableName,
      service: entry.row.service,
      description: entry.row.description,
    }))
  },
  importKey: async request => {
    if (!apiKeyRefPattern.test(request.targetRef)) throw new Error('Choose an API-key variable ending in _API_KEY.')

    const credentials = input.getCredentials()
    if (credentials === undefined) throw new Error('The DSH credential store is unavailable.')

    let target: Awaited<ReturnType<typeof credentials.describe>>
    try {
      target = await credentials.describe(credentialRef(request.targetRef))
    } catch {
      throw new Error('The DSH credential store could not be checked.')
    }
    if (!target.writable) throw new Error('That variable is supplied by a read-only source; choose another API-key variable.')
    if (target.configured && request.replaceExisting !== true)
      throw new Error('That API-key variable already has a value; confirm replacement or choose another reference.')

    const cwd = sourceCwdFor(request.scope, request.cwd)
    const matches = (await uniqueRows(input.operations, cwd)).filter(
      entry => entry.scope === request.scope && entry.row.alias === request.alias && entry.row.environment === request.environment,
    )
    if (matches.length !== 1) throw new Error('That Secret Catalog entry is unavailable or ambiguous.')

    let value: string
    try {
      value = await input.operations.reveal(request.alias, request.scope, cwd, request.environment)
    } catch {
      throw new Error('The selected Secret Catalog entry could not be read.')
    }
    if (value.length === 0) throw new Error('The selected Secret Catalog entry is empty.')

    try {
      await credentials.set(credentialRef(request.targetRef), value)
    } catch {
      throw new Error('The selected key could not be stored in DSH credentials.')
    }
  },
})
