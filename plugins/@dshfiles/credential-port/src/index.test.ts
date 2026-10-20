import { describe, expect, it } from 'vitest'
import { secretScopeSchema } from './index.js'

describe('credential port scopes', () => {
  it('accepts the three scopes a secrets catalog can address', () => {
    expect(['global', 'project', 'local'].map(scope => secretScopeSchema.parse(scope))).toEqual(['global', 'project', 'local'])
  })

  it('rejects a scope the catalog cannot address', () => {
    for (const scope of ['user', 'workspace', 'Global', '']) {
      expect(secretScopeSchema.safeParse(scope).success).toBe(false)
    }
  })
})
