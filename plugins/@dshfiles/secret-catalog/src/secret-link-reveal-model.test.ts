import { describe, expect, it } from 'vitest'
import type { SecretMetadata } from './secret-metadata.js'
import { secretLinkTarget } from './secret-link-reveal-model.js'

const row = (alias: string, scope: string, environment = 'prod'): SecretMetadata => ({
  id: `${scope}:${alias}:${environment}`,
  alias,
  scope,
  environment,
  variableName: alias,
  item: '',
  field: '',
  service: '',
  description: '',
})

describe('secret link target', () => {
  it('reveals the one row with the same alias and environment', () => {
    const rows = [row('GITHUB_TOKEN', 'global'), row('GITHUB_TOKEN', 'global', 'dev'), row('OTHER', 'project')]
    expect(secretLinkTarget('secret:GITHUB_TOKEN', rows)).toMatchObject({ state: 'revealable', row: { id: 'global:GITHUB_TOKEN:prod' }, scope: 'global' })
    expect(secretLinkTarget('secret:GITHUB_TOKEN@dev', rows)).toMatchObject({ state: 'revealable', row: { id: 'global:GITHUB_TOKEN:dev' } })
  })

  it('refuses the same alias in two scopes by name instead of guessing', () => {
    const target = secretLinkTarget('secret:KEY', [row('KEY', 'global'), row('KEY', 'local')])
    expect(target).toEqual({ state: 'ambiguous', reference: { alias: 'KEY', environment: 'prod' }, scopes: ['global', 'local'] })
  })

  it('reports a missing alias and ignores text that is not a reference', () => {
    expect(secretLinkTarget('secret:NOPE@dev', [row('NOPE', 'global')])).toEqual({ state: 'missing', reference: { alias: 'NOPE', environment: 'dev' } })
    expect(secretLinkTarget('not a reference', [row('KEY', 'global')])).toEqual({ state: 'invalid' })
    expect(secretLinkTarget('secret:KEY', [row('KEY', 'shell')])).toMatchObject({ state: 'missing' })
  })
})
