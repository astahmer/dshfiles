import { describe, expect, it } from 'vitest'
import { sessionFormatCatalog } from '../src/index.ts'

const policy = { recovery: 'strict', validation: 'current' } as const
const runtimeBinding = { driverKind: 'codex-cli', instanceId: 'work-account' }

describe('Session format V5', () => {
  it('round-trips the stable runtime selection in a current physical header', () => {
    const header = {
      version: 5,
      id: 'runtime-bound',
      createdAt: 1,
      isSeeded: false,
      delegationDepth: 0,
      runtimeBinding,
    }
    const physical = sessionFormatCatalog.encodeCurrentHeader(header, 0)
    const restored = sessionFormatCatalog.createRestore(physical, policy).finish()

    expect(physical['version']).toBe(5)
    expect(restored.header['runtimeBinding']).toEqual(runtimeBinding)
    expect(restored.events).toEqual([])
  })

  it('upgrades unbound V4 headers without changing their event cut', () => {
    const physicalV4 = {
      type: 'session',
      version: 4,
      id: 'legacy-unbound',
      createdAt: 1,
      isSeeded: false,
      delegationDepth: 0,
    }
    const restored = sessionFormatCatalog.createRestore(physicalV4, policy).finish()

    expect(restored.header['version']).toBe(5)
    expect(restored.header['runtimeBinding']).toBeUndefined()
    expect(restored.inheritedEventCount).toBe(0)
    expect(restored.events).toEqual([])
  })

  it('preserves an inherited V4 marker and its exact fork cut', () => {
    const reader = sessionFormatCatalog.createRestore({
      type: 'session',
      version: 4,
      id: 'legacy-seeded',
      createdAt: 1,
      parentSession: 'legacy-parent',
      isSeeded: true,
      delegationDepth: 0,
    }, policy)
    const marker = {
      type: 'session/end-seed',
      seq: 0,
      time: 1,
      data: { inherited: true },
    }
    reader.decodeRow(sessionFormatCatalog.encodeCurrentEvent(marker))
    const restored = reader.finish()

    expect(restored.inheritedEventCount).toBe(0)
    expect(restored.events).toEqual([marker])
    expect(restored.header['runtimeBinding']).toBeUndefined()
  })

  it('rejects malformed adapter selections without echoing their values', () => {
    const result = sessionFormatCatalog.readHeader({
      type: 'session',
      version: 5,
      id: 'invalid-binding',
      createdAt: 1,
      isSeeded: false,
      delegationDepth: 0,
      inheritedEventCount: 0,
      runtimeBinding: {
        driverKind: 'codex-cli',
        instanceId: 'work-account',
        nativeSessionId: 'private-value',
      },
    })

    expect(result.status).toBe('malformed')
    if (result.status !== 'malformed') throw new Error('invalid runtime binding was accepted')
    expect(result.reason).not.toContain('private-value')
  })
})
