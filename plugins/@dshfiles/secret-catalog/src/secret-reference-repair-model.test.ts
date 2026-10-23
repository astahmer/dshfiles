import { describe, expect, it } from 'vitest'
import { repairView } from './secret-reference-repair-model.js'
import type { SecretReferenceStatus } from './secret-reference-status-schema.js'

const status = (overrides: Partial<SecretReferenceStatus>): SecretReferenceStatus => ({
  state: 'alias-missing',
  reference: 'secret:DSH_JEV_BACKLOG',
  alias: 'DSH_JEV_BACKLOG',
  environment: 'prod',
  cwd: null,
  scope: null,
  environments: [],
  scopes: [],
  elsewhere: [],
  writeScope: 'global',
  globalConfig: { path: '/home/synthetic/.config/secret/config.json', linkedTo: null },
  ...overrides,
})

describe('secret reference repair view', () => {
  it('offers to recreate an alias missing from every scope in its write scope', () => {
    expect(repairView(status({}))).toMatchObject({
      messageKey: 'refStateAliasMissing',
      setValue: 'create',
      params: { reference: 'secret:DSH_JEV_BACKLOG', writeScope: 'global' },
    })
  })

  it('names the project that holds an alias a global setting cannot read', () => {
    const view = repairView(status({ elsewhere: [{ scope: 'project', folder: '/work/dshfiles', environment: 'prod' }] }))
    expect(view).toMatchObject({
      messageKey: 'refStateAliasOnlyElsewhere',
      setValue: 'create',
      params: { folder: '/work/dshfiles', elsewhereScope: 'project' },
    })
  })

  it('warns before a global write lands in a symlinked config, and only then', () => {
    const linked = { path: '/home/synthetic/.config/secret/config.json', linkedTo: '/home/synthetic/nixfiles/global.json' }
    expect(repairView(status({ globalConfig: linked }))?.symlinkTarget).toBe('/home/synthetic/nixfiles/global.json')
    expect(repairView(status({ globalConfig: linked, writeScope: 'project', cwd: '/work' }))?.symlinkTarget).toBeNull()
    expect(repairView(status({ globalConfig: linked, state: 'cli-timeout' }))?.symlinkTarget).toBeNull()
  })

  it('replaces an unreadable or empty value and offers no write for CLI or scope problems', () => {
    expect(repairView(status({ state: 'value-empty', scope: 'global' }))?.setValue).toBe('replace')
    expect(repairView(status({ state: 'value-unreadable', scope: 'global' }))?.setValue).toBe('replace')
    for (const state of ['ambiguous', 'cli-missing', 'cli-timeout', 'cli-failed', 'invalid-reference', 'resolved'] as const) {
      expect(repairView(status({ state }))?.setValue).toBeNull()
    }
  })

  it('has nothing to repair for an empty field', () => {
    expect(repairView(status({ state: 'empty', reference: null }))).toBeNull()
  })
})
