import { describe, expect, test } from 'vitest'
import { safeDecodeStrict, strictStandardSchema } from '../src/schema.js'
import {
  hostDirectorySchema,
  hostConnectorSchema,
  runtimeIdentitySchema,
  runtimeLocatorSchema,
  runtimeOriginPort,
  runtimeRecordSchema,
} from '../src/records.js'

const localRuntime = {
  schemaVersion: 2 as const,
  id: '10000000-0000-4000-8000-000000000001',
  hostId: 'machine',
  name: 'Web',
  locator: { kind: 'local' as const, launchUrl: 'http://127.0.0.1:3199/?token=token_value-123456' },
  identity: {
    protocolVersion: 1 as const,
    runtimeId: '10000000-0000-4000-8000-000000000001',
    profile: 'web',
    homeLeaf: 'dsh-home',
    dshVersion: '0.2.0-rc.2',
    capabilities: ['workspace' as const, 'session' as const, 'agent' as const],
  },
  createdAt: '2026-10-05T00:00:00.000Z',
}

describe('multi-host record schemas', () => {
  test('returns the decoded value from a successful Effect result', () => {
    expect(safeDecodeStrict(hostConnectorSchema, { kind: 'local' })).toEqual({ success: true, data: { kind: 'local' } })
  })

  test('keeps strict excess-property errors through Standard Schema', () => {
    const standard = strictStandardSchema(hostConnectorSchema)
    const result = standard['~standard'].validate({ kind: 'local', unexpected: true })
    expect(result).not.toHaveProperty('value')
    expect(result.issues?.length).toBeGreaterThan(0)
  })

  test('accepts tokenized HTTP launch URLs only on loopback', () => {
    expect(safeDecodeStrict(runtimeLocatorSchema, localRuntime.locator).success).toBe(true)
    expect(safeDecodeStrict(runtimeLocatorSchema, { kind: 'local', launchUrl: 'http://remote.example/?token=token_value-123456' }).success).toBe(false)
    expect(safeDecodeStrict(runtimeLocatorSchema, { kind: 'local', launchUrl: 'http://127.0.0.1:3199/?token=short' }).success).toBe(false)
    expect(
      safeDecodeStrict(runtimeLocatorSchema, { kind: 'local', launchUrl: 'http://127.0.0.1:3199/?token=token_value-123456&next=https://outside.invalid' })
        .success,
    ).toBe(false)
    expect(safeDecodeStrict(runtimeLocatorSchema, { kind: 'local', launchUrl: 'https://127.0.0.1:3199/?token=token_value-123456' }).success).toBe(false)
  })

  test('rejects shell-shaped SSH targets and remote paths; the legacy unit field is optional', () => {
    expect(safeDecodeStrict(runtimeLocatorSchema, { kind: 'ssh', remoteHome: '/home/deploy/.dsh/blue' }).success).toBe(true)
    expect(safeDecodeStrict(hostConnectorSchema, { kind: 'ssh', sshTarget: 'deploy@machine.example' }).success).toBe(true)
    expect(safeDecodeStrict(hostConnectorSchema, { kind: 'ssh', sshTarget: 'deploy@machine; touch /tmp/pwned' }).success).toBe(false)
    expect(safeDecodeStrict(runtimeLocatorSchema, { kind: 'ssh', unit: 'dsh-runtime@blue.service', remoteHome: '/home/deploy/.dsh/blue' }).success).toBe(true)
    expect(safeDecodeStrict(runtimeLocatorSchema, { kind: 'ssh', unit: "dsh'; id #", remoteHome: '/home/deploy/.dsh/blue' }).success).toBe(false)
    expect(safeDecodeStrict(runtimeLocatorSchema, { kind: 'ssh', unit: 'dsh-runtime', remoteHome: '/home/deploy/../root' }).success).toBe(false)
  })

  test('rejects unsupported runtime identity protocol versions', () => {
    expect(safeDecodeStrict(runtimeIdentitySchema, { ...localRuntime.identity, protocolVersion: 2 }).success).toBe(false)
  })

  test('enforces one host owner per runtime identity', () => {
    const firstHost = { schemaVersion: 2, id: 'machine', name: 'Machine', connector: { kind: 'local' }, createdAt: '2026-10-05T00:00:00.000Z' }
    const first = safeDecodeStrict(hostDirectorySchema, { schemaVersion: 2, hosts: [firstHost], runtimes: [localRuntime] })
    expect(first.success).toBe(true)

    const duplicate = safeDecodeStrict(hostDirectorySchema, {
      schemaVersion: 2,
      hosts: [firstHost],
      runtimes: [localRuntime, { ...localRuntime, name: 'Duplicate runtime' }],
    })
    expect(duplicate.success).toBe(false)

    const orphaned = safeDecodeStrict(runtimeRecordSchema, { ...localRuntime, hostId: 'missing' })
    expect(orphaned.success).toBe(true)
    const orphanDirectory = safeDecodeStrict(hostDirectorySchema, { schemaVersion: 2, hosts: [firstHost], runtimes: [{ ...localRuntime, hostId: 'missing' }] })
    expect(orphanDirectory.success).toBe(false)
  })

  test('pins stable, distinct loopback origin ports to runtime identities', () => {
    const firstPort = runtimeOriginPort(localRuntime.id)
    expect(runtimeOriginPort(localRuntime.id)).toBe(firstPort)
    const secondPort = runtimeOriginPort('20000000-0000-4000-8000-000000000001', [firstPort])
    expect(secondPort).not.toBe(firstPort)
    expect(firstPort).toBeGreaterThanOrEqual(40_000)
    expect(firstPort).toBeLessThanOrEqual(59_999)
    const firstHost = { schemaVersion: 2, id: 'machine', name: 'Machine', connector: { kind: 'local' }, createdAt: '2026-10-05T00:00:00.000Z' }
    const first = { ...localRuntime, originPort: firstPort }
    const duplicateOrigin = safeDecodeStrict(hostDirectorySchema, {
      schemaVersion: 2,
      hosts: [firstHost],
      runtimes: [first, { ...first, id: '20000000-0000-4000-8000-000000000001' }],
    })
    expect(duplicateOrigin.success).toBe(false)
    const retiredOrigin = safeDecodeStrict(hostDirectorySchema, { schemaVersion: 2, hosts: [firstHost], runtimes: [first], retiredPorts: [firstPort] })
    expect(retiredOrigin.success).toBe(false)
  })
})
