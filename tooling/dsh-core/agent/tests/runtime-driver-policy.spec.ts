import { describe, expect, it } from 'vitest'
import { runtimeDriverDescriptorSchema } from '../src/runtime-driver.ts'
import type { RuntimeDriverDescriptor } from '../src/runtime-driver.ts'
import { runtimeDriverSupportsOperation } from '../src/runtime-driver-policy.ts'

const capabilitiesFor = (overrides: Partial<RuntimeDriverDescriptor['capabilities']>) => runtimeDriverDescriptorSchema.parse({
  id: 'portable-history',
  title: 'Portable history driver',
  protocolVersion: 1,
  capabilities: {
    create: true,
    resume: false,
    fork: false,
    historyReplay: false,
    steering: true,
    rollback: false,
    ...overrides,
  },
}).capabilities

describe('runtime driver operation capabilities', () => {
  it('allows a seeded fork when the driver can create and replay portable history', () => {
    const capabilities = capabilitiesFor({ historyReplay: true })

    expect(runtimeDriverSupportsOperation(capabilities, 'fork')).toBe(true)
  })

  it('requires create capability for history-based resume and fork', () => {
    const capabilities = capabilitiesFor({ create: false, historyReplay: true })

    expect(runtimeDriverSupportsOperation(capabilities, 'resume')).toBe(false)
    expect(runtimeDriverSupportsOperation(capabilities, 'fork')).toBe(false)
  })

  it('keeps native operation capability authoritative', () => {
    const capabilities = capabilitiesFor({ create: false, fork: true })

    expect(runtimeDriverSupportsOperation(capabilities, 'fork')).toBe(true)
  })
})
