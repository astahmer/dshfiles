import type { SecretMetadata } from './secret-metadata.js'

export type SecretScopeFilter = 'all' | 'project' | 'global' | 'local'

const lower = (value: string): string => value.toLocaleLowerCase()

export const filterSecretMetadata = (rows: readonly SecretMetadata[], scope: SecretScopeFilter, query: string): readonly SecretMetadata[] =>
  rows.filter(row => {
    if (scope !== 'all' && lower(row.scope) !== scope) return false
    const haystack = lower([row.variableName, row.alias, row.environment, row.item, row.field, row.service, row.description, row.scope].join(' '))
    return haystack.includes(lower(query.trim()))
  })

export const createSecretActionPolicy = (rows: readonly SecretMetadata[], hasProjectFolder: boolean): ((row: SecretMetadata) => boolean) => {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = JSON.stringify([row.alias, row.environment])
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return row => {
    if (row.scope !== 'global' && row.scope !== 'project' && row.scope !== 'local') return false
    if ((row.scope === 'project' || row.scope === 'local') && !hasProjectFolder) return false
    return counts.get(JSON.stringify([row.alias, row.environment])) === 1
  }
}
