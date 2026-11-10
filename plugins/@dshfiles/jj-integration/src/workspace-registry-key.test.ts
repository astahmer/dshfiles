import { describe, expect, it } from 'vitest'
import { workspaceRegistryKey } from './workspace-registry-key.js'

const keyOf = (ids: readonly string[]) => workspaceRegistryKey(ids.map(workspaceId => ({ workspaceId })))

describe('workspaceRegistryKey', () => {
  it('changes when another plugin registers or removes a folder, and not when the list only reorders', () => {
    const before = keyOf(['default'])
    expect(keyOf(['default', 'undo-project'])).not.toBe(before)
    expect(keyOf(['undo-project', 'default'])).toBe(keyOf(['default', 'undo-project']))
    expect(keyOf(['undo-project'])).not.toBe(keyOf(['default', 'undo-project']))
    expect(keyOf(['default'])).toBe(before)
  })
})
