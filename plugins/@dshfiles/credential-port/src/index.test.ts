import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { secretScopeSchemaEffect } from './effect.js'

describe('credential port scopes', () => {
  const decodeScope = Schema.decodeUnknownSync(secretScopeSchemaEffect)

  it('accepts the three scopes a secrets catalog can address', () => {
    expect(['global', 'project', 'local'].map(scope => decodeScope(scope))).toEqual(['global', 'project', 'local'])
  })

  it('rejects a scope the catalog cannot address', () => {
    for (const scope of ['user', 'workspace', 'Global', '']) {
      expect(Schema.is(secretScopeSchemaEffect)(scope)).toBe(false)
    }
  })
})
