import { describe, expect, it } from 'vitest'
import { knownSessionRuntime } from './session-runtime.js'

describe('knownSessionRuntime', () => {
  it('returns null for an unclaimed Session without asking sources to discover it', async () => {
    let resolved = false
    const registry = {
      ownerOf: () => undefined,
      resolveOwner: async () => {
        resolved = true
        return undefined
      },
    }

    await expect(knownSessionRuntime({ sessionId: 'local-session', sessionSources: [registry] })).resolves.toBeNull()
    expect(resolved).toBe(false)
  })

  it('uses a source that already claimed the Session', async () => {
    let runtimeLookups = 0
    const source = {
      id: 'remote',
      label: 'Remote host',
      list: async () => [],
      owns: async () => true,
      runtimeIdForSession: async () => {
        runtimeLookups += 1
        return 'runtime-1'
      },
    }
    const registry = { ownerOf: () => source }

    await expect(knownSessionRuntime({ sessionId: 'remote-session', sessionSources: [registry] })).resolves.toBe('runtime-1')
    expect(runtimeLookups).toBe(1)
  })
})
