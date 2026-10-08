import { describe, expect, it } from 'vitest'
import { createSecretActionPolicy, filterSecretMetadata, nextRowIndex } from './secret-catalog-model.js'
import { parseSecretPrintMetadata } from './secret-metadata.js'

const rows = parseSecretPrintMetadata(
  JSON.stringify([
    { alias: 'SYNTHETIC_SHARED', scope: 'project', env: 'prod', envKey: 'PROJECT_VALUE' },
    { alias: 'SYNTHETIC_SHARED', scope: 'global', env: 'prod', envKey: 'GLOBAL_VALUE' },
    { alias: 'SYNTHETIC_GLOBAL', scope: 'global', env: 'prod' },
    { alias: 'SYNTHETIC_LOCAL', scope: 'local', env: 'dev' },
  ]),
)

const rowBy = (predicate: (row: (typeof rows)[number]) => boolean): (typeof rows)[number] => {
  const row = rows.find(predicate)
  if (row === undefined) throw new Error('Synthetic row is missing.')
  return row
}

describe('Secret Catalog scopes and action identity', () => {
  it('filters All, Project, Global, and Local metadata scopes', () => {
    expect(filterSecretMetadata(rows, 'all', '')).toHaveLength(4)
    expect(filterSecretMetadata(rows, 'project', '')).toHaveLength(1)
    expect(filterSecretMetadata(rows, 'global', '')).toHaveLength(2)
    expect(filterSecretMetadata(rows, 'local', '')).toHaveLength(1)
    expect(filterSecretMetadata(rows, 'all', 'synthetic_local').map(row => row.alias)).toEqual(['SYNTHETIC_LOCAL'])
  })

  it('requires a selected folder for project/local rows and blocks ambiguous alias/environment actions', () => {
    const projectRow = rowBy(row => row.scope === 'project')
    const globalRow = rowBy(row => row.alias === 'SYNTHETIC_GLOBAL')
    const localRow = rowBy(row => row.scope === 'local')
    const withFolder = createSecretActionPolicy(rows, true)
    const withoutFolder = createSecretActionPolicy(rows, false)
    expect(withoutFolder(projectRow)).toBe(false)
    expect(withFolder(projectRow)).toBe(false)
    expect(withoutFolder(globalRow)).toBe(true)
    expect(withFolder(localRow)).toBe(true)
    expect(withoutFolder(localRow)).toBe(false)
  })
})

describe('Secret Catalog table keyboard navigation', () => {
  it('moves within bounds and ignores unrelated keys', () => {
    expect(nextRowIndex(0, 'ArrowDown', 3)).toBe(1)
    expect(nextRowIndex(2, 'ArrowDown', 3)).toBe(2)
    expect(nextRowIndex(0, 'ArrowUp', 3)).toBe(0)
    expect(nextRowIndex(1, 'Home', 3)).toBe(0)
    expect(nextRowIndex(0, 'End', 3)).toBe(2)
    expect(nextRowIndex(0, 'Enter', 3)).toBeNull()
    expect(nextRowIndex(0, 'ArrowDown', 0)).toBeNull()
  })
})
