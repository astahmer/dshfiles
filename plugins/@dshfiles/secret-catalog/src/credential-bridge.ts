import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SecretCatalogCredentialBridge, SecretCatalogKeyOption, SecretScope } from '@dshfiles/credential-port'
import { Option } from 'effect'
import * as Schema from 'effect/Schema'
import { secretScopeSchemaEffect } from '@dshfiles/credential-port/effect'
import type { SecretCatalogOperations } from './secret-operations.js'

export type { SecretCatalogCredentialBridge, SecretCatalogKeyOption }

const apiKeyRefPattern = /^[A-Z][A-Z0-9_]*_API_KEY$/
const sourceCwdFor = (scope: SecretScope, cwd: string | null): string | null => {
  if (scope === 'global') return null
  if (cwd === null) throw new Error('Choose a project folder for this alias scope.')
  return cwd
}

const uniqueRows = async (operations: Pick<SecretCatalogOperations, 'list'>, cwd: string | null, signal?: AbortSignal) => {
  const rows = await operations.list(cwd, signal)
  const scopedRows = rows.flatMap(row => {
    const scope = Schema.decodeUnknownOption(secretScopeSchemaEffect)(row.scope)
    return Option.isSome(scope) ? [{ row, scope: scope.value }] : []
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
  listKeys: async (cwd, signal) => {
    const rows = await uniqueRows(input.operations, cwd, signal)
    signal?.throwIfAborted()
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
  importKey: async (request, signal) => {
    if (!apiKeyRefPattern.test(request.targetRef)) throw new Error('Choose an API-key variable ending in _API_KEY.')

    const credentials = input.getCredentials()
    if (credentials === undefined) throw new Error('The DSH credential store is unavailable.')

    let target: Awaited<ReturnType<typeof credentials.describe>>
    try {
      target = await credentials.describe(credentialRef(request.targetRef))
    } catch {
      signal?.throwIfAborted()
      throw new Error('The DSH credential store could not be checked.')
    }
    signal?.throwIfAborted()
    if (!target.writable) throw new Error('That variable is supplied by a read-only source; choose another API-key variable.')
    if (target.configured && request.replaceExisting !== true)
      throw new Error('That API-key variable already has a value; confirm replacement or choose another reference.')

    const cwd = sourceCwdFor(request.scope, request.cwd)
    const matches = (await uniqueRows(input.operations, cwd, signal)).filter(
      entry => entry.scope === request.scope && entry.row.alias === request.alias && entry.row.environment === request.environment,
    )
    signal?.throwIfAborted()
    if (matches.length !== 1) throw new Error('That Secret Catalog entry is unavailable or ambiguous.')

    let value: string
    try {
      value = await input.operations.reveal(request.alias, request.scope, cwd, request.environment, signal)
    } catch (error) {
      if (signal?.aborted === true) throw error
      throw new Error('The selected Secret Catalog entry could not be read.')
    }
    signal?.throwIfAborted()
    if (value.length === 0) throw new Error('The selected Secret Catalog entry is empty.')

    try {
      await credentials.set(credentialRef(request.targetRef), value)
    } catch {
      signal?.throwIfAborted()
      throw new Error('The selected key could not be stored in DSH credentials.')
    }
  },
})
