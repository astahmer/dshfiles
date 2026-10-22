import { describe, expect, test } from 'vitest'
import { IntegrationRecovery } from './integration-recovery.js'

describe('integration recovery', () => {
  test('recognizes the Host answer that queued the integration', () => {
    expect(IntegrationRecovery.isQueued({ remoteCode: 'integration-queued', message: 'queued' })).toBe(true)
  })

  test('leaves every other failure to the surface that knows what to say', () => {
    expect(IntegrationRecovery.isQueued({ remoteCode: 'thread-active' })).toBe(false)
    expect(IntegrationRecovery.isQueued(new Error('the Host did not answer within 300s'))).toBe(false)
    expect(IntegrationRecovery.isQueued({ remoteCode: 42 })).toBe(false)
    expect(IntegrationRecovery.isQueued(null)).toBe(false)
    expect(IntegrationRecovery.isQueued(undefined)).toBe(false)
  })

  test('queues an unverifiable manual attempt and keeps an Agent or a queued retry reporting back', () => {
    expect(IntegrationRecovery.queuesInsteadOfRefusing({ fromAgent: false, retrying: false })).toBe(true)
    expect(IntegrationRecovery.queuesInsteadOfRefusing({ fromAgent: true, retrying: false })).toBe(false)
    expect(IntegrationRecovery.queuesInsteadOfRefusing({ fromAgent: false, retrying: true })).toBe(false)
    expect(IntegrationRecovery.queuesInsteadOfRefusing({ fromAgent: true, retrying: true })).toBe(false)
  })
})
